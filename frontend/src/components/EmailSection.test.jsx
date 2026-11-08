import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmailSection from './EmailSection'
import { stubRoutes } from '../test/helpers'

const ON = { enabled: true, restricted: false, message: null }
const info = (overrides = {}) => ({ email: null, email_verified: false, has_password: true, sending: ON, ...overrides })

function setup(routes) {
  const fetchMock = stubRoutes(routes)
  render(<EmailSection />)
  return fetchMock
}

const sent = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.find(([url, init]) => new URL(url).pathname === path && init?.method === method)
  return call && JSON.parse(call[1].body)
}

describe('EmailSection', () => {
  it('invites an existing user to add an email', async () => {
    setup({ 'GET /me/email': [200, info()] })
    expect(await screen.findByText(/No email address yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add email' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send a test email' })).not.toBeInTheDocument()
  })

  it('shows the address and whether it is verified', async () => {
    setup({ 'GET /me/email': [200, info({ email: 'a@example.com', email_verified: false })] })
    expect(await screen.findByText('a@example.com')).toBeInTheDocument()
    expect(screen.getByText('not verified')).toBeInTheDocument()
  })

  it('adds an email with the password', async () => {
    const fetchMock = setup({
      'GET /me/email': [200, info()],
      'PUT /me/email': [200, info({ email: 'new@example.com' })],
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Add email' }))
    await userEvent.type(screen.getByLabelText('Email address'), 'New@Example.com')
    expect(screen.getByRole('button', { name: 'Save email' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Your password'), 'secret-pass')
    await userEvent.click(screen.getByRole('button', { name: 'Save email' }))
    expect(await screen.findByText('Saved new@example.com.')).toBeInTheDocument()
    expect(sent(fetchMock, 'PUT', '/me/email')).toEqual({ email: 'New@Example.com', current_password: 'secret-pass' })
  })

  it('does not ask for a password the account does not have', async () => {
    const fetchMock = setup({
      'GET /me/email': [200, info({ has_password: false })],
      'PUT /me/email': [200, info({ email: 'g@example.com', has_password: false })],
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Add email' }))
    expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Email address'), 'g@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Save email' }))
    await waitFor(() => expect(sent(fetchMock, 'PUT', '/me/email')).toEqual({ email: 'g@example.com' }))
  })

  it('shows errors such as an address in use', async () => {
    setup({
      'GET /me/email': [200, info()],
      'PUT /me/email': [409, { detail: 'That email address is already used by another account.' }],
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Add email' }))
    await userEvent.type(screen.getByLabelText('Email address'), 'a@example.com')
    await userEvent.type(screen.getByLabelText('Your password'), 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Save email' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already used')
  })

  it('says clearly when email is off on the server', async () => {
    setup({ 'GET /me/email': [200, info({ email: 'a@example.com', sending: { enabled: false, restricted: false, message: "Email isn't set up on this server." } })] })
    expect(await screen.findByText(/isn't set up on this server/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send a test email' })).not.toBeInTheDocument()
  })

  it('says clearly when sending is restricted', async () => {
    setup({ 'GET /me/email': [200, info({ email: 'a@example.com', sending: { enabled: true, restricted: true, message: "only the Resend account owner's address" } })] })
    expect(await screen.findByRole('note')).toHaveTextContent(/Sending is restricted: only the Resend account owner/)
  })

  it('sends a test email, and shows a restriction found by sending', async () => {
    setup({
      'GET /me/email': [
        [200, info({ email: 'a@example.com' })],
        [200, info({ email: 'a@example.com', sending: { enabled: true, restricted: true, message: 'verify a domain' } })],
      ],
      'POST /me/email/test': [400, { detail: 'Not sent. Email can only be delivered to the Resend account owner.' }],
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Send a test email' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not sent')
    expect(await screen.findByRole('note')).toHaveTextContent('verify a domain')
  })

  it('confirms a test email that went out', async () => {
    setup({
      'GET /me/email': [200, info({ email: 'a@example.com' })],
      'POST /me/email/test': [200, { message: 'Test email sent to a@example.com.' }],
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Send a test email' }))
    expect(await screen.findByText('Test email sent to a@example.com.')).toBeInTheDocument()
  })

  it('cancel leaves the address alone', async () => {
    const fetchMock = setup({ 'GET /me/email': [200, info({ email: 'a@example.com' })] })
    await userEvent.click(await screen.findByRole('button', { name: 'Change email' }))
    expect(screen.getByLabelText('Email address')).toHaveValue('a@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('a@example.com')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })
})
