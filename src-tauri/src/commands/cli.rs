//! Real CLI execution, installation and login. Every run streams `RuntimeEvent`s over a Channel.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use silent_runtime::cli::registry;
use silent_runtime::cli::{adapter_for, line_parser, ProviderId};
use silent_runtime::{run_streaming, CliRunRequest, RunHandle, RuntimeEvent, SpawnConfig};
use tauri::ipc::Channel;
use tauri::State;
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

fn spawn_registered(
    registry: &RunRegistry,
    run_id: String,
    config: SpawnConfig,
    parser: silent_runtime::LineParser,
    on_event: Channel<RuntimeEvent>,
) -> Result<String, String> {
    spawn_registered_with_cleanup(registry, run_id, config, parser, on_event, Vec::new())
}

/// Like `spawn_registered`, additionally deleting `temp_files` (best effort) once the process ends.
fn spawn_registered_with_cleanup(
    registry: &RunRegistry,
    run_id: String,
    config: SpawnConfig,
    parser: silent_runtime::LineParser,
    on_event: Channel<RuntimeEvent>,
    temp_files: Vec<std::path::PathBuf>,
) -> Result<String, String> {
    let (handle, cancel_rx) = RunHandle::new();
    registry.insert(&run_id, handle.cancel.clone())?;
    let registry_inner = Arc::clone(&registry.0);
    let task_run_id = run_id.clone();
    tauri::async_runtime::spawn(async move {
        let sink = move |event: RuntimeEvent| {
            let _ = on_event.send(event);
        };
        if let Err(error) = run_streaming(config, parser, sink, cancel_rx).await {
            log::warn!("run {task_run_id} ended with error: {error}");
        }
        for file in temp_files {
            let _ = std::fs::remove_file(file);
        }
        if let Ok(mut map) = registry_inner.lock() {
            map.remove(&task_run_id);
        }
    });
    Ok(run_id)
}

#[tauri::command]
pub async fn cli_run_start(
    registry: State<'_, RunRegistry>,
    request: CliRunRequest,
    on_event: Channel<RuntimeEvent>,
) -> Result<String, String> {
    if request.run_id.trim().is_empty() {
        return Err("runId is required".into());
    }
    if request.prompt.trim().is_empty() {
        return Err("prompt is required".into());
    }
    let adapter = adapter_for(request.provider_id);
    let spec = registry::spec(request.provider_id);
    let program =
        binaries::resolve_any(adapter.binary(), adapter.alt_binaries()).ok_or_else(|| {
            format!(
                "{} not found. Install it ({}) or add `{}` to PATH.",
                spec.name,
                spec.install_script
                    .or(spec.install_npm)
                    .unwrap_or("see docs"),
                adapter.binary()
            )
        })?;
    let mut config = SpawnConfig::new(program, adapter.build_args(&request));
    if adapter.uses_process_cwd() {
        config.cwd = request
            .cwd
            .as_ref()
            .filter(|c| !c.is_empty())
            .map(Into::into);
    }
    config.timeout = Duration::from_secs(request.timeout_secs.unwrap_or(40 * 60).clamp(60, 7200));
    let run_id = request.run_id.clone();
    // Codex's schema file was written by `build_args`; drop it once the run is over.
    let temp_files = if request.provider_id == ProviderId::Codex && request.schema().is_some() {
        vec![request.schema_file_path()]
    } else {
        Vec::new()
    };
    spawn_registered_with_cleanup(
        &registry,
        run_id,
        config,
        line_parser(request.provider_id),
        on_event,
        temp_files,
    )
}

#[tauri::command]
pub async fn cli_run_cancel(
    registry: State<'_, RunRegistry>,
    run_id: String,
) -> Result<(), String> {
    registry.cancel(&run_id)
}

#[derive(Debug, Clone, Copy, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InstallMethod {
    Script,
    Npm,
}

/// Run the provider's install command through a login shell, streaming its output as `stdout` lines.
#[tauri::command]
pub async fn provider_install(
    registry: State<'_, RunRegistry>,
    provider_id: ProviderId,
    method: InstallMethod,
    on_event: Channel<RuntimeEvent>,
) -> Result<String, String> {
    let spec = registry::spec(provider_id);
    let command = match method {
        InstallMethod::Script => spec.install_script.or(spec.install_npm),
        InstallMethod::Npm => spec.install_npm.or(spec.install_script),
    }
    .ok_or_else(|| format!("{} has no install command", spec.name))?;
    let mut config = SpawnConfig::new(
        "/bin/sh",
        vec![
            "-lc".into(),
            format!(
                "export PATH=\"{}:$PATH\"; {command}",
                binaries::augmented_path()
            ),
        ],
    );
    config.timeout = Duration::from_secs(15 * 60);
    let run_id = format!("install:{provider_id}:{}", std::process::id());
    let parser: silent_runtime::LineParser = Box::new(|line: &str| {
        if line.trim().is_empty() {
            Vec::new()
        } else {
            vec![RuntimeEvent::stdout(line)]
        }
    });
    spawn_registered(&registry, run_id, config, parser, on_event)
}

/// Open the provider's interactive login in the user's terminal (device-code / browser flows are
/// interactive by nature and cannot run headless).
#[tauri::command]
pub async fn provider_login(provider_id: ProviderId) -> Result<(), String> {
    let spec = registry::spec(provider_id);
    let command = spec.login_command;
    if cfg!(target_os = "macos") {
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            command.replace('"', "\\\"")
        );
        let status = tokio::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .arg("-e")
            .arg("tell application \"Terminal\" to activate")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("could not open Terminal: {e}"))?;
        if status.status.success() {
            Ok(())
        } else {
            Err(format!(
                "Terminal refused: {}. Run manually: {command}",
                String::from_utf8_lossy(&status.stderr).trim()
            ))
        }
    } else {
        Err(format!("open a terminal and run: {command}"))
    }
}
