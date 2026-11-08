import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { runJavaScript } from './runJavaScript'

class FakeWorker {
  static instances = []
  constructor(url, options) {
    this.url = String(url)
    this.options = options
    this.sent = []
    FakeWorker.instances.push(this)
  }
  postMessage(message) { this.sent.push(message) }
  terminate() {}
  receive(data) { this.onmessage?.({ data }) }
}

describe('runJavaScript', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('runs the editor\'s code in a data: URL worker, for its opaque origin', () => {
    runJavaScript({ code: '1', fileName: 'a.js' })
    const worker = FakeWorker.instances[0]
    expect(worker.url).toMatch(/^data:text\/javascript/)
    worker.receive({ type: 'ready' })
    expect(worker.sent).toEqual([{ code: '1', fileName: 'a.js' }])
  })

  it('runs the agent\'s code through agentJsWorker, the file with a strict CSP', () => {
    runJavaScript({ code: '1', fileName: 'a.js', offline: true })
    const worker = FakeWorker.instances[0]
    expect(worker.url).toContain('agentJsWorker')
    expect(worker.options).toEqual({ type: 'module' })
    worker.receive({ type: 'ready' })
    expect(worker.sent).toEqual([{ code: '1', fileName: 'a.js', offline: true }])
  })
})

// dynamic import() can't be stubbed, so only these headers stop it reaching the network
describe('agent worker CSP in vercel.json', () => {
  const rules = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf-8')).headers
  const policyFor = (name) =>
    rules.find(({ source }) => source === `/assets/${name}-(.*)`)?.headers.find(({ key }) => key === 'Content-Security-Policy')?.value

  it('covers both agent workers, by the names Vite gives their files', () => {
    for (const name of ['agentJsWorker', 'agentPythonWorker']) {
      readFileSync(new URL(`./${name}.js`, import.meta.url))
      expect(policyFor(name)).toMatch(/default-src 'none'/)
    }
  })

  it('lets no script in from another origin', () => {
    expect(policyFor('agentJsWorker')).toMatch(/script-src 'unsafe-eval';/)
    expect(policyFor('agentPythonWorker')).toMatch(/script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval';/)
    expect(policyFor('agentPythonWorker')).toMatch(/connect-src 'self'$/)
  })
})
