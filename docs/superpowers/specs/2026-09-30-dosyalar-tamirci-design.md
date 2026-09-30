# Dosyalar sekmesi + Tamirci AI — design

Date: 2026-09-30. Status: approved by the user in chat ("tamam").

## Problem

After a blueprint has built a game, the user has no way to *look at* what was produced (characters,
enemies, backgrounds, sounds, code) or to point at one thing that is wrong ("the flowers clip into the
wall") and have a strong model fix exactly that. Today they would have to add a Prompt + AI box by hand,
write file paths themselves and guess which files matter.

## Decision

1. **Dosyalar tab** in the Blueprint screen (`BLUEPRINT | DOSYALAR`) for the Build folder wired into the open
   blueprint (a selector when several Builds exist).
2. **Index** `.silent/files-index.json` per Build folder: `{ version, builtAt, categories: [{ id, title, items: [{ id, title, files[], previews[], notes }] }] }`.
   - Layer 1, heuristic (pure TS, unit-tested): atlas JSONs (`assets/converted/*.json`, any `*.json` with
     `frames[]` next to a PNG) → items per name prefix with animation groups (`murkcap_idle_*` → anim `idle`);
     image folders → items per file; audio (`*.wav|mp3|ogg`) → Sesler; `src/**` → Sistemler grouped by top
     folder. Categories: `karakterler`, `dusmanlar`, `nesneler`, `arkaplanlar`, `sesler`, `sistemler`, `diger`.
     Heuristic category guesses come from names (hero/player/murkcap → karakterler; enemy/brassbolt/boss →
     dusmanlar; item/coin/powerup → nesneler; tile/bg/sky/cloud → arkaplanlar).
   - Layer 2, **Sınıflandır (AI)** button: a read-only single session on a cheap model reads the heuristic index
     + file tree and returns a corrected index as JSON (schema-validated); it may rename/move items and attach
     code files to items. Stored in the same file; heuristic rebuild never overwrites AI-assigned code links
     (merged by item id).
   - Staleness: `changedFiles(root, builtAt)` non-empty → "İndeks eski" badge + Yenile.
3. **Boxes**: one card per category; items inside; click → right panel: previews (atlas animations on a canvas
   with anim tabs and speed; images enlarged; audio player) + file list. Images load through the existing
   asset URL path used by Build Foto.
4. **Tamirci AI**: right-click an item, a category or a file → "Tamirci AI çağır" → dialog: model picker,
   base instructions + repos (blueprint-level preset `tamirci` saved in the blueprint graph meta), problem
   text, file checklist prefilled from the item, "Önce Bilinç ile incele" toggle. Enter →
   - first call creates an AI box titled "Tamirci AI" (role none, mode single, instructions/repos from the
     preset) wired from the Build; later calls reuse it (found by `data.tamirci === true`);
   - runs it through the normal store path with `extraPrompt` = problem + attached files (paths + first 200
     lines of each attached text file are NOT inlined; the AI reads them; the prompt lists them as
     "Attached files (start here)");
   - with the Bilinç toggle: creates/reuses a "Tamirci Bilinç" (role bilinc, same model) wired into the
     Tamirci box (role eylem) and runs the pair;
   - the box's summary (last reply) is stored as `data.report` and shown in the Files tab under "Onarım
     raporu" with `changedFiles` since the run started.
5. **CLI**: `silent bp fix <blueprint> "<problem>" [--file a --file b]` queues the same request (autostart
   `blueprint.fix`), so terminal users get the feature too.

## Out of scope (LATER)

3D/video previews, editing files in the tab, per-item history, automatic bug detection.

## Testing

- Unit: `filesIndex.test.ts` (heuristics: atlas grouping, category guesses, merge keeps AI code links);
  `tamirci.test.ts` (prompt composition, box reuse); i18n parity; autostart `fix` grammar (Rust test).
- Preview smoke: Files tab renders categories from a TestBackend index; right-click → Tamirci dialog → Enter
  creates the box.
- Real: Mario — open Dosyalar, see Murkcap animations; report "çiçekler duvara girmiş" from Nesneler with
  Opus; verify the fix through the box terminal and the report.
