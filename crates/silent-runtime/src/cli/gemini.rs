//! Gemini CLI and its fork Qwen Code (`gemini|qwen -p … --output-format stream-json`).
//! Doc-based (headless.md): events `init, message, tool_use, tool_result, error, result`.

use serde_json::Value;

use super::{generic, CliAdapter, CliRunRequest, ParseState, ProviderId};
use crate::events::{
    classify_error, compact_call, content_text, str_field, tail, u64_at, RuntimeEvent,
    OUTPUT_TAIL_CHARS,
};

pub struct Gemini {
    pub qwen: bool,
}

/// `<bin> -p <prompt> --output-format stream-json [--model m] [--resume id] --approval-mode auto_edit`
/// (read-only: `--approval-mode default` plus the read-only brief; the CLI still cannot prompt, so
/// any tool needing approval is denied).
pub fn build_args(req: &CliRunRequest) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        req.prompt_with_brief(false),
        "--output-format".into(),
        "stream-json".into(),
    ];
    if let Some(model) = req.model() {
        args.push("--model".into());
        args.push(model.into());
    }
    if let Some(id) = req.resume() {
        args.push("--resume".into());
        args.push(id.into());
    }
    args.push("--approval-mode".into());
    args.push(
        if req.read_only() {
            "default"
        } else {
            "auto_edit"
        }
        .into(),
    );
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
        Some("init") => {
            let mut events: Vec<RuntimeEvent> = str_field(&value, "session_id")
                .and_then(|id| state.session(id))
                .into_iter()
                .collect();
            events.push(RuntimeEvent::TurnStarted {});
            events
        }
        Some("message") => {
            if str_field(&value, "role") == Some("user") {
                return Vec::new();
            }
            let text = content_text(value.get("content"));
            if text.is_empty() {
                return Vec::new();
            }
            if value.get("delta").and_then(Value::as_bool) == Some(true) {
                state.saw_text_delta = true;
                vec![RuntimeEvent::TextDelta { text }]
            } else {
                vec![RuntimeEvent::AgentMessage { text }]
            }
        }
        Some("tool_use") => {
            let name = str_field(&value, "tool_name").unwrap_or("tool");
            let params = value.get("parameters");
            let command = params
                .and_then(|p| str_field(p, "command"))
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| compact_call(name, params));
            vec![state.start_call(str_field(&value, "tool_id"), command)]
        }
        Some("tool_result") => {
            let text = value
                .get("output")
                .map(|o| match o {
                    Value::String(s) => s.clone(),
                    other => content_text(Some(other)),
                })
                .unwrap_or_default();
            let failed = str_field(&value, "status").is_some_and(|s| s == "error");
            vec![RuntimeEvent::CommandCompleted {
                command: state.take_call(str_field(&value, "tool_id")),
                exit_code: Some(if failed { 1 } else { 0 }),
                output_tail: tail(&text, OUTPUT_TAIL_CHARS),
            }]
        }
        Some("error") => {
            let message = str_field(&value, "message").unwrap_or("error").to_owned();
            if str_field(&value, "severity") == Some("warning") {
                vec![RuntimeEvent::Stderr { line: message }]
            } else {
                let (code, retryable) = classify_error(&message, "gemini_error");
                vec![RuntimeEvent::Failed {
                    code,
                    message,
                    retryable,
                }]
            }
        }
        Some("result") => {
            let mut events = Vec::new();
            if let Some(stats) = value.get("stats") {
                let mut input = u64_at(stats, "/input_tokens");
                let mut output = u64_at(stats, "/output_tokens");
                let mut cached = u64_at(stats, "/cached_tokens").max(u64_at(stats, "/cached"));
                if input + output == 0 {
                    if let Some(models) = stats.get("models").and_then(Value::as_object) {
                        for m in models.values() {
                            input += u64_at(m, "/tokens/prompt").max(u64_at(m, "/input_tokens"));
                            output +=
                                u64_at(m, "/tokens/candidates").max(u64_at(m, "/output_tokens"));
                            cached += u64_at(m, "/tokens/cached");
                        }
                    }
                }
                if input + output > 0 {
                    events.push(RuntimeEvent::usage(input, cached, output));
                }
            }
            if str_field(&value, "status") == Some("error") {
                let message = value
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("Gemini CLI reported an error")
                    .to_owned();
                let (code, retryable) = classify_error(&message, "gemini_error");
                events.push(RuntimeEvent::Failed {
                    code,
                    message,
                    retryable,
                });
            }
            events.extend(state.complete_turn());
            events
        }
        _ => generic::parse_generic(trimmed, state),
    }
}

impl CliAdapter for Gemini {
    fn id(&self) -> ProviderId {
        if self.qwen {
            ProviderId::Qwen
        } else {
            ProviderId::Gemini
        }
    }
    fn binary(&self) -> &'static str {
        if self.qwen {
            "qwen"
        } else {
            "gemini"
        }
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
            build_args(&req(ProviderId::Gemini)),
            [
                "-p",
                "do the thing",
                "--output-format",
                "stream-json",
                "--approval-mode",
                "auto_edit"
            ]
        );
        let r = CliRunRequest {
            sandbox: SandboxMode::ReadOnly,
            model_id: Some("gemini-2.5-pro".into()),
            resume_session_id: Some("s".into()),
            ..req(ProviderId::Qwen)
        };
        assert_eq!(
            build_args(&r),
            [
                "-p",
                "Read-only task: do not create, modify or delete any files; only read and report. do the thing",
                "--output-format",
                "stream-json",
                "--model",
                "gemini-2.5-pro",
                "--resume",
                "s",
                "--approval-mode",
                "default"
            ]
        );
        assert_eq!(Gemini { qwen: true }.binary(), "qwen");
    }

    #[test]
    fn parses_documented_events() {
        let mut s = ParseState::default();
        assert_eq!(
            parse_line(
                r#"{"type":"init","session_id":"g1","model":"gemini-2.5-pro"}"#,
                &mut s
            ),
            vec![
                RuntimeEvent::SessionStarted {
                    session_id: "g1".into()
                },
                RuntimeEvent::TurnStarted {}
            ]
        );
        assert_eq!(
            parse_line(
                r#"{"type":"tool_use","tool_id":"t1","tool_name":"run_shell_command","parameters":{"command":"ls"}}"#,
                &mut s
            ),
            vec![RuntimeEvent::CommandStarted {
                command: "ls".into()
            }]
        );
        assert_eq!(
            parse_line(
                r#"{"type":"tool_result","tool_id":"t1","status":"success","output":"a"}"#,
                &mut s
            ),
            vec![RuntimeEvent::CommandCompleted {
                command: "ls".into(),
                exit_code: Some(0),
                output_tail: "a".into()
            }]
        );
        assert_eq!(
            parse_line(
                r#"{"type":"message","role":"assistant","content":"OK","delta":true}"#,
                &mut s
            ),
            vec![RuntimeEvent::TextDelta { text: "OK".into() }]
        );
        assert_eq!(
            parse_line(
                r#"{"type":"error","severity":"warning","message":"slow"}"#,
                &mut s
            ),
            vec![RuntimeEvent::Stderr {
                line: "slow".into()
            }]
        );
        let ev = parse_line(
            r#"{"type":"result","status":"success","stats":{"input_tokens":5,"output_tokens":2}}"#,
            &mut s,
        );
        assert_eq!(
            ev,
            vec![RuntimeEvent::usage(5, 0, 2), RuntimeEvent::TurnCompleted {}]
        );
    }
}
