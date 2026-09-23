//! Normalized runtime events streamed to the frontend. Mirrors `RuntimeEvent` in
//! `src/domain/runtime.ts` (`#[serde(tag = "type", content = "data", rename_all = "camelCase")]`).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::redaction::redact_secrets;

pub const OUTPUT_TAIL_CHARS: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileChangeKind {
    Add,
    Update,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum RuntimeEvent {
    #[serde(rename_all = "camelCase")]
    SessionStarted {
        session_id: String,
    },
    TurnStarted {},
    TextDelta {
        text: String,
    },
    AgentMessage {
        text: String,
    },
    CommandStarted {
        command: String,
    },
    #[serde(rename_all = "camelCase")]
    CommandCompleted {
        command: String,
        exit_code: Option<i32>,
        output_tail: String,
    },
    FileChanged {
        path: String,
        kind: FileChangeKind,
    },
    ReasoningStatus {
        status: String,
    },
    #[serde(rename_all = "camelCase")]
    Usage {
        input_tokens: u64,
        cached_input_tokens: u64,
        output_tokens: u64,
        total_tokens: u64,
    },
    Cost {
        usd: f64,
    },
    Stderr {
        line: String,
    },
    Stdout {
        line: String,
    },
    TurnCompleted {},
    Failed {
        code: String,
        message: String,
        retryable: bool,
    },
    Exited {
        code: Option<i32>,
    },
}

impl RuntimeEvent {
    /// Apply secret redaction to every free-text field.
    pub fn redacted(self) -> RuntimeEvent {
        match self {
            RuntimeEvent::TextDelta { text } => RuntimeEvent::TextDelta {
                text: redact_secrets(&text),
            },
            RuntimeEvent::AgentMessage { text } => RuntimeEvent::AgentMessage {
                text: redact_secrets(&text),
            },
            RuntimeEvent::CommandStarted { command } => RuntimeEvent::CommandStarted {
                command: redact_secrets(&command),
            },
            RuntimeEvent::CommandCompleted {
                command,
                exit_code,
                output_tail,
            } => RuntimeEvent::CommandCompleted {
                command: redact_secrets(&command),
                exit_code,
                output_tail: redact_secrets(&output_tail),
            },
            RuntimeEvent::Stderr { line } => RuntimeEvent::Stderr {
                line: redact_secrets(&line),
            },
            RuntimeEvent::Stdout { line } => RuntimeEvent::Stdout {
                line: redact_secrets(&line),
            },
            RuntimeEvent::Failed {
                code,
                message,
                retryable,
            } => RuntimeEvent::Failed {
                code,
                message: redact_secrets(&message),
                retryable,
            },
            other => other,
        }
    }

    pub fn usage(input: u64, cached: u64, output: u64) -> RuntimeEvent {
        RuntimeEvent::Usage {
            input_tokens: input,
            cached_input_tokens: cached,
            output_tokens: output,
            total_tokens: input.saturating_add(cached).saturating_add(output),
        }
    }

    pub fn stdout(line: &str) -> RuntimeEvent {
        RuntimeEvent::Stdout {
            line: line.to_owned(),
        }
    }
}

// ---- shared JSON helpers used by every adapter -------------------------------------------------

pub(crate) fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

pub(crate) fn u64_at(value: &Value, pointer: &str) -> u64 {
    value
        .pointer(pointer)
        .and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|f| f.max(0.0) as u64)))
        .unwrap_or(0)
}

pub(crate) fn tail(text: &str, max_chars: usize) -> String {
    let count = text.chars().count();
    if count <= max_chars {
        return text.to_owned();
    }
    let skip = count - max_chars;
    format!("…{}", text.chars().skip(skip).collect::<String>())
}

/// Classify an error message into a stable code + retryability.
pub(crate) fn classify_error(message: &str, fallback: &str) -> (String, bool) {
    let lower = message.to_ascii_lowercase();
    if lower.contains("not logged in")
        || lower.contains("unauthorized")
        || lower.contains("authentication")
        || lower.contains("authorization grant")
        || lower.contains("login")
    {
        ("not_authenticated".into(), false)
    } else if lower.contains("usage limit")
        || lower.contains("rate limit")
        || lower.contains("429")
        || lower.contains("overloaded")
    {
        ("rate_limited".into(), true)
    } else if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("connection")
    {
        ("network".into(), true)
    } else {
        (fallback.into(), false)
    }
}

/// Render a tool/function input compactly for the terminal (`name key=value …`, ≤ 200 chars).
pub(crate) fn compact_call(name: &str, input: Option<&Value>) -> String {
    let rendered = match input {
        Some(Value::Object(map)) => map
            .iter()
            .map(|(k, v)| match v {
                Value::String(s) => format!("{k}={}", short(s, 60)),
                other => format!("{k}={}", short(&other.to_string(), 60)),
            })
            .collect::<Vec<_>>()
            .join(" "),
        Some(Value::String(s)) => short(s, 120),
        Some(other) => short(&other.to_string(), 120),
        None => String::new(),
    };
    let joined = if rendered.is_empty() {
        name.to_owned()
    } else {
        format!("{name} {rendered}")
    };
    short(&joined, 200)
}

pub(crate) fn short(text: &str, max: usize) -> String {
    let one_line = text.replace('\n', " ");
    if one_line.chars().count() <= max {
        one_line
    } else {
        format!("{}…", one_line.chars().take(max).collect::<String>())
    }
}

/// Text from a `content` field that is either a string or an array of `{type:"text",text}` blocks.
pub(crate) fn content_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(s) => Some(s.clone()),
                Value::Object(_) => str_field(item, "text").map(ToOwned::to_owned),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_with_type_and_data_envelope() {
        assert_eq!(
            serde_json::to_value(RuntimeEvent::TurnStarted {}).unwrap(),
            json!({"type": "turnStarted", "data": {}})
        );
        assert_eq!(
            serde_json::to_value(RuntimeEvent::SessionStarted {
                session_id: "t1".into()
            })
            .unwrap(),
            json!({"type": "sessionStarted", "data": {"sessionId": "t1"}})
        );
        assert_eq!(
            serde_json::to_value(RuntimeEvent::Cost { usd: 0.25 }).unwrap(),
            json!({"type": "cost", "data": {"usd": 0.25}})
        );
        assert_eq!(
            serde_json::to_value(RuntimeEvent::CommandCompleted {
                command: "ls".into(),
                exit_code: Some(0),
                output_tail: "a".into(),
            })
            .unwrap(),
            json!({"type": "commandCompleted", "data": {"command": "ls", "exitCode": 0, "outputTail": "a"}})
        );
        assert_eq!(
            serde_json::to_value(RuntimeEvent::FileChanged {
                path: "a.rs".into(),
                kind: FileChangeKind::Add,
            })
            .unwrap(),
            json!({"type": "fileChanged", "data": {"path": "a.rs", "kind": "add"}})
        );
        assert_eq!(
            serde_json::to_value(RuntimeEvent::Exited { code: None }).unwrap(),
            json!({"type": "exited", "data": {"code": null}})
        );
    }

    #[test]
    fn redaction_covers_text_fields() {
        let ev = RuntimeEvent::AgentMessage {
            text: "key sk-abcdefghijklmnop".into(),
        }
        .redacted();
        assert_eq!(
            ev,
            RuntimeEvent::AgentMessage {
                text: "key sk-a…".into()
            }
        );
    }

    #[test]
    fn helpers() {
        assert_eq!(tail("abcdef", 3), "…def");
        assert_eq!(
            compact_call("Bash", Some(&json!({"command": "ls -la"}))),
            "Bash command=ls -la"
        );
        assert_eq!(
            content_text(Some(
                &json!([{"type":"text","text":"a"},{"type":"text","text":"b"}])
            )),
            "a\nb"
        );
        assert_eq!(classify_error("rate limit", "x").0, "rate_limited");
        assert_eq!(
            classify_error("The provided authorization grant is invalid", "x").0,
            "not_authenticated"
        );
    }
}
