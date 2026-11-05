import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemeProvider from './ThemeProvider'
import { applyInitialTheme, storedTheme, storeTheme, systemTheme } from './theme'
import { useTheme } from './useTheme'
import ThemeToggle from '../components/ThemeToggle'
import AuthProvider from '../auth/AuthProvider'
import { useAuth } from '../auth/useAuth'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function stubSystem(prefersLight) {
  const listeners = new Set()
  const query = {
    matches: prefersLight,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => query))
  return {
    change(light) {
      query.matches = light
      act(() => listeners.forEach((fn) => fn()))
    },
    listeners,
  }
}

const signedInAs = (username) => localStorage.setItem('token', fakeJwt({ sub: username, exp: inOneHour() }))
const current = () => document.documentElement.dataset.theme

function Probe() {
  const { theme } = useTheme()
  const { signIn, signOut } = useAuth()
  return (
    <>
      <p>theme is {theme}</p>
      <button onClick={signOut}>out</button>
      <button onClick={() => signIn(fakeJwt({ sub: 'bob', exp: inOneHour() }))}>as bob</button>
    </>
  )
}

function setup(meRoute = [200, { id: 1, username: localUser(), is_admin: false }]) {
  stubRoutes({ 'GET /me': meRoute })
  return render(
    <AuthProvider>
      <ThemeProvider>
        <ThemeToggle />
        <Probe />
      </ThemeProvider>
    </AuthProvider>
  )
}

function localUser() {
  const token = localStorage.getItem('token')
  return token ? JSON.parse(atob(token.split('.')[1])).sub : null
}

describe('theme', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme
  })
  afterEach(() => {
    delete document.documentElement.dataset.theme
  })

  it('follows the operating system when nothing is chosen', () => {
    stubSystem(true)
    setup()
    expect(current()).toBe('light')
    expect(screen.getByText('theme is light')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
  })

  it('defaults to dark where the browser has no preference API', () => {
    expect(systemTheme()).toBe('dark')
  })

  it('reacts to the operating system changing, until a choice is made', async () => {
    const system = stubSystem(false)
    setup()
    expect(current()).toBe('dark')
    system.change(true)
    expect(current()).toBe('light')

    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(current()).toBe('dark')
    system.change(false)
    system.change(true)
    expect(current()).toBe('dark')
  })

  it('stops listening when unmounted', () => {
    const system = stubSystem(false)
    const { unmount } = setup()
    expect(system.listeners.size).toBe(1)
    unmount()
    expect(system.listeners.size).toBe(0)
  })

  it('toggling saves the choice for this user', async () => {
    stubSystem(false)
    signedInAs('alice')
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(current()).toBe('light')
    expect(localStorage.getItem('theme:alice')).toBe('light')
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
  })

  it('remembers the choice after a reload', () => {
    stubSystem(false)
    signedInAs('alice')
    storeTheme('alice', 'light')
    setup()
    expect(current()).toBe('light')
  })

  it('keeps choices separate per user, and switches at sign-in and sign-out', async () => {
    stubSystem(true)
    signedInAs('alice')
    storeTheme('alice', 'light')
    storeTheme('bob', 'dark')
    setup([
      [200, { id: 1, username: 'alice', is_admin: false }],
      [200, { id: 2, username: 'bob', is_admin: false }],
    ])
    expect(current()).toBe('light')

    await userEvent.click(screen.getByRole('button', { name: 'as bob' }))
    expect(current()).toBe('dark')

    await userEvent.click(screen.getByRole('button', { name: 'out' }))
    expect(current()).toBe('light') // nobody signed in: back to the system's preference
    expect(localStorage.getItem('theme:alice')).toBe('light')
  })

  it('a choice made signed out does not change a user\'s', async () => {
    stubSystem(false)
    storeTheme('alice', 'dark')
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(localStorage.getItem('theme')).toBe('light')
    expect(storedTheme('alice')).toBe('dark')
  })

  it('ignores junk in storage', () => {
    localStorage.setItem('theme:alice', 'hotpink')
    expect(storedTheme('alice')).toBeNull()
  })

  it('is applied before the first render', () => {
    stubSystem(false)
    signedInAs('alice')
    storeTheme('alice', 'light')
    applyInitialTheme()
    expect(current()).toBe('light')
  })

  it('light and dark define the same colour tokens', () => {
    // Read from disk: Vitest empties CSS imports
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../styles/theme.css'), 'utf-8')
    const names = (block) => [...block.matchAll(/(--(?:color|shadow)[\w-]*):/g)].map((m) => m[1]).sort()
    const root = css.match(/:root \{([\s\S]*?)\n\}/)[1]
    const light = css.match(/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/)[1]
    expect(names(light)).toEqual(names(root))
    expect(names(light).length).toBeGreaterThan(5)
  })
})
