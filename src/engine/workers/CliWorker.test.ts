import { describe, expect, it } from "vitest"
import type { CliRunRequest, RuntimeEvent } from "@/domain"
import { CliWorker, isEnvironmentLimit, isKilled, isModelRejected, type CliRunner } from "./CliWorker"
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
  it("multi-line sub-briefs with blank lines between them are kept whole (2026-10-03: a paragraph-style split was cut to its first lines)", async () => {
    class Runner implements CliRunner {
      async cliStart(_r: CliRunRequest, onEvent: (event: RuntimeEvent) => void) {
        queueMicrotask(() => {
          onEvent({ type: "agentMessage", data: { text: "Survey done.\n\nSILENT_SPLIT:\n1. Sub-brief A — blocks that bind to the world. Owns: src/game/anchor/**\n   Respawn anchor: registerBehavior('respawn_anchor'), lodestone compass.\n\n2. Sub-brief B — containers. Owns: src/game/containers/**\n   Hopper and dropper transfer.\n\nSILENT_DEVIATIONS: none" } } as unknown as RuntimeEvent)
          onEvent({ type: "exited", data: { code: 0 } } as unknown as RuntimeEvent)
        })
        return { cancel: async () => {} }
      }
    }
    const res = await new CliWorker(new Runner()).start(job(), sink).done
    expect(res.split).toEqual([
      "Sub-brief A — blocks that bind to the world. Owns: src/game/anchor/**\nRespawn anchor: registerBehavior('respawn_anchor'), lodestone compass.",
      "Sub-brief B — containers. Owns: src/game/containers/**\nHopper and dropper transfer.",
    ])
    expect(res.summary).toBe("Survey done.")
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


describe("handover support", () => {
  it("keeps the agent's last message on failure so the next model can continue", async () => {
    class LimitRunner implements CliRunner {
      async cliStart(_r: CliRunRequest, onEvent: (event: RuntimeEvent) => void) {
        queueMicrotask(() => {
          onEvent({ type: "agentMessage", data: { text: "Wrote src/a.ts; next I will add tests." } } as unknown as RuntimeEvent)
          onEvent({ type: "failed", data: { code: "exit", message: "You have hit your usage limit", retryable: false } } as unknown as RuntimeEvent)
          onEvent({ type: "exited", data: { code: 1 } } as unknown as RuntimeEvent)
        })
        return { cancel: async () => {} }
      }
    }
    const res = await new CliWorker(new LimitRunner()).start(job(), sink).done
    expect(res.ok).toBe(false)
    expect(res.lastMessage).toContain("next I will add tests")
    expect(res.retryable).toBe(true) // model rejection → the executor hands over instead of retrying
  })
})


describe("killed from outside (SIGTERM/SIGKILL)", () => {
  it("exit code 143 resumes the session like a time limit instead of failing the task", async () => {
    class KilledRunner implements CliRunner {
      async cliStart(_r: CliRunRequest, onEvent: (event: RuntimeEvent) => void) {
        queueMicrotask(() => {
          onEvent({ type: "sessionStarted", data: { sessionId: "s-9" } } as unknown as RuntimeEvent)
          onEvent({ type: "failed", data: { code: "exit_nonzero", message: "exit_nonzero: process exited with code 143", retryable: false } } as unknown as RuntimeEvent)
          onEvent({ type: "exited", data: { code: 143 } } as unknown as RuntimeEvent)
        })
        return { cancel: async () => {} }
      }
    }
    const res = await new CliWorker(new KilledRunner()).start(job(), sink).done
    expect(res.ok).toBe(false)
    expect(res.timedOut).toBe(true)
    expect(res.retryable).toBe(true)
    expect(isKilled("process exited with code 137")).toBe(true)
    expect(isKilled("exited with code 1")).toBe(false)
  })
})

/** Feeds a scripted event list to the worker. */
class ScriptRunner implements CliRunner {
  private readonly events: RuntimeEvent[]
  constructor(events: RuntimeEvent[]) {
    this.events = events
  }
  async cliStart(_request: CliRunRequest, onEvent: (event: RuntimeEvent) => void) {
    queueMicrotask(() => {
      for (const e of this.events) onEvent(e)
    })
    return { cancel: async () => {} }
  }
}
const ev = (type: string, data: Record<string, unknown>) => ({ type, data }) as unknown as RuntimeEvent

describe("signal death, split intro lines and question false positives (2026-10-05)", () => {
  it("an exit without a code (killed by a signal) is a retryable failure, not a success", async () => {
    const res = await new CliWorker(new ScriptRunner([ev("agentMessage", { text: "halfway there" }), ev("exited", { code: null })])).start(job(), sink).done
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/killed by signal/)
    expect(res.retryable).toBe(true)
    expect(res.timedOut).toBeFalsy()
  })
  it("a SILENT_SPLIT intro line is not a sub-task: only bullets start parts", async () => {
    const text = "SILENT_SPLIT:\nRemaining work, as three parts:\n- Enemies: spawn and AI\n  with patrol routes\n- Bosses: three phases\n- HUD: health and score\n\nSILENT_DEVIATIONS: none"
    const res = await new CliWorker(new ScriptRunner([ev("agentMessage", { text }), ev("exited", { code: 0 })])).start(job(), sink).done
    expect(res.split).toEqual(["Enemies: spawn and AI\nwith patrol routes", "Bosses: three phases", "HUD: health and score"])
  })
  it("a SILENT_QUESTION inside backticks, or answered with none/no questions, does not block", async () => {
    for (const text of [
      "I will write `SILENT_QUESTION: <q>` if I get blocked. Done.\n\nSILENT_DEVIATIONS: none",
      "Done.\n\nSILENT_QUESTION: No questions.\nSILENT_DEVIATIONS: none",
      "Done.\n\nSILENT_QUESTION: N/A",
      "```\nSILENT_QUESTION: should I?\n```\nAll good.",
    ]) {
      const res = await new CliWorker(new ScriptRunner([ev("agentMessage", { text }), ev("exited", { code: 0 })])).start(job(), sink).done
      expect(res.blocked, text).toBeFalsy()
      expect(res.ok, text).toBe(true)
    }
  })
  it("a later message without a question clears an earlier one (the agent answered it itself)", async () => {
    const res = await new CliWorker(new ScriptRunner([ev("agentMessage", { text: "SILENT_QUESTION: which port?" }), ev("agentMessage", { text: "Using 3000. Done.\n\nSILENT_DEVIATIONS: none" }), ev("exited", { code: 0 })])).start(job(), sink).done
    expect(res.blocked).toBeFalsy()
    expect(res.ok).toBe(true)
  })
})

describe("dead sessions and activity (2026-10-05 stall fixes F2)", () => {
  it("an idle kill is a dead session: retryable, NOT a timeout to resume", async () => {
    const res = await new CliWorker(new ScriptRunner([ev("sessionStarted", { sessionId: "s1" }), ev("failed", { code: "idle", message: "process exceeded 900 s timeout (no output for 900 s)", retryable: true }), ev("exited", { code: null })])).start(job(), sink).done
    expect(res.ok).toBe(false)
    expect(res.timedOut).toBeFalsy()
    expect(res.retryable).toBe(true)
    expect(res.error).toMatch(/dead session/)
    expect(res.activity).toEqual({ messages: 0, commands: 0, events: 0 })
  })
  it("a soft-limit timeout with no activity at all is a dead session too", async () => {
    const res = await new CliWorker(new ScriptRunner([ev("sessionStarted", { sessionId: "s1" }), ev("failed", { code: "timeout", message: "process exceeded 900 s timeout (900 s limit reached, stopped at a quiet moment)", retryable: false }), ev("exited", { code: 143 })])).start(job(), sink).done
    expect(res.timedOut).toBeFalsy()
    expect(res.retryable).toBe(true)
    expect(res.error).toMatch(/dead session/)
  })
  it("a timeout after real activity is still a resumable timeout and reports the activity", async () => {
    const res = await new CliWorker(new ScriptRunner([ev("sessionStarted", { sessionId: "s1" }), ev("agentMessage", { text: "working on it" }), ev("commandStarted", { command: "npm test" }), ev("commandCompleted", { exitCode: 0 }), ev("failed", { code: "timeout", message: "process exceeded 900 s timeout (900 s limit reached, stopped at a quiet moment)", retryable: false }), ev("exited", { code: 143 })])).start(job(), sink).done
    expect(res.timedOut).toBe(true)
    expect(res.activity).toMatchObject({ messages: 1, commands: 1 })
    expect(res.activity!.events).toBeGreaterThanOrEqual(3)
  })
})
