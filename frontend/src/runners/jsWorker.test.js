import { describe, it, expect } from 'vitest'
import { workerMain, workerSource } from './jsWorker'

// Runs the real worker code against a stand-in for the worker's global scope.
// Isolation itself can only be tested in a real browser, where it was checked.
function boot(maxChars = 1000) {
  const messages = []
  const listeners = {}
  const scope = {
    postMessage: (message) => messages.push(message),
    addEventListener: (name, fn) => { listeners[name] = fn },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    fetch: () => Promise.resolve('fetched'),
  }
  // Same names as in a worker, so the source runs unchanged
  const run = new Function('self', 'performance', `(${workerMain.toString()})(${maxChars});`)
  run(scope, globalThis.performance)
  return { scope, messages, listeners }
}

const output = (messages, stream) => messages.filter((m) => m.type === 'output' && (!stream || m.stream === stream)).map((m) => m.text).join('')
const done = (messages) => messages.find((m) => m.type === 'done')

async function execute(code, { maxChars, fileName = 'test.js', wait = 30 } = {}) {
  const context = boot(maxChars)
  // User code sees console, setTimeout etc. through the patched scope
  const scoped = `const {console, setTimeout, clearTimeout, setInterval, clearInterval, fetch} = globalThis.__scope;\n${code}`
  globalThis.__scope = context.scope
  try {
    await context.scope.onmessage({ data: { code: scoped, fileName } })
    await new Promise((resolve) => setTimeout(resolve, wait))
  } finally {
    delete globalThis.__scope
  }
  return context
}

describe('jsWorker', () => {
  it('announces it is ready, and hides postMessage from user code', () => {
    const { scope, messages } = boot()
    expect(messages).toEqual([{ type: 'ready' }])
    expect(scope.postMessage).toBeUndefined()
  })

  it('builds a source that passes the cap in', () => {
    expect(workerSource(5000)).toMatch(/\)\(5000\);$/)
  })

  describe('console', () => {
    it('log, info and debug go to stdout; warn and error to stderr', async () => {
      const { messages } = await execute('console.log("l"); console.info("i"); console.debug("d"); console.warn("w"); console.error("e")')
      expect(output(messages, 'stdout')).toBe('l\ni\nd\n')
      expect(output(messages, 'stderr')).toBe('w\ne\n')
    })

    it.each([
      ['"text"', 'text'],
      ['1, true, null, undefined', '1 true null undefined'],
      ['{a: 1, b: "x"}', '{ a: 1, b: "x" }'],
      ['[1, [2, 3]]', '[ 1, [ 2, 3 ] ]'],
      ['new Map([["k", 1]])', 'Map(1) { "k" => 1 }'],
      ['new Set([1])', 'Set(1) { 1 }'],
      ['function named() {}', '[Function: named]'],
      ['10n', '10n'],
      ['/x/g', '/x/g'],
      ['{}', '{}'],
    ])('formats %s', async (args, expected) => {
      const { messages } = await execute(`console.log(${args})`)
      expect(output(messages)).toBe(`${expected}\n`)
    })

    it('handles circular references', async () => {
      const { messages } = await execute('const a = {}; a.self = a; console.log(a)')
      expect(output(messages)).toContain('[Circular]')
    })

    it('stops at a sensible depth', async () => {
      const { messages } = await execute('console.log({a:{b:{c:{d:{e:{f:1}}}}}})')
      expect(output(messages)).toContain('[Object]')
    })

    it('supports group, count, assert and time', async () => {
      const { messages } = await execute('console.group("g"); console.log("in"); console.groupEnd(); console.log("out"); console.count(); console.count(); console.assert(false, "bad"); console.time("t"); console.timeEnd("t")')
      const text = output(messages, 'stdout')
      expect(text).toContain('g\n  in\nout\n')
      expect(text).toContain('default: 2')
      expect(text).toMatch(/t: [\d.]+ms/)
      expect(output(messages, 'stderr')).toContain('Assertion failed: bad')
    })
  })

  describe('finishing', () => {
    it('reports success', async () => {
      const { messages } = await execute('console.log(1)')
      expect(done(messages)).toEqual({ type: 'done', ok: true })
      expect(messages[1]).toEqual({ type: 'started' })
    })

    it('supports top-level await', async () => {
      const { messages } = await execute('const v = await Promise.resolve(7); console.log(v)')
      expect(output(messages)).toBe('7\n')
      expect(done(messages).ok).toBe(true)
    })

    it('waits for timers before finishing', async () => {
      const context = await execute('setTimeout(() => console.log("later"), 20); console.log("first")', { wait: 0 })
      expect(done(context.messages)).toBeUndefined()
      await new Promise((resolve) => setTimeout(resolve, 60))
      expect(output(context.messages)).toBe('first\nlater\n')
      expect(done(context.messages).ok).toBe(true)
    })

    it('a cleared timer does not hold the run open', async () => {
      const { messages } = await execute('const t = setTimeout(() => {}, 100000); clearTimeout(t)')
      expect(done(messages).ok).toBe(true)
    })

    it('an interval holds the run open until cleared', async () => {
      const held = await execute('const i = setInterval(() => {}, 5); globalThis.__i = i', { wait: 30 })
      expect(done(held.messages)).toBeUndefined()
      held.scope.clearInterval(globalThis.__i)
      delete globalThis.__i
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(done(held.messages).ok).toBe(true)
    })

    it('waits for fetch too', async () => {
      const { messages } = await execute('fetch("x").then((r) => console.log(r))')
      expect(output(messages)).toBe('fetched\n')
      expect(done(messages).ok).toBe(true)
    })
  })

  describe('errors', () => {
    it('reports a thrown error as a failed run', async () => {
      const { messages } = await execute('console.log("before"); throw new TypeError("went wrong")')
      expect(output(messages, 'stdout')).toBe('before\n')
      expect(output(messages, 'stderr')).toContain('TypeError: went wrong')
      expect(done(messages).ok).toBe(false)
    })

    it('reports a syntax error', async () => {
      const { messages } = await execute('this is not javascript')
      expect(output(messages, 'stderr')).toContain('SyntaxError')
      expect(done(messages).ok).toBe(false)
    })

    it('explains import statements', async () => {
      const { messages } = await execute('import x from "y"')
      expect(output(messages, 'stderr')).toContain("import and export aren't available")
    })

    it('reports a thrown non-error', async () => {
      const { messages } = await execute('throw "plain"')
      expect(output(messages, 'stderr')).toContain('Uncaught "plain"')
    })

    it('reports errors from timers and rejected promises through the listeners', async () => {
      const { listeners, messages } = boot()
      listeners.error({ preventDefault() {}, error: new Error('from a timer') })
      listeners.unhandledrejection({ preventDefault() {}, reason: new Error('from a promise') })
      const text = output(messages, 'stderr')
      expect(text).toContain('from a timer')
      expect(text).toContain('from a promise')
    })
  })

  describe('output cap', () => {
    it('stops sending at the cap and says so, once', async () => {
      const { messages } = await execute('for (let i = 0; i < 1000; i++) console.log("0123456789")', { maxChars: 50 })
      expect(output(messages)).toHaveLength(50)
      expect(messages.filter((m) => m.type === 'truncated')).toHaveLength(1)
    })
  })
})
