import { vi } from 'vitest'
import * as Y from 'yjs'

// Stand-in for createCollabSession in page tests. mode "off" behaves like a
// session the server ended (the editor falls back to autosave); "live" is synced;
// "connecting" hasn't synced yet. Tests can change a session's state with set().
export const fakeCollab = { mode: 'off', role: 'editor', sessions: new Map() }

export function resetFakeCollab() {
  fakeCollab.mode = 'off'
  fakeCollab.role = 'editor'
  fakeCollab.sessions.clear()
}

const STATES = {
  off: () => ({ status: 'disconnected', synced: false, role: null, username: null, closed: { code: 0, message: 'Live editing is off in this test.' } }),
  connecting: () => ({ status: 'connecting', synced: false, role: null, username: null, closed: null }),
  live: () => ({ status: 'connected', synced: true, role: fakeCollab.role, username: 'me', closed: null }),
}

export function makeFakeSession({ fileId, projectId, username }) {
  const doc = new Y.Doc()
  const text = doc.getText('content')
  let state = STATES[fakeCollab.mode]()
  const listeners = new Set()
  const session = {
    fileId,
    projectId,
    username,
    doc,
    text,
    awareness: { on() {}, off() {}, setLocalStateField() {}, getStates: () => new Map() },
    provider: {},
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(changes) {
      state = { ...state, ...changes }
      listeners.forEach((listener) => listener(state))
    },
    destroy: vi.fn(),
  }
  fakeCollab.sessions.set(fileId, session)
  return session
}
