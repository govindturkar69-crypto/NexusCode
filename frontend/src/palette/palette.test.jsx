import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from '../components/shell/AppShell'
import AuthProvider from '../auth/AuthProvider'
import ThemeProvider from '../theme/ThemeProvider'
import { ToastProvider } from '../components/ui/Toast'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'
import { fuzzyMatch, highlight } from './fuzzy'
import { clearPaletteCache } from './items'
import { loadRecents, rememberRecent } from './recents'

const PROJECTS = { projects: [{ id: 1, name: 'Weather CLI', role: 'owner' }, { id: 2, name: 'Website', role: 'viewer' }], total: 2 }
const TASKS = { tasks: [{ id: 11, title: 'Fix the average bug', status: 'in_progress', assignee_username: 'alex' }, { id: 12, title: 'Write README', status: 'todo' }], total: 2 }
const FILES = { code_files: [{ id: 21, path: 'src/weather.py' }, { id: 22, path: 'README.md' }] }

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname}{location.search}</p>
}

function renderApp(path = '/projects/1', routes = {}) {
  localStorage.setItem('token', fakeJwt({ sub: 'olivia', exp: inOneHour() }))
  const fetchMock = stubRoutes({
    'GET /me': [200, { id: 1, username: 'olivia' }],
    'GET /projects': [200, PROJECTS],
    'GET /notifications': [200, { notifications: [], unread_count: 0 }],
    'GET /projects/1/tasks': [200, TASKS],
    'GET /projects/1/code/files': [200, FILES],
    'GET /projects/2/tasks': [200, { tasks: [], total: 0 }],
    'GET /projects/2/code/files': [200, { code_files: [] }],
    ...routes,
  })
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <ThemeProvider>
          <ToastProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/projects" element={<Where />} />
                <Route path="/projects/:projectId" element={<><Where /><div className="monaco-editor"><textarea aria-label="Fake Monaco" /></div></>} />
                <Route path="/projects/:projectId/editor" element={<Where />} />
                <Route path="/settings" element={<Where />} />
              </Route>
              <Route path="/login" element={<p>Login page</p>} />
            </Routes>
          </ToastProvider>
        </ThemeProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
  return fetchMock
}

async function openWithKeyboard(user, { ready = true } = {}) {
  await screen.findByRole('button', { name: 'Search' })
  await user.keyboard('{Control>}k{/Control}')
  const dialog = await screen.findByRole('dialog', { name: 'Command palette' })
  if (ready) {
    // The project list, then its tasks and files, arrive after the palette opens
    await within(dialog).findByRole('option', { name: /^Board/ }, { timeout: 3000 })
    await waitFor(() => expect(within(dialog).queryByText('Loading tasks and files…')).not.toBeInTheDocument(), { timeout: 3000 })
  }
  return dialog
}

const combobox = () => screen.getByRole('combobox', { name: /Search projects/ })
// Options by their visible text (jsdom puts spaces between highlighted fragments
// when it computes names; browsers don't, and axe in Chromium checks the real names)
const findOption = async (pattern) => {
  let found
  await waitFor(() => {
    found = screen.getAllByRole('option').find((o) => pattern.test(o.textContent))
    expect(found).toBeDefined()
  })
  return found
}
const queryOption = (pattern) => screen.queryAllByRole('option').find((o) => pattern.test(o.textContent))

describe('Command palette', () => {
  beforeEach(() => {
    clearPaletteCache()
    localStorage.clear()
  })

  it('opens with Ctrl+K and from the header button, and Escape closes it and restores focus', async () => {
    const user = userEvent.setup()
    renderApp()
    const button = await screen.findByRole('button', { name: 'Search' })
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+K')
    await openWithKeyboard(user)
    expect(combobox()).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument())
    button.focus()
    await user.click(button)
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('does not take Ctrl+K from the Monaco editor', async () => {
    renderApp()
    const monaco = await screen.findByLabelText('Fake Monaco')
    monaco.focus()
    const event = fireEvent.keyDown(monaco, { key: 'k', ctrlKey: true })
    expect(event).toBe(true) // not prevented: Monaco's Ctrl+K chords keep working
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
  })

  it('is an ARIA combobox: arrow keys move the active option, Enter runs it, Tab stays put', async () => {
    const user = userEvent.setup()
    renderApp()
    await openWithKeyboard(user)
    const input = combobox()
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const listbox = screen.getByRole('listbox', { name: 'Results' })
    expect(input).toHaveAttribute('aria-controls', listbox.id)
    expect(within(listbox).getAllByRole('group').length).toBeGreaterThan(1)
    const first = screen.getAllByRole('option')[0]
    expect(input).toHaveAttribute('aria-activedescendant', first.id)
    expect(first).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    const second = screen.getAllByRole('option')[1]
    expect(input).toHaveAttribute('aria-activedescendant', second.id)
    await user.keyboard('{ArrowUp}{ArrowUp}')
    const last = screen.getAllByRole('option').at(-1)
    expect(input).toHaveAttribute('aria-activedescendant', last.id) // wraps
    await user.keyboard('{Tab}')
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, 'settings')
    await user.keyboard('{Enter}')
    expect(await screen.findByTestId('where')).toHaveTextContent('/settings')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('finds tasks and files of the current project with highlighted matches', async () => {
    const user = userEvent.setup()
    const fetchMock = renderApp()
    await openWithKeyboard(user)
    await user.type(combobox(), 'avg')
    const task = await findOption(/Fix the average bug/)
    expect([...task.querySelectorAll('.palette__match')].map((m) => m.textContent).join('')).toBe('avg')
    await user.clear(combobox())
    await user.type(combobox(), 'weather.py')
    await user.click(await findOption(/src\/weather\.py/))
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/1/editor?do=open&file=src%2Fweather.py')
    // Loaded once each
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/projects/1/tasks?limit=200&offset=0') || url.includes('/projects/1/tasks')).length).toBe(1)
  })

  it('offers editing actions to owners and editors only', async () => {
    const user = userEvent.setup()
    renderApp('/projects/1')
    await openWithKeyboard(user)
    await user.type(combobox(), 'new')
    expect(await findOption(/New task/)).toBeInTheDocument()
    expect(queryOption(/New file/)).toBeDefined()
    await user.keyboard('{Escape}')
  })

  it('never shows editing actions to a viewer', async () => {
    const user = userEvent.setup()
    renderApp('/projects/2')
    await openWithKeyboard(user)
    for (const q of ['new task', 'new file', 'agent']) {
      await user.clear(combobox())
      await user.type(combobox(), q)
      expect(queryOption(/New task|New file|Run the AI agent/)).toBeUndefined()
    }
    // Read-only actions stay
    await user.clear(combobox())
    await user.type(combobox(), 'export')
    expect(await findOption(/Export project as ZIP/)).toBeInTheDocument()
  })

  it('runs actions through the URL so the page can act (New task)', async () => {
    const user = userEvent.setup()
    renderApp('/projects/1')
    await openWithKeyboard(user)
    await user.type(combobox(), 'new task')
    await user.keyboard('{Enter}')
    expect(await screen.findByTestId('where')).toHaveTextContent('/projects/1?do=new-task')
  })

  it('remembers recent items and shows them first', async () => {
    const user = userEvent.setup()
    renderApp('/projects/1')
    await openWithKeyboard(user)
    await user.type(combobox(), 'settings')
    await user.keyboard('{Enter}')
    await screen.findByText('/settings')
    await openWithKeyboard(user, { ready: false }) // no project on /settings
    const recent = await screen.findByRole('group', { name: /Recent/ })
    expect(within(recent).getAllByRole('option').some((o) => /Settings/.test(o.textContent))).toBe(true)
    expect(loadRecents()[0]).toMatchObject({ key: 'nav:settings', label: 'Settings' })
  })

  it('works with storage blocked (no recents, no errors)', async () => {
    const user = userEvent.setup()
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    renderApp('/projects/1')
    await screen.findByRole('button', { name: 'Search' })
    getItem.mockImplementation((key) => { if (key === 'nexus.palette.recent') throw new Error('blocked'); return null })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    await openWithKeyboard(user)
    expect(screen.queryByRole('group', { name: /Recent/ })).not.toBeInTheDocument()
    await user.type(combobox(), 'settings')
    await user.keyboard('{Enter}')
    expect(await screen.findByTestId('where')).toHaveTextContent('/settings')
    getItem.mockRestore()
    setItem.mockRestore()
  })

  it('shows loading, then an empty state for no matches', async () => {
    const user = userEvent.setup()
    let release
    renderApp('/projects/1', { 'GET /projects/1/tasks': [200, TASKS] })
    // Hold the tasks request to see the loading state
    const original = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((url, init) => (String(url).includes('/projects/1/tasks') ? new Promise((r) => { release = () => r(original(url, init)) }) : original(url, init))))
    const dialog = await openWithKeyboard(user, { ready: false })
    expect(await within(dialog).findByText('Loading tasks and files…', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(within(dialog).getByRole('status')).toHaveTextContent('Loading tasks and files.')
    release()
    await waitFor(() => expect(within(dialog).queryByText('Loading tasks and files…')).not.toBeInTheDocument(), { timeout: 3000 })
    await user.type(combobox(), 'zzzzqqq')
    expect(screen.getByText('No results for “zzzzqqq”.')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(within(dialog).getByRole('status')).toHaveTextContent('0 results.')
  })
})

describe('fuzzy matching', () => {
  it('matches in order, case-insensitive, and prefers substrings and word starts', () => {
    expect(fuzzyMatch('wpy', 'src/weather.py')).not.toBeNull()
    expect(fuzzyMatch('ypw', 'src/weather.py')).toBeNull()
    expect(fuzzyMatch('WEA', 'src/weather.py').indices).toEqual([4, 5, 6])
    expect(fuzzyMatch('board', 'Board').score).toBeGreaterThan(fuzzyMatch('board', 'Dashboard').score)
    expect(fuzzyMatch('nt', 'New task').score).toBeGreaterThan(fuzzyMatch('nt', 'Analytics').score ?? -Infinity)
  })

  it('splits text into highlighted runs', () => {
    expect(highlight('Board', [0, 1])).toEqual([{ text: 'Bo', match: true }, { text: 'ard', match: false }])
  })

  it('keeps at most six recents, newest first, without duplicates', () => {
    for (let i = 0; i < 8; i++) rememberRecent({ key: `k${i}`, label: `L${i}` })
    rememberRecent({ key: 'k5', label: 'L5' })
    expect(loadRecents().map((r) => r.key)).toEqual(['k5', 'k7', 'k6', 'k4', 'k3', 'k2'])
  })
})

describe('palette ranking', () => {
  it("doesn't match every page by the project name in its hint", async () => {
    const user = userEvent.setup()
    renderApp('/projects/1')
    await user.click(await screen.findByRole('button', { name: 'Search' }))
    await screen.findAllByRole('option')
    await waitFor(() => expect(screen.getAllByRole('option').some((o) => /src\/weather\.py/.test(o.textContent))).toBe(true), { timeout: 3000 })
    await user.type(screen.getByRole('combobox', { name: /Search projects/ }), 'weather')
    const texts = screen.getAllByRole('option').map((o) => o.textContent)
    expect(texts.some((t) => t.startsWith('Weather CLI'))).toBe(true) // the project itself
    expect(texts.some((t) => t.startsWith('src/weather.py'))).toBe(true)
    expect(texts.some((t) => t.startsWith('Board'))).toBe(false)
    expect(texts.some((t) => t.startsWith('New task'))).toBe(false)
  })
})
