//! silent-runtime: spawns AI CLIs (Codex first) and normalizes their output into `RuntimeEvent`s.
//! No Tauri dependency; fully testable with `cargo test -p silent-runtime`.

pub mod codex;
pub mod error;
pub mod redaction;
pub mod spawn;

pub use codex::args::{build_args, CodexRunRequest, SandboxMode};
pub use codex::events::{parse_jsonl_line, FileChangeKind, RuntimeEvent};
pub use error::{RuntimeError, RuntimeResult};
pub use spawn::{run_streaming, RunExit, RunHandle, SpawnConfig};
