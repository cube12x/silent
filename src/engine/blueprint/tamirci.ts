/**
 * Tamirci AI: "this thing is broken, fix it" from the Dosyalar tab. The request becomes the extra prompt of a
 * single AI box in the open blueprint (created on first use, reused later), so terminal, tokens, effort and
 * reports are the ordinary box machinery.
 */
import type { Blueprint, BpNode, TamirciPreset } from "@/domain"

export interface TamirciRequest {
  problem: string
  /** Files the user attached (relative to the Build folder) — the AI reads them first. */
  files: string[]
  /** Investigate first with a read-only Bilinç box on the same model, then apply with an Eylem box. */
  bilinc: boolean
  preset: TamirciPreset
}

export const TAMIRCI_TITLE = "Tamirci AI"
export const TAMIRCI_BILINC_TITLE = "Tamirci Bilinç"

/** The work order: problem + attached files + the report format the Dosyalar tab shows afterwards. */
export function tamirciExtraPrompt(req: Pick<TamirciRequest, "problem" | "files">): string {
  const files = req.files.length ? `Attached files (start here; read them fully before editing anything):\n${req.files.map((f) => `- ${f}`).join("\n")}` : "No files were attached: locate the code responsible yourself before editing."
  return [
    "# Repair request",
    req.problem.trim(),
    files,
    "Fix the reported problem with the smallest safe change. Keep the project's tests, typecheck and build green (run them). Do not refactor unrelated code. Finish with this report and nothing after it:",
    "# FIXED\n- <file> — <what changed and why>\n# NOT FIXED\n- <what remains, why, and what would be needed>",
  ].join("\n\n")
}

/** Boxes an earlier repair request created in this blueprint. */
export function findTamirciBoxes(bp: Blueprint): { eylem?: BpNode; bilinc?: BpNode } {
  const boxes = bp.nodes.filter((n) => n.data.type === "ai" && n.data.tamirci)
  return {
    eylem: boxes.find((n) => n.data.type === "ai" && n.data.role !== "bilinc"),
    bilinc: boxes.find((n) => n.data.type === "ai" && n.data.role === "bilinc"),
  }
}
