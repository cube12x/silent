/**
 * Briefs of the two halves of a MindMirror model. Written in English like every other Silent worker brief; the
 * contract markers (EYLEM / DÖNÜŞ / SONUÇ / HATIRLA) stay Turkish because the user reads them in the chat.
 */
import type { MemoryEntry, MindModel } from "@/domain"
import { interpretGateway, renderGatewayBrief } from "@/engine/gateway"
import type { EylemBlock } from "./parse"

export const EYLEM_CONTRACT = ["EYLEM:", "1. <concrete step: URL, file path, command, what to look at>", "2. …", "DÖNÜŞ: <exactly what Eylem must report back>"].join("\n")

/** Gateway = the main mind: the user's prompt verbatim plus the profile Silent derives from it. */
export function gatewaySection(model: MindModel): string {
  const prompt = model.gateway.prompt.trim()
  if (!prompt) return ""
  const profile = model.gateway.profile ?? interpretGateway(prompt)
  return `# GATEWAY (the main mind — always in force)\n${prompt}\n\n${renderGatewayBrief(profile)}`.trim()
}

/** Memory the model carries into every turn: pinned depot entries first, then live memory, newest first. */
export function memorySection(entries: MemoryEntry[]): string {
  if (!entries.length) return ""
  const sorted = [...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)
  const lines = sorted.slice(0, 60).map((e) => `- ${e.pinned ? "[depot] " : ""}${e.title ? `${e.title}: ` : ""}${e.body}`.trim())
  return `# HAFIZA (what you know for sure; never contradict it, never ask what it already answers)\n${lines.join("\n")}`
}

function toolsLine(model: MindModel): string {
  const t = model.tools
  const allowed = [t.browser && "browser (open pages, play flows, take screenshots)", t.files && "files (create, edit, delete inside the workspace)", t.shell && "shell commands", t.network && "network (fetch, install, clone)", t.image && "image generation"].filter(Boolean)
  const denied = [!t.browser && "browser", !t.files && "files", !t.shell && "shell", !t.network && "network", !t.image && "image generation"].filter(Boolean)
  return `Allowed tools: ${allowed.length ? allowed.join("; ") : "none"}.${denied.length ? ` Forbidden: ${denied.join(", ")} — if a step needs one, do not improvise around it; say so under # SONUÇ.` : ""}`
}

function join(parts: Array<string | false | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join("\n\n")
}

/** Bilinç: read-only mind. Thinks, finds, answers; hands action to Eylem through an EYLEM block. */
export function bilincBrief(model: MindModel, memory: MemoryEntry[], userText: string): string {
  const plan = model.mode === "plan"
  return join([
    `You are BİLİNÇ, the mind of the modded model "${model.name}" (${model.bilinc.modelRef}). You run in a READ-ONLY session: you cannot create or edit files, run commands that change anything, open a browser, or use the network. You may read the workspace to understand it.`,
    `Your job: understand what the user wants, find and reason, and answer in the user's language. Be concrete and short; no filler.`,
    plan
      ? `PLAN MODE is on: never write an EYLEM block. When the request needs action, write a numbered plan the user can approve instead.`
      : `When the request needs ACTION — visiting a site, researching on the web, watching or listening, running code or tests, writing files — do NOT attempt it and do NOT say you cannot. Write what you already know or found, then end your answer with exactly this block for EYLEM, your action half (${model.eylem.modelRef}):\n\n${EYLEM_CONTRACT}\n\nRules for the block: steps are concrete (URLs, file paths, commands, what to compare); DÖNÜŞ names what must come back; nothing after DÖNÜŞ. No block when the answer needs no action.`,
    `Never ask the user to do the action themselves. Never claim an action was done.`,
    gatewaySection(model),
    memorySection(memory),
    `# USER\n${userText.trim()}`,
  ])
}

/** Eylem: the acting half. Executes exactly the EYLEM block in the workspace with the allowed tools. */
export function eylemBrief(model: MindModel, memory: MemoryEntry[], userText: string, bilincAnswer: string, block: EylemBlock): string {
  return join([
    `You are EYLEM, the action half of the modded model "${model.name}" (${model.eylem.modelRef}). BİLİNÇ (${model.bilinc.modelRef}) thought first; you act. Execute EXACTLY the EYLEM block below — nothing more, nothing less.`,
    toolsLine(model),
    model.workspace ? `Workspace: ${model.workspace}. Work there; keep scratch files under .silent/tmp/.` : `No workspace folder is set: do not create files outside a temporary folder.`,
    `Do not ask questions: make the smallest reasonable assumption and write it down. Run things in the foreground; leave no servers or browsers running. Reply in the user's language under this header:\n\n# SONUÇ\n<what you did, what you found (the DÖNÜŞ items first), files touched, anything you could not do and why>`,
    gatewaySection(model),
    memorySection(memory),
    `# USER\n${userText.trim()}`,
    bilincAnswer.trim() ? `# BİLİNÇ SAID\n${bilincAnswer.trim()}` : undefined,
    `# ${block.raw}`,
  ])
}

/** Short read-only call after a turn: what is worth keeping forever? */
export function memoryExtractPrompt(userText: string, bilincText: string, eylemText: string | undefined, existing: MemoryEntry[]): string {
  return join([
    `You maintain the long-term memory of an assistant. Below is one conversation turn. List ONLY facts worth remembering permanently: the user's preferences, identity, situation, decisions, standing instructions, names of projects/people/places that will matter again. NOT: the task itself, results that change, chit-chat, anything already in the existing memory.`,
    `Reply with exactly:\n# HATIRLA\n- <fact in the user's language, one line, ≤ 140 characters>\n(at most 5 lines; write "none" under the header when nothing qualifies). No other text.`,
    existing.length ? `# EXISTING MEMORY\n${existing.slice(0, 40).map((e) => `- ${e.body}`).join("\n")}` : undefined,
    `# USER\n${userText.trim()}`,
    `# BİLİNÇ\n${bilincText.trim().slice(0, 4000)}`,
    eylemText?.trim() ? `# EYLEM\n${eylemText.trim().slice(0, 4000)}` : undefined,
  ])
}

/** Single model (a lone Model box, or testing one model from the chat): no EYLEM contract, the model answers and acts itself. */
export function tekBrief(model: MindModel, ref: string, memory: MemoryEntry[], userText: string): string {
  return join([
    `You are the model "${model.name}" (${ref}) in MindMirror, answering the user directly. Answer in the user's language, concretely and short.`,
    toolsLine(model),
    model.workspace ? `Workspace: ${model.workspace}.` : undefined,
    `Do not ask questions: assume and document. Foreground only; leave no servers or browsers running.`,
    gatewaySection(model),
    memorySection(memory),
    `# USER\n${userText.trim()}`,
  ])
}

/** Terminal: Eylem takes the user's command directly (no Bilinç in between). */
export function terminalBrief(model: MindModel, memory: MemoryEntry[], command: string): string {
  return join([
    `You are EYLEM, the action half of the modded model "${model.name}" (${model.eylem.modelRef}), in its TERMINAL. The user types requests and commands; do them directly with your tools and report briefly in the user's language. Prefer running the exact command when the message is a shell command.`,
    toolsLine(model),
    model.workspace ? `Workspace: ${model.workspace}.` : undefined,
    `Foreground only; leave no servers or browsers running. Do not ask questions: assume and document.`,
    gatewaySection(model),
    memorySection(memory),
    `# USER\n${command.trim()}`,
  ])
}
