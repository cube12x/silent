//! Normalized runtime events (placeholder shape; finalized in milestone 6).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum RuntimeEvent {
    Exited { code: Option<i32> },
}
