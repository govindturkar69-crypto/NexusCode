import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initSentry } from './observability.js'
import { applyInitialTheme } from './theme/theme.js'

applyInitialTheme()

// No-op unless VITE_SENTRY_DSN is set; never blocks rendering
initSentry().catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
