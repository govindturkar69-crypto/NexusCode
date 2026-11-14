import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api/client'
import { livekitUrl } from './config'
import { CONNECT_FAILED, disconnectText, joinErrorText, mediaErrorText, NOT_CONFIGURED } from './messages'

/**
 * One project's LiveKit call.
 *
 *   phase: idle | joining | connected | reconnecting | left
 *   room:  the connected Room (for RoomContext), or null
 *   error: why joining failed or the call ended (shown instead of the call)
 *   notice: a problem that doesn't stop the call (no camera, mic blocked, ...)
 *
 * The token, and the LiveKit client itself (~440 kB), are fetched only in join(),
 * never on load, so the lobby shows at once. Leaving, unmounting (route
 * change) and closing the tab all disconnect and stop the local tracks, so the
 * camera light goes off.
 */
// Stops our own camera, microphone and screen tracks (the camera light goes off)
export function stopLocalTracks(room) {
  for (const publication of room.localParticipant?.trackPublications?.values?.() ?? []) {
    publication.track?.stop()
  }
}

export function useMeetingRoom(projectId) {
  const [phase, setPhase] = useState('idle')
  const [room, setRoom] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const roomRef = useRef(null)
  // Bumped by every join and leave: a slower, older join that finishes later
  // sees it changed and gives up (and disconnects what it made)
  const attemptRef = useRef(0)
  const cancelPending = useCallback(() => {
    attemptRef.current += 1
  }, [])

  const closeRoom = useCallback(() => {
    const current = roomRef.current
    roomRef.current = null
    if (current) {
      current.removeAllListeners()
      // true: also stops the camera, microphone and screen tracks
      return current.disconnect(true)
    }
  }, [])

  const join = useCallback(async () => {
    const attempt = ++attemptRef.current
    const stale = () => attempt !== attemptRef.current
    setError('')
    setNotice('')
    const url = livekitUrl()
    if (!url) {
      setError(NOT_CONFIGURED)
      return
    }
    setPhase('joining')

    let token
    try {
      token = (await apiFetch(`/projects/${projectId}/meeting/token`, { method: 'POST' })).token
    } catch (err) {
      if (stale()) return
      setError(joinErrorText(err))
      setPhase('idle')
      return
    }
    if (stale()) return

    let livekit
    try {
      livekit = await import('livekit-client')
    } catch {
      if (stale()) return
      setError(CONNECT_FAILED)
      setPhase('idle')
      return
    }
    if (stale()) return
    const { ConnectionState, Room, RoomEvent } = livekit

    const next = new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true })
    roomRef.current = next
    next.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (roomRef.current !== next) return
      if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) setPhase('reconnecting')
      else if (state === ConnectionState.Connected) setPhase('connected')
    })
    next.on(RoomEvent.Disconnected, (reason) => {
      // Only a disconnect we didn't ask for gets here: leave() removes the listeners first
      if (roomRef.current !== next) return
      roomRef.current = null
      next.removeAllListeners()
      stopLocalTracks(next)
      setRoom(null)
      setPhase('idle')
      setError(disconnectText(reason))
    })
    next.on(RoomEvent.MediaDevicesError, (err) => {
      if (roomRef.current === next) setNotice(mediaErrorText(err))
    })

    try {
      await next.connect(url, token)
    } catch {
      if (roomRef.current === next) closeRoom()
      if (stale()) return
      setError(CONNECT_FAILED)
      setPhase('idle')
      return
    }
    if (stale() || roomRef.current !== next) {
      // Left, or the page went away, while connecting
      if (roomRef.current === next) closeRoom()
      else next.disconnect(true)
      return
    }
    setRoom(next)
    setPhase('connected')

    // Start the microphone, then the camera. Either can fail (blocked, missing,
    // in use) without ending the call: you can still see and hear the others.
    const problems = []
    for (const [what, enable] of [
      ['microphone', () => next.localParticipant.setMicrophoneEnabled(true)],
      ['camera', () => next.localParticipant.setCameraEnabled(true)],
    ]) {
      try {
        await enable()
      } catch (err) {
        problems.push(mediaErrorText(err, what))
      }
      if (stale()) return
    }
    if (problems.length) setNotice(problems.join(' '))
  }, [projectId, closeRoom])

  const leave = useCallback(async () => {
    cancelPending()
    setRoom(null)
    setNotice('')
    setError('')
    setPhase('left')
    await closeRoom()
  }, [cancelPending, closeRoom])

  const clearNotice = useCallback(() => setNotice(''), [])

  // Route change or project change: end the call
  useEffect(() => {
    return () => {
      cancelPending()
      closeRoom()
    }
  }, [projectId, cancelPending, closeRoom])

  return { phase, room, error, notice, join, leave, setNotice, clearNotice }
}
