// What the sign-in page can offer (email, Google, GitHub), without waiting for
// the server. Pages render from these values at once; GET /auth/options only
// confirms them. A provider the server turns out not to offer is then disabled
// in place, so nothing ever pops in or moves.

const CACHE_KEY = "nexus.authOptions";

// Shown until the server says otherwise: every option this app supports.
export const OPTIMISTIC = Object.freeze({ email: true, google: true, github: true });

const clean = (data) => ({
  email: Boolean(data?.email),
  google: Boolean(data?.google),
  github: Boolean(data?.github),
});

// The last answer this browser saw, or null. Storage may be blocked: then null.
export function cachedAuthOptions() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? clean(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function cacheAuthOptions(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(clean(data)));
  } catch {
    // Storage blocked or full: fine, the next visit just starts optimistic
  }
}

// What to render before the server answers. A cached answer counts as known (it
// came from this server); the fresh request corrects it if it has changed.
export function initialAuthOptions() {
  const cached = cachedAuthOptions();
  return cached ? { ...cached, known: true } : { ...OPTIMISTIC, known: false };
}

export { clean as cleanAuthOptions };
