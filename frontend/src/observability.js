// Error tracking. Sentry is loaded only when VITE_SENTRY_DSN is set at build
// time, as a separate chunk, so it costs nothing otherwise.
let sentry = null;

export async function initSentry(dsn = import.meta.env.VITE_SENTRY_DSN, loadSdk = () => import("@sentry/react")) {
  if (!dsn) return false;
  const Sentry = await loadSdk();
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    // Errors only; no performance tracing or session replay
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  sentry = Sentry;
  return true;
}

export function reportError(error, context) {
  if (sentry) sentry.captureException(error, context ? { extra: context } : undefined);
}
