import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAgent } from './runAgent'
import { sseFrame as frame, sseResponse, jsonResponse } from '../test/helpers'

const RUN = { id: 5, status: 'running', limits: { max_steps: 8 } }

// Routes fetch by path; each step request takes the next scripted response
function stubServer(steps) {
  const queue = [...steps]
  const bodies = []
  const fetchMock = vi.fn((url, init = {}) => {
    const path = new URL(url, 'http://x').pathname
    if (path === '/ai/projects/7/agent/runs') return jsonResponse(201, RUN)
    if (path === '/ai/agent/runs/5/step') {
      bodies.push(JSON.parse(init.body))
      const next = queue.shift()
      if (!next) throw new Error('unexpected step')
      const frames = Array.isArray(next) ? next : next.frames
      return sseResponse(frames, { status: next.status, json: next.json, signal: init.signal })
    }
    throw new Error(`Unexpected fetch ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, bodies }
}

const toolsReturning = (map) => ({ execute: vi.fn(async (call) => map[call.name]?.(call) ?? { error: 'no' }) })

describe('runAgent', () => {
  beforeEach(() => vi.useRealTimers())

  it('runs the calls of each step and sends their results back until the run ends', async () => {
    const { bodies } = stubServer([
      [
        frame('thought', { text: 'plan' }),
        frame('tool_call', { id: 'a', name: 'list_files', args: {} }),
        frame('tool_call', { id: 'b', name: 'read_file', args: { path: 'x.py' } }),
        frame('done', { status: 'tool_calls', steps: 1 }),
      ],
      [frame('text', { text: 'All good' }), frame('done', { status: 'finished', summary: 'Wrote x.py', steps: 2, tokens: 900 })],
    ])
    const tools = toolsReturning({ list_files: () => ({ files: [] }), read_file: () => ({ content: 'print(1)' }) })
    const events = []
    const end = await runAgent({ projectId: 7, goal: 'g', tools, onEvent: (e) => events.push(e) })
    expect(end).toMatchObject({ type: 'end', status: 'finished', summary: 'Wrote x.py', steps: 2, tokens: 900 })
    expect(bodies).toEqual([
      { results: [] },
      { results: [{ id: 'a', result: { files: [] } }, { id: 'b', result: { content: 'print(1)' } }] },
    ])
    expect(events.map((e) => e.type)).toEqual(['run', 'step', 'thought', 'tool_call', 'tool_result', 'tool_call', 'tool_result', 'step', 'text', 'end'])
  })

  it('turns a throwing tool into an error result', async () => {
    const { bodies } = stubServer([
      [frame('tool_call', { id: 'a', name: 'read_file', args: { path: 'gone.py' } }), frame('done', { status: 'tool_calls' })],
      [frame('done', { status: 'finished', summary: 's' })],
    ])
    const tools = { execute: vi.fn(async () => { throw new Error('No such file: gone.py') }) }
    await runAgent({ projectId: 7, goal: 'g', tools })
    expect(bodies[1].results).toEqual([{ id: 'a', result: { error: 'No such file: gone.py' } }])
  })

  it('reports calls the server refused, and runs none of them', async () => {
    stubServer([
      [frame('tool_rejected', { id: 'a', name: 'read_file', error: 'Invalid path' }), frame('done', { status: 'tool_calls' })],
      [frame('done', { status: 'finished', summary: 's' })],
    ])
    const tools = { execute: vi.fn() }
    const events = []
    await runAgent({ projectId: 7, goal: 'g', tools, onEvent: (e) => events.push(e) })
    expect(tools.execute).not.toHaveBeenCalled()
    expect(events.find((e) => e.type === 'tool_rejected').call.error).toBe('Invalid path')
  })

  it('ends with the reason the server gives for capping a run', async () => {
    stubServer([[frame('done', { status: 'capped', reason: 'The agent used all 8 steps for this run.', steps: 8 })]])
    const events = []
    const end = await runAgent({ projectId: 7, goal: 'g', tools: { execute: vi.fn() }, onEvent: (e) => events.push(e) })
    expect(end).toMatchObject({ status: 'capped', reason: 'The agent used all 8 steps for this run.' })
    // The server ended it without a model step, so no step is shown for it
    expect(events.map((e) => e.type)).toEqual(['run', 'end'])
  })

  it('retries a busy step with the same results, then gives up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const busy = { frames: [], status: 503, json: { detail: 'The AI service is temporarily busy. Please try again in a moment.' } }
    const { bodies } = stubServer([busy, busy, busy])
    const events = []
    const promise = runAgent({ projectId: 7, goal: 'g', tools: { execute: vi.fn() }, onEvent: (e) => events.push(e) })
    await vi.advanceTimersByTimeAsync(20_000)
    const end = await promise
    expect(end).toMatchObject({ status: 'failed', reason: expect.stringContaining('busy') })
    expect(bodies).toHaveLength(3)
    expect(events.filter((e) => e.type === 'retry')).toHaveLength(2)
  })

  it('does not retry when the daily allowance is gone', async () => {
    const detail = "The AI's free daily allowance is used up. The agent will work again when it resets."
    const { bodies } = stubServer([{ frames: [], status: 503, json: { detail } }])
    const end = await runAgent({ projectId: 7, goal: 'g', tools: { execute: vi.fn() } })
    expect(end).toMatchObject({ status: 'failed', reason: detail })
    expect(bodies).toHaveLength(1)
  })

  it('waits longer and retries after a per-minute limit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const limited = { frames: [], status: 503, json: { detail: 'The AI is getting too many requests right now. Trying again in a moment.' } }
    const { bodies } = stubServer([limited, [frame('done', { status: 'finished', summary: 'ok' })]])
    const promise = runAgent({ projectId: 7, goal: 'g', tools: { execute: vi.fn() } })
    await vi.advanceTimersByTimeAsync(5000)
    expect(bodies).toHaveLength(1) // still waiting: longer than a busy retry
    await vi.advanceTimersByTimeAsync(15000)
    expect((await promise).status).toBe('finished')
    expect(bodies).toHaveLength(2)
  })

  it('retries a step that broke midway', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { bodies } = stubServer([
      [frame('text', { text: 'par' }), frame('error', { detail: 'stopped partway', retryable: true })],
      [frame('done', { status: 'finished', summary: 'ok' })],
    ])
    const promise = runAgent({ projectId: 7, goal: 'g', tools: { execute: vi.fn() } })
    await vi.advanceTimersByTimeAsync(5000)
    expect((await promise).status).toBe('finished')
    expect(bodies).toHaveLength(2)
  })

  it('stops when aborted mid-stream', async () => {
    const controller = new AbortController()
    const held = [frame('text', { text: 'working' })]
    held.hold = true
    stubServer([held])
    const onEvent = (e) => {
      if (e.type === 'text') controller.abort()
    }
    const end = await runAgent({ projectId: 7, goal: 'g', tools: { execute: vi.fn() }, signal: controller.signal, onEvent })
    expect(end).toMatchObject({ status: 'stopped' })
  })

  it('fails clearly when the stream ends without a result', async () => {
    stubServer([[frame('text', { text: 'hm' })]])
    const end = await runAgent({ projectId: 7, goal: 'g', tools: { execute: vi.fn() } })
    expect(end).toMatchObject({ status: 'failed', reason: expect.stringContaining('connection ended') })
  })
})
