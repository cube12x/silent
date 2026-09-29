import * as React from "react"
import { useRouteError } from "react-router"

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 bg-ink-0 p-8 text-center text-text-1">
      <div className="font-heading text-lg font-semibold">Bir şeyler ters gitti · Something went wrong</div>
      <pre className="mono max-w-[80vw] overflow-auto rounded-md border border-danger/40 bg-ink-1 p-3 text-left text-[11px] text-danger whitespace-pre-wrap">{message}</pre>
      <div className="flex gap-2">
        <button type="button" onClick={() => window.location.reload()} className="rounded-md border border-line bg-ink-2 px-3 py-1.5 text-xs hover:bg-ink-3">Yeniden yükle · Reload</button>
        <button type="button" onClick={() => { window.location.hash = ""; window.location.pathname = "/" }} className="rounded-md border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-ink-3">Ana ekran · Home</button>
      </div>
      <div className="text-[11px] text-text-3">Günlük / log: Ayarlar → Günlükler · Settings → Logs</div>
    </div>
  )
}

/** Route-level error element (react-router): a thrown render/loader error shows a panel instead of a black window. */
export function RouteError() {
  const err = useRouteError()
  const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err)
  return <ErrorPanel message={message} />
}

interface State {
  error?: Error
}

/** Last line of defence around the whole app (errors outside the router). */
export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = {}
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("uncaught render error", error, info.componentStack)
  }
  render() {
    if (this.state.error) return <ErrorPanel message={`${this.state.error.message}\n${this.state.error.stack ?? ""}`} />
    return this.props.children
  }
}
