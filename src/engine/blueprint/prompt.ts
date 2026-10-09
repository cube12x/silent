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

export type BpReportKind = "bilinc" | "donusturucu" | "check" | "kesifci" | "verify" | "model"

/** Keşifçi: a cheap read-only scout. Its report is the map the next (expensive) AI works from instead of re-scanning. */
export const KESIFCI_POLICY = `You are the KEŞİFÇİ (scout) step: READ-ONLY reconnaissance for the task below on a cheap model — do not create, modify or delete any file, do not run installers or formatters (reading files, grep, running tests to observe is fine).
Find exactly what the next AI must touch and reply with a report and nothing else:
# RECON
- <file>:<lines> — what is there and why it matters for the task (quote the key lines)
- contracts/types/tests the change must respect
# PLAN
1. numbered, concrete edits (file, what to change, how to verify) the next AI can apply without re-reading the repository
Keep it under 120 lines; the next AI has not seen this conversation.`

/** Dönüştürücü: converts the wired assets into the format the next step needs, with the bundled tool, and reports a manifest. */
export const DIKIS_POLICY = `You are the DİKİŞ (stitch) step after a split build: several workers built disjoint areas in this repository at the same time. Your job is ONLY to make the whole fit together: run the full test suite, typecheck and build; fix cross-area seams (imports, registrations, shared contracts, duplicated scaffolding, module shadowing, dead placeholder files); wire every area into the app where a worker forgot. Do not add features, do not redesign what works, do not rewrite an area's internals — the smallest change that makes the whole green and coherent. Finish with a short summary and a \`# FIXED\` list of the seams you closed.`

export const DONUSTURUCU_POLICY = `You are the DÖNÜŞTÜRÜCÜ (converter) step. Your job: bring the assets wired into you (folders, sheets, photos, WAVs) into the exact format the next step needs — the Purpose and the wired prompts say what that is. Use the bundled tool for every conversion; never hand-write image or audio bytes:
  python3 .silent/tools/donusturucu.py inspect <folder> [--json]      # what is there: size, mode, alpha, frame guess, colours
  python3 .silent/tools/donusturucu.py --help                        # convert · resize · trim · crop · removebg · split · grid · pack · palette · wav · model (3D: inspect/convert/normalize via trimesh)
AI-generated sheets (a big JPG/PNG with a grid of labelled cells): LOOK at the image first (read it), measure the cell size, origin, gap and caption strip, then: grid --cols … --rows … --cell WxH --origin x,y --gap g --label h --names … ; then removebg on the cells (dark/plain cell background); then resize --size to the frame size the game uses; then pack --name … for a sheet + JSON atlas.
Rules: the source folder is read-only; write only under assets/converted/ (or the folder the Purpose names, via --out). The tool refuses to overwrite an existing output (another step may own it): pick another name or an --out subfolder instead of --force. Pixel art is resized nearest-neighbour (default). removebg uses rembg when installed, otherwise a corner flood-fill — say which one ran. Convert only what the next step needs; do not invent assets. Finish with the manifest and nothing after it:
# CONVERTED
- <source> → <output> · <operation> · <why the next step needs it>
# UNRESOLVED
- what you could not convert and what the next step should do about it`

/** One paragraph for every AI working inside a project: convert on demand instead of reporting an asset unusable. */
export const CONVERTER_TOOLKIT = "Converter toolkit: `python3 .silent/tools/donusturucu.py --help` (inspect/convert/resize/trim/crop/removebg/split/grid/pack/palette/wav, and model inspect/convert/normalize for 3D; Pillow + numpy, trimesh for 3D). When an asset is in the wrong format or size, or has a background, convert it into assets/converted/<your-step>/ with this tool (it refuses to overwrite another step's files) and use the result — do not report it unusable."

/** Providers with a built-in raster image tool (Antigravity): drawn art must come from it, not from a script that paints labelled boxes. */
export const IMAGE_TOOL_HINT = "You have a built-in raster IMAGE GENERATION tool (generate_image / image_gen, plus image_edit where available). For artwork (sprites, sprite sheets, backgrounds, portraits, key art, UI cards) use it and save the PNG files under the project's assets folder, then wire them into the code; prefer generated images over hand-coding pixel data when the task asks for drawn art. Never substitute script-drawn placeholder boxes for requested art. Keep a consistent style across the images you generate (same palette, outline weight and era)."

/** Converted-asset manifests of the Dönüştürücü nodes wired into an AI. */
export function convertedBrief(all: Array<{ title: string; report: string; kind?: BpReportKind }>): string {
  const reports = all.filter((r) => r.kind === "donusturucu")
  if (!reports.length) return ""
  const body = reports.map((r) => `## ${r.title}\n${r.report.trim()}`).join("\n\n")
  return `Converted assets (produced by the converter step below; use these files, they are already in the needed format):\n${body}`
}

/** Model Plus: the validated asset manifest of the model boxes wired into an AI — wire the code to these files. */
export function modelBrief(all: Array<{ title: string; report: string; kind?: BpReportKind }>): string {
  const reports = all.filter((r) => r.kind === "model")
  if (!reports.length) return ""
  const body = reports.map((r) => `## ${r.title}\n${r.report.trim()}`).join("\n\n")
  return `Model Plus delivered and VALIDATED the assets below (exact paths, atlas format, frame counts). Wire the code to them: load the sheets/atlases, map animations by frame name, replace and remove the placeholders they stand in for; do NOT redraw, regenerate or run an image tool for them. Finish with a short summary and a \`# FIXED\` list of what you wired.\n${body}`
}

/** Denetçi: a failed automated check is the work order of the wired fixer AI. */
/** 2026-10-03: two fixers in a row ended their turn with "I'll report once the background run finishes" and were
 * marked failed while Playwright kept running behind them. Fixers wait. */
export const FOREGROUND_RULE = "Run every command in the foreground and wait for it to finish before you answer; never start a background task, agent or watcher and end your turn while it runs — an answer that promises to report later counts as a failure."

export function checkBrief(all: Array<{ title: string; report: string; kind?: BpReportKind }>): string {
  const reports = all.filter((r) => r.kind === "check")
  if (!reports.length) return ""
  const body = reports.map((r) => `## ${r.title}\n${r.report.trim()}`).join("\n\n")
  return `${FOREGROUND_RULE}\n\nThe automated check (Denetçi) below FAILED. Fix the cause with the smallest safe change (do not disable or weaken the checks), then re-run the same commands until they are green; finish with a short summary of what was wrong and what you changed.\n\n${body}`
}

/** Çoklu Tarayıcı: the lanes' findings are the fixer's work order. */
export function verifyBrief(all: Array<{ title: string; report: string; kind?: BpReportKind }>): string {
  const reports = all.filter((r) => r.kind === "verify")
  if (!reports.length) return ""
  const body = reports.map((r) => `## ${r.title}\n${r.report.trim()}`).join("\n\n")
  return `${FOREGROUND_RULE}\n\nBrowser verification (parallel lanes, already played through — do not replay everything) found the problems below. Fix each one with the smallest safe change, verify the exact lane it came from, and finish with a short summary and a \`# FIXED\` list:\n${body}`
}

/** One lane of a Çoklu Tarayıcı run: play exactly this flow in a real browser and report. */
export function verifyLanePrompt(lane: string, cwd: string): string {
  const slug = lane.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "lane"
  return [
    `You are ONE lane of a parallel browser verification of the project at ${cwd}. Other lanes cover the other screens at the same time, so play ONLY this lane, end to end, in a real browser (Playwright/Chromium; start the dev server if none is running):`,
    `LANE: ${lane}`,
    `Do not modify any source file and do not run formatters or installers; you only observe. Save screenshots of what you saw under .silent/tmp/shots/${slug}/ (git-ignored).`,
    "Report under `# VERIFY`: one bullet per problem with [severity] where, what happened, what was expected and how to reproduce (clicks/keys). If the lane works, reply exactly `# VERIFY\n- OK`. If you could not drive the lane at all (the app did not start, the machine is overloaded and the game loop barely advances, inputs do nothing), reply exactly `# VERIFY\n- INCONCLUSIVE: <one line why>` — that is not a product finding and must not be reported as one.",
  ].join("\n\n")
}

/** Keşifçi: the scout's findings, so the expensive AI starts editing instead of re-scanning. */
export function reconBrief(all: Array<{ title: string; report: string; kind?: BpReportKind }>): string {
  const reports = all.filter((r) => r.kind === "kesifci")
  if (!reports.length) return ""
  const body = reports.map((r) => `## ${r.title}\n${r.report.trim()}`).join("\n\n")
  return `Recon (already done by a read-only scout — do not re-scan the repository or grep around; open only the files named here, then edit):\n${body}`
}

/** Eylem: the brief that turns Bilinç reports into work. */
export function eylemBrief(all: Array<{ title: string; report: string; kind?: BpReportKind }>): string {
  const reports = all.filter((r) => !r.kind || r.kind === "bilinc")
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
  /** Repo digest (Kaşe): tree + exports + brief head, so the AI reads files only to edit or verify them. */
  digest?: string
  /** Cloned reference repositories (absolute paths). */
  refPaths?: RefPath[]
  /** Uydurma: stub → ai (placeholder producer) / ai → stub (filler). */
  stubs?: BpStubData[]
  fills?: BpStubData[]
  /** Bilinç / Eylem / Dönüştürücü / Keşifçi role of this node. */
  role?: "bilinc" | "eylem" | "donusturucu" | "kesifci" | "dikis"
  /** Reports of the Bilinç (work order) and Dönüştürücü (converted assets) nodes wired into it. */
  reports?: Array<{ title: string; report: string; kind?: BpReportKind }>
  /** The converter tool is shipped into the working folder: tell the AI it may convert assets on demand. */
  converterTool?: boolean
  /** The model's CLI has a raster image tool (Antigravity): drawn art must come from it. */
  imageTool?: boolean
}

/**
 * The purpose an AI run works from: an explicit override (Reload / wizard) wins; otherwise only a Dönüştürücü uses its own
 * purpose field as the task (it usually has no wired prompt — the wired nodes are asset folders). Other roles keep the
 * purpose for Reload only.
 */
export function effectivePurpose(role: "bilinc" | "eylem" | "donusturucu" | "kesifci" | "dikis" | undefined, nodePurpose: string | undefined, override: string | undefined): string | undefined {
  if (override) return override
  const own = nodePurpose?.trim()
  // Read-only roles work from their own purpose too (a Bilinç box often hangs off a Build with no Prompt wired).
  return (role === "donusturucu" || role === "bilinc" || role === "kesifci") && own ? own : undefined
}

/** The task part of the prompt (what must be non-empty for a run to make sense). */
/** Task text a role carries by itself when nothing is wired into the box (Dikiş: its job is fixed by its policy). */
export function defaultTaskForRole(role: AiPromptInput["role"]): string {
  switch (role) {
    case "dikis":
      return "Stitch the split build in this folder: run the full suite, typecheck and build, close every cross-area seam and missing wiring, then report under # FIXED."
    // 2026-10-09: the designer wired Build → Bilinç with no Prompt and the chain died on "no prompt"; a bug hunt is the natural default.
    case "bilinc":
      return "Bug hunt: read this project as a senior reviewer — run the checks it ships (typecheck, tests, build) without changing anything, read the core modules and the UI flow, and look for crashes, broken flows, wrong behaviour, dead code paths, performance traps and missing error handling. Report under # FINDINGS (one bullet per finding: where, what, why it matters, how to reproduce) and a numbered # ACTIONS list the Eylem box can apply one by one, most severe first."
    case "kesifci":
      return "Recon: map this repository for the next worker — structure, entry points, build/test commands, key modules and their contracts, conventions, known gaps. Report under # RECON, compact and factual."
    default:
      return ""
  }
}

export function aiTaskText(i: Pick<AiPromptInput, "purpose" | "wired" | "extraPrompt" | "reports">): string {
  return [i.purpose ? `Purpose: ${i.purpose}` : "", i.wired, i.extraPrompt ?? "", eylemBrief(i.reports ?? []), checkBrief(i.reports ?? []), verifyBrief(i.reports ?? []), reconBrief(i.reports ?? []), convertedBrief(i.reports ?? []), modelBrief(i.reports ?? [])].filter((x) => x && x.trim()).join("\n\n")
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
  if (i.digest?.trim()) blocks.push(`Repo digest (already discovered — do not re-scan the tree or grep around; open a file only to edit or verify it):\n${i.digest.trim()}`)
  if (i.refPaths?.length) {
    blocks.push(
      `Reference repositories (already cloned under .silent/refs; study them, copy from them only when the task says so):\n${i.refPaths.map((r) => `- ${r.path}${r.hint ? ` — ${r.hint}` : ""}`).join("\n")}`,
    )
  }
  const readOnly = i.role === "bilinc" || i.role === "kesifci"
  if (i.role === "bilinc") blocks.push(BILINC_POLICY)
  if (i.role === "kesifci") blocks.push(KESIFCI_POLICY)
  if (i.role === "dikis") blocks.push(DIKIS_POLICY)
  if (i.role === "donusturucu") blocks.push(DONUSTURUCU_POLICY)
  else if (i.converterTool && !readOnly) blocks.push(CONVERTER_TOOLKIT)
  if (i.imageTool && !readOnly) blocks.push(IMAGE_TOOL_HINT)
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
  // `# MODEL` is matched as a whole line so `# MODEL_REQUESTS` / `# MODEL_DELIVERY` (Model Plus internals) do not count.
  const modelAt = (() => { let last = -1; const re = /^# MODEL[ \t]*$/gm; let m: RegExpExecArray | null; while ((m = re.exec(t))) last = m.index; return last })()
  const idx = Math.max(upper.lastIndexOf("# FINDINGS"), upper.lastIndexOf("# CONVERTED"), upper.lastIndexOf("# FIXED"), upper.lastIndexOf("# RECON"), upper.lastIndexOf("# CHECK"), upper.lastIndexOf("# VERIFY"), modelAt)
  return idx >= 0 ? t.slice(idx).trim() : t
}
