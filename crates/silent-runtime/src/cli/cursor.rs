//! Cursor Agent (`agent -p --output-format stream-json`). Doc-based; NDJSON similar to Claude Code:
//! `system{session_id}`, `assistant{message.content[]}`, `tool_call{subtype:started|completed}`, `result`.

use serde_json::Value;

use super::{generic, CliAdapter, CliRunRequest, ParseState, ProviderId};
use crate::events::{compact_call, content_text, str_field, tail, RuntimeEvent, OUTPUT_TAIL_CHARS};

pub struct Cursor;

/// `agent -p --output-format stream-json [--model m] [--resume id] [--force] <prompt>`.
pub fn build_args(req: &CliRunRequest) -> Vec<String> {
    let mut args: Vec<String> = vec!["-p".into(), "--output-format".into(), "stream-json".into()];
    if let Some(model) = req.model() {
        args.push("--model".into());
        args.push(model.into());
    }
    if let Some(id) = req.resume() {
        args.push("--resume".into());
        args.push(id.into());
    }
    if !req.read_only() {
        args.push("--force".into());
    }
    args.push(req.prompt_with_brief(false));
    args
}

pub fn parse_line(line: &str, state: &mut ParseState) -> Vec<RuntimeEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return vec![RuntimeEvent::stdout(trimmed)];
    };
    match str_field(&value, "type") {
        Some("system") => str_field(&value, "session_id")
            .and_then(|id| state.session(id))
            .into_iter()
            .chain(std::iter::once(RuntimeEvent::TurnStarted {}))
            .collect(),
        Some("assistant") => {
            let text = content_text(value.pointer("/message/content"));
            if text.is_empty() {
                Vec::new()
            } else {
                vec![RuntimeEvent::AgentMessage { text }]
            }
        }
        Some("user") => Vec::new(),
        Some("tool_call") => {
            let call = value.get("tool_call");
            let id = str_field(&value, "call_id");
            match str_field(&value, "subtype") {
                Some("completed") => {
                    let output = call
                        .and_then(|c| c.get("result").or_else(|| c.get("output")))
                        .map(|o| match o {
                            Value::String(s) => s.clone(),
                            other => content_text(Some(other)).max(other.to_string()),
                        })
                        .unwrap_or_default();
                    vec![RuntimeEvent::CommandCompleted {
                        command: state.take_call(id),
                        exit_code: Some(0),
                        output_tail: tail(&output, OUTPUT_TAIL_CHARS),
                    }]
                }
                _ => {
                    let name = call
                        .and_then(|c| {
                            str_field(c, "name").or_else(|| {
                                c.as_object()
                                    .and_then(|o| o.keys().next().map(String::as_str))
                            })
                        })
                        .unwrap_or("tool");
                    let args = call.and_then(|c| c.get("args").or_else(|| c.get(name)));
                    let command = args
                        .and_then(|a| str_field(a, "command"))
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| compact_call(name, args));
                    vec![state.start_call(id, command)]
                }
            }
        }
        Some("result") => {
            let mut events = Vec::new();
            if let Some(id) = str_field(&value, "session_id") {
                events.extend(state.session(id));
            }
            if value.get("is_error").and_then(Value::as_bool) == Some(true) {
                events.push(RuntimeEvent::Failed {
                    code: "cursor_error".into(),
                    message: str_field(&value, "result")
                        .unwrap_or("Cursor Agent failed")
                        .into(),
                    retryable: false,
                });
            }
            events.extend(state.complete_turn());
            events
        }
        _ => generic::parse_generic(trimmed, state),
    }
}

impl CliAdapter for Cursor {
    fn id(&self) -> ProviderId {
        ProviderId::Cursor
    }
    fn binary(&self) -> &'static str {
        "agent"
    }
    fn alt_binaries(&self) -> &'static [&'static str] {
        &["cursor-agent"]
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
    fn args() {
        assert_eq!(
            build_args(&req(ProviderId::Cursor)),
            [
                "-p",
                "--output-format",
                "stream-json",
                "--force",
                "do the thing"
            ]
        );
        let r = CliRunRequest {
            sandbox: SandboxMode::ReadOnly,
            model_id: Some("gpt-5".into()),
            resume_session_id: Some("s".into()),
            ..req(ProviderId::Cursor)
        };
        assert_eq!(
            build_args(&r),
            [
                "-p",
                "--output-format",
                "stream-json",
                "--model",
                "gpt-5",
                "--resume",
                "s",
                "Read-only task: do not modify any files. do the thing"
            ]
        );
    }

    #[test]
    fn parses_claude_like_ndjson() {
        let mut s = ParseState::default();
        assert_eq!(
            parse_line(
                r#"{"type":"system","subtype":"init","session_id":"c1","model":"x"}"#,
                &mut s
            ),
            vec![
                RuntimeEvent::SessionStarted {
                    session_id: "c1".into()
                },
                RuntimeEvent::TurnStarted {}
            ]
        );
        assert_eq!(parse_line(r#"{"type":"tool_call","subtype":"started","call_id":"k","tool_call":{"shellToolCall":{"args":{"command":"ls"}}}}"#, &mut s).len(), 1);
        assert!(matches!(
            &parse_line(
                r#"{"type":"tool_call","subtype":"completed","call_id":"k","tool_call":{"result":"ok"}}"#,
                &mut s
            )[0],
            RuntimeEvent::CommandCompleted { .. }
        ));
        assert_eq!(
            parse_line(
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"OK"}]}}"#,
                &mut s
            ),
            vec![RuntimeEvent::AgentMessage { text: "OK".into() }]
        );
        assert_eq!(
            parse_line(
                r#"{"type":"result","duration_ms":10,"result":"OK"}"#,
                &mut s
            ),
            vec![RuntimeEvent::TurnCompleted {}]
        );
    }
}
