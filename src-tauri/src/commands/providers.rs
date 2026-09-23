//! Provider/CLI detection (implemented in milestone 6).

#[tauri::command]
pub async fn providers_detect() -> Result<Vec<serde_json::Value>, String> {
    Ok(Vec::new())
}
