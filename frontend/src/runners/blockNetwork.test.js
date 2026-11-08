import { describe, it, expect, vi } from 'vitest'
import { blockNetwork } from './blockNetwork'
import { workerSource } from './jsWorker'

// A stand-in for a worker's global object, with fetch on a prototype as in browsers
function workerScope() {
  const base = { fetch: vi.fn(async () => 'response'), importScripts: vi.fn() }
  const scope = Object.create(base)
  scope.XMLHttpRequest = vi.fn()
  scope.WebSocket = vi.fn()
  return { base, scope }
}

describe('blockNetwork', () => {
  it('turns off fetch, XHR, sockets, importScripts and nested workers', async () => {
    const { scope } = workerScope()
    blockNetwork(scope)
    await expect(scope.fetch('https://evil.test')).rejects.toThrow('network access is turned off')
    expect(() => new scope.XMLHttpRequest()).toThrow('network access is turned off')
    expect(() => new scope.WebSocket('wss://evil.test')).toThrow('network access is turned off')
    expect(() => scope.importScripts('https://evil.test/x.js')).toThrow('network access is turned off')
    expect(() => new scope.Worker('x.js')).toThrow('network access is turned off')
    expect(() => new scope.EventSource('https://evil.test')).toThrow('network access is turned off')
  })

  it('also replaces the originals on the prototype, so they can not be reached that way', async () => {
    const { base, scope } = workerScope()
    const original = base.fetch
    blockNetwork(scope)
    await expect(Object.getPrototypeOf(scope).fetch.call(scope, 'https://evil.test')).rejects.toThrow()
    expect(original).not.toHaveBeenCalled()
  })

  it('can not be undone by the code', async () => {
    const { scope } = workerScope()
    blockNetwork(scope)
    expect(() => {
      'use strict'
      Object.defineProperty(scope, 'fetch', { value: async () => 'sneaky' })
    }).toThrow()
    expect(() => {
      scope.fetch = async () => 'sneaky'
    }).toThrow(TypeError)
    expect(() => delete scope.fetch).toThrow(TypeError)
    await expect(scope.fetch('https://evil.test')).rejects.toThrow()
  })

  it('is part of the JavaScript worker source, which must be self-contained', () => {
    const source = workerSource(1000)
    expect(source).toContain('network access is turned off')
    // The whole worker source evaluates on its own (it isn't run here, only parsed)
    expect(() => new Function(source)).not.toThrow()
  })
})
