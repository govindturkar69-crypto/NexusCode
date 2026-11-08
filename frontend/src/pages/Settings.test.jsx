import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Settings from './Settings'
import AuthProvider from '../auth/AuthProvider'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'

const NOT_CONNECTED = { connected: false, username: null, expired: false }
const EMPTY_PLAN = { deleted: [], transferred: [], left: [] }

function setup(routes = {}) {
  const fetchMock = stubRoutes({
    'GET /me': [200, { id: 1, username: 'alice', is_admin: false }],
    'GET /me/github': [200, NOT_CONNECTED],
    'GET /me/email': [200, { email: null, email_verified: false, has_password: true, sending: { enabled: false, restricted: false, message: 'off' } }],
    ...routes,
  })
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <AuthProvider>
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
  return fetchMock
}

const posted = (fetchMock, path) => {
  const call = fetchMock.mock.calls.find(([url, init]) => new URL(url).pathname === path && init?.method === 'POST')
  return call && JSON.parse(call[1].body)
}

async function fillPassword({ current = 'old-password', next = 'new-password', confirm = next } = {}) {
  await userEvent.type(screen.getByLabelText('Current password'), current)
  await userEvent.type(screen.getByLabelText('New password'), next)
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm)
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
}

describe('Settings', () => {
  beforeEach(() => {
    localStorage.setItem('token', fakeJwt({ sub: 'alice', exp: inOneHour() }))
  })

  it('shows who is signed in', async () => {
    setup()
    expect(await screen.findByText('alice')).toBeInTheDocument()
  })

  describe('password', () => {
    it('changes it and clears the form', async () => {
      const fetchMock = setup({ 'POST /me/password': [200, { message: 'Password changed' }] })
      await fillPassword()
      expect(await screen.findByText('Password changed.')).toBeInTheDocument()
      expect(posted(fetchMock, '/me/password')).toEqual({ current_password: 'old-password', new_password: 'new-password' })
      expect(screen.getByLabelText('New password')).toHaveValue('')
    })

    it('shows a wrong current password and stays signed in', async () => {
      setup({ 'POST /me/password': [400, { detail: 'That password is not correct.' }] })
      await fillPassword()
      expect(await screen.findByText('That password is not correct.')).toBeInTheDocument()
      expect(screen.queryByText('login page')).not.toBeInTheDocument()
    })

    it.each([
      ['too short', 'short', 'short', /between 8 and 72 bytes/],
      ['too long', 'x'.repeat(73), 'x'.repeat(73), /between 8 and 72 bytes/],
      ['over 72 bytes in multi-byte characters', 'é'.repeat(37), 'é'.repeat(37), /between 8 and 72 bytes/],
      ['not matching', 'new-password', 'other-password', /don't match/],
    ])('refuses a new password that is %s, without calling the server', async (_name, next, confirm, message) => {
      const fetchMock = setup()
      await fillPassword({ next, confirm })
      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(posted(fetchMock, '/me/password')).toBeUndefined()
    })
  })

  describe('GitHub', () => {
    it('offers to connect when not connected', async () => {
      setup()
      expect(await screen.findByRole('button', { name: 'Connect GitHub' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
    })

    it('shows the username and disconnects after confirming', async () => {
      const fetchMock = setup({
        'GET /me/github': [
          [200, { connected: true, username: 'octo', expired: false }],
          [200, NOT_CONNECTED],
        ],
        'DELETE /me/github': [204],
      })
      expect(await screen.findByText('@octo')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
      const dialog = await screen.findByRole('dialog')
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
      expect(await screen.findByRole('button', { name: 'Connect GitHub' })).toBeInTheDocument()
      expect(screen.queryByText('@octo')).not.toBeInTheDocument()
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
    })

    it('says when GitHub revoked the connection', async () => {
      setup({ 'GET /me/github': [200, { connected: true, username: null, expired: true }] })
      expect(await screen.findByText(/no longer accepts/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
    })
  })

  describe('delete account', () => {
    it('shows what will happen to each project first', async () => {
      setup({
        'GET /me/deletion-plan': [200, {
          deleted: [{ project_id: 1, name: 'Solo' }],
          transferred: [{ project_id: 2, name: 'Team', new_owner: 'bob' }],
          left: [{ project_id: 3, name: 'Shared' }],
        }],
      })
      await userEvent.click(await screen.findByRole('button', { name: 'Delete my account...' }))
      const dialog = await screen.findByRole('dialog')
      expect(await within(dialog).findByText('Solo')).toBeInTheDocument()
      expect(within(dialog).getByText('Team → @bob')).toBeInTheDocument()
      expect(within(dialog).getByText('Shared')).toBeInTheDocument()
      expect(within(dialog).getByText(/Permanently deleted/)).toBeInTheDocument()
    })

    it('needs a password before it can be confirmed', async () => {
      setup({ 'GET /me/deletion-plan': [200, EMPTY_PLAN] })
      await userEvent.click(await screen.findByRole('button', { name: 'Delete my account...' }))
      expect(await screen.findByText(/aren't in any projects/)).toBeInTheDocument()
      const confirm = screen.getByRole('button', { name: 'Delete my account' })
      expect(confirm).toBeDisabled()
      await userEvent.type(screen.getByLabelText('Confirm with your password'), 'pw')
      expect(confirm).toBeEnabled()
    })

    it('shows a wrong password and keeps the account', async () => {
      setup({
        'GET /me/deletion-plan': [200, EMPTY_PLAN],
        'POST /me/delete': [400, { detail: 'That password is not correct.' }],
      })
      await userEvent.click(await screen.findByRole('button', { name: 'Delete my account...' }))
      await screen.findByText(/aren't in any projects/)
      await userEvent.type(screen.getByLabelText('Confirm with your password'), 'wrong')
      await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
      expect(await screen.findByText('That password is not correct.')).toBeInTheDocument()
      expect(localStorage.getItem('token')).not.toBeNull()
    })

    it('signs out and goes to login once deleted', async () => {
      const fetchMock = setup({
        'GET /me/deletion-plan': [200, EMPTY_PLAN],
        'POST /me/delete': [204],
      })
      await userEvent.click(await screen.findByRole('button', { name: 'Delete my account...' }))
      await screen.findByText(/aren't in any projects/)
      await userEvent.type(screen.getByLabelText('Confirm with your password'), 'right-password')
      await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
      expect(await screen.findByText('login page')).toBeInTheDocument()
      expect(posted(fetchMock, '/me/delete')).toEqual({ password: 'right-password' })
      await waitFor(() => expect(localStorage.getItem('token')).toBeNull())
    })

    it('cancelling deletes nothing', async () => {
      const fetchMock = setup({ 'GET /me/deletion-plan': [200, EMPTY_PLAN] })
      await userEvent.click(await screen.findByRole('button', { name: 'Delete my account...' }))
      await screen.findByText(/aren't in any projects/)
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(posted(fetchMock, '/me/delete')).toBeUndefined()
    })
  })
})
