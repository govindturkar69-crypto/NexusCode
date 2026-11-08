import { StrictMode } from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ForgotPassword, OAuthCallback, ResetPassword, VerifyEmail } from './AccountPages'
import AuthProvider from '../auth/AuthProvider'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'

function renderPage(page, { strict = false } = {}) {
  const tree = <MemoryRouter>{page}</MemoryRouter>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

const body = (fetchMock, path) => {
  const call = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === path)
  return call && { json: JSON.parse(call[1].body), headers: call[1].headers }
}

function withFragment(hash) {
  window.history.replaceState(null, '', `/somewhere${hash}`)
}

describe('ForgotPassword', () => {
  it('asks for an email and shows the neutral reply, sending no token', async () => {
    localStorage.setItem('token', 'should-not-be-sent')
    const fetchMock = stubRoutes({ 'POST /auth/password-reset/request': [202, { message: "If an account uses that email address, we've sent it a link." }] })
    renderPage(<ForgotPassword />)
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Email address'), 'a@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByText(/If an account uses that email address/)).toBeInTheDocument()
    const sent = body(fetchMock, '/auth/password-reset/request')
    expect(sent.json).toEqual({ email: 'a@example.com' })
    expect(sent.headers.Authorization).toBeUndefined()
  })

  it('says when email is off on the server', async () => {
    stubRoutes({ 'POST /auth/password-reset/request': [503, { detail: "Password reset by email isn't available on this server." }] })
    renderPage(<ForgotPassword />)
    await userEvent.type(screen.getByLabelText('Email address'), 'a@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("isn't available")
  })
})

describe('ResetPassword', () => {
  beforeEach(() => withFragment('#token=raw-token-123'))

  it('takes the token from the fragment and removes it from the address bar, even under StrictMode', async () => {
    const fetchMock = stubRoutes({ 'POST /auth/password-reset/confirm': [200, { message: 'Your password has been changed.' }] })
    renderPage(<ResetPassword />, { strict: true })
    expect(window.location.hash).toBe('')
    await userEvent.type(screen.getByLabelText('New password'), 'new-password-1')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'new-password-1')
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
    expect(await screen.findByText(/Your password has been changed. Other devices have been signed out./)).toBeInTheDocument()
    expect(body(fetchMock, '/auth/password-reset/confirm').json).toEqual({ token: 'raw-token-123', new_password: 'new-password-1' })
  })

  it('checks the new password before sending', async () => {
    const fetchMock = stubRoutes({})
    renderPage(<ResetPassword />)
    await userEvent.type(screen.getByLabelText('New password'), 'short')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('8 and 72 bytes')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows an expired or used link', async () => {
    stubRoutes({ 'POST /auth/password-reset/confirm': [400, { detail: 'This link is invalid, has expired or has already been used.' }] })
    renderPage(<ResetPassword />)
    await userEvent.type(screen.getByLabelText('New password'), 'new-password-1')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'new-password-1')
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('has expired')
  })

  it('without a token, points to a new link', () => {
    withFragment('')
    renderPage(<ResetPassword />)
    expect(screen.getByRole('link', { name: 'Ask for a new one.' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })
})

describe('VerifyEmail', () => {
  it('verifies once, even under StrictMode', async () => {
    withFragment('#token=verify-1')
    const fetchMock = stubRoutes({ 'POST /auth/verify-email': [200, { message: 'a@example.com is verified.' }] })
    renderPage(<VerifyEmail />, { strict: true })
    expect(await screen.findByText('a@example.com is verified.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(body(fetchMock, '/auth/verify-email').json).toEqual({ token: 'verify-1' })
    expect(window.location.hash).toBe('')
  })

  it('explains a bad link', async () => {
    withFragment('#token=old')
    stubRoutes({ 'POST /auth/verify-email': [400, { detail: 'This link is invalid.' }] })
    renderPage(<VerifyEmail />)
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is invalid. You can send a new link from Settings.')
  })

  it('needs a link', async () => {
    withFragment('')
    const fetchMock = stubRoutes({})
    renderPage(<VerifyEmail />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('needs the link'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('OAuthCallback', () => {
  const PENDING = 'nexus.oauth.pending'
  const NEW_TOKEN = fakeJwt({ sub: 'pat', exp: inOneHour() })
  const savePending = (extra = {}) => sessionStorage.setItem(PENDING, JSON.stringify({ provider: 'google', nonce: 'n'.repeat(43), verifier: 'v'.repeat(64), intent: 'login', returnTo: '/projects/7', startedAt: Date.now(), ...extra }))

  function Where() {
    const location = useLocation()
    return <p data-testid="where">{location.pathname} {location.state?.notice ?? ''}</p>
  }

  function renderCallback({ strict = true } = {}) {
    const tree = (
      <MemoryRouter initialEntries={['/oauth/callback']}>
        <AuthProvider>
          <Routes>
            <Route path="/oauth/callback" element={<OAuthCallback />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    )
    return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  }

  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    withFragment('#provider=google&code=the-code&state=the-state')
  })

  it('finishes with the stored secrets once, even under StrictMode, and signs in', async () => {
    savePending()
    const fetchMock = stubRoutes({
      'POST /auth/oauth/complete': [200, { status: 'created', access_token: NEW_TOKEN, token_type: 'bearer', username: 'pat' }],
      'GET /me': [200, { username: 'pat' }],
    })
    renderCallback()
    expect(window.location.hash).toBe('')
    expect(await screen.findByTestId('where')).toHaveTextContent('/projects/7')
    const completes = fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/auth/oauth/complete')
    expect(completes).toHaveLength(1)
    expect(JSON.parse(completes[0][1].body)).toEqual({ provider: 'google', code: 'the-code', state: 'the-state', nonce: 'n'.repeat(43), code_verifier: 'v'.repeat(64) })
    expect(completes[0][1].headers.Authorization).toBeUndefined()
    expect(localStorage.getItem('token')).toBe(NEW_TOKEN)
    expect(sessionStorage.getItem(PENDING)).toBeNull()
  })

  it('sends the session for a link, and goes back to Settings with a notice', async () => {
    localStorage.setItem('token', fakeJwt({ sub: 'alice', exp: inOneHour() }))
    savePending({ intent: 'link', returnTo: '/settings' })
    const fetchMock = stubRoutes({
      'POST /auth/oauth/complete': [200, { status: 'linked', provider: 'google', token_type: 'bearer' }],
      'GET /me': [200, { username: 'alice' }],
    })
    renderCallback()
    expect(await screen.findByTestId('where')).toHaveTextContent('/settings Google is now linked to your account.')
    const call = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === '/auth/oauth/complete')
    expect(call[1].headers.Authorization).toMatch(/^Bearer /)
  })

  it('asks for the existing account password instead of joining accounts', async () => {
    savePending()
    const fetchMock = stubRoutes({
      'POST /auth/oauth/complete': [200, { status: 'link_required', provider: 'google', username: 'owner', link_token: 'sealed-link' }],
      'POST /auth/oauth/link': [[400, { detail: 'That password is not correct.' }], [200, { status: 'linked', access_token: NEW_TOKEN, username: 'owner', provider: 'google' }]],
      'GET /me': [200, { username: 'owner' }],
    })
    renderCallback()
    expect(await screen.findByText(/already uses this email address/)).toHaveTextContent('owner')
    expect(localStorage.getItem('token')).toBeNull()
    await userEvent.type(screen.getByLabelText('Password for owner'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Link Google and sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not correct')
    await userEvent.clear(screen.getByLabelText('Password for owner'))
    await userEvent.type(screen.getByLabelText('Password for owner'), 'right-password')
    await userEvent.click(screen.getByRole('button', { name: 'Link Google and sign in' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/projects/7')
    const links = fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/auth/oauth/link')
    expect(JSON.parse(links[1][1].body)).toEqual({ link_token: 'sealed-link', password: 'right-password' })
    expect(localStorage.getItem('token')).toBe(NEW_TOKEN)
  })

  it('refuses a callback this tab did not start', async () => {
    const fetchMock = stubRoutes({})
    renderCallback()
    expect(await screen.findByRole('alert')).toHaveTextContent('started in another tab or has expired')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses secrets saved for another provider', async () => {
    savePending({ provider: 'github' })
    const fetchMock = stubRoutes({})
    renderCallback()
    expect(await screen.findByRole('alert')).toHaveTextContent('started in another tab')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['#provider=google&error=cancelled', 'was cancelled'],
    ['#provider=google&error=failed', "couldn't be completed"],
    ['', "couldn't be completed"],
  ])('shows problems from the provider (%s)', async (hash, text) => {
    savePending()
    withFragment(hash)
    stubRoutes({})
    renderCallback()
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })

  it('shows the server error', async () => {
    savePending()
    stubRoutes({ 'POST /auth/oauth/complete': [400, { detail: "Google's sign-in response couldn't be verified." }] })
    renderCallback()
    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't be verified")
    await waitFor(() => expect(localStorage.getItem('token')).toBeNull())
  })
})

describe('OAuthCallback for GitHub', () => {
  it('finishes a GitHub sign-in the same way', async () => {
    sessionStorage.setItem('nexus.oauth.pending', JSON.stringify({ provider: 'github', nonce: 'n'.repeat(43), verifier: 'v'.repeat(64), intent: 'login', returnTo: '/projects', startedAt: Date.now() }))
    window.history.replaceState(null, '', '/oauth/callback#provider=github&code=gh-code&state=gh-state')
    const fetchMock = stubRoutes({
      'POST /auth/oauth/complete': [200, { status: 'signed_in', access_token: fakeJwt({ sub: 'octo', exp: inOneHour() }), username: 'octo' }],
      'GET /me': [200, { username: 'octo' }],
    })
    render(
      <MemoryRouter initialEntries={['/oauth/callback']}>
        <AuthProvider>
          <Routes>
            <Route path="/oauth/callback" element={<OAuthCallback />} />
            <Route path="*" element={<p>landed</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    )
    expect(await screen.findByText('landed')).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === '/auth/oauth/complete')
    expect(JSON.parse(call[1].body)).toMatchObject({ provider: 'github', code: 'gh-code', state: 'gh-state' })
  })
})
