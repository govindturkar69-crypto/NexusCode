import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { initSentry, reportError } from './observability'
import ErrorBoundary from './components/ErrorBoundary'

function fakeSdk() {
  return { init: vi.fn(), captureException: vi.fn() }
}

describe('observability', () => {
  it('does not load or start Sentry without a DSN', async () => {
    const loadSdk = vi.fn()
    await expect(initSentry('', loadSdk)).resolves.toBe(false)
    expect(loadSdk).not.toHaveBeenCalled()
  })

  it('starts Sentry without personal data or tracing when a DSN is set, and reports errors', async () => {
    const sdk = fakeSdk()
    await expect(initSentry('https://key@o0.ingest.sentry.io/1', async () => sdk)).resolves.toBe(true)
    expect(sdk.init).toHaveBeenCalledWith(expect.objectContaining({ sendDefaultPii: false, tracesSampleRate: 0 }))
    const error = new Error('boom')
    reportError(error, { where: 'test' })
    expect(sdk.captureException).toHaveBeenCalledWith(error, { extra: { where: 'test' } })
  })

  it('the error boundary shows a recovery screen instead of a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken() {
      throw new Error('render failed')
    }
    render(<ErrorBoundary><Broken /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument()
  })
})
