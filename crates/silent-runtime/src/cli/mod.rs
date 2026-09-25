//! One adapter per AI coding CLI. Each adapter knows how to build argv for a `CliRunRequest`
//! and how to normalize one output line into `RuntimeEvent`s. Unknown output never panics:
//! every adapter falls back to the generic JSONL parser, which in turn falls back to `Stdout`.

pub mod amp;
pub mod antigravity;
pub mod claude;
pub mod codex;
pub mod copilot;
pub mod cursor;
pub mod gemini;
pub mod generic;
pub mod grok;
pub mod kimi;
pub mod opencode;
pub mod registry;

use std::collections::HashMap;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::events::RuntimeEvent;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Codex,
    Claude,
    Kimi,
    Grok,
    Gemini,
    Qwen,
    Opencode,
    Copilot,
    Cursor,
    Amp,
    Antigravity,
}

impl ProviderId {
    pub const ALL: [ProviderId; 11] = [
        ProviderId::Codex,
        ProviderId::Claude,
        ProviderId::Kimi,
        ProviderId::Grok,
        ProviderId::Gemini,
        ProviderId::Qwen,
        ProviderId::Opencode,
        ProviderId::Copilot,
        ProviderId::Cursor,
        ProviderId::Amp,
        ProviderId::Antigravity,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            ProviderId::Codex => "codex",
            ProviderId::Claude => "claude",
            ProviderId::Kimi => "kimi",
            ProviderId::Grok => "grok",
            ProviderId::Gemini => "gemini",
            ProviderId::Qwen => "qwen",
            ProviderId::Opencode => "opencode",
            ProviderId::Copilot => "copilot",
            ProviderId::Cursor => "cursor",
            ProviderId::Amp => "amp",
            ProviderId::Antigravity => "antigravity",
        }
    }
}

impl FromStr for ProviderId {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        ProviderId::ALL
            .iter()
            .copied()
            .find(|p| p.as_str() == s.trim().to_ascii_lowercase())
            .ok_or_else(|| format!("unknown provider id: {s}"))
    }
}

impl std::fmt::Display for ProviderId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Sandbox is capped at `workspace-write` at the type level; `danger-full-access` cannot be expressed.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxMode {
    #[default]
    ReadOnly,
    WorkspaceWrite,
}

impl SandboxMode {
    pub fn as_flag(self) -> &'static str {
        match self {
            SandboxMode::ReadOnly => "read-only",
            SandboxMode::WorkspaceWrite => "workspace-write",
        }
    }
}

/// Mirrors `CliRunRequest` in `src/domain/runtime.ts`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CliRunRequest {
    pub run_id: String,
    pub provider_id: ProviderId,
    #[serde(default)]
    pub model_id: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub sandbox: SandboxMode,
    /// Outbound network inside the workspace-write sandbox (Codex: `sandbox_workspace_write.network_access`).
    #[serde(default)]
    pub network: bool,
    #[serde(default)]
    pub resume_session_id: Option<String>,
    #[serde(default)]
    pub ephemeral: bool,
    #[serde(default)]
    pub review: Option<bool>,
    #[serde(default)]
    pub effort: Option<String>,
    /// Wall-clock limit for this run; the host clamps and applies it (default 40 min).
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    /// JSON Schema the final answer must match. Codex gets `--output-schema <file>`, Claude
    /// `--json-schema <json>`; other CLIs get the schema prepended to the prompt.
    #[serde(default)]
    pub output_schema: Option<serde_json::Value>,
}

impl CliRunRequest {
    pub fn model(&self) -> Option<&str> {
        self.model_id.as_deref().filter(|m| !m.trim().is_empty())
    }
    pub fn cwd(&self) -> Option<&str> {
        self.cwd.as_deref().filter(|c| !c.trim().is_empty())
    }
    pub fn resume(&self) -> Option<&str> {
        self.resume_session_id
            .as_deref()
            .filter(|s| !s.trim().is_empty())
    }
    pub fn is_review(&self) -> bool {
        self.review.unwrap_or(false)
    }
    pub fn read_only(&self) -> bool {
        self.sandbox == SandboxMode::ReadOnly
    }
    pub fn effort(&self) -> Option<&str> {
        self.effort.as_deref().filter(|e| !e.trim().is_empty())
    }
    pub fn schema(&self) -> Option<&serde_json::Value> {
        self.output_schema.as_ref().filter(|v| v.is_object())
    }

    /// Where the Codex `--output-schema` file for this run lives (deterministic per run id).
    pub fn schema_file_path(&self) -> std::path::PathBuf {
        let safe: String = self
            .run_id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        std::env::temp_dir().join(format!("silent-schema-{safe}.json"))
    }

    /// Prompt prefix for CLIs without native structured output.
    fn schema_prefix(&self) -> Option<String> {
        self.schema().map(|s| {
            format!(
                "Answer ONLY with a JSON object matching this schema:\n{}\n",
                serde_json::to_string(s).unwrap_or_default()
            )
        })
    }

    /// Prompt with the soft guardrails a CLI cannot enforce natively (read-only, review) and,
    /// for CLIs without a native schema flag, the output-schema instruction.
    pub fn prompt_with_brief(&self, has_read_only_flag: bool) -> String {
        self.prompt_with_brief_schema(has_read_only_flag, false)
    }

    /// Same as `prompt_with_brief`; `native_schema` = the adapter passes the schema as a flag.
    pub fn prompt_with_brief_schema(
        &self,
        has_read_only_flag: bool,
        native_schema: bool,
    ) -> String {
        let mut out = String::new();
        if !native_schema {
            if let Some(prefix) = self.schema_prefix() {
                out.push_str(&prefix);
            }
        }
        if self.is_review() {
            out.push_str("Review the current changes in this repository. Do not modify files. ");
        }
        if self.read_only() && !has_read_only_flag {
            out.push_str(
                "Read-only task: do not create, modify or delete any files; only read and report. ",
            );
        }
        out.push_str(&self.prompt);
        out
    }
}

/// Per-run scratch shared between lines so tool calls and their results can be matched.
#[derive(Debug, Default)]
pub struct ParseState {
    pub pending_calls: HashMap<String, String>,
    pub session_announced: bool,
    pub saw_text_delta: bool,
    /// A `--json-schema` structured result was already surfaced (avoid emitting it twice).
    pub saw_structured: bool,
    /// Per-step usage was already reported (skip the duplicate total in the final result).
    pub usage_reported: bool,
    pub turn_completed: bool,
    pub last_call: Option<String>,
}

impl ParseState {
    pub fn session(&mut self, id: &str) -> Option<RuntimeEvent> {
        if self.session_announced || id.trim().is_empty() {
            return None;
        }
        self.session_announced = true;
        Some(RuntimeEvent::SessionStarted {
            session_id: id.to_owned(),
        })
    }

    pub fn complete_turn(&mut self) -> Option<RuntimeEvent> {
        if self.turn_completed {
            return None;
        }
        self.turn_completed = true;
        Some(RuntimeEvent::TurnCompleted {})
    }

    pub fn start_call(&mut self, id: Option<&str>, command: String) -> RuntimeEvent {
        if let Some(id) = id {
            self.pending_calls.insert(id.to_owned(), command.clone());
        }
        self.last_call = Some(command.clone());
        RuntimeEvent::CommandStarted { command }
    }

    pub fn take_call(&mut self, id: Option<&str>) -> String {
        if let Some(found) = id.and_then(|id| self.pending_calls.remove(id)) {
            if self.last_call.as_deref() == Some(found.as_str()) {
                self.last_call = None;
            }
            return found;
        }
        self.last_call.take().unwrap_or_else(|| "tool".to_owned())
    }
}

pub trait CliAdapter: Send + Sync {
    fn id(&self) -> ProviderId;
    fn binary(&self) -> &'static str;
    fn alt_binaries(&self) -> &'static [&'static str] {
        &[]
    }
    fn build_args(&self, req: &CliRunRequest) -> Vec<String>;
    fn parse_line(&self, line: &str, state: &mut ParseState) -> Vec<RuntimeEvent>;
    /// Text to write to the child's stdin (adapters that read the prompt from stdin). Default none.
    fn stdin_prompt(&self, _req: &CliRunRequest) -> Option<String> {
        None
    }
    /// Whether the process cwd should be set to `req.cwd` (adapters without a `-C` flag).
    fn uses_process_cwd(&self) -> bool {
        true
    }
}

pub fn adapter_for(id: ProviderId) -> Box<dyn CliAdapter> {
    match id {
        ProviderId::Codex => Box::new(codex::Codex),
        ProviderId::Claude => Box::new(claude::Claude),
        ProviderId::Kimi => Box::new(kimi::Kimi),
        ProviderId::Grok => Box::new(grok::Grok),
        ProviderId::Gemini => Box::new(gemini::Gemini { qwen: false }),
        ProviderId::Qwen => Box::new(gemini::Gemini { qwen: true }),
        ProviderId::Opencode => Box::new(opencode::Opencode),
        ProviderId::Copilot => Box::new(copilot::Copilot),
        ProviderId::Cursor => Box::new(cursor::Cursor),
        ProviderId::Amp => Box::new(amp::Amp),
        ProviderId::Antigravity => Box::new(antigravity::Antigravity),
    }
}

/// Build a boxed line parser bound to an adapter and a fresh `ParseState`.
pub fn line_parser(id: ProviderId) -> crate::spawn::LineParser {
    let adapter = adapter_for(id);
    let mut state = ParseState::default();
    Box::new(move |line: &str| adapter.parse_line(line, &mut state))
}

#[cfg(test)]
pub(crate) fn req(provider: ProviderId) -> CliRunRequest {
    CliRunRequest {
        run_id: "r1".into(),
        provider_id: provider,
        model_id: None,
        prompt: "do the thing".into(),
        cwd: Some("/repo".into()),
        sandbox: SandboxMode::WorkspaceWrite,
        network: false,
        resume_session_id: None,
        ephemeral: false,
        review: None,
        effort: None,
        timeout_secs: None,
        output_schema: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_id_roundtrip() {
        for p in ProviderId::ALL {
            assert_eq!(ProviderId::from_str(p.as_str()).unwrap(), p);
            assert_eq!(
                serde_json::to_value(p).unwrap(),
                serde_json::Value::String(p.as_str().into())
            );
        }
        assert!(ProviderId::from_str("gpt").is_err());
    }

    #[test]
    fn request_deserializes_camel_case_and_rejects_danger_sandbox() {
        let json = r#"{"runId":"r","providerId":"claude","prompt":"p","sandbox":"workspace-write","ephemeral":true,"modelId":"sonnet"}"#;
        let req: CliRunRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.provider_id, ProviderId::Claude);
        assert_eq!(req.model(), Some("sonnet"));
        assert!(req.ephemeral);
        let bad =
            r#"{"runId":"r","providerId":"codex","prompt":"p","sandbox":"danger-full-access"}"#;
        assert!(serde_json::from_str::<CliRunRequest>(bad).is_err());
    }

    #[test]
    fn soft_brief_only_when_flag_missing() {
        let mut r = req(ProviderId::Kimi);
        r.sandbox = SandboxMode::ReadOnly;
        assert!(r.prompt_with_brief(false).starts_with("Read-only task"));
        assert_eq!(r.prompt_with_brief(true), "do the thing");
        r.review = Some(true);
        assert!(r
            .prompt_with_brief(true)
            .starts_with("Review the current changes"));
    }

    #[test]
    fn parse_state_matches_calls() {
        let mut s = ParseState::default();
        assert!(matches!(
            s.session("a"),
            Some(RuntimeEvent::SessionStarted { .. })
        ));
        assert!(s.session("a").is_none());
        s.start_call(Some("t1"), "ls".into());
        assert_eq!(s.take_call(Some("t1")), "ls");
        assert_eq!(s.take_call(Some("missing")), "tool");
        assert!(s.complete_turn().is_some());
        assert!(s.complete_turn().is_none());
    }
}
