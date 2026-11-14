import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProjectAnalytics from './ProjectAnalytics'
import AuthProvider from '../auth/AuthProvider'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'

// Recharts needs a real layout engine; the charts' numbers are tested through
// the data tables, which is also what screen readers get
vi.mock('../components/charts/ProjectCharts', () => ({
  BurnChart: () => <div data-testid="burn-chart" />,
  ThroughputChart: () => <div data-testid="throughput-chart" />,
  ActivityChart: () => <div data-testid="activity-chart" />,
}))

const day = (n) => `2026-11-${String(n).padStart(2, '0')}`

function analytics(overrides = {}) {
  return {
    range_days: 14,
    start_date: day(1),
    end_date: day(14),
    tasks_by_status: { todo: 3, in_progress: 1, done: 6 },
    total_tasks: 10,
    completion_dates: { dated: 4, undated: 2 },
    burn: Array.from({ length: 14 }, (_, i) => ({ date: day(i + 1), scope: 8, completed: i > 10 ? 4 : 2, remaining: i > 10 ? 4 : 6 })),
    throughput: [{ start: day(1), end: day(7), days: 7, completed: 1 }, { start: day(8), end: day(14), days: 7, completed: 3 }],
    cycle_time: { available: true, sample_size: 3, median_days: 5, p90_days: 9, reason: null },
    workload: [
      { user_id: 2, username: 'eddie', todo: 1, in_progress: 1, done: 2 },
      { user_id: null, username: null, todo: 1, in_progress: 0, done: 1 },
    ],
    overdue: { count: 2, tasks: [{ id: 8, title: 'Open late', due_date: day(11), days_overdue: 3, assignee: 'eddie' }, { id: 9, title: 'Unassigned late', due_date: day(13), days_overdue: 1, assignee: null }] },
    activity_by_day: Array.from({ length: 14 }, (_, i) => ({ date: day(i + 1), events: i === 13 ? 4 : 1 })),
    contributors: [{ username: 'olivia', events: 7 }, { username: 'eddie', events: 2 }],
    files_edited: 2,
    recent_files: [{ path: 'src/a.py', updated_at: '2026-11-13T09:00:00+00:00' }],
    ...overrides,
  }
}

function renderPage(routes) {
  localStorage.setItem('token', fakeJwt({ sub: 'olivia', exp: inOneHour() }))
  const fetchMock = stubRoutes({
    'GET /me': [200, { id: 1, username: 'olivia' }],
    'GET /projects/7': [200, { project: { id: 7, name: 'Weather CLI', role: 'viewer' } }],
    ...routes,
  })
  render(
    <MemoryRouter initialEntries={['/projects/7/analytics']}>
      <AuthProvider>
        <Routes>
          <Route path="/projects/:projectId/analytics" element={<ProjectAnalytics />} />
          <Route path="/projects/:projectId" element={<p>Board page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
  return fetchMock
}

const analyticsCalls = (fetchMock) => fetchMock.mock.calls.map(([url]) => new URL(url)).filter((u) => u.pathname.endsWith('/analytics'))

describe('Project analytics page', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a skeleton while loading', () => {
    renderPage({ 'GET /projects/7/analytics': [200, analytics()] })
    expect(screen.getByText('Loading analytics…').closest('[role="status"]')).toBeInTheDocument()
  })

  it('summarises the project and gives every chart a title, summary and data table', async () => {
    const fetchMock = renderPage({ 'GET /projects/7/analytics': [200, analytics()] })
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
    const summary = await screen.findByRole('list', { name: 'Summary' })
    expect(within(summary).getByText('Open tasks').parentElement).toHaveTextContent('4')
    expect(within(summary).getByText('Finished in the last 14 days').parentElement).toHaveTextContent('4')
    expect(within(summary).getByText('Cycle time (median)').parentElement).toHaveTextContent('5.0 days')
    expect(within(summary).getByText('Cycle time (median)').parentElement).toHaveTextContent('90% within 9.0 days · 3 tasks')
    expect(within(summary).getByText('Overdue').parentElement).toHaveTextContent('2')
    // Undated done tasks are explained, not hidden
    expect(screen.getByRole('note')).toHaveTextContent('2 done tasks have no recorded completion time')
    // Charts: a figure each, named by its title and described by its summary
    const burn = screen.getByRole('figure', { name: 'Burn-up and burn-down' })
    expect(burn).toHaveAccessibleDescription('On 2026-11-14: 8 tasks in scope, 4 completed, 4 remaining.')
    expect(within(burn).getAllByRole('row')).toHaveLength(15) // header + 14 days
    expect(screen.getByRole('figure', { name: 'Throughput' })).toHaveAccessibleDescription('4 tasks finished, in 7-day blocks.')
    expect(screen.getByRole('figure', { name: 'Activity' })).toHaveAccessibleDescription('17 events in the feed over the last 14 days.')
    // Workload, overdue, people and files
    expect(screen.getByLabelText('eddie: 1 to do, 1 in progress, 2 done')).toBeInTheDocument()
    expect(screen.getByLabelText('Unassigned: 1 to do, 0 in progress, 1 done')).toBeInTheDocument()
    expect(screen.getByText('Open late').closest('li')).toHaveTextContent('3 days late')
    expect(screen.getByText('@olivia').closest('li')).toHaveTextContent('7 events')
    expect(screen.getByText('src/a.py')).toBeInTheDocument()
    expect(analyticsCalls(fetchMock)[0].searchParams.get('range')).toBe('14')
  })

  it('says why cycle time is missing instead of inventing one', async () => {
    renderPage({ 'GET /projects/7/analytics': [200, analytics({ cycle_time: { available: false, sample_size: 0, median_days: null, p90_days: null, reason: 'No task with a recorded move to Done was finished in this range.' }, completion_dates: { dated: 0, undated: 0 } })] })
    const stat = (await screen.findByText('Cycle time (median)')).parentElement
    expect(stat).toHaveTextContent('—')
    expect(stat).toHaveTextContent('No task with a recorded move to Done')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('switches the range', async () => {
    const user = userEvent.setup()
    const fetchMock = renderPage({
      'GET /projects/7/analytics': [
        [200, analytics()],
        [200, analytics({ range_days: 30 })],
      ],
    })
    await screen.findByRole('list', { name: 'Summary' })
    expect(screen.getByRole('button', { name: 'Last 14 days' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Last 30 days' }))
    await waitFor(() => expect(analyticsCalls(fetchMock).map((u) => u.searchParams.get('range'))).toEqual(['14', '30']))
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows an empty state for a new project', async () => {
    renderPage({
      'GET /projects/7/analytics': [200, analytics({
        tasks_by_status: { todo: 0, in_progress: 0, done: 0 }, total_tasks: 0, completion_dates: { dated: 0, undated: 0 },
        activity_by_day: [{ date: day(14), events: 0 }], workload: [], overdue: { count: 0, tasks: [] }, contributors: [],
      })],
    })
    expect(await screen.findByRole('heading', { name: 'Not much to show yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the board' })).toHaveAttribute('href', '/projects/7')
  })

  it('shows an error with a retry that works', async () => {
    const user = userEvent.setup()
    renderPage({ 'GET /projects/7/analytics': [[500, { detail: 'Database is asleep' }], [200, analytics()]] })
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is asleep')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'Summary' })).toBeInTheDocument()
  })
})
