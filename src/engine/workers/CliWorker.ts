import type { CliRunRequest, ProviderId, RuntimeEvent, SubtaskKind } from "@/domain"
import { parseModelRef } from "@/domain"
import type { Worker, WorkerHandle, WorkerJob, WorkerResult, WorkerSink } from "./Worker"

/** The CLI rejected the model itself (plan/account restriction, unknown id): try another model, and let the UI mark it. */
export function isModelRejected(message: string): boolean {
  return /model.{0,40}(is not supported|not supported|unsupported|not available|unavailable|does not exist|unknown model|invalid model)|unsupported model|invalid_model|model_not_found/i.test(message)
}

/** Minimal seam the worker needs from the host; `Backend` satisfies it. */
export interface CliRunner {
  cliStart(request: CliRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<{ cancel(): Promise<void> }>
}

/**
 * The only worker: runs a subtask through a real CLI and maps the normalised RuntimeEvents onto the
 * generic WorkerSink. Sessions are persistent so a timed-out attempt can be resumed instead of restarted.
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
    let question: string | undefined
    const deviations: string[] = []
    let failure: { message: string; retryable: boolean; timedOut: boolean } | undefined
    let resolveDone!: (r: WorkerResult) => void
    const done = new Promise<WorkerResult>((r) => (resolveDone = r))

    const request: CliRunRequest = {
      runId: `${job.runId}:${job.subtask.id}:${job.attempt}`,
      providerId: providerId as ProviderId,
      modelId: modelId || undefined,
      prompt: job.brief,
      cwd: job.repoPath,
      sandbox: job.sandbox,
      ephemeral: false,
      review: job.subtask.kind === "review",
      effort: job.effort,
      timeoutSecs: job.timeoutSecs,
      resumeSessionId: job.resumeSessionId,
    }

    sink.state("planning", 2)
    sink.log(`▶ ${providerId}${modelId ? ` · ${modelId}` : ""} · ${request.sandbox} · effort ${job.effort} · ${Math.round(job.timeoutSecs / 60)} min${job.resumeSessionId ? ` · resume ${job.resumeSessionId.slice(0, 8)}…` : ""}${request.cwd ? ` · ${request.cwd}` : ""}`, "system")

    const onEvent = (e: RuntimeEvent) => {
      switch (e.type) {
        case "sessionStarted":
          sink.session(e.data.sessionId)
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
        case "agentMessage": {
          const text = e.data.text
          if (!text.trim()) break
          const q = text.match(/SILENT_QUESTION:\s*(.+)/)
          if (q) question = q[1].trim()
          const dev = text.match(/SILENT_DEVIATIONS:\s*([\s\S]*?)(?:\n\s*\n|$)/)
          if (dev) for (const line of dev[1].split("\n")) {
            const item = line.replace(/^\s*[-*•]\s*/, "").trim()
            if (item && !/^(none|yok|hiçbiri|no deviations?)\.?$/i.test(item)) deviations.push(item)
          }
          messages.push(text.replace(/SILENT_DEVIATIONS:[\s\S]*$/, "").replace(/SILENT_QUESTION:.*$/m, "").trim())
          sink.state(question ? "blocked" : "reviewing", 90)
          sink.log(text)
          break
        }
        case "usage":
          // Cached input is nearly free and inflates the number; show what actually costs.
          sink.usage(Math.max(0, e.data.inputTokens - e.data.cachedInputTokens) + e.data.outputTokens, 0)
          break
        case "cost":
          sink.usage(0, e.data.usd)
          break
        case "stderr":
          sink.log(e.data.line, "stderr")
          if (isModelRejected(e.data.line)) failure = { message: e.data.line, retryable: true, timedOut: false }
          break
        case "stdout":
          sink.log(e.data.line)
          break
        case "failed":
          if (e.data.code !== "cancelled") failure = { message: e.data.message, retryable: e.data.retryable || isModelRejected(e.data.message), timedOut: e.data.code === "timeout" }
          sink.log(`${e.data.code}: ${e.data.message}`, "stderr")
          break
        case "turnCompleted":
          sink.state("reviewing", 96)
          break
        case "exited": {
          if (cancelled) return resolveDone({ ok: false, summary: "cancelled", error: "cancelled", retryable: false })
          if (question) return resolveDone({ ok: false, blocked: true, question, summary: question, retryable: false, deviations })
          if (failure) return resolveDone({ ok: false, summary: failure.message, error: failure.message, retryable: failure.retryable, timedOut: failure.timedOut, deviations })
          if (e.data.code !== 0 && e.data.code !== null) return resolveDone({ ok: false, summary: `${providerId} exited ${e.data.code}`, error: `${providerId} exited with code ${e.data.code}`, retryable: true })
          const summary = messages.filter(Boolean).at(-1)?.trim() || `${providerId} completed the task.`
          resolveDone({ ok: true, summary, deviations })
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
