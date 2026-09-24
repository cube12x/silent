//! Spawns the real CLIs once each. Ignored by default (needs the binary on PATH and a login).
//! Run: `cargo test -p silent-runtime --test real_cli -- --ignored --nocapture`

use std::sync::{Arc, Mutex};
use std::time::Duration;

use silent_runtime::cli::line_parser;
use silent_runtime::{
    adapter_for, run_streaming, CliRunRequest, ProviderId, RunExit, RunHandle, RuntimeEvent,
    SandboxMode, SpawnConfig,
};

async fn roundtrip(provider: ProviderId) -> (RunExit, Vec<String>) {
    let dir = std::env::temp_dir().join(format!("silent-real-{}-{}", provider, std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("README.md"), "# scratch\n").unwrap();
    let request = CliRunRequest {
        run_id: "test".into(),
        provider_id: provider,
        model_id: None,
        prompt: "Reply with exactly the word OK and nothing else.".into(),
        cwd: Some(dir.to_string_lossy().into_owned()),
        sandbox: SandboxMode::ReadOnly,
        resume_session_id: None,
        ephemeral: true,
        review: None,
        effort: None,
        timeout_secs: None,
        output_schema: None,
    };
    let adapter = adapter_for(provider);
    let mut config = SpawnConfig::new(adapter.binary(), adapter.build_args(&request));
    config.cwd = Some(dir.clone());
    config.timeout = Duration::from_secs(180);
    let events: Arc<Mutex<Vec<RuntimeEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_events = events.clone();
    let (_handle, cancel) = RunHandle::new();
    let exit = run_streaming(
        config,
        line_parser(provider),
        move |e| sink_events.lock().unwrap().push(e),
        cancel,
    )
    .await
    .unwrap();
    let kinds = events
        .lock()
        .unwrap()
        .iter()
        .map(|e| {
            serde_json::to_value(e).unwrap()["type"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect::<Vec<_>>();
    eprintln!("{provider}: exit={exit:?} kinds={kinds:?}");
    let _ = std::fs::remove_dir_all(dir);
    (exit, kinds)
}

fn assert_ok(exit: RunExit, kinds: &[String]) {
    assert!(matches!(exit, RunExit::Exited(Some(0))), "{exit:?}");
    let first_structured = kinds.iter().find(|k| *k != "stderr").map(String::as_str);
    assert_eq!(first_structured, Some("sessionStarted"));
    assert!(kinds.contains(&"agentMessage".to_owned()) || kinds.contains(&"textDelta".to_owned()));
    assert!(kinds.contains(&"turnCompleted".to_owned()));
    assert_eq!(kinds.last().map(String::as_str), Some("exited"));
}

#[tokio::test]
#[ignore]
async fn real_codex() {
    let (exit, kinds) = roundtrip(ProviderId::Codex).await;
    assert_ok(exit, &kinds);
}

#[tokio::test]
#[ignore]
async fn real_claude() {
    let (exit, kinds) = roundtrip(ProviderId::Claude).await;
    assert_ok(exit, &kinds);
}

#[tokio::test]
#[ignore]
async fn real_kimi() {
    let (exit, kinds) = roundtrip(ProviderId::Kimi).await;
    assert_ok(exit, &kinds);
}

/// Structured output through Codex `--output-schema`: the final agent message must be JSON that
/// matches the schema. Small, cheap call (fast model, low effort, read-only).
#[tokio::test]
#[ignore]
async fn codex_output_schema_returns_matching_json() {
    let dir = std::env::temp_dir().join(format!("silent-real-schema-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let request = CliRunRequest {
        run_id: "schema-test".into(),
        provider_id: ProviderId::Codex,
        // NOTE: on ChatGPT-account Codex some catalog models (e.g. gpt-6-luna) are rejected; use the default.
        model_id: None,
        prompt: "Reply with ok=true and answer=OK".into(),
        cwd: Some(dir.to_string_lossy().into_owned()),
        sandbox: SandboxMode::ReadOnly,
        resume_session_id: None,
        ephemeral: true,
        review: None,
        effort: Some("low".into()),
        timeout_secs: Some(180),
        output_schema: Some(serde_json::json!({
            "type": "object",
            "properties": { "ok": { "type": "boolean" }, "answer": { "type": "string" } },
            "required": ["ok", "answer"],
            "additionalProperties": false
        })),
    };
    let adapter = adapter_for(ProviderId::Codex);
    let mut config = SpawnConfig::new(adapter.binary(), adapter.build_args(&request));
    config.timeout = Duration::from_secs(180);
    let events: Arc<Mutex<Vec<RuntimeEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_events = events.clone();
    let (_handle, cancel) = RunHandle::new();
    let exit = run_streaming(
        config,
        line_parser(ProviderId::Codex),
        move |e| sink_events.lock().unwrap().push(e),
        cancel,
    )
    .await
    .unwrap();
    let _ = std::fs::remove_file(request.schema_file_path());
    let _ = std::fs::remove_dir_all(dir);
    let all = events.lock().unwrap().clone();
    for e in &all {
        if let RuntimeEvent::Stderr { line } | RuntimeEvent::Stdout { line } = e {
            eprintln!("  {line}");
        }
        if let RuntimeEvent::Failed { code, message, .. } = e {
            eprintln!("  failed {code}: {message}");
        }
    }
    assert!(matches!(exit, RunExit::Exited(Some(0))), "{exit:?}");
    let last = all
        .iter()
        .rev()
        .find_map(|e| match e {
            RuntimeEvent::AgentMessage { text } => Some(text.clone()),
            _ => None,
        })
        .expect("an agent message");
    eprintln!("codex structured output: {last}");
    let parsed: serde_json::Value = serde_json::from_str(last.trim()).expect("valid JSON");
    assert_eq!(parsed["ok"], serde_json::Value::Bool(true));
    assert!(parsed["answer"].is_string());
}
