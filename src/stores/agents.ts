import { create } from "zustand"
import type { AgentAction, AgentPermissions, RepoAgent } from "@/domain"
import { DEFAULT_PERMISSIONS } from "@/domain"
import { interpretGateway } from "@/engine/gateway"
import { getBackend } from "@/services"
import { newId } from "@/lib/ids"

export interface CreateAgentInput {
  name: string
  repoPath: string
  primaryModelId: string
  fallbackModelIds?: string[]
  gatewayPrompt: string
  permissions?: Partial<AgentPermissions>
}

interface AgentsState {
  agents: RepoAgent[]
  load(): Promise<void>
  create(input: CreateAgentInput): Promise<RepoAgent>
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
    set({ agents: await backend.db.agents.list() })
  },
  async create(input) {
    const profile = interpretGateway(input.gatewayPrompt)
    const now = Date.now()
    const agent: RepoAgent = {
      id: newId("agent"),
      name: input.name.trim() || profile.role,
      repoPath: input.repoPath,
      primaryModelId: input.primaryModelId,
      fallbackModelIds: input.fallbackModelIds ?? [],
      gatewayPrompt: input.gatewayPrompt,
      gatewayProfile: profile,
      // Gateway-derived permissions layer on top of defaults; explicit UI choices win. Git push always off.
      permissions: { ...DEFAULT_PERMISSIONS, ...profile.permissions, ...input.permissions, gitPush: false },
      toolsEnabled: ["shell", "git", "tests", "file-edit", "search"],
      memoryCount: 0,
      status: "idle",
      lastActions: [{ id: newId("act"), at: now, kind: "memory", title: "Agent created; Gateway interpreted", detail: profile.summary, ok: true }],
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
    if (!current) return
    await get().update(id, { permissions: { ...current.permissions, [key]: value } })
  },
  async recordAction(id, action) {
    const current = get().agents.find((a) => a.id === id)
    if (!current) return
    const full: AgentAction = { ...action, id: newId("act"), at: Date.now() }
    await get().update(id, { lastActions: [full, ...current.lastActions].slice(0, 20) })
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
