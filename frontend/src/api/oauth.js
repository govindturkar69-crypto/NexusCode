import { apiFetch } from "./client";

// Signing in with Google or GitHub. This tab makes two secrets, a
// nonce and a PKCE code verifier, and keeps them in sessionStorage, which belongs
// to this tab only. The server needs both to finish the sign-in, so a code that
// leaks on its way back is useless anywhere else.

const PENDING_KEY = "nexus.oauth.pending";
// Matches the server's state lifetime
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

export const PROVIDERS = {
  google: { name: "Google" },
  github: { name: "GitHub" },
};

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(byteCount) {
  return base64url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * Asks the server for the provider's sign-in page and goes there.
 * intent "login" signs in or creates an account; "link" adds the provider to the
 * signed-in account. `returnTo` is where to land afterwards.
 */
export async function startOAuth(provider, { intent = "login", returnTo = "/projects", go = (url) => window.location.assign(url) } = {}) {
  const nonce = randomString(32);
  const verifier = randomString(48);
  const challenge = await pkceChallenge(verifier);
  const { url } = await apiFetch(`/auth/oauth/${provider}/start`, {
    method: "POST",
    body: { nonce, code_challenge: challenge, intent },
    auth: intent === "link",
  });
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ provider, nonce, verifier, intent, returnTo, startedAt: Date.now() }));
  go(url);
}

// The secrets for a sign-in this tab started. Null if there's none, it's for
// another provider, or it's old. Reading has no side effects.
export function peekPendingOAuth(provider) {
  let pending;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY));
  } catch {
    pending = null;
  }
  if (!pending || pending.provider !== provider || typeof pending.nonce !== "string" || typeof pending.verifier !== "string") return null;
  if (!(Date.now() - pending.startedAt < PENDING_MAX_AGE_MS)) return null;
  // Only ever go back to a page inside the app
  const returnTo = typeof pending.returnTo === "string" && /^\/(?!\/)/.test(pending.returnTo) ? pending.returnTo : "/projects";
  return { ...pending, returnTo };
}

// Same, and removes them, so they can't be used twice
export function takePendingOAuth(provider) {
  const pending = peekPendingOAuth(provider);
  sessionStorage.removeItem(PENDING_KEY);
  return pending;
}

export function completeOAuth(provider, { code, state, nonce, verifier, intent }) {
  return apiFetch("/auth/oauth/complete", {
    method: "POST",
    body: { provider, code, state, nonce, code_verifier: verifier },
    // A link is finished by the account that started it
    auth: intent === "link",
  });
}

export function linkWithPassword(linkToken, password) {
  return apiFetch("/auth/oauth/link", { method: "POST", body: { link_token: linkToken, password }, auth: false });
}
