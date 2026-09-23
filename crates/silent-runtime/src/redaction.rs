//! Secret redaction applied to every line that leaves the runtime.
//! Keeps the first four characters of a token so users can still recognise which key leaked.

use std::sync::OnceLock;

use regex::Regex;

fn token_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xoxb-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{12,}|AIza[A-Za-z0-9_-]{8,})",
        )
        .expect("token regex must compile")
    })
}

fn bearer_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)\b(Bearer\s+)([A-Za-z0-9._~+/=-]{8,})").expect("bearer regex must compile")
    })
}

fn assignment_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r#"(?i)\b(API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)\b(\s*[:=]\s*)([^\s,;"']{4,})"#,
        )
        .expect("assignment regex must compile")
    })
}

fn mask(token: &str) -> String {
    let keep: String = token.chars().take(4).collect();
    format!("{keep}…")
}

/// Mask well-known credential shapes. Idempotent; safe on arbitrary text.
pub fn redact_secrets(value: &str) -> String {
    let tokens = token_pattern().replace_all(value, |caps: &regex::Captures| mask(&caps[1]));
    let bearer = bearer_pattern().replace_all(&tokens, |caps: &regex::Captures| {
        format!("{}{}", &caps[1], mask(&caps[2]))
    });
    assignment_pattern()
        .replace_all(&bearer, |caps: &regex::Captures| {
            format!("{}{}{}", &caps[1], &caps[2], mask(&caps[3]))
        })
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_known_token_shapes() {
        let raw = "sk-abcdefghijklmnop ghp_ABCDEFGHIJKLMNOP github_pat_ABCDEFGHIJ xoxb-1234-5678-abcdef AKIAABCDEFGHIJKLMNOP AIzaSyABCDEFGHIJ";
        let out = redact_secrets(raw);
        assert_eq!(out, "sk-a… ghp_… gith… xoxb… AKIA… AIza…");
    }

    #[test]
    fn masks_bearer_and_assignments() {
        let out = redact_secrets(
            "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload OPENAI_API_KEY=supersecretvalue",
        );
        assert!(out.contains("Bearer eyJh…"), "{out}");
        assert!(out.contains("OPENAI_API_KEY=supe…"), "{out}");
        assert!(!out.contains("supersecretvalue"));
    }

    #[test]
    fn leaves_ordinary_text_alone() {
        let raw = "cargo test -p silent-runtime finished in 3s";
        assert_eq!(redact_secrets(raw), raw);
    }
}
