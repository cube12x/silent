import { beforeEach, describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { SetupScreen } from "./SetupScreen"
import { useProvidersStore } from "@/stores/providers"
import { PROVIDER_IDS } from "@/domain"

describe("SetupScreen", () => {
  beforeEach(() => {
    useProvidersStore.setState((s) => ({ providers: Object.fromEntries(PROVIDER_IDS.map((id) => [id, { ...s.providers[id], installed: false }])) as typeof s.providers, lastDetectedAt: 1, detecting: false }))
  })
  it("lists the recommended CLIs and blocks Continue until a planner CLI is installed", async () => {
    render(<MemoryRouter><SetupScreen /></MemoryRouter>)
    expect(await screen.findByText("Codex CLI", { exact: false })).toBeInTheDocument()
    expect(screen.getAllByText("Claude Code", { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getByTestId("setup-continue")).toBeDisabled()
    useProvidersStore.setState((s) => ({ providers: { ...s.providers, codex: { ...s.providers.codex, installed: true } } }))
    expect(await screen.findByTestId("setup-continue")).toBeEnabled()
    expect(screen.getByTestId("setup-skip")).toBeInTheDocument()
  })
})
