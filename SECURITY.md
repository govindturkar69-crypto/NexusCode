# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it privately
through GitHub: on this repository, open **Security → Advisories → Report a
vulnerability** (GitHub's private vulnerability reporting).

Include what you found, how to reproduce it, and what an attacker could do with it.
You'll get an answer within a week. This is a student project maintained by one
person, so there is no bug bounty.

## Supported versions

Only the latest release on `main` gets fixes.

| Version | Supported |
| --- | --- |
| latest `main` (v1.x) | yes |
| anything older | no |

## Scope

In scope: the code in this repository (the FastAPI backend in `backend/` and the
React frontend in `frontend/`) and its documented deployment (Render, Supabase,
Vercel, LiveKit Cloud).

Out of scope: denial of service by volume, findings that need a compromised
device or browser, and the third-party services themselves.

## What's already in place

The security measures are listed in the README's [Security](README.md#security)
section. The last full review, with every finding and its status, is
[docs/FINAL-REVIEW.md](docs/FINAL-REVIEW.md).

## Handling secrets

- Secrets are only ever in environment variables (`backend/.env` locally, the
  hosting dashboards in production), never in git. `.env` files are ignored.
- `backend/.env.example` and `frontend/.env.example` list every setting, with no values.
- GitHub tokens are encrypted at rest with Fernet. `GITHUB_TOKEN_ENC_KEY` takes several
  comma-separated keys, so a key can be rotated: put the new key first, keep the old one
  until every token has been re-encrypted or reconnected, then remove it.
- If a secret leaks, rotate it at its provider first, then update the hosting dashboard.
  Rotating `JWT_SECRET` signs everyone out.
