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
}

/** The task part of the prompt (what must be non-empty for a run to make sense). */
export function aiTaskText(i: Pick<AiPromptInput, "purpose" | "wired" | "extraPrompt">): string {
  return [i.purpose ? `Purpose: ${i.purpose}` : "", i.wired, i.extraPrompt ?? ""].filter((x) => x && x.trim()).join("\n\n")
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
  const instructions = i.instructions?.trim()
  if (instructions) blocks.push(`# Base instructions\n${instructions}`)
  const task = aiTaskText(i)
  if (task) blocks.push(task)
  return blocks.join("\n\n")
}
