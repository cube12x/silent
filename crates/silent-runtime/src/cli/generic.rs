//! Best-effort normalizer for JSONL from CLIs whose exact schema we have not pinned to a fixture.
//! Heuristic key sniffing; unknown lines become `Stdout`. Never panics.

use serde_json::Value;

use super::ParseState;
use crate::events::{
    classify_error, compact_call, content_text, str_field, tail, u64_at, RuntimeEvent,
    OUTPUT_TAIL_CHARS,
};

const SESSION_KEYS: &[&str] = &[
    "session_id",
    "sessionId",
    "thread_id",
    "threadId",
    "conversation_id",
];
const ERROR_KEYS: &[&str] = &["error", "error_message", "errorMessage"];

pub fn parse_generic(line: &str, state: &mut ParseState) -> Vec<RuntimeEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return vec![RuntimeEvent::stdout(trimmed)];
    };
    let Value::Object(_) = &value else {
        return vec![RuntimeEvent::stdout(trimmed)];
    };
    let mut events = Vec::new();

    for key in SESSION_KEYS {
        if let Some(id) = str_field(&value, key) {
            events.extend(state.session(id));
            break;
        }
    }

    let kind = str_field(&value, "type")
        .or_else(|| str_field(&value, "event"))
        .or_else(|| str_field(&value, "kind"))
        .unwrap_or("")
        .to_ascii_lowercase();
    let role = str_field(&value, "role").unwrap_or("").to_ascii_lowercase();

    // Errors first: they may carry text fields we should not echo as a message.
    for key in ERROR_KEYS {
        if let Some(err) = value.get(*key) {
            let message = match err {
                Value::String(s) => s.clone(),
                Value::Object(_) => str_field(err, "message")
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| err.to_string()),
                Value::Null => continue,
                other => other.to_string(),
            };
            if !message.is_empty() {
                let (code, retryable) = classify_error(&message, "cli_error");
                events.push(RuntimeEvent::Failed {
                    code,
                    message,
                    retryable,
                });
                return events;
            }
        }
    }
    if kind == "error" {
        let message = str_field(&value, "message").unwrap_or("CLI reported an error");
        let (code, retryable) = classify_error(message, "cli_error");
        events.push(RuntimeEvent::Failed {
            code,
            message: message.to_owned(),
            retryable,
        });
        return events;
    }

    // Tool / command lifecycle.
    let tool_name = str_field(&value, "tool_name")
        .or_else(|| str_field(&value, "tool"))
        .or_else(|| value.pointer("/tool_call/name").and_then(Value::as_str))
        .or_else(|| value.pointer("/function/name").and_then(Value::as_str));
    let call_id = str_field(&value, "tool_id")
        .or_else(|| str_field(&value, "call_id"))
        .or_else(|| str_field(&value, "tool_call_id"))
        .or_else(|| str_field(&value, "tool_use_id"));
    let is_result = kind.contains("result") && (kind.contains("tool") || call_id.is_some());
    if is_result || (role == "tool") {
        let output = value
            .get("output")
            .or_else(|| value.get("content"))
            .or_else(|| value.get("result"));
        let text = match output {
            Some(Value::String(s)) => s.clone(),
            Some(other) => content_text(Some(other)),
            None => String::new(),
        };
        let failed = value
            .get("is_error")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || str_field(&value, "status").is_some_and(|s| s.eq_ignore_ascii_case("error"));
        events.push(RuntimeEvent::CommandCompleted {
            command: state.take_call(call_id),
            exit_code: Some(if failed { 1 } else { 0 }),
            output_tail: tail(&text, OUTPUT_TAIL_CHARS),
        });
        return events;
    }
    if let Some(name) = tool_name {
        if kind.contains("tool")
            || kind.contains("call")
            || kind.contains("step")
            || kind.is_empty()
        {
            let input = value
                .get("parameters")
                .or_else(|| value.get("input"))
                .or_else(|| value.get("arguments"))
                .or_else(|| value.pointer("/tool_call/input"));
            let command = str_field(&value, "command")
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| compact_call(name, input));
            events.push(state.start_call(call_id, command));
            return events;
        }
    }
    if let Some(command) = str_field(&value, "command") {
        if kind.contains("start") || kind.contains("exec") || kind.contains("command") {
            events.push(state.start_call(call_id, command.to_owned()));
            return events;
        }
    }

    // Usage / stats.
    if let Some(usage) = value.get("usage").filter(|u| u.is_object()) {
        events.push(RuntimeEvent::usage(
            u64_at(usage, "/input_tokens").max(u64_at(usage, "/prompt_tokens")),
            u64_at(usage, "/cached_input_tokens").max(u64_at(usage, "/cache_read_input_tokens")),
            u64_at(usage, "/output_tokens").max(u64_at(usage, "/completion_tokens")),
        ));
    } else if let Some(stats) = value.get("stats").filter(|s| s.is_object()) {
        let input = u64_at(stats, "/input_tokens").max(u64_at(stats, "/prompt_tokens"));
        let output = u64_at(stats, "/output_tokens").max(u64_at(stats, "/completion_tokens"));
        if input + output > 0 {
            events.push(RuntimeEvent::usage(
                input,
                u64_at(stats, "/cached_tokens"),
                output,
            ));
        }
    }
    if let Some(usd) = value
        .get("total_cost_usd")
        .or_else(|| value.get("cost_usd"))
        .and_then(Value::as_f64)
    {
        events.push(RuntimeEvent::Cost { usd });
    }

    // Text-ish content.
    let is_delta = value
        .get("delta")
        .is_some_and(|d| d.as_bool() == Some(true))
        || kind.contains("delta")
        || kind.contains("chunk");
    let text = value
        .pointer("/delta/text")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| str_field(&value, "text").map(ToOwned::to_owned))
        .or_else(|| {
            value
                .get("content")
                .filter(|_| role != "user" && role != "system")
                .map(|c| content_text(Some(c)))
                .filter(|s| !s.is_empty())
        })
        .or_else(|| {
            value.get("message").and_then(|m| match m {
                Value::String(s) => Some(s.clone()),
                Value::Object(_) => {
                    let r = str_field(m, "role").unwrap_or("assistant");
                    (r != "user")
                        .then(|| content_text(m.get("content")))
                        .filter(|s| !s.is_empty())
                }
                _ => None,
            })
        })
        .or_else(|| {
            (kind == "result" || kind.ends_with(".completed") || kind == "done")
                .then(|| str_field(&value, "result").map(ToOwned::to_owned))
                .flatten()
        });
    if let Some(text) = text {
        if role != "user" && !text.is_empty() {
            if is_delta {
                state.saw_text_delta = true;
                events.push(RuntimeEvent::TextDelta { text });
            } else {
                events.push(RuntimeEvent::AgentMessage { text });
            }
        }
    }

    let terminal = kind == "result"
        || kind == "done"
        || kind == "complete"
        || kind == "completed"
        || kind == "finish"
        || kind == "finished"
        || kind == "turn.completed"
        || kind == "session.resume_hint";
    if terminal {
        if str_field(&value, "status").is_some_and(|s| s.eq_ignore_ascii_case("error"))
            || value.get("is_error").and_then(Value::as_bool) == Some(true)
        {
            events.push(RuntimeEvent::Failed {
                code: "cli_error".into(),
                message: str_field(&value, "result")
                    .unwrap_or("CLI reported a failed result")
                    .to_owned(),
                retryable: false,
            });
        }
        events.extend(state.complete_turn());
    }

    if events.is_empty() {
        events.push(RuntimeEvent::stdout(trimmed));
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(line: &str) -> Vec<RuntimeEvent> {
        let mut s = ParseState::default();
        parse_generic(line, &mut s)
    }

    #[test]
    fn junk_never_panics_and_falls_back_to_stdout() {
        for junk in [
            "",
            "   ",
            "plain",
            "{",
            "[1,2]",
            "{\"weird\":true}",
            "{\"type\":null}",
            "{\"type\":\"result\",\"result\":null}",
            "{\"usage\":\"str\"}",
            "{\"tool_result\":{}}",
            "{\"error\":null}",
            "\u{0}\u{1}",
            &"x".repeat(10_000),
        ] {
            let _ = parse(junk);
        }
        assert_eq!(parse("plain"), vec![RuntimeEvent::stdout("plain")]);
        assert_eq!(
            parse("{\"weird\":true}"),
            vec![RuntimeEvent::stdout("{\"weird\":true}")]
        );
    }

    #[test]
    fn sniffs_common_shapes() {
        let mut s = ParseState::default();
        let ev = parse_generic(r#"{"type":"init","session_id":"s1"}"#, &mut s);
        assert_eq!(
            ev[0],
            RuntimeEvent::SessionStarted {
                session_id: "s1".into()
            }
        );
        let ev = parse_generic(
            r#"{"type":"tool_use","tool_name":"shell","tool_id":"c1","parameters":{"command":"ls"}}"#,
            &mut s,
        );
        assert_eq!(
            ev,
            vec![RuntimeEvent::CommandStarted {
                command: "shell command=ls".into()
            }]
        );
        let ev = parse_generic(
            r#"{"type":"tool_result","tool_id":"c1","output":"a\nb","status":"success"}"#,
            &mut s,
        );
        assert_eq!(
            ev,
            vec![RuntimeEvent::CommandCompleted {
                command: "shell command=ls".into(),
                exit_code: Some(0),
                output_tail: "a\nb".into()
            }]
        );
        let ev = parse_generic(
            r#"{"type":"message","role":"assistant","content":"hello"}"#,
            &mut s,
        );
        assert_eq!(
            ev,
            vec![RuntimeEvent::AgentMessage {
                text: "hello".into()
            }]
        );
        let ev = parse_generic(
            r#"{"type":"message","role":"assistant","delta":true,"content":"he"}"#,
            &mut s,
        );
        assert_eq!(ev, vec![RuntimeEvent::TextDelta { text: "he".into() }]);
        let ev = parse_generic(
            r#"{"type":"result","status":"success","stats":{"input_tokens":3,"output_tokens":4}}"#,
            &mut s,
        );
        assert_eq!(
            ev,
            vec![RuntimeEvent::usage(3, 0, 4), RuntimeEvent::TurnCompleted {}]
        );
        let ev = parse(r#"{"type":"error","message":"rate limit"}"#);
        assert!(
            matches!(&ev[0], RuntimeEvent::Failed { code, retryable: true, .. } if code == "rate_limited")
        );
        let ev = parse(r#"{"role":"user","content":"ignore me"}"#);
        assert_eq!(
            ev,
            vec![RuntimeEvent::stdout(
                r#"{"role":"user","content":"ignore me"}"#
            )]
        );
    }
}
