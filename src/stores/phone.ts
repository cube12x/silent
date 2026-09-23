import { create } from "zustand"
import type { PhoneLinkState } from "@/domain"
import { newId } from "@/lib/ids"

interface PhoneState extends PhoneLinkState {
  startPairing(): void
  cancelPairing(): void
  /** Demo hook: simulate the phone completing the pairing handshake. */
  simulatePaired(): void
  disconnect(): void
  setNotifications(enabled: boolean): void
}

const H = 3600_000
const now = Date.now()

export const usePhoneStore = create<PhoneState>((set, get) => ({
  status: "disconnected",
  devices: [{ id: "phone_pixel", name: "Pixel 9", platform: "android", lastSeen: now - 11 * H, trusted: true }],
  recentEvents: [
    { id: "re1", at: now - 11 * H, kind: "prompt", title: "Note: ship notification feature before Friday demo", detail: "→ Daily context" },
    { id: "re2", at: now - 20 * H, kind: "launch", title: "Launched Silent Code · fix NaN in pressure solver", detail: "from Pixel 9" },
    { id: "re3", at: now - 20 * H + 40 * 60_000, kind: "notification", title: "Run completed · fix NaN in pressure solver", detail: "pushed to phone" },
  ],
  notificationsEnabled: true,
  startPairing() {
    const code = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("")
    set({ status: "pairing", pairingCode: `${code.slice(0, 3)}-${code.slice(3)}`, pairingExpiresAt: Date.now() + 120_000 })
  },
  cancelPairing() {
    set({ status: get().devices.length ? "disconnected" : "disconnected", pairingCode: undefined, pairingExpiresAt: undefined })
  },
  simulatePaired() {
    const device = get().devices[0] ?? { id: newId("phone"), name: "Android device", platform: "android" as const, lastSeen: Date.now(), trusted: true }
    set({
      status: "connected",
      pairingCode: undefined,
      pairingExpiresAt: undefined,
      devices: [{ ...device, lastSeen: Date.now(), trusted: true }],
      recentEvents: [{ id: newId("re"), at: Date.now(), kind: "status", title: `${device.name} connected`, detail: "LAN · encrypted session" }, ...get().recentEvents],
    })
  },
  disconnect() {
    set({ status: "disconnected", recentEvents: [{ id: newId("re"), at: Date.now(), kind: "status", title: "Phone disconnected" }, ...get().recentEvents] })
  },
  setNotifications(enabled) {
    set({ notificationsEnabled: enabled })
  },
}))
