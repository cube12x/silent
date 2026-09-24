//! Claude Code (`claude -p … --output-format stream-json`). Parser pinned to
//! `tests/fixtures/claude-print-real.jsonl` (Claude Code 2.1.280).

use serde_json::Value;

use super::{generic, CliAdapter, CliRunRequest, ParseState, ProviderId};
use crate::events::{
    classify_error, compact_call, content_text, str_field, tail, u64_at, FileChangeKind,
    RuntimeEvent, OUTPUT_TAIL_CHARS,
};

pub struct Claude;

/// `claude -p <prompt> --output-format stream-json --verbose --include-partial-messages
/// --permission-prompts none --permission-mode acceptEdits [--model m] [--effort e]
/// [--resume id] [--add-dir cwd] [--no-session-persistence]`. Process cwd = req.cwd.
/// Read-only is enforced by a prompt brief, never by `--permission-mode plan`: plan mode
/// kept Claude reading the repository for the whole 30-minute budget in real runs.
pub fn build_args(req: &CliRunRequest) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        req.prompt_with_brief_schema(false, true),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
        // Isolate the worker from the user's interactive setup: no hooks/plugins/LSP/auto-memory/CLAUDE.md
        // discovery (`--bare`) and no user MCP servers (`--strict-mcp-config`). They slowed every worker
        // start by minutes and burned quota (observer sessions, tool-heavy context).
        "--bare".into(),
        "--strict-mcp-config".into(),
        "--permission-prompts".into(),
        "none".into(),
        "--permission-mode".into(),
        "acceptEdits".into(),
    ];
    if let Some(model) = req.model() {
        args.push("--model".into());
        args.push(model.into());
    }
    if let Some(effort) = req.effort() {
        args.push("--effort".into());
        args.push(effort.into());
    }
    if let Some(schema) = req.schema() {
        args.push("--json-schema".into());
        args.push(serde_json::to_string(schema).unwrap_or_else(|_| "{}".into()));
    }
    if let Some(id) = req.resume() {
        args.push("--resume".into());
        args.push(id.into());
    }
    if let Some(cwd) = req.cwd() {
        args.push("--add-dir".into());
        args.push(cwd.into());
    }
    if req.ephemeral && req.resume().is_none() {
        args.push("--no-session-persistence".into());
    }
    args
}

fn tool_use_events(block: &Value, state: &mut ParseState) -> Vec<RuntimeEvent> {
    let name = str_field(block, "name").unwrap_or("tool");
    let id = str_field(block, "id");
    let input = block.get("input");
    let path = input
        .and_then(|i| str_field(i, "file_path").or_else(|| str_field(i, "notebook_path")))
        .map(ToOwned::to_owned);
    match name {
        "Bash" => {
            let cmd = input
                .and_then(|i| str_field(i, "command"))
                .unwrap_or("bash")
                .to_owned();
            vec![state.start_call(id, cmd)]
        }
        "Edit" | "MultiEdit" | "NotebookEdit" | "Write" => {
            let p = path.unwrap_or_else(|| "?".into());
            let kind = if name == "Write" {
                FileChangeKind::Add
            } else {
                FileChangeKind::Update
            };
            let label = format!("{} {p}", name.to_ascii_lowercase());
            vec![
                state.start_call(id, label),
                RuntimeEvent::FileChanged { path: p, kind },
            ]
        }
        "Read" => vec![state.start_call(id, format!("read {}", path.unwrap_or_default()))],
        "Glob" | "Grep" => {
            let pattern = input.and_then(|i| str_field(i, "pattern")).unwrap_or("");
            vec![state.start_call(id, format!("{} {pattern}", name.to_ascii_lowercase()))]
        }
        "WebFetch" | "WebSearch" => {
            let target = input
                .and_then(|i| str_field(i, "url").or_else(|| str_field(i, "query")))
                .unwrap_or("");
            vec![state.start_call(id, format!("{} {target}", name.to_ascii_lowercase()))]
        }
        "Task" | "Agent" => {
            let desc = input
                .and_then(|i| str_field(i, "description"))
                .unwrap_or("subagent");
            vec![state.start_call(id, format!("task {desc}"))]
        }
        other => vec![state.start_call(id, compact_call(other, input))],
    }
}

pub fn parse_line(line: &str, state: &mut ParseState) -> Vec<RuntimeEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return vec![RuntimeEvent::stdout(trimmed)];
    };
    let Some(kind) = str_field(&value, "type") else {
        return generic::parse_generic(trimmed, state);
    };
    match kind {
        "system" => match str_field(&value, "subtype") {
            Some("init") => str_field(&value, "session_id")
                .and_then(|id| state.session(id))
                .into_iter()
                .chain(std::iter::once(RuntimeEvent::TurnStarted {}))
                .collect(),
            // hook_started / hook_response / status / compact_boundary: internal noise.
            _ => Vec::new(),
        },
        "stream_event" => {
            let event = value.get("event");
            match event.and_then(|e| str_field(e, "type")) {
                Some("content_block_delta") => {
                    let delta = event.and_then(|e| e.get("delta"));
                    match delta.and_then(|d| str_field(d, "type")) {
                        Some("text_delta") => delta
                            .and_then(|d| str_field(d, "text"))
                            .map(|text| {
                                state.saw_text_delta = true;
                                vec![RuntimeEvent::TextDelta {
                                    text: text.to_owned(),
                                }]
                            })
                            .unwrap_or_default(),
                        Some("thinking_delta") => Vec::new(),
                        _ => Vec::new(),
                    }
                }
                Some("content_block_start") => {
                    let block = event.and_then(|e| e.get("content_block"));
                    match block.and_then(|b| str_field(b, "type")) {
                        Some("thinking") => vec![RuntimeEvent::ReasoningStatus {
                            status: "Claude is thinking".into(),
                        }],
                        _ => Vec::new(),
                    }
                }
                _ => Vec::new(),
            }
        }
        "assistant" => {
            let mut events = Vec::new();
            let blocks = value
                .pointer("/message/content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for block in &blocks {
                match str_field(block, "type") {
                    Some("text") => {
                        if let Some(text) = str_field(block, "text") {
                            if !text.is_empty() {
                                events.push(RuntimeEvent::AgentMessage {
                                    text: text.to_owned(),
                                });
                            }
                        }
                    }
                    Some("tool_use") => events.extend(tool_use_events(block, state)),
                    _ => {}
                }
            }
            events
        }
        "user" => {
            let mut events = Vec::new();
            let blocks = value
                .pointer("/message/content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for block in &blocks {
                if str_field(block, "type") == Some("tool_result") {
                    let is_error = block
                        .get("is_error")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let text = content_text(block.get("content"));
                    events.push(RuntimeEvent::CommandCompleted {
                        command: state.take_call(str_field(block, "tool_use_id")),
                        exit_code: Some(if is_error { 1 } else { 0 }),
                        output_tail: tail(&text, OUTPUT_TAIL_CHARS),
                    });
                }
            }
            events
        }
        "result" => {
            let mut events = Vec::new();
            if let Some(id) = str_field(&value, "session_id") {
                events.extend(state.session(id));
            }
            if let Some(usage) = value.get("usage") {
                events.push(RuntimeEvent::usage(
                    u64_at(usage, "/input_tokens") + u64_at(usage, "/cache_creation_input_tokens"),
                    u64_at(usage, "/cache_read_input_tokens"),
                    u64_at(usage, "/output_tokens"),
                ));
            }
            if let Some(usd) = value.get("total_cost_usd").and_then(Value::as_f64) {
                events.push(RuntimeEvent::Cost { usd });
            }
            let is_error = value
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || str_field(&value, "subtype").is_some_and(|s| s.starts_with("error"));
            if is_error {
                let message = str_field(&value, "result")
                    .map(ToOwned::to_owned)
                    .or_else(|| {
                        value.get("errors").and_then(Value::as_array).map(|e| {
                            e.iter()
                                .filter_map(Value::as_str)
                                .collect::<Vec<_>>()
                                .join("; ")
                        })
                    })
                    .filter(|m| !m.is_empty())
                    .unwrap_or_else(|| {
                        format!(
                            "Claude Code ended with {}",
                            str_field(&value, "subtype").unwrap_or("error")
                        )
                    });
                let (code, retryable) = classify_error(&message, "claude_error");
                events.push(RuntimeEvent::Failed {
                    code,
                    message,
                    retryable,
                });
            }
            events.extend(state.complete_turn());
            events
        }
        "rate_limit_event" => Vec::new(),
        _ => generic::parse_generic(trimmed, state),
    }
}

impl CliAdapter for Claude {
    fn id(&self) -> ProviderId {
        ProviderId::Claude
    }
    fn binary(&self) -> &'static str {
        "claude"
    }
    fn build_args(&self, req: &CliRunRequest) -> Vec<String> {
        build_args(req)
    }
    fn parse_line(&self, line: &str, state: &mut ParseState) -> Vec<RuntimeEvent> {
        parse_line(line, state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::{req, SandboxMode};

    #[test]
    fn write_turn_args() {
        assert_eq!(
            build_args(&req(ProviderId::Claude)),
            [
                "-p",
                "do the thing",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--bare",
                "--strict-mcp-config",
                "--permission-prompts",
                "none",
                "--permission-mode",
                "acceptEdits",
                "--add-dir",
                "/repo"
            ]
        );
    }

    #[test]
    fn read_only_resume_model_effort_ephemeral() {
        let r = CliRunRequest {
            sandbox: SandboxMode::ReadOnly,
            model_id: Some("opus".into()),
            effort: Some("high".into()),
            resume_session_id: Some("s1".into()),
            ephemeral: true,
            cwd: None,
            ..req(ProviderId::Claude)
        };
        assert_eq!(
            build_args(&r),
            [
                "-p",
                "Read-only task: do not create, modify or delete any files; only read and report. do the thing",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--bare",
                "--strict-mcp-config",
                "--permission-prompts",
                "none",
                "--permission-mode",
                "acceptEdits",
                "--model",
                "opus",
                "--effort",
                "high",
                "--resume",
                "s1"
            ]
        );
        // Resuming never disables session persistence, and plan mode is never used.
        assert!(!build_args(&r)
            .iter()
            .any(|a| a == "--no-session-persistence" || a == "plan"));
        let r = CliRunRequest {
            ephemeral: true,
            review: Some(true),
            cwd: None,
            ..req(ProviderId::Claude)
        };
        let args = build_args(&r);
        assert!(args[1].starts_with("Review the current changes"));
        assert_eq!(
            args.last().map(String::as_str),
            Some("--no-session-persistence")
        );
    }

    #[test]
    fn parses_tool_lifecycle() {
        let mut s = ParseState::default();
        let ev = parse_line(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls -la"}},{"type":"tool_use","id":"t2","name":"Write","input":{"file_path":"a.rs","content":"x"}}]}}"#,
            &mut s,
        );
        assert_eq!(
            ev[0],
            RuntimeEvent::CommandStarted {
                command: "ls -la".into()
            }
        );
        assert_eq!(
            ev[1],
            RuntimeEvent::CommandStarted {
                command: "write a.rs".into()
            }
        );
        assert_eq!(
            ev[2],
            RuntimeEvent::FileChanged {
                path: "a.rs".into(),
                kind: FileChangeKind::Add
            }
        );
        let ev = parse_line(
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"file1\nfile2","is_error":false}]}}"#,
            &mut s,
        );
        assert_eq!(
            ev,
            vec![RuntimeEvent::CommandCompleted {
                command: "ls -la".into(),
                exit_code: Some(0),
                output_tail: "file1\nfile2".into()
            }]
        );
        let ev = parse_line(
            r#"{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["boom"],"session_id":"s9"}"#,
            &mut s,
        );
        assert!(
            matches!(&ev[0], RuntimeEvent::SessionStarted { session_id } if session_id == "s9")
        );
        assert!(matches!(&ev[1], RuntimeEvent::Failed { message, .. } if message == "boom"));
        assert_eq!(ev.last(), Some(&RuntimeEvent::TurnCompleted {}));
    }
}

#[cfg(test)]
mod schema_tests {
    use super::*;
    use crate::cli::req;
    use serde_json::json;

    #[test]
    fn json_schema_flag_carries_the_serialised_schema_and_prompt_stays_clean() {
        let mut r = req(crate::cli::ProviderId::Claude);
        let schema =
            json!({"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]});
        r.output_schema = Some(schema.clone());
        let args = build_args(&r);
        let i = args.iter().position(|a| a == "--json-schema").unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&args[i + 1]).unwrap(),
            schema
        );
        assert_eq!(
            args[1], "do the thing",
            "native schema must not be prepended to the prompt"
        );
        assert!(!build_args(&req(crate::cli::ProviderId::Claude))
            .iter()
            .any(|a| a == "--json-schema"));
    }
}
