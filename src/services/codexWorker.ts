import type { CodexRunRequest, RuntimeEvent, SubtaskKind } from "@/domain"
import type { Worker, WorkerHandle, WorkerJob, WorkerSink } from "@/engine/workers/Worker"
import { MODEL_BY_ID } from "@/engine/capabilities"
import type { Backend, CodexRunHandle } from "./backend"

const COST_IN = 0.002 / 1000
const COST_OUT = 0.008 / 1000

/**
 * Real worker: runs a Silent Code subtask through `codex exec` (ephemeral, sandboxed) and maps the
 * JSONL-derived RuntimeEvents onto the generic WorkerSink so the UI is provider-agnostic.
 */
export class CodexWorker implements Worker {
  readonly id = "codex"

  private readonly backend: Backend

  constructor(backend: Backend) {
    this.backend = backend
  }

  supports(_kind: SubtaskKind, modelId: string): boolean {
    return MODEL_BY_ID[modelId]?.providerId === "codex"
  }

  start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
    let handle: CodexRunHandle | undefined
    let cancelled = false
    let lastMessage = ""
    let failure: { message: string; retryable: boolean } | undefined
    let resolveDone!: (r: { ok: boolean; summary: string; error?: string; retryable?: boolean }) => void
    const done = new Promise<{ ok: boolean; summary: string; error?: string; retryable?: boolean }>((r) => (resolveDone = r))

    const request: CodexRunRequest = {
      runId: `${job.runId}:${job.subtask.id}:${job.attempt}`,
      prompt: job.brief,
      cwd: job.repoPath,
      sandbox: job.sandbox,
      ephemeral: true,
      review: job.subtask.kind === "review",
      skipGitRepoCheck: true,
    }

    sink.state("planning", 2)
    sink.log(`$ codex -a never -s ${request.sandbox}${request.cwd ? ` -C ${request.cwd}` : ""} exec --json --ephemeral${request.review ? " review" : ""} …`, "system")

    const onEvent = (e: RuntimeEvent) => {
      switch (e.type) {
        case "threadStarted":
          sink.log(`thread ${e.data.threadId}`, "system")
          break
        case "turnStarted":
          sink.state("thinking", 8)
          break
        case "reasoningStatus":
          sink.state("thinking")
          sink.log(e.data.status, "system")
          break
        case "commandStarted":
          sink.state(/test|vitest|jest|pytest|cargo test/.test(e.data.command) ? "testing" : "coding")
          sink.command(e.data.command)
          sink.log(`$ ${e.data.command}`)
          break
        case "commandCompleted":
          if (e.data.outputTail) sink.log(e.data.outputTail)
          sink.log(`↳ exit ${e.data.exitCode ?? "?"}`, "system")
          break
        case "fileChanged":
          sink.state("coding")
          sink.file(e.data.path)
          sink.log(`${e.data.kind} ${e.data.path}`)
          break
        case "textDelta":
          break
        case "agentMessage":
          lastMessage = e.data.text
          sink.state("reviewing", 90)
          sink.log(e.data.text)
          break
        case "usage":
          sink.usage(e.data.totalTokens, e.data.inputTokens * COST_IN + e.data.outputTokens * COST_OUT)
          break
        case "stderr":
          sink.log(e.data.line, "stderr")
          break
        case "stdout":
          sink.log(e.data.line)
          break
        case "failed":
          failure = { message: e.data.message, retryable: e.data.retryable }
          sink.log(`${e.data.code}: ${e.data.message}`, "stderr")
          break
        case "turnCompleted":
          sink.state("reviewing", 96)
          break
        case "exited": {
          if (cancelled) return resolveDone({ ok: false, summary: "cancelled", error: "cancelled", retryable: false })
          if (failure) return resolveDone({ ok: false, summary: "Codex reported an error", error: failure.message, retryable: failure.retryable })
          if (e.data.code !== 0 && e.data.code !== null) return resolveDone({ ok: false, summary: `codex exited ${e.data.code}`, error: `codex exited with code ${e.data.code}`, retryable: true })
          resolveDone({ ok: true, summary: lastMessage.trim() || "Codex completed the task (no final message)." })
        }
      }
    }

    this.backend
      .codexStart(request, onEvent)
      .then((h) => {
        handle = h
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        sink.log(`failed to start codex: ${message}`, "stderr")
        resolveDone({ ok: false, summary: "Could not start Codex CLI", error: message, retryable: false })
      })

    return {
      done,
      cancel: () => {
        cancelled = true
        void handle?.cancel()
      },
    }
  }
}
