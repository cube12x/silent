//! Antigravity CLI (`agy`, Google). Successor of Gemini CLI for individual accounts (Gemini CLI stopped
//! serving individual/AI Pro/Ultra tiers on 2026-06-18). Headless: `agy -p <prompt> --output-format
//! stream-json`; one JSON object per line with an `event` field. Observed (unauthenticated) shape:
//! `{"event":"result","result":{"conversation_id":"…","status":"ERROR|…","response":"…","error":"…",
//! "duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,
//! "cache_read_tokens":0,"total_tokens":0}}}`. Other events fall through to the generic parser.

use serde_json::Value;

use super::{generic, CliAdapter, CliRunRequest, ParseState, ProviderId, SandboxMode};
use crate::events::{
    compact_call, str_field, tail, u64_at, FileChangeKind, RuntimeEvent, OUTPUT_TAIL_CHARS,
};

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
        // {"event":"init","conversation_id":"…","init":{"model":"…","cwd":"…","tools":[…],"permission_mode":"…"}}
        Some("init") => {
            let mut events = Vec::new();
            if let Some(id) = str_field(&value, "conversation_id").filter(|s| !s.is_empty()) {
                events.extend(state.session(id));
            }
            events.push(RuntimeEvent::TurnStarted {});
            events
        }
        // {"event":"step_update","step_update":{"step_index":n,"state":"ACTIVE|DONE","step_type":"tool|agent_response|user_input",
        //   "tool_name":"run_command","tool_info":{"name":"…","parameters":{"CommandLine":"…"|"TargetFile":"…"},"output":"…"},
        //   "text_delta":"…","usage":{…}}}
        Some("step_update") => {
            let su = value.get("step_update").cloned().unwrap_or(Value::Null);
            let step_state = str_field(&su, "state").unwrap_or("");
            let idx = su
                .get("step_index")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                .to_string();
            match str_field(&su, "step_type") {
                Some("tool") => {
                    let name = str_field(&su, "tool_name").unwrap_or("tool");
                    let info = su.get("tool_info").cloned().unwrap_or(Value::Null);
                    let params = info.get("parameters").cloned().unwrap_or(Value::Null);
                    let command = str_field(&params, "CommandLine")
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| compact_call(name, Some(&params)));
                    let path = str_field(&params, "TargetFile")
                        .or_else(|| str_field(&params, "AbsolutePath"))
                        .map(ToOwned::to_owned);
                    if step_state == "ACTIVE" {
                        let mut events = vec![state.start_call(Some(&idx), command)];
                        if let Some(p) = path {
                            let kind = if name.contains("write") {
                                FileChangeKind::Add
                            } else {
                                FileChangeKind::Update
                            };
                            if name.contains("write")
                                || name.contains("replace")
                                || name.contains("edit")
                            {
                                events.push(RuntimeEvent::FileChanged { path: p, kind });
                            }
                        }
                        events
                    } else {
                        let output = str_field(&info, "output").unwrap_or("");
                        vec![RuntimeEvent::CommandCompleted {
                            command: state.take_call(Some(&idx)),
                            exit_code: Some(0),
                            output_tail: tail(output, OUTPUT_TAIL_CHARS),
                        }]
                    }
                }
                Some("agent_response") => {
                    let mut events = Vec::new();
                    if let Some(t) = str_field(&su, "text_delta").filter(|t| !t.is_empty()) {
                        state.saw_text_delta = true;
                        events.push(RuntimeEvent::TextDelta { text: t.to_owned() });
                    }
                    if step_state == "DONE" {
                        if let Some(usage) = su.get("usage") {
                            state.usage_reported = true;
                            events.push(RuntimeEvent::usage(
                                u64_at(usage, "/input_tokens"),
                                u64_at(usage, "/cache_read_tokens"),
                                u64_at(usage, "/output_tokens") + u64_at(usage, "/thinking_tokens"),
                            ));
                        }
                    }
                    events
                }
                _ => Vec::new(),
            }
        }
        // {"event":"result","result":{"conversation_id":"…","status":"SUCCESS|ERROR","response":"…","error":"…","usage":{…}}}
        Some("result") => {
            let mut events = Vec::new();
            let r = value.get("result").cloned().unwrap_or(Value::Null);
            if let Some(id) = str_field(&r, "conversation_id").filter(|s| !s.is_empty()) {
                events.extend(state.session(id));
            }
            if !state.usage_reported {
                if let Some(usage) = r.get("usage") {
                    events.push(RuntimeEvent::usage(
                        u64_at(usage, "/input_tokens"),
                        u64_at(usage, "/cache_read_tokens"),
                        u64_at(usage, "/output_tokens") + u64_at(usage, "/thinking_tokens"),
                    ));
                }
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
            } else if let Some(text) = str_field(&r, "response")
                .map(str::trim)
                .filter(|t| !t.is_empty())
            {
                events.push(RuntimeEvent::AgentMessage {
                    text: text.to_owned(),
                });
            }
            events.push(RuntimeEvent::TurnCompleted {});
            events
        }
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

    #[test]
    fn step_updates_map_to_commands_files_deltas_and_usage() {
        let mut state = ParseState::default();
        let init = parse_line(
            r#"{"event":"init","conversation_id":"c9","init":{"model":"gemini-3.8-flash-low","cwd":"/t","tools":[],"permission_mode":"x"}}"#,
            &mut state,
        );
        assert!(init.iter().any(
            |e| matches!(e, RuntimeEvent::SessionStarted { session_id } if session_id == "c9")
        ));
        let a = parse_line(
            r#"{"event":"step_update","step_update":{"conversation_id":"c9","step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"ls -la"}}}}"#,
            &mut state,
        );
        assert!(
            matches!(&a[..], [RuntimeEvent::CommandStarted { command }] if command == "ls -la"),
            "{a:?}"
        );
        let d = parse_line(
            r#"{"event":"step_update","step_update":{"conversation_id":"c9","step_index":2,"state":"DONE","step_type":"tool","tool_name":"run_command","duration_seconds":0.1,"tool_info":{"name":"run_command","parameters":{"CommandLine":"ls -la"},"output":"total 1\nhello\n"}}}"#,
            &mut state,
        );
        assert!(
            matches!(&d[..], [RuntimeEvent::CommandCompleted { command, exit_code: Some(0), .. }] if command == "ls -la"),
            "{d:?}"
        );
        let w = parse_line(
            r#"{"event":"step_update","step_update":{"conversation_id":"c9","step_index":4,"state":"ACTIVE","step_type":"tool","tool_name":"write_to_file","tool_info":{"name":"write_to_file","parameters":{"TargetFile":"/t/out.txt"}}}}"#,
            &mut state,
        );
        assert!(
            w.iter().any(
                |e| matches!(e, RuntimeEvent::FileChanged { path, .. } if path == "/t/out.txt")
            ),
            "{w:?}"
        );
        let t = parse_line(
            r#"{"event":"step_update","step_update":{"conversation_id":"c9","step_index":5,"state":"DONE","step_type":"agent_response","text_delta":"OK","duration_seconds":1.7,"usage":{"input_tokens":13027,"output_tokens":1,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":13028}}}"#,
            &mut state,
        );
        assert!(t
            .iter()
            .any(|e| matches!(e, RuntimeEvent::TextDelta { text } if text == "OK")));
        assert!(t.iter().any(|e| matches!(e, RuntimeEvent::Usage { .. })));
        let r = parse_line(
            r#"{"event":"result","result":{"conversation_id":"c9","status":"SUCCESS","response":"OK\n","duration_seconds":6.7,"num_turns":1,"usage":{"input_tokens":38170,"output_tokens":230,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":38400}}}"#,
            &mut state,
        );
        assert!(r
            .iter()
            .any(|e| matches!(e, RuntimeEvent::AgentMessage { text } if text == "OK")));
        assert!(
            !r.iter().any(|e| matches!(e, RuntimeEvent::Usage { .. })),
            "total must not double-count: {r:?}"
        );
    }
}
