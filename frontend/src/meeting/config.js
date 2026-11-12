// The public LiveKit server URL (wss://...). Only this URL is known to the
// browser; the API key and secret stay on the backend, which signs the tokens.
export function livekitUrl() {
  return (import.meta.env.VITE_LIVEKIT_URL ?? '').trim()
}
