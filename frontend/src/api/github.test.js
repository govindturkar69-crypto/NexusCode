import { describe, it, expect, vi, beforeEach } from 'vitest'
import { completeGithubLink, startGithubLink, takePendingLink } from './github'
import { stubFetch } from '../test/helpers'

describe('GitHub linking', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('start stores a fresh nonce in this tab and sends it, then navigates to GitHub', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const fetchMock = stubFetch([200, { url: 'https://github.com/login/oauth/authorize?state=s' }])

    await startGithubLink()

    const nonce = sessionStorage.getItem('github_oauth_nonce')
    expect(nonce).toMatch(/^[0-9a-f]{48}$/)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api.test/auth/github/start')
    expect(JSON.parse(init.body)).toEqual({ nonce })
    expect(assign).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?state=s')
  })

  it('takePendingLink reads the fragment once and clears it from the address bar', () => {
    window.history.replaceState(null, '', '/projects#github_pending=abc123')
    expect(takePendingLink()).toBe('abc123')
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/projects')
    expect(takePendingLink()).toBeNull()
  })

  it('complete sends the pending blob with this tab nonce and forgets the nonce', async () => {
    sessionStorage.setItem('github_oauth_nonce', 'n'.repeat(48))
    const fetchMock = stubFetch([200, { connected: true }])
    await completeGithubLink('blob')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ pending: 'blob', nonce: 'n'.repeat(48) })
    expect(sessionStorage.getItem('github_oauth_nonce')).toBeNull()
  })

  it('complete refuses without a nonce from this tab and never calls the API', async () => {
    const fetchMock = stubFetch()
    await expect(completeGithubLink('blob')).rejects.toThrow("wasn't started in this browser tab")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('complete surfaces the server rejection', async () => {
    sessionStorage.setItem('github_oauth_nonce', 'n'.repeat(48))
    stubFetch([400, { detail: 'GitHub connection could not be verified. Please try connecting again.' }])
    await expect(completeGithubLink('blob')).rejects.toThrow('could not be verified')
  })
})
