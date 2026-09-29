//! Codex CLI (`codex exec --json`). Parser pinned to `tests/fixtures/codex-exec-real.jsonl`.

use serde_json::Value;

use super::{CliAdapter, CliRunRequest, ParseState, ProviderId, SandboxMode};
use crate::events::{
    classify_error, str_field, tail, u64_at, FileChangeKind, RuntimeEvent, OUTPUT_TAIL_CHARS,
};

pub struct Codex;

/// `codex -a never -s <sandbox> [-C cwd] exec --json --color never [--ephemeral] [-m model]
/// [-c model_reasoning_effort="e"] --skip-git-repo-check (resume <id> <prompt> | review [prompt] | <prompt>)`.
/// Global flags precede `exec`; `exec` options precede its subcommand so clap attributes them to `exec`.
/// `--ephemeral` is skipped when resuming because a resumed thread must persist.
/// `service_tier = "..."` from the user's `~/.codex/config.toml`, if any. Workers ignore the rest of
/// that file (plugins, MCP servers, notify hooks) but must keep the paid speed tier.
pub fn user_service_tier() -> Option<String> {
    let home = crate::paths::home()?;
    let text = std::fs::read_to_string(home.join(".codex/config.toml")).ok()?;
    text.lines().find_map(|l| {
        let l = l.trim();
        let rest = l
            .strip_prefix("service_tier")?
            .trim_start()
            .strip_prefix('=')?
            .trim();
        Some(rest.trim_matches('"').to_string()).filter(|v| !v.is_empty())
    })
}

pub fn build_args(req: &CliRunRequest) -> Vec<String> {
    build_args_with(req, user_service_tier().as_deref())
}

/// `service_tier` is injected so tests do not depend on the machine's config.
pub fn build_args_with(req: &CliRunRequest, service_tier: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-a".into(),
        "never".into(),
        "-s".into(),
        req.sandbox.as_flag().into(),
    ];
    if let Some(cwd) = req.cwd() {
        args.push("-C".into());
        args.push(cwd.into());
    }
    args.push("exec".into());
    args.push("--json".into());
    args.push("--color".into());
    args.push("never".into());
    // Isolate workers from the interactive setup: the user's plugins, MCP servers and notify hooks
    // add ~4k tokens and seconds to every run (measured 2026-09-24). Auth still comes from CODEX_HOME.
    args.push("--ignore-user-config".into());
    if let Some(tier) = service_tier {
        args.push("-c".into());
        args.push(format!("service_tier=\"{tier}\""));
    }
    // Package installs and fetches need the network; Codex's workspace-write sandbox blocks it by default.
    // The override MUST come after `exec` (a root-level `-c` before the subcommand is ignored — verified
    // 2026-09-24: before → "Could not resolve host", after → HTTP 200 for registry.npmjs.org).
    if req.network && req.sandbox == SandboxMode::WorkspaceWrite {
        args.push("-c".into());
        args.push("sandbox_workspace_write.network_access=true".into());
    }
    // Package managers write their caches outside the repo (~/.npm, ~/.cache, ~/Library/Caches); the
    // workspace-write sandbox denies that with a misleading "root-owned files" npm error (2026-09-25).
    if req.sandbox == SandboxMode::WorkspaceWrite {
        if let Some(home) = crate::paths::home() {
            let roots = crate::paths::cache_roots(&home, crate::paths::Os::current())
                .iter()
                .map(|r| format!("\"{}\"", r.display().to_string().replace('\\', "\\\\")))
                .collect::<Vec<_>>()
                .join(",");
            args.push("-c".into());
            args.push(format!("sandbox_workspace_write.writable_roots=[{roots}]"));
        }
    }
    // Structured output: Codex wants a schema *file*. `build_args` writes it to a per-run temp
    // path (see `CliRunRequest::schema_file_path`); the host removes it after the process exits.
    if let Some(schema) = req.schema() {
        let path = req.schema_file_path();
        if let Ok(text) = serde_json::to_string(schema) {
            let _ = std::fs::write(&path, text);
        }
        args.push("--output-schema".into());
        args.push(path.to_string_lossy().into_owned());
    }
    let resuming = req.resume();
    if req.ephemeral && resuming.is_none() {
        args.push("--ephemeral".into());
    }
    if let Some(model) = req.model() {
        args.push("-m".into());
        args.push(model.into());
    }
    if let Some(effort) = req.effort() {
        args.push("-c".into());
        args.push(format!("model_reasoning_effort=\"{effort}\""));
    }
    args.push("--skip-git-repo-check".into());
    if let Some(thread) = resuming {
        args.push("resume".into());
        args.push(thread.into());
        args.push(req.prompt.clone());
    } else if req.is_review() {
        args.push("review".into());
        if !req.prompt.trim().is_empty() {
            args.push(req.prompt.clone());
        }
    } else {
        args.push(req.prompt.clone());
    }
    args
}

/// Normalize one line of `codex exec --json` output. Unknown lines become `Stdout`.
pub fn parse_jsonl_line(line: &str) -> Vec<RuntimeEvent> {
    let mut state = ParseState::default();
    parse_line(line, &mut state)
}

pub fn parse_line(line: &str, state: &mut ParseState) -> Vec<RuntimeEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return vec![RuntimeEvent::stdout(trimmed)];
    };
    let Some(event_type) = str_field(&value, "type") else {
        return vec![RuntimeEvent::stdout(trimmed)];
    };
    match event_type {
        "thread.started" => str_field(&value, "thread_id")
            .map(|id| {
                state.session_announced = true;
                vec![RuntimeEvent::SessionStarted {
                    session_id: id.to_owned(),
                }]
            })
            .unwrap_or_default(),
        "turn.started" => vec![RuntimeEvent::TurnStarted {}],
        "item.started" => normalize_item(value.get("item"), false),
        "item.completed" => normalize_item(value.get("item"), true),
        "turn.completed" => {
            let mut events = Vec::new();
            if let Some(usage) = value.get("usage") {
                let input = u64_at(usage, "/input_tokens");
                let cached = u64_at(usage, "/cached_input_tokens");
                let output = u64_at(usage, "/output_tokens");
                events.push(RuntimeEvent::Usage {
                    input_tokens: input,
                    cached_input_tokens: cached,
                    output_tokens: output,
                    total_tokens: input.saturating_add(output),
                });
            }
            state.turn_completed = true;
            events.push(RuntimeEvent::TurnCompleted {});
            events
        }
        "turn.failed" | "error" => {
            let message = str_field(&value, "message")
                .or_else(|| value.pointer("/error/message").and_then(Value::as_str))
                .unwrap_or("Codex reported an error")
                .to_owned();
            let (code, retryable) = classify_error(&message, "codex_error");
            vec![RuntimeEvent::Failed {
                code,
                message,
                retryable,
            }]
        }
        _ => vec![RuntimeEvent::stdout(trimmed)],
    }
}

fn normalize_item(item: Option<&Value>, completed: bool) -> Vec<RuntimeEvent> {
    let Some(item) = item else {
        return Vec::new();
    };
    match str_field(item, "type") {
        Some("agent_message") => {
            if completed {
                str_field(item, "text")
                    .map(|text| {
                        vec![RuntimeEvent::AgentMessage {
                            text: text.to_owned(),
                        }]
                    })
                    .unwrap_or_default()
            } else {
                Vec::new()
            }
        }
        Some("command_execution") => {
            let command = str_field(item, "command").unwrap_or("").to_owned();
            if completed {
                let exit_code = item
                    .get("exit_code")
                    .and_then(Value::as_i64)
                    .map(|c| c as i32);
                let output = str_field(item, "aggregated_output").unwrap_or("");
                vec![RuntimeEvent::CommandCompleted {
                    command,
                    exit_code,
                    output_tail: tail(output, OUTPUT_TAIL_CHARS),
                }]
            } else {
                vec![RuntimeEvent::CommandStarted { command }]
            }
        }
        Some("file_change") => {
            if !completed {
                return Vec::new();
            }
            item.get("changes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|change| {
                    let path = str_field(change, "path")?.to_owned();
                    let kind = match str_field(change, "kind").unwrap_or("update") {
                        "add" | "create" => FileChangeKind::Add,
                        "delete" | "remove" => FileChangeKind::Delete,
                        _ => FileChangeKind::Update,
                    };
                    Some(RuntimeEvent::FileChanged { path, kind })
                })
                .collect()
        }
        Some("reasoning") => {
            // Raw reasoning text is intentionally never surfaced.
            if completed {
                Vec::new()
            } else {
                vec![RuntimeEvent::ReasoningStatus {
                    status: "Codex is reasoning".into(),
                }]
            }
        }
        Some("mcp_tool_call") => {
            if completed {
                return Vec::new();
            }
            let server = str_field(item, "server").unwrap_or("mcp");
            let tool = str_field(item, "tool").unwrap_or("tool");
            vec![RuntimeEvent::CommandStarted {
                command: format!("mcp:{server}/{tool}"),
            }]
        }
        Some("web_search") => {
            if completed {
                return Vec::new();
            }
            let query = str_field(item, "query").unwrap_or("");
            vec![RuntimeEvent::CommandStarted {
                command: format!("web_search {query:?}"),
            }]
        }
        _ => Vec::new(),
    }
}

impl CliAdapter for Codex {
    fn id(&self) -> ProviderId {
        ProviderId::Codex
    }
    fn binary(&self) -> &'static str {
        "codex"
    }
    fn build_args(&self, req: &CliRunRequest) -> Vec<String> {
        build_args(req)
    }
    fn parse_line(&self, line: &str, state: &mut ParseState) -> Vec<RuntimeEvent> {
        parse_line(line, state)
    }
    fn uses_process_cwd(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::{req, SandboxMode};
    use serde_json::json;

    /// The cache `writable_roots` override depends on $HOME; array-comparison tests drop that pair.
    fn without_roots(args: Vec<String>) -> Vec<String> {
        let mut out = Vec::new();
        let mut skip = false;
        for a in args {
            if skip {
                skip = false;
                continue;
            }
            if a == "-c" {
                skip = true;
                continue;
            }
            out.push(a);
        }
        out
    }

    #[test]
    fn new_chat_turn() {
        assert_eq!(
            without_roots(build_args_with(&req(ProviderId::Codex), None)),
            [
                "-a",
                "never",
                "-s",
                "workspace-write",
                "-C",
                "/repo",
                "exec",
                "--json",
                "--color",
                "never",
                "--ignore-user-config",
                "--skip-git-repo-check",
                "do the thing"
            ]
        );
    }

    #[test]
    fn resume_turn_never_ephemeral() {
        let r = CliRunRequest {
            resume_session_id: Some("t-123".into()),
            ephemeral: true,
            ..req(ProviderId::Codex)
        };
        assert_eq!(
            without_roots(build_args_with(&r, None)),
            [
                "-a",
                "never",
                "-s",
                "workspace-write",
                "-C",
                "/repo",
                "exec",
                "--json",
                "--color",
                "never",
                "--ignore-user-config",
                "--skip-git-repo-check",
                "resume",
                "t-123",
                "do the thing"
            ]
        );
    }

    #[test]
    fn writable_cache_roots_only_with_workspace_write() {
        let rw = CliRunRequest {
            sandbox: SandboxMode::WorkspaceWrite,
            ..req(ProviderId::Codex)
        };
        let args = build_args_with(&rw, None);
        let pos = args
            .iter()
            .position(|a| a.starts_with("sandbox_workspace_write.writable_roots=["))
            .expect("writable roots");
        assert_eq!(args[pos - 1], "-c");
        assert!(pos > args.iter().position(|a| a == "exec").unwrap());
        assert!(args[pos].contains(if cfg!(windows) { "npm-cache" } else { "/.npm\"" }));
        let ro = CliRunRequest {
            sandbox: SandboxMode::ReadOnly,
            ..req(ProviderId::Codex)
        };
        assert!(!build_args_with(&ro, None)
            .iter()
            .any(|a| a.contains("writable_roots")));
    }

    #[test]
    fn network_flag_only_with_workspace_write() {
        let r = CliRunRequest {
            network: true,
            sandbox: SandboxMode::WorkspaceWrite,
            ..req(ProviderId::Codex)
        };
        let args = build_args_with(&r, None);
        let pos = args
            .iter()
            .position(|a| a == "sandbox_workspace_write.network_access=true")
            .expect("network flag");
        assert_eq!(args[pos - 1], "-c");
        let exec_pos = args.iter().position(|a| a == "exec").unwrap();
        assert!(
            pos > exec_pos,
            "must come AFTER exec: a root-level -c before the subcommand is ignored by Codex"
        );
        let ignore_pos = args
            .iter()
            .position(|a| a == "--ignore-user-config")
            .unwrap();
        assert!(
            pos > ignore_pos,
            "must come after --ignore-user-config so it is not dropped"
        );
        let ro = CliRunRequest {
            network: true,
            sandbox: SandboxMode::ReadOnly,
            ..req(ProviderId::Codex)
        };
        assert!(!build_args_with(&ro, None)
            .iter()
            .any(|a| a.contains("network_access")));
        let off = CliRunRequest {
            network: false,
            sandbox: SandboxMode::WorkspaceWrite,
            ..req(ProviderId::Codex)
        };
        assert!(!build_args_with(&off, None)
            .iter()
            .any(|a| a.contains("network_access")));
    }

    #[test]
    fn ephemeral_subtask_with_model_effort_read_only() {
        let r = CliRunRequest {
            ephemeral: true,
            model_id: Some("gpt-6-astra".into()),
            effort: Some("high".into()),
            sandbox: SandboxMode::ReadOnly,
            cwd: None,
            ..req(ProviderId::Codex)
        };
        assert_eq!(
            build_args_with(&r, None),
            [
                "-a",
                "never",
                "-s",
                "read-only",
                "exec",
                "--json",
                "--color",
                "never",
                "--ignore-user-config",
                "--ephemeral",
                "-m",
                "gpt-6-astra",
                "-c",
                "model_reasoning_effort=\"high\"",
                "--skip-git-repo-check",
                "do the thing"
            ]
        );
    }

    #[test]
    fn review_with_and_without_prompt() {
        let r = CliRunRequest {
            review: Some(true),
            ..req(ProviderId::Codex)
        };
        let args = build_args_with(&r, None);
        assert_eq!(&args[args.len() - 2..], ["review", "do the thing"]);
        let r = CliRunRequest {
            review: Some(true),
            prompt: "  ".into(),
            ..req(ProviderId::Codex)
        };
        assert_eq!(
            build_args_with(&r, None).last().map(String::as_str),
            Some("review")
        );
    }

    #[test]
    fn parses_lifecycle_and_items() {
        assert_eq!(
            parse_jsonl_line(r#"{"type":"thread.started","thread_id":"abc"}"#),
            vec![RuntimeEvent::SessionStarted {
                session_id: "abc".into()
            }]
        );
        assert_eq!(
            parse_jsonl_line(r#"{"type":"turn.started"}"#),
            vec![RuntimeEvent::TurnStarted {}]
        );
        assert_eq!(
            parse_jsonl_line(
                r#"{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":2,"output_tokens":5}}"#
            ),
            vec![
                RuntimeEvent::Usage {
                    input_tokens: 10,
                    cached_input_tokens: 2,
                    output_tokens: 5,
                    total_tokens: 15
                },
                RuntimeEvent::TurnCompleted {}
            ]
        );
        assert!(parse_jsonl_line(
            r#"{"type":"item.started","item":{"type":"agent_message","text":"hi"}}"#
        )
        .is_empty());
        assert_eq!(
            parse_jsonl_line(
                r#"{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}"#
            ),
            vec![RuntimeEvent::AgentMessage { text: "hi".into() }]
        );
        assert_eq!(
            parse_jsonl_line(
                r#"{"type":"item.started","item":{"type":"command_execution","command":"ls -la"}}"#
            ),
            vec![RuntimeEvent::CommandStarted {
                command: "ls -la".into()
            }]
        );
        assert_eq!(
            parse_jsonl_line(
                r#"{"type":"item.completed","item":{"type":"command_execution","command":"ls","exit_code":0,"aggregated_output":"out"}}"#
            ),
            vec![RuntimeEvent::CommandCompleted {
                command: "ls".into(),
                exit_code: Some(0),
                output_tail: "out".into()
            }]
        );
        assert_eq!(
            parse_jsonl_line(
                r#"{"type":"item.completed","item":{"type":"file_change","changes":[{"path":"a.rs","kind":"add"},{"path":"b.rs","kind":"delete"},{"path":"c.rs","kind":"update"}]}}"#
            ),
            vec![
                RuntimeEvent::FileChanged {
                    path: "a.rs".into(),
                    kind: FileChangeKind::Add
                },
                RuntimeEvent::FileChanged {
                    path: "b.rs".into(),
                    kind: FileChangeKind::Delete
                },
                RuntimeEvent::FileChanged {
                    path: "c.rs".into(),
                    kind: FileChangeKind::Update
                },
            ]
        );
        let reasoning = parse_jsonl_line(
            r#"{"type":"item.started","item":{"type":"reasoning","text":"secret thoughts"}}"#,
        );
        assert!(!format!("{reasoning:?}").contains("secret thoughts"));
        assert_eq!(
            parse_jsonl_line(
                r#"{"type":"item.started","item":{"type":"mcp_tool_call","server":"fs","tool":"read"}}"#
            ),
            vec![RuntimeEvent::CommandStarted {
                command: "mcp:fs/read".into()
            }]
        );
    }

    #[test]
    fn truncates_long_output_and_handles_errors() {
        let long = "x".repeat(5000);
        let line = json!({"type":"item.completed","item":{"type":"command_execution","command":"c","exit_code":1,"aggregated_output":long}}).to_string();
        match &parse_jsonl_line(&line)[0] {
            RuntimeEvent::CommandCompleted {
                output_tail,
                exit_code,
                ..
            } => {
                assert_eq!(output_tail.chars().count(), OUTPUT_TAIL_CHARS + 1);
                assert_eq!(*exit_code, Some(1));
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(
            matches!(&parse_jsonl_line(r#"{"type":"error","message":"rate limit exceeded"}"#)[0], RuntimeEvent::Failed { code, retryable: true, .. } if code == "rate_limited")
        );
        assert_eq!(
            parse_jsonl_line("plain text"),
            vec![RuntimeEvent::stdout("plain text")]
        );
        assert_eq!(
            parse_jsonl_line(r#"{"type":"something.new"}"#),
            vec![RuntimeEvent::stdout(r#"{"type":"something.new"}"#)]
        );
        assert!(parse_jsonl_line("   ").is_empty());
    }
}

#[cfg(test)]
mod schema_tests {
    use super::*;
    use crate::cli::req;
    use serde_json::json;

    #[test]
    fn output_schema_writes_a_file_and_passes_it_after_exec() {
        let mut r = req(crate::cli::ProviderId::Codex);
        r.run_id = "run/with:odd chars".into();
        r.output_schema = Some(json!({"type":"object","properties":{"ok":{"type":"boolean"}}}));
        let args = build_args_with(&r, None);
        let exec = args.iter().position(|a| a == "exec").unwrap();
        let flag = args.iter().position(|a| a == "--output-schema").unwrap();
        assert!(flag > exec);
        let path = &args[flag + 1];
        assert!(path.ends_with(".json"), "{path}");
        assert!(
            !path.contains('/')
                || path.starts_with(std::env::temp_dir().to_string_lossy().as_ref())
        );
        let written = std::fs::read_to_string(path).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&written).unwrap(),
            r.output_schema.clone().unwrap()
        );
        let _ = std::fs::remove_file(path);
        // no schema → no flag
        let plain = build_args(&req(crate::cli::ProviderId::Codex));
        assert!(!plain.iter().any(|a| a == "--output-schema"));
    }
}
