import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Projects from './Projects'
import AuthProvider from '../auth/AuthProvider'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'

function renderProjects() {
  localStorage.setItem('token', fakeJwt({ sub: 'alice', exp: inOneHour() }))
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <AuthProvider>
        <Routes>
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<p>Board page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
}

const ME = { id: 1, username: 'alice', is_admin: false }
const PROJECT = { id: 3, name: 'Alpha', description: 'first', owner_id: 1, created_at: '', updated_at: '', role: 'owner' }

describe('Projects page', () => {
  it('shows an empty state', async () => {
    stubRoutes({ 'GET /me': [200, ME], 'GET /projects': [200, { projects: [], total: 0 }] })
    renderProjects()
    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument()
  })

  it('asks for confirmation before deleting, and Cancel keeps the project', async () => {
    const user = userEvent.setup()
    const fetchMock = stubRoutes({ 'GET /me': [200, ME], 'GET /projects': [200, { projects: [PROJECT], total: 1 }] })
    renderProjects()
    await user.click(await screen.findByRole('button', { name: 'Delete project Alpha' }))

    const dialog = screen.getByRole('dialog', { name: 'Delete "Alpha"?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })

  it('deletes after confirming and reloads the list', async () => {
    const user = userEvent.setup()
    const fetchMock = stubRoutes({
      'GET /me': [200, ME],
      'GET /projects': [[200, { projects: [PROJECT], total: 1 }], [200, { projects: [], total: 0 }]],
      'DELETE /projects/3': [204],
    })
    renderProjects()
    await user.click(await screen.findByRole('button', { name: 'Delete project Alpha' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete project' }))
    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument()
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')
    expect(del[0]).toBe('http://api.test/projects/3')
  })

  it('shows your role and only offers Delete to owners', async () => {
    stubRoutes({
      'GET /me': [200, ME],
      'GET /projects': [200, { projects: [PROJECT, { ...PROJECT, id: 4, name: 'Shared', role: 'viewer' }], total: 2 }],
    })
    renderProjects()
    expect(await screen.findByRole('button', { name: 'Delete project Alpha' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete project Shared' })).not.toBeInTheDocument()
    expect(screen.getByText('viewer')).toBeInTheDocument()
    expect(screen.getByText('owner')).toBeInTheDocument()
  })

  it('opens a project from the keyboard via its link', async () => {
    const user = userEvent.setup()
    stubRoutes({ 'GET /me': [200, ME], 'GET /projects': [200, { projects: [PROJECT], total: 1 }] })
    renderProjects()
    const link = await screen.findByRole('link', { name: 'Alpha' })
    link.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Board page')).toBeInTheDocument()
  })
})
