# NexusCode — architecture notes

A reference for the demo, the README, and future work. Describes what is actually
deployed today (through phase C5: group video and the public landing page).
The README has the same picture as a Mermaid diagram.

## System at a glance

```
                       ┌─────────────────────────────┐
   Browser  ──HTTPS──▶ │  Vercel (static React/Vite) │
   (React)             └─────────────┬───────────────┘
      │  REST + WebSocket (wss)      │ serves the SPA + workers + Pyodide
      ▼                              ▼
   ┌───────────────────────────────────────────────┐
   │  Render — FastAPI (uvicorn), single instance   │
   │  REST routers · WebSockets (chat, collab)      │
   │  AI agent orchestration · LiveKit token signer │
   └──────────────┬───────────────────┬─────────────┘
                  │ SQLAlchemy         │ external
                  ▼                    ▼
   ┌───────────────────────┐   Gemini API (AI assistant + agent)
   │ Supabase Postgres     │   Cloudinary (file uploads)
   │ row-level security on │   GitHub API (push) · Google / GitHub OAuth
   │ every table           │   Resend (email) · Sentry (errors)
   └───────────────────────┘   LiveKit server API (remove a participant)

   Browser ══ wss + WebRTC media ══▶ LiveKit Cloud (SFU)
            (with a token from POST /projects/{id}/meeting/token)
```

Video meetings: the browser gets a 1-hour LiveKit token from the backend, then
connects **directly** to LiveKit. Audio, video and room membership live on
LiveKit; the backend never sees media and keeps no meeting state.

Code execution (Python via **Pyodide**, JS via a sandboxed worker) runs **in the
browser**, not on the server. The server never runs user code.

## Backend (FastAPI)

- **Routers** (`backend/app/routers/`): `auth`, `oauth`, `identities`, `password`,
  `account`, `email` (accounts & sign-in); `projects`, `members`, `tasks`, `files`,
  `activity`, `analytics` (workspace); `code`, `collab`, `chat` (editor, live
  collab + chat WebSockets); `meetings` (LiveKit token); `agent`, `ai` (AI assist
  + agent); `github`; `admin`; `archive` (project ZIP export/import).
- **Project analytics**: `GET /projects/{id}/analytics?range=7|14|30` (any member)
  in `services/project_analytics.py`. GROUP BY queries plus one query per table, so
  the query count doesn't grow with the data (tested). Tasks have no completion
  column: a done task's completion time is its latest `task_moved` "<title> → Done"
  activity entry; tasks that can't be matched are reported as undated.
- **ZIP export/import**: `GET /projects/{id}/export` (any member) builds the ZIP on
  the server (code/, tasks.json without emails, README). `POST
  /projects/{id}/code/import` (owner/editor) is two-step (dry run, then the real
  run with skip/rename choices) and re-checks everything each time in
  `services/project_archive.py`: zip-slip and absolute paths via `path_problem`,
  symlinks, binaries and non-UTF-8, entry/size/ratio caps (zip bombs), duplicates,
  file/folder clashes and the 500-file limit. The upload is capped at 5 MB from
  `Content-Length` before the body is read.
- **Services** (`backend/app/services/`): `auth_tokens`, `accounts`, `oauth`,
  `email`, `github`, `storage` (Cloudinary), `realtime` (WebSocket room managers),
  `collab` (Yjs persistence), `code_paths`, `agent` + `ai` + `ai_assist` (Gemini),
  `activity`, `meetings` (LiveKit: token signing, removing a participant who
  lost access).
- **Auth**: JWT access tokens; bcrypt password hashing (`pwdlib`); single-use
  WebSocket tickets; `token_version` to revoke all sessions. OAuth for Google +
  GitHub. GitHub tokens stored **Fernet-encrypted at rest** (`EncryptedString`).
- **Authorization**: `require_project_role` with roles `viewer < editor < owner`;
  the `project_members` table is the source of truth. Enforced server-side **and**
  in Postgres via row-level security.
- **Realtime**: WebSockets for chat and collaborative editing. Room state is
  **in-memory** → tied to the single Render instance (see Constraints). Video is
  not here: it runs on LiveKit.
- **Video meetings**: `POST /projects/{id}/meeting/token` (any member; 404 for
  others; rate limited) signs a LiveKit token: identity = user id, name =
  username, room `nexuscode-project-<id>`, publish/subscribe/data grants, 1 hour.
  Off (503) unless `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` are set.
  Removing a member or deleting an account removes them from a live call through
  LiveKit's server API (best effort, 5 s timeout).
- **Security middleware**: per-response `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, and HSTS over HTTPS; CORS restricted to configured origins;
  rate limiting (slowapi, in-memory) on sensitive endpoints incl. `/ws-ticket`.
- **Migrations**: Alembic, single head `0016_code_file_versions`.
- **Version history** (`services/versions.py`, `routers/versions.py`, design in
  `docs/VERSION-HISTORY.md`): snapshots are taken inside `save_file`, the one save
  path, under each live room's save lock, from the committed text. Throttled to one a
  minute per file and de-duplicated by hash; the last save before a room empties is
  always kept; 50 per file. Restore goes through the live Yjs document and commits
  the text, document and a new `restore` version in one transaction.
- **Config**: `pydantic-settings` (`app/core/config.py`); DB via `DATABASE_URL` or
  individual `DB_*` vars (`app/core/database.py`).

## Frontend (React + Vite)

- **Landing page**: signed-out visitors to `/` get `pages/Landing.jsx` (its own lazy
  chunk; words in `landing/content.js`); signed-in users are sent to `/projects`
  (`components/HomeRoute.jsx`). `index.html` carries the description, canonical URL
  and Open Graph / Twitter tags, with `public/og-image.png` as the preview.
- **React 19 + Vite 8**, React Router 7. Dirs under `frontend/src/`: `pages`,
  `components`, `auth`, `projects`, `editor` (Monaco setup), `collab` (Yjs
  sessions, presence), `runners` (Pyodide + JS workers), `agent`, `api`, `meeting`
  (LiveKit call: `useMeetingRoom` hook + `MeetingStage` grid/controls, built on
  `livekit-client` and `@livekit/components-react`), `theme`, `observability`
  (Sentry).
- **Video**: the token is fetched only on Join; Leave, route change and tab close
  disconnect and stop local tracks. `VITE_LIVEKIT_URL` (public URL) gates the
  page. Vercel sends `Permissions-Policy: camera=(self), microphone=(self),
  display-capture=(self)`; the document has no CSP, so LiveKit isn't blocked.
- **Editor**: Monaco; Monaco self-hosted (no CDN). Collaborative editing with
  **Yjs** + `y-monaco` + `y-websocket`; awareness/presence; a fresh single-use
  ticket per (re)connect.
- **Code running**: **Pyodide** (self-hosted, downloaded on first Python Run) and a
  JS worker with an opaque origin. The AI agent's code runs in stricter workers
  with a Content-Security-Policy (see `docs/CSP-RETEST-CHECKLIST.md`).
- **Errors**: Sentry (`@sentry/react`).
- **Command palette** (`palette/`): the shell holds only the Ctrl/Cmd+K listener and
  the Search button; the palette itself is a lazy chunk. It is an ARIA combobox in a
  modal dialog, with fuzzy matching (`palette/fuzzy.js`), recents in localStorage
  (guarded) and role-aware actions. Pages act on `?do=` links (`utils/useDoParam.js`):
  `new-task`, `task`, `new-file`, `open`, `agent`, `join`. Inside Monaco, Ctrl/Cmd+K is
  left to Monaco's chords.
- **Project analytics page** (`pages/ProjectAnalytics.jsx`, lazy): Recharts charts in
  their own lazy chunk; each chart is a figure with a summary and a data table.
- **Version history panel** (`components/HistoryPanel.jsx`, lazy): timeline, Monaco
  `DiffEditor` against the editor's current text, restore with a confirm dialog;
  the editor lands its pending autosave first so it can't overwrite a restore.
- **ZIP**: export downloads with progress (`api/archive.js`); the import dialog
  (lazy) uploads with XHR for upload progress and shows the server's preview.

## Data model (Postgres)

Core tables: `users`, `projects`, `project_members`, `tasks`, `files`, `messages`,
`activity`, `notifications`, `code_files`, `code_file_yjs` (CRDT state blob per
file), `agent_runs`, `auth_tokens`, `oauth_identities`. **Row-level security is on
for every table.** A new table added in a migration must have RLS enabled as part
of the deploy (see `docs/DEPLOY.md`).

## Deployment

- **Frontend** → Vercel (static build; headers in `frontend/vercel.json`).
- **Backend** → Render (free tier, single instance; configured via dashboard — no
  `render.yaml`).
- **Database** → Supabase managed Postgres (session pooler), RLS enforced.
- **CI** → GitHub Actions: ruff + pytest against Postgres 16; eslint, Vitest,
  vite build and `npm audit --omit=dev`. (SQLite is the default for local test runs.)
- **Externals**: Gemini (AI), Cloudinary (uploads), GitHub API (push), Google/GitHub
  OAuth, Resend (email), Sentry, LiveKit Cloud (video).

## Constraints / things to know

- **Single instance**: chat and live-editing rooms, rate-limit counters and the
  WebSocket-ticket store live in memory, so it does not scale past one backend
  instance as-is. Fine for the current scale;
  would need a shared backplane (e.g. Redis) to scale out.
- **Cold starts**: Render free tier sleeps; first request after idle is slow.
  `/health` does a `SELECT 1`.
- **Browser-side execution**: no server-side sandbox to run; the agent's network is
  blocked in-worker and by CSP on its bundles.
- **Video depends on LiveKit**: if LiveKit is down or not configured, meetings
  are unavailable but nothing else is affected.
- **Demo**: `backend/scripts/seed_demo.py` and `docs/DEMO-SCRIPT.md`.
