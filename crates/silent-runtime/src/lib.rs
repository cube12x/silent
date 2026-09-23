//! silent-runtime: spawns AI coding CLIs (Codex, Claude Code, Kimi, Grok Build, Gemini, Qwen,
//! OpenCode, Copilot, Cursor, Amp) and normalizes their output into `RuntimeEvent`s.
//! No Tauri dependency; fully testable with `cargo test -p silent-runtime`.

pub mod cli;
pub mod error;
pub mod events;
pub mod redaction;
pub mod spawn;

pub use cli::{adapter_for, CliAdapter, CliRunRequest, ParseState, ProviderId, SandboxMode};
pub use error::{RuntimeError, RuntimeResult};
pub use events::{FileChangeKind, RuntimeEvent};
pub use spawn::{run_streaming, LineParser, RunExit, RunHandle, SpawnConfig};
