//! Antigravity CLI (`agy`, Google). Successor of Gemini CLI for individual accounts (Gemini CLI stopped
//! serving individual/AI Pro/Ultra tiers on 2026-06-18). Headless: `agy -p <prompt> --output-format
//! stream-json`; one JSON object per line with an `event` field. Observed (unauthenticated) shape:
//! `{"event":"result","result":{"conversation_id":"…","status":"ERROR|…","response":"…","error":"…",
//! "duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,
//! "cache_read_tokens":0,"total_tokens":0}}}`. Other events fall through to the generic parser.

use serde_json::Value;

use super::{generic, CliAdapter, CliRunRequest, ParseState, ProviderId, SandboxMode};
use crate::events::{str_field, u64_at, RuntimeEvent};

pub struct Antigravity;

/// `agy -p <prompt> --output-format stream-json --dangerously-skip-permissions --mode accept-edits
/// [--model m] [--effort e] [--conversation id] [--add-dir cwd] [--json-schema s]`
pub fn build_args(req: &CliRunRequest) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        req.prompt_with_brief_schema(false, true),
        "--output-format".into(),
        "stream-json".into(),
    ];
    if req.sandbox == SandboxMode::WorkspaceWrite {
        args.push("--dangerously-skip-permissions".into());
        args.push("--mode".into());
        args.push("accept-edits".into());
    }
    if let Some(model) = req.model() {
        args.push("--model".into());
        args.push(model.into());
    }
    if let Some(effort) = req.effort() {
        // agy accepts low|medium|high|max.
        args.push("--effort".into());
        args.push(if effort == "xhigh" {
            "max".into()
        } else {
            effort.into()
        });
    }
    if let Some(id) = req.resume() {
        args.push("--conversation".into());
        args.push(id.into());
    }
    if let Some(cwd) = req.cwd() {
        args.push("--add-dir".into());
        args.push(cwd.into());
    }
    if let Some(schema) = req.schema() {
        args.push("--json-schema".into());
        args.push(serde_json::to_string(schema).unwrap_or_else(|_| "{}".into()));
    }
    args
}

pub fn parse_line(line: &str, state: &mut ParseState) -> Vec<RuntimeEvent> {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return generic::parse_generic(line, state);
    };
    match str_field(&value, "event") {
        Some("result") => {
            let mut events = Vec::new();
            let r = value.get("result").cloned().unwrap_or(Value::Null);
            if let Some(id) = str_field(&r, "conversation_id").filter(|s| !s.is_empty()) {
                events.extend(state.session(id));
            }
            if let Some(usage) = r.get("usage") {
                events.push(RuntimeEvent::usage(
                    u64_at(usage, "/input_tokens"),
                    u64_at(usage, "/cache_read_tokens"),
                    u64_at(usage, "/output_tokens") + u64_at(usage, "/thinking_tokens"),
                ));
            }
            let status = str_field(&r, "status").unwrap_or("");
            let error = str_field(&r, "error").unwrap_or("");
            if status.eq_ignore_ascii_case("error") || !error.is_empty() {
                events.push(RuntimeEvent::Failed {
                    code: "cli_error".into(),
                    message: if error.is_empty() {
                        format!("agy result status {status}")
                    } else {
                        error.to_owned()
                    },
                    retryable: false,
                });
            } else if let Some(text) = str_field(&r, "response").filter(|t| !t.is_empty()) {
                events.push(RuntimeEvent::AgentMessage {
                    text: text.to_owned(),
                });
            }
            events.push(RuntimeEvent::TurnCompleted {});
            events
        }
        Some("text") | Some("message") | Some("assistant") => str_field(&value, "text")
            .or_else(|| str_field(&value, "content"))
            .filter(|t| !t.is_empty())
            .map(|t| vec![RuntimeEvent::AgentMessage { text: t.to_owned() }])
            .unwrap_or_default(),
        _ => generic::parse_generic(line, state),
    }
}

impl CliAdapter for Antigravity {
    fn id(&self) -> ProviderId {
        ProviderId::Antigravity
    }
    fn binary(&self) -> &'static str {
        "agy"
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
    use crate::cli::req;

    #[test]
    fn args_workspace_write() {
        let r = CliRunRequest {
            model_id: Some("gemini-3-pro".into()),
            effort: Some("xhigh".into()),
            ..req(ProviderId::Antigravity)
        };
        let a = build_args(&r);
        assert_eq!(
            &a[..4],
            ["-p", "do the thing", "--output-format", "stream-json"]
        );
        assert!(a.iter().any(|x| x == "--dangerously-skip-permissions"));
        let i = a.iter().position(|x| x == "--effort").unwrap();
        assert_eq!(a[i + 1], "max");
        let m = a.iter().position(|x| x == "--model").unwrap();
        assert_eq!(a[m + 1], "gemini-3-pro");
        let d = a.iter().position(|x| x == "--add-dir").unwrap();
        assert_eq!(a[d + 1], "/repo");
    }

    #[test]
    fn result_event_maps_to_message_session_usage_or_failure() {
        let mut state = ParseState::default();
        let ok = parse_line(
            r#"{"event":"result","result":{"conversation_id":"c1","status":"OK","response":"Done.","error":"","duration_seconds":3,"num_turns":1,"usage":{"input_tokens":10,"output_tokens":5,"thinking_tokens":2,"cache_read_tokens":4,"total_tokens":21}}}"#,
            &mut state,
        );
        assert!(
            ok.iter().any(
                |e| matches!(e, RuntimeEvent::SessionStarted { session_id } if session_id == "c1")
            ),
            "{ok:?}"
        );
        assert!(ok
            .iter()
            .any(|e| matches!(e, RuntimeEvent::AgentMessage { text } if text == "Done.")));
        assert!(ok.iter().any(|e| matches!(e, RuntimeEvent::Usage { .. })));
        let err = parse_line(
            r#"{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"authentication failed or timed out","duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0}}}"#,
            &mut ParseState::default(),
        );
        assert!(err.iter().any(|e| matches!(e, RuntimeEvent::Failed { message, .. } if message.contains("authentication"))), "{err:?}");
    }
}
