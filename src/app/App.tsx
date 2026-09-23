import * as React from "react"
import { RouterProvider } from "react-router"
import { TooltipProvider } from "@/components/ui/tooltip"
import { bootstrap } from "@/services/bootstrap"
import { router } from "./routes"
import { BootScreen } from "./BootScreen"

export default function App() {
  const [ready, setReady] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    bootstrap()
      .then(() => setReady(true))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  if (error) return <BootScreen error={error} />
  if (!ready) return <BootScreen />
  return (
    <TooltipProvider delayDuration={200}>
      <RouterProvider router={router} />
    </TooltipProvider>
  )
}
