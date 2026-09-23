//! Normalized runtime events streamed to the frontend, plus the `codex exec --json` JSONL parser.
//! Mirrors `RuntimeEvent` in `src/domain/runtime.ts`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::redaction::redact_secrets;

const OUTPUT_TAIL_CHARS: usize = 2000;

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
    ThreadStarted {
        thread_id: String,
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
}

fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn u64_field(value: Option<&Value>, key: &str) -> u64 {
    value
        .and_then(|v| v.get(key))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn tail(text: &str, max_chars: usize) -> String {
    let count = text.chars().count();
    if count <= max_chars {
        return text.to_owned();
    }
    let skip = count - max_chars;
    format!("…{}", text.chars().skip(skip).collect::<String>())
}

fn classify_error(message: &str) -> (String, bool) {
    let lower = message.to_ascii_lowercase();
    if lower.contains("not logged in")
        || lower.contains("unauthorized")
        || lower.contains("authentication")
    {
        ("not_authenticated".into(), false)
    } else if lower.contains("usage limit") || lower.contains("rate limit") || lower.contains("429")
    {
        ("rate_limited".into(), true)
    } else if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("connection")
    {
        ("network".into(), true)
    } else {
        ("codex_error".into(), false)
    }
}

/// Normalize one line of `codex exec --json` output. Never panics; unknown lines become `Stdout`.
pub fn parse_jsonl_line(line: &str) -> Vec<RuntimeEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return vec![RuntimeEvent::Stdout {
            line: trimmed.to_owned(),
        }];
    };
    let Some(event_type) = str_field(&value, "type") else {
        return vec![RuntimeEvent::Stdout {
            line: trimmed.to_owned(),
        }];
    };
    match event_type {
        "thread.started" => str_field(&value, "thread_id")
            .map(|id| {
                vec![RuntimeEvent::ThreadStarted {
                    thread_id: id.to_owned(),
                }]
            })
            .unwrap_or_default(),
        "turn.started" => vec![RuntimeEvent::TurnStarted {}],
        "item.started" => normalize_item(value.get("item"), false),
        "item.completed" => normalize_item(value.get("item"), true),
        "turn.completed" => {
            let mut events = Vec::new();
            if let Some(usage) = value.get("usage") {
                let input = u64_field(Some(usage), "input_tokens");
                let cached = u64_field(Some(usage), "cached_input_tokens");
                let output = u64_field(Some(usage), "output_tokens");
                let total = usage
                    .get("total_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(input.saturating_add(output));
                events.push(RuntimeEvent::Usage {
                    input_tokens: input,
                    cached_input_tokens: cached,
                    output_tokens: output,
                    total_tokens: total,
                });
            }
            events.push(RuntimeEvent::TurnCompleted {});
            events
        }
        "turn.failed" | "error" => {
            let message = str_field(&value, "message")
                .or_else(|| value.pointer("/error/message").and_then(Value::as_str))
                .unwrap_or("Codex reported an error")
                .to_owned();
            let (code, retryable) = classify_error(&message);
            vec![RuntimeEvent::Failed {
                code,
                message,
                retryable,
            }]
        }
        _ => vec![RuntimeEvent::Stdout {
            line: trimmed.to_owned(),
        }],
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_with_type_and_data_envelope() {
        let json = serde_json::to_value(RuntimeEvent::TurnStarted {}).unwrap();
        assert_eq!(json, json!({"type": "turnStarted", "data": {}}));
        let json = serde_json::to_value(RuntimeEvent::ThreadStarted {
            thread_id: "t1".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            json!({"type": "threadStarted", "data": {"threadId": "t1"}})
        );
        let json = serde_json::to_value(RuntimeEvent::CommandCompleted {
            command: "ls".into(),
            exit_code: Some(0),
            output_tail: "a".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            json!({"type": "commandCompleted", "data": {"command": "ls", "exitCode": 0, "outputTail": "a"}})
        );
        let json = serde_json::to_value(RuntimeEvent::FileChanged {
            path: "a.rs".into(),
            kind: FileChangeKind::Add,
        })
        .unwrap();
        assert_eq!(
            json,
            json!({"type": "fileChanged", "data": {"path": "a.rs", "kind": "add"}})
        );
        let json = serde_json::to_value(RuntimeEvent::Exited { code: None }).unwrap();
        assert_eq!(json, json!({"type": "exited", "data": {"code": null}}));
    }

    #[test]
    fn parses_thread_and_turn_lifecycle() {
        assert_eq!(
            parse_jsonl_line(r#"{"type":"thread.started","thread_id":"abc"}"#),
            vec![RuntimeEvent::ThreadStarted {
                thread_id: "abc".into()
            }]
        );
        assert_eq!(
            parse_jsonl_line(r#"{"type":"turn.started"}"#),
            vec![RuntimeEvent::TurnStarted {}]
        );
        let events = parse_jsonl_line(
            r#"{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":2,"output_tokens":5}}"#,
        );
        assert_eq!(
            events,
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
    }

    #[test]
    fn parses_items() {
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
        assert_eq!(
            reasoning,
            vec![RuntimeEvent::ReasoningStatus {
                status: "Codex is reasoning".into()
            }]
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
        assert_eq!(
            parse_jsonl_line(
                r#"{"type":"item.started","item":{"type":"web_search","query":"rust"}}"#
            ),
            vec![RuntimeEvent::CommandStarted {
                command: "web_search \"rust\"".into()
            }]
        );
    }

    #[test]
    fn truncates_long_output_to_tail() {
        let long = "x".repeat(5000);
        let line = json!({"type":"item.completed","item":{"type":"command_execution","command":"c","exit_code":1,"aggregated_output":long}}).to_string();
        match &parse_jsonl_line(&line)[0] {
            RuntimeEvent::CommandCompleted {
                output_tail,
                exit_code,
                ..
            } => {
                assert_eq!(output_tail.chars().count(), OUTPUT_TAIL_CHARS + 1);
                assert!(output_tail.starts_with('…'));
                assert_eq!(*exit_code, Some(1));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn errors_and_unknown_lines_never_panic() {
        assert_eq!(
            parse_jsonl_line(r#"{"type":"error","message":"boom"}"#),
            vec![RuntimeEvent::Failed {
                code: "codex_error".into(),
                message: "boom".into(),
                retryable: false
            }]
        );
        assert_eq!(
            parse_jsonl_line(r#"{"type":"error","message":"rate limit exceeded"}"#),
            vec![RuntimeEvent::Failed {
                code: "rate_limited".into(),
                message: "rate limit exceeded".into(),
                retryable: true
            }]
        );
        assert_eq!(
            parse_jsonl_line("plain text"),
            vec![RuntimeEvent::Stdout {
                line: "plain text".into()
            }]
        );
        assert_eq!(
            parse_jsonl_line(r#"{"no":"type"}"#),
            vec![RuntimeEvent::Stdout {
                line: r#"{"no":"type"}"#.into()
            }]
        );
        assert_eq!(
            parse_jsonl_line(r#"{"type":"something.new"}"#),
            vec![RuntimeEvent::Stdout {
                line: r#"{"type":"something.new"}"#.into()
            }]
        );
        assert!(parse_jsonl_line("   ").is_empty());
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
}
