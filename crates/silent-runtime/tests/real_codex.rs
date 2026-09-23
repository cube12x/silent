//! Spawns the real Codex CLI once. Ignored by default (needs `codex` on PATH and `codex login`).
//! Run: `cargo test -p silent-runtime --test real_codex -- --ignored --nocapture`

use std::sync::{Arc, Mutex};
use std::time::Duration;

use silent_runtime::{build_args, run_streaming, CodexRunRequest, RunExit, RunHandle, RuntimeEvent, SpawnConfig};

#[tokio::test]
#[ignore]
async fn real_codex_exec_roundtrip_streams_events_and_exits_zero() {
    let dir = std::env::temp_dir().join(format!("silent-real-codex-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("README.md"), "# scratch\n").unwrap();

    let request: CodexRunRequest = serde_json::from_value(serde_json::json!({
        "runId": "test",
        "prompt": "Reply with exactly the word OK and nothing else.",
        "cwd": dir.to_string_lossy(),
        "sandbox": "read-only",
        "ephemeral": true,
        "review": false,
        "skipGitRepoCheck": true
    }))
    .unwrap();
    let mut config = SpawnConfig::new("codex", build_args(&request));
    config.cwd = Some(dir.clone());
    config.timeout = Duration::from_secs(180);

    let events: Arc<Mutex<Vec<RuntimeEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_events = events.clone();
    let (_handle, cancel) = RunHandle::new();
    let exit = run_streaming(config, move |e| sink_events.lock().unwrap().push(e), cancel).await.unwrap();

    let kinds: Vec<String> = events
        .lock()
        .unwrap()
        .iter()
        .map(|e| serde_json::to_value(e).unwrap()["type"].as_str().unwrap().to_owned())
        .collect();
    eprintln!("exit={exit:?} kinds={kinds:?}");
    assert!(matches!(exit, RunExit::Exited(Some(0))), "{exit:?}");
    // Codex may print a stderr banner before its first JSONL line; the first *structured* event is the thread.
    let first_structured = kinds.iter().find(|k| *k != "stderr").map(String::as_str);
    assert_eq!(first_structured, Some("threadStarted"));
    assert!(kinds.contains(&"agentMessage".to_owned()));
    assert!(kinds.contains(&"turnCompleted".to_owned()));
    assert_eq!(kinds.last().map(String::as_str), Some("exited"));
    let _ = std::fs::remove_dir_all(dir);
}
