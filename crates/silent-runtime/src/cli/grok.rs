//! Grok Build (`grok`, xAI). Verified 2026-09-25 against grok 1.0.41: `--output-format
//! streaming-messages-json` emits the Claude-compatible JSONL stream (`system/init` with `session_id`,
//! `assistant` messages with content blocks, `result` with usage and cost), so the Claude parser is reused.
//! Tools need `--always-approve`; `--cwd`, `-m`, `--reasoning-effort`, `-r/--resume`, `--json-schema`
//! and `--include-partial-messages` are all accepted.

use super::{claude, CliAdapter, CliRunRequest, ParseState, ProviderId, SandboxMode};
use crate::events::RuntimeEvent;

pub struct Grok;

pub fn build_args(req: &CliRunRequest) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        req.prompt_with_brief_schema(false, true),
        "--output-format".into(),
        "streaming-messages-json".into(),
        "--include-partial-messages".into(),
    ];
    if req.sandbox == SandboxMode::WorkspaceWrite {
        args.push("--always-approve".into());
    }
    if let Some(cwd) = req.cwd() {
        args.push("--cwd".into());
        args.push(cwd.into());
    }
    if let Some(model) = req.model() {
        args.push("-m".into());
        args.push(model.into());
    }
    if let Some(effort) = req.effort() {
        args.push("--reasoning-effort".into());
        args.push(effort.into());
    }
    if let Some(id) = req.resume() {
        args.push("--resume".into());
        args.push(id.into());
    }
    if let Some(schema) = req.schema() {
        args.push("--json-schema".into());
        args.push(serde_json::to_string(schema).unwrap_or_else(|_| "{}".into()));
    }
    args
}

impl CliAdapter for Grok {
    fn id(&self) -> ProviderId {
        ProviderId::Grok
    }
    fn binary(&self) -> &'static str {
        "grok"
    }
    fn build_args(&self, req: &CliRunRequest) -> Vec<String> {
        build_args(req)
    }
    fn parse_line(&self, line: &str, state: &mut ParseState) -> Vec<RuntimeEvent> {
        claude::parse_line(line, state)
            .into_iter()
            .map(|e| match e {
                RuntimeEvent::ReasoningStatus { status } => RuntimeEvent::ReasoningStatus {
                    status: status.replace("Claude", "Grok"),
                },
                other => other,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::req;

    #[test]
    fn args() {
        let r = CliRunRequest {
            model_id: Some("grok-4.7".into()),
            effort: Some("high".into()),
            ..req(ProviderId::Grok)
        };
        assert_eq!(
            build_args(&r),
            [
                "-p",
                "do the thing",
                "--output-format",
                "streaming-messages-json",
                "--include-partial-messages",
                "--always-approve",
                "--cwd",
                "/repo",
                "-m",
                "grok-4.7",
                "--reasoning-effort",
                "high"
            ]
        );
    }

    #[test]
    fn read_only_has_no_auto_approve_and_resume_is_passed() {
        let r = CliRunRequest {
            sandbox: SandboxMode::ReadOnly,
            resume_session_id: Some("01a0-sess".into()),
            cwd: None,
            ..req(ProviderId::Grok)
        };
        let a = build_args(&r);
        assert!(!a.iter().any(|x| x == "--always-approve"));
        let i = a.iter().position(|x| x == "--resume").unwrap();
        assert_eq!(a[i + 1], "01a0-sess");
    }

    #[test]
    fn parses_claude_compatible_stream() {
        let adapter = Grok;
        let mut state = ParseState::default();
        let init = adapter.parse_line(r#"{"type":"system","subtype":"init","session_id":"01a0d8f5-dd65-7390-a6d0-0f5932869b9a","model":"grok-4.7-build-fast","cwd":"/t"}"#, &mut state);
        assert!(
            init.iter()
                .any(|e| matches!(e, RuntimeEvent::SessionStarted { .. })),
            "{init:?}"
        );
        let res = adapter.parse_line(r#"{"type":"result","subtype":"success","is_error":false,"duration_ms":5866,"num_turns":1,"result":"OK","stop_reason":"end_turn","total_cost_usd":0.0346,"usage":{"input_tokens":21990,"output_tokens":155,"cache_read_input_tokens":12032},"session_id":"01a0d8f5-dd65-7390-a6d0-0f5932869b9a"}"#, &mut state);
        assert!(
            res.iter().any(|e| matches!(e, RuntimeEvent::Usage { .. })),
            "{res:?}"
        );
        assert!(res.iter().any(|e| matches!(e, RuntimeEvent::Cost { .. })));
    }

    #[test]
    fn thinking_status_names_grok() {
        let mut state = ParseState::default();
        let ev = Grok.parse_line(r#"{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"thinking"}}}"#, &mut state);
        assert!(ev.iter().any(|e| matches!(e, RuntimeEvent::ReasoningStatus { status } if status == "Grok is thinking")), "{ev:?}");
    }

    #[test]
    fn grok_tool_names_map_to_commands_and_file_changes() {
        let mut state = ParseState::default();
        let ev = Grok.parse_line(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"run_terminal_command","input":{"command":"npm run typecheck","description":"x"}},{"type":"tool_use","id":"t2","name":"search_replace","input":{"file_path":"/r/src/a.ts","old_string":"a","new_string":"b"}}]}}"#,
            &mut state,
        );
        assert!(ev.iter().any(|e| matches!(e, RuntimeEvent::CommandStarted { command } if command == "npm run typecheck")), "{ev:?}");
        assert!(
            ev.iter().any(
                |e| matches!(e, RuntimeEvent::FileChanged { path, .. } if path == "/r/src/a.ts")
            ),
            "{ev:?}"
        );
    }
}
