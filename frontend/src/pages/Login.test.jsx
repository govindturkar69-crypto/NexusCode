import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import Login from './Login'
import AuthProvider from '../auth/AuthProvider'
import ProtectedRoute from '../components/ProtectedRoute'
import { useAuth } from '../auth/useAuth'
import { fakeJwt, inOneHour, stubFetch } from '../test/helpers'

function WhereAmI() {
  const location = useLocation()
  const { user } = useAuth()
  return (
    <div>
      <p data-testid="path">{location.pathname}</p>
      <p data-testid="user">{user?.username ?? ''}</p>
    </div>
  )
}

function renderApp(initialPath = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/projects" element={<ProtectedRoute><WhereAmI /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><WhereAmI /></ProtectedRoute>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
}

const token = () => fakeJwt({ sub: 'alice', exp: inOneHour() })

async function fillSignIn(user, username, password) {
  await user.type(screen.getByLabelText('Username'), username)
  await user.type(screen.getByLabelText('Password'), password)
}

describe('sign in', () => {
  it('logs in, stores the token, loads /me and goes to /projects', async () => {
    const fetchMock = stubFetch([200, { access_token: token(), token_type: 'bearer' }], [200, { id: 1, username: 'alice', is_admin: false }])
    const user = userEvent.setup()
    renderApp()
    await fillSignIn(user, 'alice', 'correct-horse-1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByTestId('path')).toHaveTextContent('/projects')
    expect(await screen.findByTestId('user')).toHaveTextContent('alice')
    expect(localStorage.getItem('token')).toBeTruthy()
    const [loginUrl, loginInit] = fetchMock.mock.calls[0]
    expect(loginUrl).toBe('http://api.test/login')
    expect(loginInit.body.toString()).toBe('username=alice&password=correct-horse-1')
  })

  it('shows a friendly message on wrong credentials and stays put', async () => {
    stubFetch([401, { detail: 'Incorrect username or password' }])
    const user = userEvent.setup()
    renderApp()
    await fillSignIn(user, 'alice', 'nope-nope-1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password')
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('shows server/network errors as-is', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const user = userEvent.setup()
    renderApp()
    await fillSignIn(user, 'alice', 'whatever-1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server")
  })

  it('returns to the page the user originally asked for', async () => {
    stubFetch([200, { access_token: token() }], [200, { id: 1, username: 'alice' }])
    const user = userEvent.setup()
    renderApp('/dashboard')
    // ProtectedRoute bounced us to the login form
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    await fillSignIn(user, 'alice', 'correct-horse-1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByTestId('path')).toHaveTextContent('/dashboard')
  })
})

describe('protected routes', () => {
  it('redirect to /login without a token', () => {
    renderApp('/projects')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('redirect to /login with an expired token and clear it', () => {
    localStorage.setItem('token', fakeJwt({ sub: 'alice', exp: 1 }))
    renderApp('/projects')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('render the page with a valid token', async () => {
    localStorage.setItem('token', token())
    stubFetch([200, { id: 1, username: 'alice' }])
    renderApp('/projects')
    expect(screen.getByTestId('path')).toHaveTextContent('/projects')
    expect(await screen.findByTestId('user')).toHaveTextContent('alice')
  })
})

describe('create account', () => {
  async function openSignup(user) {
    renderApp()
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
  }

  async function fillSignup(user, username, password, confirm = password) {
    await user.type(screen.getByLabelText('Username'), username)
    await user.type(screen.getByLabelText('Password'), password)
    await user.type(screen.getByLabelText('Confirm password'), confirm)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
  }

  it.each([
    ['Alice', 'correct-horse-1', 'correct-horse-1', 'Username must be 3-30 characters'],
    ['al', 'correct-horse-1', 'correct-horse-1', 'Username must be 3-30 characters'],
    ['alice', 'short', 'short', 'Password must be between 8 and 72 bytes'],
    ['alice', '€'.repeat(25), '€'.repeat(25), 'Password must be between 8 and 72 bytes'],
    ['alice', 'correct-horse-1', 'correct-horse-2', "Passwords don't match"],
  ])('validates %s / %s before calling the API', async (username, password, confirm, message) => {
    const fetchMock = stubFetch()
    const user = userEvent.setup()
    await openSignup(user)
    await fillSignup(user, username, password, confirm)
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates the account, then signs straight in', async () => {
    const fetchMock = stubFetch(
      [201, { message: 'User created successfully', username: 'new_user' }],
      [200, { access_token: token() }],
      [200, { id: 2, username: 'new_user' }],
    )
    const user = userEvent.setup()
    await openSignup(user)
    await fillSignup(user, 'new_user', 'correct-horse-1')

    expect(await screen.findByTestId('path')).toHaveTextContent('/projects')
    const [signupUrl, signupInit] = fetchMock.mock.calls[0]
    expect(signupUrl).toBe('http://api.test/signup')
    expect(JSON.parse(signupInit.body)).toEqual({ username: 'new_user', password: 'correct-horse-1' })
    expect(fetchMock.mock.calls[1][0]).toBe('http://api.test/login')
  })

  it('shows the 409 message for a taken username', async () => {
    stubFetch([409, { detail: 'Username already taken' }])
    const user = userEvent.setup()
    await openSignup(user)
    await fillSignup(user, 'alice', 'correct-horse-1')
    expect(await screen.findByRole('alert')).toHaveTextContent('Username already taken')
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('can switch back to sign in', async () => {
    const user = userEvent.setup()
    await openSignup(user)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument()
  })
})
