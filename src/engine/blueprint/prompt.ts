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

/** Eylem: the brief that turns Bilinç reports into work. */
export function eylemBrief(reports: Array<{ title: string; report: string }>): string {
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
  /** Bilinç / Eylem role of this node. */
  role?: "bilinc" | "eylem"
  /** Eylem: reports of the Bilinç nodes wired into it. */
  reports?: Array<{ title: string; report: string }>
}

/** The task part of the prompt (what must be non-empty for a run to make sense). */
export function aiTaskText(i: Pick<AiPromptInput, "purpose" | "wired" | "extraPrompt" | "reports">): string {
  return [i.purpose ? `Purpose: ${i.purpose}` : "", i.wired, i.extraPrompt ?? "", eylemBrief(i.reports ?? [])].filter((x) => x && x.trim()).join("\n\n")
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
  if (i.refPaths?.length) {
    blocks.push(
      `Reference repositories (already cloned under .silent/refs; study them, copy from them only when the task says so):\n${i.refPaths.map((r) => `- ${r.path}${r.hint ? ` — ${r.hint}` : ""}`).join("\n")}`,
    )
  }
  if (i.role === "bilinc") blocks.push(BILINC_POLICY)
  const instructions = i.instructions?.trim()
  if (instructions) blocks.push(`# Base instructions\n${instructions}`)
  const task = aiTaskText(i)
  if (task) blocks.push(task)
  return blocks.join("\n\n")
}

/** The report part of a Bilinç reply: from the last `# FINDINGS` heading on (the running commentary before it is dropped). */
export function extractReport(text: string): string {
  const t = text.trim()
  const idx = t.toUpperCase().lastIndexOf("# FINDINGS")
  return idx >= 0 ? t.slice(idx).trim() : t
}
