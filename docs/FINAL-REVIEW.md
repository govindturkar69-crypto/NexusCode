# Final review (phase C11)

A full review of NexusCode at `v1.2` (main `9176502`), on branch
`phase-c11-final-review`. Everything was checked locally, against throwaway databases only.
Production was not touched.

**Severity:** Critical (exploitable now, serious impact) · High (exploitable, real
impact, or a security control that doesn't do what the docs say) · Medium (a real
weakness that needs extra conditions) · Low (hardening, hygiene).

**Status:** ✅ fixed on this branch (with a test) · 🟨 decision for the maintainer (it
changes behaviour, needs a migration, or depends on something only the maintainer can
check) · ℹ️ noted, no action.

## Summary

| Severity | Found | Fixed | For decision | Noted |
| --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 |
| High | 1 | 0 | 1 | 0 |
| Medium | 6 | 3 | 3 | 0 |
| Low | 11 | 3 | 4 | 4 |

No Critical findings. The authorization model holds: the new matrix test found **no
gaps** across all 90 routes.

## Findings

### H1 ✅ (C11b; verify on Render) Per-IP rate limits could be bypassed by sending `X-Forwarded-For`

- **Where:** `backend/Dockerfile:38` (`--proxy-headers --forwarded-allow-ips='*'`);
  `backend/app/core/rate_limit.py:47` (`key_func=get_remote_address`).
- **Evidence:** with every proxy trusted, uvicorn 0.49 takes the **leftmost**
  `X-Forwarded-For` entry, which is the one the client wrote. A local check with
  `ProxyHeadersMiddleware(trusted_hosts="*")` and the header `6.6.6.6, 203.0.113.9`
  gives the app `6.6.6.6`. So a script that sends a new `X-Forwarded-For` on every
  request gets a fresh bucket each time. That covers the limits on login, sign-up,
  password reset, email verification and OAuth start. Signed-in routes use
  `user_or_ip` and key on the user, so they aren't affected.
- **Impact:** online password guessing isn't throttled, beyond bcrypt's cost. Reset
  and verification emails can be sent in volume, which uses up the Resend quota.
- **Fix options:**
  1. **(Recommended)** Key the limiter on the **rightmost** `X-Forwarded-For` entry:
     the address Render's proxy itself appended. First confirm on Render that exactly
     one proxy hop appends to the header: log `X-Forwarded-For` for one request sent
     with a fake header.
  2. Trust only Render's proxy range in `--forwarded-allow-ips`, if Render publishes one.
  3. Keep it as it is, and document that the per-IP limits are best-effort.
- **Why not fixed here:** the right answer depends on Render's proxy chain, which
  can only be checked on the live service.

### M1 ✅ Failed logins revealed which usernames exist (timing)

- **Where:** `backend/app/routers/auth.py:44`, `backend/app/core/security.py:verify_password`.
- **Evidence:** an unknown username, or an account with no password (Google/GitHub
  only), failed **before** bcrypt ran. That is about 200 ms faster than a wrong
  password for a real account.
- **Fix:** `verify_password` checks a dummy bcrypt hash when there's no real one, and
  login always calls it. The status and message are unchanged. Test:
  `test_failed_logins_spend_the_same_bcrypt_work_whether_or_not_the_user_exists`.
- **Note:** sign-up still says "Username already taken". That is inherent to choosing
  a username, and it is rate limited (but see H1).

### M2 ✅ The editor logged "[yjs] Tried to remove event handler that doesn't exist"

- **Where:** `frontend/src/pages/CodeEditor.jsx` (the y-monaco binding effect).
- **Evidence:** y-monaco's `MonacoBinding` destroys itself when Monaco disposes its
  model (`onWillDispose → this.destroy()`), and the effect's cleanup destroyed it
  again. The second `ytext.unobserve` is what Yjs reports.
- **Fix:** `frontend/src/collab/destroyOnce.js` makes the second `destroy()` a no-op.
  It replaces the instance method, so the binding's internal call is covered too.
  Tested in `destroyOnce.test.js`, which first reproduces the warning without the
  guard, and checked in the browser smoke run (no console errors).

### M3 ✅ (C11b) File uploads: no rate limit and no per-project quota

- **Where:** `backend/app/routers/files.py` (no `@limiter.limit`), `backend/app/services/storage.py`.
- **Evidence:** each upload is capped (`MAX_UPLOAD_BYTES`, enforced by middleware and
  again in the route), but an editor can upload as many files as they like. All of them
  go to the one Cloudinary account.
- **Options:** (a) **(recommended)** a generous rate limit, such as 30 a minute per
  user, plus a per-project file count, such as 200; (b) a per-project byte total;
  (c) keep it as it is.
  Either changes behaviour, so it's left for the maintainer.

### M4 ✅ (C11b) CI didn't check migrations, the Docker build or Python dependencies

- **Where:** `.github/workflows/ci.yml`.
- **Evidence:** CI runs ruff, pytest (Postgres 16), eslint, Vitest, vite build and
  `npm audit --omit=dev`. It doesn't run `alembic upgrade head` from empty plus
  `alembic check`, `docker build`, or `pip-audit`. Actions are pinned by tag
  (`@v4`/`@v5`), not by commit SHA. Permissions are already minimal (`contents: read`).
- **Recommendation:** add a job that runs `alembic upgrade head && alembic check`
  against the service Postgres, a `docker build` of `backend/`, and `pip-audit -r
  requirements.txt`. All three pass locally (see Proof).

### M5 🔄 (C11b: report-only) No Content-Security-Policy on the app document

- **Where:** `frontend/vercel.json`. Only the two agent worker bundles have a CSP.
- **Evidence:** this is intentional and tested (`vercelHeaders.test.js`), so LiveKit's
  wss, media and blob workers aren't blocked. The app never uses
  `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` (searched), and
  the preview iframe is `sandbox="allow-scripts"` only. So the risk is
  defence-in-depth, not a known hole.
- **Recommendation:** add a CSP in report-only mode first
  (`Content-Security-Policy-Report-Only`). Follow `docs/CSP-RETEST-CHECKLIST.md`, then enforce it.

### M6 ✅ Hashed `/assets` files weren't cached long-term on Vercel

- **Where:** `frontend/vercel.json`.
- **Fix:** `/assets/(.*)` gets `Cache-Control: public, max-age=31536000, immutable`
  (Vite content-hashes those names). `index.html` keeps the default, so deploys show
  at once. Tested in `vercelHeaders.test.js`.

### L1 🟨 `code_file_versions.author_user_id` has no index

- **Evidence:** with 150,000 versions, the `ON DELETE SET NULL` lookup when an account
  is deleted is a sequential scan (11 ms). Every other foreign key and hot query uses
  an index (EXPLAIN below). It needs a migration, so it's left for the maintainer.

### L2 ℹ️ `ConnectionManager.usernames` is never pruned

- **Where:** `backend/app/services/realtime.py:12`. It grows by one entry per distinct
  user who ever opened a chat. That is bounded by the number of accounts and is a few
  bytes each. Rooms, sockets, collab rooms (`collab.py:543/590`) and used WebSocket
  tickets are all cleaned up.

### L3 🟨 The Docker base image is pinned by tag, not digest

- **Where:** `backend/Dockerfile:2` (`python:3.12-slim`). Rebuilds pick up new patch
  images, which is good for security fixes but makes builds less reproducible. The
  options are a digest pin with Dependabot, or keeping the tag (recommended for a
  one-person project).

### L4 🟨 The backend `main.py` shim

- **Where:** `backend/main.py`. It re-exports `app.main:app` so `uvicorn main:app`
  still works. The Dockerfile uses `app.main:app`. Keep the shim unless Render's
  start command is confirmed to be the Dockerfile's `CMD`. The maintainer can check
  this in the Render dashboard.

### L5 ℹ️ Development-only npm advisories

- `npm audit` (all dependencies) reports 3 moderate advisories, all `minimatch` via
  `eslint`. They are development-only, and the fix is a major eslint bump.
  `npm audit --omit=dev` reports 0. `pip-audit` reports no known vulnerabilities.

### L6 ℹ️ Licences

- The production npm tree is 202 packages, all MIT-compatible: MIT 173, ISC 13,
  Apache-2.0 8, plus BSD, 0BSD and MPL-2.0. dompurify (through Monaco) is
  `MPL-2.0 OR Apache-2.0`, and it is used unmodified. The Python dependencies are
  MIT/BSD/Apache. `LICENSE` is MIT, "Copyright (c) 2026 Govind Turkar", which is correct.

### L7 ℹ️ Outdated packages (no security impact)

- Minor or patch updates are available for both stacks. The majors were not taken:
  FastAPI 0.138 → 0.163, google-genai 2 → 3, livekit-api 1 → 2, jsdom 30 → 31.
  Upgrade them in their own pull request, with the full test run.

### L8 ✅ Missing project docs

- Added `SECURITY.md` (private reporting through GitHub advisories, key rotation),
  `CONTRIBUTING.md` and `CHANGELOG.md` (C1 to C11). The README now lists the
  tested browsers among its limitations.

### L9 🟨 Python version drift

- CI and Docker use Python 3.12; the local WSL environment runs 3.14. Both pass.
  Pick one as the reference, and consider a 3.14 CI leg before moving Docker to 3.14.

### L10 ✅ Danger badges were 4.44:1 on the admin page (light mode)

- **Where:** `frontend/src/styles/components.css:157`. The admin page wasn't in
  earlier axe runs; it is now.
- **Evidence:** axe `color-contrast`: `#cf222e` on `#f3e7ea` (the soft tint over a
  tinted table row) is 4.44:1.
- **Fix:** a new token, `--color-danger-on-soft` (`#b62324` in light mode, unchanged
  in dark), gives 5.35:1. Tested in `theme.test.jsx`, which fails with the old
  colour. Re-checked with axe: 0 violations.

### L11 ✅ DEPLOY.md didn't say preflight's RLS check fails locally

- Preflight against a fresh local database reports `[FAIL] row-level security`,
  because RLS is turned on by hand in Supabase. One sentence in step 2 now says so.

## What was checked and found sound

### Security

- **Authorization matrix** (`backend/tests/test_route_matrix.py`, 317 cases). Routes
  come from `app.routes`, with no hand-kept list. The test checks:
  - every route needs a user or is in a 14-entry public allowlist, each with a reason;
  - every `{project_id}`, `{task_id}`, `{file_id}` and `{code_file_id}` route uses
    `require_project_role`, with viewer for reads and editor/owner for writes. Three
    viewer writes are documented: leaving a project, the meeting token, and asking the AI;
  - no token gives 401;
  - a member of **another** project gets **404** on every project route, using
    project A's real task, file, code-file, version and member ids;
  - a viewer gets **403** on every write;
  - a viewer can leave but can't remove others;
  - agent runs and notifications are 404 to other users;
  - both WebSockets refuse a missing ticket, and a valid ticket for another project.
- **Authentication:**
  - bcrypt cost 12 (pwdlib);
  - JWTs last 60 minutes and carry `token_version` (password change, reset, and
    "sign out other devices" end other sessions);
  - WebSocket tickets last 30 s and are single-use (`TicketLedger.consume`);
  - OAuth uses PKCE, signed `state` (10 minutes) and a nonce;
  - reset and verification tokens are stored hashed, single-use (`used_at`) and expire;
  - the password-reset request answers the same whether or not the address exists.
- **Input handling:**
  - the only raw SQL is `SELECT 1` and `pg_advisory_xact_lock(724001)`, both constants;
  - no HTML injection sinks in the frontend; React escapes chat, tasks and markdown;
  - the preview is sandboxed;
  - ZIP import refuses unsafe paths;
  - the upload size is checked before the body is read (411/413);
  - CORS is an explicit origin list;
  - the API sends nosniff, `X-Frame-Options: DENY`, `Referrer-Policy` and HSTS over HTTPS.
- **Secrets:**
  - none in the working tree or in any commit of the full history (pattern scan; paths
    and hashes only);
  - the only `.env` ever committed (`frontend/.env`, 66f4f2f, removed in 54c3303)
    held just the public `VITE_API_URL`;
  - `.gitignore` covers `.env` everywhere;
  - the Docker image copies no env file;
  - GitHub tokens are encrypted with MultiFernet, so keys can be rotated.
- **Abuse:**
  - the agent quota takes `pg_advisory_xact_lock` before counting, so two runs started
    at once can't both pass;
  - limits per project file count (500), file size (1 MB of text), chat message (2000
    characters, with a per-socket throttle), meeting token TTL (1 h), AI input and
    agent steps, tokens and time.

### Database (local throwaway Postgres 18, port 55434)

- Upgraded from an empty database to `0016_code_file_versions`. Downgraded the
  latest migration and upgraded again. `alembic check`: "No new upgrade operations
  detected".
- Seeded with 3,000 users and projects, 15,000 memberships, 60,000 tasks, 100,000
  messages, 100,000 activity rows, 60,000 notifications, 30,000 code files and
  150,000 versions. Every hot query is an index scan under 0.5 ms:

| Query | Plan | Time |
| --- | --- | --- |
| projects of a user | `ix_project_members_user_id` + `ix_projects_id` | 0.15 ms |
| tasks of a project | `ix_tasks_project_id` | 0.44 ms |
| latest chat page | `ix_messages_project_id` | 0.29 ms |
| activity page | `ix_activity_project_id` | 0.31 ms |
| a user's notifications | `ix_notifications_user_id` | 0.24 ms |
| versions of a file | `ix_code_file_versions_file_created` | 0.12 ms |
| files of a project | `uq_code_files_project_path` | 0.20 ms |
| versions by author (account deletion) | **seq scan** (L1) | 11.3 ms |

- Every timestamp column is timezone-aware (UTC).
- **Cascades:**
  - versions and Yjs state cascade with their file;
  - a project's tasks, files, messages, code files, members, activity, notifications
    and agent runs are deleted through ORM cascades in the same transaction
    (`models.py:77-84`). The `tasks`, `files`, `messages` and `code_files` foreign keys
    have no `ON DELETE`, so a project deleted by hand in SQL is refused rather than
    leaving orphans;
  - user references are `SET NULL` where the history should stay.
- The password-reset request does all its work in a background task, so its reply
  and its timing are the same for every address.

### Reliability

- Unhandled errors return FastAPI's plain 500, with no stack trace. Optional services
  (Gemini, LiveKit, Resend, Cloudinary, OAuth) answer 503 "not configured".
- `/health` runs `SELECT 1` and returns 503 when the database is down.
- Sentry runs only with a DSN, `send_default_pii=False`, tracing off by default.
- No secrets or tokens are logged (searched).
- Removing a member, or deleting an account, kicks them from chat, meetings and live
  editing at once (`members.py:158-160`, `account.py:93-96`). The save race and
  restore-with-live-Yjs are covered by existing tests.

### Data flows

These end-to-end flows are covered by existing backend tests:

- sign-up, verification and reset;
- the project lifecycle;
- import and export round trip;
- version retention (50).

They were also checked in the browser smoke run.

## Proof

All runs were on this branch, locally, with hard timeouts and logs written to files.

| Check | Result |
| --- | --- |
| ruff | clean |
| Backend, SQLite, 3 runs | 1404 / 1404 / 1404 passed, no failures (flaky hunt) |
| Backend, fresh Postgres 18 (`sslmode=disable`), 2 runs | 1404 / 1404 passed |
| Backend at HEAD (with the query-count test) | **1410** passed on SQLite and **1410** on a fresh Postgres |
| Backend coverage (pytest-cov, `app/`) | **97%** of statements (4334, 147 missed) |
| Frontend (Vitest), 3 runs | 814 / 814 / 814 passed; at HEAD **817** (59 files) |
| Frontend coverage (v8) | lines **87.2%**, statements 84.9%, branches 82.1%, functions 78.5% |
| eslint · vite build | clean |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `pip-audit -r requirements.txt` | no known vulnerabilities |
| Fresh install | `npm ci` + build from `git archive HEAD`: OK. Python dependencies installed clean in the Docker build. |
| Migrations | upgrade from empty → `0016`, downgrade −1, upgrade, `alembic check`: OK |
| Docker | built from the tree. **80,806,166 bytes**, user `appuser`, HEALTHCHECK **healthy**, no dev tools, 91 files in `/app`. `/health` **200** `{"status":"ok","database":"ok"}` with dummy env and no Gemini, LiveKit or Resend keys. |
| Preflight (dev mode, local demo database) | runs, prints no values. Env vars, connectivity, alembic head, Gemini and LiveKit OK. RLS FAIL, as expected locally (L11). |
| Backup/restore drill | `pg_dump -Fc` of the local demo database (56 KB) restored into a new local database: the same alembic version and row counts in every table checked |
| Playwright smoke run (demo stack, demo accounts) | **11/11** steps, **0** console errors, **0** failed requests (C10: 11/11, 1 console error, the yjs warning) |
| axe, 15 pages × light and dark | **0** violations after L10. Pages: landing, sign-in, sign-up, forgot password, 404, projects, board, editor, meeting, settings, dashboard, AI assistant, analytics, admin (refused for a non-admin), admin. |
| Horizontal scroll at 320 / 390 / 768 / 1440 px | 0 px on every page |
| API response times (demo stack, median of 5) | 9–19 ms for `/me`, projects, tasks, members, activity, code files, analytics, notifications |
| N+1 queries | none: `test_query_counts.py` (6 list endpoints, 2 vs 12 rows, same query count) on SQLite and Postgres |

**Lighthouse:** the Lighthouse CLI isn't installed in this environment, and
installing tools was kept out of scope. Load metrics were measured instead with the
browser's Performance APIs. Each figure is the median of 3 cold loads, at 1440 px,
on a local build:

| Page | FCP | LCP | CLS | TBT | JS |
| --- | --- | --- | --- | --- | --- |
| Landing | 88 ms | 460 ms | 0 | 0 ms | 107 KB |
| Sign-in | 80 ms | 436 ms | 0 | 0 ms | 103 KB |
| Editor | 96 ms | 536 ms | 0 | 169 ms | 1304 KB (Monaco) |

(C10, same method: landing LCP 440 ms, editor LCP 484 ms / TBT 83 ms. The
differences are within run-to-run noise on a busy machine: C11's JavaScript is the
same size to within 0.01 kB.)

**Bundle (gzip):** the main chunk is 294.09 kB (94.36 kB gzipped). C10 was
294.08 kB (94.36 kB). The largest lazy chunks are LiveKit (148.6 kB gzipped,
meeting page only) and Monaco (editor only).

## Numbers, before and after

| | C10 (v1.2) | C11 |
| --- | --- | --- |
| Backend tests | 1086 | 1410 |
| Frontend tests | 812 | 817 |
| Backend coverage | not measured | 97% |
| Frontend line coverage | not measured | 87.2% |
| Main JS bundle | 294.08 kB | 294.09 kB |
| axe violations (pages × themes) | 0 (12 × 2) | 0 (15 × 2, after one fix) |
| Smoke console errors | 1 | 0 |
| Docker image | 80,805,485 B | 80,806,166 B |

## Remaining risks

- **H1** until it's decided: per-IP limits can be bypassed.
- **Single instance:** rate limits, chat and live editing are in memory. This is
  correct for one instance; scaling out needs Redis.
- **Free-tier cold start** (about a minute) and the Gemini free quota.
- The frontend's least-tested code: `runners/jsWorker.js` (runs inside a Web Worker,
  so it is tested through `runJavaScript`), and the `AIAssistant`, `AdminDashboard`
  and `Dashboard` pages.

## Decision list

| # | Finding | Options | Recommendation |
| --- | --- | --- | --- |
| H1 | Per-IP rate limits can be bypassed with `X-Forwarded-For` | rightmost-XFF key · trust only Render's proxy range · keep and document | Rightmost-XFF key, after checking Render's header on the live service |
| M3 | Uploads: no rate limit and no per-project quota | rate limit + file count · byte quota · keep | 30 a minute per user, plus 200 files per project |
| M4 | CI: no migration check, Docker build or pip-audit; actions pinned by tag | add the three steps · also pin actions by SHA · keep | Add the three steps; keep tag pins |
| M5 | No CSP on the app document | CSP report-only, then enforce · keep | Report-only first (`docs/CSP-RETEST-CHECKLIST.md`) |
| L1 | `code_file_versions.author_user_id` has no index | migration `0017` with the index · keep | Add it with the next migration |
| L3 | The base image is pinned by tag | digest + Dependabot · keep the tag | Keep the tag |
| L4 | The `backend/main.py` shim | delete once Render's command is confirmed · keep | Keep it until Render's start command is checked |
| L9 | Python 3.12 (CI and Docker) vs 3.14 (local) | add a 3.14 CI leg · standardise on 3.12 | Standardise on 3.12 for now |

## Verdict

**GO** for release readiness.

There are no Critical findings, and the authorization model has no gaps under an
automatic, full-route test. All suites are green and stable: 5 backend runs on two
databases, and 3 frontend runs. Docker, migrations, backup/restore and the browser
smoke run all pass.

The one High (H1) weakens the per-IP throttling but not authentication: every
guess still costs a bcrypt check, and signed-in routes are limited per user. Fix it
first among the decisions, once Render's proxy header is confirmed.

## Maintainer decisions (2026-11-15)

- **H1:** key the limiter on the rightmost `X-Forwarded-For` entry, after confirming
  on Render that one proxy hop appends it.
- **M3:** 30 uploads a minute per user and at most 200 files per project.
- **M4:** add a migration check, a Docker build and pip-audit to CI; keep the tag pins.
- **M5:** add a CSP in report-only mode first, then enforce it.
- L1, L3, L4 and L9 follow the recommendations in the decision list.

None of these was implemented in C11. They were done in C11b.

## C11b: decisions implemented (branch `phase-c11b-hardening`)

- **H1 resolved in code; verify on Render.**
  - `backend/app/core/client_ip.py` is now the single source of a client address.
    It takes the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` places from the right
    (default 1, validated as a whole number ≥ 0), and falls back to the TCP peer when
    the header is missing, too short or malformed.
  - IPv6 is normalised and grouped by /64; IPv4-mapped IPv6 counts as IPv4.
  - Every slowapi key uses it, and HSTS's https check uses the same rule for
    `X-Forwarded-Proto`.
  - uvicorn runs with `--no-proxy-headers`, and the startup log shows the value in use.
  - A guard test fails if any other module reads `request.client` or the forwarding
    headers.
  - Tests:
    - a spoofed leftmost entry never changes the key;
    - a 6th failed login is limited even with a new spoofed entry each time;
    - two real clients don't share a bucket;
    - IPv6, whitespace, ports, malformed values and too few entries are handled.
  - Preflight checks the setting, and `docs/DEPLOY.md` has the two-network
    verification for Render.
- **M3 resolved.** 30 uploads a minute per user (429), and at most 200 uploaded
  files per project (409, before anything is sent to Cloudinary).
  - The definitive count runs under a lock (plus a project row lock on Postgres),
    so racing uploads can't overshoot; a losing upload's asset is deleted again.
  - Deleting a file frees its place.
  - The board explains both limits in a toast.
  - Tests include 8 uploads racing for the last 2 places.
- **M4 resolved.** CI has two new parallel jobs:
  - **Backend (migrations + pip-audit):** `alembic upgrade head` on an empty
    Postgres 16, then `alembic check`, then `pip-audit -r requirements.txt`;
  - **Backend Docker image (build only):** Buildx with the GitHub Actions layer
    cache; nothing is pushed.

  Actions stay pinned by tag, and the token is still `contents: read`.
- **M5 in progress (report-only).** `Content-Security-Policy-Report-Only` is sent on
  every app page. On the local demo stack, 16 pages and flows report nothing except
  the HTML preview's own inline scripts (its sandboxed `srcdoc` frame inherits the
  policy). Enforcing needs the preview moved to its own document first. The live
  watch and the switch to enforcing are in `docs/DEPLOY.md`.
