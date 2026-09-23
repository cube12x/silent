//! Kimi Code (`kimi -p … --output-format stream-json`). Shape from kimi-code's
//! `prompt-render.ts`: `{role:"assistant",content?,tool_calls?}`, `{role:"tool",tool_call_id,content}`,
//! `{role:"meta",type:"session.resume_hint",session_id}`, `{role:"meta",type:"system.version"}`.
//! Only the `system.version` line could be captured live (auth grant expired), so this is doc-based.

use serde_json::Value;

use super::{generic, CliAdapter, CliRunRequest, ParseState, ProviderId};
use crate::events::{compact_call, content_text, str_field, tail, RuntimeEvent, OUTPUT_TAIL_CHARS};

pub struct Kimi;

/// `kimi -p <prompt> --output-format stream-json [-m model] [--session id] [--add-dir cwd]`.
/// Prompt mode runs with auto permissions; read-only is enforced by the brief.
pub fn build_args(req: &CliRunRequest) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        req.prompt_with_brief(false),
        "--output-format".into(),
        "stream-json".into(),
    ];
    if let Some(model) = req.model() {
        args.push("-m".into());
        args.push(model.into());
    }
    if let Some(id) = req.resume() {
        args.push("--session".into());
        args.push(id.into());
    }
    if let Some(cwd) = req.cwd() {
        args.push("--add-dir".into());
        args.push(cwd.into());
    }
    args
}

fn tool_call_command(call: &Value) -> (Option<&str>, String) {
    let id = str_field(call, "id");
    let name = call
        .pointer("/function/name")
        .and_then(Value::as_str)
        .or_else(|| str_field(call, "name"))
        .unwrap_or("tool");
    let args = call
        .pointer("/function/arguments")
        .or_else(|| call.get("arguments"))
        .or_else(|| call.get("input"));
    let parsed;
    let args = match args {
        Some(Value::String(s)) => {
            parsed = serde_json::from_str::<Value>(s).ok();
            parsed.as_ref()
        }
        other => other,
    };
    let command = args
        .and_then(|a| str_field(a, "command"))
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| compact_call(name, args));
    (id, command)
}

pub fn parse_line(line: &str, state: &mut ParseState) -> Vec<RuntimeEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return vec![RuntimeEvent::stdout(trimmed)];
    };
    match str_field(&value, "role") {
        Some("meta") => match str_field(&value, "type") {
            Some("session.resume_hint") => {
                let mut events: Vec<RuntimeEvent> = str_field(&value, "session_id")
                    .and_then(|id| state.session(id))
                    .into_iter()
                    .collect();
                events.extend(state.complete_turn());
                events
            }
            Some("system.version") => Vec::new(),
            _ => {
                if let Some(err) = str_field(&value, "error").or_else(|| {
                    str_field(&value, "type")
                        .filter(|t| t.contains("error"))
                        .and_then(|_| str_field(&value, "content"))
                }) {
                    return vec![RuntimeEvent::Failed {
                        code: "kimi_error".into(),
                        message: err.to_owned(),
                        retryable: false,
                    }];
                }
                Vec::new()
            }
        },
        Some("assistant") => {
            let mut events = Vec::new();
            let text = content_text(value.get("content"));
            if !text.is_empty() {
                events.push(RuntimeEvent::AgentMessage { text });
            }
            if let Some(calls) = value.get("tool_calls").and_then(Value::as_array) {
                for call in calls {
                    let (id, command) = tool_call_command(call);
                    events.push(state.start_call(id, command));
                }
            }
            events
        }
        Some("tool") => {
            let text = content_text(value.get("content"));
            vec![RuntimeEvent::CommandCompleted {
                command: state.take_call(str_field(&value, "tool_call_id")),
                exit_code: Some(0),
                output_tail: tail(&text, OUTPUT_TAIL_CHARS),
            }]
        }
        Some("user") => Vec::new(),
        _ => generic::parse_generic(trimmed, state),
    }
}

impl CliAdapter for Kimi {
    fn id(&self) -> ProviderId {
        ProviderId::Kimi
    }
    fn binary(&self) -> &'static str {
        "kimi"
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
    fn args_write_and_read_only() {
        assert_eq!(
            build_args(&req(ProviderId::Kimi)),
            [
                "-p",
                "do the thing",
                "--output-format",
                "stream-json",
                "--add-dir",
                "/repo"
            ]
        );
        let r = CliRunRequest {
            sandbox: SandboxMode::ReadOnly,
            model_id: Some("kimi-code/k3".into()),
            resume_session_id: Some("s1".into()),
            cwd: None,
            ..req(ProviderId::Kimi)
        };
        assert_eq!(
            build_args(&r),
            [
                "-p",
                "Read-only task: do not modify any files. do the thing",
                "--output-format",
                "stream-json",
                "-m",
                "kimi-code/k3",
                "--session",
                "s1"
            ]
        );
    }

    #[test]
    fn parses_documented_shapes() {
        let mut s = ParseState::default();
        assert!(parse_line(
            r#"{"role":"meta","type":"system.version","version":"0.34.0"}"#,
            &mut s
        )
        .is_empty());
        let ev = parse_line(
            r#"{"role":"assistant","content":"Let me look.","tool_calls":[{"id":"c1","type":"function","function":{"name":"shell","arguments":"{\"command\":\"ls\"}"}}]}"#,
            &mut s,
        );
        assert_eq!(
            ev,
            vec![
                RuntimeEvent::AgentMessage {
                    text: "Let me look.".into()
                },
                RuntimeEvent::CommandStarted {
                    command: "ls".into()
                }
            ]
        );
        let ev = parse_line(
            r#"{"role":"tool","tool_call_id":"c1","content":"README.md"}"#,
            &mut s,
        );
        assert_eq!(
            ev,
            vec![RuntimeEvent::CommandCompleted {
                command: "ls".into(),
                exit_code: Some(0),
                output_tail: "README.md".into()
            }]
        );
        let ev = parse_line(r#"{"role":"assistant","content":"OK"}"#, &mut s);
        assert_eq!(ev, vec![RuntimeEvent::AgentMessage { text: "OK".into() }]);
        let ev = parse_line(
            r#"{"role":"meta","type":"session.resume_hint","session_id":"abc","command":"kimi -r abc","content":"To resume"}"#,
            &mut s,
        );
        assert_eq!(
            ev,
            vec![
                RuntimeEvent::SessionStarted {
                    session_id: "abc".into()
                },
                RuntimeEvent::TurnCompleted {}
            ]
        );
    }
}
