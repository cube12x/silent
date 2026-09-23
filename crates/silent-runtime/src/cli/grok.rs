//! Grok Build (`grok -p … --output-format streaming-json`). Doc-based; parser is the generic sniffer.

use super::{generic, CliAdapter, CliRunRequest, ParseState, ProviderId};
use crate::events::RuntimeEvent;

pub struct Grok;

/// `grok -p <prompt> --output-format streaming-json [-m model]`. Session resume is not documented.
pub fn build_args(req: &CliRunRequest) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        req.prompt_with_brief(false),
        "--output-format".into(),
        "streaming-json".into(),
    ];
    if let Some(model) = req.model() {
        args.push("-m".into());
        args.push(model.into());
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
        generic::parse_generic(line, state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::{req, SandboxMode};

    #[test]
    fn args() {
        let r = CliRunRequest {
            model_id: Some("grok-4.7".into()),
            ..req(ProviderId::Grok)
        };
        assert_eq!(
            build_args(&r),
            [
                "-p",
                "do the thing",
                "--output-format",
                "streaming-json",
                "-m",
                "grok-4.7"
            ]
        );
        let r = CliRunRequest {
            sandbox: SandboxMode::ReadOnly,
            ..req(ProviderId::Grok)
        };
        assert!(build_args(&r)[1].starts_with("Read-only task"));
    }
}
