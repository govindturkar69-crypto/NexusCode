import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TaskModal from './TaskModal'
import { stubRoutes } from '../test/helpers'

const TASK = { id: 5, title: 'Write docs', description: 'old', assignee_id: 1, due_date: '2030-01-15', priority: 'low', status: 'todo' }
const MEMBERS = [{ user_id: 1, username: 'olivia' }, { user_id: 2, username: 'eddie' }]

function setup(props = {}) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(<TaskModal task={TASK} members={MEMBERS} canEdit onSaved={onSaved} onClose={onClose} {...props} />)
  return { onSaved, onClose, user: userEvent.setup() }
}

describe('TaskModal', () => {
  it('shows the current values', () => {
    setup()
    expect(screen.getByLabelText('Title')).toHaveValue('Write docs')
    expect(screen.getByLabelText('Description')).toHaveValue('old')
    expect(screen.getByLabelText('Assignee')).toHaveValue('1')
    expect(screen.getByLabelText('Due date')).toHaveValue('2030-01-15')
    expect(screen.getByLabelText('Priority')).toHaveValue('low')
  })

  it('saves every field, sending null for cleared ones', async () => {
    const fetchMock = stubRoutes({ 'PATCH /tasks/5': [200, { task: TASK }] })
    const { onSaved, user } = setup()
    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), ' New title ')
    await user.clear(screen.getByLabelText('Description'))
    await user.selectOptions(screen.getByLabelText('Assignee'), '')
    await user.clear(screen.getByLabelText('Due date'))
    await user.selectOptions(screen.getByLabelText('Priority'), 'high')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      title: 'New title', description: null, assignee_id: null, due_date: null, priority: 'high',
    })
  })

  it('sends the assignee as a number', async () => {
    const fetchMock = stubRoutes({ 'PATCH /tasks/5': [200, { task: TASK }] })
    const { onSaved, user } = setup()
    await user.selectOptions(screen.getByLabelText('Assignee'), '2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).assignee_id).toBe(2)
  })

  it('refuses an empty title without calling the API', async () => {
    const fetchMock = stubRoutes({})
    const { user } = setup()
    await user.clear(screen.getByLabelText('Title'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent("can't be empty")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows server errors and stays open', async () => {
    stubRoutes({ 'PATCH /tasks/5': [422, { detail: 'The assignee must be a member of this project.' }] })
    const { onSaved, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('must be a member')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('is read-only for viewers', async () => {
    const { onClose, user } = setup({ canEdit: false })
    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toBeDisabled()
    expect(screen.getByLabelText('Priority')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
