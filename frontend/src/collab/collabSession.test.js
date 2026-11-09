import { describe, it, expect, vi, afterEach } from 'vitest'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { MESSAGE_SESSION, colorFor, createCollabSession, replaceText } from './collabSession'

// A server end for the real y-websocket provider: it speaks y-protocols with its
// own Y.Doc, the way the backend does
function fakeServer({ content = '', role = 'editor', closeWith = null } = {}) {
  const serverDoc = new Y.Doc()
  serverDoc.getText('content').insert(0, content)
  const sockets = []
  class ServerSocket {
    constructor(url) {
      this.url = url
      this.readyState = 0
      this.OPEN = 1
      this.binaryType = 'arraybuffer'
      this.sent = []
      sockets.push(this)
      setTimeout(() => {
        this.readyState = 1
        this.onopen?.({})
        if (closeWith) {
          this.close(closeWith)
          return
        }
        const session = encoding.createEncoder()
        encoding.writeVarUint(session, MESSAGE_SESSION)
        encoding.writeVarString(session, JSON.stringify({ role, username: 'olivia' }))
        this.deliver(encoding.toUint8Array(session))
        // Like the backend: ask for what the browser has that we don't (offline edits)
        const step1 = encoding.createEncoder()
        encoding.writeVarUint(step1, 0)
        syncProtocol.writeSyncStep1(step1, serverDoc)
        this.deliver(encoding.toUint8Array(step1))
      }, 0)
    }
    deliver(bytes) {
      this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
    }
    send(data) {
      this.sent.push(data)
      const decoder = decoding.createDecoder(new Uint8Array(data))
      if (decoding.readVarUint(decoder) !== 0) return
      const reply = encoding.createEncoder()
      encoding.writeVarUint(reply, 0)
      syncProtocol.readSyncMessage(decoder, reply, serverDoc, 'client')
      if (encoding.length(reply) > 1) this.deliver(encoding.toUint8Array(reply))
    }
    close(code = 1000) {
      this.readyState = 3
      setTimeout(() => this.onclose?.({ code, reason: '' }), 0)
    }
  }
  ServerSocket.OPEN = 1
  return { serverDoc, ServerSocket, sockets }
}

const sessions = []
function open(server, options = {}) {
  const session = createCollabSession({ projectId: 7, fileId: 3, username: 'olivia', Socket: server.ServerSocket, url: 'ws://test/ws/code-files', ...options })
  sessions.push(session)
  return session
}

function until(session, check) {
  return vi.waitFor(() => expect(check(session.getState())).toBe(true), { timeout: 2000 })
}

describe('createCollabSession', () => {
  afterEach(() => {
    sessions.splice(0).forEach((s) => s.destroy())
  })

  it("syncs the server's document and learns the role", async () => {
    const server = fakeServer({ content: 'print(1)\n' })
    const session = open(server)
    await until(session, (s) => s.synced && s.role === 'editor')
    expect(session.text.toString()).toBe('print(1)\n')
    expect(session.getState()).toMatchObject({ status: 'connected', username: 'olivia', closed: null })
    expect(server.sockets[0].url).toBe('ws://test/ws/code-files/3')
  })

  it('tells subscribers about each change', async () => {
    const server = fakeServer()
    const session = open(server)
    const seen = []
    session.subscribe((state) => seen.push(state.status))
    await until(session, (s) => s.synced)
    expect(seen).toContain('connected')
  })

  it('sends local edits to the server', async () => {
    const server = fakeServer({ content: 'a' })
    const session = open(server)
    await until(session, (s) => s.synced)
    session.text.insert(1, 'b')
    await vi.waitFor(() => expect(server.serverDoc.getText('content').toString()).toBe('ab'))
  })

  it('shares who you are, with a stable colour', async () => {
    const session = open(fakeServer())
    expect(session.awareness.getLocalState().user).toEqual({ name: 'olivia', color: colorFor('olivia') })
  })

  it.each([4001, 4004, 4009, 4013])('stops for good when the server says %i', async (code) => {
    const server = fakeServer({ closeWith: code })
    const session = open(server)
    await until(session, (s) => s.closed !== null)
    expect(session.getState().closed.code).toBe(code)
    expect(session.provider.shouldConnect).toBe(false)
  })

  it('remembers edits made offline until a reconnect has synced them', async () => {
    const server = fakeServer({ content: 'x' })
    const session = open(server)
    await until(session, (s) => s.synced)
    server.sockets[0].close(1006)
    await until(session, (s) => s.status !== 'connected')
    session.text.insert(1, ' offline')
    expect(session.getState().unsynced).toBe(true)
    await until(session, (s) => s.status === 'connected' && !s.unsynced)
    await vi.waitFor(() => expect(server.serverDoc.getText('content').toString()).toBe('x offline'))
  })

  it('edits while connected are never "unsynced"', async () => {
    const session = open(fakeServer({ content: 'x' }))
    await until(session, (s) => s.synced)
    session.text.insert(1, 'y')
    expect(session.getState().unsynced).toBe(false)
  })

  it('reconnects after an ordinary drop', async () => {
    const server = fakeServer({ content: 'x' })
    const session = open(server)
    await until(session, (s) => s.synced)
    server.sockets[0].close(1006)
    await vi.waitFor(() => expect(server.sockets.length).toBeGreaterThan(1), { timeout: 3000 })
    expect(session.getState().closed).toBeNull()
  })
})

describe('replaceText', () => {
  it('changes only the part that differs', () => {
    const doc = new Y.Doc()
    const text = doc.getText('content')
    text.insert(0, 'hello world')
    const changes = []
    text.observe((event) => changes.push(event.delta))
    replaceText(text, 'hello brave world')
    expect(text.toString()).toBe('hello brave world')
    expect(changes).toEqual([[{ retain: 6 }, { insert: 'brave ' }]])
    replaceText(text, 'hello brave world')
    expect(changes).toHaveLength(1)
    replaceText(text, '')
    expect(text.toString()).toBe('')
  })
})

describe('colorFor', () => {
  it('gives each name the same colour every time', () => {
    expect(colorFor('olivia')).toBe(colorFor('olivia'))
    expect(colorFor('olivia')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
