import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./app/App"
import { ErrorBoundary } from "./app/ErrorBoundary"
import { installLogBridge } from "./services/log"

void installLogBridge()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
