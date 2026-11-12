# Deploy runbook

How to ship a change to production (Render backend + Supabase Postgres + Vercel
frontend) safely. Do the steps in order. Never run writes or DDL against the
production database by hand except the RLS statements in step 8.

## Setup this assumes
- **Backend**: Render web service, auto-deploys from `main`. On start it runs
  `python scripts/migrate.py` then uvicorn (see `backend/Dockerfile`).
- **Database**: Supabase Postgres, reached through the **Session pooler** (port
  5432). The password lives in `backend/.env` locally and in Render's env.
- **Frontend**: Vercel, auto-deploys from `main`.
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR:
  ruff + pytest (SQLite and Postgres), eslint + Vitest + vite build.

## 1. Back up the database first
Take a fresh dump before anything that could touch data (always before a
migration). Use your read-only backup script; it reads the password from
`backend/.env` and never prints it. Confirm it reports `pg_dump exit code: 0`
and lists all tables. Keep the `.dump` file (they're gitignored and live
outside the repo).

## 2. Preflight (local, read-only)
Preflight checks required env vars, DB connectivity, that the DB is at the
alembic head, RLS on every public table, and (with `--health-url`) a running
`/health`. It only runs `SELECT`s and never prints a value. Expect
`RESULT: OK`; fix any FAIL before going further.

**Point it at production.** Preflight reads `backend/.env`, but environment
variables override it. A local `.env` usually has `DB_PASSWORD` and no
`DB_HOST`/`DATABASE_URL`, so a bare `python scripts/preflight.py` checks
**localhost**, not production (it fails with `database connectivity -
OperationalError`). Give it the Session pooler host and user for that one run.
In PowerShell, from `backend/`:
```powershell
# Supabase: Connect > Session pooler shows the host (ends in pooler.supabase.com)
# and the user (postgres.<project-ref>). The password still comes from backend/.env.
$env:DB_HOST = Read-Host "Pooler host"
$env:DB_USER = Read-Host "Pooler user"
$env:DB_PORT = "5432"; $env:DB_NAME = "postgres"; $env:DB_SSLMODE = "require"
try { python scripts/preflight.py --health-url https://<your-backend>/health }
finally { "DB_HOST","DB_USER","DB_PORT","DB_NAME","DB_SSLMODE" | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue } }
```
(On bash: `DB_HOST=... DB_USER=... DB_PORT=5432 DB_NAME=postgres DB_SSLMODE=require python scripts/preflight.py`.)
Check the output says `DB at alembic head (...)` and `row-level security (all N
tables)`. `LiveKit vars` shows `SKIP` until any `LIVEKIT_*` is set and `OK` once
all three are.

## 3. Open a PR and get CI green
Push the branch, open a PR into `main`. **Do not merge until CI is green**
(both the Backend and Frontend jobs). CI is the gate; a red run blocks the
deploy.

## 4. Note the current migration head (for rollback)
Record what revision production is on now, so you know the downgrade target if
you need it. The backup from step 1 and the preflight output both show it (e.g.
`0015_code_file_yjs`).

## 5. Merge to `main`
Merge the PR. Render and Vercel start deploying automatically.

## 6. Watch the Render deploy logs
In the Render dashboard, open the service's **Logs**. Confirm:
- `scripts/migrate.py` ran and either upgraded or reported "up to date"
  (no "STOP" / stamping error).
- uvicorn started and the service went **Live**.

## 7. Check /health and the new migration
- Hit `https://<your-backend>.onrender.com/health` — expect `200`.
- Re-run preflight against production to confirm the head advanced:
  ```
  python scripts/preflight.py --health-url https://<your-backend>.onrender.com/health
  ```
  Expect `DB at alembic head (<new revision>)` and `RESULT: OK`.

## 8. Enable RLS on any new table (manual, one-time per new table)
New tables are created by the migration with RLS **off**. Turn it on in the
Supabase SQL editor (safe; does not touch data). For each new table:
```sql
ALTER TABLE public.<new_table> ENABLE ROW LEVEL SECURITY;
```
Re-running preflight's RLS check (or the audit query) should then show every
table protected. The app connects as the table owner, so RLS does not change
its behaviour; it only closes Supabase's public API.

## 9. Live smoke test
In a browser, quickly exercise the changed area and the core flows:
- sign in; open a project; open the code editor
- run a file (Python and JS); open the AI panel
- open the same file in two sessions and confirm live editing + presence
- if the change touched auth/email/GitHub/agent, exercise that path

## 10. Rollback (if needed)
- **Code**: in Render, **Rollback** to the previous deploy (or revert the merge
  commit on `main` and let it redeploy).
- **Schema**: only if a migration caused the problem and a downgrade is safe.
  Downgrades can lose data, so restore the step-1 backup instead when in doubt.
  A manual downgrade, from a machine with the production `DATABASE_URL` set:
  ```
  cd backend && alembic downgrade <previous_revision>
  ```
  Prefer restoring the backup over downgrading a destructive migration.

## Notes
- The backend keeps live-editing rooms, the rate limiter, ws-ticket store and
  the agent's daily-quota flag **in memory**, so it must run as a single
  instance. A restart saves open documents and clients reconnect.
- First request after the free-tier service has slept waits for a cold start
  (up to ~1 min); `/health` and the editor both show that briefly.
