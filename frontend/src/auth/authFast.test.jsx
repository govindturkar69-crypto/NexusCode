import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { warmUpServer, resetWarmUp } from '../api/warmup'
import { cacheAuthOptions, cachedAuthOptions, initialAuthOptions, OPTIMISTIC } from './authOptions'
import ProviderButtons from '../components/ProviderButtons'
import { passwordStrength } from '../utils/passwordStrength'
import { prefetchOn } from '../routes/prefetch'
import { prefetchWhenIdle } from '../routes/prefetchWhenIdle'
import { WAKING_TEXT } from '../utils/useSlowHint'

afterEach(() => {
  resetWarmUp()
  vi.useRealTimers()
})

describe('warming up the server', () => {
  it('fires one GET /health without blocking', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: true }))
    const pending = warmUpServer({ fetchImpl })
    // Returned at once: nothing waited on the network
    expect(pending).toBeInstanceOf(Promise)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/health$/)
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'omit' })
    await expect(pending).resolves.toBe(true)
  })

  it('never throws and never shows anything when the server is down', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(warmUpServer({ fetchImpl })).resolves.toBe(false)
    resetWarmUp()
    await expect(warmUpServer({ fetchImpl: vi.fn(() => Promise.resolve({ ok: false })) })).resolves.toBe(false)
  })

  it('only runs once per page load', () => {
    const fetchImpl = vi.fn(() => new Promise(() => {}))
    warmUpServer({ fetchImpl })
    warmUpServer({ fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('gives up after a short timeout', async () => {
    vi.useFakeTimers()
    let signal
    const fetchImpl = vi.fn((_url, init) => {
      signal = init.signal
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    })
    const pending = warmUpServer({ fetchImpl })
    await vi.advanceTimersByTimeAsync(15_001)
    expect(signal.aborted).toBe(true)
    await expect(pending).resolves.toBe(false)
  })
})

describe('sign-in options before the server answers', () => {
  it('starts optimistic, with every provider shown', () => {
    expect(initialAuthOptions()).toEqual({ ...OPTIMISTIC, known: false })
  })

  it('starts from the cached answer when there is one', () => {
    cacheAuthOptions({ email: false, google: true, github: false })
    expect(initialAuthOptions()).toEqual({ email: false, google: true, github: false, known: true })
  })

  it('works when storage is blocked', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => cacheAuthOptions({ email: true })).not.toThrow()
    expect(cachedAuthOptions()).toBeNull()
    expect(initialAuthOptions().known).toBe(false)
    getItem.mockRestore()
    setItem.mockRestore()
  })
})

describe('provider buttons on a sleeping server', () => {
  it('render at once and say the server is waking when a start takes long', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // never answers
    render(<ProviderButtons options={{ ...OPTIMISTIC, known: false }} returnTo="/projects" />)
    const google = screen.getByRole('button', { name: 'Continue with Google' })
    expect(google).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeEnabled()
    fireEvent.click(google)
    // Busy straight away (spinner), but no "waking" message yet
    expect(google).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText(WAKING_TEXT)).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(2600))
    expect(screen.getByRole('status')).toHaveTextContent(WAKING_TEXT)
  })
})

describe('password strength hint', () => {
  it.each([
    ['', 0], ['short', 1], ['abcdefgh', 2], ['abcdefgh1234', 3], ['Correct-Horse-9', 4], ['a much longer passphrase here', 4],
  ])('%j scores %i', (password, score) => {
    expect(passwordStrength(password).score).toBe(score)
  })

  it('counts bytes like the server (multi-byte characters)', () => {
    expect(passwordStrength('éééé').score).toBe(2) // 8 bytes
  })
})

describe('prefetching the sign-in page', () => {
  it('loads the chunk on hover, focus or touch, once per call', () => {
    const loader = vi.fn(() => Promise.resolve())
    const handlers = prefetchOn(loader)
    handlers.onMouseEnter()
    handlers.onFocus()
    handlers.onTouchStart()
    expect(loader).toHaveBeenCalledTimes(3) // import() itself caches, so only one download
  })

  it('loads it when the browser is idle, and can be cancelled', () => {
    vi.useFakeTimers()
    const loader = vi.fn(() => Promise.resolve())
    const cancel = prefetchWhenIdle(loader)
    cancel()
    vi.advanceTimersByTime(5000)
    expect(loader).not.toHaveBeenCalled()
    prefetchWhenIdle(loader)
    vi.advanceTimersByTime(5000)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('swallows a failed download', async () => {
    const loader = vi.fn(() => Promise.reject(new Error('offline')))
    expect(() => prefetchOn(loader).onMouseEnter()).not.toThrow()
  })
})

describe('auth motion respects reduced motion', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../styles/auth.css'), 'utf-8')

  it('shakes by --motion-distance, which reduced motion sets to 0', () => {
    const shake = css.match(/@keyframes nx-shake \{[\s\S]*?\n\}/)[0]
    expect(shake).toMatch(/var\(--motion-distance\)/)
    expect(shake).not.toMatch(/\d+px/)
  })

  it('stops the brand panel drift under reduced motion', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ :root:not\(\[data-motion="full"\]\) \.auth-brand__bg::before \{ animation: none; \}/)
    expect(css).toMatch(/:root\[data-motion="reduce"\] \.auth-brand__bg::before \{ animation: none; \}/)
  })
})
