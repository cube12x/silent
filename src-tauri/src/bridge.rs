//! Phone Link bridge hook. v1 ships a no-op implementation; v2 plugs a WebSocket server here.

#[allow(dead_code)]
pub trait Bridge: Send + Sync {
    fn status(&self) -> BridgeStatus;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
pub enum BridgeStatus {
    Disconnected,
    Pairing,
    Connected,
}

#[derive(Default)]
#[allow(dead_code)]
pub struct NoopBridge;

impl Bridge for NoopBridge {
    fn status(&self) -> BridgeStatus {
        BridgeStatus::Disconnected
    }
}
