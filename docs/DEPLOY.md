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

## Video meetings (LiveKit): one-time setup
Video is optional: without these the app runs and the meeting page says video
isn't configured. No database migration is involved.
1. **LiveKit Cloud** (cloud.livekit.io): create a project for production (use a
   separate one for local development). Settings shows the URL
   (`wss://<project>.livekit.cloud`); Keys has the API key and secret.
2. **Render** (backend service → Environment): set `LIVEKIT_URL`,
   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Saving redeploys the backend. The
   secret only signs tokens on the backend; never put it in Vercel or the repo.
3. **Vercel** (frontend project → Settings → Environment Variables, Production):
   set `VITE_LIVEKIT_URL` to the same `wss://` URL. `VITE_*` values are baked in
   at build time, so **redeploy the frontend** afterwards (Deployments → ⋯ →
   Redeploy) or the page keeps saying video isn't configured.
4. Check: preflight shows `[ OK ] LiveKit vars`, then do the meeting smoke test
   in step 9.

## Rate-limit client IP (`TRUSTED_PROXY_HOPS`): one-time check

Per-IP rate limits (login, sign-up, password reset, email verification, OAuth)
key on the client's IP address. Behind Render's proxy that address is in
`X-Forwarded-For`, which a caller can also write into. The API therefore reads the
entry `TRUSTED_PROXY_HOPS` places from the **right**, which is the one Render's
proxy added (`backend/app/core/client_ip.py`). uvicorn runs with
`--no-proxy-headers`, so nothing else reads the header.

- **Setting:** Render → backend service → Environment: `TRUSTED_PROXY_HOPS`. Start
  with **1**; unset also means 1. `0` ignores the header, which is only right with no
  proxy at all. After a deploy, the first log lines say which value is in use:
  `Client IP for rate limits: X-Forwarded-For entry N from the right`.
- **Verify it once** after the first deploy, and again whenever Render's networking
  changes. You need two different internet connections, such as home Wi-Fi
  (network **A**) and your phone's mobile data through a hotspot (network **B**).
  There is no debug endpoint: the login limit (5 a minute per IP) is the probe. Use a
  username that doesn't exist, so no real account is touched. In PowerShell, replace
  `<backend>` with the Render URL:

  ```powershell
  $u = "https://<backend>/login"; $body = "username=ratelimit-check-nobody&password=not-the-password"
  ```

  **Check 1: no shared bucket.** On network A, run 6 failed logins:
  ```powershell
  1..6 | ForEach-Object { curl.exe -s -o NUL -w "%{http_code}`n" -X POST $u -d $body }
  ```
  Expect `401` five times, then `429`. **Within the same minute**, switch to network B
  and send one:
  ```powershell
  curl.exe -s -o NUL -w "%{http_code}`n" -X POST $u -d $body
  ```
  Expect **`401`**. A `429` here means everyone shares one bucket: the key landed
  on a proxy's address, not yours.

  **Check 2: no bypass.** Wait at least 60 seconds. Then on network A, send 6 failed
  logins, each claiming a different `X-Forwarded-For`:
  ```powershell
  1..6 | ForEach-Object { curl.exe -s -o NUL -w "%{http_code}`n" -H "X-Forwarded-For: 10.9.8.$_" -X POST $u -d $body }
  ```
  Expect `401` five times, then **`429`**. Six `401`s mean the caller's own entry is
  being trusted.

- **If a check fails:**

  | Check 1 (B not limited) | Check 2 (spoof still limited) | Change `TRUSTED_PROXY_HOPS` to |
  | --- | --- | --- |
  | passes | passes | nothing: done |
  | **fails** | passes | **2** (one more proxy than assumed), redeploy, re-run both checks |
  | passes | **fails** | **one less** (2 → 1), redeploy, re-run both checks |
  | fails | fails | **1**, redeploy, re-run. If it still fails, Render isn't appending to the header; record it in docs/FINAL-REVIEW.md (H1) |

  Changing an environment variable on Render redeploys the service, which takes a
  few minutes. Each check needs a fresh minute of the limit window.

## Content-Security-Policy for the app (report-only for now)

`frontend/vercel.json` sends `Content-Security-Policy-Report-Only` on every app page
(every path except `/assets/` and `/pyodide/`, whose worker scripts keep their own
policies). In report-only mode the browser **blocks nothing**: it only logs what it
would block. The policy allows:

| Directive | Allows | Why |
| --- | --- | --- |
| `script-src` | `'self'` plus one `sha256-…` hash | the app bundles, and index.html's inline theme script (the hash is checked by `vercelHeaders.test.js`) |
| `style-src` | `'self' 'unsafe-inline'` | Monaco and drag-and-drop inject `<style>` elements and style attributes at run time; they can't be hashed. No inline **scripts** are allowed. |
| `connect-src` | `'self'`, the Render API (`https://` and `wss://`), `https://*.livekit.cloud`, `wss://*.livekit.cloud`, `https://*.sentry.io` | API, chat and live-editing sockets, video meetings, error reports |
| `img-src` | `'self' data: blob: https://res.cloudinary.com` | icons, previews and uploaded images |
| `worker-src` | `'self' blob:` | Monaco and the code runners |
| `media-src` | `'self' blob: mediastream:` | meeting video |
| `object-src`, `base-uri`, `form-action`, `frame-ancestors` | `'none'` / `'self'` / `'self'` / `'none'` | lock-down |

**The origins are written into `vercel.json`, not read from env vars,** because
Vercel headers are static. If the Render API URL changes (it must match
`VITE_API_URL`), or LiveKit moves off LiveKit Cloud (`VITE_LIVEKIT_URL` not on
`*.livekit.cloud`), edit `connect-src` in `frontend/vercel.json` and the expected
list in `frontend/src/meeting/vercelHeaders.test.js`.

**Checked locally:** 16 pages and flows on the demo stack, with these exact
headers, report nothing except one known case: the **HTML preview**. A preview is
a sandboxed `srcdoc` frame, so it inherits the page's policy, and the project's own
inline `<script>`s (plus the console-capture script) are reported. The scripts
still run, because the policy is report-only. Video calls to LiveKit Cloud can only
be checked on the live site.

**Watch it on the live site** (after this is deployed to Vercel):
1. Open the site in Chrome, open DevTools (F12) → **Console**, and tick
   *Preserve log*.
2. Type `[Report Only]` in the console filter box.
3. Use the app the way people do: sign in, board and chat, the editor (open a file,
   Run, History), a **video meeting with a second person**, analytics, settings,
   the admin page.
4. Every line shown is something the policy would block. Expected: **none**, apart
   from the preview's inline scripts. For each other line, note the blocked URL and
   directive, and add the origin to that directive in `vercel.json` (and the test).

**Switching to enforcing** (a later, separate change):
1. **Give the HTML preview its own document first** (follow-up F1 in
   `docs/FINAL-REVIEW.md`). Today the preview is an `<iframe sandbox="allow-scripts"
   srcdoc=…>`. A `srcdoc` document **inherits the page's policy**, so once it is
   enforced, every `<script>` in a previewed project, and the console-capture
   script, is blocked. Pick one:
   - **(Recommended) A sandboxed route with its own policy.** Serve a static
     `/preview-frame.html` that is excluded from the app policy, like `/assets/` (add
     it to the rule's except list in `vercel.json` and in `vite.config.js`). Give it
     its own `Content-Security-Policy` that allows inline scripts but **no network**:
     `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
     img-src data: blob:`. Keep the iframe `sandbox="allow-scripts"` (an opaque
     origin, no cookies, no storage). PreviewPanel sends the HTML by `postMessage`,
     and the frame writes it with `document.open()/write()`. A frame loaded from a
     URL gets its own response's policy, not the parent's.
   - **A separate origin** (for example a second Vercel project on its own domain)
     serving the same frame. This is stronger isolation, at the cost of another
     deployment.

   Until then the preview shows up in report-only as the one expected entry
   (`Executing inline script violates … script-src`), and it keeps working.
2. Watch report-only on the live site for a few days of normal use with no
   unexplained `[Report Only]` lines.
3. In `frontend/vercel.json`, rename the key `Content-Security-Policy-Report-Only`
   to `Content-Security-Policy`, update `vercelHeaders.test.js` (it asserts
   report-only today), deploy, and repeat the walk-through above. Lines now read
   `Refused to …` instead of `[Report Only]`.
4. Rollback: rename the key back and redeploy. Vercel deploys in about a minute.

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
`RESULT: OK`; fix any FAIL before going further. (Against a fresh local database
the RLS check always FAILs, because RLS is turned on by hand in Supabase in step 8;
only production must pass it.)

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
tables)`. `Gemini (AI)` shows `SKIP` when no Gemini key is set (the app runs and the AI
features answer 503 "AI is not configured"), and `OK` when one is.
`LiveKit vars` shows `SKIP` when none of `LIVEKIT_*` is set (video meetings off),
`OK` when all three are set and `LIVEKIT_URL` starts with `wss://`, and `FAIL`
otherwise.

## 3. Open a PR and get CI green
Push the branch, open a PR into `main`. **Do not merge until CI is green**
(both the Backend and Frontend jobs). CI is the gate; a red run blocks the
deploy.

## 4. Note the current migration head (for rollback)
Record what revision production is on now, so you know the downgrade target if
you need it. The backup from step 1 and the preflight output both show it (e.g.
`0015_code_file_yjs`, or `0016_code_file_versions` after phase C9).

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
**Phase C9 (`0016_code_file_versions`)** adds one table, so run once after that
deploy:
```sql
ALTER TABLE public.code_file_versions ENABLE ROW LEVEL SECURITY;
```
Like the other tables it gets no policies: the backend connects as the table
owner, so the app is unaffected, and Supabase's public API can't read it.

Re-running preflight's RLS check (or the audit query) should then show every
table protected. The app connects as the table owner, so RLS does not change
its behaviour; it only closes Supabase's public API.

## 9. Live smoke test
In a browser, quickly exercise the changed area and the core flows:
- signed out, `/` shows the landing page (and a link preview uses `og-image.png`);
  signed in, `/` goes to your projects
- sign in; open a project; open the code editor
- run a file (Python and JS); open the AI panel
- open the same file in two sessions and confirm live editing + presence
- if the change touched auth/email/GitHub/agent, exercise that path
- video: two accounts join the same project's meeting and see and hear each
  other; Leave turns the camera light off

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
- The backend keeps chat and live-editing rooms, the rate limiter, ws-ticket
  store and the agent's daily-quota flag **in memory**, so it must run as a
  single instance. A restart saves open documents and clients reconnect.
  Video meetings keep no state here: rooms and participants live on LiveKit,
  so a backend restart doesn't end a call.
- First request after the free-tier service has slept waits for a cold start
  (up to ~1 min); `/health` and the editor both show that briefly.
