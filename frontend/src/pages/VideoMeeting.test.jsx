import { createContext, useContext } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import VideoMeeting from './VideoMeeting'
import { stubRoutes } from '../test/helpers'

// Only the LiveKit browser SDK is replaced. The token request goes through the
// real API client to a stubbed fetch, like the other page tests.
const lk = vi.hoisted(() => ({ rooms: [], connectError: null, cameraError: null, micError: null }))

vi.mock('livekit-client', () => {
  const ConnectionState = { Disconnected: 'disconnected', Connecting: 'connecting', Connected: 'connected', Reconnecting: 'reconnecting', SignalReconnecting: 'signalReconnecting' }
  const RoomEvent = { ConnectionStateChanged: 'connectionStateChanged', Disconnected: 'disconnected', MediaDevicesError: 'mediaDevicesError' }
  const DisconnectReason = { UNKNOWN_REASON: 0, CLIENT_INITIATED: 1, DUPLICATE_IDENTITY: 2, SERVER_SHUTDOWN: 3, PARTICIPANT_REMOVED: 4, ROOM_DELETED: 5 }
  const failures = { NotAllowedError: 'PermissionDenied', NotFoundError: 'NotFound', NotReadableError: 'DeviceInUse' }
  const MediaDeviceFailure = { PermissionDenied: 'PermissionDenied', NotFound: 'NotFound', DeviceInUse: 'DeviceInUse', Other: 'Other', getFailure: (e) => failures[e?.name] ?? 'Other' }
  const Track = { Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' } }

  class Room {
    constructor(options) {
      this.options = options
      this.handlers = {}
      this.cameraTrack = { stop: vi.fn() }
      this.localParticipant = {
        identity: '1',
        name: 'olivia',
        isLocal: true,
        trackPublications: new Map([['cam', { track: this.cameraTrack }]]),
        setMicrophoneEnabled: vi.fn(async () => { if (lk.micError) throw lk.micError }),
        setCameraEnabled: vi.fn(async () => { if (lk.cameraError) throw lk.cameraError }),
      }
      this.remote = [{ identity: '2', name: 'eddie', isLocal: false }]
      this.connect = vi.fn(async () => { if (lk.connectError) throw lk.connectError })
      this.disconnect = vi.fn(async () => {})
      lk.rooms.push(this)
    }
    on(event, handler) { (this.handlers[event] ??= []).push(handler); return this }
    removeAllListeners() { this.handlers = {}; return this }
    emit(event, ...args) { (this.handlers[event] ?? []).forEach((h) => h(...args)) }
  }
  return { Room, RoomEvent, ConnectionState, DisconnectReason, MediaDeviceFailure, Track }
})

vi.mock('@livekit/components-react', () => {
  const RoomContext = createContext(undefined)
  const useRoom = () => useContext(RoomContext)
  const people = (room) => [room.localParticipant, ...room.remote]
  return {
    RoomContext,
    useParticipants: () => people(useRoom()),
    useTracks: () => people(useRoom()).map((participant) => ({ participant, source: 'camera', publication: { isMuted: false } })),
    isTrackReference: (t) => Boolean(t.publication),
    useIsSpeaking: (p) => p.identity === '2',
    useIsMuted: () => false,
    useTrackToggle: ({ source }) => ({ toggle: vi.fn(), enabled: source !== 'screen_share', pending: false }),
    useMediaDeviceSelect: ({ kind }) => ({
      devices: [{ deviceId: `${kind}-1`, label: kind === 'audioinput' ? 'Desk mic' : 'Webcam' }],
      activeDeviceId: `${kind}-1`,
      setActiveMediaDevice: vi.fn(async () => {}),
    }),
    VideoTrack: ({ trackRef }) => <video data-testid={`video-${trackRef.participant.identity}`} />,
    RoomAudioRenderer: () => null,
  }
})

const TOKEN_ROUTE = 'POST /projects/7/meeting/token'

function Away() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/elsewhere')}>go away</button>
}

function renderMeeting() {
  return render(
    <MemoryRouter initialEntries={['/projects/7/meeting']}>
      <Routes>
        <Route path="/projects/:projectId/meeting" element={<><VideoMeeting /><Away /></>} />
        <Route path="/elsewhere" element={<p>Somewhere else</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const status = () => screen.getAllByRole('status')[0]
const joinButton = () => screen.getByRole('button', { name: /Join/ })

async function joinCall() {
  const fetchMock = stubRoutes({ [TOKEN_ROUTE]: [200, { token: 'signed-token', url: 'wss://from-server' }] })
  renderMeeting()
  await userEvent.click(joinButton())
  await waitFor(() => expect(status()).toHaveTextContent('Connected'))
  return { fetchMock, room: lk.rooms.at(-1) }
}

describe('VideoMeeting', () => {
  beforeEach(() => {
    lk.rooms.length = 0
    lk.connectError = lk.cameraError = lk.micError = null
    vi.stubEnv('VITE_LIVEKIT_URL', 'wss://nexuscode.livekit.test')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('says video is not configured when there is no LiveKit URL, and offers no Join', () => {
    vi.stubEnv('VITE_LIVEKIT_URL', '')
    const fetchMock = stubRoutes({})
    renderMeeting()
    expect(screen.getByText('Video is not configured on this server.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Join/ })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks for nothing until Join is clicked', () => {
    const fetchMock = stubRoutes({})
    renderMeeting()
    expect(status()).toHaveTextContent('Not in the meeting.')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(lk.rooms).toHaveLength(0)
  })

  it('joins with the token, starts mic and camera, and shows everyone', async () => {
    const { fetchMock, room } = await joinCall()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(room.options).toMatchObject({ disconnectOnPageLeave: true })
    expect(room.connect).toHaveBeenCalledWith('wss://nexuscode.livekit.test', 'signed-token')
    await waitFor(() => expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true))
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)

    expect(await screen.findByText('2 people in the meeting')).toBeInTheDocument() // the call view loads lazily
    expect(screen.getByLabelText('olivia (you)')).toBeInTheDocument()
    expect(screen.getByLabelText('eddie')).toHaveAttribute('data-speaking', 'true')
    expect(screen.getByTestId('video-2')).toBeInTheDocument()
    for (const name of ['Mute', 'Camera off', 'Share screen', 'Leave']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByLabelText('Microphone')).toHaveValue('audioinput-1')
    expect(screen.getByLabelText('Camera')).toHaveValue('videoinput-1')
  })

  it('leaves cleanly, stopping its tracks, and can join again', async () => {
    const { room } = await joinCall()
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(room.disconnect).toHaveBeenCalledWith(true)
    expect(status()).toHaveTextContent('You left the meeting.')
    expect(screen.getByRole('button', { name: 'Join again' })).toBeInTheDocument()
  })

  it('ends the call when you navigate away', async () => {
    const { room } = await joinCall()
    await userEvent.click(screen.getByRole('button', { name: 'go away' }))
    expect(screen.getByText('Somewhere else')).toBeInTheDocument()
    expect(room.disconnect).toHaveBeenCalledWith(true)
  })

  it('asks LiveKit to leave the room when the tab is closed', async () => {
    // LiveKit listens for pagehide/beforeunload itself when this is on
    const { room } = await joinCall()
    expect(room.options.disconnectOnPageLeave).toBe(true)
  })

  it('never leaves a call behind when you navigate away while joining', async () => {
    let release
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { release = resolve })))
    renderMeeting()
    await userEvent.click(joinButton())
    await userEvent.click(screen.getByRole('button', { name: 'go away' }))
    await act(async () => {
      release({ ok: true, status: 200, json: () => Promise.resolve({ token: 't', url: 'u' }) })
    })
    expect(lk.rooms).toHaveLength(0)
  })

  it.each([
    [503, { detail: 'Video is not configured' }, 'Video is not configured on this server.'],
    [404, { detail: 'Project not found' }, "This project doesn't exist, or you're no longer a member."],
    [429, { detail: 'Too many requests' }, 'Too many join attempts. Wait a minute and try again.'],
  ])('explains a %i from the token request', async (code, body, text) => {
    stubRoutes({ [TOKEN_ROUTE]: [code, body] })
    renderMeeting()
    await userEvent.click(joinButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(lk.rooms).toHaveLength(0)
    expect(joinButton()).toBeEnabled()
  })

  it('explains a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    renderMeeting()
    await userEvent.click(joinButton())
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server")
  })

  it('explains a failed connection to LiveKit and cleans up', async () => {
    lk.connectError = new Error('could not establish signal connection')
    stubRoutes({ [TOKEN_ROUTE]: [200, { token: 't', url: 'u' }] })
    renderMeeting()
    await userEvent.click(joinButton())
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't connect to the video server")
    expect(lk.rooms[0].disconnect).toHaveBeenCalledWith(true)
    expect(joinButton()).toBeEnabled()
  })

  it('stays in the call when the camera is blocked, and says so', async () => {
    lk.cameraError = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    await joinCall()
    expect(await screen.findByText(/The browser blocked your camera/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument()
  })

  it('says when there is no microphone', async () => {
    lk.micError = Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' })
    await joinCall()
    expect(await screen.findByText(/No microphone was found/)).toBeInTheDocument()
  })

  it('shows reconnecting, then connected again', async () => {
    const { room } = await joinCall()
    act(() => room.emit('connectionStateChanged', 'reconnecting'))
    expect(status()).toHaveTextContent('Reconnecting')
    act(() => room.emit('connectionStateChanged', 'connected'))
    expect(status()).toHaveTextContent('Connected')
  })

  it('explains a call the server ended, and turns the camera off', async () => {
    const { room } = await joinCall()
    act(() => room.emit('disconnected', 4))
    expect(await screen.findByRole('alert')).toHaveTextContent('You were removed from this meeting.')
    expect(room.cameraTrack.stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Join again' })).toBeInTheDocument()
  })
})
