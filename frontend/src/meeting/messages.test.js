import { describe, it, expect } from 'vitest'
import { DisconnectReason } from 'livekit-client'
import { ApiError } from '../api/client'
import { disconnectText, joinErrorText, mediaErrorText, NOT_CONFIGURED } from './messages'

// Uses the real livekit-client classification of browser media errors
const domError = (name) => Object.assign(new Error(name), { name })

describe('meeting messages', () => {
  it('names the camera or microphone problem the browser reported', () => {
    expect(mediaErrorText(domError('NotAllowedError'), 'camera')).toMatch(/blocked your camera/)
    expect(mediaErrorText(domError('NotFoundError'), 'microphone')).toMatch(/No microphone was found/)
    expect(mediaErrorText(domError('NotReadableError'), 'camera')).toMatch(/being used by another app/)
    expect(mediaErrorText(new Error('weird'), 'camera')).toMatch(/Couldn't start your camera \(weird\)/)
  })

  it('stays quiet when someone cancels the screen picker', () => {
    expect(mediaErrorText(domError('NotAllowedError'), 'screen')).toBe('')
  })

  it('explains token failures by status', () => {
    expect(joinErrorText(new ApiError('x', 503))).toBe(NOT_CONFIGURED)
    expect(joinErrorText(new ApiError('x', 404))).toMatch(/no longer a member/)
    expect(joinErrorText(new ApiError('x', 429))).toMatch(/Too many/)
    expect(joinErrorText(new ApiError('x', 0))).toMatch(/Can't reach the server/)
    expect(joinErrorText(new ApiError('Something specific', 500))).toBe('Something specific')
  })

  it('explains why a call ended', () => {
    expect(disconnectText(DisconnectReason.DUPLICATE_IDENTITY)).toMatch(/another tab or device/)
    expect(disconnectText(DisconnectReason.PARTICIPANT_REMOVED)).toMatch(/removed/)
    expect(disconnectText(DisconnectReason.ROOM_DELETED)).toMatch(/closed/)
    expect(disconnectText(undefined)).toMatch(/connection to the meeting was lost/)
  })
})
