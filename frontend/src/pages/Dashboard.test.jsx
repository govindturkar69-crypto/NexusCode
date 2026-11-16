import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from './Dashboard'
import AuthProvider from '../auth/AuthProvider'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'
import { combinedActivity, greeting, myOpenTasks, orderProjects, recentProjectIds, rememberProject } from '../projects/home'

const ANALYTICS = { total_projects: 2, total_tasks: 3, total_files: 0, total_messages: 4, tasks_by_status: { todo: 2, in_progress: 1, done: 0 } }
const PROJECTS = { projects: [{ id: 1, name: 'Weather CLI', role: 'owner', created_at: '2026-11-01T10:00:00' }, { id: 2, name: 'Website', role: 'viewer', created_at: '2026-11-02T10:00:00' }], total: 2 }
const task = (id, extra) => ({ id, title: `Task ${id}`, status: 'todo', priority: 'medium', due_date: null, assignee_id: null, ...extra })

function renderDashboard(routes) {
  stubRoutes({
    'GET /me': [200, { id: 7, username: 'olivia' }],
    'GET /analytics': [200, ANALYTICS],
    'GET /projects': [200, PROJECTS],
    'GET /projects/1/tasks': [200, { tasks: [task(1, { assignee_id: 7, due_date: '2000-01-01' }), task(2, { assignee_id: 8 }), task(3, { assignee_id: 7, status: 'done' })], total: 3 }],
    'GET /projects/2/tasks': [200, { tasks: [task(4, { assignee_id: 7, priority: 'high' })], total: 1 }],
    'GET /projects/1/activity': [200, { activity: [{ id: 5, action: 'task_created', target: 'Task 1', username: 'olivia', created_at: '2026-11-03T10:00:00' }], total: 1 }],
    'GET /projects/2/activity': [200, { activity: [{ id: 9, action: 'file_uploaded', target: 'notes.txt', username: 'sam', created_at: '2026-11-04T10:00:00' }], total: 1 }],
    ...routes,
  })
  return render(<MemoryRouter><AuthProvider><Dashboard /></AuthProvider></MemoryRouter>)
}

describe('dashboard helpers', () => {
  afterEach(() => localStorage.clear())

  it("my open tasks: overdue first, then by due date, then priority; never done or other people's", () => {
    const tasks = myOpenTasks([
      { project: { id: 1 }, tasks: [task(1, { assignee_id: 1, due_date: '2026-12-01' }), task(2, { assignee_id: 1, due_date: '2026-01-01' }), task(3, { assignee_id: 2 }), task(4, { assignee_id: 1, status: 'done' })] },
      { project: { id: 2 }, tasks: [task(5, { assignee_id: 1, priority: 'high' }), task(6, { assignee_id: 1, priority: 'low' })] },
    ], 1, '2026-06-01')
    expect(tasks.map((t) => t.id)).toEqual([2, 1, 5, 6])
    expect(tasks[0].project.id).toBe(1)
  })

  it('recently opened projects come first, the rest newest first', () => {
    rememberProject('olivia', 1)
    rememberProject('olivia', 3)
    rememberProject('olivia', 1)
    expect(recentProjectIds('olivia')).toEqual([1, 3])
    expect(recentProjectIds('bob')).toEqual([])
    const ordered = orderProjects([{ id: 1, created_at: '1' }, { id: 2, created_at: '3' }, { id: 3, created_at: '1' }, { id: 4, created_at: '2' }], [1, 3])
    expect(ordered.map((p) => p.id)).toEqual([1, 3, 2, 4])
  })

  it('survives junk or blocked storage', () => {
    localStorage.setItem('recent-projects:olivia', '{nope')
    expect(recentProjectIds('olivia')).toEqual([])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => rememberProject('olivia', 1)).not.toThrow()
    vi.restoreAllMocks()
  })

  it('merges activity newest first', () => {
    const feed = combinedActivity([
      { project: { id: 1 }, activity: [{ id: 1, created_at: '2026-01-01' }] },
      { project: { id: 2 }, activity: [{ id: 2, created_at: '2026-02-01' }] },
    ])
    expect(feed.map((e) => e.project.id)).toEqual([2, 1])
  })

  it('greets by the time of day', () => {
    expect(greeting(9)).toBe('Good morning')
    expect(greeting(14)).toBe('Good afternoon')
    expect(greeting(21)).toBe('Good evening')
  })
})

describe('Dashboard', () => {
  beforeEach(() => localStorage.setItem('token', fakeJwt({ sub: 'olivia', exp: inOneHour() })))
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('shows my open tasks across projects, activity, recent projects and totals', async () => {
    renderDashboard()
    expect(await screen.findByRole('heading', { level: 1, name: /, olivia$/ })).toBeInTheDocument()
    const mine = (await screen.findByRole('heading', { name: 'Assigned to you' })).closest('section')
    await within(mine).findByText('Task 4')
    const links = within(mine).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual([expect.stringContaining('Task 1'), expect.stringContaining('Task 4')])
    expect(links[0]).toHaveAttribute('href', '/projects/1?do=task&task=1')
    expect(within(links[0]).getByText(/Overdue/)).toBeInTheDocument()

    const activity = screen.getByRole('heading', { name: 'Recent activity' }).closest('section')
    const entries = within(activity).getAllByRole('listitem')
    expect(entries[0]).toHaveTextContent('sam uploaded notes.txt')

    const projects = screen.getByRole('heading', { name: 'Recent projects' }).closest('section')
    expect(within(projects).getByRole('link', { name: 'Website' })).toHaveAttribute('href', '/projects/2')
    expect(await screen.findByRole('list', { name: 'Totals' })).toHaveTextContent('4Chat messages')
  })

  it('offers quick actions', async () => {
    renderDashboard()
    const actions = screen.getByRole('list', { name: 'Quick actions' })
    expect(within(actions).getByRole('link', { name: 'New project' })).toHaveAttribute('href', '/projects?do=new-project')
    expect(within(actions).getByRole('button', { name: /Search everything/ })).toBeInTheDocument()
    expect(within(actions).getByRole('button', { name: /Keyboard shortcuts/ })).toBeInTheDocument()
    await screen.findByRole('list', { name: 'Totals' })
  })

  it('a new user gets one clear next step', async () => {
    renderDashboard({ 'GET /projects': [200, { projects: [], total: 0 }], 'GET /analytics': [200, { ...ANALYTICS, total_projects: 0, total_tasks: 0, total_messages: 0 }] })
    expect(await screen.findByRole('heading', { name: 'Start with a project' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/projects?do=new-project')
    expect(screen.queryByRole('heading', { name: 'Assigned to you' })).not.toBeInTheDocument()
  })

  it('one project failing does not blank the others', async () => {
    renderDashboard({ 'GET /projects/2/tasks': [500, { detail: 'boom' }] })
    const mine = (await screen.findByRole('heading', { name: 'Assigned to you' })).closest('section')
    expect(await within(mine).findByText('Task 1')).toBeInTheDocument()
    expect(within(mine).queryByText('Task 4')).not.toBeInTheDocument()
  })

  it('shows a retry when the totals fail', async () => {
    renderDashboard({ 'GET /analytics': [500, { detail: 'Server exploded' }] })
    expect(await screen.findByText(/Couldn't load your dashboard/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
