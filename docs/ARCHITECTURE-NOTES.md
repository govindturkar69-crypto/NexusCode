# NexusCode — architecture notes

A reference for the demo, the README, and future work. Describes what is actually
deployed today (through phase C3).

## System at a glance

```
                       ┌─────────────────────────────┐
   Browser  ──HTTPS──▶ │  Vercel (static React/Vite) │
   (React)             └─────────────┬───────────────┘
      │  REST + WebSocket (wss)      │ serves the SPA + workers + Pyodide
      ▼                              ▼
   ┌───────────────────────────────────────────────┐
   │  Render — FastAPI (uvicorn), single instance   │
   │  REST routers · WebSockets (chat, collab,      │
   │  meeting) · AI agent orchestration             │
   └──────────────┬───────────────────┬─────────────┘
                  │ SQLAlchemy         │ external
                  ▼                    ▼
   ┌───────────────────────┐   Gemini API (AI agent)
   │ Supabase Postgres     │   Cloudinary (file uploads)
   │ row-level security on │   Google / GitHub OAuth
   │ every table           │   Sentry (errors)
   └───────────────────────┘
```

Code execution (Python via **Pyodide**, JS via a sandboxed worker) runs **in the
browser**, not on the server. The server never runs user code.

## Backend (FastAPI)

- **Routers** (`backend/app/routers/`): `auth`, `oauth`, `identities`, `password`,
  `account`, `email` (accounts & sign-in); `projects`, `members`, `tasks`, `files`,
  `activity`, `analytics` (workspace); `code`, `collab`, `chat` (editor, live
  collab + chat/meeting WebSockets); `agent`, `ai` (AI assist + agent); `github`;
  `admin`.
- **Services** (`backend/app/services/`): `auth_tokens`, `accounts`, `oauth`,
  `email`, `github`, `storage` (Cloudinary), `realtime` (WebSocket room managers),
  `collab` (Yjs persistence), `code_paths`, `agent` + `ai` + `ai_assist` (Gemini),
  `activity`.
- **Auth**: JWT access tokens; bcrypt password hashing (`pwdlib`); single-use
  WebSocket tickets; `token_version` to revoke all sessions. OAuth for Google +
  GitHub. GitHub tokens stored **Fernet-encrypted at rest** (`EncryptedString`).
- **Authorization**: `require_project_role` with roles `viewer < editor < owner`;
  the `project_members` table is the source of truth. Enforced server-side **and**
  in Postgres via row-level security.
- **Realtime**: WebSockets for chat, collaborative editing, and the (current)
  meeting signaling. Room state is **in-memory** → tied to the single Render
  instance (see Constraints).
- **Security middleware**: per-response `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, and HSTS over HTTPS; CORS restricted to configured origins;
  rate limiting (slowapi, in-memory) on sensitive endpoints incl. `/ws-ticket`.
- **Migrations**: Alembic, single head `0015_code_file_yjs`.
- **Config**: `pydantic-settings` (`app/core/config.py`); DB via `DATABASE_URL` or
  individual `DB_*` vars (`app/core/database.py`).

## Frontend (React + Vite)

- **React 19 + Vite 8**, React Router 7. Dirs under `frontend/src/`: `pages`,
  `components`, `auth`, `projects`, `editor` (Monaco setup), `collab` (Yjs
  sessions, presence), `runners` (Pyodide + JS workers), `agent`, `api`, `meeting`
  (current WebRTC), `theme`, `observability` (Sentry).
- **Editor**: Monaco; Monaco self-hosted (no CDN). Collaborative editing with
  **Yjs** + `y-monaco` + `y-websocket`; awareness/presence; a fresh single-use
  ticket per (re)connect.
- **Code running**: **Pyodide** (self-hosted, downloaded on first Python Run) and a
  JS worker with an opaque origin. The AI agent's code runs in stricter workers
  with a Content-Security-Policy (see `docs/CSP-RETEST-CHECKLIST.md`).
- **Errors**: Sentry (`@sentry/react`).

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
- **CI** → GitHub Actions (backend tests on SQLite + Postgres, ruff, frontend
  Vitest + eslint + build).
- **Externals**: Gemini (AI), Cloudinary (uploads), Google/GitHub OAuth, Sentry.

## Constraints / things to know

- **Single-instance realtime**: chat/collab/meeting room state lives in memory, so
  it does not scale past one backend instance as-is. Fine for the current scale;
  would need a shared backplane (e.g. Redis) to scale out.
- **Cold starts**: Render free tier sleeps; first request after idle is slow.
  `/health` does a `SELECT 1`.
- **Browser-side execution**: no server-side sandbox to run; the agent's network is
  blocked in-worker and by CSP on its bundles.
- **Next up (C4)**: group video via LiveKit (SFU), replacing the 1:1 WebRTC
  signaling path — see `docs/C4-LIVEKIT-NOTES.md`.
