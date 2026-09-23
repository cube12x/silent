//! Builds the `codex` argument vector for a run request. The sandbox is capped at
//! `workspace-write` at the type level; `danger-full-access` cannot be expressed.

use serde::{Deserialize, Serialize};

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

/// Mirrors `CodexRunRequest` in `src/domain/runtime.ts`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexRunRequest {
    pub run_id: String,
    pub prompt: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub sandbox: SandboxMode,
    #[serde(default)]
    pub resume_thread_id: Option<String>,
    #[serde(default)]
    pub ephemeral: bool,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub review: bool,
    #[serde(default)]
    pub skip_git_repo_check: bool,
}

/// `codex -a never -s <sandbox> [-C cwd] exec --json --color never [--ephemeral] [-m model]
/// [--skip-git-repo-check] (resume <thread> <prompt> | review [prompt] | <prompt>)`.
///
/// Global flags (`-a`, `-s`, `-C`) precede `exec`; `exec` options precede its optional
/// subcommand so clap attributes them to `exec` rather than to `resume`/`review`.
/// `--ephemeral` is skipped when resuming because a resumed thread must persist.
pub fn build_args(req: &CodexRunRequest) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-a".into(),
        "never".into(),
        "-s".into(),
        req.sandbox.as_flag().into(),
    ];
    if let Some(cwd) = req.cwd.as_deref().filter(|c| !c.is_empty()) {
        args.push("-C".into());
        args.push(cwd.into());
    }
    args.push("exec".into());
    args.push("--json".into());
    args.push("--color".into());
    args.push("never".into());
    let resuming = req.resume_thread_id.as_deref().filter(|t| !t.is_empty());
    if req.ephemeral && resuming.is_none() {
        args.push("--ephemeral".into());
    }
    if let Some(model) = req.model.as_deref().filter(|m| !m.is_empty()) {
        args.push("-m".into());
        args.push(model.into());
    }
    if req.skip_git_repo_check {
        args.push("--skip-git-repo-check".into());
    }
    if let Some(thread) = resuming {
        args.push("resume".into());
        args.push(thread.into());
        args.push(req.prompt.clone());
    } else if req.review {
        args.push("review".into());
        if !req.prompt.trim().is_empty() {
            args.push(req.prompt.clone());
        }
    } else {
        args.push(req.prompt.clone());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> CodexRunRequest {
        CodexRunRequest {
            run_id: "r1".into(),
            prompt: "do the thing".into(),
            cwd: Some("/repo".into()),
            sandbox: SandboxMode::WorkspaceWrite,
            resume_thread_id: None,
            ephemeral: false,
            model: None,
            review: false,
            skip_git_repo_check: false,
        }
    }

    #[test]
    fn new_chat_turn() {
        assert_eq!(
            build_args(&base()),
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
                "do the thing"
            ]
        );
    }

    #[test]
    fn resume_turn_never_ephemeral() {
        let req = CodexRunRequest {
            resume_thread_id: Some("t-123".into()),
            ephemeral: true,
            ..base()
        };
        assert_eq!(
            build_args(&req),
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
                "resume",
                "t-123",
                "do the thing"
            ]
        );
    }

    #[test]
    fn ephemeral_subtask_with_model_and_no_git() {
        let req = CodexRunRequest {
            ephemeral: true,
            model: Some("gpt-5-codex".into()),
            skip_git_repo_check: true,
            sandbox: SandboxMode::ReadOnly,
            cwd: None,
            ..base()
        };
        assert_eq!(
            build_args(&req),
            [
                "-a",
                "never",
                "-s",
                "read-only",
                "exec",
                "--json",
                "--color",
                "never",
                "--ephemeral",
                "-m",
                "gpt-5-codex",
                "--skip-git-repo-check",
                "do the thing"
            ]
        );
    }

    #[test]
    fn review_with_and_without_prompt() {
        let req = CodexRunRequest {
            review: true,
            ..base()
        };
        assert_eq!(
            build_args(&req),
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
                "review",
                "do the thing"
            ]
        );
        let req = CodexRunRequest {
            review: true,
            prompt: "  ".into(),
            ..base()
        };
        assert_eq!(build_args(&req).last().map(String::as_str), Some("review"));
    }

    #[test]
    fn sandbox_rejects_danger_full_access_at_type_level() {
        let json = r#"{"runId":"r","prompt":"p","sandbox":"danger-full-access"}"#;
        assert!(serde_json::from_str::<CodexRunRequest>(json).is_err());
        let json = r#"{"runId":"r","prompt":"p","sandbox":"workspace-write"}"#;
        let req = serde_json::from_str::<CodexRunRequest>(json).unwrap();
        assert_eq!(req.sandbox, SandboxMode::WorkspaceWrite);
        assert!(!req.ephemeral);
    }
}
