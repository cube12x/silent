# Dönüştürücü (asset converter) — design

Date: 2026-09-29. Status: approved by the user in chat ("tamam").

## Problem

Blueprint branches produce assets (Piksel Art AI → Art Galerisi PNG sheets, photos the user drops in,
Uydurma placeholders) that the consuming AI cannot use as-is: wrong format, wrong size, opaque
background, one big photo instead of cropped frames. The consumer either ignores the assets (Mario:
integrator never loaded the gallery sheets) or reports "unusable". The user wants an explicit
**Dönüştürücü** box that brings assets into the format the next step needs (convert, resize, crop,
remove background, split/pack sprite sheets, basic WAV fixes), and wants any AI to be able to do this
on demand.

## Decision

1. **Role, not a new node type.** `BpAiData.role` gains `"donusturucu"` next to `bilinc`/`eylem`.
   The AI box keeps its model/pool/purpose/instructions; the role adds the converter policy block to
   the prompt and stores the converter manifest as the box report.
2. **Bundled tool.** `src/engine/blueprint/tools/donusturucu.py` (Pillow + numpy only; both ship on the
   user's machine and are common). Synced to `<project>/.silent/tools/donusturucu.py` like uydurma.py.
   Subcommands: `inspect`, `convert`, `resize`, `trim`, `crop`, `removebg`, `split`, `pack`, `palette`,
   `wav`. `removebg` uses `rembg` when importable, otherwise corner flood-fill + colour key and says so
   in its output. WAV only for audio (no ffmpeg on the machine); mp3/ogg/video are out of scope.
3. **Flow.** The converter never edits the source folder. It writes to `assets/converted/` (relative to
   the working project; overridable in the purpose text) and prints a `# CONVERTED` manifest (file,
   operation, reason, unresolved items). The store extracts that manifest into `ai.data.report`
   (reusing `extractReport` with the `# CONVERTED` heading) and downstream AIs get it in their brief
   through the existing report plumbing (`reports` → `eylemBrief`-style block named "Converted assets").
4. **On demand for every AI.** Every AI box working inside an existing project gets one prompt line:
   the toolkit path and "if an asset is unusable, convert it yourself with this tool instead of
   reporting it unusable". Orchestration worker briefs get the same line when the tool is synced.
5. **UI.** Role selector shows Bilinç / Eylem / Dönüştürücü; menu entry "Dönüştürücü AI" (role preset,
   purpose template, cheapest planner-capable model of the pool). Node badge icon (Wand2). Lint:
   `donusturucu.noSource` when no Build / photo / stub / AI node feeds the box.
6. **Auto-blueprint / CLI.** Schema enum gains `donusturucu`; RULES line tells the planner when to insert
   one (an art/audio producer feeds a consumer that needs a specific format). `describeExisting` carries
   the role so "AI ile düzenle" can add or remove it.

## Out of scope (LATER)

mp3/ogg/video conversion, automatic rembg installation, in-place edits of the source folder,
a deterministic no-AI converter node.

## Testing

- Python: `donusturucu_test.py` (run with `python3 -m unittest`) over generated PNG/WAV fixtures:
  inspect/convert/resize/trim/removebg(flood)/split/pack/palette/wav.
- TS: prompt order with role donusturucu; extractReport on `# CONVERTED`; lint `donusturucu.noSource`;
  autoBlueprint schema/materialize keeps the role; roster glyph; i18n parity.
- Smoke: preview app, add the box from the menu, panel shows the role hint; Mario blueprint real run:
  Art Galerisi → Dönüştürücü → Entegrasyon AI uses `assets/converted/`.
