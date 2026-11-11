# 🚀 NexusCode

**An AI-powered software development platform** — a mini GitHub + VS Code + Jira + ChatGPT, built as a full-stack final-year college project.

🔗 **Live App:** [nexus-code-chi.vercel.app](https://nexus-code-chi.vercel.app)
🔗 **Live API Docs:** [nexuscode-backend-wbt4.onrender.com/docs](https://nexuscode-backend-wbt4.onrender.com/docs)

> ⚠️ Both services run on free-tier hosting. The backend may take **up to 50 seconds** to wake up on first load after inactivity, and the database expires periodically on Render's free tier.

---

## 📖 Overview

NexusCode combines project management, an in-browser code editor, AI-assisted development, real-time collaboration, and version control into a single platform. It was built incrementally, feature by feature, with every layer (database, backend, frontend) understood and tested end-to-end rather than scaffolded all at once.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔐 **Secure Authentication** | Username and password, or sign in with Google or GitHub (OAuth with PKCE). Password reset and email verification by email, and signing out other devices. JWT auth with bcrypt password hashing, protected routes |
| 👥 **Team Projects & Roles** | Projects are shared with members as owner, editor or viewer; the role gates every action, in the REST API and on live WebSocket connections |
| 📈 **Project Management (Kanban)** | Drag-and-drop task board (`@hello-pangea/dnd`) with live status sync |
| 💻 **Online Code Editor** | Monaco Editor (the engine behind VS Code) with a file tree, tabs, per-file auto-save and language from the file extension |
| 👥 **Live Collaborative Editing** | Edit the same file together in real time with Yjs: named cursors in each person's colour, who's here, offline edits that sync later, and documents that survive restarts ([details](#-live-collaborative-editing)) |
| ▶️ **Run Code in the Browser** | Run Python and JavaScript, and preview HTML/CSS/JS projects, with no server-side execution and no API keys ([details](#-running-code)) |
| 🦾 **AI Agent** | Give it a goal and it writes files, runs them in your browser, and fixes them until they pass. You review every change as a diff ([details](#-ai-agent)) |
| 🤖 **AI Code Generation** | Generate code from natural-language prompts via Gemini |
| 🧠 **AI Bug Detection** | Automated code review for bugs and best-practice issues |
| 📄 **AI Documentation** | Auto-generated Markdown documentation for any code snippet |
| 🐙 **GitHub Integration** | Full OAuth flow — authorize once, then push code from the editor directly to a new GitHub repo |
| 📂 **File Manager** | Upload/download project files via Cloudinary cloud storage |
| 💬 **Real-time Chat** | Per-project chat over authenticated WebSockets, with persisted history |
| 📹 **Video Meeting** | 1:1 WebRTC video call per project, with authenticated signaling |
| 📊 **Analytics Dashboard** | Live charts (Recharts) summarizing projects, tasks, files, and messages |
| 🛠️ **Admin Dashboard** | Platform-wide stats, users, and projects for admin accounts |
| 🐳 **Docker Support** | Containerized backend running as a non-root user, with a `/health` check |
| 🚀 **Live Deployment** | Backend + DB on Render, frontend on Vercel |

---

## 🛠️ Tech Stack

**Frontend**
- React 19 + Vite
- React Router (multi-page navigation)
- `@monaco-editor/react` (code editor)
- `@hello-pangea/dnd` (drag-and-drop Kanban)
- Recharts (analytics charts)
- Plain CSS-in-JS (dark, terminal-inspired theme)

**Backend**
- FastAPI (Python)
- SQLAlchemy ORM + PostgreSQL
- JWT auth (`python-jose`) + `passlib`/`bcrypt`
- WebSockets (native FastAPI) for real-time chat
- `google-genai` (Gemini 2.5 Flash) for AI features
- `cloudinary` SDK for file storage
- `httpx` for GitHub OAuth + REST API calls

**Infrastructure**
- Docker (containerized backend)
- Render (backend)
- Supabase (managed PostgreSQL, with row-level security)
- Vercel (frontend static hosting)
- GitHub Actions CI (ruff + pytest on SQLite and Postgres, eslint + Vitest + vite build)

---

## 🏗️ Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   React (Vite)   │ ──────▶ │   FastAPI         │ ──────▶ │   PostgreSQL     │
│   Vercel          │  HTTPS │   Render (Docker) │  SQL    │   Render          │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                      │
                       ┌──────────────┼──────────────┐
                       ▼              ▼              ▼
                  Gemini API     Cloudinary      GitHub API
                  (AI features)  (file storage)  (OAuth + repo push)
```

---

## 📂 Project Structure

```
NexusCode/
├── backend/
│   ├── main.py              # All API routes
│   ├── models.py            # SQLAlchemy models (Users, Projects, Tasks, Files, Messages, CodeFiles)
│   ├── database.py          # DB connection (env-var configurable)
│   ├── auth.py               # Password hashing + JWT logic
│   ├── ai.py                  # Gemini integration (code gen, bug detection, docs)
│   ├── files.py               # Cloudinary upload logic
│   ├── github_oauth.py       # GitHub OAuth flow + repo API calls
│   ├── websocket_manager.py # Chat + video-meeting connection managers
│   ├── Dockerfile
│   ├── .env.example
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── api/client.js          # apiFetch wrapper (auth header, errors, 401 → login)
    │   ├── auth/                  # AuthProvider + useAuth (logged-in user)
    │   ├── components/ProtectedRoute.jsx
    │   ├── pages/
    │   │   ├── Login.jsx          # Sign in + create account
    │   │   ├── Projects.jsx
    │   │   ├── Board.jsx          # Kanban + Files + Chat
    │   │   ├── CodeEditor.jsx     # Monaco + AI + GitHub push
    │   │   ├── AIAssistant.jsx
    │   │   ├── Dashboard.jsx
    │   │   ├── AdminDashboard.jsx
    │   │   ├── VideoMeeting.jsx
    │   │   └── NotFound.jsx
    │   └── App.jsx                 # Routing
    ├── vercel.json                 # SPA rewrites + security headers
    ├── .env.example
    └── package.json
```

---

## ⚙️ Local Setup

### Prerequisites
- Python 3.12+
- Node.js + npm
- PostgreSQL (local instance)
- Docker (optional, for containerized backend)

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

Copy `backend/.env.example` to `backend/.env` and fill it in. The server refuses to start without these:

```env
JWT_SECRET=          # python -c "import secrets; print(secrets.token_urlsafe(64))"
FRONTEND_URL=http://localhost:5173
GITHUB_TOKEN_ENC_KEY=  # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
DB_PASSWORD=         # or set DATABASE_URL instead of the DB_* variables
```

Keep `GITHUB_TOKEN_ENC_KEY` safe and stable: stored GitHub tokens can't be read without it (users would just have to reconnect GitHub).

The rest (`GEMINI_API_KEY`, `CLOUDINARY_*`, `GITHUB_CLIENT_ID/SECRET`, `GITHUB_REDIRECT_URI`) are needed for the AI, file upload and GitHub features. See `.env.example` for every key. For email and for signing in with Google or GitHub, see [below](#email-google-and-github-sign-in-optional).

Run the server:

```bash
uvicorn main:app --reload
```

API docs available at `http://127.0.0.1:8000/docs`.

### Email, Google and GitHub sign-in (optional)

Each of these is off until its variables are set. Login and Settings only show what the server has set up (`GET /auth/options`), so nothing breaks when a key is missing.

**Email (Resend):** used for password reset, email verification and a test email in Settings.

1. Create an API key at [resend.com/api-keys](https://resend.com/api-keys) and set `RESEND_API_KEY`.
2. Set `MAIL_FROM_EMAIL` and optionally `MAIL_FROM_NAME` (default `NexusCode`).
   - **No domain yet:** use `MAIL_FROM_EMAIL=onboarding@resend.dev`. Resend then only delivers to the email address of your own Resend account. Settings and the server log say that sending is restricted, and sending to anyone else shows a clear error instead of failing silently.
   - **To email everyone:** verify a domain at [resend.com/domains](https://resend.com/domains) and send from an address on it, such as `no-reply@yourdomain.com`.

Reset links last 30 minutes and verification links 24 hours. Each works once, and only its hash is stored. Resetting or changing a password signs out every other session.

**Sign in with Google**

1. In [Google Cloud Console](https://console.cloud.google.com/), choose or create a project. Under **APIs & Services > OAuth consent screen**, set it up as **External** with the scopes `openid`, `email` and `profile`. While its status is **Testing**, only the test users you add can sign in. Publish the app to open it to everyone.
2. Under **APIs & Services > Credentials**, choose **Create credentials > OAuth client ID > Web application**, and add these **Authorized redirect URIs**:
   - `http://localhost:8000/auth/google/callback`
   - `https://nexuscode-backend-wbt4.onrender.com/auth/google/callback`
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`, the last one being the redirect URI for that environment.

**Sign in with GitHub:** this is a separate OAuth app from the repo-access `GITHUB_CLIENT_ID` app above. It asks only for `read:user` and `user:email`.

1. At [github.com/settings/developers](https://github.com/settings/developers), choose **OAuth Apps > New OAuth App**. A GitHub OAuth app has a single callback URL, so make one app for local development and another for production:
   - Local: homepage `http://localhost:5173`, callback `http://localhost:8000/auth/github/login/callback`
   - Production: homepage `https://nexus-code-chi.vercel.app`, callback `https://nexuscode-backend-wbt4.onrender.com/auth/github/login/callback`
2. Generate a client secret, then set `GITHUB_LOGIN_CLIENT_ID`, `GITHUB_LOGIN_CLIENT_SECRET` and `GITHUB_LOGIN_REDIRECT_URI` (that environment's callback).

**How the accounts fit together**

- The first sign-in with a provider creates an account with a generated username and no password. It can add a password in Settings.
- A provider is never joined to an existing account automatically. If its verified email matches an account with a verified email, the user has to enter that account's password. A provider can also be linked from Settings while signed in.
- Settings lists the linked providers. You can unlink any of them, but never the last way into the account.

### Frontend

```bash
cd frontend
npm install
```

Copy `frontend/.env.example` to `frontend/.env`:

```env
VITE_API_URL=http://127.0.0.1:8000
```

On Vercel, set `VITE_API_URL` under Project Settings → Environment Variables instead.

Run the dev server:

```bash
npm run dev
```

App available at `http://localhost:5173`.

### Running the Backend with Docker

```bash
cd backend
docker build -t nexuscode-backend .
docker run -p 8000:8000 --env-file .env -e DB_HOST=host.docker.internal nexuscode-backend
```

The container runs `scripts/migrate.py` before starting the API, so the schema is always up to date.

### Database migrations (Alembic)

Tables are created and changed only through Alembic migrations in `backend/alembic/versions`.

```bash
cd backend
python scripts/migrate.py                          # upgrade to the latest schema (safe to run any time)
alembic revision --autogenerate -m "describe it"   # after changing models.py; review the generated file
alembic current                                    # show the database's revision
```

`scripts/migrate.py` refuses to run on a database that has tables but was never stamped (created before Alembic), so nothing gets recreated. To adopt such a database, once:

```bash
python scripts/check_baseline.py   # read-only: confirms the schema matches 0001_baseline
alembic stamp 0001_baseline        # records the revision; changes no tables
python scripts/migrate.py          # applies every migration after the baseline
```

### Tests

```bash
cd backend && pip install -r requirements-dev.txt && pytest       # SQLite by default (on Windows, see Live Collaborative Editing if pycrdt is blocked)
TEST_DATABASE_URL=postgresql://postgres:test@localhost:5432/test pytest   # throwaway local Postgres (it gets wiped)
cd frontend && npm test
```

---

## ▶️ Running Code

Run (or **Ctrl+Enter**) picks a runner from the file extension. Everything happens in your browser, with what's in the editor, including unsaved changes. Nothing is sent to a server, so viewers can run code too; only editors can save.

| File | Runs as | Runs in |
|---|---|---|
| `.py` | Python 3.14 via [Pyodide](https://pyodide.org) | Web Worker |
| `.js`, `.mjs`, `.cjs` | JavaScript | Web Worker with an opaque origin |
| `.html`, `.htm` | Live preview of the project | Sandboxed iframe |
| `.css` | Previews the project's page, if it has one | Sandboxed iframe |

Other languages show a message that they can't run in the browser.

**Limits**

- **Python and JavaScript:** 10 seconds, then the worker is terminated, and 100 KB of output. Both are enforced from the page, where the running code can't interfere.
- **Python:** the standard library only. Third-party packages such as `numpy` aren't available, and `micropip` is deliberately not included, so nothing is installed at run time. `input()` reads from the Input (stdin) box. The project's other `.py` files come along in the worker's in-memory filesystem, so `from calc import add` works, and `unittest.main()` finds the file's tests.
- **JavaScript:** one file at a time, so no `import` of other project files. `console` output, top-level `await` and timers all work.
- **Preview:** CSS, JS, `@import` and SVG files are inlined by path from the file tree. Binary images aren't in the code tree, so they can't be shown. ES module imports between project files aren't resolved, so use `<script src>`. Resources on `https://` sites, such as a CDN stylesheet, do load. The page has no time limit; use Close or Reload to end it.

**Why in the browser?**

Running other people's code on a server needs a sandboxing service, API keys and a budget, and a mistake there is a security problem for everyone. In the browser it costs nothing per run, it's limited only by the user's own machine, and the browser's isolation does the hard part:

- **Workers** have no DOM and no `localStorage`, which is where the login token lives. The JavaScript worker also has an opaque origin, so no IndexedDB or same-origin requests.
- **The preview iframe** has `sandbox="allow-scripts"` and nothing else: an opaque origin, with no access to the app or its storage, and no top navigation, popups or forms.

**Size:** Pyodide adds about 13 MB to the deploy. A user downloads about 6.4 MB (gzipped) the first time they run Python, with a progress bar, and the browser caches it after that. Nothing is downloaded until then.

---

## 🤖 AI Agent

In the code editor, editors and owners can open **🤖 Agent**, give it a goal such as *"Build a todo CLI in Python with tests"*, and watch it work. The agent writes files, runs them in your browser, reads the errors, fixes the code and runs it again until it passes. It's built so that it can't change your project without you.

**How a run works**

1. The browser drives the run one step at a time. For each step the server streams one Gemini reply over server-sent events: text and tool calls.
2. The browser runs the tools and sends the results back with its next step request:
   - `list_files`, `read_file`, `write_file` and `add_task` work on a working copy of the project.
   - `run_file` uses the same in-browser runners as **Run**.
3. User code never runs on the server.

The timeline shows each step live: the agent's text, every tool call with its result and output, and how the run ended. At the end, a summary lists the files that changed and what passed, for example "test_calc.py passed on run 2, after 1 failed".

**You review every change**

- Each file the agent writes appears as a diff with **Accept** and **Reject**, and **Undo** once accepted. Nothing is saved until you accept it.
- Proposed board tasks wait for **Add to board** in the same way.
- A per-session **Save the agent's changes without asking** switch is available. It's off by default.
- While a run is going, the agent sees its own pending changes. A rejected change is gone for it too.
- If you edit a file after the agent read it, accepting asks you to **Overwrite** first.
- Accepted changes go through the normal file and task routes and appear in the Activity feed.

**Model and limits**

| | |
|---|---|
| Model | `gemini-3.5-flash-lite`, with native function calling (AUTO mode). It has its own free-tier allowance, separate from the `gemini-2.5-flash` used by the other AI features. |
| Steps | At most 8 Gemini calls per run. On the last one, tools are switched off so the run ends with a summary. |
| Run limits | 250k tokens and 15 minutes per run. A run also stops when the same failing run comes back after a fix. |
| Daily quota | 2 runs per user and 2 runs in total per UTC day (at most 16 calls), sized for a free tier of 20 requests a day per model. A run counts once Gemini has answered it. The panel shows how many are left. To raise them, change `USER_DAILY_RUNS` and `TOTAL_DAILY_RUNS` in `backend/app/services/agent.py`. |
| Gemini's own limits | A daily limit reported by Gemini turns new runs away until it resets. A per-minute limit is retried after a pause. |
| Who | Editors and owners. Viewers can't run the agent. A run belongs to the user who started it. |

**Languages it can run:** Python (`.py`, the standard library only, and files can import other `.py` files in the project) and JavaScript (`.js`, one file at a time). It can write any language, but anything else, `.html` pages included, can't be run in the browser. The agent says so and tells you how to run it yourself.

**Safety**

- The server checks every tool call before the browser sees it:
  - the tool has to exist and its arguments have to have the right shape
  - paths follow the project's path rules: no `..`, absolute paths or `.git`
  - sizes are capped
- The server keeps the conversation itself, so a browser can't rewrite what the model said. It only accepts results for calls it issued.
- File contents and program output reach Gemini fenced with a random per-run token. The model is told never to follow instructions found inside them. This was checked live with a project file that tried to redirect the agent.
- The agent's code runs with **no network**: both runners turn off `fetch`, XHR, sockets, `importScripts` and nested workers before it starts. Like all runs, it can't reach the login token.

**Trying it by hand**

1. Make a project with a `calc.py` whose `add` returns `a - b`, and a `test_calc.py` with a `unittest` test that `add(2, 3) == 5` and `unittest.main()` at the bottom.
2. Open the editor, then **🤖 Agent**.
3. Give it the goal *"Run test_calc.py. If a test fails, fix calc.py (not the tests) and run the tests again until they pass."*
4. The timeline should show a failing run, the fix as a diff, a passing run, and "passed on run 2, after 1 failed". Accept the change and it's saved and appears in Activity.

---

## 👥 Live Collaborative Editing

Everyone in a project edits code files together, live. Each code file is one [Yjs](https://yjs.dev) document: you see other people's changes as they type, with their cursor, selection and name in their colour, and how many people are in each open file. Editors and owners can edit; viewers watch live, read-only.

**How it works**

- **Browser:** `yjs`, `y-monaco` (keeps the Monaco editor and the document in step, and draws remote cursors) and `y-websocket`'s provider, over `/ws/code-files/{id}`.
- **Server:** an endpoint in the FastAPI app built on [`pycrdt`](https://github.com/jupyter-server/pycrdt), the Python binding of Yrs (the Rust port of Yjs), maintained by the Jupyter community. The server keeps a real copy of each open document. That lets it answer sync requests itself, check every change before applying it, and write the text back to `code_files.content`, which is what Run, Preview, the AI, the agent and GitHub push read.
- **Sign-in:** each connection uses the usual single-use, 30-second WebSocket ticket. `y-websocket` reconnects on its own, and a fresh ticket is fetched for every reconnect.

**Saving**

- Each document is saved in `code_file_yjs` together with `code_files.content`: 2 s after the last change, when the last person leaves, on shutdown, and as soon as a file is first opened.
- Existing files become documents lazily, the first time someone opens them.
- Because the Yjs state is saved, and not only the text, a browser that was offline, or stayed open across a restart, merges its changes into the same document.
- Saves that don't come from the live editor (normal saving when live editing isn't available, the agent writing a file nobody has open, the old single-file API) go through the document too. Live editors see the change, and nothing they typed is overwritten.
- Reading a file, asking the AI and pushing to GitHub all save pending live changes first.

**Going offline:** you can keep typing. The status line says *"Offline: your changes will sync when you're back"*, the edits are sent when the connection returns, and closing the page before then asks you to confirm.

**Limits and safety**

| | |
|---|---|
| Document size | 1,000,000 characters, checked before a change is applied |
| One message | 8 MB (enough for a reconnecting browser's whole document) |
| Rate per connection | 60 messages/s (bursts of 240) and 256 KB/s (bursts up to 8 MB) |
| Connections | 10 per user, 50 per project; past that, the file is edited with normal saving and the editor says why |
| Access | A role change reaches open connections at once, so an editor made a viewer goes read-only straight away. Removing a member or deleting an account disconnects them. Roles are re-checked every 60 s as a backstop. |
| Isolation | One room per file; a ticket only opens files in its own project; cursor names are the signed-in user's, and colours must be `#rrggbb`, since they end up in other people's CSS |

**On Render's free tier**

- Rooms live in one process's memory, so this needs a **single instance**. Several instances would need a shared message bus, for example Redis.
- A restart or cold start loses nothing that was saved. Open browsers reconnect and send anything the server didn't have.
- The first connection after the service has spun down waits for the cold start, up to about a minute. The editor shows *"Connecting to live editing..."* meanwhile.

**Developing on Windows:** `pycrdt` is a compiled extension. If Windows Application Control (Smart App Control) blocks it, as it did on the machine this was built on, run the backend and its tests in WSL or Docker, which run Linux like Render does. For example:

```bash
wsl -d Ubuntu -- bash -lc "cd /mnt/c/path/to/NexusCode/backend && python3 -m venv ~/nexus-venv && ~/nexus-venv/bin/pip install -r requirements-dev.txt && ~/nexus-venv/bin/python -m pytest"
```

**Trying it with two browsers**

1. Sign in as two different members of a project, for example one in a normal window and one in a private window, and open the same file in both.
2. Type in both at once. Both should end up with the same text, each showing the other's cursor and name.
3. Make one of them a viewer from the members panel. Their editor turns read-only straight away.
4. Stop the backend, type in one window (it says Offline), and start the backend again. The change reaches the other window once and is saved.

---

## 🔑 Key Design Decisions

- **JWT over sessions** — stateless auth, no server-side session storage needed.
- **Code runs in the browser, never on a server** — no keys, no per-run costs and no untrusted code on the backend. See [Running code](#-running-code).
- **Pyodide is self-hosted, like Monaco** — served from our own deploy, so there's no third-party CDN at run time, and it's only downloaded on the first Python run.
- **Cloudinary over local disk** — production-realistic file storage that survives redeploys.
- **Cascading deletes** — deleting a project cleans up its tasks, files, messages, and code file automatically via SQLAlchemy relationships.
- **Environment-variable-driven config** — secrets, database credentials and the frontend URL come only from environment variables, with no hardcoded fallbacks, so the same codebase runs locally, in Docker, and in production without code changes. (Earlier commits did contain hardcoded values; those have been removed and should be treated as rotated.)

---

## 🚧 Known Limitations / Future Improvements

- Live editing keeps its rooms in one process's memory, so the backend must run as a single instance (as it does on Render's free tier).
- Video meetings are 1:1 and use public STUN only (no TURN server), so calls can fail on strict networks.
- JavaScript runs one file on its own (no imports of other project files), and third-party Python packages aren't available.
- The agent's free-tier quota is small (2 runs a day), and it can only run Python and JavaScript.
- No light theme toggle yet (dark theme only).
- Email can only reach your own address until a domain is verified at Resend (see [setup](#email-google-and-github-sign-in-optional)).

---

## 📜 License

This project was built for academic purposes as a final-year college project.

---

## 🙋 Author

Built by **Govind Turkar** as a final-year college project — from first FastAPI route to live, deployed, multi-service production app.
