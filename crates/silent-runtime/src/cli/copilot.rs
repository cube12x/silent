//! GitHub Copilot CLI (`copilot -p … --allow-all-tools --output-format json`). Doc-based → generic parser.

use super::{generic, CliAdapter, CliRunRequest, ParseState, ProviderId};
use crate::events::RuntimeEvent;

pub struct Copilot;

/// `copilot -p <prompt> --allow-all-tools --output-format json [--model m]`.
pub fn build_args(req: &CliRunRequest) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        req.prompt_with_brief(false),
        "--allow-all-tools".into(),
        "--output-format".into(),
        "json".into(),
    ];
    if let Some(model) = req.model() {
        args.push("--model".into());
        args.push(model.into());
    }
    args
}

impl CliAdapter for Copilot {
    fn id(&self) -> ProviderId {
        ProviderId::Copilot
    }
    fn binary(&self) -> &'static str {
        "copilot"
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
        assert_eq!(
            build_args(&req(ProviderId::Copilot)),
            [
                "-p",
                "do the thing",
                "--allow-all-tools",
                "--output-format",
                "json"
            ]
        );
    }
}
