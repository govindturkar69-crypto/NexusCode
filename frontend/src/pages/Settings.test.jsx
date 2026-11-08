import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Settings from './Settings'
import AuthProvider from '../auth/AuthProvider'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'

const NEW_TOKEN = fakeJwt({ sub: 'alice', ver: 1, exp: inOneHour() })
const NOT_CONNECTED = { connected: false, username: null, expired: false }
const EMPTY_PLAN = { deleted: [], transferred: [], left: [] }
const METHODS = { has_password: true, identities: [], available: { google: false, github: false } }

function setup(routes = {}, entry = '/settings') {
  const fetchMock = stubRoutes({
    'GET /me': [200, { id: 1, username: 'alice', is_admin: false }],
    'GET /me/github': [200, NOT_CONNECTED],
    'GET /me/email': [200, { email: null, email_verified: false, has_password: true, sending: { enabled: false, restricted: false, message: 'off' } }],
    'GET /me/sign-in-methods': [200, METHODS],
    ...routes,
  })
  render(
    <MemoryRouter initialEntries={[entry]}>
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
      const fetchMock = setup({ 'POST /me/password': [200, { message: 'Password changed', access_token: NEW_TOKEN, token_type: 'bearer' }] })
      await fillPassword()
      expect(await screen.findByText(/Password changed. Other devices have been signed out./)).toBeInTheDocument()
      // This session carries on with the token the change returned
      expect(localStorage.getItem('token')).toBe(NEW_TOKEN)
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

describe('Settings: verification and sessions', () => {
  beforeEach(() => {
    localStorage.setItem('token', fakeJwt({ sub: 'alice', exp: inOneHour() }))
  })

  const EMAIL = { email: 'a@example.com', email_verified: false, has_password: true, sending: { enabled: true, restricted: false, message: null } }

  it('offers to verify an unverified address', async () => {
    const fetchMock = setup({
      'GET /me/email': [200, EMAIL],
      'POST /me/email/verification': [200, { message: "We've sent a link to a@example.com. It works for 24 hours." }],
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Send verification email' }))
    expect(await screen.findByText(/sent a link to a@example.com/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => url.includes('/me/email/verification') && init.method === 'POST')).toBe(true)
  })

  it('does not offer it for a verified address, or when email is off', async () => {
    setup({ 'GET /me/email': [200, { ...EMAIL, email_verified: true }] })
    expect(await screen.findByText('verified')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send verification email' })).not.toBeInTheDocument()
  })

  it('signs out other devices and keeps this one with the new token', async () => {
    setup({ 'POST /me/sessions/revoke': [200, { message: 'Signed out everywhere else.', access_token: NEW_TOKEN, token_type: 'bearer' }] })
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out of other devices' }))
    expect(await screen.findByText('Signed out everywhere else.')).toBeInTheDocument()
    expect(localStorage.getItem('token')).toBe(NEW_TOKEN)
  })
})


describe('sign-in methods', () => {
  const GOOGLE = { provider: 'google', email: 'alice@gmail.test', linked_at: '2026-11-01T10:00:00Z' }
  const BOTH = { google: true, github: true }

  it('lists the password and each offered provider', async () => {
    setup({ 'GET /me/sign-in-methods': [200, { has_password: true, identities: [GOOGLE], available: BOTH }] })
    const section = (await screen.findByRole('heading', { name: /Sign-in methods/ })).closest('section')
    await within(section).findByText(/Linked as alice@gmail.test/)
    expect(within(section).getByText('Set')).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Unlink Google' })).toBeEnabled()
    expect(within(section).getByRole('button', { name: 'Link GitHub' })).toBeEnabled()
    expect(within(section).getByText(/separate from the GitHub connection below/)).toBeInTheDocument()
  })

  it('hides providers the server does not offer, unless already linked', async () => {
    setup({ 'GET /me/sign-in-methods': [200, { has_password: true, identities: [GOOGLE], available: { google: false, github: false } }] })
    await screen.findByRole('button', { name: 'Unlink Google' })
    expect(screen.queryByRole('button', { name: 'Link GitHub' })).not.toBeInTheDocument()
  })

  it('unlinks after confirming, then reloads', async () => {
    const fetchMock = setup({
      'GET /me/sign-in-methods': [[200, { has_password: true, identities: [GOOGLE], available: BOTH }], [200, { has_password: true, identities: [], available: BOTH }]],
      'DELETE /me/identities/google': [204, null],
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Unlink Google' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('be able to sign in with Google')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }))
    expect(await screen.findByRole('button', { name: 'Link Google' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => new URL(url).pathname === '/me/identities/google' && init.method === 'DELETE')).toBe(true)
  })

  it('will not unlink the only way in', async () => {
    setup({ 'GET /me/sign-in-methods': [200, { has_password: false, identities: [GOOGLE], available: BOTH }] })
    expect(await screen.findByRole('button', { name: 'Unlink Google' })).toBeDisabled()
    expect(screen.getByText(/unlink your only way to sign in/)).toBeInTheDocument()
  })

  it('shows the server refusing an unlink', async () => {
    setup({
      'GET /me/sign-in-methods': [200, { has_password: true, identities: [GOOGLE], available: BOTH }],
      'DELETE /me/identities/google': [400, { detail: 'Google is the only way into this account.' }],
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Unlink Google' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Unlink' }))
    expect(await screen.findByText('Google is the only way into this account.')).toBeInTheDocument()
  })

  it('starts a link with the session and comes back to Settings', async () => {
    localStorage.setItem('token', fakeJwt({ sub: 'alice', exp: inOneHour() }))
    const fetchMock = setup({
      'GET /me/sign-in-methods': [200, { has_password: true, identities: [], available: BOTH }],
      'POST /auth/oauth/github/start': [503, { detail: 'Signing in with GitHub is not set up on this server.' }],
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Link GitHub' }))
    expect(await screen.findByText(/not set up/)).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === '/auth/oauth/github/start')
    expect(JSON.parse(call[1].body)).toMatchObject({ intent: 'link' })
    expect(call[1].headers.Authorization).toMatch(/^Bearer /)
  })

  it('shows the notice handed over after linking', async () => {
    setup({}, { pathname: '/settings', state: { notice: 'Google is now linked to your account.' } })
    expect(await screen.findByText('Google is now linked to your account.')).toBeInTheDocument()
  })
})

describe('accounts without a password', () => {
  const NO_PASSWORD = { has_password: false, identities: [{ provider: 'github', email: null, linked_at: '2026-11-01T10:00:00Z' }], available: { google: true, github: true } }

  it('offers Set a password instead of Change password, and no delete until then', async () => {
    setup({ 'GET /me/sign-in-methods': [200, NO_PASSWORD] })
    expect(await screen.findByRole('heading', { name: /Set a password/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete my account...' })).not.toBeInTheDocument()
    expect(screen.getByText(/Set a password first/)).toBeInTheDocument()
  })

  it('sets one, then switches to Change password', async () => {
    const fetchMock = setup({
      'GET /me/sign-in-methods': [[200, NO_PASSWORD], [200, { ...NO_PASSWORD, has_password: true }]],
      'POST /me/password/set': [200, { message: 'Password set. You can now also sign in with your username and password.' }],
    })
    await screen.findByRole('heading', { name: /Set a password/ })
    await userEvent.type(screen.getByLabelText('New password'), 'short')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(await screen.findByText(/between 8 and 72 bytes/)).toBeInTheDocument()
    expect(posted(fetchMock, '/me/password/set')).toBeUndefined()
    await userEvent.clear(screen.getByLabelText('New password'))
    await userEvent.clear(screen.getByLabelText('Confirm new password'))
    await userEvent.type(screen.getByLabelText('New password'), 'a-good-password')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-good-password')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(await screen.findByText(/Password set/)).toBeInTheDocument()
    expect(posted(fetchMock, '/me/password/set')).toEqual({ new_password: 'a-good-password' })
    expect(await screen.findByLabelText('Current password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete my account...' })).toBeInTheDocument()
  })
})
