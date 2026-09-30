pub mod autostart;
pub mod binaries;
pub mod blueprint;
pub mod cli;
pub mod digest;
pub mod files;
pub mod host;
pub mod launcher;
pub mod models;
pub mod prereqs;
pub mod project;
pub mod providers;
pub mod refs;
pub mod repo;
pub mod shell;
pub mod terminal;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub platform: &'static str,
}

/// Webview console → the app log file (plain command; independent of the log plugin's JS permissions).
#[tauri::command]
pub fn frontend_log(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!(target: "webview", "{message}"),
        "warn" => log::warn!(target: "webview", "{message}"),
        _ => log::info!(target: "webview", "{message}"),
    }
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "Silent",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
    }
}
