export type PhoneLinkStatus = "disconnected" | "pairing" | "connected"

export interface PairedDevice {
  id: string
  name: string
  platform: "android" | "ios"
  lastSeen: number
  trusted: boolean
}

export interface RemoteEvent {
  id: string
  at: number
  kind: "prompt" | "launch" | "status" | "notification"
  title: string
  detail?: string
}

export interface PhoneLinkState {
  status: PhoneLinkStatus
  pairingCode?: string
  pairingExpiresAt?: number
  devices: PairedDevice[]
  recentEvents: RemoteEvent[]
  notificationsEnabled: boolean
}
