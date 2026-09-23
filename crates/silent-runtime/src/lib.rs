//! silent-runtime: spawns AI CLIs (Codex first) and normalizes their output into `RuntimeEvent`s.
//! No Tauri dependency; fully testable with `cargo test -p silent-runtime`.

pub mod codex;
pub mod error;
pub mod redaction;
pub mod spawn;

pub use codex::events::RuntimeEvent;
pub use error::RuntimeError;
