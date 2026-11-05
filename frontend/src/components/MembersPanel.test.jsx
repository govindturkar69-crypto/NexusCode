import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MembersPanel from './MembersPanel'
import { stubRoutes } from '../test/helpers'

const MEMBERS = [
  { user_id: 1, username: 'olivia', role: 'owner', created_at: '' },
  { user_id: 2, username: 'eddie', role: 'editor', created_at: '' },
]

function setup(props = {}) {
  const onChanged = vi.fn(() => Promise.resolve())
  const onLeft = vi.fn()
  render(<MembersPanel projectId="7" members={MEMBERS} currentUserId={1} isOwner onChanged={onChanged} onLeft={onLeft} {...props} />)
  return { onChanged, onLeft, user: userEvent.setup() }
}

describe('MembersPanel as owner', () => {
  it('adds a member by username with the chosen role', async () => {
    const fetchMock = stubRoutes({ 'POST /projects/7/members': [201, { member: {} }] })
    const { onChanged, user } = setup()
    await user.type(screen.getByLabelText('Add a member by username'), ' nina ')
    await user.selectOptions(screen.getByLabelText('Role for the new member'), 'viewer')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ username: 'nina', role: 'viewer' })
    expect(screen.getByLabelText('Add a member by username')).toHaveValue('')
  })

  it('shows the server error when the user does not exist', async () => {
    stubRoutes({ 'POST /projects/7/members': [404, { detail: 'No user named ghost' }] })
    const { onChanged, user } = setup()
    await user.type(screen.getByLabelText('Add a member by username'), 'ghost')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No user named ghost')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('changes a role', async () => {
    const fetchMock = stubRoutes({ 'PATCH /projects/7/members/2': [200, { member: {} }] })
    const { onChanged, user } = setup()
    await user.selectOptions(screen.getByLabelText('Role of eddie'), 'viewer')
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ role: 'viewer' })
  })

  it('shows why the last owner cannot be demoted', async () => {
    stubRoutes({ 'PATCH /projects/7/members/1': [409, { detail: 'A project needs at least one owner.' }] })
    const { user } = setup()
    await user.selectOptions(screen.getByLabelText('Role of olivia'), 'editor')
    expect(await screen.findByRole('alert')).toHaveTextContent('at least one owner')
  })

  it('confirms before removing someone', async () => {
    const fetchMock = stubRoutes({ 'DELETE /projects/7/members/2': [204] })
    const { onChanged, onLeft, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Remove eddie' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove eddie?' })
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(onLeft).not.toHaveBeenCalled()
  })
})

describe('MembersPanel as a regular member', () => {
  it('shows the list without management controls, and offers Leave only for yourself', () => {
    setup({ isOwner: false, currentUserId: 2 })
    expect(screen.queryByLabelText('Add a member by username')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Role of eddie')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove olivia' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave this project' })).toBeInTheDocument()
    expect(screen.getByText('owner')).toBeInTheDocument()
  })

  it('leaving calls onLeft, not onChanged', async () => {
    stubRoutes({ 'DELETE /projects/7/members/2': [204] })
    const { onChanged, onLeft, user } = setup({ isOwner: false, currentUserId: 2 })
    await user.click(screen.getByRole('button', { name: 'Leave this project' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(onLeft).toHaveBeenCalled())
    expect(onChanged).not.toHaveBeenCalled()
  })
})
