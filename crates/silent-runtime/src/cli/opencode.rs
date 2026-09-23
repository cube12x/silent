//! OpenCode (`opencode run --format json`). Doc-based; JSON event shape not pinned → generic parser.

use super::{generic, CliAdapter, CliRunRequest, ParseState, ProviderId};
use crate::events::RuntimeEvent;

pub struct Opencode;

/// `opencode run --format json [--model provider/model] [--session id] <prompt>`.
pub fn build_args(req: &CliRunRequest) -> Vec<String> {
    let mut args: Vec<String> = vec!["run".into(), "--format".into(), "json".into()];
    if let Some(model) = req.model() {
        args.push("--model".into());
        args.push(model.into());
    }
    if let Some(id) = req.resume() {
        args.push("--session".into());
        args.push(id.into());
    }
    args.push(req.prompt_with_brief(false));
    args
}

impl CliAdapter for Opencode {
    fn id(&self) -> ProviderId {
        ProviderId::Opencode
    }
    fn binary(&self) -> &'static str {
        "opencode"
    }
    fn build_args(&self, req: &CliRunRequest) -> Vec<String> {
        build_args(req)
    }
    fn parse_line(&self, line: &str, state: &mut ParseState) -> Vec<RuntimeEvent> {
        generic::parse_generic(line, state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::req;

    #[test]
    fn args() {
        let r = CliRunRequest {
            model_id: Some("anthropic/claude-sonnet-4".into()),
            resume_session_id: Some("s".into()),
            ..req(ProviderId::Opencode)
        };
        assert_eq!(
            build_args(&r),
            [
                "run",
                "--format",
                "json",
                "--model",
                "anthropic/claude-sonnet-4",
                "--session",
                "s",
                "do the thing"
            ]
        );
    }
}
