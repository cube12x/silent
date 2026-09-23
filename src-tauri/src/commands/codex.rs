//! Real Codex CLI execution: spawn `codex exec --json`, stream `RuntimeEvent`s over a Channel.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use silent_runtime::{
    build_args, run_streaming, CodexRunRequest, RunHandle, RuntimeEvent, SpawnConfig,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::sync::watch;

use super::binaries;

/// Active runs keyed by run id; the sender flips the cancel flag observed by `run_streaming`.
#[derive(Default)]
pub struct RunRegistry(pub Arc<Mutex<HashMap<String, watch::Sender<bool>>>>);

impl RunRegistry {
    fn insert(&self, run_id: &str, sender: watch::Sender<bool>) -> Result<(), String> {
        let mut map = self
            .0
            .lock()
            .map_err(|_| "run registry poisoned".to_string())?;
        if map.contains_key(run_id) {
            return Err(format!("run {run_id} is already active"));
        }
        map.insert(run_id.to_owned(), sender);
        Ok(())
    }

    fn cancel(&self, run_id: &str) -> Result<(), String> {
        let map = self
            .0
            .lock()
            .map_err(|_| "run registry poisoned".to_string())?;
        match map.get(run_id) {
            Some(sender) => {
                let _ = sender.send(true);
                Ok(())
            }
            None => Err(format!("no active run with id {run_id}")),
        }
    }
}

#[tauri::command]
pub async fn codex_run_start(
    _app: AppHandle,
    registry: State<'_, RunRegistry>,
    request: CodexRunRequest,
    on_event: Channel<RuntimeEvent>,
) -> Result<String, String> {
    if request.run_id.trim().is_empty() {
        return Err("runId is required".into());
    }
    let program = binaries::resolve("codex").ok_or_else(|| {
        "Codex CLI not found. Install it (npm i -g @openai/codex) or add it to PATH.".to_string()
    })?;

    let run_id = request.run_id.clone();
    let mut config = SpawnConfig::new(program, build_args(&request));
    config.cwd = request
        .cwd
        .as_ref()
        .filter(|c| !c.is_empty())
        .map(Into::into);
    config.timeout = Duration::from_secs(30 * 60);

    let (handle, cancel_rx) = RunHandle::new();
    registry.insert(&run_id, handle.cancel.clone())?;

    let registry_inner = Arc::clone(&registry.0);
    let task_run_id = run_id.clone();
    tauri::async_runtime::spawn(async move {
        let sink = move |event: RuntimeEvent| {
            let _ = on_event.send(event);
        };
        let result = run_streaming(config, sink, cancel_rx).await;
        if let Err(error) = result {
            log::warn!("codex run {task_run_id} ended with error: {error}");
        }
        if let Ok(mut map) = registry_inner.lock() {
            map.remove(&task_run_id);
        }
    });

    Ok(run_id)
}

#[tauri::command]
pub async fn codex_run_cancel(
    registry: State<'_, RunRegistry>,
    run_id: String,
) -> Result<(), String> {
    registry.cancel(&run_id)
}
