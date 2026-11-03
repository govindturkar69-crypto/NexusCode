import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiFetch, apiFetchAll, ApiError, clearToken, getToken, hasValidToken, setToken, socketUrl, wsUrl } from './client'
import { fakeJwt, inOneHour, stubFetch } from '../test/helpers'

describe('token helpers', () => {
  it('stores, reads and clears the token', () => {
    setToken('abc')
    expect(getToken()).toBe('abc')
    clearToken()
    expect(getToken()).toBeNull()
  })

  it('hasValidToken checks presence, shape and expiry', () => {
    expect(hasValidToken()).toBe(false)
    setToken('garbage')
    expect(hasValidToken()).toBe(false)
    setToken(fakeJwt({ sub: 'alice', exp: Math.floor(Date.now() / 1000) - 10 }))
    expect(hasValidToken()).toBe(false)
    setToken(fakeJwt({ sub: 'alice', exp: inOneHour() }))
    expect(hasValidToken()).toBe(true)
  })
})

describe('apiFetch', () => {
  let replace

  beforeEach(() => {
    replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, pathname: '/projects', replace })
  })

  it('prefixes the API URL and attaches the bearer token', async () => {
    setToken('tok')
    const fetchMock = stubFetch([200, { projects: [] }])
    await expect(apiFetch('/projects')).resolves.toEqual({ projects: [] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api.test/projects')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('sends JSON bodies with a content type', async () => {
    const fetchMock = stubFetch([201, { ok: true }])
    await apiFetch('/projects', { method: 'POST', body: { name: 'x' } })
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"name":"x"}')
  })

  it('sends form bodies as-is and skips the token when auth is false', async () => {
    setToken('tok')
    const fetchMock = stubFetch([200, { access_token: 't' }])
    const form = new URLSearchParams({ username: 'a' })
    await apiFetch('/login', { method: 'POST', form, auth: false })
    const init = fetchMock.mock.calls[0][1]
    expect(init.body).toBe(form)
    expect(init.headers.Authorization).toBeUndefined()
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('returns null for 204 responses', async () => {
    stubFetch([204])
    await expect(apiFetch('/files/1', { method: 'DELETE' })).resolves.toBeNull()
  })

  it('throws ApiError with the server detail string', async () => {
    stubFetch([409, { detail: 'Username already taken' }])
    const error = await apiFetch('/signup', { method: 'POST', body: {}, auth: false }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(409)
    expect(error.message).toBe('Username already taken')
  })

  it('joins FastAPI validation messages', async () => {
    stubFetch([422, { detail: [{ msg: 'Username bad' }, { msg: 'Password bad' }] }])
    await expect(apiFetch('/signup')).rejects.toThrow('Username bad; Password bad')
  })

  it('falls back to a generic message when the body is not JSON', async () => {
    stubFetch([500, undefined])
    await expect(apiFetch('/x')).rejects.toThrow('Request failed (500)')
  })

  it('reports network failures in plain language', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const error = await apiFetch('/x').catch((e) => e)
    expect(error.status).toBe(0)
    expect(error.message).toMatch(/Can't reach the server/)
  })

  it('rethrows aborts untouched', async () => {
    const abort = new DOMException('aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(abort)))
    await expect(apiFetch('/x')).rejects.toBe(abort)
  })

  it('on 401 clears the token and redirects to /login', async () => {
    setToken('expired')
    stubFetch([401, { detail: 'Invalid or expired token' }])
    const error = await apiFetch('/projects').catch((e) => e)
    expect(error.status).toBe(401)
    expect(getToken()).toBeNull()
    expect(replace).toHaveBeenCalledWith('/login')
  })

  it('does not redirect on 401 for unauthenticated calls (wrong password)', async () => {
    stubFetch([401, { detail: 'Incorrect username or password' }])
    await expect(apiFetch('/login', { method: 'POST', auth: false })).rejects.toThrow('Incorrect username or password')
    expect(replace).not.toHaveBeenCalled()
  })

  it('does not redirect again when already on /login', async () => {
    vi.stubGlobal('location', { ...window.location, pathname: '/login', replace })
    setToken('expired')
    stubFetch([401, {}])
    await apiFetch('/me').catch(() => {})
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('apiFetchAll', () => {
  it('walks every page until the total is reached', async () => {
    const fetchMock = stubFetch(
      [200, { tasks: [1, 2], total: 5, limit: 2, offset: 0 }],
      [200, { tasks: [3, 4], total: 5, limit: 2, offset: 2 }],
      [200, { tasks: [5], total: 5, limit: 2, offset: 4 }],
    )
    await expect(apiFetchAll('/projects/1/tasks', 'tasks', { pageSize: 2 })).resolves.toEqual([1, 2, 3, 4, 5])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://api.test/projects/1/tasks?limit=2&offset=0',
      'http://api.test/projects/1/tasks?limit=2&offset=2',
      'http://api.test/projects/1/tasks?limit=2&offset=4',
    ])
  })

  it('uses one request for small lists and appends to existing query strings', async () => {
    const fetchMock = stubFetch([200, { users: [{ id: 1 }], total: 1 }])
    await expect(apiFetchAll('/admin/users?x=1', 'users')).resolves.toEqual([{ id: 1 }])
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/admin/users?x=1&limit=200&offset=0')
  })

  it('stops on an empty page even if total is stale', async () => {
    stubFetch([200, { files: [1], total: 9 }], [200, { files: [], total: 9 }])
    await expect(apiFetchAll('/f', 'files', { pageSize: 1 })).resolves.toEqual([1])
  })
})

describe('wsUrl / socketUrl', () => {
  it('switches the scheme and appends the encoded ticket, never the login token', () => {
    setToken('login-token')
    const url = wsUrl('/ws/projects/1/chat', 'a.b+c')
    expect(url).toBe('ws://api.test/ws/projects/1/chat?ticket=a.b%2Bc')
    expect(url).not.toContain('login-token')
  })

  it('socketUrl trades the login token for a ticket for that project', async () => {
    setToken('login-token')
    const fetchMock = stubFetch([200, { ticket: 'tkt', expires_in: 30 }])
    await expect(socketUrl('/ws/projects/7/meeting', '7')).resolves.toBe('ws://api.test/ws/projects/7/meeting?ticket=tkt')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api.test/ws-ticket')
    expect(JSON.parse(init.body)).toEqual({ project_id: 7 })
    expect(init.headers.Authorization).toBe('Bearer login-token')
  })
})
