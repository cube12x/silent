/**
 * Markers of the MindMirror contract. Bilinç ends an answer that needs action with:
 *
 *   EYLEM:
 *   1. <step>
 *   DÖNÜŞ: <what Eylem reports back>
 *
 * Eylem reports under `# SONUÇ`; the memory extractor answers `# HATIRLA` + bullet lines or `none`.
 * Models write markers in bold or inside code fences now and then (2026-09-26 lesson from SILENT_DEVIATIONS), so
 * every parser tolerates `**` and ignores fenced code.
 */

export interface EylemBlock {
  /** Every content line of the order before DÖNÜŞ (section headers kept), numbering/bullets stripped. */
  steps: string[]
  returns?: string
  /** Files the order names under DOSYALAR (first token of each bullet), for the chat chips. */
  files: string[]
  /** The block as written (header to end), for the Eylem brief. */
  raw: string
}

const SECTION = /^\s*\**\s*(HEDEF|DOSYALAR|ADIMLAR|KURALLAR|DOĞRULAMA|DOGRULAMA)\s*:?\s*\**\s*(.*)$/i

const FENCE = /```[\s\S]*?```/g
const EYLEM_HEADER = /^\s*\**\s*EYLEM\s*:?\s*\**\s*$/i
const RETURNS_LINE = /^\s*\**\s*(?:DÖNÜŞ|DONUS|DÖNÜS|RETURN)\s*:\s*\**\s*(.*)$/i

/** The last `EYLEM:` block of `text` (outside code fences), or undefined when the mind needs no action. */
export function parseEylemBlock(text: string): EylemBlock | undefined {
  const clean = text.replace(FENCE, "")
  const lines = clean.split(/\r?\n/)
  let header = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (EYLEM_HEADER.test(lines[i]!)) {
      header = i
      break
    }
  }
  if (header < 0) return undefined
  const steps: string[] = []
  const files: string[] = []
  let returns: string | undefined
  const returnLines: string[] = []
  let inReturns = false
  let section = ""
  for (const line of lines.slice(header + 1)) {
    const r = RETURNS_LINE.exec(line)
    if (r) {
      inReturns = true
      if (r[1]?.trim()) returnLines.push(r[1].trim())
      continue
    }
    const t = line.replace(/\*\*/g, "").trim()
    if (!t) continue
    if (inReturns) {
      returnLines.push(t)
      continue
    }
    const s = SECTION.exec(t)
    if (s) {
      section = s[1]!.toUpperCase().replace("DOGRULAMA", "DOĞRULAMA")
      steps.push(`${section}:${s[2]?.trim() ? ` ${s[2].trim()}` : ""}`)
      continue
    }
    const item = t.replace(/^(?:\d+[.)]|[-*•])\s*/, "")
    steps.push(item)
    if (section === "DOSYALAR") {
      const path = item.split(/\s+[—–-]\s+|\s{2,}|:\s/)[0]?.replace(/^[`'"]|[`'"]$/g, "").trim()
      if (path && /[./\\]/.test(path) && !files.includes(path)) files.push(path)
    }
  }
  if (returnLines.length) returns = returnLines.join(" ")
  if (!steps.length && !returns) return undefined
  return { steps, returns, files, raw: lines.slice(header).join("\n").trim() }
}

/** Bilinç's answer without its EYLEM block (what the chat shows as the mind's message). */
export function stripEylem(text: string): string {
  const lines = text.split(/\r?\n/)
  let header = -1
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (/^\s*```/.test(l)) fence = !fence
    if (!fence && EYLEM_HEADER.test(l)) header = i
  }
  if (header < 0) return text.trim()
  return lines.slice(0, header).join("\n").trim()
}

/**
 * `DÜŞÜNCE:` block at the start of Bilinç's answer (think-aloud for the Düşünme box): the lines after the header up to the
 * first blank line. Returns the thought and the answer without it.
 */
export function parseDusunce(text: string): { thought?: string; rest: string } {
  const m = /^\s*\**\s*(?:DÜŞÜNCE|DUSUNCE|THOUGHT)\s*:?\s*\**\s*\n?/i.exec(text)
  if (!m) return { rest: text.trim() }
  const after = text.slice(m[0].length)
  const end = after.search(/\n\s*\n/)
  const thought = (end >= 0 ? after.slice(0, end) : after).replace(/\*\*/g, "").trim()
  const rest = (end >= 0 ? after.slice(end) : "").trim()
  return { thought: thought || undefined, rest }
}

/** Everything after `# SONUÇ` (or the whole text when Eylem forgot the header). */
export function parseSonuc(text: string): string {
  const m = /^\s*\**\s*#+\s*(?:SONUÇ|SONUC|RESULT)\s*\**\s*$/im.exec(text)
  if (!m || m.index === undefined) return text.trim()
  return text.slice(m.index + m[0].length).trim()
}

/** Bullet lines under `# HATIRLA`; `none`/`yok` or a missing header → nothing to remember. */
export function parseHatirla(text: string): string[] {
  const clean = text.replace(FENCE, "")
  const m = /^\s*\**\s*#+\s*(?:HATIRLA|HATİRLA|REMEMBER)\s*\**\s*$/im.exec(clean)
  if (!m || m.index === undefined) return []
  const out: string[] = []
  for (const raw of clean.slice(m.index + m[0].length).split(/\r?\n/)) {
    const t = raw.replace(/\*\*/g, "").trim()
    if (!t) continue
    if (/^#/.test(t)) break
    const item = t.replace(/^(?:\d+[.)]|[-*•])\s*/, "").trim()
    if (!item || /^(none|yok|hiçbiri|hicbiri|nothing)\.?$/i.test(item)) continue
    out.push(item.slice(0, 200))
    if (out.length >= 5) break
  }
  return out
}
