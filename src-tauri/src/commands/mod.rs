pub mod binaries;
pub mod cli;
pub mod models;
pub mod providers;
pub mod repo;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub platform: &'static str,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "Silent",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
    }
}
