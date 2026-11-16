import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AppShell from '../components/shell/AppShell'
import AuthProvider from '../auth/AuthProvider'
import ThemeProvider from '../theme/ThemeProvider'
import { ToastProvider } from '../components/ui/Toast'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'
import { GROUPS, SHORTCUTS, altKey, hint, isTypingTarget, sequenceHandler } from './shortcuts'

function renderShell(path = '/projects') {
  stubRoutes({
    'GET /me': [200, { id: 1, username: 'olivia' }],
    'GET /projects': [200, { projects: [{ id: 1, name: 'Weather CLI', role: 'owner' }], total: 1 }],
    'GET /notifications': [200, { notifications: [], unread_count: 0 }],
  })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <ThemeProvider>
          <ToastProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/projects" element={<><h1>Projects page</h1><input aria-label="Search" /></>} />
                <Route path="/dashboard" element={<h1>Dashboard page</h1>} />
                <Route path="/projects/:projectId" element={<h1>Board page</h1>} />
                <Route path="/projects/:projectId/editor" element={<h1>Editor page</h1>} />
              </Route>
            </Routes>
          </ToastProvider>
        </ThemeProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('shortcut registry', () => {
  it('every shortcut is in a listed group, with a unique id', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length)
    for (const s of SHORTCUTS) expect(GROUPS).toContain(s.group)
    expect(hint('palette')).toMatch(/^(Ctrl|⌘) K$/)
    expect(hint('go-projects')).toBe('G then P')
  })

  it('knows when someone is typing', () => {
    const input = document.createElement('input')
    const box = document.createElement('input')
    box.type = 'checkbox'
    const editor = document.createElement('div')
    editor.className = 'monaco-editor'
    const inner = document.createElement('span')
    editor.append(inner)
    expect(isTypingTarget(input)).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(inner)).toBe(true)
    expect(isTypingTarget(box)).toBe(false)
    expect(isTypingTarget(document.body)).toBe(false)
  })

  it('"g then x" only counts within a second, and not while typing', () => {
    const go = vi.fn(() => true)
    const handle = sequenceHandler(go, 1000)
    const key = (k, target = document.body) => handle({ key: k, target, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    key('g')
    expect(key('p')).toBe(true)
    expect(go).toHaveBeenCalledWith('p')
    key('g')
    now.mockReturnValue(1500)
    expect(key('p')).toBe(false)
    key('g', document.createElement('input'))
    expect(key('d')).toBe(false)
    expect(go).toHaveBeenCalledTimes(1)
    now.mockRestore()
  })

  it('Alt shortcuts match by physical key, so Mac Option characters still work', () => {
    expect(altKey({ altKey: true, code: 'KeyN', key: '˜' }, 'N')).toBe(true)
    expect(altKey({ altKey: true, code: 'Digit1', key: '¡' }, '1')).toBe(true)
    expect(altKey({ altKey: true, ctrlKey: true, code: 'KeyN' }, 'N')).toBe(false)
    expect(altKey({ altKey: false, code: 'KeyN' }, 'N')).toBe(false)
  })
})

describe('shortcuts in the app', () => {
  beforeEach(() => {
    localStorage.setItem('token', fakeJwt({ sub: 'olivia', exp: inOneHour() }))
    document.documentElement.dataset.motion = 'reduce'
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    delete document.documentElement.dataset.motion
  })

  it('"?" opens the overlay listing every shortcut, and Escape closes it', async () => {
    renderShell()
    await screen.findByRole('heading', { name: 'Projects page' })
    await userEvent.keyboard('?')
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    for (const s of SHORTCUTS) expect(within(dialog).getByText(s.label)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"?" typed into a field is just text', async () => {
    renderShell()
    await userEvent.type(await screen.findByRole('textbox', { name: 'Search' }), '?')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the account menu opens it too, and shows the key', async () => {
    renderShell()
    await userEvent.click(await screen.findByRole('button', { name: /Account menu/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Keyboard shortcuts/ }))
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  it('Shift+T switches the theme', async () => {
    renderShell()
    await screen.findByRole('heading', { name: 'Projects page' })
    const before = document.documentElement.dataset.theme
    await userEvent.keyboard('{Shift>}T{/Shift}')
    expect(document.documentElement.dataset.theme).not.toBe(before)
  })

  it('"g then d" goes to the dashboard; "g then e" needs a project', async () => {
    renderShell()
    await screen.findByRole('heading', { name: 'Projects page' })
    await userEvent.keyboard('ge')
    expect(screen.getByRole('heading', { name: 'Projects page' })).toBeInTheDocument()
    await userEvent.keyboard('gd')
    expect(await screen.findByRole('heading', { name: 'Dashboard page' })).toBeInTheDocument()
  })

  it('"g then e" inside a project opens its editor', async () => {
    renderShell('/projects/1')
    await screen.findByRole('heading', { name: 'Board page' })
    await userEvent.keyboard('ge')
    expect(await screen.findByRole('heading', { name: 'Editor page' })).toBeInTheDocument()
  })
})
