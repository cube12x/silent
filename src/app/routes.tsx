import { createBrowserRouter, Navigate } from "react-router"
import { AppShell } from "./AppShell"
import { ChatScreen } from "@/features/chat/ChatScreen"
import { AgentsScreen } from "@/features/agents/AgentsScreen"
import { AgentDetailScreen } from "@/features/agents/AgentDetailScreen"
import { SilentCodeScreen } from "@/features/silent-code/SilentCodeScreen"
import { SettingsScreen } from "@/features/settings/SettingsScreen"
import { BlueprintScreen } from "@/features/blueprint/BlueprintScreen"
import { SetupScreen } from "@/features/setup/SetupScreen"

export const router = createBrowserRouter([
  {
    path: "/",
    Component: AppShell,
    children: [
      { index: true, Component: ChatScreen },
      { path: "chat/:chatId", Component: ChatScreen },
      { path: "code", Component: SilentCodeScreen },
      { path: "code/:runId", Component: SilentCodeScreen },
      { path: "agents", Component: AgentsScreen },
      { path: "agents/:agentId", Component: AgentDetailScreen },
      { path: "blueprint", Component: BlueprintScreen },
      { path: "blueprint/:bpId", Component: BlueprintScreen },
      { path: "settings", Component: SettingsScreen },
      { path: "setup", Component: SetupScreen },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
])
