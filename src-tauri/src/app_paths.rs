//! App-owned locations resolved through Tauri (`app_data_dir`/`app_log_dir`), so they land in the
//! right place on every OS (macOS: ~/Library/Application Support|Logs/com.silent.workstation,
//! Linux: ~/.local/share|state, Windows: %APPDATA%\com.silent.workstation).

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

pub fn data_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

pub fn log_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// The one-slot request file the `silent` terminal command and a second app instance write into.
pub fn autostart_path(app: &AppHandle) -> Option<PathBuf> {
    data_dir(app).map(|d| d.join("autostart.json"))
}

/// Raw per-run CLI transcript (`<log dir>/raw/<run id>.jsonl`), evidence for parser bugs.
pub fn raw_run_log(app: &AppHandle, run_id: &str) -> Option<PathBuf> {
    let dir = log_dir(app)?.join("raw");
    std::fs::create_dir_all(&dir).ok()?;
    let safe: String = run_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect();
    Some(dir.join(format!("{safe}.jsonl")))
}

/// Projects/blueprint builds root: the folder the user picked in Settings, else `~/CubeCode`.
pub fn workspace_root(override_dir: Option<&str>) -> Result<PathBuf, String> {
    if let Some(dir) = override_dir.map(str::trim).filter(|d| !d.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    silent_runtime::paths::default_workspace_root().ok_or_else(|| "home directory unavailable".to_string())
}

#[allow(dead_code)]
pub fn is_inside(child: &Path, parent: &Path) -> bool {
    child.starts_with(parent)
}
