import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initSentry } from './observability.js'
import { applyMotion } from './motion/motion.js'
import { applyInitialTheme } from './theme/theme.js'
import { hasValidToken } from './api/client.js'
import { warmUpServer } from './api/warmup.js'

// index.html already did both before the first paint; this keeps them in step
applyInitialTheme()
applyMotion()

// No-op unless VITE_SENTRY_DSN is set; never blocks rendering
initSentry().catch(() => {})

// Signed-out visitors (landing, sign-in) wake the free-tier backend now, in the
// background, so it's up by the time they sign in. Signed-in users' first real
// request does the same job.
if (!hasValidToken()) warmUpServer()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
