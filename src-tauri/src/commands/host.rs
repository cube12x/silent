//! Host load for the load guard (Faz 3): the webview polls this and caps concurrent AI sessions when the
//! machine is starved (four CLIs plus a build pushed the host into swap on 2026-09-30).

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostLoad {
    pub load1: f64,
    pub cpus: u32,
    pub swap_used_pct: Option<f64>,
}

/// `{ 1.23 4.56 7.89 }` (macOS sysctl vm.loadavg) or `1.23 4.56 7.89 1/234 5678` (/proc/loadavg).
pub fn parse_load1(text: &str) -> Option<f64> {
    // Locales with a decimal comma (tr_TR) print `{ 59,25 94,45 … }` — seen in the installed app on 2026-09-30.
    text.split(|c: char| c.is_whitespace() || c == '{' || c == '}').find(|t| !t.is_empty())?.replace(',', ".").parse().ok()
}

/// macOS `sysctl -n vm.swapusage`: `total = 2048.00M  used = 1024.00M  free = 1024.00M  (encrypted)`.
pub fn parse_swap_pct_macos(text: &str) -> Option<f64> {
    fn val(text: &str, key: &str) -> Option<f64> {
        let i = text.find(key)? + key.len();
        let rest = text[i..].trim_start_matches([' ', '=']).trim_start();
        let num: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',').collect::<String>().replace(',', ".");
        let unit = rest[num.len()..].chars().next().unwrap_or('M');
        let n: f64 = num.parse().ok()?;
        Some(match unit {
            'K' => n / 1024.0,
            'G' => n * 1024.0,
            _ => n,
        })
    }
    let total = val(text, "total")?;
    let used = val(text, "used")?;
    if total <= 0.0 {
        return Some(0.0);
    }
    Some((used / total * 100.0).clamp(0.0, 100.0))
}

/// Linux /proc/meminfo: SwapTotal / SwapFree lines.
pub fn parse_swap_pct_linux(text: &str) -> Option<f64> {
    fn kb(text: &str, key: &str) -> Option<f64> {
        text.lines().find(|l| l.starts_with(key))?.split_whitespace().nth(1)?.parse().ok()
    }
    let total = kb(text, "SwapTotal:")?;
    let free = kb(text, "SwapFree:")?;
    if total <= 0.0 {
        return Some(0.0);
    }
    Some(((total - free) / total * 100.0).clamp(0.0, 100.0))
}

fn sysctl(key: &str) -> Option<String> {
    let out = std::process::Command::new("sysctl").arg("-n").arg(key).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn read_host_load() -> HostLoad {
    let cpus = std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(1);
    let (load1, swap) = if cfg!(target_os = "macos") {
        (sysctl("vm.loadavg").and_then(|s| parse_load1(&s)), sysctl("vm.swapusage").and_then(|s| parse_swap_pct_macos(&s)))
    } else if cfg!(target_os = "linux") {
        (
            std::fs::read_to_string("/proc/loadavg").ok().and_then(|s| parse_load1(&s)),
            std::fs::read_to_string("/proc/meminfo").ok().and_then(|s| parse_swap_pct_linux(&s)),
        )
    } else {
        (None, None)
    };
    HostLoad { load1: load1.unwrap_or(0.0), cpus, swap_used_pct: swap }
}

#[tauri::command]
pub async fn host_load() -> HostLoad {
    tokio::task::spawn_blocking(read_host_load).await.unwrap_or(HostLoad { load1: 0.0, cpus: 1, swap_used_pct: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_load_averages_from_both_platforms() {
        assert_eq!(parse_load1("{ 3.52 4.10 4.35 }"), Some(3.52));
        assert_eq!(parse_load1("0.61 0.70 0.75 2/1234 5678\n"), Some(0.61));
        assert_eq!(parse_load1(""), None);
        assert_eq!(parse_load1("{ 59,25 94,45 138,88 }"), Some(59.25));
    }

    #[test]
    fn parses_swap_usage() {
        assert_eq!(parse_swap_pct_macos("total = 2048.00M  used = 1024.00M  free = 1024.00M  (encrypted)"), Some(50.0));
        assert_eq!(parse_swap_pct_macos("total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)"), Some(0.0));
        assert_eq!(parse_swap_pct_macos("total = 1.00G  used = 256.00M  free = 768.00M"), Some(25.0));
        assert_eq!(parse_swap_pct_linux("MemTotal: 100 kB\nSwapTotal:       8000 kB\nSwapFree:        2000 kB\n"), Some(75.0));
        assert_eq!(parse_swap_pct_linux("SwapTotal: 0 kB\nSwapFree: 0 kB\n"), Some(0.0));
    }

    #[test]
    fn reads_the_live_host_without_panicking() {
        let h = read_host_load();
        assert!(h.cpus >= 1);
        assert!(h.load1 >= 0.0);
    }
}
