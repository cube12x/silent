//! Codex CLI execution commands (implemented in milestone 6).

#[derive(Default)]
pub struct RunRegistry;

#[tauri::command]
pub async fn codex_run_start() -> Result<String, String> {
    Err("not implemented".into())
}

#[tauri::command]
pub async fn codex_run_cancel(_run_id: String) -> Result<(), String> {
    Err("not implemented".into())
}
