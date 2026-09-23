# Silent

**Masaüstü, CLI-native çoklu-AI orkestrasyon istasyonu.** Tek istek yazarsın; Silent onu alt görevlere böler, her birini makinendeki gerçek AI CLI'larından en uygun modele yönlendirir, terminalde çalıştırır ve canlı izler. API anahtarı yok, simülasyon yok: yalnızca kurulu CLI'lar.

> v2 (2026-09-23): 4 ekran (Sohbet · Silent Code · Ajanlar · Ayarlar), 10 CLI adaptörü, Türkçe/İngilizce arayüz, hayalet logo.

## Desteklenen CLI'lar

| CLI | Binary | Kur | Ayrıştırıcı |
|---|---|---|---|
| Codex (OpenAI) | `codex` | `npm i -g @openai/codex` | doğrulanmış (gerçek transkript) |
| Claude Code (Anthropic) | `claude` | `curl -fsSL https://claude.ai/install.sh \| bash` | doğrulanmış |
| Kimi Code (Moonshot) | `kimi` | `curl -fsSL https://code.kimi.com/install.sh \| bash` | doğrulanmış |
| Grok Build (xAI) | `grok` | `curl -fsSL https://x.ai/cli/install.sh \| bash` | beta |
| Gemini CLI (Google) | `gemini` | `npm i -g @google/gemini-cli` | beta |
| Qwen Code (Alibaba) | `qwen` | `npm i -g @qwen-code/qwen-code` | beta |
| OpenCode | `opencode` | `npm i -g opencode-ai` | beta |
| Copilot CLI (GitHub) | `copilot` | `npm i -g @github/copilot` | beta |
| Cursor Agent | `agent` | `curl https://cursor.com/install -fsS \| bash` | beta |
| Amp (Sourcegraph) | `amp` | `npm i -g @ampcode/cli` | beta |

Kurulu olmayanlar Ayarlar > CLI'lar'da **Kur** butonuyla kurulur (çıktı uygulama içinde akar), **Giriş yap** Terminal.app'te ilgili login komutunu açar. Her CLI'ın modelleri kendi yerel kataloğundan okunur (Codex `models_cache.json`, Kimi `config.toml`, Claude alias + `settings.json`); istediğin model kimliğini elle ekleyebilir, sohbette `/model <id>` veya `/cli <ad>` ile anında değiştirebilirsin. "beta" ayrıştırıcılar dokümana göre yazıldı; tanınmayan satırlar terminale ham düşer, asla çökmez.

## Çalıştırma

```bash
npm install
npm run tauri:dev
```

Kontroller:

```bash
npm run typecheck && npm run lint && npm run test     # TS + motor + i18n testleri
cargo test --workspace                                # Rust runtime (gerçek Codex/Claude/Kimi transkript fixture'ları)
cargo test -p silent-runtime -- --ignored             # kurulu CLI'ları gerçekten çağırır (küçük prompt)
npm run build && npx tauri build --debug --no-bundle
VITE_SILENT_PREVIEW=1 npm run dev                     # yalnız görsel önizleme: katalog görünür, hiçbir şey çalışmaz
```

## Yapı

```
src/app             kabuk: Sidebar · TopBar · ⌘K palet · hayalet logo (SilentMark)
src/features        chat · silent-code (plan + canlı çalıştırma + terminal drawer) · agents · settings · new-session-modal
src/engine          planner · router · executor (retry → fallback → escalation) · workers/CliWorker
src/providers       10 CLI'lık registry (binary, kurulum, login, yetenekler)
src/i18n            tr · en
src/services        TauriBackend (gerçek) · TestBackend (yalnız test)
crates/silent-runtime   Rust: spawn · cli/<adaptör>.rs (argv + JSONL → RuntimeEvent) · generic fallback · redaction
src-tauri           komutlar: providers_detect · provider_models · provider_install · provider_login · cli_run_start · cli_run_cancel
```

## Güvenlik

Onaylar her zaman kapalı (`-a never` / `--permission-prompts none`), sandbox tavanı workspace-write (Codex'te gerçek sandbox; diğerlerinde salt-okunur brief ile), gizli anahtarlar çıktıya ulaşmadan maskelenir, ham akıl yürütme metni gösterilmez. Git push varsayılan kapalı ve bir Gateway promptuyla asla açılamaz. Silent hiçbir kimlik bilgisi saklamaz; her CLI kendi girişini kullanır.
