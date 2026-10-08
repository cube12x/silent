import type { MindModel } from "@/domain"

/** `silent mind "<model>" …`: by id, else by name with a locale-independent fold (Turkish I/ı, see resolveAutorun). */
export function resolveMind(models: MindModel[], ref: string): MindModel | undefined {
  // Turkish casing first (İ→i, I→ı), then treat dotted and dotless i as the same letter: "IŞIK ZİHNİ" == "Işık Zihni".
  const norm = (v: string) => v.trim().normalize("NFC").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().replace(/ı/g, "i").replace(/i̇/g, "i")
  const want = norm(ref)
  if (!want) return undefined
  return models.find((m) => m.id === ref.trim()) ?? models.find((m) => norm(m.name) === want)
}
