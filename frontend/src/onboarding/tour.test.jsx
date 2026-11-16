import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from '../components/shell/AppShell'
import AuthProvider from '../auth/AuthProvider'
import ThemeProvider from '../theme/ThemeProvider'
import { ToastProvider } from '../components/ui/Toast'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'
import { STEPS, isComplete, markDone, readTour, shouldOfferTour, stepsDoneByVisiting, writeTour } from './tour'

function Where() {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{pathname + search}</p>
}

function renderShell({ path = '/projects', projects = [] } = {}) {
  stubRoutes({
    'GET /me': [200, { id: 1, username: 'nina' }],
    'GET /projects': [200, { projects, total: projects.length }],
    'GET /notifications': [200, { notifications: [], unread_count: 0 }],
  })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <ThemeProvider>
          <ToastProvider>
            <Routes>
              <Route element={<><AppShell /><Where /></>}>
                <Route path="/projects" element={<h1>Projects page</h1>} />
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

const tourRegion = () => screen.findByRole('region', { name: /Welcome to NexusCode|You're all set/ })

describe('tour state', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('is offered only to people with no projects who have not closed it', () => {
    expect(shouldOfferTour({ done: [], dismissed: false }, 0)).toBe(true)
    expect(shouldOfferTour({ done: [], dismissed: false }, 2)).toBe(false)
    expect(shouldOfferTour({ done: [], dismissed: true }, 0)).toBe(false)
    const all = STEPS.reduce((state, step) => markDone(state, step.id), { done: [], dismissed: false })
    expect(isComplete(all)).toBe(true)
    expect(shouldOfferTour(all, 0)).toBe(false)
  })

  it('ticks off steps by visiting', () => {
    expect(stepsDoneByVisiting('/projects/3/editor', 1)).toEqual(['project', 'editor'])
    expect(stepsDoneByVisiting('/projects/3/meeting', 0)).toEqual(['meeting'])
    expect(stepsDoneByVisiting('/dashboard', 0)).toEqual([])
  })

  it('is kept per user, ignores junk, and survives blocked storage', () => {
    writeTour('nina', { done: ['project', 'bogus'], dismissed: true })
    expect(readTour('nina')).toEqual({ done: ['project'], dismissed: true })
    expect(readTour('omar')).toEqual({ done: [], dismissed: false })
    localStorage.setItem('tour:nina', 'not json')
    expect(readTour('nina')).toEqual({ done: [], dismissed: false })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readTour('nina')).toEqual({ done: [], dismissed: false })
    expect(() => writeTour('nina', { done: [], dismissed: false })).not.toThrow()
  })
})

describe('welcome tour in the app', () => {
  beforeEach(() => {
    localStorage.setItem('token', fakeJwt({ sub: 'nina', exp: inOneHour() }))
    document.documentElement.dataset.motion = 'reduce'
  })
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    delete document.documentElement.dataset.motion
  })

  it('greets a new user with five steps; the first one opens the new-project dialog', async () => {
    renderShell()
    const tour = await tourRegion()
    expect(within(tour).getByText('0 of 5 done')).toBeInTheDocument()
    expect(within(tour).getAllByRole('listitem')).toHaveLength(5)
    expect(within(tour).getByRole('progressbar', { name: 'Tour progress' })).toHaveAttribute('aria-valuenow', '0')
    // Steps that need a project wait for one
    expect(within(tour).getByRole('button', { name: 'Open the code editor: go' })).toBeDisabled()
    await userEvent.click(within(tour).getByRole('button', { name: 'Create a project: go' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/projects?do=new-project')
    expect(within(tour).getByText('1 of 5 done')).toBeInTheDocument()
  })

  it('the palette step opens the command palette', async () => {
    renderShell()
    const tour = await tourRegion()
    await userEvent.click(within(tour).getByRole('button', { name: 'Try the command palette: go' }))
    expect(await screen.findByRole('combobox')).toBeInTheDocument()
  })

  it('Escape closes it, and it stays closed after a reload', async () => {
    const { unmount } = renderShell()
    await tourRegion()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: /Welcome/ })).not.toBeInTheDocument()
    expect(readTour('nina').dismissed).toBe(true)
    unmount()
    renderShell()
    await screen.findByRole('heading', { name: 'Projects page' })
    await screen.findByRole('button', { name: /Account menu/ })
    expect(screen.queryByRole('region', { name: /Welcome/ })).not.toBeInTheDocument()
  })

  it('is not pushed on people who already have projects, but the account menu reopens it', async () => {
    renderShell({ path: '/projects/4/editor', projects: [{ id: 4, name: 'Site', role: 'owner' }] })
    await screen.findByRole('heading', { name: 'Editor page' })
    await screen.findByRole('link', { name: 'Code editor' })
    expect(screen.queryByRole('region', { name: /Welcome/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Account menu/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Getting started' }))
    const tour = await tourRegion()
    // Having a project and being in its editor already count
    expect(within(tour).getByText('2 of 5 done')).toBeInTheDocument()
    expect(within(tour).getByText(/Create a project/).closest('li')).toHaveClass('is-done')
    await userEvent.click(within(tour).getByRole('button', { name: 'Invite a teammate: go' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/4?do=invite')
  })
})
