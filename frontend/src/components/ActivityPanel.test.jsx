import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ActivityPanel from './ActivityPanel'
import { describeActivity, mergeActivity } from '../projects/activity'
import { stubRoutes } from '../test/helpers'

const entry = (id, action = 'task_created', target = `t${id}`, username = 'eddie') => ({
  id, action, target, username, user_id: 2, created_at: '2030-01-15T10:30:00+00:00',
})

const items = () => within(screen.getByRole('list', { name: 'Project activity' })).getAllByRole('listitem').map((li) => li.textContent)

describe('describeActivity', () => {
  it.each([
    ['task_created', 'Ship', 'created task "Ship"'],
    ['task_edited', 'Ship', 'edited task "Ship"'],
    ['task_moved', 'Ship → Done', 'moved Ship → Done'],
    ['task_deleted', 'Ship', 'deleted task "Ship"'],
    ['file_uploaded', 'a.txt', 'uploaded a.txt'],
    ['member_added', 'oscar', 'added oscar'],
    ['member_removed', 'oscar', 'removed oscar'],
    ['member_left', 'vera', 'left the project'],
    ['role_changed', 'oscar → viewer', 'changed a role: oscar → viewer'],
    ['github_pushed', 'me/repo', 'pushed the code to me/repo'],
    ['code_created', 'src/a.py', 'created src/a.py'],
    ['code_renamed', 'a.py → b.py', 'renamed a.py → b.py'],
    ['code_deleted', 'src/', 'deleted src/'],
    ['from_the_future', 'x', 'from_the_future: x'],
  ])('%s', (action, target, text) => {
    expect(describeActivity({ action, target })).toBe(text)
  })
})

describe('mergeActivity', () => {
  it('keeps newest first without duplicates', () => {
    const merged = mergeActivity([entry(3), entry(2)], [entry(4), entry(3)])
    expect(merged.map((e) => e.id)).toEqual([4, 3, 2])
  })
})

describe('ActivityPanel', () => {
  it('lists entries, including ones whose author was deleted', async () => {
    stubRoutes({ 'GET /projects/7/activity': [200, { activity: [entry(2), entry(1, 'member_left', 'x', null)], total: 2 }] })
    render(<ActivityPanel projectId="7" refreshKey={0} />)
    expect(await screen.findByRole('list', { name: 'Project activity' })).toBeInTheDocument()
    expect(items()[0]).toContain('eddie created task "t2"')
    expect(items()[1]).toContain('Deleted user left the project')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('says when there is nothing yet', async () => {
    stubRoutes({ 'GET /projects/7/activity': [200, { activity: [], total: 0 }] })
    render(<ActivityPanel projectId="7" refreshKey={0} />)
    expect(await screen.findByText(/Nothing has happened/)).toBeInTheDocument()
  })

  it('shows a load failure', async () => {
    stubRoutes({ 'GET /projects/7/activity': [500, { detail: 'Server broke' }] })
    render(<ActivityPanel projectId="7" refreshKey={0} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Server broke')
  })

  it('loads older entries from the current offset', async () => {
    const fetchMock = stubRoutes({
      'GET /projects/7/activity': [
        [200, { activity: [entry(3), entry(2)], total: 3 }],
        [200, { activity: [entry(1)], total: 3 }],
      ],
    })
    render(<ActivityPanel projectId="7" refreshKey={0} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(await screen.findByText(/"t1"/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.at(-1)[0]).toContain('offset=2')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('picks up new entries when refreshKey changes, keeping what is loaded', async () => {
    stubRoutes({
      'GET /projects/7/activity': [
        [200, { activity: [entry(1)], total: 1 }],
        [200, { activity: [entry(2), entry(1)], total: 2 }],
      ],
    })
    const { rerender } = render(<ActivityPanel projectId="7" refreshKey={0} />)
    expect(await screen.findByText(/"t1"/)).toBeInTheDocument()
    rerender(<ActivityPanel projectId="7" refreshKey={1} />)
    expect(await screen.findByText(/"t2"/)).toBeInTheDocument()
    expect(items()).toHaveLength(2)
  })
})
