import {
  isTrackReference,
  RoomAudioRenderer,
  useIsMuted,
  useIsSpeaking,
  useMediaDeviceSelect,
  useParticipants,
  useTrackToggle,
  useTracks,
  VideoTrack,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { Mic, MicOff, MonitorUp, MonitorX, PhoneOff, Video, VideoOff } from 'lucide-react'
import Button from '../components/ui/Button'
import { mediaErrorText } from './messages'

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase()
}

// One person's camera, or their screen share
function Tile({ trackRef }) {
  const { participant, source } = trackRef
  const speaking = useIsSpeaking(participant)
  const videoMuted = useIsMuted(trackRef)
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone })
  const screen = source === Track.Source.ScreenShare
  const name = participant.name || participant.identity
  const showVideo = isTrackReference(trackRef) && !videoMuted
  const label = `${name}${participant.isLocal ? ' (you)' : ''}${screen ? ' — screen' : ''}`

  return (
    <figure
      className={`meeting-tile motion-scale-in${speaking && !screen ? ' meeting-tile--speaking' : ''}${screen ? ' meeting-tile--screen' : ''}`}
      aria-label={label}
      data-speaking={speaking && !screen ? 'true' : 'false'}
    >
      {showVideo ? (
        <VideoTrack trackRef={trackRef} className="meeting-tile__video" />
      ) : (
        <div className="meeting-tile__placeholder" aria-hidden="true">{initials(name)}</div>
      )}
      <figcaption className="meeting-tile__name">
        {!screen && micMuted && <span className="meeting-tile__muted" role="img" aria-label="microphone off" title="Microphone off"><MicOff size={13} aria-hidden="true" /></span>}
        {label}
      </figcaption>
    </figure>
  )
}

function DeviceSelect({ kind, label, onError }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind, requestPermissions: false, onError })
  if (devices.length === 0) return null
  return (
    <label className="meeting-device">
      <span className="small muted">{label}</span>
      <select
        className="input"
        value={activeDeviceId}
        onChange={(e) => setActiveMediaDevice(e.target.value).catch(onError)}
      >
        {devices.map((device, i) => (
          <option key={device.deviceId || i} value={device.deviceId}>
            {device.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  )
}

// The call itself. Must be rendered inside <RoomContext.Provider value={room}>.
export default function MeetingStage({ onLeave, onProblem }) {
  const participants = useParticipants()
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )
  const mic = useTrackToggle({ source: Track.Source.Microphone, onDeviceError: (e) => onProblem(mediaErrorText(e, 'microphone')) })
  const camera = useTrackToggle({ source: Track.Source.Camera, onDeviceError: (e) => onProblem(mediaErrorText(e, 'camera')) })
  const screen = useTrackToggle({ source: Track.Source.ScreenShare, onDeviceError: (e) => onProblem(mediaErrorText(e, 'screen')) })

  return (
    <section aria-label="Meeting">
      <p className="small muted meeting-count" aria-live="polite">
        {participants.length === 1 ? "You're the only one here." : `${participants.length} people in the meeting`}
      </p>

      <div className={`meeting-grid${tracks.length === 1 ? ' meeting-grid--single' : ''}`}>
        {tracks.map((trackRef) => (
          <Tile key={`${trackRef.participant.identity}:${trackRef.source}`} trackRef={trackRef} />
        ))}
      </div>

      <div className="meeting-controls row" role="toolbar" aria-label="Call controls">
        <Button className={`meeting-control ${mic.enabled ? '' : 'is-off'}`} variant="secondary" onClick={() => mic.toggle()} disabled={mic.pending} aria-pressed={!mic.enabled}
          icon={mic.enabled ? <Mic size={16} aria-hidden="true" /> : <MicOff size={16} aria-hidden="true" />}>
          {mic.enabled ? 'Mute' : 'Unmute'}
        </Button>
        <Button className={`meeting-control ${camera.enabled ? '' : 'is-off'}`} variant="secondary" onClick={() => camera.toggle()} disabled={camera.pending} aria-pressed={!camera.enabled}
          icon={camera.enabled ? <Video size={16} aria-hidden="true" /> : <VideoOff size={16} aria-hidden="true" />}>
          {camera.enabled ? 'Camera off' : 'Camera on'}
        </Button>
        <Button className={`meeting-control ${screen.enabled ? 'is-active' : ''}`} variant="secondary" onClick={() => screen.toggle()} disabled={screen.pending} aria-pressed={screen.enabled}
          icon={screen.enabled ? <MonitorX size={16} aria-hidden="true" /> : <MonitorUp size={16} aria-hidden="true" />}>
          {screen.enabled ? 'Stop sharing' : 'Share screen'}
        </Button>
        <Button className="meeting-control" variant="danger-solid" onClick={onLeave} icon={<PhoneOff size={16} aria-hidden="true" />}>Leave</Button>
      </div>

      <div className="meeting-devices row">
        <DeviceSelect kind="audioinput" label="Microphone" onError={(e) => onProblem(mediaErrorText(e, 'microphone'))} />
        <DeviceSelect kind="videoinput" label="Camera" onError={(e) => onProblem(mediaErrorText(e, 'camera'))} />
      </div>

      {/* Plays everyone else's audio */}
      <RoomAudioRenderer />
    </section>
  )
}
