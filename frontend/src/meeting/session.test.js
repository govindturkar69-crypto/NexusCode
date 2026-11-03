import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMeetingSession } from './session'

class FakeSocket {
  constructor() {
    this.readyState = 1
    this.sent = []
    this.closed = false
  }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.closed = true }
  receive(message) { this.onmessage?.({ data: JSON.stringify(message) }) }
}

class FakePeer {
  constructor() {
    this.tracks = []
    this.remoteDescription = null
    this.localDescription = null
    this.candidates = []
    this.closed = false
  }
  addTrack(track) { this.tracks.push(track) }
  async createOffer() { return { type: 'offer', sdp: 'offer-sdp' } }
  async createAnswer() { return { type: 'answer', sdp: 'answer-sdp' } }
  async setLocalDescription(d) { this.localDescription = d }
  async setRemoteDescription(d) { this.remoteDescription = d }
  async addIceCandidate(c) {
    if (!this.remoteDescription) throw new Error('addIceCandidate before remote description')
    this.candidates.push(c)
  }
  close() { this.closed = true }
}

function setup() {
  const socket = new FakeSocket()
  const peers = []
  const statuses = []
  const remotes = []
  const stream = { getTracks: () => ['audio', 'video'] }
  const session = createMeetingSession({
    stream,
    socket,
    createPeerConnection: () => { const p = new FakePeer(); peers.push(p); return p },
    onStatus: (s) => statuses.push(s),
    onRemoteStream: (r) => remotes.push(r),
  })
  return { socket, peers, statuses, remotes, session }
}

describe('meeting signalling', () => {
  let t
  beforeEach(() => { t = setup() })

  it('the first peer waits and never offers', async () => {
    t.socket.receive({ type: 'role', initiator: false })
    t.socket.receive({ type: 'peer-joined' })
    await t.session.idle()
    expect(t.socket.sent).toEqual([])
    expect(t.peers).toHaveLength(0)
    expect(t.statuses).toEqual(['waiting', 'peer-joining'])
  })

  it('the newcomer makes exactly one offer with its tracks attached', async () => {
    t.socket.receive({ type: 'role', initiator: true })
    await t.session.idle()
    expect(t.socket.sent).toEqual([{ type: 'offer', sdp: 'offer-sdp' }])
    expect(t.peers).toHaveLength(1)
    expect(t.peers[0].tracks).toEqual(['audio', 'video'])
  })

  it('answers an offer and applies candidates that arrived early, in order', async () => {
    // Candidate races ahead of the offer being processed
    t.socket.receive({ type: 'offer', sdp: 'their-offer' })
    t.socket.receive({ type: 'ice-candidate', candidate: { candidate: 'c1' } })
    t.socket.receive({ type: 'ice-candidate', candidate: { candidate: 'c2' } })
    await t.session.idle()
    const peer = t.peers[0]
    expect(peer.remoteDescription).toEqual({ type: 'offer', sdp: 'their-offer' })
    expect(peer.candidates).toEqual([{ candidate: 'c1' }, { candidate: 'c2' }])
    expect(t.socket.sent).toEqual([{ type: 'answer', sdp: 'answer-sdp' }])
    expect(t.statuses).not.toContain('error')
  })

  it('queues candidates until the answer sets the remote description', async () => {
    t.socket.receive({ type: 'role', initiator: true })
    await t.session.idle()
    t.socket.receive({ type: 'ice-candidate', candidate: { candidate: 'early' } })
    await t.session.idle()
    expect(t.peers[0].candidates).toEqual([])
    t.socket.receive({ type: 'answer', sdp: 'their-answer' })
    await t.session.idle()
    expect(t.peers[0].candidates).toEqual([{ candidate: 'early' }])
  })

  it('sends local ICE candidates only while the socket is open', async () => {
    t.socket.receive({ type: 'role', initiator: true })
    await t.session.idle()
    t.peers[0].onicecandidate({ candidate: { toJSON: () => ({ candidate: 'mine' }) } })
    t.socket.readyState = 0 // CONNECTING
    t.peers[0].onicecandidate({ candidate: { candidate: 'dropped' } })
    expect(t.socket.sent.at(-1)).toEqual({ type: 'ice-candidate', candidate: { candidate: 'mine' } })
    expect(t.socket.sent).toHaveLength(2)
  })

  it('reports the remote stream and resets when the peer leaves', async () => {
    t.socket.receive({ type: 'offer', sdp: 'x' })
    await t.session.idle()
    t.peers[0].ontrack({ streams: ['remote-stream'] })
    expect(t.remotes.at(-1)).toBe('remote-stream')
    t.socket.receive({ type: 'peer-left' })
    await t.session.idle()
    expect(t.peers[0].closed).toBe(true)
    expect(t.remotes.at(-1)).toBeNull()
    expect(t.statuses.at(-1)).toBe('waiting')
  })

  it('a second offer (peer rejoined) replaces the old connection', async () => {
    t.socket.receive({ type: 'offer', sdp: 'first' })
    t.socket.receive({ type: 'offer', sdp: 'second' })
    await t.session.idle()
    expect(t.peers).toHaveLength(2)
    expect(t.peers[0].closed).toBe(true)
    expect(t.peers[1].remoteDescription.sdp).toBe('second')
  })

  it('reports a full room and ignores junk frames', async () => {
    t.socket.onmessage({ data: 'not json' })
    t.socket.receive({ type: 'room-full' })
    await t.session.idle()
    expect(t.statuses).toEqual(['room-full'])
  })

  it('close() stops handling, closes the peer and the socket', async () => {
    t.socket.receive({ type: 'role', initiator: true })
    await t.session.idle()
    t.session.close()
    expect(t.peers[0].closed).toBe(true)
    expect(t.socket.closed).toBe(true)
    expect(t.socket.onmessage).toBeNull()
  })

  it('reports a server-side disconnect but not its own close', () => {
    const onclose = t.socket.onclose
    onclose()
    expect(t.statuses).toEqual(['disconnected'])
    t.session.close()
    expect(vi.isMockFunction(t.socket.onclose)).toBe(false)
  })
})
