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
| 🔐 **Secure Authentication** | Sign-up and login screens, JWT auth with bcrypt password hashing, protected routes |
| 👤 **Private Workspaces** | Each project belongs to one user; projects can't be shared with teammates yet |
| 📈 **Project Management (Kanban)** | Drag-and-drop task board (`@hello-pangea/dnd`) with live status sync |
| 💻 **Online Code Editor** | Monaco Editor (the engine behind VS Code) with a file tree, tabs, per-file auto-save and language from the file extension |
| ▶️ **Run Code in the Browser** | Run Python and JavaScript, and preview HTML/CSS/JS projects, with no server-side execution and no API keys ([details](#-running-code)) |
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
- Render (backend + managed PostgreSQL)
- Vercel (frontend static hosting)
- No CI/CD pipeline yet

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

The rest (`GEMINI_API_KEY`, `CLOUDINARY_*`, `GITHUB_CLIENT_ID/SECRET`, `GITHUB_REDIRECT_URI`) are needed for the AI, file upload and GitHub features. See `.env.example` for every key.

Run the server:

```bash
uvicorn main:app --reload
```

API docs available at `http://127.0.0.1:8000/docs`.

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
cd backend && pip install -r requirements-dev.txt && pytest       # SQLite by default
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
- **Python:** the standard library only. Third-party packages such as `numpy` aren't available, and `micropip` is deliberately not included, so nothing is installed at run time. `input()` reads from the Input (stdin) box.
- **JavaScript:** one file at a time, so no `import` of other project files. `console` output, top-level `await` and timers all work.
- **Preview:** CSS, JS, `@import` and SVG files are inlined by path from the file tree. Binary images aren't in the code tree, so they can't be shown. ES module imports between project files aren't resolved, so use `<script src>`. Resources on `https://` sites, such as a CDN stylesheet, do load. The page has no time limit; use Close or Reload to end it.

**Why in the browser?**

Running other people's code on a server needs a sandboxing service, API keys and a budget, and a mistake there is a security problem for everyone. In the browser it costs nothing per run, it's limited only by the user's own machine, and the browser's isolation does the hard part:

- **Workers** have no DOM and no `localStorage`, which is where the login token lives. The JavaScript worker also has an opaque origin, so no IndexedDB or same-origin requests.
- **The preview iframe** has `sandbox="allow-scripts"` and nothing else: an opaque origin, with no access to the app or its storage, and no top navigation, popups or forms.

**Size:** Pyodide adds about 13 MB to the deploy. A user downloads about 6.4 MB (gzipped) the first time they run Python, with a progress bar, and the browser caches it after that. Nothing is downloaded until then.

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

- No team collaboration yet: projects can't be shared, so chat and meetings are only reachable by the project owner.
- Video meetings are 1:1 and use public STUN only (no TURN server), so calls can fail on strict networks.
- No database migrations yet (tables are created on startup); schema changes need manual SQL.
- No automated tests or CI/CD pipeline yet.
- Run executes one file on its own: Python and JavaScript files can't import other project files, and third-party Python packages aren't available.
- No light theme toggle yet (dark theme only).
- Not yet implemented: notifications, password reset.

---

## 📜 License

This project was built for academic purposes as a final-year college project.

---

## 🙋 Author

Built by **Govind Turkar** as a final-year college project — from first FastAPI route to live, deployed, multi-service production app.
