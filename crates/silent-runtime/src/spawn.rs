//! Spawns a CLI process and streams normalized `RuntimeEvent`s from its stdout/stderr.
//! Bounded line reads, wall-clock timeout, cooperative cancel (SIGTERM, then SIGKILL after grace).
//! The child runs in its own process group so its descendants are terminated with it.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::watch;

use crate::error::{RuntimeError, RuntimeResult};
use crate::events::{classify_error, RuntimeEvent};

/// Turns one stdout line into zero or more events. Built per run via `cli::line_parser`.
pub type LineParser = Box<dyn FnMut(&str) -> Vec<RuntimeEvent> + Send + 'static>;

#[derive(Debug, Clone)]
pub struct SpawnConfig {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    /// Soft wall-clock limit: once exceeded, the process is stopped at the next quiet moment (no output for 90 s).
    pub timeout: Duration,
    /// Kill regardless of activity when no output arrived for this long (hung CLI / stuck command).
    pub idle_timeout: Duration,
    /// Kill regardless of activity at `timeout * hard_factor` (a worker that never goes quiet).
    pub hard_factor: u32,
    pub shutdown_grace: Duration,
    pub max_line_bytes: usize,
}

impl SpawnConfig {
    pub fn new(program: impl Into<PathBuf>, args: Vec<String>) -> Self {
        Self {
            program: program.into(),
            args,
            cwd: None,
            timeout: Duration::from_secs(30 * 60),
            idle_timeout: Duration::from_secs(15 * 60),
            hard_factor: 2,
            shutdown_grace: Duration::from_secs(3),
            max_line_bytes: 4 * 1024 * 1024,
        }
    }
}

/// Handle returned to callers that want to cancel a run.
#[derive(Debug, Clone)]
pub struct RunHandle {
    pub cancel: watch::Sender<bool>,
}

impl RunHandle {
    pub fn new() -> (RunHandle, watch::Receiver<bool>) {
        let (tx, rx) = watch::channel(false);
        (RunHandle { cancel: tx }, rx)
    }

    pub fn cancel(&self) {
        let _ = self.cancel.send(true);
    }
}

/// Outcome of a finished run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunExit {
    /// Process exited on its own with this code (None when killed by a signal).
    Exited(Option<i32>),
    Cancelled,
    TimedOut,
}

fn isolate_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
}

#[cfg(unix)]
async fn signal_group(pid: u32, signal: &str) {
    let _ = Command::new("kill")
        .arg(format!("-{signal}"))
        .arg("--")
        .arg(format!("-{pid}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;
}

async fn terminate(child: &mut Child, grace: Duration) {
    let pid = child.id();
    #[cfg(unix)]
    if let Some(pid) = pid {
        signal_group(pid, "TERM").await;
    }
    #[cfg(not(unix))]
    {
        let _ = child.start_kill();
    }
    if tokio::time::timeout(grace, child.wait()).await.is_ok() {
        return;
    }
    #[cfg(unix)]
    if let Some(pid) = pid {
        signal_group(pid, "KILL").await;
    }
    let _ = child.start_kill();
    let _ = tokio::time::timeout(grace, child.wait()).await;
}

async fn pump_lines<R, F>(reader: R, max_line_bytes: usize, mut on_line: F) -> RuntimeResult<()>
where
    R: AsyncRead + Unpin,
    F: FnMut(String),
{
    let mut reader = BufReader::with_capacity(64 * 1024, reader);
    let mut buf: Vec<u8> = Vec::new();
    loop {
        buf.clear();
        let mut total = 0usize;
        // Read up to newline in bounded chunks so a pathological line cannot exhaust memory.
        loop {
            let available = reader.fill_buf().await?;
            if available.is_empty() {
                if buf.is_empty() {
                    return Ok(());
                }
                break;
            }
            match available.iter().position(|b| *b == b'\n') {
                Some(idx) => {
                    total += idx;
                    if total > max_line_bytes {
                        return Err(RuntimeError::LineTooLarge {
                            limit: max_line_bytes,
                        });
                    }
                    buf.extend_from_slice(&available[..idx]);
                    reader.consume(idx + 1);
                    break;
                }
                None => {
                    total += available.len();
                    if total > max_line_bytes {
                        return Err(RuntimeError::LineTooLarge {
                            limit: max_line_bytes,
                        });
                    }
                    buf.extend_from_slice(available);
                    let n = available.len();
                    reader.consume(n);
                }
            }
        }
        if buf.last() == Some(&b'\r') {
            buf.pop();
        }
        on_line(String::from_utf8_lossy(&buf).into_owned());
    }
}

/// Spawn `config.program`, feed every stdout line through `parser`, and stream events to `sink`
/// until exit, cancel or timeout. Always emits a final `RuntimeEvent::Exited` (code `None` on
/// cancel/timeout/signal).
pub async fn run_streaming<F>(
    config: SpawnConfig,
    mut parser: LineParser,
    sink: F,
    mut cancel: watch::Receiver<bool>,
) -> RuntimeResult<RunExit>
where
    F: Fn(RuntimeEvent) + Send + Sync + 'static,
{
    let sink: Arc<F> = Arc::new(sink);
    let mut command = Command::new(&config.program);
    command
        .args(&config.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = &config.cwd {
        command.current_dir(cwd);
    }
    isolate_process_group(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            sink(RuntimeEvent::Failed {
                code: "spawn_failed".into(),
                message: format!("{}: {error}", config.program.display()),
                retryable: false,
            });
            sink(RuntimeEvent::Exited { code: None });
            return Err(RuntimeError::Io(error));
        }
    };
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| RuntimeError::Unavailable("stdout pipe unavailable".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| RuntimeError::Unavailable("stderr pipe unavailable".into()))?;

    // Track whether the CLI already reported a structured failure, and remember the last
    // error-looking stderr line so a silent non-zero exit can still be explained.
    let failed_emitted = Arc::new(AtomicBool::new(false));
    let started = std::time::Instant::now();
    // Millis since `started` of the last stdout/stderr line: a worker that is still talking is not killed
    // at the soft limit (2026-09-24: a 40-min limit cut a Claude worker mid-command; the session resumed
    // but the in-flight work was lost).
    let last_output = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let last_error_line: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    let out_sink = Arc::clone(&sink);
    let out_failed = Arc::clone(&failed_emitted);
    let out_last = Arc::clone(&last_output);
    let max_line = config.max_line_bytes;
    let stdout_task = tokio::spawn(async move {
        pump_lines(stdout, max_line, |line| {
            out_last.store(started.elapsed().as_millis() as u64, Ordering::Relaxed);
            for event in parser(&line) {
                if matches!(event, RuntimeEvent::Failed { .. }) {
                    out_failed.store(true, Ordering::Relaxed);
                }
                out_sink(event.redacted());
            }
        })
        .await
    });
    let err_sink = Arc::clone(&sink);
    let err_last = Arc::clone(&last_error_line);
    let err_last_out = Arc::clone(&last_output);
    let stderr_task = tokio::spawn(async move {
        pump_lines(stderr, max_line, |line| {
            err_last_out.store(started.elapsed().as_millis() as u64, Ordering::Relaxed);
            if !line.trim().is_empty() {
                let lower = line.to_ascii_lowercase();
                if lower.contains("error") || lower.contains("failed") || lower.contains("invalid")
                {
                    if let Ok(mut slot) = err_last.lock() {
                        *slot = Some(line.trim().to_owned());
                    }
                }
                err_sink(RuntimeEvent::Stderr { line }.redacted());
            }
        })
        .await
    });

    let hard = config.timeout.saturating_mul(config.hard_factor.max(1));
    let quiet = Duration::from_secs(90).min(config.timeout / 2);
    let tick = Duration::from_secs(5)
        .min(config.timeout / 4)
        .max(Duration::from_millis(50));
    let watch_last = Arc::clone(&last_output);
    let deadline = async move {
        loop {
            tokio::time::sleep(tick).await;
            let elapsed = started.elapsed();
            let idle =
                elapsed.saturating_sub(Duration::from_millis(watch_last.load(Ordering::Relaxed)));
            if idle >= config.idle_timeout {
                return format!("no output for {} s", idle.as_secs());
            }
            if elapsed >= hard {
                return format!("hard limit {} s", hard.as_secs());
            }
            if elapsed >= config.timeout && idle >= quiet {
                return format!(
                    "{} s limit reached, stopped at a quiet moment",
                    config.timeout.as_secs()
                );
            }
        }
    };
    let exit = tokio::select! {
        status = child.wait() => match status {
            Ok(status) => RunExit::Exited(status.code()),
            Err(error) => {
                sink(RuntimeEvent::Failed { code: "wait_failed".into(), message: error.to_string(), retryable: false });
                RunExit::Exited(None)
            }
        },
        reason = deadline => {
            terminate(&mut child, config.shutdown_grace).await;
            sink(RuntimeEvent::Failed {
                code: "timeout".into(),
                message: format!("process exceeded {} s timeout ({reason})", config.timeout.as_secs()),
                retryable: false,
            });
            RunExit::TimedOut
        },
        _ = wait_for_cancel(&mut cancel) => {
            terminate(&mut child, config.shutdown_grace).await;
            sink(RuntimeEvent::Failed { code: "cancelled".into(), message: "run cancelled by user".into(), retryable: false });
            RunExit::Cancelled
        }
    };

    // Drain readers (pipes close once the process tree is gone); tolerate reader errors.
    for task in [stdout_task, stderr_task] {
        match tokio::time::timeout(config.shutdown_grace, task).await {
            Ok(Ok(Err(error))) => sink(RuntimeEvent::Stderr {
                line: format!("[silent] reader stopped: {error}"),
            }),
            Ok(Err(join)) => sink(RuntimeEvent::Stderr {
                line: format!("[silent] reader panicked: {join}"),
            }),
            Err(_) => sink(RuntimeEvent::Stderr {
                line: "[silent] reader drain timed out".into(),
            }),
            Ok(Ok(Ok(()))) => {}
        }
    }

    let code = match &exit {
        RunExit::Exited(code) => *code,
        _ => None,
    };
    if let RunExit::Exited(Some(status)) = &exit {
        if *status != 0 && !failed_emitted.load(Ordering::Relaxed) {
            let detail = last_error_line
                .lock()
                .ok()
                .and_then(|slot| slot.clone())
                .unwrap_or_else(|| format!("process exited with code {status}"));
            let (code, retryable) = classify_error(&detail, "exit_nonzero");
            sink(
                RuntimeEvent::Failed {
                    code,
                    message: detail,
                    retryable,
                }
                .redacted(),
            );
        }
    }
    sink(RuntimeEvent::Exited { code });
    Ok(exit)
}

async fn wait_for_cancel(cancel: &mut watch::Receiver<bool>) {
    loop {
        if *cancel.borrow() {
            return;
        }
        if cancel.changed().await.is_err() {
            // Sender dropped: nobody can cancel anymore; park forever.
            std::future::pending::<()>().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::{line_parser, ProviderId};
    use std::time::Instant;

    fn collector() -> (
        Arc<Mutex<Vec<RuntimeEvent>>>,
        impl Fn(RuntimeEvent) + Send + Sync + 'static,
    ) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let writer = Arc::clone(&events);
        (events, move |event| writer.lock().unwrap().push(event))
    }

    #[tokio::test]
    async fn streams_parsed_events_then_exits() {
        let (events, sink) = collector();
        let (_handle, rx) = RunHandle::new();
        let config = SpawnConfig::new(
            "/bin/sh",
            vec![
                "-c".into(),
                r#"echo '{"type":"thread.started","thread_id":"t1"}'; echo plain; echo err 1>&2; exit 3"#.into(),
            ],
        );
        let exit = run_streaming(config, line_parser(ProviderId::Codex), sink, rx)
            .await
            .unwrap();
        assert_eq!(exit, RunExit::Exited(Some(3)));
        let events = events.lock().unwrap().clone();
        assert_eq!(
            events.first(),
            Some(&RuntimeEvent::SessionStarted {
                session_id: "t1".into()
            })
        );
        assert!(events.contains(&RuntimeEvent::Stdout {
            line: "plain".into()
        }));
        assert!(events.contains(&RuntimeEvent::Stderr { line: "err".into() }));
        assert!(
            matches!(&events[events.len() - 2], RuntimeEvent::Failed { code, message, .. } if code == "exit_nonzero" && message.contains("code 3"))
        );
        assert_eq!(events.last(), Some(&RuntimeEvent::Exited { code: Some(3) }));
    }

    #[tokio::test]
    async fn cancel_terminates_promptly() {
        let (events, sink) = collector();
        let (handle, rx) = RunHandle::new();
        let mut config = SpawnConfig::new("/bin/sh", vec!["-c".into(), "sleep 30".into()]);
        config.shutdown_grace = Duration::from_secs(2);
        let task = tokio::spawn(run_streaming(
            config,
            line_parser(ProviderId::Codex),
            sink,
            rx,
        ));
        tokio::time::sleep(Duration::from_millis(200)).await;
        let started = Instant::now();
        handle.cancel();
        let exit = task.await.unwrap().unwrap();
        assert_eq!(exit, RunExit::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(5));
        let events = events.lock().unwrap().clone();
        assert!(
            matches!(events.iter().find(|e| matches!(e, RuntimeEvent::Failed { .. })), Some(RuntimeEvent::Failed { code, .. }) if code == "cancelled")
        );
        assert_eq!(events.last(), Some(&RuntimeEvent::Exited { code: None }));
    }

    #[tokio::test]
    async fn active_process_outlives_soft_limit_until_hard_limit() {
        let (events, sink) = collector();
        let (_handle, rx) = RunHandle::new();
        // Prints every 50 ms: never quiet, so the soft limit (400 ms) must not kill it; the hard limit (800 ms) must.
        let mut config = SpawnConfig::new(
            "/bin/sh",
            vec![
                "-c".into(),
                "while true; do echo tick; sleep 0.05; done".into(),
            ],
        );
        config.timeout = Duration::from_millis(400);
        config.hard_factor = 2;
        config.idle_timeout = Duration::from_secs(60);
        config.shutdown_grace = Duration::from_secs(2);
        let started = Instant::now();
        let exit = run_streaming(config, line_parser(ProviderId::Codex), sink, rx)
            .await
            .unwrap();
        let elapsed = started.elapsed();
        assert_eq!(exit, RunExit::TimedOut);
        assert!(
            elapsed >= Duration::from_millis(750),
            "killed too early: {elapsed:?}"
        );
        let events = events.lock().unwrap().clone();
        assert!(events.iter().any(|e| matches!(e, RuntimeEvent::Failed { code, message, .. } if code == "timeout" && message.contains("hard limit"))), "{events:?}");
    }

    #[tokio::test]
    async fn timeout_kills_process() {
        let (events, sink) = collector();
        let (_handle, rx) = RunHandle::new();
        let mut config = SpawnConfig::new("/bin/sh", vec!["-c".into(), "sleep 30".into()]);
        config.timeout = Duration::from_millis(300);
        config.shutdown_grace = Duration::from_secs(2);
        let exit = run_streaming(config, line_parser(ProviderId::Codex), sink, rx)
            .await
            .unwrap();
        assert_eq!(exit, RunExit::TimedOut);
        let events = events.lock().unwrap().clone();
        assert!(
            events.iter().any(|e| matches!(e, RuntimeEvent::Failed { code, retryable: false, .. } if code == "timeout")),
            "{events:?}"
        );
        assert_eq!(events.last(), Some(&RuntimeEvent::Exited { code: None }));
    }

    #[tokio::test]
    async fn missing_binary_reports_spawn_failure() {
        let (events, sink) = collector();
        let (_handle, rx) = RunHandle::new();
        let config = SpawnConfig::new("/nonexistent/silent-binary", vec![]);
        assert!(
            run_streaming(config, line_parser(ProviderId::Codex), sink, rx)
                .await
                .is_err()
        );
        let events = events.lock().unwrap().clone();
        assert!(matches!(&events[0], RuntimeEvent::Failed { code, .. } if code == "spawn_failed"));
        assert_eq!(events.last(), Some(&RuntimeEvent::Exited { code: None }));
    }

    #[tokio::test]
    async fn oversized_line_is_reported_not_fatal() {
        let (events, sink) = collector();
        let (_handle, rx) = RunHandle::new();
        let mut config = SpawnConfig::new(
            "/bin/sh",
            vec![
                "-c".into(),
                "head -c 5000 /dev/zero | tr '\\0' x; echo".into(),
            ],
        );
        config.max_line_bytes = 1024;
        let exit = run_streaming(config, line_parser(ProviderId::Codex), sink, rx)
            .await
            .unwrap();
        assert!(matches!(exit, RunExit::Exited(_)));
        let events = events.lock().unwrap().clone();
        assert!(events.iter().any(
            |e| matches!(e, RuntimeEvent::Stderr { line } if line.contains("reader stopped"))
        ));
        assert!(matches!(events.last(), Some(RuntimeEvent::Exited { .. })));
    }
}
