import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { EntryScreen } from "./EntryScreen"
import { useSettingsStore } from "@/stores/settings"
import { DEFAULT_SETTINGS } from "@/domain"
import { TestBackend } from "@/services/testBackend"
import { setBackend } from "@/services"

describe("EntryScreen", () => {
  beforeEach(() => {
    setBackend(new TestBackend())
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
  })
  it("offers Maker and Mind, remembers the choice and routes to it", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<EntryScreen />} />
          <Route path="/mind" element={<div>MIND SCREEN</div>} />
          <Route path="/chat" element={<div>CHAT SCREEN</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId("entry-maker")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("entry-mind"))
    expect(await screen.findByText("MIND SCREEN")).toBeInTheDocument()
    expect(useSettingsStore.getState().settings.mode).toBe("mind")
  })
})
