/**
 * Slash commands shared by the Mind chat and the Mind terminal. Pure: the store applies them.
 */
import type { Effort, MindActor } from "@/domain"

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh"]

export type MindCommand =
  | { kind: "model"; actor: MindActor; modelRef: string }
  | { kind: "plan" }
  | { kind: "act" }
  | { kind: "effort"; actor?: MindActor; effort: Effort }
  | { kind: "hatirla"; text: string }
  | { kind: "unut"; id: string }
  | { kind: "reset" }
  | { kind: "durum" }
  | { kind: "yardim" }
  | { kind: "unknown"; name: string }

export const MIND_COMMAND_HELP = [
  "/model bilinc|eylem <provider:model>",
  "/plan · /act",
  "/effort [bilinc|eylem] low|medium|high|xhigh",
  "/hatirla <metin>",
  "/unut <id>",
  "/durum · /reset · /yardim",
]

function actorOf(word: string | undefined): MindActor | undefined {
  const w = word?.toLowerCase().replace("ç", "c")
  if (w === "bilinc" || w === "mind") return "bilinc"
  if (w === "eylem" || w === "action") return "eylem"
  return undefined
}

/** `null` when `text` is not a command (does not start with `/`). */
export function parseMindCommand(text: string): MindCommand | null {
  const t = text.trim()
  if (!t.startsWith("/")) return null
  const [head, ...rest] = t.slice(1).split(/\s+/)
  const name = (head ?? "").toLowerCase()
  const arg = rest.join(" ").trim()
  switch (name) {
    case "model": {
      const actor = actorOf(rest[0])
      const ref = rest[1] ?? ""
      if (!actor || !ref.includes(":")) return { kind: "unknown", name: "model" }
      return { kind: "model", actor, modelRef: ref }
    }
    case "plan":
      return { kind: "plan" }
    case "act":
    case "eylem":
      return { kind: "act" }
    case "effort": {
      const actor = actorOf(rest[0])
      const lvl = (actor ? rest[1] : rest[0])?.toLowerCase() as Effort | undefined
      if (!lvl || !EFFORTS.includes(lvl)) return { kind: "unknown", name: "effort" }
      return { kind: "effort", actor, effort: lvl }
    }
    case "hatirla":
    case "hatırla":
    case "remember":
      return arg ? { kind: "hatirla", text: arg } : { kind: "unknown", name: "hatirla" }
    case "unut":
    case "forget":
      return arg ? { kind: "unut", id: arg } : { kind: "unknown", name: "unut" }
    case "reset":
      return { kind: "reset" }
    case "durum":
    case "status":
      return { kind: "durum" }
    case "yardim":
    case "yardım":
    case "help":
      return { kind: "yardim" }
    default:
      return { kind: "unknown", name }
  }
}
