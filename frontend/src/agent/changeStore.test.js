import { describe, it, expect, vi } from 'vitest'
import { ChangeStore } from './changeStore'

// A tiny project: path -> content, with the editor's operations on it
function project(initial = {}) {
  const files = new Map(Object.entries(initial))
  let nextId = 100
  const ids = new Map([...files.keys()].map((path) => [path, nextId++]))
  const deps = {
    readLive: vi.fn(async (path) => (files.has(path) ? files.get(path) : null)),
    applyFile: vi.fn(async (path, content) => {
      const created = !files.has(path)
      files.set(path, content)
      if (created) ids.set(path, nextId++)
      return { fileId: ids.get(path), created }
    }),
    deleteFile: vi.fn(async (fileId) => {
      for (const [path, id] of ids) if (id === fileId) files.delete(path)
    }),
    createTask: vi.fn(async () => ({})),
    onAccepted: vi.fn(),
  }
  const store = new ChangeStore(deps)
  store.runId = 9
  return { files, deps, store }
}

describe('ChangeStore', () => {
  it('stages a write without touching the project, and the agent reads its own version', async () => {
    const { files, deps, store } = project({ 'a.py': 'old' })
    expect(await store.stage('a.py', 'new')).toBe('staged')
    expect(files.get('a.py')).toBe('old')
    expect(deps.applyFile).not.toHaveBeenCalled()
    expect(await store.read('a.py')).toBe('new')
    expect(store.entries[0]).toMatchObject({ path: 'a.py', before: 'old', after: 'new', status: 'pending', runId: 9 })
  })

  it('lists proposed new files alongside the project', async () => {
    const { store } = project({ 'a.py': 'x' })
    await store.stage('b.py', 'hello')
    expect(store.listPaths([{ path: 'a.py' }])).toEqual([{ path: 'a.py' }, { path: 'b.py', size: 5 }])
  })

  it('a second write to a pending file updates the same change', async () => {
    const { store } = project({ 'a.py': 'old' })
    await store.stage('a.py', 'v1')
    await store.stage('a.py', 'v2')
    expect(store.entries).toHaveLength(1)
    expect(store.entries[0]).toMatchObject({ before: 'old', after: 'v2' })
  })

  it('accepting saves it and reports it', async () => {
    const { files, deps, store } = project({ 'a.py': 'old' })
    await store.stage('a.py', 'new')
    await store.accept(store.entries[0])
    expect(files.get('a.py')).toBe('new')
    expect(store.entries[0].status).toBe('accepted')
    expect(deps.onAccepted).toHaveBeenCalledWith({ runId: 9, files: ['a.py'], tasks: [] })
  })

  it('rejecting drops it, and the agent then reads the project again', async () => {
    const { files, store } = project({ 'a.py': 'old' })
    await store.stage('a.py', 'new')
    store.reject(store.entries[0])
    expect(await store.read('a.py')).toBe('old')
    expect(files.get('a.py')).toBe('old')
    // A rejected new file is gone for the agent too
    await store.stage('b.py', 'x')
    store.reject(store.entries[1])
    expect(await store.read('b.py')).toBeNull()
    expect(store.listPaths([{ path: 'a.py' }])).toEqual([{ path: 'a.py' }])
  })

  it('refuses to overwrite a file that changed since the agent read it, unless told to', async () => {
    const { files, store } = project({ 'a.py': 'old' })
    await store.stage('a.py', 'agent version')
    files.set('a.py', 'the user typed this')
    await store.accept(store.entries[0])
    expect(store.entries[0].status).toBe('conflict')
    expect(files.get('a.py')).toBe('the user typed this')
    await store.accept(store.entries[0], { force: true })
    expect(files.get('a.py')).toBe('agent version')
    expect(store.entries[0]).toMatchObject({ status: 'accepted', before: 'the user typed this' })
  })

  it('undo restores an edited file', async () => {
    const { files, store } = project({ 'a.py': 'old' })
    await store.stage('a.py', 'new')
    await store.accept(store.entries[0])
    await store.undo(store.entries[0])
    expect(files.get('a.py')).toBe('old')
    expect(store.entries[0].status).toBe('undone')
  })

  it('undo deletes a file the agent created', async () => {
    const { files, deps, store } = project()
    await store.stage('new.py', 'print(1)')
    await store.accept(store.entries[0])
    expect(files.has('new.py')).toBe(true)
    await store.undo(store.entries[0])
    expect(files.has('new.py')).toBe(false)
    expect(deps.deleteFile).toHaveBeenCalledWith(store.entries[0].fileId)
  })

  it('only the latest change to a file can be undone', async () => {
    const { files, store } = project({ 'a.py': 'v0' })
    await store.stage('a.py', 'v1')
    await store.accept(store.entries[0])
    await store.stage('a.py', 'v2')
    await store.accept(store.entries[1])
    await store.undo(store.entries[0])
    expect(store.entries[0].status).toBe('accepted')
    expect(files.get('a.py')).toBe('v2')
    await store.undo(store.entries[1])
    expect(files.get('a.py')).toBe('v1')
  })

  it('a save that fails can be tried again', async () => {
    const { deps, store } = project({ 'a.py': 'old' })
    deps.applyFile.mockRejectedValueOnce(new Error('Network down'))
    await store.stage('a.py', 'new')
    await store.accept(store.entries[0])
    expect(store.entries[0]).toMatchObject({ status: 'failed', error: 'Network down' })
    await store.accept(store.entries[0])
    expect(store.entries[0].status).toBe('accepted')
  })

  it('auto-accept saves straight away and tells the agent so', async () => {
    const { files, store } = project()
    store.setAutoAccept(true)
    expect(await store.stage('a.py', 'x')).toBe('saved')
    expect(files.get('a.py')).toBe('x')
    expect(await store.proposeTask({ title: 'Docs' })).toBe('added')
  })

  it('tasks are proposed, then added or rejected', async () => {
    const { deps, store } = project()
    expect(await store.proposeTask({ title: 'Write docs', priority: 'low' })).toBe('proposed')
    expect(deps.createTask).not.toHaveBeenCalled()
    await store.acceptTask(store.tasks[0])
    expect(deps.createTask).toHaveBeenCalledWith({ title: 'Write docs', description: null, priority: 'low' })
    expect(deps.onAccepted).toHaveBeenLastCalledWith({ runId: 9, files: [], tasks: ['Write docs'] })
    await store.proposeTask({ title: 'Nope' })
    store.rejectTask(store.tasks[1])
    expect(store.tasks[1].status).toBe('rejected')
  })

  it('accept all and reject all', async () => {
    const { files, store } = project()
    await store.stage('a.py', 'a')
    await store.stage('b.py', 'b')
    await store.proposeTask({ title: 't' })
    expect(store.pendingCount()).toBe(3)
    await store.acceptAll()
    expect([...files.keys()]).toEqual(['a.py', 'b.py'])
    expect(store.pendingCount()).toBe(0)
    await store.stage('c.py', 'c')
    store.rejectAll()
    expect(store.pendingCount()).toBe(0)
    expect(files.has('c.py')).toBe(false)
  })

  it('tells subscribers about every change', async () => {
    const { store } = project()
    const listener = vi.fn()
    store.subscribe(listener)
    await store.stage('a.py', 'x')
    store.reject(store.entries[0])
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
