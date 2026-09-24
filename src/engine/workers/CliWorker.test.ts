import { describe, expect, it } from "vitest"
import type { CliRunRequest, RuntimeEvent } from "@/domain"
import { CliWorker, type CliRunner } from "./CliWorker"
import type { WorkerJob, WorkerSink } from "./Worker"

/** Captures the request the worker hands to the host and completes the run immediately. */
class CapturingRunner implements CliRunner {
  requests: CliRunRequest[] = []
  async cliStart(request: CliRunRequest, onEvent: (event: RuntimeEvent) => void) {
    this.requests.push(request)
    queueMicrotask(() => {
      onEvent({ type: "agentMessage", data: { text: "done\n\nSILENT_DEVIATIONS: none" } } as unknown as RuntimeEvent)
      onEvent({ type: "exited", data: { code: 0 } } as unknown as RuntimeEvent)
    })
    return { cancel: async () => {} }
  }
}

const sink: WorkerSink = { state() {}, log() {}, command() {}, file() {}, usage() {}, session() {} } as unknown as WorkerSink

function job(over: Partial<WorkerJob> = {}): WorkerJob {
  return {
    runId: "r1",
    subtask: { id: "s1", runId: "r1", kind: "backend", title: "t", description: "d", dependsOn: [], state: "queued", attempts: [], files: [], commands: [], weight: 1, progress: 0, lastUpdate: 0, answers: [], deviations: [] },
    modelId: "codex:gpt-6-sol",
    attempt: 1,
    brief: "do it",
    repoPath: "/repo",
    sandbox: "workspace-write",
    network: true,
    effort: "medium",
    timeoutSecs: 600,
    ...over,
  }
}

describe("CliWorker request shape", () => {
  it("forwards sandbox, network, cwd, effort and timeout to the host request", async () => {
    const runner = new CapturingRunner()
    const worker = new CliWorker(runner)
    await worker.start(job(), sink).done
    const req = runner.requests[0]
    expect(req.providerId).toBe("codex")
    expect(req.modelId).toBe("gpt-6-sol")
    expect(req.sandbox).toBe("workspace-write")
    expect(req.network).toBe(true)
    expect(req.cwd).toBe("/repo")
    expect(req.effort).toBe("medium")
    expect(req.timeoutSecs).toBe(600)
  })

  it("keeps network off when the job says so", async () => {
    const runner = new CapturingRunner()
    await new CliWorker(runner).start(job({ network: false, sandbox: "read-only" }), sink).done
    expect(runner.requests[0].network).toBe(false)
    expect(runner.requests[0].sandbox).toBe("read-only")
  })
})
