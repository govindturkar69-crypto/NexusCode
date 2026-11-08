import { StrictMode } from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ForgotPassword, ResetPassword, VerifyEmail } from './AccountPages'
import { stubRoutes } from '../test/helpers'

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
