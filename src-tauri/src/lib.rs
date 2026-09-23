//! Silent desktop shell: thin Tauri command layer over `silent-runtime`.

mod bridge;
mod commands;
mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:silent.db", db::migrations())
                .build(),
        )
        .manage(commands::codex::RunRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::providers::providers_detect,
            commands::repo::repo_inspect,
            commands::codex::codex_run_start,
            commands::codex::codex_run_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Silent");
}
