//! Static facts per provider that the host needs to run commands. Mirrors `src/providers/registry.ts`.

use super::ProviderId;

#[derive(Debug, Clone, Copy)]
pub struct ProviderSpec {
    pub id: ProviderId,
    pub name: &'static str,
    pub binary: &'static str,
    pub alt_binaries: &'static [&'static str],
    pub install_script: Option<&'static str>,
    pub install_npm: Option<&'static str>,
    pub login_command: &'static str,
}

pub const SPECS: [ProviderSpec; 11] = [
    ProviderSpec {
        id: ProviderId::Codex,
        name: "Codex CLI",
        binary: "codex",
        alt_binaries: &[],
        install_script: Some("npm install -g @openai/codex"),
        install_npm: Some("npm install -g @openai/codex"),
        login_command: "codex login",
    },
    ProviderSpec {
        id: ProviderId::Claude,
        name: "Claude Code",
        binary: "claude",
        alt_binaries: &[],
        install_script: Some("curl -fsSL https://claude.ai/install.sh | bash"),
        install_npm: Some("npm install -g @anthropic-ai/claude-code"),
        login_command: "claude",
    },
    ProviderSpec {
        id: ProviderId::Kimi,
        name: "Kimi Code",
        binary: "kimi",
        alt_binaries: &[],
        install_script: Some("curl -fsSL https://code.kimi.com/install.sh | bash"),
        install_npm: Some("npm install -g @kimi-code/cli"),
        login_command: "kimi login",
    },
    ProviderSpec {
        id: ProviderId::Grok,
        name: "Grok Build",
        binary: "grok",
        alt_binaries: &[],
        install_script: Some("curl -fsSL https://x.ai/cli/install.sh | bash"),
        install_npm: Some("npm install -g @xai-official/grok"),
        login_command: "grok login",
    },
    ProviderSpec {
        id: ProviderId::Gemini,
        name: "Gemini CLI",
        binary: "gemini",
        alt_binaries: &[],
        install_script: Some("npm install -g @google/gemini-cli"),
        install_npm: Some("npm install -g @google/gemini-cli"),
        login_command: "gemini",
    },
    ProviderSpec {
        id: ProviderId::Qwen,
        name: "Qwen Code",
        binary: "qwen",
        alt_binaries: &[],
        install_script: Some("npm install -g @qwen-code/qwen-code"),
        install_npm: Some("npm install -g @qwen-code/qwen-code"),
        login_command: "qwen",
    },
    ProviderSpec {
        id: ProviderId::Opencode,
        name: "OpenCode",
        binary: "opencode",
        alt_binaries: &[],
        install_script: Some("curl -fsSL https://opencode.ai/install | bash"),
        install_npm: Some("npm install -g opencode-ai"),
        login_command: "opencode auth login",
    },
    ProviderSpec {
        id: ProviderId::Copilot,
        name: "Copilot CLI",
        binary: "copilot",
        alt_binaries: &[],
        install_script: Some("npm install -g @github/copilot"),
        install_npm: Some("npm install -g @github/copilot"),
        login_command: "copilot",
    },
    ProviderSpec {
        id: ProviderId::Cursor,
        name: "Cursor Agent",
        binary: "agent",
        alt_binaries: &["cursor-agent"],
        install_script: Some("curl https://cursor.com/install -fsS | bash"),
        install_npm: None,
        login_command: "agent login",
    },
    ProviderSpec {
        id: ProviderId::Amp,
        name: "Amp",
        binary: "amp",
        alt_binaries: &[],
        install_script: Some("npm install -g @ampcode/cli"),
        install_npm: Some("npm install -g @ampcode/cli"),
        login_command: "amp login",
    },
    ProviderSpec {
        id: ProviderId::Antigravity,
        name: "Antigravity CLI",
        binary: "agy",
        alt_binaries: &[],
        install_script: Some("curl -fsSL https://antigravity.google/cli/install.sh | bash"),
        install_npm: None,
        login_command: "agy",
    },
];

pub fn spec(id: ProviderId) -> &'static ProviderSpec {
    SPECS
        .iter()
        .find(|s| s.id == id)
        .expect("every provider has a spec")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The TypeScript registry (src/providers/registry.ts) is what the UI shows; the Rust spec is what runs.
    #[test]
    fn login_and_install_commands_match_the_ts_registry() {
        let ts = include_str!("../../../../src/providers/registry.ts");
        for s in SPECS.iter() {
            let block_start = ts.find(&format!("\n  {}: {{", s.id)).unwrap_or_else(|| panic!("{} missing in registry.ts", s.id));
            let block = &ts[block_start..ts[block_start + 1..].find("\n  }").map(|i| block_start + 1 + i).unwrap_or(ts.len())];
            assert!(block.contains(&format!("loginCommand: \"{}\"", s.login_command)), "{}: loginCommand drift (rust: {})", s.id, s.login_command);
            if let Some(npm) = s.install_npm {
                assert!(block.contains(npm), "{}: installNpm drift", s.id);
            }
        }
    }

    #[test]
    fn every_provider_has_spec_and_install_path() {
        for id in ProviderId::ALL {
            let s = spec(id);
            assert_eq!(s.id, id);
            assert!(
                s.install_script.is_some() || s.install_npm.is_some(),
                "{id}"
            );
            assert!(!s.login_command.is_empty());
        }
    }
}
