import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { forgetPythonWorker, runPython } from './runPython'

class FakeWorker {
  static instances = []
  constructor(url, options) {
    this.url = String(url)
    this.options = options
    this.sent = []
    this.terminated = false
    FakeWorker.instances.push(this)
  }
  postMessage(message) { this.sent.push(message) }
  terminate() { this.terminated = true }
  receive(data) { this.onmessage?.({ data }) }
}

const REQUEST = { code: 'print(1)', fileName: 'a.py', stdin: 'x', onOutput: () => {}, onProgress: () => {} }

describe('runPython', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
    forgetPythonWorker()
  })
  afterEach(() => vi.useRealTimers())

  it('starts no worker until it is called, which is what keeps Pyodide lazy', () => {
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it('uses a module worker and sends the code, name and input once ready', () => {
    runPython(REQUEST)
    const worker = FakeWorker.instances[0]
    expect(worker.url).toContain('pythonWorker')
    expect(worker.options).toEqual({ type: 'module' })
    expect(worker.sent).toEqual([])
    worker.receive({ type: 'ready' })
    expect(worker.sent).toEqual([{ code: 'print(1)', fileName: 'a.py', stdin: 'x' }])
  })

  it('sends project files for imports when given, and only then', () => {
    const files = [{ path: 'main.py', content: 'import lib' }, { path: 'lib.py', content: 'x = 1' }]
    runPython({ ...REQUEST, files, path: 'main.py' })
    FakeWorker.instances[0].receive({ type: 'ready' })
    expect(FakeWorker.instances[0].sent).toEqual([{ code: 'print(1)', fileName: 'a.py', stdin: 'x', files, path: 'main.py' }])
  })

  it('agent runs say offline, and never share a worker with the editor', async () => {
    const agentRun = runPython({ ...REQUEST, offline: true })
    const agentWorker = FakeWorker.instances[0]
    // Its own file, which vercel.json gives a strict Content-Security-Policy
    expect(agentWorker.url).toContain('agentPythonWorker')
    expect(agentWorker.options).toEqual({ type: 'module' })
    agentWorker.receive({ type: 'ready' })
    expect(agentWorker.sent).toEqual([{ code: 'print(1)', fileName: 'a.py', stdin: 'x', offline: true }])
    agentWorker.receive({ type: 'started' })
    agentWorker.receive({ type: 'done', ok: true })
    await agentRun.result
    await Promise.resolve()
    // The editor gets a fresh worker, not the one whose network is off
    runPython(REQUEST)
    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[1].url).not.toContain('agent')
    // The next agent run reuses the offline one
    runPython({ ...REQUEST, offline: true })
    expect(FakeWorker.instances).toHaveLength(2)
  })

  it('reports download progress', () => {
    const onProgress = vi.fn()
    runPython({ ...REQUEST, onProgress })
    FakeWorker.instances[0].receive({ type: 'progress', stage: 'download', received: 5, total: 10 })
    expect(onProgress).toHaveBeenCalledWith({ type: 'progress', stage: 'download', received: 5, total: 10 })
  })

  async function finish(worker, message = { type: 'done', ok: true }, handle) {
    worker.receive({ type: 'ready' })
    worker.receive({ type: 'started' })
    worker.receive(message)
    await handle.result
    await Promise.resolve()
  }

  it('keeps the worker after a normal finish, and reuses it', async () => {
    const first = runPython(REQUEST)
    await finish(FakeWorker.instances[0], undefined, first)
    expect(FakeWorker.instances[0].terminated).toBe(false)

    runPython({ ...REQUEST, code: 'print(2)' })
    expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.instances[0].sent[1].code).toBe('print(2)')
  })

  it('keeps it after the code fails too: Python itself is fine', async () => {
    const first = runPython(REQUEST)
    await finish(FakeWorker.instances[0], { type: 'done', ok: false }, first)
    expect(FakeWorker.instances[0].terminated).toBe(false)
  })

  it('terminates on a timeout, and the next run gets a new worker', async () => {
    vi.useFakeTimers()
    const first = runPython(REQUEST)
    const worker = FakeWorker.instances[0]
    worker.receive({ type: 'ready' })
    worker.receive({ type: 'started' })
    vi.advanceTimersByTime(10_000)
    expect((await first.result).status).toBe('timeout')
    expect(worker.terminated).toBe(true)
    runPython(REQUEST)
    expect(FakeWorker.instances).toHaveLength(2)
  })

  it('a load failure is not kept, so the next run tries again', async () => {
    const first = runPython(REQUEST)
    const worker = FakeWorker.instances[0]
    worker.receive({ type: 'fatal', text: "Python couldn't be loaded." })
    expect((await first.result).status).toBe('crashed')
    await Promise.resolve()
    expect(worker.terminated).toBe(true)
    runPython(REQUEST)
    expect(FakeWorker.instances).toHaveLength(2)
  })

  it('terminates on Stop', async () => {
    const first = runPython(REQUEST)
    const worker = FakeWorker.instances[0]
    worker.receive({ type: 'ready' })
    first.stop()
    await first.result
    expect(worker.terminated).toBe(true)
    runPython(REQUEST)
    expect(FakeWorker.instances).toHaveLength(2)
  })

  it('terminates when output hits the cap', async () => {
    const first = runPython(REQUEST)
    const worker = FakeWorker.instances[0]
    worker.receive({ type: 'ready' })
    worker.receive({ type: 'started' })
    worker.receive({ type: 'truncated' })
    expect((await first.result).status).toBe('output-limit')
    expect(worker.terminated).toBe(true)
  })

  it('a reused worker that has died still hits the timeout', async () => {
    vi.useFakeTimers()
    const first = runPython(REQUEST)
    const worker = FakeWorker.instances[0]
    worker.receive({ type: 'ready' })
    worker.receive({ type: 'started' })
    worker.receive({ type: 'done', ok: true })
    await first.result
    await Promise.resolve()
    const second = runPython(REQUEST)
    // It never answers
    vi.advanceTimersByTime(10_000)
    expect((await second.result).status).toBe('timeout')
  })
})
