import { createBrowserRouter, Navigate } from "react-router"
import { AppShell } from "./AppShell"
import { DashboardScreen } from "@/features/dashboard/DashboardScreen"
import { ChatScreen } from "@/features/chat/ChatScreen"
import { RepoAgentsScreen } from "@/features/repo-agents/RepoAgentsScreen"
import { RepoAgentDetailScreen } from "@/features/repo-agents/RepoAgentDetailScreen"
import { SilentCodeScreen } from "@/features/silent-code/SilentCodeScreen"
import { MonitorScreen } from "@/features/monitor/MonitorScreen"
import { RunsListScreen } from "@/features/monitor/RunsListScreen"
import { MemoryScreen } from "@/features/memory/MemoryScreen"
import { SettingsScreen } from "@/features/settings/SettingsScreen"
import { PhoneLinkScreen } from "@/features/phone-link/PhoneLinkScreen"
import { KitScreen } from "@/features/kit/KitScreen"

export const router = createBrowserRouter([
  {
    path: "/",
    Component: AppShell,
    children: [
      { index: true, Component: DashboardScreen },
      { path: "chat/:chatId", Component: ChatScreen },
      { path: "agents", Component: RepoAgentsScreen },
      { path: "agents/:agentId", Component: RepoAgentDetailScreen },
      { path: "silent-code", Component: SilentCodeScreen },
      { path: "runs", Component: RunsListScreen },
      { path: "runs/:runId", Component: MonitorScreen },
      { path: "memory", Component: MemoryScreen },
      { path: "settings", Component: SettingsScreen },
      { path: "phone", Component: PhoneLinkScreen },
      ...(import.meta.env.DEV ? [{ path: "dev/kit", Component: KitScreen }] : []),
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
])
