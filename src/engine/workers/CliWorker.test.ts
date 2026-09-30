import { describe, expect, it } from "vitest"
import type { CliRunRequest, RuntimeEvent } from "@/domain"
import { CliWorker, isEnvironmentLimit, isModelRejected, type CliRunner } from "./CliWorker"
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
    subtask: { id: "s1", runId: "r1", kind: "backend", title: "t", description: "d", dependsOn: [], state: "waiting", attempts: [], files: [], commands: [], weight: 1, progress: 0, lastUpdate: 0, answers: [], deviations: [] },
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

  it("separates SILENT_NOTES from SILENT_DEVIATIONS and strips both from the summary", async () => {
    class TalkingRunner implements CliRunner {
      async cliStart(_request: CliRunRequest, onEvent: (event: RuntimeEvent) => void) {
        queueMicrotask(() => {
          onEvent({ type: "agentMessage", data: { text: "Built the enemies module.\n\nSILENT_DEVIATIONS:\n- Kept tuning in a local file\n\nSILENT_NOTES:\n- engine tests were red at the time (not mine)\n- extended World with optional hook" } } as unknown as RuntimeEvent)
          onEvent({ type: "exited", data: { code: 0 } } as unknown as RuntimeEvent)
        })
        return { cancel: async () => {} }
      }
    }
    const result = await new CliWorker(new TalkingRunner()).start(job(), sink).done
    expect(result.ok).toBe(true)
    expect(result.deviations).toEqual(["Kept tuning in a local file"])
    expect(result.notes).toEqual(["engine tests were red at the time (not mine)", "extended World with optional hook"])
    expect(result.summary).toBe("Built the enemies module.")
  })

  it("tolerates markdown-bold markers (**SILENT_DEVIATIONS:** none) without inventing a deviation", async () => {
    class BoldRunner implements CliRunner {
      async cliStart(_request: CliRunRequest, onEvent: (event: RuntimeEvent) => void) {
        queueMicrotask(() => {
          onEvent({ type: "agentMessage", data: { text: "Arena done.\n\n**SILENT_DEVIATIONS:** none\n\n**SILENT_NOTES:** \n- parry tests were red (not mine)\n\n**SILENT_QUESTION:** none" } } as unknown as RuntimeEvent)
          onEvent({ type: "exited", data: { code: 0 } } as unknown as RuntimeEvent)
        })
        return { cancel: async () => {} }
      }
    }
    const result = await new CliWorker(new BoldRunner()).start(job(), sink).done
    expect(result.deviations).toEqual([])
    expect(result.notes).toEqual(["parry tests were red (not mine)"])
    expect(result.summary).toBe("Arena done.")
  })

  it("moves environment-limit deviations into notes", async () => {
    expect(isEnvironmentLimit("Browser playthrough unavailable in this sandbox; pacing unverified.")).toBe(true)
    expect(isEnvironmentLimit("Sandbox kısıtı nedeniyle tarayıcı doğrulaması yapılmadı.")).toBe(true)
    expect(isEnvironmentLimit("Kept tuning in a local file instead of src/config/tuning.ts")).toBe(false)
    expect(isEnvironmentLimit("Did not implement the gamepad rebinding UI")).toBe(false)
    class R implements CliRunner {
      async cliStart(_r: CliRunRequest, onEvent: (event: RuntimeEvent) => void) {
        queueMicrotask(() => {
          onEvent({ type: "agentMessage", data: { text: "done\n\nSILENT_DEVIATIONS:\n- Browser validation unavailable in this sandbox; no browser launch attempted.\n- Skipped the optional docs page" } } as unknown as RuntimeEvent)
          onEvent({ type: "exited", data: { code: 0 } } as unknown as RuntimeEvent)
        })
        return { cancel: async () => {} }
      }
    }
    const result = await new CliWorker(new R()).start(job(), sink).done
    expect(result.deviations).toEqual(["Skipped the optional docs page"])
    expect(result.notes).toEqual(["Browser validation unavailable in this sandbox; no browser launch attempted."])
  })
  it("treats model access/auth/quota errors as a rejected model (fallback, never a same-model retry)", () => {
    expect(isModelRejected("exit_nonzero: error: failed to run prompt: provider.auth_error: 401 Your current subscription does not have access to kimi-for-coding-highspeed. Upgrade to higher-tier Kimi Code plans.")).toBe(true)
    expect(isModelRejected("Error 429: RESOURCE_EXHAUSTED quota exceeded for generate_image")).toBe(true)
    expect(isModelRejected("model gpt-9 is not supported")).toBe(true)
    expect(isModelRejected("codex exited with code 1")).toBe(false)
    expect(isModelRejected("tests failed: 3 of 40")).toBe(false)
  })
})

describe("SILENT_SPLIT (Faz 3)", () => {
  it("returns the sub-briefs as a split and keeps the summary of what was done so far", async () => {
    class SplittingRunner implements CliRunner {
      async cliStart(_r: CliRunRequest, onEvent: (event: RuntimeEvent) => void) {
        queueMicrotask(() => {
          onEvent({ type: "agentMessage", data: { text: "Implemented the player module.\n\nSILENT_SPLIT:\n- Enemy AI: patrol + chase. Owns: src/game/enemies/**\n- Boss fight: phases + HUD. Owns: src/game/boss/**, src/ui/boss.ts\n\nSILENT_DEVIATIONS: none" } } as unknown as RuntimeEvent)
          onEvent({ type: "exited", data: { code: 0 } } as unknown as RuntimeEvent)
        })
        return { cancel: async () => {} }
      }
    }
    const res = await new CliWorker(new SplittingRunner()).start(job(), sink).done
    expect(res.ok).toBe(true)
    expect(res.split).toEqual(["Enemy AI: patrol + chase. Owns: src/game/enemies/**", "Boss fight: phases + HUD. Owns: src/game/boss/**, src/ui/boss.ts"])
    expect(res.summary).toBe("Implemented the player module.")
    expect(res.deviations).toEqual([])
  })
  it("`SILENT_SPLIT: none` is not a split", async () => {
    class Runner implements CliRunner {
      async cliStart(_r: CliRunRequest, onEvent: (event: RuntimeEvent) => void) {
        queueMicrotask(() => {
          onEvent({ type: "agentMessage", data: { text: "done\n\nSILENT_SPLIT: none\nSILENT_DEVIATIONS: none" } } as unknown as RuntimeEvent)
          onEvent({ type: "exited", data: { code: 0 } } as unknown as RuntimeEvent)
        })
        return { cancel: async () => {} }
      }
    }
    const res = await new CliWorker(new Runner()).start(job(), sink).done
    expect(res.ok).toBe(true)
    expect(res.split).toBeUndefined()
    expect(res.summary).toBe("done")
  })
})
