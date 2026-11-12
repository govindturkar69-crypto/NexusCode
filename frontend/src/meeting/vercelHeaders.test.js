import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

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
