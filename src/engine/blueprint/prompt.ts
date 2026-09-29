import type { BpAiRepo, BpStubData } from "@/domain"
import { stubFillerPolicy, stubProducerPolicy } from "./uydurma"

/** Accepted repository URL shapes for an "Özel AI" node (same rule as Silent Code's reference repos). */
export const REPO_URL = /^(https:\/\/|git@)\S+$/

export function isRepoUrl(url: string): boolean {
  return REPO_URL.test(url.trim())
}

/** Folder name a repo is cloned under: explicit name, else the last URL segment without `.git`. */
export function repoName(repo: Pick<BpAiRepo, "url" | "name">): string {
  const explicit = repo.name?.trim()
  if (explicit) return explicit
  return repo.url.trim().replace(/\.git$/, "").split(/[/:]/).filter(Boolean).at(-1) ?? "repo"
}

export interface RefPath {
  name: string
  path: string
  hint?: string
}

/** Bilinç: the model may only look; its whole output is the report the Eylem node executes. */
export const BILINC_POLICY = `You are the BİLİNÇ (awareness) step of a two-step pipeline. READ-ONLY: do not create, modify, delete or move any file, do not run formatters, installers or git commands that change the tree (running tests, linters and builds to OBSERVE is fine).
Investigate the task thoroughly, then reply with a report and nothing else:
# FINDINGS
- one bullet per problem: file:line — what is wrong — why (evidence)
# ACTIONS
1. numbered, concrete, minimal edits another AI will apply verbatim: file, what to change, expected result, how to verify
Keep the report self-contained; the next AI has not seen this conversation.`

export type BpReportKind = "bilinc" | "donusturucu"

/** Dönüştürücü: converts the wired assets into the format the next step needs, with the bundled tool, and reports a manifest. */
export const DONUSTURUCU_POLICY = `You are the DÖNÜŞTÜRÜCÜ (converter) step. Your job: bring the assets wired into you (folders, sheets, photos, WAVs) into the exact format the next step needs — the Purpose and the wired prompts say what that is. Use the bundled tool for every conversion; never hand-write image or audio bytes:
  python3 .silent/tools/donusturucu.py inspect <folder> [--json]      # what is there: size, mode, alpha, frame guess, colours
  python3 .silent/tools/donusturucu.py --help                        # convert · resize · trim · crop · removebg · split · grid · pack · palette · wav
AI-generated sheets (a big JPG/PNG with a grid of labelled cells): LOOK at the image first (read it), measure the cell size, origin, gap and caption strip, then: grid --cols … --rows … --cell WxH --origin x,y --gap g --label h --names … ; then removebg on the cells (dark/plain cell background); then resize --size to the frame size the game uses; then pack --name … for a sheet + JSON atlas.
Rules: the source folder is read-only; write only under assets/converted/ (or the folder the Purpose names, via --out). The tool refuses to overwrite an existing output (another step may own it): pick another name or an --out subfolder instead of --force. Pixel art is resized nearest-neighbour (default). removebg uses rembg when installed, otherwise a corner flood-fill — say which one ran. Convert only what the next step needs; do not invent assets. Finish with the manifest and nothing after it:
# CONVERTED
- <source> → <output> · <operation> · <why the next step needs it>
# UNRESOLVED
- what you could not convert and what the next step should do about it`

/** One paragraph for every AI working inside a project: convert on demand instead of reporting an asset unusable. */
export const CONVERTER_TOOLKIT = "Converter toolkit: `python3 .silent/tools/donusturucu.py --help` (inspect/convert/resize/trim/crop/removebg/split/grid/pack/palette/wav; Pillow + numpy). When an asset is in the wrong format or size, or has a background, convert it into assets/converted/<your-step>/ with this tool (it refuses to overwrite another step's files) and use the result — do not report it unusable."

/** Converted-asset manifests of the Dönüştürücü nodes wired into an AI. */
export function convertedBrief(all: Array<{ title: string; report: string; kind?: BpReportKind }>): string {
  const reports = all.filter((r) => r.kind === "donusturucu")
  if (!reports.length) return ""
  const body = reports.map((r) => `## ${r.title}\n${r.report.trim()}`).join("\n\n")
  return `Converted assets (produced by the converter step below; use these files, they are already in the needed format):\n${body}`
}

/** Eylem: the brief that turns Bilinç reports into work. */
export function eylemBrief(all: Array<{ title: string; report: string; kind?: BpReportKind }>): string {
  const reports = all.filter((r) => r.kind !== "donusturucu")
  if (!reports.length) return ""
  const body = reports.map((r) => `## Report from ${r.title}\n${r.report.trim()}`).join("\n\n")
  return `You are the EYLEM (action) step: apply the ACTIONS of the read-only reports below exactly, in order, verifying each as the report says. Do not re-investigate what the reports already settled; if an action is impossible, say why in your summary.\n\n${body}`
}

export interface AiPromptInput {
  /** Reload/wizard purpose line. */
  purpose?: string
  /** Text of the wired prompt nodes (wire order). */
  wired: string
  extraPrompt?: string
  /** Özel AI base instructions. */
  instructions?: string
  /** Working folder, when it is an existing project the AI must not recreate. */
  existingProjectAt?: string
  /** Cloned reference repositories (absolute paths). */
  refPaths?: RefPath[]
  /** Uydurma: stub → ai (placeholder producer) / ai → stub (filler). */
  stubs?: BpStubData[]
  fills?: BpStubData[]
  /** Bilinç / Eylem / Dönüştürücü role of this node. */
  role?: "bilinc" | "eylem" | "donusturucu"
  /** Reports of the Bilinç (work order) and Dönüştürücü (converted assets) nodes wired into it. */
  reports?: Array<{ title: string; report: string; kind?: BpReportKind }>
  /** The converter tool is shipped into the working folder: tell the AI it may convert assets on demand. */
  converterTool?: boolean
}

/**
 * The purpose an AI run works from: an explicit override (Reload / wizard) wins; otherwise only a Dönüştürücü uses its own
 * purpose field as the task (it usually has no wired prompt — the wired nodes are asset folders). Other roles keep the
 * purpose for Reload only.
 */
export function effectivePurpose(role: "bilinc" | "eylem" | "donusturucu" | undefined, nodePurpose: string | undefined, override: string | undefined): string | undefined {
  if (override) return override
  const own = nodePurpose?.trim()
  return role === "donusturucu" && own ? own : undefined
}

/** The task part of the prompt (what must be non-empty for a run to make sense). */
export function aiTaskText(i: Pick<AiPromptInput, "purpose" | "wired" | "extraPrompt" | "reports">): string {
  return [i.purpose ? `Purpose: ${i.purpose}` : "", i.wired, i.extraPrompt ?? "", eylemBrief(i.reports ?? []), convertedBrief(i.reports ?? [])].filter((x) => x && x.trim()).join("\n\n")
}

/**
 * Final prompt an AI node receives. Order: Uydurma policies → "work inside the existing project" → reference repos →
 * base instructions → purpose → wired prompt → extra prompt.
 */
export function buildAiPrompt(i: AiPromptInput): string {
  const blocks: string[] = []
  if (i.fills?.length) blocks.push(stubFillerPolicy(i.fills))
  if (i.stubs?.length) blocks.push(stubProducerPolicy(i.stubs))
  if (i.existingProjectAt) blocks.push(`Work inside the existing project at ${i.existingProjectAt} (it is already there; do not recreate it).`)
  if (i.existingProjectAt) blocks.push("Module shadowing: a file `x.ts` beside a folder `x/` wins the import `./x` and silently replaces `x/index.ts`. Never create such a file; if you find one, or dead scaffold that shadows a real module, delete it.")
  if (i.refPaths?.length) {
    blocks.push(
      `Reference repositories (already cloned under .silent/refs; study them, copy from them only when the task says so):\n${i.refPaths.map((r) => `- ${r.path}${r.hint ? ` — ${r.hint}` : ""}`).join("\n")}`,
    )
  }
  if (i.role === "bilinc") blocks.push(BILINC_POLICY)
  if (i.role === "donusturucu") blocks.push(DONUSTURUCU_POLICY)
  else if (i.converterTool && i.role !== "bilinc") blocks.push(CONVERTER_TOOLKIT)
  const instructions = i.instructions?.trim()
  if (instructions) blocks.push(`# Base instructions\n${instructions}`)
  const task = aiTaskText(i)
  if (task) blocks.push(task)
  return blocks.join("\n\n")
}

/** The report part of a Bilinç (`# FINDINGS`) or Dönüştürücü (`# CONVERTED`) reply: from the last heading on; the commentary before it is dropped. */
export function extractReport(text: string): string {
  const t = text.trim()
  const upper = t.toUpperCase()
  const idx = Math.max(upper.lastIndexOf("# FINDINGS"), upper.lastIndexOf("# CONVERTED"))
  return idx >= 0 ? t.slice(idx).trim() : t
}
