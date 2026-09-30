# Silent

**Masaüstü, CLI-native çoklu-AI orkestrasyon istasyonu.** Tek istek yazarsın; Silent onu alt görevlere böler, her birini makinendeki gerçek AI CLI'larından en uygun modele yönlendirir, terminalde çalıştırır ve canlı izler. API anahtarı yok, simülasyon yok: yalnızca kurulu CLI'lar.

> v2.2 (2026-09-24): planlama artık gerçek CLI'daki AI ile (Codex `--output-schema` / Claude `--json-schema`), Görev → Plan (sorular + editör + onay) → Başlat akışı, çalışanlar yapamadıklarını `SILENT_QUESTION` ile sorup bekler ve sapmaları raporlar, "Projeye sor" (uzman proje sohbeti) ve "Geliştir" (artımlı devam), manuel katman politikası, hesabın reddettiği modeller otomatik yedeğe düşer.
> v2.1 (2026-09-24): monokrom "Monolith" tema, arcade hayalet logo, plan editörü (manuel görev atama, effort, süre limiti), tür→katman yönlendirme politikası, timeout'ta oturumu devam ettirme, olumsuzlama anlayan planner ("algoritma yazma"), toplu terminal yazımı.

## Kurulum (son kullanıcı)

Hazır paketler **Releases** sayfasında: https://github.com/cube12x/silent/releases/latest

| Sistem | Dosya | Not |
|---|---|---|
| macOS (Apple Silicon + Intel) | `Silent_x.y.z_universal.dmg` | DMG'yi aç, Silent'ı Applications'a sürükle |
| Windows 10/11 | `Silent_x.y.z_x64-setup.exe` | yönetici hakkı istemez (kullanıcı kurulumu) |
| Linux (Ubuntu 22.04+/Debian) | `silent_x.y.z_amd64.deb` | `sudo apt install ./silent_x.y.z_amd64.deb` |
| Linux (diğer) | `silent_x.y.z_amd64.AppImage` | `chmod +x` ve çalıştır (`libfuse2` gerekebilir) |

**İmzasız uygulama uyarıları** (ücretli sertifika yok):
- macOS: "Silent hasarlı / açılamıyor" derse Terminal'de `xattr -dr com.apple.quarantine /Applications/Silent.app` çalıştır, ya da Sistem Ayarları → Gizlilik ve Güvenlik → **Yine de Aç**.
- Windows: SmartScreen penceresinde **Daha fazla bilgi → Yine de çalıştır**.
- Linux: AppImage için `chmod +x Silent_*.AppImage`; pencere boş kalırsa `WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Silent_*.AppImage`.

**Gereksinimler:** Node.js LTS + npm (CLI'ları kurmak için), git (referans repolar), isteğe bağlı python3 (Uydurma yer tutucu aracı). İlk açılışta **Kurulum** ekranı bunları kontrol eder, önerilen 5 CLI'ı (Codex, Claude Code, Kimi, Grok, Antigravity) tek tıkla kurar ve **Giriş yap** düğmesi login komutunu yeni bir terminal penceresinde açar. Devam etmek için Codex veya Claude Code kurulu olmalı (planlama onlarla yapılır).

**Terminal komutu:** Ayarlar → CLI'lar → `silent` komutunu kur. `silent run <klasör> "<istek>"`, `silent bp "<blueprint>"`, `silent reload`. Klasör PATH'te değilse gösterilen satırı kabuk profiline ekle (Windows: `%LOCALAPPDATA%\Silent\bin`).

**Sorun giderme:** günlükler macOS `~/Library/Logs/com.silent.workstation/`, Linux `~/.local/share/com.silent.workstation/logs/`, Windows `%LOCALAPPDATA%\com.silent.workstation\logs\`. `npm install -g` "EACCES" verirse Kurulum ekranındaki **~/.npm-global kullan ve tekrar dene** düğmesi. nvm ile kurulu Node'u Silent otomatik bulur (`~/.nvm/versions/node/*/bin`). Windows'ta Codex'in yerel sandbox'ı deneysel: planlayıcı olarak Claude Code'u tercih et. `curl | bash` kurulumları Windows'ta yok; npm paketi olan CLI'lar kurulur, diğerleri (Antigravity, Cursor) belgelerinden elle.

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

Kurulu olmayanlar Ayarlar > CLI'lar'da **Kur** butonuyla kurulur (çıktı uygulama içinde akar), **Giriş yap** yeni bir terminal penceresinde ilgili login komutunu açar. Her CLI'ın modelleri kendi yerel kataloğundan okunur (Codex `models_cache.json`, Kimi `config.toml`, Claude alias + `settings.json`); istediğin model kimliğini elle ekleyebilir, sohbette `/model <id>` veya `/cli <ad>` ile anında değiştirebilirsin. "beta" ayrıştırıcılar dokümana göre yazıldı; tanınmayan satırlar terminale ham düşer, asla çökmez.

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

## Yönlendirme politikası

Her alt görev türü bir **hedef katmana** gider: testler/dokümanlar → hızlı (Haiku, GPT-6-Luna…), backend/frontend/entegrasyon → güçlü (Sonnet, GPT-6-Sol…), mimari/algoritma/inceleme → en güçlü (Opus/Fable, GPT-6-Astra, K3). Ekonomik mod bir katman aşağı iner; En yüksek kalite yapım türlerini de en güçlüye çıkarır. Effort de tür bazlıdır (docs/tests low, yapım medium, mimari high; xhigh yalnız En yüksek kalite + mimari/algoritma) — kullanıcının global CLI ayarı (ör. Codex `model_reasoning_effort = "xhigh"`) hiçbir zaman hafif görevlere sızmaz. Süre limiti dolan görev **aynı oturumdan devam ettirilir** (en fazla 2 kez), sıfırdan başlatılmaz. Plan editöründe bunların hepsi görev başına elle değiştirilebilir.

## Planlama ve sorular

"Plan oluştur" gerçek bir CLI modeline (havuzdaki güçlü katman) salt-okunur, yapılandırılmış JSON çıktı ile plan yaptırır: yalnız gerekli alt görevler, her biri için katman/effort önerisi, **sorular** (belirsiz veya yapılamayacak istekler için — sessizce varsayım yapmak yerine), varsayımlar ve dışlananlar. Sorular cevaplanır, plan editöründe modeller değiştirilir, plan onaylanır, sonra başlar. Çalışanlar da isteğin bir kısmını yapamıyorsa `SILENT_QUESTION:` ile durup sorar; cevap aynı oturuma gider. Bitişte `SILENT_DEVIATIONS:` rapora düşer. Tamamlanan run'dan "Projeye sor" (o projeyi bilen salt-okunur uzman ajan) ve "Geliştir" (aynı depo üzerinde artımlı yeni run) açılır.

## Uzman kitleri, spec ve cila turu (v2.3)

- **Spec:** planlayıcı isteği İngilizce, kalite çıtası olan bir ürün spec'ine çevirir; alt görev açıklamaları da İngilizcedir (worker talimatı). Başlık/soru/özet kullanıcı dilindedir. Her worker brief'inde spec vardır.
- **Uzman kiti** (`src/domain/kits.ts`): alana özel brief + kontrol listesi + referans depolar (2D oyun, web uygulaması, backend API, Tauri masaüstü, ML). İstekten otomatik seçilir ya da elle. Başlatırken referanslar `<repo>/.silent/refs/<ad>` altına shallow clone edilir (`refs_sync` komutu, `.gitignore`'a eklenir); worker'lara "önce bunları incele, kanıtlanmış kalıpları kullan" denir. Ek depolar composer'dan URL olarak verilebilir.
- **Cila turu:** tüm görevler bitince havuzdaki en güçlü (tarayıcı açabilen) model spec + kontrol listesine göre 0-10 puan verir (`SILENT_SCORE`), en etkili 3 düzeltmeyi (`SILENT_FIXES`) görev olarak koşar. Puan ve notlar rapora yazılır. Tek tur.

- **`silent run`:** `silent run [--kit ID] [--no-polish] [--cost economy|balanced|max-quality] [--pool codex:gpt-6-astra,claude:sonnet] <klasör> "<istek>"` terminalden koşu başlatır: uygulama isteği alır, planlar, planlayıcı sorularını "kendin karar ver, README'ye yaz" diye cevaplar, onaylar ve başlatır. `--pool` havuzu verilen modellere kısıtlar.
- **Notlar vs sapmalar:** worker'lar `SILENT_DEVIATIONS:` (yalnız istekten sapılan/yapılamayan) ve `SILENT_NOTES:` (bilgi: kardeş modül kırıklığı, tasarım kararı, ekleyerek yapılan sözleşme genişletmesi) olarak ayrı raporlar; rapor ikisini ayrı gösterir. Worker başına token alt görev kartında görünür.
- **Pixel-art kiti:** `pixel-art-game` (tam sayı ölçekli sanal canvas, palet, prosedürel sprite sheet, dithering; referanslar LittleJS, kaplay, kontra, ditherto). "pixel/8-bit/retro" geçen isteklerde otomatik seçilir.
- **Cila turu en-iyi-çaba:** inceleyici çökse ya da bir düzeltme bitmese koşu "failed" olmaz; rapora sapma olarak düşer.

- **Uzman (şablon) ajanlar:** bir depoya bağlı olmayan ajanlar; kit, model havuzu, sabit yapım modeli, maliyet modu ve cila ayarını taşır. Yerleşik **Pixel Ustası** (pixel-art kiti, ucuz set: grok-4.7-build-fast + gpt-5.6-terra + haiku, tarayıcı işleri sonnet, ekonomi modu). Composer'da "★ Pixel Ustası" seçin veya `silent run --agent "Pixel Ustası" <klasör> "<istek>"`. Ajanlar > "Uzman ajan" ile yenisi oluşturulur; ayrıntı ekranından varsayılanları düzenlenir.

## Blueprint (v2.5)

Unreal Blueprint benzeri düğüm/kablo tuvali (5. ekran). Sağ tık → kutu ekle, kabloyla bağla, seçili kutuda **Enter** (veya çift tık) ile çalıştır.

| Kutu | İş |
| --- | --- |
| **Prompt** | başlık + metin; AI'a kablolanır |
| **AI** | model + mod (**Orkestrasyon**: planlayıcı + paralel worker + cila; **Tek oturum**: tek CLI oturumu, hızlı/ucuz) + maliyet + kit + amaç |
| **Build** | gerçek klasör (`<çalışma klasörü>/blueprints/<blueprint>/<build>`, varsayılan `~/CubeCode`, Ayarlar → Çalışma klasörü); AI çıktısı buraya düşer, Silent adlandırır (NAME/SUMMARY); dosya sürükle-bırak → klasöre kopyalanır |
| **Build Foto** | AI'ın ürettiği yeni görseller toplanır |
| **Start / Send / Reload** | ileri doğru çalıştır / dosyaları başka Build'e veya AI inbox'ına kopyala / bağlı AI'ı amaçla yeniden çalıştır (aynı oturum) |
| **Paralel** | bağlı bütün prompt/AI'ları **aynı anda** başlatır (fan-out); hepsi bitince zincir Build'in ötesinden devam eder. Start zinciri bir Paralel'e rastlayınca onu kardeş kablolardan önce işler: `Build → Paralel → 4 doldurucu` + `Build → Entegrasyon → Entegratör` sırası doldurucular → entegratör olur. Orkestrasyon AI'ları için klasör-meşgul koruması Paralel'de kapalıdır |
| **AI (orkestrasyon) ekip listesi** | havuzlu bir AI kutusu koşarken/koştuktan sonra kutunun altında havuzdaki her model ayrı satırda, altında planlayıcının ona verdiği görevler ve canlı durumu (○ bekliyor · ● çalışıyor · ✓ bitti · ✗ hata · ❓ soru); havuz dışından çağrılan model de listelenir |
| **Özel AI** | bir AI kutusunun iki ek alanı: **Temel talimat** (kalıcı rol/kurallar, her koşuda prompt'un başına eklenir) ve **GitHub repoları** (`https://`/`git@`; her koşudan önce build'in `.silent/refs/<ad>` klasörüne shallow-clone edilir ve brief'te yolları listelenir). Görevi yine bağlı Prompt verir: Start → Prompt "mod yap" → Özel AI (talimat + repo) → Build |
| **Kutu terminali / klasör** | herhangi bir AI kutusuna **4 kez üst üste tıkla** → sağdan canlı terminal açılır (bir Build kutusuna 4 tık → klasörü Finder/Explorer'da açar, AI yazarken dosyaları canlı izlersin; çift tık koşuyu başlatır ama 4 tık dizisi içindeyse başlatmaz) (tek oturum: kutunun satırları; orkestrasyon: görev başına sekme), **Durdur** düğmesiyle koşu iptal edilir; **Esc** veya tekrar 4 tık kapatır |
| **3D modeller** | Dosyalar sekmesi glb/gltf/fbx/obj/stl/ply/dae/3ds dosyalarını three.js ile açar: döndür, tel kafes, boyut/vertex/materyal, modelin animasyon klipleri sekme olarak oynar. Dönüştürücü `model inspect / convert --to glb / normalize --height` komutlarını alır (Python `trimesh`, ücretsiz). |
| **Dosyalar + Tamirci AI** | Blueprint ekranında **Dosyalar** sekmesi: Build klasörü Karakterler / Düşmanlar / Nesneler / Arka planlar / Sesler / Sistemler kutularında; öğeye tıkla → atlas animasyonları oynar, görsel/ses açılır, dosyaları listelenir; **Sınıflandır (AI)** ucuz bir modelle kod dosyalarını öğelere bağlar. Öğe, kutu ya da dosyaya sağ tık → **Tamirci AI çağır**: model (Opus…), kalıcı temel talimat + repolar, sorun metni, eşleşen dosyalar, Enter → blueprint'e Tamirci AI kutusu açılır ve koşar; onarım raporu + değişen dosyalar sekmede. CLI: `silent bp fix <blueprint> "<sorun>" --file <dosya>`. |
| **Dönüştürücü** | AI kutusunda üçüncü rol: bağlı klasördeki görsel/sesleri sonraki AI'ın istediği formata çevirir (format, boyut, kırpma, arka plan silme, sprite sheet + atlas, WAV). Kaynağa dokunmaz, `assets/converted/` altına yazar ve **DÖNÜŞTÜRÜLDÜ** manifesti sonraki kutuya gider. Her AI ayrıca `.silent/tools/donusturucu.py` aracını alır: kullanılamayan varlığı raporlamak yerine kendisi çevirir. |
| **Bilinç → Eylem** | maliyet ayrımı: **Bilinç** kutusu (pahalı model) **salt-okunur** çalışır (dosya değiştiremez), inceler ve BULGULAR/EYLEMLER raporu yazar; kablolu **Eylem** kutusu (ucuz model) raporu Build klasöründe uygular. Sağ tık → Bilinç / Eylem; bağlantı: Build → Prompt → Bilinç → Eylem → Build. Örnek: "Örnek: Bilinç → Eylem (bug avı)" |
| **Effort** | AI kutusunda Otomatik · low · medium · high · xhigh; model kartlarında CLI'ın kabul ettiği seviyeler yazar (Codex/Claude/Antigravity xhigh, Grok high, Kimi yok). Seçilen seviye tek oturumda ve orkestrasyonun her görevinde kullanılır; CLI desteklemiyorsa en yakın alt seviye |
| **Değişken** | bir Build klasörünü izler (3 sn); dosya gelince/değişince bağlı Sihirbaz/AI'ı tetikler |
| **Yetenek Sihirbazı** | model + amaç; olay gelince bağlı AI'a kısa talimat yazar ve oturumu devam ettirir |
| **Uydurma** | maliyet düşürücü: → AI bağlanınca o AI gerçek asset yerine **adı prompt olan yer tutucular** üretir (`assets/uydurma/<tür>__<prompt-slug>.png|wav|json…`, PNG üstünde adı yazar, ses kısa ton, `uydurma.json` prompt/durum tutar; araç: `.silent/tools/uydurma.py`); AI → Uydurma bağlanınca o AI manifestteki prompt'lardan gerçek asset'leri üretip aynı yola yazar. Türler: görsel, sprite sheet, tileset, sfx, müzik, seslendirme, metin/diyalog, font, 3D model, video |

Kablo kuralları `src/domain/blueprint.ts` (`BP_EDGE_RULES`); yanlış kablo reddedilir, eksik bağlantılar kutuda ▲ ile uyarılır. Build → Prompt → AI zinciri mevcut klasör üzerinde geliştirme yapar ve aynı Build'i günceller. Grafik `blueprints` tablosunda JSON olarak saklanır (migration 0007).

AI kutusunda **model havuzu** (orkestrasyonda planlayıcı görev başına havuzdan seçer) ve **token sayacı** (kutu rozeti + başlıkta Σ toplam) vardır.

**AI ile oluştur / düzenle**: başlıktaki düğme (veya `silent bp auto "<amaç>"`) bağlı Claude CLI'a tüm blueprint'i tasarlatır; açık bir blueprint varken aynı panel **"Bu blueprint'i düzenle"** ile mevcut grafiği yerinde değiştirir (korunan kutular id, konum ve koşu geçmişini tutar; `silent bp edit "<blueprint>" "<değişiklik>"`).

Terminalden tetikleme (launcher):

```bash
silent bp "Örnek: Loki 2"              # Start butonunu çalıştırır
silent bp "Örnek: Loki 2" "Geliştirici" # belirli bir kutu (başlık veya id)
```

## Güvenlik

- **Ağ erişimi:** yazma izinli (workspace-write) görevlerde çalışanın kabuğu ağa çıkabilir (`npm install`, `git fetch`, HTTP); Codex için `sandbox_workspace_write.network_access=true` verilir. Salt-okunur çalışmalar (planlayıcı, "Projeye sor") ağsızdır. Ajanlarda "Network access" izni kapatılırsa o ajanın görevleri de ağsız çalışır ve brief bunu söyler.

Onaylar her zaman kapalı (`-a never` / `--permission-prompts none`), sandbox tavanı workspace-write (Codex'te gerçek sandbox; diğerlerinde salt-okunur brief ile), gizli anahtarlar çıktıya ulaşmadan maskelenir, ham akıl yürütme metni gösterilmez. Git push varsayılan kapalı ve bir Gateway promptuyla asla açılamaz. Silent hiçbir kimlik bilgisi saklamaz; her CLI kendi girişini kullanır.

## Bakım (sürüm çıkarma)

```
gh auth login                                  # bir kez
gh repo create silent --public --source=. --remote=origin --push   # ilk kez
npm version 0.3.1 --no-git-tag-version        # + src-tauri/Cargo.toml ve tauri.conf.json aynı sürüm
git commit -am "0.3.1" && git tag v0.3.1 && git push origin main --tags
```
`release.yml` etiketle tetiklenir: macOS (universal DMG), Ubuntu (deb + AppImage), Windows (NSIS) derlenir ve **taslak** release açılır; artefaktlar denendikten sonra yayınlanır. `ci.yml` her push/PR'da üç işletim sisteminde typecheck/lint/test/cargo test/tauri build çalıştırır.
