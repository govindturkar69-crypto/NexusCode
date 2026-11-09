import { describe, it, expect, vi } from 'vitest'
import { CLOSE_NO_ACCESS, ticketedSocketClass } from './ticketedSocket'

class FakeSocket {
  static made = []
  constructor(url) {
    this.url = url
    this.closed = null
    FakeSocket.made.push(this)
  }
  send(data) {
    this.sentData = data
  }
  close(code, reason) {
    this.closed = { code, reason }
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ticketedSocketClass', () => {
  it('gets a fresh ticket for every connection', async () => {
    FakeSocket.made = []
    let n = 0
    const getTicket = vi.fn(async () => `t${++n}`)
    const Socket = ticketedSocketClass(7, { getTicket, Socket: FakeSocket })
    new Socket('ws://api/ws/code-files/3')
    new Socket('ws://api/ws/code-files/3')
    await tick()
    expect(getTicket).toHaveBeenCalledWith(7)
    expect(FakeSocket.made.map((s) => s.url)).toEqual(['ws://api/ws/code-files/3?ticket=t1', 'ws://api/ws/code-files/3?ticket=t2'])
  })

  it('passes events through and only sends once open', async () => {
    FakeSocket.made = []
    const Socket = ticketedSocketClass(7, { getTicket: async () => 't', Socket: FakeSocket })
    const socket = new Socket('ws://api/x')
    const events = []
    socket.onopen = () => events.push('open')
    socket.onmessage = (e) => events.push(`message:${e.data}`)
    socket.onclose = (e) => events.push(`close:${e.code}`)
    socket.send('too early')
    await tick()
    const real = FakeSocket.made[0]
    expect(real.sentData).toBeUndefined()
    real.onopen({})
    expect(socket.readyState).toBe(socket.OPEN)
    socket.send('hi')
    expect(real.sentData).toBe('hi')
    real.onmessage({ data: 'x' })
    real.onclose({ code: 1006 })
    expect(events).toEqual(['open', 'message:x', 'close:1006'])
    expect(socket.readyState).toBe(socket.CLOSED)
  })

  it('a failed ticket request looks like a failed connection, which is retried', async () => {
    const Socket = ticketedSocketClass(7, { getTicket: async () => { throw Object.assign(new Error('offline'), { status: 0 }) }, Socket: FakeSocket })
    const socket = new Socket('ws://api/x')
    const onclose = vi.fn()
    socket.onclose = onclose
    await tick()
    expect(onclose).toHaveBeenCalledWith(expect.objectContaining({ code: 1006 }))
  })

  it('no access (404 for the ticket) is a close the session does not retry', async () => {
    const Socket = ticketedSocketClass(7, { getTicket: async () => { throw Object.assign(new Error('Project not found'), { status: 404 }) }, Socket: FakeSocket })
    const socket = new Socket('ws://api/x')
    const onclose = vi.fn()
    socket.onclose = onclose
    await tick()
    expect(onclose).toHaveBeenCalledWith(expect.objectContaining({ code: CLOSE_NO_ACCESS }))
  })

  it('closing before the ticket arrives opens nothing', async () => {
    FakeSocket.made = []
    let release
    const Socket = ticketedSocketClass(7, { getTicket: () => new Promise((resolve) => { release = resolve }), Socket: FakeSocket })
    const socket = new Socket('ws://api/x')
    const onclose = vi.fn()
    socket.onclose = onclose
    socket.close(1000)
    release('t')
    await tick()
    expect(FakeSocket.made).toHaveLength(0)
    expect(onclose).toHaveBeenCalledWith(expect.objectContaining({ code: 1000 }))
  })
})
