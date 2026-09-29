//! Real CLI execution, installation and login. Every run streams `RuntimeEvent`s over a Channel.

use std::collections::HashMap;
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

    /// Flip every active run's cancel flag (app exit on Windows/Linux, where closing the window quits).
    pub fn cancel_all(&self) -> usize {
        let Ok(map) = self.0.lock() else { return 0 };
        for sender in map.values() {
            let _ = sender.send(true);
        }
        map.len()
    }

    pub fn active(&self) -> usize {
        self.0.lock().map(|m| m.len()).unwrap_or(0)
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

pub(crate) fn spawn_registered(
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
    app: tauri::AppHandle,
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
    let (program, shim_args) =
        binaries::resolve_program(adapter.binary(), adapter.alt_binaries()).ok_or_else(|| {
            format!(
                "{} not found. Install it ({}) or add `{}` to PATH.",
                spec.name,
                spec.install_script
                    .or(spec.install_npm)
                    .unwrap_or("see docs"),
                adapter.binary()
            )
        })?;
    let mut args = shim_args;
    args.extend(adapter.build_args(&request));
    // Argv without the prompt (the last positional) so runs can be reproduced from the log file.
    log::info!(
        "spawn {} {} [{}] cwd={:?}",
        request.run_id,
        program.display(),
        args.iter()
            .filter(|a| a.len() < 200)
            .cloned()
            .collect::<Vec<_>>()
            .join(" "),
        request.cwd
    );
    let mut config = SpawnConfig::new(program, args);
    // Never run a CLI in whatever directory the app happened to start in (`/` for a Finder-launched
    // .app): fall back to the home directory when no working folder was given.
    config.cwd = request
        .cwd
        .as_ref()
        .filter(|c| !c.is_empty())
        .map(Into::into)
        .or_else(binaries::home);
    config.timeout = Duration::from_secs(request.timeout_secs.unwrap_or(40 * 60).clamp(60, 7200));
    // Raw JSONL evidence per run: <app log dir>/raw/<run id>.jsonl
    config.raw_log = crate::app_paths::raw_run_log(&app, &request.run_id);
    config.children_registry = crate::app_paths::children_registry(&app);
    config.run_id = request.run_id.clone();
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
    app: tauri::AppHandle,
    registry: State<'_, RunRegistry>,
    provider_id: ProviderId,
    method: InstallMethod,
    on_event: Channel<RuntimeEvent>,
) -> Result<String, String> {
    let spec = registry::spec(provider_id);
    // Windows has no `curl … | bash`: only the npm variant is offered there.
    let command = if cfg!(windows) {
        spec.install_npm.ok_or_else(|| format!("{} cannot be installed from Silent on Windows; follow its docs.", spec.name))?
    } else {
        match method {
            InstallMethod::Script => spec.install_script.or(spec.install_npm),
            InstallMethod::Npm => spec.install_npm.or(spec.install_script),
        }
        .ok_or_else(|| format!("{} has no install command", spec.name))?
    };
    let mut config = super::shell::shell_config(command);
    config.timeout = Duration::from_secs(15 * 60);
    let run_id = format!("install:{provider_id}:{}", std::process::id());
    config.children_registry = crate::app_paths::children_registry(&app);
    config.run_id = run_id.clone();
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
    super::terminal::open_in_terminal(&format!("Silent - {} login", spec.name), spec.login_command).await
}

/// Kill children a previous instance left behind (crash, `kill -9`): only pids that are alive AND still run
/// the recorded program. Called once at startup.
pub fn reap_orphans(app: &tauri::AppHandle) -> usize {
    let Some(path) = crate::app_paths::children_registry(app) else { return 0 };
    let n = silent_runtime::children::sweep(&path, silent_runtime::children::is_ours, |rec| {
        log::warn!("reaping orphan {} ({} from run {})", rec.pid, rec.program, rec.run_id);
        silent_runtime::children::kill_tree(rec.pid);
    });
    if n > 0 {
        log::info!("reaped {n} orphan child process(es)");
    }
    n
}

/// Last step of a quit: whatever is still listed gets killed with its whole tree.
pub fn kill_remaining_children(app: &tauri::AppHandle) -> usize {
    let Some(path) = crate::app_paths::children_registry(app) else { return 0 };
    silent_runtime::children::sweep(&path, silent_runtime::children::is_ours, |rec| silent_runtime::children::kill_tree(rec.pid))
}

/// How many children are currently listed (alive or not); used to decide whether a quit must wait.
pub fn reap_count(app: &tauri::AppHandle) -> usize {
    crate::app_paths::children_registry(app).map(|p| silent_runtime::children::load(&p).len()).unwrap_or(0)
}
