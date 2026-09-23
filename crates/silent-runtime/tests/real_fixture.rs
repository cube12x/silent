//! Parsers pinned to JSONL transcripts captured from the real CLIs on 2026-09-23:
//! `codex exec --json` (codex-cli 0.153.2) and `claude -p --output-format stream-json` (Claude Code 2.1.280).
//! Kimi's transcript could not be captured (expired auth grant); its parser is doc-based.

use silent_runtime::{adapter_for, ParseState, ProviderId, RuntimeEvent};

fn parse_all(provider: ProviderId, raw: &str) -> (Vec<RuntimeEvent>, Vec<String>) {
    let adapter = adapter_for(provider);
    let mut state = ParseState::default();
    let events: Vec<RuntimeEvent> = raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .flat_map(|l| adapter.parse_line(l, &mut state))
        .collect();
    let kinds = events
        .iter()
        .map(|e| {
            serde_json::to_value(e).unwrap()["type"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    (events, kinds)
}

fn json(events: &[RuntimeEvent]) -> Vec<serde_json::Value> {
    events
        .iter()
        .map(|e| serde_json::to_value(e).unwrap())
        .collect()
}

#[test]
fn real_codex_exec_transcript_normalizes_to_expected_sequence() {
    let (events, kinds) = parse_all(
        ProviderId::Codex,
        include_str!("fixtures/codex-exec-real.jsonl"),
    );
    assert_eq!(kinds[0], "sessionStarted");
    assert_eq!(kinds[1], "turnStarted");
    assert!(kinds.contains(&"commandStarted".to_owned()), "{kinds:?}");
    assert!(kinds.contains(&"commandCompleted".to_owned()), "{kinds:?}");
    assert_eq!(
        kinds.iter().filter(|k| *k == "agentMessage").count(),
        2,
        "{kinds:?}"
    );
    assert!(kinds.contains(&"usage".to_owned()), "{kinds:?}");
    assert_eq!(kinds.last().unwrap(), "turnCompleted");
    assert!(!kinds.contains(&"stdout".to_owned()), "{kinds:?}");

    let json = json(&events);
    let usage = json.iter().find(|v| v["type"] == "usage").unwrap();
    assert_eq!(usage["data"]["inputTokens"], 35747);
    assert_eq!(usage["data"]["cachedInputTokens"], 30080);
    assert_eq!(usage["data"]["outputTokens"], 56);
    let cmd = json
        .iter()
        .find(|v| v["type"] == "commandCompleted")
        .unwrap();
    assert_eq!(cmd["data"]["exitCode"], 0);
    assert_eq!(cmd["data"]["outputTail"], "README.md\n");
    let last_msg = json.iter().rfind(|v| v["type"] == "agentMessage").unwrap();
    assert_eq!(last_msg["data"]["text"], "OK");
}

#[test]
fn real_claude_print_transcript_normalizes_to_expected_sequence() {
    let (events, kinds) = parse_all(
        ProviderId::Claude,
        include_str!("fixtures/claude-print-real.jsonl"),
    );
    // Hook noise is dropped; the first structured events are the session + turn start.
    assert_eq!(kinds[0], "sessionStarted", "{kinds:?}");
    assert_eq!(kinds[1], "turnStarted", "{kinds:?}");
    assert_eq!(
        kinds.iter().filter(|k| *k == "textDelta").count(),
        2,
        "{kinds:?}"
    );
    assert_eq!(
        kinds.iter().filter(|k| *k == "agentMessage").count(),
        1,
        "{kinds:?}"
    );
    assert!(kinds.contains(&"usage".to_owned()), "{kinds:?}");
    assert!(kinds.contains(&"cost".to_owned()), "{kinds:?}");
    assert_eq!(kinds.last().unwrap(), "turnCompleted");
    assert!(!kinds.contains(&"stdout".to_owned()), "{kinds:?}");
    assert!(!kinds.contains(&"failed".to_owned()), "{kinds:?}");

    let json = json(&events);
    let session = json.iter().find(|v| v["type"] == "sessionStarted").unwrap();
    assert_eq!(
        session["data"]["sessionId"],
        "bc2ff3fa-0967-4739-b889-d7c400167701"
    );
    let deltas: String = json
        .iter()
        .filter(|v| v["type"] == "textDelta")
        .map(|v| v["data"]["text"].as_str().unwrap())
        .collect();
    assert_eq!(deltas, "OK");
    let msg = json.iter().find(|v| v["type"] == "agentMessage").unwrap();
    assert_eq!(msg["data"]["text"], "OK");
    let usage = json.iter().find(|v| v["type"] == "usage").unwrap();
    assert_eq!(usage["data"]["inputTokens"], 2 + 30835);
    assert_eq!(usage["data"]["cachedInputTokens"], 10118);
    assert_eq!(usage["data"]["outputTokens"], 4);
    let cost = json.iter().find(|v| v["type"] == "cost").unwrap();
    assert!((cost["data"]["usd"].as_f64().unwrap() - 0.6194495).abs() < 1e-9);
}

#[test]
fn every_adapter_survives_the_other_clis_transcripts() {
    // Feeding a foreign transcript must never panic and must always end in something sensible.
    let fixtures = [
        include_str!("fixtures/codex-exec-real.jsonl"),
        include_str!("fixtures/claude-print-real.jsonl"),
    ];
    for provider in ProviderId::ALL {
        for raw in fixtures {
            let (_events, _kinds) = parse_all(provider, raw);
        }
    }
}
