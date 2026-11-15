# Contributing

Thanks for taking a look. NexusCode is a final-year college project, but issues and
pull requests are welcome.

## Getting set up

Follow [Local setup](README.md#local-setup) in the README: a Python virtual
environment for `backend/`, `npm ci` in `frontend/`, and a local Postgres or SQLite.
`backend/.env.example` and `frontend/.env.example` list every setting.
Gemini, LiveKit, Resend, Cloudinary and the OAuth apps are all optional: without
them, those features say they aren't configured.

## Before opening a pull request

Run what CI runs:

```bash
cd backend
ruff check .
pytest                       # SQLite
cd ../frontend
npx eslint .
npx vitest run
npx vite build
npm audit --omit=dev
```

To run the backend tests against Postgres, set `TEST_DATABASE_URL` to a
**throwaway** database. The tests wipe it.

## Guidelines

- **One concern per commit,** with a message in the style of the history
  (`fix(auth): …`, `feat(editor): …`, `docs: …`).
- **Add tests** with every behaviour change. Permission changes need a test in
  `backend/tests/test_route_matrix.py`'s style: non-members get 404, viewers get 403
  on writes. A new route fails that matrix until it is guarded or explicitly listed
  as public.
- **Never edit or delete an existing Alembic migration.** Add a new one; new
  tables need row-level security turned on (see [docs/DEPLOY.md](docs/DEPLOY.md)).
- **Accessibility:** new UI works with the keyboard, has accessible names, and
  passes axe in light and dark themes. See [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md).
- **No secrets** in code, tests, logs or screenshots.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Please don't use public issues for them.

## License

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).
