import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { render } from '@testing-library/react'
import { applyMotion, motionAllowed, setMotionPreference, storedMotion, withViewTransition } from './motion'
import { useReveal } from './useReveal'

function mockReducedMotion(reduce) {
  vi.stubGlobal('matchMedia', (query) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    addEventListener() {},
    removeEventListener() {},
  }))
  window.matchMedia = globalThis.matchMedia
}

describe('motion switch', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.motion
  })
  afterEach(() => vi.unstubAllGlobals())

  it('follows the operating system when nothing is chosen', () => {
    mockReducedMotion(false)
    expect(motionAllowed()).toBe(true)
    mockReducedMotion(true)
    expect(motionAllowed()).toBe(false)
  })

  it('a stored choice wins over the operating system, and is applied to <html>', () => {
    mockReducedMotion(false)
    setMotionPreference('reduce')
    expect(storedMotion()).toBe('reduce')
    expect(document.documentElement.dataset.motion).toBe('reduce')
    expect(motionAllowed()).toBe(false)

    mockReducedMotion(true)
    setMotionPreference('full')
    expect(motionAllowed()).toBe(true)

    setMotionPreference(null)
    expect(document.documentElement.dataset.motion).toBeUndefined()
    expect(motionAllowed()).toBe(false) // back to the OS, which asks for less motion
  })

  it('ignores junk in storage', () => {
    localStorage.setItem('motion', 'wobbly')
    expect(storedMotion()).toBeNull()
    applyMotion()
    expect(document.documentElement.dataset.motion).toBeUndefined()
  })

  it('runs a View Transition only when motion is allowed', () => {
    const update = vi.fn()
    document.startViewTransition = vi.fn((fn) => fn())
    mockReducedMotion(false)
    withViewTransition(update)
    expect(document.startViewTransition).toHaveBeenCalledTimes(1)
    mockReducedMotion(true)
    withViewTransition(update)
    expect(document.startViewTransition).toHaveBeenCalledTimes(1) // not again
    expect(update).toHaveBeenCalledTimes(2) // but the update always happens
    delete document.startViewTransition
  })

  it('reduced motion turns movement off in the tokens, leaving short fades', () => {
    const css = readFileSync('src/styles/tokens.css', 'utf-8')
    const reduced = css.match(/:root\[data-motion="reduce"\] \{([\s\S]*?)\}/)[1]
    expect(reduced).toMatch(/--motion-distance: 0px/)
    expect(reduced).toMatch(/--motion-scale: 1/)
    expect(reduced).toMatch(/--stagger: 0ms/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })
})

describe('useReveal', () => {
  let observed
  beforeEach(() => {
    observed = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback) { this.callback = callback; observed.push(this) }
      observe(el) { this.el = el }
      disconnect() { this.disconnected = true }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  function Box({ top }) {
    const ref = useReveal()
    return <div ref={(el) => { if (el) el.getBoundingClientRect = () => ({ top }); ref.current = el }} data-testid="box" />
  }

  it('leaves content on the first screen alone (no hidden first paint)', () => {
    const { getByTestId } = render(<Box top={10} />)
    expect(getByTestId('box').className).toBe('')
    expect(observed).toHaveLength(0)
  })

  it('hides content below the fold until it scrolls into view, then reveals it once', () => {
    const { getByTestId } = render(<Box top={5000} />)
    const box = getByTestId('box')
    expect(box.classList.contains('reveal-pending')).toBe(true)
    observed[0].callback([{ isIntersecting: true }])
    expect(box.classList.contains('reveal-in')).toBe(true)
    expect(box.classList.contains('reveal-pending')).toBe(false)
    expect(observed[0].disconnected).toBe(true)
  })
})

describe('theme before first paint (index.html)', () => {
  const script = readFileSync('index.html', 'utf-8').match(/<script>([\s\S]*?)<\/script>/)[1]
  const run = () => new Function(script)()
  const jwt = (payload) => `x.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.y`

  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.motion
  })
  afterEach(() => vi.unstubAllGlobals())

  it("uses the signed-in user's stored theme", () => {
    localStorage.setItem('token', jwt({ sub: 'olivia' }))
    localStorage.setItem('theme:olivia', 'light')
    run()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('falls back to the operating system, and applies a stored motion choice', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q.includes('light') }))
    window.matchMedia = globalThis.matchMedia
    localStorage.setItem('motion', 'reduce')
    run()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.motion).toBe('reduce')
  })

  it('never throws on a broken token', () => {
    localStorage.setItem('token', 'not-a-jwt')
    expect(run).not.toThrow()
  })
})
