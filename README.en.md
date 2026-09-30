# Silent (English)

**Desktop, CLI-native multi-AI orchestration.** Type one request; Silent splits it into tasks, runs each on the real AI CLIs installed on your machine (Codex, Claude Code, Kimi, Grok, Antigravity, …), streams every terminal live and reviews the result. **Blueprints** wire prompts, AIs, folders and buttons into reusable pipelines. Turkish README: [README.md](README.md).

## Install

Packages are on the **Releases** page: https://github.com/cube12x/silent/releases/latest

| OS | File | Note |
|---|---|---|
| macOS (Apple Silicon + Intel) | `Silent_x.y.z_universal.dmg` | open the DMG, drag Silent to Applications |
| Windows 10/11 | `Silent_x.y.z_x64-setup.exe` | per-user install, no admin prompt |
| Linux (Ubuntu 22.04+/Debian) | `silent_x.y.z_amd64.deb` | `sudo apt install ./silent_x.y.z_amd64.deb` |
| Linux (other) | `silent_x.y.z_amd64.AppImage` | `chmod +x`, run (`libfuse2` may be needed) |

**Unsigned builds** (no paid certificate):
- macOS: if it says "damaged / cannot be opened", run `xattr -dr com.apple.quarantine /Applications/Silent.app`, or System Settings → Privacy & Security → **Open Anyway**.
- Windows: SmartScreen → **More info → Run anyway**.
- Linux: `chmod +x Silent_*.AppImage`; blank window → `WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Silent_*.AppImage`.

**Prerequisites:** Node.js LTS + npm (to install the CLIs), git (reference repos), optional python3 (the Uydurma placeholder tool). The first-run **Setup** screen checks them, installs the five recommended CLIs with one click and opens each CLI's login in a new terminal window. Continue needs Codex or Claude Code (they do the planning).

**Terminal command:** Settings → CLIs → install `silent`. `silent run <folder> "<request>"`, `silent bp "<blueprint>"`, `silent reload`. If the folder is not on PATH, add the line the app shows (Windows: `%LOCALAPPDATA%\Silent\bin`).

**Troubleshooting:** logs live in `~/Library/Logs/com.silent.workstation/` (macOS), `~/.local/share/com.silent.workstation/logs/` (Linux), `%LOCALAPPDATA%\com.silent.workstation\logs\` (Windows). `npm install -g` failing with EACCES → the Setup screen's **Use ~/.npm-global and retry** button. Node from nvm is found automatically. On Windows, Codex's native sandbox is experimental: prefer Claude Code as the planner; `curl | bash` installers are unavailable there, so CLIs without an npm package (Antigravity, Cursor) are installed by hand.

## How it works

- **Silent Code**: request → AI planner (structured output) → task plan you can edit → workers on the CLIs in your pool → polish review. Every worker's terminal is live; questions from workers block the task until you answer.
- **Blueprint**: a node canvas. Prompt → AI → Build (real folder) → more prompts/AIs; buttons Start / Send / Reload / **Paralel** (fan-out), **Uydurma** placeholders (cheap AI registers prompt-named placeholders, a specialised AI fills them later), **Özel AI** (base instructions + GitHub repos cloned per run), four clicks on a node open its terminal.
- **Files tab + Repair AI**: the Blueprint screen's **Files** tab shows the Build folder as Characters / Enemies / Objects / Backgrounds / Sounds / Systems; click an item to play its atlas animations, view images, hear sounds and see its files; **Classify (AI)** links code files to items with a cheap model. Right-click an item, a card or a file → **Call Repair AI**: model (Opus…), saved base instructions + repos, problem text, matched files, Enter → a Repair AI box appears in the blueprint and runs; the repair report and changed files show in the tab. CLI: `silent bp fix <blueprint> "<problem>" --file <path>`.
- **Converter (Dönüştürücü)**: a third AI-box role next to Awareness/Action. It brings the images/audio in the wired folder into the format the next AI needs (format, size, crop, background removal, sprite sheet + atlas, 16-bit WAV) with the bundled `donusturucu.py` (Pillow + numpy), never touches the source, writes to `assets/converted/` and passes a CONVERTED manifest to the next box. Every AI and every orchestration worker gets the same toolkit, so an unusable asset is converted instead of reported.
- **Security**: CLIs run in their own sandboxes (workspace-write by default); git push can never be enabled from Silent.

## Develop

```
npm install
npm run tauri:dev
npm run typecheck && npm run lint && npm test && cargo test --workspace
```
CI (`.github/workflows/ci.yml`) runs the same on Ubuntu, Windows and macOS; `release.yml` builds the installers on a `v*` tag.

MIT — see [LICENSE](LICENSE).
