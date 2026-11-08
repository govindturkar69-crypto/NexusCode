import { describe, it, expect, vi } from 'vitest'
import { AGENT_CANT_RUN, MAX_READ_CHARS, MAX_STREAM_CHARS, createAgentTools, splitOutput } from './agentTools'

function tools(overrides = {}) {
  const env = {
    listPaths: vi.fn(async () => [{ path: 'a.py' }, { path: 'b.py', size: 3 }]),
    read: vi.fn(async (path) => ({ 'a.py': 'print(1)\nprint(2)', 'page.html': '<h1>hi</h1>', 'Main.java': 'class Main {}' })[path] ?? null),
    write: vi.fn(async () => 'staged'),
    run: vi.fn(async () => ({ status: 'ok', output: [{ stream: 'stdout', text: '1\n' }, { stream: 'stderr', text: 'warn\n' }, { stream: 'stdout', text: '2\n' }], durationMs: 12.6 })),
    proposeTask: vi.fn(async () => 'proposed'),
    ...overrides,
  }
  return { env, tools: createAgentTools(env) }
}

const call = (name, args = {}) => ({ id: 'x', name, args })

describe('agent tools', () => {
  it('list_files', async () => {
    const { tools: t } = tools()
    expect(await t.execute(call('list_files'))).toEqual({ files: [{ path: 'a.py' }, { path: 'b.py', size: 3 }] })
  })

  it('read_file, and a missing file is an error the agent hears about', async () => {
    const { tools: t } = tools()
    expect(await t.execute(call('read_file', { path: 'a.py' }))).toEqual({ content: 'print(1)\nprint(2)' })
    await expect(t.execute(call('read_file', { path: 'nope.py' }))).rejects.toThrow('No such file: nope.py')
  })

  it('read_file is cut to the size the server accepts', async () => {
    const { tools: t } = tools({ read: async () => 'x'.repeat(MAX_READ_CHARS + 5) })
    expect((await t.execute(call('read_file', { path: 'big.py' }))).content).toHaveLength(MAX_READ_CHARS)
  })

  it('write_file stages through the store', async () => {
    const { env, tools: t } = tools()
    expect(await t.execute(call('write_file', { path: 'c.py', content: 'x' }))).toEqual({ state: 'staged' })
    expect(env.write).toHaveBeenCalledWith('c.py', 'x')
  })

  it('run_file runs the agent version of the file and splits the output', async () => {
    const { env, tools: t } = tools()
    const result = await t.execute(call('run_file', { path: 'a.py', stdin: '5\n' }))
    expect(env.run).toHaveBeenCalledWith('a.py', 'print(1)\nprint(2)', 'python', '5\n')
    expect(result).toEqual({ status: 'ok', stdout: '1\n2\n', stderr: 'warn\n', duration_ms: 13 })
  })

  it('run_file keeps both ends of very long output', async () => {
    const long = `${'a'.repeat(MAX_STREAM_CHARS)}END`
    const { tools: t } = tools({ run: async () => ({ status: 'error', output: [{ stream: 'stderr', text: long }], durationMs: 1 }) })
    const { stderr } = await t.execute(call('run_file', { path: 'a.py' }))
    expect(stderr.length).toBeLessThan(MAX_STREAM_CHARS + 100)
    expect(stderr.endsWith('END')).toBe(true)
  })

  it.each([
    ['page.html', AGENT_CANT_RUN.preview],
    ['Main.java', AGENT_CANT_RUN.other],
  ])('run_file explains what it cannot run (%s)', async (path, message) => {
    const { env, tools: t } = tools()
    expect(await t.execute(call('run_file', { path }))).toEqual({ status: 'unsupported', message })
    expect(env.run).not.toHaveBeenCalled()
  })

  it('add_task proposes', async () => {
    const { env, tools: t } = tools()
    expect(await t.execute(call('add_task', { title: 'Docs', priority: 'low' }))).toEqual({ state: 'proposed' })
    expect(env.proposeTask).toHaveBeenCalledWith({ title: 'Docs', priority: 'low' })
  })

  it('unknown tools are an error', async () => {
    expect(await tools().tools.execute(call('rm_rf'))).toEqual({ error: 'Unknown tool rm_rf' })
  })

  it('splitOutput', () => {
    expect(splitOutput([{ stream: 'stdout', text: 'a' }, { stream: 'stderr', text: 'b' }])).toEqual({ stdout: 'a', stderr: 'b' })
    expect(splitOutput(undefined)).toEqual({ stdout: '', stderr: '' })
  })
})
