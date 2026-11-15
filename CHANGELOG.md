# Changelog

Notable changes, newest first. The project was built in phases (C1 to C11), each merged
as one pull request into `main`. Tags mark the stable points.

## C11b: hardening (unreleased)

- **Security:** per-IP rate limits key on the address Render's proxy appended to
  `X-Forwarded-For` (`TRUSTED_PROXY_HOPS`, default 1), never the caller's own entry.
  uvicorn no longer trusts forwarding headers.
- **Uploads:** at most 30 a minute per person and 200 per project, enforced race-safely;
  the board explains both limits.
- **CI:** migrations from an empty database plus `alembic check`, `pip-audit`, and a
  Docker build (cached, not pushed), as parallel jobs.
- **Security:** a report-only Content-Security-Policy on the app pages, tuned on the
  local stack; how to watch it live and enforce it later is in docs/DEPLOY.md.

## C11: final review ([v1.3](https://github.com/govindturkar69-crypto/NexusCode/releases/tag/v1.3), #32)

- **Security:** an authorization matrix test is built from the app's own routes.
  Every route needs a user or is explicitly public. Every project route checks the
  right role. A member of another project gets 404 with real ids, and a viewer gets
  403 on every write.
- **Security:** a failed login now takes the same bcrypt time whether or not the
  username exists, so response times don't reveal accounts.
- **Fix:** the code editor no longer logs "[yjs] Tried to remove event handler that
  doesn't exist" (the y-monaco binding was destroyed twice).
- **Performance:** Vercel caches the content-hashed `/assets` files for a year. A
  query-count test guards the list endpoints against N+1 queries.
- **Accessibility:** danger badges keep 4.5:1 contrast in light mode (admin page).
- **Docs:** `SECURITY.md`, `CONTRIBUTING.md`, this changelog, and the full review in
  [docs/FINAL-REVIEW.md](docs/FINAL-REVIEW.md).

## C10: cleanup ([v1.2](https://github.com/govindturkar69-crypto/NexusCode/releases/tag/v1.2), #31)

Removed unused exports, duplicate helpers, template assets and stale notes. Shared
`aware_utc()` and `initials()`. Declared `monaco-editor` directly. The Docker build
context is smaller (184 → 91 files in `/app`). No behaviour changes.

## C9: file version history ([v1.1](https://github.com/govindturkar69-crypto/NexusCode/releases/tag/v1.1), #30)

- Server-side snapshots of every code file (migration `0016_code_file_versions`):
  at most one a minute, no duplicates, and the state people leave a file in; 50 per file.
- A History panel with author, time and source, and a Monaco diff against the
  current text.
- Restore (owners and editors) through the live Yjs document, so everyone editing
  sees it at once. A restore adds a version and never deletes history.

## C8: productivity (#29)

- A command palette (Ctrl/Cmd+K) with fuzzy search over pages, actions, projects, tasks and files.
- Project analytics: burn-up/down, throughput, cycle time, workload, overdue tasks,
  and activity, each with a text summary and a data table.
- ZIP export of a project, and ZIP import with a preview and safe-path checks.

## C7: auth polish ([v1.0](https://github.com/govindturkar69-crypto/NexusCode/releases/tag/v1.0), #28)

Sign-in provider buttons show on the first paint. A split sign-in/sign-up layout.

## C6: UI polish (#27)

A new landing page, an admin dashboard redesign, a design system
([docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md)), an accessibility and performance
pass, and lucide icons in place of emoji.

## C5: polish (#25, #26)

A landing page, an honest README, screenshots and a demo script. Gemini is optional:
AI routes answer 503 without a key.

## C4: video meetings (#24)

Group video meetings per project on LiveKit: camera, microphone, screen share,
device choice and a speaking highlight.

## Pre-C4/C5 hardening (#21, #22, #23)

Security hardening, a read-only deploy preflight, a deploy runbook, a demo seed,
and a CSP for the agent's workers.

## C3: live collaborative editing (#19, #20)

Yjs (pycrdt on the server) with cursors, presence and offline edits. Documents
persist across restarts. Row-level security is on for every table. The save race was fixed.

## C2: AI coding agent (#18)

An agent that reads and writes files and runs Python or JavaScript in the browser,
with every change accepted or rejected as a diff; step, token and daily quotas.

## C1: authentication (#17)

Google and GitHub sign-in (PKCE, signed state), email verification, password reset,
`token_version` session invalidation, and single-use WebSocket tickets.

## Before C1 (#13 to #16)

The foundation: projects with roles, a Kanban board, chat, file uploads, a
multi-file Monaco editor, an AI assistant, and in-browser runners in place of Judge0.
