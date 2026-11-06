import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { appendOutput, RUN_TIMEOUT_MS, startRun } from './runController'

class FakeWorker {
  constructor() {
    this.terminated = false
    this.sent = []
  }
  postMessage(message) { this.sent.push(message) }
  terminate() { this.terminated = true }
  receive(data) { this.onmessage?.({ data }) }
}

function run(options = {}) {
  const worker = new FakeWorker()
  const onOutput = vi.fn()
  const send = vi.fn((w) => w.postMessage('code'))
  const handle = startRun({ createWorkers: [() => worker], send, onOutput, ...options })
  return { ...handle, worker, onOutput, send }
}

const started = (worker) => {
  worker.receive({ type: 'ready' })
  worker.receive({ type: 'started' })
}

describe('appendOutput', () => {
  it('merges adjacent text from one stream', () => {
    const chunks = []
    appendOutput(chunks, 'stdout', 'a', 0, 100)
    appendOutput(chunks, 'stdout', 'b', 1, 100)
    appendOutput(chunks, 'stderr', 'c', 2, 100)
    expect(chunks).toEqual([{ stream: 'stdout', text: 'ab' }, { stream: 'stderr', text: 'c' }])
  })

  it('cuts at the limit and says when it is full', () => {
    const chunks = []
    expect(appendOutput(chunks, 'stdout', 'abcdef', 0, 4)).toEqual({ used: 4, full: true })
    expect(chunks[0].text).toBe('abcd')
    expect(appendOutput([], 'stdout', 'ab', 0, 4).full).toBe(false)
  })
})

describe('startRun', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends the code only once the worker is ready', () => {
    const { worker, send } = run()
    expect(send).not.toHaveBeenCalled()
    worker.receive({ type: 'ready' })
    worker.receive({ type: 'ready' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('collects output by stream and finishes with ok, then terminates', async () => {
    const { worker, result } = run()
    started(worker)
    worker.receive({ type: 'output', stream: 'stdout', text: 'hello\n' })
    worker.receive({ type: 'output', stream: 'stderr', text: 'oops\n' })
    worker.receive({ type: 'done', ok: true })
    const { status, output } = await result
    expect(status).toBe('ok')
    expect(output).toEqual([{ stream: 'stdout', text: 'hello\n' }, { stream: 'stderr', text: 'oops\n' }])
    expect(worker.terminated).toBe(true)
  })

  it('a failed run reports error', async () => {
    const { worker, result } = run()
    started(worker)
    worker.receive({ type: 'done', ok: false })
    expect((await result).status).toBe('error')
  })

  it('reports how long the code ran', async () => {
    const { worker, result } = run()
    started(worker)
    vi.advanceTimersByTime(1234)
    worker.receive({ type: 'done', ok: true })
    expect((await result).durationMs).toBeCloseTo(1234, -1)
  })

  describe('timeout', () => {
    it('terminates the worker at the hard limit', async () => {
      const { worker, result } = run()
      started(worker)
      vi.advanceTimersByTime(RUN_TIMEOUT_MS - 1)
      expect(worker.terminated).toBe(false)
      vi.advanceTimersByTime(1)
      expect((await result).status).toBe('timeout')
      expect(worker.terminated).toBe(true)
    })

    it('is ten seconds by default', () => {
      expect(RUN_TIMEOUT_MS).toBe(10_000)
    })

    it('does not count loading time', async () => {
      const { worker, result } = run({ timeoutMs: 100 })
      worker.receive({ type: 'ready' })
      vi.advanceTimersByTime(5000)
      expect(worker.terminated).toBe(false)
      worker.receive({ type: 'started' })
      vi.advanceTimersByTime(100)
      expect((await result).status).toBe('timeout')
    })

    it('keeps the output from before the timeout', async () => {
      const { worker, result } = run({ timeoutMs: 100 })
      started(worker)
      worker.receive({ type: 'output', stream: 'stdout', text: 'partial' })
      vi.advanceTimersByTime(100)
      expect((await result).output[0].text).toBe('partial')
    })

    it('a later done message cannot change the result', async () => {
      const { worker, result } = run({ timeoutMs: 100 })
      started(worker)
      vi.advanceTimersByTime(100)
      worker.receive({ type: 'done', ok: true })
      expect((await result).status).toBe('timeout')
    })
  })

  describe('output cap', () => {
    it('stops the run when the cap is reached, even if the worker ignores its own', async () => {
      const { worker, result } = run({ maxOutputChars: 10 })
      started(worker)
      worker.receive({ type: 'output', stream: 'stdout', text: '12345' })
      expect(worker.terminated).toBe(false)
      worker.receive({ type: 'output', stream: 'stdout', text: '6789012345' })
      const { status, output } = await result
      expect(status).toBe('output-limit')
      expect(output[0].text).toBe('1234567890')
      expect(worker.terminated).toBe(true)
    })

    it('exactly the cap also counts as reached', async () => {
      const { worker, result } = run({ maxOutputChars: 3 })
      started(worker)
      worker.receive({ type: 'output', stream: 'stdout', text: 'abc' })
      expect((await result).status).toBe('output-limit')
    })

    it('stops when the worker says it hit its own cap', async () => {
      const { worker, result } = run()
      started(worker)
      worker.receive({ type: 'truncated' })
      expect((await result).status).toBe('output-limit')
    })

    it('stderr counts towards the same cap', async () => {
      const { worker, result } = run({ maxOutputChars: 4 })
      started(worker)
      worker.receive({ type: 'output', stream: 'stdout', text: 'ab' })
      worker.receive({ type: 'output', stream: 'stderr', text: 'cdef' })
      expect((await result).output).toEqual([{ stream: 'stdout', text: 'ab' }, { stream: 'stderr', text: 'cd' }])
    })
  })

  describe('messages', () => {
    it('ignores anything malformed', async () => {
      const { worker, result } = run()
      started(worker)
      worker.receive(null)
      worker.receive('text')
      worker.receive({ type: 'unknown' })
      worker.receive({ type: 'output', stream: 'stdout', text: 123 })
      worker.receive({ type: 'done', ok: true })
      expect((await result).output).toEqual([])
    })

    it('an unknown stream is treated as stdout', async () => {
      const { worker, result } = run()
      started(worker)
      worker.receive({ type: 'output', stream: 'evil', text: 'x' })
      worker.receive({ type: 'done', ok: true })
      expect((await result).output[0].stream).toBe('stdout')
    })

    it('batches screen updates during a run', () => {
      const { worker, onOutput } = run()
      started(worker)
      for (let i = 0; i < 1000; i += 1) worker.receive({ type: 'output', stream: 'stdout', text: 'x' })
      expect(onOutput).not.toHaveBeenCalled()
      vi.advanceTimersByTime(50)
      expect(onOutput).toHaveBeenCalledTimes(1)
      expect(onOutput.mock.calls[0][0][0].text).toHaveLength(1000)
    })

    it('always delivers the final output', async () => {
      const { worker, onOutput, result } = run()
      started(worker)
      worker.receive({ type: 'output', stream: 'stdout', text: 'last' })
      worker.receive({ type: 'done', ok: true })
      await result
      expect(onOutput).toHaveBeenLastCalledWith([{ stream: 'stdout', text: 'last' }])
    })

    it('passes progress along', () => {
      const onProgress = vi.fn()
      const { worker } = run({ onProgress })
      worker.receive({ type: 'progress', stage: 'download', percent: 40 })
      expect(onProgress).toHaveBeenCalledWith({ type: 'progress', stage: 'download', percent: 40 })
    })
  })

  describe('stop', () => {
    it('terminates and reports stopped', async () => {
      const { worker, stop, result } = run()
      started(worker)
      stop()
      expect((await result).status).toBe('stopped')
      expect(worker.terminated).toBe(true)
    })

    it('after a stop, a timeout does nothing more', async () => {
      const onWorkerLost = vi.fn()
      const { worker, stop, result } = run({ onWorkerLost })
      started(worker)
      stop()
      vi.advanceTimersByTime(RUN_TIMEOUT_MS * 2)
      expect((await result).status).toBe('stopped')
      expect(onWorkerLost).toHaveBeenCalledTimes(1)
    })
  })

  describe('worker failures', () => {
    it('falls back to the next way of starting a worker', async () => {
      const first = new FakeWorker()
      const second = new FakeWorker()
      const send = vi.fn()
      startRun({ createWorkers: [() => first, () => second], send })
      first.onerror({ preventDefault() {} })
      expect(first.terminated).toBe(true)
      second.receive({ type: 'ready' })
      expect(send).toHaveBeenCalledWith(second)
    })

    it('falls back when starting one throws', () => {
      const second = new FakeWorker()
      const send = vi.fn()
      startRun({ createWorkers: [() => { throw new Error('SecurityError') }, () => second], send })
      second.receive({ type: 'ready' })
      expect(send).toHaveBeenCalledWith(second)
    })

    it('explains when no worker will start', async () => {
      const { result } = startRun({ createWorkers: [() => { throw new Error('no') }], send: vi.fn() })
      const { status, output } = await result
      expect(status).toBe('crashed')
      expect(output[0].text).toMatch(/wouldn't start/)
    })

    it('a crash after starting is reported, not retried', async () => {
      const second = vi.fn()
      const first = new FakeWorker()
      const { result } = startRun({ createWorkers: [() => first, second], send: vi.fn() })
      started(first)
      first.onerror({ message: 'Out of memory', preventDefault() {} })
      const { status, output } = await result
      expect(status).toBe('crashed')
      expect(output[0].text).toBe('Out of memory')
      expect(second).not.toHaveBeenCalled()
    })
  })

  describe('keeping a worker for next time', () => {
    it('leaves it running when asked', async () => {
      const lost = vi.fn()
      const { worker, result } = run({ keepWorker: (status) => status === 'ok', onWorkerLost: lost })
      started(worker)
      worker.receive({ type: 'done', ok: true })
      await result
      expect(worker.terminated).toBe(false)
      expect(lost).not.toHaveBeenCalled()
    })

    it('still kills it on a timeout, and says so', async () => {
      const lost = vi.fn()
      const { worker, result } = run({ keepWorker: (status) => status === 'ok', onWorkerLost: lost, timeoutMs: 10 })
      started(worker)
      vi.advanceTimersByTime(10)
      await result
      expect(worker.terminated).toBe(true)
      expect(lost).toHaveBeenCalledTimes(1)
    })

    it('reuses an existing worker straight away', async () => {
      const worker = new FakeWorker()
      const send = vi.fn()
      const { result } = startRun({ existingWorker: worker, createWorkers: [], send, keepWorker: () => true })
      expect(send).toHaveBeenCalledWith(worker)
      worker.receive({ type: 'started' })
      worker.receive({ type: 'done', ok: true })
      expect((await result).status).toBe('ok')
    })
  })
})
