import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Board from './Board'
import AuthProvider from '../auth/AuthProvider'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'

class FakeSocket {
  static OPEN = 1
  static instances = []
  constructor(url) { this.url = url; this.readyState = 1; FakeSocket.instances.push(this) }
  send() {}
  close() {}
  receive(frame) { act(() => this.onmessage({ data: JSON.stringify(frame) })) }
}

const OVERDUE = { id: 3, title: 'Late task', status: 'todo', position: 2, priority: 'high', due_date: '2020-01-01', assignee_id: 9, assignee_username: 'nina' }

function renderBoard(role, extraTasks = [], routes = {}) {
  localStorage.setItem('token', fakeJwt({ sub: 'me', exp: inOneHour() }))
  const fetchMock = stubRoutes({
    'GET /me': [200, { id: 1, username: 'me', is_admin: false }],
    'GET /projects/7': [200, { project: { id: 7, name: 'Team board', role } }],
    'GET /projects/7/members': [200, { members: [{ user_id: 1, username: 'me', role, created_at: '' }] }],
    'GET /projects/7/tasks': [200, { tasks: [{ id: 1, title: 'A task', status: 'todo', position: 1, priority: 'medium', assignee_id: null }, ...extraTasks], total: 1 + extraTasks.length }],
    'GET /projects/7/files': [200, { files: [{ id: 2, filename: 'a.txt', url: 'https://x/a.txt' }], total: 1 }],
    'GET /projects/7/messages': [200, { messages: [], next_cursor: null }],
    'GET /projects/7/activity': [200, { activity: [], total: 0 }],
    'POST /ws-ticket': [200, { ticket: 't', expires_in: 30 }],
    ...routes,
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
  return fetchMock
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

  it('shows priority, due date, assignee and an overdue highlight on cards', async () => {
    renderBoard('editor', [OVERDUE])
    const title = await screen.findByRole('button', { name: 'Late task' })
    const card = title.closest('.card')
    expect(card).toHaveClass('task-card--overdue')
    expect(within(card).getByText('high')).toBeInTheDocument()
    expect(within(card).getByText('Overdue: 2020-01-01')).toBeInTheDocument()
    expect(within(card).getByText('@nina')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A task' }).closest('.card')).not.toHaveClass('task-card--overdue')
  })

  it('filters by assignee', async () => {
    const user = userEvent.setup()
    renderBoard('editor', [OVERDUE])
    await screen.findByRole('button', { name: 'Late task' })
    await user.selectOptions(screen.getByLabelText('Assignee'), 'unassigned')
    expect(screen.getByRole('button', { name: 'A task' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Late task' })).not.toBeInTheDocument()
    expect(screen.getByText(/Clear the filter to drag/)).toBeInTheDocument()
  })

  it('opens the edit modal from a card and refreshes after saving', async () => {
    const user = userEvent.setup()
    const fetchMock = renderBoard('editor', [], { 'PATCH /tasks/1': [200, { task: {} }] })
    await user.click(await screen.findByRole('button', { name: 'A task' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit task' })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([url, init]) => url.endsWith('/tasks/1') && init?.method === 'PATCH')).toBe(true)
  })

  it('viewer can open task details read-only', async () => {
    const user = userEvent.setup()
    renderBoard('viewer')
    await user.click(await screen.findByRole('button', { name: 'A task' }))
    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toBeDisabled()
  })

  it('owner also manages members', async () => {
    renderBoard('owner')
    expect(await screen.findByLabelText('Add a member by username')).toBeInTheDocument()
    expect(await screen.findByLabelText('Role of me')).toBeInTheDocument()
  })
})

describe('Board live updates', () => {
  beforeEach(() => {
    FakeSocket.instances = []
    vi.stubGlobal('WebSocket', FakeSocket)
  })

  it('refreshes tasks and the activity panel on a live frame, without reconnecting', async () => {
    const task = (id, title) => ({ id, title, status: 'todo', position: id, priority: 'medium', assignee_id: null })
    renderBoard('viewer', [], {
      'GET /projects/7/tasks': [
        [200, { tasks: [task(1, 'A task')], total: 1 }],
        [200, { tasks: [task(1, 'A task'), task(2, 'From a teammate')], total: 2 }],
      ],
      'GET /projects/7/activity': [
        [200, { activity: [], total: 0 }],
        [200, { activity: [{ id: 1, action: 'task_created', target: 'From a teammate', username: 'eddie', user_id: 2, created_at: '2030-01-15T10:30:00+00:00' }], total: 1 }],
      ],
    })
    expect(await screen.findByText('A task')).toBeInTheDocument()
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))

    FakeSocket.instances[0].receive({ type: 'activity', action: 'task_created' })

    expect(await screen.findByText('From a teammate')).toBeInTheDocument()
    expect(await screen.findByText(/eddie/)).toBeInTheDocument()
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('picks up my own role change live', async () => {
    renderBoard('viewer', [], {
      'GET /projects/7': [
        [200, { project: { id: 7, name: 'Team board', role: 'viewer' } }],
        [200, { project: { id: 7, name: 'Team board', role: 'editor' } }],
      ],
    })
    expect(await screen.findByText(/view-only access/)).toBeInTheDocument()
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))

    FakeSocket.instances[0].receive({ type: 'activity', action: 'role_changed' })

    expect(await screen.findByLabelText('New task title')).toBeInTheDocument()
    expect(screen.queryByText(/view-only access/)).not.toBeInTheDocument()
  })
})

describe('Board task breakdown', () => {
  beforeEach(() => vi.stubGlobal('WebSocket', FakeSocket))

  const task = (id, title) => ({ id, title, status: 'todo', position: id, priority: 'high', assignee_id: null })

  it('adds reviewed proposals and refreshes the board', async () => {
    renderBoard('editor', [], {
      'POST /ai/projects/7/task-suggestions': [200, { tasks: [{ title: 'Proposed', description: null, priority: 'high' }] }],
      'POST /projects/7/tasks': [201, { task: task(9, 'Proposed') }],
      'GET /projects/7/tasks': [
        [200, { tasks: [task(1, 'A task')], total: 1 }],
        [200, { tasks: [task(1, 'A task'), task(9, 'Proposed')], total: 2 }],
      ],
    })
    await userEvent.click(await screen.findByRole('button', { name: /Generate tasks/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('What are you building?'), 'A feature')
    await userEvent.click(within(dialog).getByRole('button', { name: /Generate/ }))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Add 1 task' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByRole('button', { name: 'Proposed' })).toBeInTheDocument()
  })

  it('viewers do not get the button', async () => {
    renderBoard('viewer')
    await screen.findByText(/view-only access/)
    expect(screen.queryByRole('button', { name: /Generate tasks/ })).not.toBeInTheDocument()
  })

  it('owners do', async () => {
    renderBoard('owner')
    expect(await screen.findByRole('button', { name: /Generate tasks/ })).toBeInTheDocument()
  })
})

