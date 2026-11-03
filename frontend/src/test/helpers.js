import { vi } from 'vitest'

// Minimal fetch Response stand-in
export function jsonResponse(status, body) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    json: () => (body === undefined ? Promise.reject(new SyntaxError('no body')) : Promise.resolve(body)),
  })
}

// Stubs global fetch with a list of responses, returned in order
export function stubFetch(...responses) {
  const queue = [...responses]
  const fetchMock = vi.fn(() => {
    const next = queue.shift()
    if (!next) throw new Error('Unexpected fetch call')
    return typeof next === 'function' ? next() : jsonResponse(next[0], next[1])
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// Stubs fetch by "METHOD path" (path without the API base and query string),
// so tests don't depend on which effect fires first. Values are
// [status, body] or a list of them, consumed in order for that route.
export function stubRoutes(routes) {
  const queues = Object.fromEntries(
    Object.entries(routes).map(([key, value]) => [key, Array.isArray(value[0]) ? [...value] : [value]])
  )
  const fetchMock = vi.fn((url, init = {}) => {
    const path = new URL(url).pathname
    const key = `${init.method ?? 'GET'} ${path}`
    const queue = queues[key]
    if (!queue || queue.length === 0) throw new Error(`Unexpected fetch: ${key}`)
    const [status, body] = queue.length > 1 ? queue.shift() : queue[0]
    return jsonResponse(status, body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// A JWT-shaped token whose payload decodes in the browser (signature is not checked client-side)
export function fakeJwt(payload) {
  const encode = (obj) => btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

export const inOneHour = () => Math.floor(Date.now() / 1000) + 3600
