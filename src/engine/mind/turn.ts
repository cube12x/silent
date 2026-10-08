/**
 * One MindMirror chat turn: Bilinç thinks (read-only) → if it wrote an EYLEM block and the model is in act mode,
 * Eylem executes it (workspace-write within the allowed tools) → a short read-only call on the Eylem model extracts
 * what is worth remembering. Pure orchestration over `runSingle`; the store turns the callbacks into messages.
 */
import type { Backend } from "@/services/backend"
import type { MemoryEntry, MindActor, MindModel, ProviderId } from "@/domain"
import { parseModelRef } from "@/domain"
import { clampEffort } from "@/engine/effort"
import { runSingle, type SingleRunResult } from "@/engine/blueprint/single"
import { parseEylemBlock, parseHatirla, stripEylem, type EylemBlock } from "./parse"
import { bilincBrief, eylemBrief, memoryExtractPrompt } from "./prompts"

export type MindStage = MindActor | "memory"

export interface MindTurnCallbacks {
  onStart?: (stage: MindStage) => void
  onDelta?: (actor: MindActor, text: string) => void
  onLine?: (stage: MindStage, line: string, stream: "stdout" | "stderr" | "system") => void
  /** A half finished (ok or not); `text` is what the chat shows (Bilinç without its EYLEM block). */
  onMessage?: (actor: MindActor, result: MindHalfResult) => void
  onMemory?: (lines: string[]) => void
}

export interface MindHalfResult {
  ok: boolean
  text: string
  tokens: number
  sessionId?: string
  error?: string
}

export interface MindTurnResult {
  ok: boolean
  error?: string
  bilinc: MindHalfResult
  eylem?: MindHalfResult
  eylemBlock?: EylemBlock
  /** Bilinç wanted action but the model is in plan mode (nothing was executed). */
  planned: boolean
  remembered: string[]
  memoryTokens: number
  tokens: number
  cancelled: boolean
}

export interface MindTurnOptions {
  now?: () => number
  /** Skip the memory extraction call (tests, `/plan` dry runs). Default: extract. */
  extractMemory?: boolean
  bilincTimeoutSecs?: number
  eylemTimeoutSecs?: number
  /** `# ORTAK BAĞLAM` block (see context.ts): the same transcript goes to both halves so their contexts match. */
  shared?: string
}

const BILINC_TIMEOUT = 20 * 60
const EYLEM_TIMEOUT = 40 * 60
const MEMORY_TIMEOUT = 120

function effortFor(ref: string, effort: MindModel["bilinc"]["effort"]): string | undefined {
  return clampEffort(parseModelRef(ref).providerId as ProviderId, effort)
}

function half(r: SingleRunResult, shownText: string): MindHalfResult {
  return { ok: r.ok, text: shownText, tokens: r.tokens, sessionId: r.sessionId, error: r.error }
}

export function runMindTurn(backend: Pick<Backend, "cliStart">, model: MindModel, userText: string, memory: MemoryEntry[], cb: MindTurnCallbacks = {}, opts: MindTurnOptions = {}): { done: Promise<MindTurnResult>; cancel: () => Promise<void> } {
  const now = opts.now ?? (() => Date.now())
  let current: { cancel: () => Promise<void> } | undefined
  let cancelled = false
  const cancel = async () => {
    cancelled = true
    await current?.cancel()
  }
  const line = (stage: MindStage) => (l: string, stream: "stdout" | "stderr" | "system") => cb.onLine?.(stage, l, stream)

  const done = (async (): Promise<MindTurnResult> => {
    // 1. Bilinç — read-only, its own session.
    cb.onStart?.("bilinc")
    const bilincRun = runSingle(
      backend,
      {
        runId: `mind:bilinc:${model.id}:${now()}`,
        modelRef: model.bilinc.modelRef,
        prompt: bilincBrief(model, memory, userText, opts.shared),
        cwd: model.workspace,
        readOnly: true,
        resumeSessionId: model.sessions.bilinc,
        timeoutSecs: opts.bilincTimeoutSecs ?? BILINC_TIMEOUT,
        effort: effortFor(model.bilinc.modelRef, model.bilinc.effort),
        onDelta: (t) => cb.onDelta?.("bilinc", t),
      },
      line("bilinc"),
    )
    current = bilincRun
    const bilincRaw = await bilincRun.done
    const block = bilincRaw.ok ? parseEylemBlock(bilincRaw.text) : undefined
    const bilinc = half(bilincRaw, block ? stripEylem(bilincRaw.text) : bilincRaw.text)
    cb.onMessage?.("bilinc", bilinc)
    const base: MindTurnResult = { ok: bilincRaw.ok, error: bilincRaw.error, bilinc, eylemBlock: block, planned: false, remembered: [], memoryTokens: 0, tokens: bilincRaw.tokens, cancelled }
    if (!bilincRaw.ok || cancelled) return { ...base, cancelled }

    // 2. Eylem — only when the mind asked for action and the model is not in plan mode.
    let eylem: MindHalfResult | undefined
    if (block && model.mode === "act") {
      cb.onStart?.("eylem")
      const eylemRun = runSingle(
        backend,
        {
          runId: `mind:eylem:${model.id}:${now()}`,
          modelRef: model.eylem.modelRef,
          prompt: eylemBrief(model, memory, userText, bilinc.text, block, opts.shared),
          cwd: model.workspace,
          readOnly: !model.tools.files,
          network: model.tools.network,
          resumeSessionId: model.sessions.eylem,
          timeoutSecs: opts.eylemTimeoutSecs ?? EYLEM_TIMEOUT,
          effort: effortFor(model.eylem.modelRef, model.eylem.effort),
          onDelta: (t) => cb.onDelta?.("eylem", t),
        },
        line("eylem"),
      )
      current = eylemRun
      const eylemRaw = await eylemRun.done
      eylem = half(eylemRaw, eylemRaw.text)
      cb.onMessage?.("eylem", eylem)
      base.eylem = eylem
      base.tokens += eylemRaw.tokens
      if (!eylemRaw.ok) {
        base.ok = false
        base.error = eylemRaw.error
      }
      if (cancelled) return { ...base, cancelled }
    } else if (block) {
      base.planned = true
    }

    // 3. Memory — a cheap read-only look at the turn; failures never fail the turn.
    if (opts.extractMemory !== false && !cancelled) {
      cb.onStart?.("memory")
      const memRun = runSingle(
        backend,
        {
          runId: `mind:mem:${model.id}:${now()}`,
          modelRef: model.eylem.modelRef,
          prompt: memoryExtractPrompt(userText, bilinc.text, eylem?.text, memory),
          cwd: model.workspace,
          readOnly: true,
          timeoutSecs: MEMORY_TIMEOUT,
          effort: effortFor(model.eylem.modelRef, "low"),
        },
        line("memory"),
      )
      current = memRun
      const memRaw = await memRun.done
      base.memoryTokens = memRaw.tokens
      base.tokens += memRaw.tokens
      if (memRaw.ok) {
        base.remembered = parseHatirla(memRaw.text)
        if (base.remembered.length) cb.onMemory?.(base.remembered)
      }
    }
    return { ...base, cancelled }
  })()

  return { done, cancel }
}
