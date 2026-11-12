import { DisconnectReason, MediaDeviceFailure } from 'livekit-client'

export const NOT_CONFIGURED = 'Video is not configured on this server.'

// Why fetching the meeting token failed, in words for the person who clicked Join
export function joinErrorText(error) {
  if (error?.status === 503) return NOT_CONFIGURED
  if (error?.status === 404) return "This project doesn't exist, or you're no longer a member."
  if (error?.status === 429) return 'Too many join attempts. Wait a minute and try again.'
  if (error?.status === 0) return "Can't reach the server. Check your connection and try again."
  return error?.message || "Couldn't join the meeting. Please try again."
}

export const CONNECT_FAILED = "Couldn't connect to the video server. Check your connection and try again."

// A camera or microphone that couldn't be started. `what` is "camera", "microphone" or "screen"
export function mediaErrorText(error, what = 'camera or microphone') {
  // Cancelling the browser's screen picker isn't an error worth showing
  if (what === 'screen' && error?.name === 'NotAllowedError') return ''
  switch (MediaDeviceFailure.getFailure(error)) {
    case MediaDeviceFailure.PermissionDenied:
      return `The browser blocked your ${what}. Allow it in the address bar's site settings, then turn it on again.`
    case MediaDeviceFailure.NotFound:
      return `No ${what} was found. You can still join and listen.`
    case MediaDeviceFailure.DeviceInUse:
      return `Your ${what} is being used by another app. Close it and try again.`
    default:
      return `Couldn't start your ${what}${error?.message ? ` (${error.message})` : ''}.`
  }
}

// Why the call ended when you didn't press Leave
export function disconnectText(reason) {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'You joined this meeting from another tab or device, so this one was disconnected.'
    case DisconnectReason.PARTICIPANT_REMOVED:
      return 'You were removed from this meeting.'
    case DisconnectReason.ROOM_DELETED:
      return 'The meeting was closed.'
    case DisconnectReason.SERVER_SHUTDOWN:
      return 'The video server restarted. Join again to continue.'
    default:
      return 'The connection to the meeting was lost. Join again to continue.'
  }
}
