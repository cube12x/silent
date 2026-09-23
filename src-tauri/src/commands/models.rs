//! Discover the models each installed CLI exposes, from its local catalog/config files.
//! Never fails: a missing or unreadable file yields an empty list.

use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;
use silent_runtime::cli::ProviderId;

use super::binaries::home;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub provider_id: String,
    pub display_name: String,
    pub source: &'static str,
    pub tier: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_default: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<std::collections::BTreeMap<String, String>>,
}

fn model(
    provider: ProviderId,
    id: &str,
    display: &str,
    source: &'static str,
    tier: &'static str,
) -> ProviderModel {
    ProviderModel {
        id: id.to_owned(),
        provider_id: provider.as_str().to_owned(),
        display_name: display.to_owned(),
        source,
        tier,
        is_default: None,
        meta: None,
    }
}

fn read(path: PathBuf) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

fn tier_from_name(id: &str, frontier_hint: bool) -> &'static str {
    let lower = id.to_ascii_lowercase();
    if lower.contains("mini")
        || lower.contains("nano")
        || lower.contains("fast")
        || lower.contains("flash")
        || lower.contains("highspeed")
        || lower.contains("haiku")
        || lower.contains("lite")
    {
        "fast"
    } else if frontier_hint {
        "frontier"
    } else {
        "strong"
    }
}

fn mark_default(models: &mut [ProviderModel], default_id: Option<&str>) {
    if let Some(default_id) = default_id {
        for m in models.iter_mut() {
            if m.id == default_id {
                m.is_default = Some(true);
            }
        }
    }
}

// ---- codex ------------------------------------------------------------------------------------

pub fn codex_models() -> Vec<ProviderModel> {
    let Some(home) = home() else {
        return Vec::new();
    };
    let mut models = Vec::new();
    if let Some(raw) = read(home.join(".codex/models_cache.json")) {
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            for entry in value
                .get("models")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(slug) = entry.get("slug").and_then(Value::as_str) else {
                    continue;
                };
                let visible = entry
                    .get("visibility")
                    .and_then(Value::as_str)
                    .map_or(true, |v| v == "list");
                if !visible {
                    continue;
                }
                let display = entry
                    .get("display_name")
                    .and_then(Value::as_str)
                    .unwrap_or(slug);
                let priority = entry.get("priority").and_then(Value::as_u64).unwrap_or(99);
                let mut m = model(
                    ProviderId::Codex,
                    slug,
                    display,
                    "catalog",
                    tier_from_name(slug, priority <= 1),
                );
                let mut meta = std::collections::BTreeMap::new();
                if let Some(desc) = entry.get("description").and_then(Value::as_str) {
                    meta.insert("description".into(), desc.to_owned());
                }
                let efforts: Vec<&str> = entry
                    .get("supported_reasoning_levels")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|l| l.get("effort").and_then(Value::as_str))
                    .collect();
                if !efforts.is_empty() {
                    meta.insert("efforts".into(), efforts.join(","));
                }
                if let Some(default_effort) =
                    entry.get("default_reasoning_level").and_then(Value::as_str)
                {
                    meta.insert("defaultEffort".into(), default_effort.to_owned());
                }
                m.meta = Some(meta);
                models.push(m);
            }
        }
    }
    let default_id = read(home.join(".codex/config.toml"))
        .and_then(|raw| raw.parse::<toml::Table>().ok())
        .and_then(|t| {
            t.get("model")
                .and_then(|v| v.as_str().map(ToOwned::to_owned))
        });
    if let Some(default_id) = default_id.as_deref() {
        if !models.iter().any(|m| m.id == default_id) {
            models.insert(
                0,
                model(
                    ProviderId::Codex,
                    default_id,
                    default_id,
                    "config",
                    "frontier",
                ),
            );
        }
    }
    mark_default(&mut models, default_id.as_deref());
    models
}

// ---- claude -----------------------------------------------------------------------------------

pub fn claude_models() -> Vec<ProviderModel> {
    let mut models = vec![
        model(
            ProviderId::Claude,
            "fable",
            "Claude Fable (latest)",
            "alias",
            "frontier",
        ),
        model(
            ProviderId::Claude,
            "opus",
            "Claude Opus (latest)",
            "alias",
            "frontier",
        ),
        model(
            ProviderId::Claude,
            "sonnet",
            "Claude Sonnet (latest)",
            "alias",
            "strong",
        ),
        model(
            ProviderId::Claude,
            "haiku",
            "Claude Haiku (latest)",
            "alias",
            "fast",
        ),
    ];
    let configured = home()
        .and_then(|h| read(h.join(".claude/settings.json")))
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| {
            v.get("model")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        });
    if let Some(configured) = configured {
        let id = configured
            .split('[')
            .next()
            .unwrap_or(&configured)
            .trim()
            .to_owned();
        if !id.is_empty() && !models.iter().any(|m| m.id == id) {
            let frontier = id.contains("fable") || id.contains("opus");
            models.insert(
                0,
                model(
                    ProviderId::Claude,
                    &id,
                    &configured,
                    "config",
                    tier_from_name(&id, frontier),
                ),
            );
        }
        mark_default(&mut models, Some(&id));
    }
    models
}

// ---- kimi -------------------------------------------------------------------------------------

pub fn kimi_models() -> Vec<ProviderModel> {
    let Some(raw) = home().and_then(|h| read(h.join(".kimi-code/config.toml"))) else {
        return Vec::new();
    };
    let Ok(table) = raw.parse::<toml::Table>() else {
        return Vec::new();
    };
    let mut models = Vec::new();
    if let Some(entries) = table.get("models").and_then(|m| m.as_table()) {
        for (id, entry) in entries {
            let display = entry
                .get("display_name")
                .and_then(|v| v.as_str())
                .unwrap_or(id);
            let mut m = model(
                ProviderId::Kimi,
                id,
                display,
                "catalog",
                tier_from_name(id, id.to_ascii_lowercase().contains("k3")),
            );
            let mut meta = std::collections::BTreeMap::new();
            if let Some(ctx) = entry.get("max_context_size").and_then(|v| v.as_integer()) {
                meta.insert("contextWindow".into(), ctx.to_string());
            }
            if let Some(efforts) = entry.get("support_efforts").and_then(|v| v.as_array()) {
                let list: Vec<&str> = efforts.iter().filter_map(|e| e.as_str()).collect();
                if !list.is_empty() {
                    meta.insert("efforts".into(), list.join(","));
                }
            }
            if !meta.is_empty() {
                m.meta = Some(meta);
            }
            models.push(m);
        }
    }
    let default_id = table
        .get("default_model")
        .and_then(|v| v.as_str().map(ToOwned::to_owned));
    mark_default(&mut models, default_id.as_deref());
    models
}

// ---- grok -------------------------------------------------------------------------------------

pub fn grok_models() -> Vec<ProviderModel> {
    let mut models = Vec::new();
    if let Some(raw) = home().and_then(|h| read(h.join(".grok/config.toml"))) {
        if let Ok(table) = raw.parse::<toml::Table>() {
            if let Some(entries) = table.get("models").and_then(|m| m.as_table()) {
                for (id, entry) in entries {
                    let display = entry
                        .get("display_name")
                        .or_else(|| entry.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(id);
                    models.push(model(
                        ProviderId::Grok,
                        id,
                        display,
                        "config",
                        tier_from_name(id, true),
                    ));
                }
            }
            let default_id = table
                .get("model")
                .or_else(|| table.get("default_model"))
                .and_then(|v| v.as_str().map(ToOwned::to_owned));
            if let Some(d) = default_id.as_deref() {
                if !models.iter().any(|m| m.id == d) {
                    models.insert(0, model(ProviderId::Grok, d, d, "config", "frontier"));
                }
            }
            mark_default(&mut models, default_id.as_deref());
        }
    }
    if models.is_empty() {
        let mut m = model(
            ProviderId::Grok,
            "grok-4.7",
            "Grok 4.7",
            "alias",
            "frontier",
        );
        m.is_default = Some(true);
        models.push(m);
    }
    models
}

// ---- gemini / qwen ------------------------------------------------------------------------------

fn settings_model(provider: ProviderId, rel: &str) -> Vec<ProviderModel> {
    let configured = home()
        .and_then(|h| read(h.join(rel)))
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| {
            v.get("model").and_then(|m| {
                m.as_str()
                    .map(ToOwned::to_owned)
                    .or_else(|| m.get("name").and_then(Value::as_str).map(ToOwned::to_owned))
            })
        });
    match configured {
        Some(id) => {
            let mut m = model(
                provider,
                &id,
                &id,
                "config",
                tier_from_name(&id, id.contains("pro") || id.contains("plus")),
            );
            m.is_default = Some(true);
            vec![m]
        }
        None => Vec::new(),
    }
}

#[tauri::command]
pub async fn provider_models(provider_id: ProviderId) -> Result<Vec<ProviderModel>, String> {
    Ok(match provider_id {
        ProviderId::Codex => codex_models(),
        ProviderId::Claude => claude_models(),
        ProviderId::Kimi => kimi_models(),
        ProviderId::Grok => grok_models(),
        ProviderId::Gemini => settings_model(ProviderId::Gemini, ".gemini/settings.json"),
        ProviderId::Qwen => settings_model(ProviderId::Qwen, ".qwen/settings.json"),
        ProviderId::Opencode | ProviderId::Copilot | ProviderId::Cursor | ProviderId::Amp => {
            Vec::new()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiers_and_defaults() {
        assert_eq!(tier_from_name("gpt-6-astra", true), "frontier");
        assert_eq!(tier_from_name("gpt-5-mini", true), "fast");
        assert_eq!(tier_from_name("kimi-code/k3-256k", true), "frontier");
        assert_eq!(
            tier_from_name("kimi-code/kimi-for-coding-highspeed", false),
            "fast"
        );
        let mut models = vec![model(ProviderId::Codex, "a", "A", "catalog", "strong")];
        mark_default(&mut models, Some("a"));
        assert_eq!(models[0].is_default, Some(true));
    }

    #[test]
    fn claude_always_has_aliases() {
        let models = claude_models();
        assert!(models.iter().any(|m| m.id == "fable"));
        assert!(models.iter().any(|m| m.id == "haiku" && m.tier == "fast"));
    }

    #[test]
    fn grok_falls_back_to_documented_default() {
        assert!(grok_models()
            .iter()
            .any(|m| m.id == "grok-4.7" || m.is_default == Some(true)));
    }

    #[test]
    fn serializes_camel_case() {
        let m = model(ProviderId::Kimi, "k3", "K3", "catalog", "frontier");
        let v = serde_json::to_value(m).unwrap();
        assert_eq!(v["providerId"], "kimi");
        assert_eq!(v["displayName"], "K3");
        assert!(v.get("isDefault").is_none());
    }
}
