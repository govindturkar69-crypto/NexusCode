import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentPanel from './AgentPanel'
import { runPython } from '../runners/runPython'
import { jsonResponse, sseFrame as frame, sseResponse } from '../test/helpers'

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ original, modified }) => (
    <div data-testid="diff">
      <pre data-testid="original">{original}</pre>
      <pre data-testid="modified">{modified}</pre>
    </div>
  ),
}))

vi.mock('../runners/runPython', () => ({
  runPython: vi.fn(() => ({ result: Promise.resolve({ status: 'ok', output: [{ stream: 'stdout', text: 'OK\n' }], durationMs: 420 }), stop: vi.fn() })),
}))

const RUN = { id: 5, status: 'running', limits: { max_steps: 8 } }

// The server: run creation, scripted steps, stop and "accepted"
const QUOTA = { user_limit: 5, user_remaining: 4, total_limit: 20, total_remaining: 15, resets_at: '2026-11-09T00:00:00Z' }

function stubServer(steps, { quota = QUOTA } = {}) {
  const queue = [...steps]
  const requests = []
  const fetchMock = vi.fn((url, init = {}) => {
    const path = new URL(url, 'http://x').pathname
    requests.push({ path, body: init.body ? JSON.parse(init.body) : null })
    if (path === '/ai/projects/7/agent/runs') return jsonResponse(201, RUN)
    if (path === '/ai/agent/quota') return jsonResponse(200, quota)
    if (path === '/ai/agent/runs/5/stop') return jsonResponse(200, { ...RUN, status: 'stopped' })
    if (path === '/ai/agent/runs/5/accepted') return jsonResponse(200, RUN)
    if (path === '/ai/agent/runs/5/step') {
      const next = queue.shift()
      if (!next) throw new Error('unexpected step')
      return sseResponse(next, { signal: init.signal })
    }
    throw new Error(`Unexpected fetch ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return requests
}

function setup(props = {}) {
  const project = new Map([['todo.py', 'old code']])
  const deps = {
    readLive: vi.fn(async (path) => project.get(path) ?? null),
    applyFile: vi.fn(async (path, content) => {
      const created = !project.has(path)
      project.set(path, content)
      return { fileId: 50, created }
    }),
    deleteFile: vi.fn(async () => project.delete('new.py')),
    createTask: vi.fn(async () => ({})),
  }
  render(<AgentPanel projectId={7} files={[{ id: 1, path: 'todo.py', language: 'python' }]} {...deps} {...props} />)
  return { project, deps }
}

async function startRun(goal = 'Build a todo CLI') {
  await userEvent.type(screen.getByLabelText('Goal'), goal)
  await userEvent.click(screen.getByRole('button', { name: 'Start' }))
}

const timeline = () => screen.getByRole('list', { name: 'Agent timeline' })
const changes = () => screen.getByRole('list', { name: 'Changes to review' })

const WRITE_AND_FINISH = [
  [
    frame('thought', { text: 'I will ' }),
    frame('thought', { text: 'write the file.' }),
    frame('tool_call', { id: 'c1', name: 'write_file', args: { path: 'todo.py', content: 'new code\nline 2' } }),
    frame('done', { status: 'tool_calls', steps: 1 }),
  ],
  [frame('text', { text: 'Rewrote todo.py.' }), frame('done', { status: 'finished', summary: 'Rewrote todo.py; nothing was run.', steps: 2 })],
]

describe('AgentPanel', () => {
  beforeEach(() => vi.useRealTimers())

  it('shows the run step by step and ends with the summary', async () => {
    const requests = stubServer(WRITE_AND_FINISH)
    setup()
    await startRun()
    expect(await screen.findByText('Done')).toBeInTheDocument()
    const items = within(timeline()).getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toBe('Step 1 of 8')
    expect(items[1]).toContain('Reasoning')
    expect(items[2]).toContain('Proposed a change to todo.py')
    expect(items[3]).toBe('Step 2 of 8')
    expect(items[4]).toBe('Rewrote todo.py.')
    expect(screen.getByText('Rewrote todo.py; nothing was run.')).toBeInTheDocument()
    // The agent was told the change is staged, not saved
    const second = requests.filter((r) => r.path === '/ai/agent/runs/5/step')[1]
    expect(second.body).toEqual({ results: [{ id: 'c1', result: { state: 'staged' } }] })
    expect(requests.some((r) => r.body?.goal === 'Build a todo CLI')).toBe(true)
  })

  it('saves nothing until the change is accepted, and shows it as a diff', async () => {
    stubServer(WRITE_AND_FINISH)
    const { project, deps } = setup()
    await startRun()
    await screen.findByText('Done')
    expect(deps.applyFile).not.toHaveBeenCalled()
    expect(project.get('todo.py')).toBe('old code')
    const card = within(changes()).getByRole('listitem', { name: 'todo.py (edit)' })
    expect(within(card).getByTestId('original')).toHaveTextContent('old code')
    expect(within(card).getByTestId('modified')).toHaveTextContent('new code line 2')
    await userEvent.click(within(card).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(project.get('todo.py')).toBe('new code\nline 2'))
    expect(within(card).getByText(/Accepted/)).toBeInTheDocument()
  })

  it('a rejected change is never saved', async () => {
    stubServer(WRITE_AND_FINISH)
    const { deps } = setup()
    await startRun()
    await screen.findByText('Done')
    const card = within(changes()).getByRole('listitem', { name: 'todo.py (edit)' })
    await userEvent.click(within(card).getByRole('button', { name: 'Reject' }))
    expect(within(card).getByText(/Rejected/)).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
    expect(deps.applyFile).not.toHaveBeenCalled()
  })

  it('an accepted change can be undone', async () => {
    stubServer(WRITE_AND_FINISH)
    const { project } = setup()
    await startRun()
    await screen.findByText('Done')
    const card = within(changes()).getByRole('listitem', { name: 'todo.py (edit)' })
    await userEvent.click(within(card).getByRole('button', { name: 'Accept' }))
    await userEvent.click(await within(card).findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(project.get('todo.py')).toBe('old code'))
    expect(within(card).getByText(/Undone/)).toBeInTheDocument()
  })

  it('records what was kept in the activity feed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const requests = stubServer(WRITE_AND_FINISH)
    setup()
    await startRun()
    await screen.findByText('Done')
    await userEvent.click(within(changes()).getByRole('button', { name: 'Accept' }))
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => expect(requests.find((r) => r.path === '/ai/agent/runs/5/accepted')?.body).toEqual({ files: ['todo.py'], tasks: [] }))
  })

  it('with auto-accept on, changes are saved as the agent makes them', async () => {
    const requests = stubServer(WRITE_AND_FINISH)
    const { project } = setup()
    await userEvent.click(screen.getByRole('checkbox', { name: /without asking/ }))
    await startRun()
    await screen.findByText('Done')
    expect(project.get('todo.py')).toBe('new code\nline 2')
    const second = requests.filter((r) => r.path === '/ai/agent/runs/5/step')[1]
    expect(second.body.results[0].result).toEqual({ state: 'saved' })
  })

  it('shows the closing message once, as the summary', async () => {
    stubServer([[frame('text', { text: 'All done.' }), frame('done', { status: 'finished', summary: 'All done.' })]])
    setup()
    await startRun()
    await screen.findByText('Done')
    expect(screen.getAllByText('All done.')).toHaveLength(1)
    expect(within(timeline()).queryByText('All done.')).not.toBeInTheDocument()
  })

  it('says the AI is not configured and offers no Start when the server has no key', async () => {
    stubServer([], { quota: { ...QUOTA, ai_configured: false } })
    setup()
    expect(await screen.findByText(/AI is not configured on this server/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Goal'), 'Fix the bug')
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  it('auto-accept is off by default', () => {
    stubServer([])
    setup()
    expect(screen.getByRole('checkbox', { name: /without asking/ })).not.toBeChecked()
  })

  it('a change over a file the user edited needs Overwrite', async () => {
    stubServer(WRITE_AND_FINISH)
    const { project } = setup()
    await startRun()
    await screen.findByText('Done')
    project.set('todo.py', 'my own edit')
    await userEvent.click(within(changes()).getByRole('button', { name: 'Accept' }))
    expect(await within(changes()).findByRole('alert')).toHaveTextContent('changed since the agent read it')
    expect(project.get('todo.py')).toBe('my own edit')
    await userEvent.click(within(changes()).getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(project.get('todo.py')).toBe('new code\nline 2'))
  })

  it('runs code in the browser and shows whether it passed', async () => {
    stubServer([
      [frame('tool_call', { id: 'r1', name: 'run_file', args: { path: 'todo.py' } }), frame('done', { status: 'tool_calls' })],
      [frame('done', { status: 'finished', summary: 'Ran it.' })],
    ])
    setup()
    await startRun()
    await screen.findByText('Done')
    expect(within(timeline()).getByText(/Ran todo.py: passed in 420 ms/)).toBeInTheDocument()
  })

  it('a failing run is fixed and run again, and the summary says what passed', async () => {
    const outcome = (status, stream, text) => ({ result: Promise.resolve({ status, output: [{ stream, text }], durationMs: 30 }), stop: vi.fn() })
    vi.mocked(runPython)
      .mockImplementationOnce(() => outcome('error', 'stderr', 'AssertionError: 4 != 5'))
      .mockImplementationOnce(() => outcome('ok', 'stdout', 'OK'))
    const requests = stubServer([
      [
        frame('tool_call', { id: 'w1', name: 'write_file', args: { path: 'calc.py', content: 'def add(a, b):\n    return a - b' } }),
        frame('tool_call', { id: 'w2', name: 'write_file', args: { path: 'test_calc.py', content: 'import calc' } }),
        frame('tool_call', { id: 'r1', name: 'run_file', args: { path: 'test_calc.py' } }),
        frame('done', { status: 'tool_calls' }),
      ],
      [
        frame('thought', { text: 'add subtracts; fix it' }),
        frame('tool_call', { id: 'w3', name: 'write_file', args: { path: 'calc.py', content: 'def add(a, b):\n    return a + b' } }),
        frame('tool_call', { id: 'r2', name: 'run_file', args: { path: 'test_calc.py' } }),
        frame('done', { status: 'tool_calls' }),
      ],
      [frame('done', { status: 'finished', summary: 'Fixed add; tests pass.' })],
    ])
    setup()
    await startRun()
    await screen.findByText('Done')
    // The failure went back to the agent, and its fix was what ran next
    const steps = requests.filter((r) => r.path === '/ai/agent/runs/5/step')
    expect(steps[1].body.results[2].result).toMatchObject({ status: 'error', stderr: 'AssertionError: 4 != 5' })
    const secondRun = vi.mocked(runPython).mock.calls.at(-1)[0]
    expect(secondRun.files).toEqual([
      { path: 'test_calc.py', content: 'import calc' },
      { path: 'calc.py', content: 'def add(a, b):\n    return a + b' },
      { path: 'todo.py', content: 'old code' },
    ])
    expect(within(timeline()).getByText(/Ran test_calc.py: error/)).toBeInTheDocument()
    expect(within(timeline()).getByText(/Ran test_calc.py: passed/)).toBeInTheDocument()
    // One change per file, holding the latest version
    const files = screen.getByRole('list', { name: 'Files changed in this run' })
    expect(within(files).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'calc.py · new · Waiting for review',
      'test_calc.py · new · Waiting for review',
    ])
    expect(screen.getByRole('list', { name: 'Run results' })).toHaveTextContent('test_calc.py passed on run 2, after 1 failed')
    expect(within(changes()).getAllByRole('listitem', { name: /calc\.py \(new file\)/ })).toHaveLength(2)
  })

  it('says plainly when a file can not run in the browser', async () => {
    stubServer([
      [frame('tool_call', { id: 'r1', name: 'run_file', args: { path: 'Main.java' } }), frame('done', { status: 'tool_calls' })],
      [frame('done', { status: 'finished', summary: 'Wrote Main.java; run it with javac.' })],
    ])
    setup()
    await startRun()
    await screen.findByText('Done')
    expect(within(timeline()).getByText(/Couldn't run Main.java/)).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent("Main.java can't run in the browser")
  })

  it('shows calls the server refused, and tasks to review', async () => {
    stubServer([
      [
        frame('tool_rejected', { id: 'x', name: 'read_file', error: "Invalid path '../x': '..' can't be used" }),
        frame('tool_call', { id: 't1', name: 'add_task', args: { title: 'Write docs', priority: 'low' } }),
        frame('done', { status: 'tool_calls' }),
      ],
      [frame('done', { status: 'finished', summary: 'ok' })],
    ])
    const { deps } = setup()
    await startRun()
    await screen.findByText('Done')
    expect(within(timeline()).getByText(/Refused read_file/)).toBeInTheDocument()
    const task = within(changes()).getByRole('listitem', { name: 'Task Write docs' })
    await userEvent.click(within(task).getByRole('button', { name: 'Add to board' }))
    await waitFor(() => expect(deps.createTask).toHaveBeenCalledWith({ title: 'Write docs', description: null, priority: 'low' }))
  })

  it('Stop ends the run', async () => {
    const held = [frame('text', { text: 'Thinking about it' })]
    held.hold = true
    const requests = stubServer([held])
    setup()
    await startRun()
    await screen.findByText('Thinking about it')
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByText('Stopped')).toBeInTheDocument()
    expect(requests.some((r) => r.path === '/ai/agent/runs/5/stop')).toBe(true)
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('shows how many runs are left today', async () => {
    stubServer([])
    setup()
    expect(await screen.findByText('4 of 5 runs left today')).toBeInTheDocument()
  })

  it('warns when few runs are left for everyone', async () => {
    stubServer([], { quota: { ...QUOTA, user_remaining: 5, total_remaining: 2 } })
    setup()
    expect(await screen.findByText('5 of 5 runs left today (only 2 left for everyone)')).toBeInTheDocument()
  })

  it('can not start when the quota is used up', async () => {
    stubServer([], { quota: { ...QUOTA, user_remaining: 0 } })
    setup()
    expect(await screen.findByText(/You've used all your agent runs for today/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Goal'), 'Anything')
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  it("can not start when the server's daily total is used up", async () => {
    stubServer([], { quota: { ...QUOTA, total_remaining: 0 } })
    setup()
    expect(await screen.findByText(/reached today's limit for everyone/)).toBeInTheDocument()
  })

  it("says so when the AI's own daily allowance is used up", async () => {
    stubServer([], { quota: { ...QUOTA, ai_available: false } })
    setup()
    expect(await screen.findByText(/free daily allowance is used up/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Goal'), 'Anything')
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  it('runs the agent code with the network off', async () => {
    vi.mocked(runPython).mockClear()
    stubServer([
      [frame('tool_call', { id: 'r1', name: 'run_file', args: { path: 'todo.py' } }), frame('done', { status: 'tool_calls' })],
      [frame('done', { status: 'finished', summary: 'ok' })],
    ])
    setup()
    await startRun()
    await screen.findByText('Done')
    expect(vi.mocked(runPython).mock.calls[0][0]).toMatchObject({ offline: true, code: 'old code', fileName: 'todo.py' })
  })

  it('shows why a run could not start', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(403, { detail: 'This action needs the editor role in this project.' })))
    setup()
    await startRun()
    expect(await screen.findByText(/needs the editor role/)).toBeInTheDocument()
  })
})
