import { describe, it, expect, vi } from 'vitest'
import { CollabFiles } from './collabFiles'
import { fakeCollab, makeFakeSession, resetFakeCollab } from '../test/fakeCollab'

function files(mode = 'live') {
  resetFakeCollab()
  fakeCollab.mode = mode
  const onText = vi.fn()
  const collab = new CollabFiles({ create: makeFakeSession })
  collab.configure({ projectId: 7, username: 'olivia', onText })
  return { collab, onText }
}

describe('CollabFiles', () => {
  it('opens a session per open file and closes the ones no longer open', () => {
    const { collab } = files()
    collab.setOpen([1, 2])
    expect([...fakeCollab.sessions.keys()]).toEqual([1, 2])
    const first = collab.get(1)
    collab.setOpen([2])
    expect(first.destroy).toHaveBeenCalled()
    expect(collab.get(1)).toBeNull()
    expect(collab.get(2)).not.toBeNull()
  })

  it("passes each file's text changes on", () => {
    const { collab, onText } = files()
    collab.setOpen([3])
    collab.get(3).text.insert(0, 'hi')
    expect(onText).toHaveBeenCalledWith(3, 'hi')
    collab.setOpen([])
    expect(onText).toHaveBeenCalledTimes(1)
  })

  it('is live only once synced and while not ended', () => {
    const { collab } = files('connecting')
    collab.setOpen([1])
    expect(collab.isLive(1)).toBe(false)
    collab.get(1).set({ synced: true })
    expect(collab.isLive(1)).toBe(true)
    collab.get(1).set({ closed: { code: 4013, message: 'too many' } })
    expect(collab.isLive(1)).toBe(false)
    expect(collab.isLive(99)).toBe(false)
  })

  it('tells React about every change', () => {
    const { collab } = files()
    const listener = vi.fn()
    collab.subscribe(listener)
    collab.setOpen([1])
    collab.get(1).set({ status: 'disconnected' })
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(collab.getVersion()).toBeGreaterThanOrEqual(2)
  })

  it('opens nothing before it knows the project', () => {
    resetFakeCollab()
    const collab = new CollabFiles({ create: makeFakeSession })
    collab.setOpen([1])
    expect(fakeCollab.sessions.size).toBe(0)
  })

  it('starts a file afresh when the server says its copy must be reloaded', async () => {
    const { collab } = files()
    collab.setOpen([4])
    const first = collab.get(4)
    first.text.insert(0, 'refused edit')
    first.set({ resync: true })
    expect(collab.isLive(4)).toBe(false)
    await Promise.resolve()
    expect(first.destroy).toHaveBeenCalled()
    const second = collab.get(4)
    expect(second).not.toBe(first)
    expect(second.text.toString()).toBe('')
  })

  it('destroyAll closes everything', () => {
    const { collab } = files()
    collab.setOpen([1, 2])
    const sessions = [collab.get(1), collab.get(2)]
    collab.destroyAll()
    sessions.forEach((s) => expect(s.destroy).toHaveBeenCalled())
  })
})
