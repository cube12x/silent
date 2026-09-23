//! Repository inspection (implemented in milestone 6).

#[tauri::command]
pub async fn repo_inspect(_path: String) -> Result<serde_json::Value, String> {
    Ok(serde_json::Value::Null)
}
