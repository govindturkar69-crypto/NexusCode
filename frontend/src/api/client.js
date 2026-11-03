// Single place for talking to the backend: base URL, auth header, error
// handling and the "session expired" redirect.

const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
const TOKEN_KEY = "token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// True if a token is stored and its `exp` claim hasn't passed. The server
// still verifies the signature; this only avoids using an obviously dead token.
export function hasValidToken() {
  const token = getToken();
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp !== "number" || payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function errorMessage(data, status) {
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  // FastAPI validation errors: [{ loc, msg, type }, ...]
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((d) => d.msg).filter(Boolean).join("; ");
  }
  return `Request failed (${status})`;
}

function redirectToLogin() {
  if (window.location.pathname !== "/login") {
    window.location.replace("/login");
  }
}

/**
 * fetch() wrapper.
 * - `body` is sent as JSON; `form` (FormData / URLSearchParams) is sent as-is
 * - attaches the bearer token unless `auth: false`
 * - throws ApiError on any non-2xx response
 * - on 401 for an authenticated call: clears the token and goes to /login
 */
export async function apiFetch(path, { method = "GET", body, form, auth = true, signal } = {}) {
  const headers = {};
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (form !== undefined) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: payload, signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);

  if (res.status === 401 && auth) {
    clearToken();
    redirectToLogin();
    throw new ApiError("Your session has expired. Please sign in again.", 401, data);
  }
  if (!res.ok) {
    throw new ApiError(errorMessage(data, res.status), res.status, data);
  }
  return data;
}

/**
 * Loads every page of a paginated list endpoint ({ [key]: [...], total }).
 * Uses the backend's maximum page size, so most lists take one request.
 */
export async function apiFetchAll(path, key, { pageSize = 200, signal } = {}) {
  const items = []
  const separator = path.includes('?') ? '&' : '?'
  for (let offset = 0; ; offset += pageSize) {
    const data = await apiFetch(`${path}${separator}limit=${pageSize}&offset=${offset}`, { signal })
    const page = data?.[key] ?? []
    items.push(...page)
    if (page.length === 0 || items.length >= (data?.total ?? 0)) return items
  }
}

// WebSocket URL for a backend path, with the token as ?token= (browsers can't
// set headers on WebSocket connections).
export function wsUrl(path) {
  const base = API_URL.replace(/^http/, "ws");
  return `${base}${path}?token=${encodeURIComponent(getToken() ?? "")}`;
}
