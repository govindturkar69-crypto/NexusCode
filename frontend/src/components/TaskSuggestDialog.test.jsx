import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TaskSuggestDialog from './TaskSuggestDialog'
import { stubRoutes } from '../test/helpers'

const TASKS = [
  { title: 'Add form', description: 'With two fields', priority: 'high' },
  { title: 'Send email', description: null, priority: 'medium' },
  { title: 'Write tests', description: 'Happy path', priority: 'low' },
]
const SUGGEST = 'POST /ai/projects/7/task-suggestions'
const CREATE = 'POST /projects/7/tasks'

function setup(routes = {}) {
  const fetchMock = stubRoutes({ [SUGGEST]: [200, { tasks: TASKS }], ...routes })
  const handlers = { onClose: vi.fn(), onAdded: vi.fn() }
  render(<TaskSuggestDialog projectId="7" {...handlers} />)
  return { fetchMock, ...handlers }
}

const creates = (fetchMock) => fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/projects/7/tasks').map(([, init]) => JSON.parse(init.body))

async function generate() {
  await userEvent.type(screen.getByLabelText('What are you building?'), 'Password reset')
  await userEvent.click(screen.getByRole('button', { name: /Generate/ }))
}

describe('TaskSuggestDialog', () => {
  it('needs a description', () => {
    setup()
    expect(screen.getByRole('button', { name: /Generate/ })).toBeDisabled()
  })

  it('shows proposals with priority and description, all ticked, adding nothing', async () => {
    const { fetchMock, onAdded } = setup()
    await generate()
    expect(await screen.findByRole('checkbox', { name: /Add form/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Send email/ })).toBeChecked()
    expect(screen.getByText('With two fields')).toBeInTheDocument()
    expect(screen.getByText('high')).toHaveClass('badge--priority-high')
    expect(screen.getByText(/haven't been added/)).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ description: 'Password reset' })
    expect(creates(fetchMock)).toEqual([])
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('adds only what stays ticked, in order, after pressing Add', async () => {
    const { fetchMock, onAdded } = setup({ [CREATE]: [201, { task: {} }] })
    await generate()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Send email/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(true))
    expect(creates(fetchMock)).toEqual([TASKS[0], TASKS[2]])
  })

  it('cannot add nothing', async () => {
    setup()
    await generate()
    for (const name of [/Add form/, /Send email/, /Write tests/]) {
      await userEvent.click(await screen.findByRole('checkbox', { name }))
    }
    expect(screen.getByRole('button', { name: 'Add 0 tasks' })).toBeDisabled()
  })

  it('uses singular wording for one task', async () => {
    setup()
    await generate()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Add form/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Send email/ }))
    expect(screen.getByRole('button', { name: 'Add 1 task' })).toBeEnabled()
  })

  it('cancel adds nothing', async () => {
    const { fetchMock, onClose } = setup()
    await generate()
    await screen.findByRole('checkbox', { name: /Add form/ })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(creates(fetchMock)).toEqual([])
  })

  it('Back keeps the description for another try', async () => {
    setup()
    await generate()
    await screen.findByRole('checkbox', { name: /Add form/ })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('What are you building?')).toHaveValue('Password reset')
  })

  it('shows quota and busy errors and can try again', async () => {
    setup({ [SUGGEST]: [[503, { detail: 'The AI service is temporarily busy.' }], [200, { tasks: TASKS }]] })
    await generate()
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily busy')
    await userEvent.click(screen.getByRole('button', { name: /Generate/ }))
    expect(await screen.findByRole('checkbox', { name: /Add form/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('if adding fails partway, says so, refreshes the board, and offers only what is left', async () => {
    const { fetchMock, onAdded } = setup({ [CREATE]: [[201, { task: {} }], [500, { detail: 'Server broke' }], [201, { task: {} }]] })
    await generate()
    await userEvent.click(await screen.findByRole('button', { name: 'Add 3 tasks' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Added 1 of 3. Server broke')
    expect(onAdded).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('checkbox', { name: /Add form/ })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Send email/ })).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(true))
    expect(creates(fetchMock).map((t) => t.title)).toEqual(['Add form', 'Send email', 'Send email', 'Write tests'])
  })

  it('an untouched failure on the first task does not refresh the board', async () => {
    const { onAdded } = setup({ [CREATE]: [500, { detail: 'Nope' }] })
    await generate()
    await userEvent.click(await screen.findByRole('button', { name: 'Add 3 tasks' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Added 0 of 3. Nope')
    expect(onAdded).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /Add form/ })).toBeChecked()
  })
})
