import type { CliRunRequest, ProviderId, RuntimeEvent, SubtaskKind } from "@/domain"
import { parseModelRef } from "@/domain"
import type { Worker, WorkerHandle, WorkerJob, WorkerSink } from "./Worker"

/** Minimal seam the worker needs from the host; `Backend` satisfies it. */
export interface CliRunner {
  cliStart(request: CliRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<{ cancel(): Promise<void> }>
}

/**
 * The only worker: runs a subtask through a real CLI (`codex exec`, `claude -p`, `kimi -p`, …) and maps
 * the normalised RuntimeEvents onto the generic WorkerSink. Which CLI is used comes from the ModelRef.
 */
export class CliWorker implements Worker {
  readonly id = "cli"
  private readonly runner: CliRunner

  constructor(runner: CliRunner) {
    this.runner = runner
  }

  supports(_kind: SubtaskKind, modelRef: string): boolean {
    return parseModelRef(modelRef).providerId.length > 0
  }

  start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
    const { providerId, modelId } = parseModelRef(job.modelId)
    let handle: { cancel(): Promise<void> } | undefined
    let cancelled = false
    const messages: string[] = []
    let failure: { message: string; retryable: boolean } | undefined
    let resolveDone!: (r: { ok: boolean; summary: string; error?: string; retryable?: boolean }) => void
    const done = new Promise<{ ok: boolean; summary: string; error?: string; retryable?: boolean }>((r) => (resolveDone = r))

    const request: CliRunRequest = {
      runId: `${job.runId}:${job.subtask.id}:${job.attempt}`,
      providerId: providerId as ProviderId,
      modelId: modelId || undefined,
      prompt: job.brief,
      cwd: job.repoPath,
      sandbox: job.sandbox,
      ephemeral: true,
      review: job.subtask.kind === "review",
    }

    sink.state("planning", 2)
    sink.log(`▶ ${providerId}${modelId ? ` · ${modelId}` : ""} · ${request.sandbox}${request.cwd ? ` · ${request.cwd}` : ""}`, "system")

    const onEvent = (e: RuntimeEvent) => {
      switch (e.type) {
        case "sessionStarted":
          sink.log(`session ${e.data.sessionId}`, "system")
          break
        case "turnStarted":
          sink.state("thinking", 8)
          break
        case "reasoningStatus":
          sink.state("thinking")
          sink.log(e.data.status, "system")
          break
        case "commandStarted":
          sink.state(/test|vitest|jest|pytest|cargo test|go test/.test(e.data.command) ? "testing" : "coding")
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
          if (e.data.text.trim()) {
            messages.push(e.data.text)
            sink.state("reviewing", 90)
            sink.log(e.data.text)
          }
          break
        case "usage":
          sink.usage(e.data.totalTokens, 0)
          break
        case "cost":
          sink.usage(0, e.data.usd)
          break
        case "stderr":
          sink.log(e.data.line, "stderr")
          break
        case "stdout":
          sink.log(e.data.line)
          break
        case "failed":
          if (e.data.code !== "cancelled") failure = { message: e.data.message, retryable: e.data.retryable }
          sink.log(`${e.data.code}: ${e.data.message}`, "stderr")
          break
        case "turnCompleted":
          sink.state("reviewing", 96)
          break
        case "exited": {
          if (cancelled) return resolveDone({ ok: false, summary: "cancelled", error: "cancelled", retryable: false })
          if (failure) return resolveDone({ ok: false, summary: failure.message, error: failure.message, retryable: failure.retryable })
          if (e.data.code !== 0 && e.data.code !== null) return resolveDone({ ok: false, summary: `${providerId} exited ${e.data.code}`, error: `${providerId} exited with code ${e.data.code}`, retryable: true })
          const summary = messages.filter(Boolean).at(-1)?.trim() || `${providerId} completed the task.`
          resolveDone({ ok: true, summary })
        }
      }
    }

    this.runner
      .cliStart(request, onEvent)
      .then((h) => {
        handle = h
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        sink.log(`failed to start ${providerId}: ${message}`, "stderr")
        resolveDone({ ok: false, summary: `Could not start ${providerId}`, error: message, retryable: false })
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
