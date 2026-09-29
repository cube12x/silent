import type { BpStubData, BpStubKind } from "@/domain"
import UYDURMA_TOOL_SOURCE from "./tools/uydurma.py?raw"

export { UYDURMA_TOOL_SOURCE }
export const UYDURMA_TOOL_NAME = "uydurma.py"

export const STUB_KIND_LABELS: Record<BpStubKind, { tr: string; en: string; ext: string }> = {
  image: { tr: "Görsel", en: "Image", ext: "png" },
  sprite: { tr: "Sprite sheet", en: "Sprite sheet", ext: "png" },
  tileset: { tr: "Tileset", en: "Tileset", ext: "png" },
  sfx: { tr: "Ses efekti", en: "Sound effect", ext: "wav" },
  music: { tr: "Müzik", en: "Music", ext: "wav" },
  voice: { tr: "Seslendirme", en: "Voice", ext: "wav" },
  text: { tr: "Metin / diyalog", en: "Text / dialogue", ext: "json" },
  font: { tr: "Font", en: "Font", ext: "txt" },
  model3d: { tr: "3D model", en: "3D model", ext: "obj" },
  video: { tr: "Video", en: "Video", ext: "txt" },
}

function kindList(kinds: BpStubKind[]): string {
  return kinds.map((k) => `${k} (.${STUB_KIND_LABELS[k].ext})`).join(", ")
}

/** Injected into an AI that has a Uydurma wired INTO it: never spend effort producing real assets. */
export function stubProducerPolicy(stubs: BpStubData[]): string {
  const kinds = Array.from(new Set(stubs.flatMap((s) => s.kinds)))
  // One line per stub: each stub owns a folder (and manifest), so different fillers can work in parallel.
  const routes = stubs.map((s) => `  ${kindList(s.kinds)} → python3 .silent/tools/${UYDURMA_TOOL_NAME} --root ${s.folder || "assets/uydurma"} add --kind <${s.kinds.join("|")}> --path ${s.folder || "assets/uydurma"}/<kind>__<short-slug-of-the-prompt>.<ext> --prompt "<the full generation prompt: subject, style, palette, size, mood, loop/length>" [--size WxH] [--seconds N]`)
  return [
    "UYDURMA (placeholder) POLICY — asset production is delegated to other AIs to save cost:",
    `Do NOT draw, paint, synthesise, model or hand-code any real ${kindList(kinds)} asset. Instead register a PLACEHOLDER for each one with Silent's tool (already present at .silent/tools/${UYDURMA_TOOL_NAME}), using the folder that matches the kind:`,
    ...routes,
    "The file name IS the prompt (slug), the placeholder shows its own name (image: label + grid; audio: short tone; text/json/obj: prompt inside; model3d: a valid OBJ cube), and each folder's uydurma.json keeps kind, path, prompt, size and status.",
    "Wire the placeholders into the code exactly like final assets (same paths); the game/app must run and look coherent with them. Write prompts precise enough that another model can produce the final asset without seeing the code. Keep the manifest complete: every asset the product needs must be registered.",
  ].join("\n")
}

/** Injected into an AI that a Uydurma node is wired INTO (ai → stub): produce the real assets from the manifest. */
export function stubFillerPolicy(stubs: BpStubData[]): string {
  const folder = stubs[0]?.folder || "assets/uydurma"
  const kinds = Array.from(new Set(stubs.flatMap((s) => s.kinds)))
  return [
    "UYDURMA FILL JOB — replace placeholders with real assets:",
    `Run python3 .silent/tools/${UYDURMA_TOOL_NAME} --root ${folder} fill-brief to get the list. For EVERY entry with status placeholder (${kinds.join(", ")}): generate the real asset from its prompt — images with your image generation tool (match style/palette/size), audio by synthesising a real WAV (procedural synthesis script or your audio tool), text/dialogue by writing the actual content, 3D/fonts/video only if you have a real way to produce them (otherwise leave them and list them under SILENT_NOTES) — overwrite the SAME path in the same format, then run python3 .silent/tools/${UYDURMA_TOOL_NAME} --root ${folder} done --path <path>.`,
    "Never change file names or paths (the code references them). Do not touch code except when an asset's real dimensions differ and a size constant must follow. Verify the product still runs with the real assets.",
  ].join("\n")
}
