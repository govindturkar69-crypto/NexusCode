import { createHash } from 'node:crypto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { peekPendingOAuth, pkceChallenge, startOAuth, takePendingOAuth } from './oauth'
import { stubRoutes } from '../test/helpers'

const KEY = 'nexus.oauth.pending'

describe('pkceChallenge', () => {
  it('is the base64url SHA-256 of the verifier (RFC 7636 S256)', async () => {
    const verifier = 'dBjftJeZ4CVP-mJ92K1JjEI6g6I9Yb2vA6I8eAPHBA8'
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(await pkceChallenge(verifier)).toBe(expected)
  })
})

describe('startOAuth', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.setItem('token', 'session-token')
  })

  it('keeps the nonce and verifier in this tab and sends only the challenge', async () => {
    const assign = vi.fn()
    const fetchMock = stubRoutes({ 'POST /auth/oauth/google/start': [200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }] })
    await startOAuth('google', { returnTo: '/projects/3', go: assign })
    const pending = JSON.parse(sessionStorage.getItem(KEY))
    const [, init] = fetchMock.mock.calls[0]
    const sent = JSON.parse(init.body)
    expect(sent).toEqual({ nonce: pending.nonce, code_challenge: await pkceChallenge(pending.verifier), intent: 'login' })
    expect(init.body).not.toContain(pending.verifier)
    expect(pending.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(pending.nonce.length).toBeGreaterThanOrEqual(32)
    expect(pending.returnTo).toBe('/projects/3')
    // Signing in sends no session; linking does
    expect(init.headers.Authorization).toBeUndefined()
    expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1')
  })

  it('sends the session when linking', async () => {
    const fetchMock = stubRoutes({ 'POST /auth/oauth/google/start': [200, { url: 'https://accounts.google.com/x' }] })
    await startOAuth('google', { intent: 'link', returnTo: '/settings', go: vi.fn() })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer session-token')
  })

  it('makes new secrets every time', async () => {
    stubRoutes({ 'POST /auth/oauth/google/start': [200, { url: 'https://accounts.google.com/x' }] })
    await startOAuth('google', { go: vi.fn() })
    const first = sessionStorage.getItem(KEY)
    await startOAuth('google', { go: vi.fn() })
    expect(sessionStorage.getItem(KEY)).not.toBe(first)
  })
})

describe('takePendingOAuth', () => {
  const save = (extra = {}) => sessionStorage.setItem(KEY, JSON.stringify({ provider: 'google', nonce: 'n'.repeat(43), verifier: 'v'.repeat(64), intent: 'login', returnTo: '/projects', startedAt: Date.now(), ...extra }))

  beforeEach(() => sessionStorage.clear())

  it('works once', () => {
    save()
    expect(peekPendingOAuth('google')).not.toBeNull()
    expect(takePendingOAuth('google').nonce).toBe('n'.repeat(43))
    expect(takePendingOAuth('google')).toBeNull()
  })

  it('ignores another provider, old sign-ins and junk', () => {
    save()
    expect(takePendingOAuth('github')).toBeNull()
    save({ startedAt: Date.now() - 11 * 60 * 1000 })
    expect(takePendingOAuth('google')).toBeNull()
    sessionStorage.setItem(KEY, '{not json')
    expect(takePendingOAuth('google')).toBeNull()
  })

  it('only returns to pages inside the app', () => {
    for (const returnTo of ['https://evil.test', '//evil.test', 'javascript:alert(1)']) {
      save({ returnTo })
      expect(takePendingOAuth('google').returnTo).toBe('/projects')
    }
  })
})
