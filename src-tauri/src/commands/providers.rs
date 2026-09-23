//! Detect installed AI CLIs. Runs `<bin> --version` only; never invokes a model.

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use silent_runtime::cli::registry::{ProviderSpec, SPECS};
use tokio::process::Command;

use super::binaries;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedProvider {
    pub id: String,
    pub binary: String,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn extract_version(output: &str) -> Option<String> {
    let first = output.lines().find(|l| !l.trim().is_empty())?;
    first
        .split_whitespace()
        .map(|tok| {
            tok.trim_start_matches('v')
                .trim_matches(|c: char| c == '(' || c == ')' || c == ',')
        })
        .find(|tok| {
            let mut parts = tok.split('.');
            matches!((parts.next(), parts.next()), (Some(a), Some(b)) if !a.is_empty() && a.chars().all(|c| c.is_ascii_digit()) && b.chars().next().is_some_and(|c| c.is_ascii_digit()))
        })
        .map(ToOwned::to_owned)
}

async fn detect(spec: &ProviderSpec) -> DetectedProvider {
    let id = spec.id.as_str().to_owned();
    let binary = spec.binary.to_owned();
    let Some(path) = binaries::resolve_any(spec.binary, spec.alt_binaries) else {
        return DetectedProvider {
            id,
            binary,
            installed: false,
            version: None,
            path: None,
            error: None,
        };
    };
    let output = tokio::time::timeout(
        Duration::from_secs(3),
        Command::new(&path)
            .arg("--version")
            .env("PATH", binaries::augmented_path())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    let path_str = Some(path.display().to_string());
    match output {
        Ok(Ok(out)) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            DetectedProvider {
                id,
                binary,
                installed: true,
                version: extract_version(&text),
                path: path_str,
                error: (!out.status.success())
                    .then(|| format!("--version exited with {}", out.status)),
            }
        }
        Ok(Err(error)) => DetectedProvider {
            id,
            binary,
            installed: true,
            version: None,
            path: path_str,
            error: Some(error.to_string()),
        },
        Err(_) => DetectedProvider {
            id,
            binary,
            installed: true,
            version: None,
            path: path_str,
            error: Some("--version timed out after 3s".into()),
        },
    }
}

#[tauri::command]
pub async fn providers_detect() -> Result<Vec<DetectedProvider>, String> {
    let futures = SPECS.iter().map(detect);
    Ok(futures::future::join_all(futures).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_versions_from_common_formats() {
        assert_eq!(
            extract_version("codex-cli 0.153.2\n"),
            Some("0.153.2".into())
        );
        assert_eq!(extract_version("2.1.0 (Claude Code)"), Some("2.1.0".into()));
        assert_eq!(extract_version("v1.2"), Some("1.2".into()));
        assert_eq!(extract_version("no version here"), None);
    }
}
