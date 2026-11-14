import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AppShell from './AppShell'
import AuthProvider from '../../auth/AuthProvider'
import ThemeProvider from '../../theme/ThemeProvider'
import { ToastProvider } from '../ui/Toast'
import { fakeJwt, inOneHour, stubRoutes } from '../../test/helpers'

const PROJECTS = { projects: [{ id: 1, name: 'Weather CLI', role: 'owner' }, { id: 2, name: 'Website', role: 'viewer' }], total: 2 }

function renderShell(path) {
  stubRoutes({
    'GET /me': [200, { id: 1, username: 'olivia', email: 'o@example.test' }],
    'GET /projects': [200, PROJECTS],
    'GET /notifications': [200, { notifications: [], unread_count: 0 }],
  })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <ThemeProvider>
          <ToastProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/projects" element={<h1>Projects page</h1>} />
                <Route path="/projects/:projectId" element={<h1>Board page</h1>} />
                <Route path="/projects/:projectId/editor" element={<h1>Editor page</h1>} />
              </Route>
              <Route path="/login" element={<p>Login page</p>} />
            </Routes>
          </ToastProvider>
        </ThemeProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    localStorage.setItem('token', fakeJwt({ sub: 'olivia', exp: inOneHour() }))
    document.documentElement.dataset.motion = 'reduce'
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    delete document.documentElement.dataset.motion
  })

  it('has landmarks, a skip link, and marks the current page', async () => {
    renderShell('/projects')
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main')
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('heading', { name: 'Projects page' })).toBeInTheDocument()
  })

  it('inside a project: breadcrumbs with its name, project links and a switcher', async () => {
    const user = userEvent.setup()
    renderShell('/projects/1/editor')
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(await within(crumbs).findByRole('link', { name: 'Weather CLI' })).toHaveAttribute('href', '/projects/1')
    expect(within(crumbs).getByText('Code editor')).toHaveAttribute('aria-current', 'page')
    const projectNav = screen.getByRole('navigation', { name: 'Project' })
    expect(within(projectNav).getByRole('link', { name: 'Code editor' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('button', { name: /Switch project/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Website' }))
    expect(await screen.findByRole('heading', { name: 'Editor page' })).toBeInTheDocument() // same page, other project
    expect(await within(screen.getByRole('navigation', { name: 'Breadcrumb' })).findByRole('link', { name: 'Website' })).toBeInTheDocument()
  })

  it('outside a project there is no project navigation', () => {
    renderShell('/projects')
    expect(screen.queryByRole('navigation', { name: 'Project' })).not.toBeInTheDocument()
  })

  it('the navigation drawer opens, closes on Escape and gives focus back', async () => {
    const user = userEvent.setup()
    renderShell('/projects')
    const open = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(open)
    expect(open).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(open).toHaveAttribute('aria-expanded', 'false')
    expect(open).toHaveFocus()
  })

  it('the account menu shows who you are and logs out', async () => {
    const user = userEvent.setup()
    renderShell('/projects')
    await user.click(await screen.findByRole('button', { name: 'Account menu for olivia' }))
    const menu = screen.getByRole('menu', { name: 'Account' })
    expect(menu.parentElement).toHaveTextContent('o@example.test')
    await user.click(within(menu).getByRole('menuitem', { name: 'Log out' }))
    expect(await screen.findByText('Login page')).toBeInTheDocument()
    expect(localStorage.getItem('token')).toBeNull()
  })
})
