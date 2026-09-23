//! Amp (`amp -x … --stream-json`). Doc-based → generic parser.

use super::{generic, CliAdapter, CliRunRequest, ParseState, ProviderId};
use crate::events::RuntimeEvent;

pub struct Amp;

/// `amp -x <prompt> --stream-json`. No model flag, no resume.
pub fn build_args(req: &CliRunRequest) -> Vec<String> {
    vec![
        "-x".into(),
        req.prompt_with_brief(false),
        "--stream-json".into(),
    ]
}

impl CliAdapter for Amp {
    fn id(&self) -> ProviderId {
        ProviderId::Amp
    }
    fn binary(&self) -> &'static str {
        "amp"
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
            build_args(&req(ProviderId::Amp)),
            ["-x", "do the thing", "--stream-json"]
        );
    }
}
