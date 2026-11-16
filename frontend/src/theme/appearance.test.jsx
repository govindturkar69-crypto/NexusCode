import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ACCENTS, applyInitialAppearance, storeAccent, storeContrast, storedAccent, storedContrast } from './appearance'
import { monacoTheme } from '../editor/monacoThemes'
import ThemeProvider from './ThemeProvider'
import AuthProvider from '../auth/AuthProvider'
import AppearanceSection from '../components/AppearanceSection'
import { stubRoutes } from '../test/helpers'

const here = dirname(fileURLToPath(import.meta.url))
const css = (file) => readFileSync(resolve(here, '../styles', file), 'utf-8')
const tokens = css('tokens.css')
const accents = css('accents.css')

// Custom properties of the first block whose selector is exactly `selector`
function block(source, selector) {
  const start = source.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no block ${selector}`)
  const body = source.slice(start, source.indexOf('\n}', start))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
// A translucent colour over a solid one, as the browser paints it
function over(rgba, base) {
  const [r, g, b, a] = rgba.match(/[\d.]+/g).map(Number)
  return `#${[r, g, b].map((c, i) => Math.round(c * a + parseInt(base.slice(1 + i * 2, 3 + i * 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('')}`
}

// The tokens in effect for one combination, cascading like the browser does
function resolved(theme, accent, level) {
  const t = { ...block(tokens, ':root') }
  if (theme === 'light') Object.assign(t, block(tokens, ':root[data-theme="light"]'))
  if (accent !== 'blue') {
    Object.assign(t, block(accents, `:root[data-accent="${accent}"]`))
    if (theme === 'light') Object.assign(t, block(accents, `:root[data-theme="light"][data-accent="${accent}"]`))
  }
  if (level === 'high') {
    Object.assign(t, block(accents, ':root[data-contrast="high"]'))
    if (theme === 'light') Object.assign(t, block(accents, ':root[data-theme="light"][data-contrast="high"]'))
  }
  return t
}

const COMBOS = ['dark', 'light'].flatMap((theme) => Object.keys(ACCENTS).flatMap((accent) => ['normal', 'high'].map((level) => [theme, accent, level])))

describe('accent and contrast tokens', () => {
  it('accents.css matches appearance.js for every preset', () => {
    for (const [name, preset] of Object.entries(ACCENTS)) {
      for (const theme of ['dark', 'light']) {
        const t = resolved(theme, name, 'normal')
        const [accent, text, on] = preset[theme]
        expect(t['--color-accent'], `${theme} ${name}`).toBe(accent)
        expect(t['--color-accent-text'], `${theme} ${name}`).toBe(text)
        expect(t['--color-on-accent'], `${theme} ${name}`).toBe(on)
      }
    }
  })

  it.each(COMBOS)('%s / %s / %s contrast meets WCAG AA', (theme, accent, level) => {
    const t = resolved(theme, accent, level)
    const surfaces = ['--color-bg', '--color-surface', '--color-surface-raised', '--color-surface-hover'].map((k) => t[k])
    const tinted = surfaces.map((s) => over(t['--color-accent-soft'], s))
    const textMin = level === 'high' ? 7 : 4.5
    for (const s of surfaces) {
      expect(contrast(t['--color-text'], s)).toBeGreaterThanOrEqual(textMin)
      expect(contrast(t['--color-text-muted'], s)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t['--color-text-subtle'], s)).toBeGreaterThanOrEqual(4.5)
      // Focus rings and the accent as a UI colour: 3:1 (WCAG 1.4.11)
      expect(contrast(t['--color-focus'], s)).toBeGreaterThanOrEqual(3)
    }
    for (const s of [...surfaces, ...tinted]) expect(contrast(t['--color-accent-text'], s)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--color-on-accent'], t['--color-accent'])).toBeGreaterThanOrEqual(4.5)
    if (level === 'high') expect(contrast(t['--color-border'], t['--color-bg'])).toBeGreaterThanOrEqual(3)
  })

  it('gives Monaco a theme for every combination', () => {
    const names = new Set(COMBOS.map(([theme, accent, level]) => monacoTheme(theme, accent, level)))
    expect(names.size).toBe(COMBOS.length)
    expect(monacoTheme('light')).toBe('nexus-light-blue')
    expect(monacoTheme('dark', 'nope')).toBe('nexus-dark-blue')
  })

  it("index.html's first-paint script knows every non-default accent", () => {
    const html = readFileSync(resolve(here, '../../index.html'), 'utf-8')
    const list = html.match(/\^\(([\w|]+)\)\$/)[1].split('|').sort()
    expect(list).toEqual(Object.keys(ACCENTS).filter((a) => a !== 'blue').sort())
  })
})

describe('accent and contrast choice', () => {
  const root = document.documentElement
  beforeEach(() => {
    delete root.dataset.accent
    delete root.dataset.contrast
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete root.dataset.accent
    delete root.dataset.contrast
  })

  it('is stored, applied, and read back after a reload', () => {
    storeAccent('green')
    storeContrast('high')
    expect(root.dataset.accent).toBe('green')
    expect(root.dataset.contrast).toBe('high')
    delete root.dataset.accent
    delete root.dataset.contrast
    applyInitialAppearance()
    expect(root.dataset.accent).toBe('green')
    expect(root.dataset.contrast).toBe('high')
  })

  it('the defaults leave no attribute and no stored value', () => {
    storeAccent('violet')
    storeAccent('blue')
    storeContrast('high')
    storeContrast('normal')
    expect(root.dataset.accent).toBeUndefined()
    expect(root.dataset.contrast).toBeUndefined()
    expect(localStorage.getItem('accent')).toBeNull()
    expect(localStorage.getItem('contrast')).toBeNull()
  })

  it('ignores junk in storage', () => {
    localStorage.setItem('accent', 'hotpink')
    localStorage.setItem('contrast', 'max')
    expect(storedAccent()).toBe('blue')
    expect(storedContrast()).toBe('normal')
    expect(storeAccent('__proto__')).toBe('blue')
  })

  it('still works when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(storedAccent()).toBe('blue')
    expect(storeAccent('orange')).toBe('orange')
    expect(root.dataset.accent).toBe('orange')
    expect(storeContrast('high')).toBe('high')
  })

  it('Settings > Appearance changes them at once', async () => {
    stubRoutes({ 'GET /me': [200, { id: 1, username: 'alice', is_admin: false }] })
    render(<AuthProvider><ThemeProvider><AppearanceSection /></ThemeProvider></AuthProvider>)
    await userEvent.click(screen.getByRole('radio', { name: 'Pink' }))
    expect(root.dataset.accent).toBe('pink')
    expect(screen.getByRole('radio', { name: 'Pink' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'High' }))
    expect(root.dataset.contrast).toBe('high')
    expect(localStorage.getItem('contrast')).toBe('high')
  })
})
