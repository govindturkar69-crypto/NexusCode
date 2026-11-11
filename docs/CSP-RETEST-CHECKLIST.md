# CSP re-test checklist (`csp-ready` branch)

This branch adds a **Content-Security-Policy to the two agent worker bundles only**
(`agentPythonWorker-*` and `agentJsWorker-*` under `/assets/`). Its purpose is to
stop the agent's sandboxed code from reaching the network via dynamic `import()`,
which cannot be stubbed in JS. Everything else is unchanged from `main`.

`csp-ready` = `phase-c2-worker-csp` + `main` merged in (merge commit `e64a719`),
plus a test-only fix (`c513c7d`) so the CSP test reads its fixtures by a
cwd-relative path. The original `phase-c2-worker-csp` branch is left untouched.

## What the CSP actually covers

From `frontend/vercel.json`:

| Path | CSP |
|------|-----|
| `/assets/agentPythonWorker-(.*)` | `default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; connect-src 'self'` |
| `/assets/agentJsWorker-(.*)` | `default-src 'none'; script-src 'unsafe-eval'; worker-src data: blob:` |
| `/(.*)` (the app document, every other asset) | **no CSP** — only `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` |

The key point: **the HTML document has no `Content-Security-Policy`.** The policy
is attached by Vercel per-response only when the browser fetches one of the two
worker script files. So the CSP constrains the agent's worker runtime and nothing
else on the page.

## Automated results on this branch

- Frontend: `vitest run` → **677 passed (45 files)**; `eslint` clean; `vite build` ✓.
- Backend: **0 files differ from `main`** (`git diff --stat main...csp-ready -- backend`
  is empty); `ruff` clean. Backend behaviour is exactly `main`'s.

## Manual re-test (run against the deployed preview, or `vite build && vite preview`)

`vite preview` replays `vercel.json` headers (see `previewWithVercelHeaders` in
`vite.config.js`), so the worker CSP can be exercised locally.

- [ ] **Monaco editor** loads and edits (own document, no CSP) — syntax highlight, typing, multi-file.
- [ ] **Pyodide** Python Run works — `/pyodide/<ver>/*` downloads, code runs, output shows. (User-triggered editor run, not the agent worker.)
- [ ] **JS runner (editor Run)** works — runs in a `data:` URL worker (opaque origin), output shows.
- [ ] **Agent Python worker** — ask the agent to run Python; confirm it executes and that a deliberate `import()`/`fetch` inside agent code is **blocked** (CSP doing its job), while normal agent runs still succeed.
- [ ] **Agent JS worker** — same: agent JS runs; network escape via dynamic import is blocked.
- [ ] **HTML preview** renders.
- [ ] **Google login** round-trips (OAuth redirect → app).
- [ ] **GitHub login / token** round-trips.
- [ ] **Sentry** still reports (frontend error is captured; no CSP blocks its ingest, since the document has no `connect-src`).
- [ ] **Yjs collab WebSocket** connects (`/ws/code-files/...`), presence + live edits work (document has no CSP, so `ws:`/`wss:` are unrestricted).
- [ ] Browser console shows **no unexpected CSP violation** reports during a normal session (only the intentional ones when agent code tries to escape).

## Does the CSP block LiveKit (C4)? — No

LiveKit needs `wss://*.livekit.cloud` (signaling) and media (`blob:`/getUserMedia,
WebRTC). Those happen **in the app document**, which has **no CSP** on this branch.
The two CSPs are scoped to the agent worker script files, which LiveKit never loads.

**Conclusion:** `csp-ready` does **not** block LiveKit. No directive change is
needed on this branch for C4.

If a document-level CSP is ever added later (it is **not** here), LiveKit would then
require at minimum:

- `connect-src wss://*.livekit.cloud https://*.livekit.cloud` (signaling + ICE/TURN over TLS)
- `media-src blob:` and `img-src blob:` (local/remote media)
- `worker-src blob:` (LiveKit spawns workers)
- plus `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self)` (that is a Permissions-Policy header, separate from CSP — tracked in the C4 notes).

## Verdict

**`csp-ready` is safe to merge to `main`** on its own merits: it only hardens the
agent workers, backend is byte-identical to `main`, and all tests + build pass. It
does not block LiveKit. Merge decision is the user's; this branch is not pushed.
