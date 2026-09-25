//! `silent run <folder> "<request>"` from the terminal: the launcher script writes a JSON request into the
//! app's data directory; the webview polls `autostart_take` and starts the run (plan → approve → start).

use std::path::PathBuf;

pub fn autostart_path() -> Option<PathBuf> {
    super::binaries::home()
        .map(|h| h.join("Library/Application Support/com.silent.workstation/autostart.json"))
}

/// Returns and removes the pending request, if any.
#[tauri::command]
pub fn autostart_take() -> Result<Option<serde_json::Value>, String> {
    let Some(path) = autostart_path() else {
        return Ok(None);
    };
    if !path.is_file() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&path);
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("autostart.json: {e}"))?;
    Ok(Some(value))
}
