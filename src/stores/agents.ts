import { create } from "zustand"
import type { AgentAction, AgentPermissions, ProviderId, RepoAgent } from "@/domain"
import { DEFAULT_PERMISSIONS , PIXEL_MASTER_SEED, type RunDefaults } from "@/domain"
import { interpretGateway } from "@/engine/gateway"
import { getBackend } from "@/services"
import { newId } from "@/lib/ids"

export interface CreateAgentInput {
  name: string
  repoPath: string
  providerId: ProviderId
  modelId: string
  fallbackModelRefs?: string[]
  gatewayPrompt: string
  permissions?: Partial<AgentPermissions>
  sourceRunId?: string
  template?: boolean
  runDefaults?: RunDefaults
}

interface AgentsState {
  agents: RepoAgent[]
  load(): Promise<void>
  create(input: CreateAgentInput): Promise<RepoAgent>
  /** Update an expert agent's run defaults (kit, pool, pins, cost). */
  setRunDefaults(id: string, defaults: RunDefaults): Promise<void>
  update(id: string, patch: Partial<RepoAgent>): Promise<void>
  setPermission(id: string, key: keyof AgentPermissions, value: boolean): Promise<void>
  recordAction(id: string, action: Omit<AgentAction, "id" | "at">): Promise<void>
  remove(id: string): Promise<void>
  byId(id: string | undefined): RepoAgent | undefined
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  async load() {
    const backend = await getBackend()
    const agents = await backend.db.agents.list()
    set({ agents })
    // Seed the built-in expert once (users can edit or delete it afterwards).
    if (!agents.some((a) => a.template && a.name === PIXEL_MASTER_SEED.name)) {
      await get().create({ ...PIXEL_MASTER_SEED, repoPath: "", template: true, permissions: { network: true } })
    }
  },
  async setRunDefaults(id, defaults) {
    const agent = get().byId(id)
    if (!agent) return
    const updated = { ...agent, runDefaults: defaults, updatedAt: Date.now() }
    set({ agents: get().agents.map((a) => (a.id === id ? updated : a)) })
    await (await getBackend()).db.agents.upsert(updated)
  },
  async create(input) {
    const profile = interpretGateway(input.gatewayPrompt)
    const now = Date.now()
    const agent: RepoAgent = {
      id: newId("agent"),
      name: input.name.trim() || profile.role,
      repoPath: input.repoPath,
      providerId: input.providerId,
      modelId: input.modelId,
      fallbackModelRefs: input.fallbackModelRefs ?? [],
      gatewayPrompt: input.gatewayPrompt,
      gatewayProfile: profile,
      permissions: { ...DEFAULT_PERMISSIONS, ...profile.permissions, ...input.permissions, gitPush: false },
      toolsEnabled: ["shell", "git", "tests", "file-edit", "search"],
      memoryCount: 0,
      sourceRunId: input.sourceRunId,
      template: input.template || undefined,
      runDefaults: input.runDefaults,
      status: "idle",
      lastActions: [],
      createdAt: now,
      updatedAt: now,
    }
    set({ agents: [agent, ...get().agents] })
    const backend = await getBackend()
    await backend.db.agents.upsert(agent)
    return agent
  },
  async update(id, patch) {
    const current = get().agents.find((a) => a.id === id)
    if (!current) return
    const next: RepoAgent = { ...current, ...patch, updatedAt: Date.now() }
    if (patch.gatewayPrompt !== undefined && patch.gatewayPrompt !== current.gatewayPrompt) next.gatewayProfile = interpretGateway(patch.gatewayPrompt)
    next.permissions = { ...next.permissions, gitPush: patch.permissions?.gitPush ?? next.permissions.gitPush }
    set({ agents: get().agents.map((a) => (a.id === id ? next : a)) })
    const backend = await getBackend()
    await backend.db.agents.upsert(next)
  },
  async setPermission(id, key, value) {
    const current = get().agents.find((a) => a.id === id)
    if (current) await get().update(id, { permissions: { ...current.permissions, [key]: value } })
  },
  async recordAction(id, action) {
    const current = get().agents.find((a) => a.id === id)
    if (!current) return
    await get().update(id, { lastActions: [{ ...action, id: newId("act"), at: Date.now() }, ...current.lastActions].slice(0, 20) })
  },
  async remove(id) {
    set({ agents: get().agents.filter((a) => a.id !== id) })
    const backend = await getBackend()
    await backend.db.agents.delete(id)
  },
  byId(id) {
    return id ? get().agents.find((a) => a.id === id) : undefined
  },
}))
