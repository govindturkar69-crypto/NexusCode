import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import NotificationBell from './NotificationBell'
import { stubRoutes } from '../test/helpers'

const note = (id, is_read = false) => ({
  id, project_id: 7, kind: 'assigned', message: `note ${id}`, is_read, created_at: '2030-01-15T10:30:00+00:00',
})

function setup(routes) {
  const fetchMock = stubRoutes(routes)
  render(
    <MemoryRouter initialEntries={['/projects']}>
      <NotificationBell />
      <Routes>
        <Route path="/projects" element={<p>list page</p>} />
        <Route path="/projects/:id" element={<p>board page</p>} />
      </Routes>
    </MemoryRouter>
  )
  return fetchMock
}

const calls = (fetchMock, method, path) =>
  fetchMock.mock.calls.filter(([url, init]) => new URL(url).pathname === path && (init?.method ?? 'GET') === method)

describe('NotificationBell', () => {
  afterEach(() => vi.useRealTimers())

  it('shows the unread count and hides it at zero', async () => {
    setup({ 'GET /notifications': [200, { notifications: [note(1), note(2)], unread_count: 2 }] })
    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toHaveTextContent('2')
  })

  it('has no count when everything is read, and says so when empty', async () => {
    setup({ 'GET /notifications': [200, { notifications: [], unread_count: 0 }] })
    const button = await screen.findByRole('button', { name: 'Notifications' })
    await userEvent.click(button)
    expect(await screen.findByText(/all caught up/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument()
  })

  it('opening a notification marks it read and goes to its project', async () => {
    const fetchMock = setup({
      'GET /notifications': [
        [200, { notifications: [note(1)], unread_count: 1 }],
        [200, { notifications: [note(1)], unread_count: 1 }],
        [200, { notifications: [note(1, true)], unread_count: 0 }],
      ],
      'POST /notifications/1/read': [200, { notification: note(1, true) }],
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    await userEvent.click(await screen.findByRole('button', { name: /note 1/ }))
    expect(await screen.findByText('board page')).toBeInTheDocument()
    await waitFor(() => expect(calls(fetchMock, 'POST', '/notifications/1/read')).toHaveLength(1))
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('does not re-mark a notification that is already read', async () => {
    const fetchMock = setup({ 'GET /notifications': [200, { notifications: [note(1, true)], unread_count: 0 }] })
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }))
    await userEvent.click(await screen.findByRole('button', { name: /note 1/ }))
    expect(await screen.findByText('board page')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('marks everything read', async () => {
    const fetchMock = setup({
      'GET /notifications': [
        [200, { notifications: [note(1), note(2)], unread_count: 2 }],
        [200, { notifications: [note(1), note(2)], unread_count: 2 }],
        [200, { notifications: [note(1, true), note(2, true)], unread_count: 0 }],
      ],
      'POST /notifications/read-all': [200, { marked: 2 }],
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }))
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(calls(fetchMock, 'POST', '/notifications/read-all')).toHaveLength(1)
  })

  it('closes on Escape', async () => {
    setup({ 'GET /notifications': [200, { notifications: [note(1)], unread_count: 1 }] })
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    expect(await screen.findByRole('button', { name: /note 1/ })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: /note 1/ })).not.toBeInTheDocument()
  })

  it('polls every 30 seconds, but not while the tab is hidden', async () => {
    vi.useFakeTimers()
    const fetchMock = setup({
      'GET /notifications': [
        [200, { notifications: [], unread_count: 0 }],
        [200, { notifications: [note(5)], unread_count: 1 }],
      ],
    })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(calls(fetchMock, 'GET', '/notifications')).toHaveLength(1)

    await act(() => vi.advanceTimersByTimeAsync(30000))
    expect(calls(fetchMock, 'GET', '/notifications')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await act(() => vi.advanceTimersByTimeAsync(30000))
    expect(calls(fetchMock, 'GET', '/notifications')).toHaveLength(2)
    hidden.mockRestore()
  })
})
