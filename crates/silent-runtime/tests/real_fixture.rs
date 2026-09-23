//! Parses a JSONL transcript captured from a real `codex exec --json` run (codex-cli 0.153.2)
//! against a scratch repository, so the normalizer is pinned to real output, not a guess.

use silent_runtime::codex::events::parse_jsonl_line;
use silent_runtime::RuntimeEvent;

#[test]
fn real_codex_exec_transcript_normalizes_to_expected_sequence() {
    let raw = include_str!("fixtures/codex-exec-real.jsonl");
    let events: Vec<RuntimeEvent> = raw.lines().filter(|l| !l.trim().is_empty()).flat_map(parse_jsonl_line).collect();
    let kinds: Vec<String> = events
        .iter()
        .map(|e| serde_json::to_value(e).unwrap()["type"].as_str().unwrap().to_owned())
        .collect();

    assert_eq!(kinds[0], "threadStarted");
    assert_eq!(kinds[1], "turnStarted");
    assert!(kinds.contains(&"commandStarted".to_owned()), "{kinds:?}");
    assert!(kinds.contains(&"commandCompleted".to_owned()), "{kinds:?}");
    assert_eq!(kinds.iter().filter(|k| *k == "agentMessage").count(), 2, "{kinds:?}");
    assert!(kinds.contains(&"usage".to_owned()), "{kinds:?}");
    assert_eq!(kinds.last().unwrap(), "turnCompleted");
    // No raw stdout fallbacks: every real line was understood.
    assert!(!kinds.contains(&"stdout".to_owned()), "{kinds:?}");

    let json: Vec<serde_json::Value> = events.iter().map(|e| serde_json::to_value(e).unwrap()).collect();
    let usage = json.iter().find(|v| v["type"] == "usage").unwrap();
    assert_eq!(usage["data"]["inputTokens"], 35747);
    assert_eq!(usage["data"]["cachedInputTokens"], 30080);
    assert_eq!(usage["data"]["outputTokens"], 56);
    let cmd = json.iter().find(|v| v["type"] == "commandCompleted").unwrap();
    assert_eq!(cmd["data"]["exitCode"], 0);
    assert_eq!(cmd["data"]["outputTail"], "README.md\n");
    let last_msg = json.iter().filter(|v| v["type"] == "agentMessage").last().unwrap();
    assert_eq!(last_msg["data"]["text"], "OK");
}
