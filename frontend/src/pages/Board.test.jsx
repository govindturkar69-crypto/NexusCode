import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Board from './Board'
import AuthProvider from '../auth/AuthProvider'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'

class FakeSocket {
  static OPEN = 1
  constructor(url) { this.url = url; this.readyState = 1 }
  send() {}
  close() {}
}

function renderBoard(role) {
  localStorage.setItem('token', fakeJwt({ sub: 'me', exp: inOneHour() }))
  stubRoutes({
    'GET /me': [200, { id: 1, username: 'me', is_admin: false }],
    'GET /projects/7': [200, { project: { id: 7, name: 'Team board', role } }],
    'GET /projects/7/members': [200, { members: [{ user_id: 1, username: 'me', role, created_at: '' }] }],
    'GET /projects/7/tasks': [200, { tasks: [{ id: 1, title: 'A task', status: 'todo', position: 1 }], total: 1 }],
    'GET /projects/7/files': [200, { files: [{ id: 2, filename: 'a.txt', url: 'https://x/a.txt' }], total: 1 }],
    'GET /projects/7/messages': [200, { messages: [], next_cursor: null }],
    'POST /ws-ticket': [200, { ticket: 't', expires_in: 30 }],
  })
  render(
    <MemoryRouter initialEntries={['/projects/7']}>
      <AuthProvider>
        <Routes>
          <Route path="/projects/:projectId" element={<Board />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
}

describe('Board is role-aware', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket)
  })

  it('viewer sees content but no way to change it', async () => {
    renderBoard('viewer')
    expect(await screen.findByText('A task')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Team board' })).toBeInTheDocument()
    expect(await screen.findByText(/view-only access/)).toBeInTheDocument()
    expect(screen.queryByLabelText('New task title')).not.toBeInTheDocument()
    expect(screen.queryByText('+ Upload a file')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete task A task' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete file a.txt' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument()
    expect(screen.getByText(/read the chat but not post/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Add a member by username')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Leave this project' })).toBeInTheDocument()
  })

  it('editor can edit content but not manage members', async () => {
    renderBoard('editor')
    expect(await screen.findByLabelText('New task title')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Delete task A task' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Delete file a.txt' })).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toBeInTheDocument()
    expect(screen.queryByLabelText('Add a member by username')).not.toBeInTheDocument()
  })

  it('owner also manages members', async () => {
    renderBoard('owner')
    expect(await screen.findByLabelText('Add a member by username')).toBeInTheDocument()
    expect(await screen.findByLabelText('Role of me')).toBeInTheDocument()
  })
})
