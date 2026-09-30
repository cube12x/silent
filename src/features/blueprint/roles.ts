import type { BpAiData } from "@/domain/blueprint"

/** Label + hint keys for an AI role; one place so every new role shows up in the node and the panel. */
export function roleLabel(role: BpAiData["role"], t: (k: never) => string): string | undefined {
  if (!role) return undefined
  return t(`bp.node.${role}` as never)
}
export function roleHint(role: BpAiData["role"], t: (k: never) => string): string | undefined {
  if (!role) return undefined
  return t(`bp.roleHint.${role}` as never)
}
