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

// A JWT-shaped token whose payload decodes in the browser (signature is not checked client-side)
export function fakeJwt(payload) {
  const encode = (obj) => btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

export const inOneHour = () => Math.floor(Date.now() / 1000) + 3600
