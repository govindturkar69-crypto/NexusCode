import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// The page that runs meetings is served by the catch-all rule. Paths are
// relative to the Vitest cwd (the frontend root).
const rules = JSON.parse(readFileSync('vercel.json', 'utf-8')).headers
const documentHeaders = Object.fromEntries(rules.find(({ source }) => source === '/(.*)').headers.map(({ key, value }) => [key, value]))

describe('vercel.json headers for video meetings', () => {
  it('lets this site, and only this site, use the camera, microphone and screen capture', () => {
    expect(documentHeaders['Permissions-Policy']).toBe('camera=(self), microphone=(self), display-capture=(self)')
  })

  it('puts no Content-Security-Policy on the app document, so LiveKit (wss, media, blob workers) is not blocked', () => {
    // CSPs exist only for the two agent worker bundles
    expect(documentHeaders['Content-Security-Policy']).toBeUndefined()
    const withCsp = rules.filter(({ headers }) => headers.some(({ key }) => key === 'Content-Security-Policy')).map(({ source }) => source)
    expect(withCsp).toEqual(['/assets/agentPythonWorker-(.*)', '/assets/agentJsWorker-(.*)'])
  })
})

describe('vercel.json caching', () => {
  const cacheFor = (source) => rules.find((r) => r.source === source)?.headers.find(({ key }) => key === 'Cache-Control')?.value

  it("caches Vite's content-hashed /assets files for a year", () => {
    expect(cacheFor('/assets/(.*)')).toBe('public, max-age=31536000, immutable')
  })

  it('never marks the app document immutable, so a deploy is picked up at once', () => {
    expect(cacheFor('/(.*)')).toBeUndefined()
  })
})

describe('vercel.json report-only Content-Security-Policy for the app document', () => {
  // Vercel matches "source" as a path-to-regexp pattern; these groups are plain JS regex
  const matching = (path) => rules.filter(({ source }) => new RegExp(`^${source}$`).test(path))
  const headersFor = (path) => Object.fromEntries(matching(path).flatMap((r) => r.headers).map(({ key, value }) => [key, value]))
  const policy = () => headersFor('/projects/1')['Content-Security-Policy-Report-Only']
  const directive = (name) => policy().split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? ''

  it('is sent on every app page, in report-only mode, and never enforced there', () => {
    for (const path of ['/', '/login', '/projects/1/editor', '/projects/1/meeting', '/admin']) {
      expect(headersFor(path)['Content-Security-Policy-Report-Only'], path).toBeDefined()
      expect(headersFor(path)['Content-Security-Policy'], path).toBeUndefined()
    }
  })

  it('is not sent on assets or Pyodide, so workers keep only their own policies', () => {
    for (const path of ['/assets/index-abc.js', '/assets/editor.worker-abc.js', '/pyodide/0.29.0/pyodide.mjs']) {
      expect(headersFor(path)['Content-Security-Policy-Report-Only'], path).toBeUndefined()
    }
  })

  it("allows index.html's inline theme script by hash, and no other inline or eval'd script", () => {
    const html = readFileSync('index.html', 'utf-8')
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    expect(inline).toHaveLength(1)
    const hash = `'sha256-${createHash('sha256').update(inline[0]).digest('base64')}'`
    // If this fails, index.html's inline script changed: update the hash in vercel.json
    expect(directive('script-src')).toBe(`script-src 'self' ${hash}`)
  })

  it('locks down plugins, base and framing, and only talks to the API, LiveKit and Sentry', () => {
    expect(directive('default-src')).toBe("default-src 'self'")
    expect(directive('object-src')).toBe("object-src 'none'")
    expect(directive('base-uri')).toBe("base-uri 'self'")
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive('connect-src').split(' ').slice(1).sort()).toEqual([
      "'self'",
      'https://*.livekit.cloud',
      'https://*.sentry.io',
      'https://nexuscode-backend-wbt4.onrender.com',
      'wss://*.livekit.cloud',
      'wss://nexuscode-backend-wbt4.onrender.com',
    ])
  })
})
