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
| 🔐 **Secure Authentication** | JWT-based signup/login with bcrypt password hashing |
| 👥 **Team Collaboration** | Project ownership model with per-user data isolation |
| 📈 **Project Management (Kanban)** | Drag-and-drop task board (`@hello-pangea/dnd`) with live status sync |
| 💻 **Online Code Editor** | Monaco Editor (the engine behind VS Code) with auto-save and language switching |
| 🤖 **AI Code Generation** | Generate code from natural-language prompts via Gemini |
| 🧠 **AI Bug Detection** | Automated code review for bugs and best-practice issues |
| 📄 **AI Documentation** | Auto-generated Markdown documentation for any code snippet |
| 🐙 **GitHub Integration** | Full OAuth flow — authorize once, then push code from the editor directly to a new GitHub repo |
| 📂 **File Manager** | Upload/download project files via Cloudinary cloud storage |
| 💬 **Real-time Chat** | Per-project chat over WebSockets, with persisted history |
| 📊 **Analytics Dashboard** | Live charts (Recharts) summarizing projects, tasks, files, and messages |
| 🐳 **Docker Support** | Fully containerized backend with a working `Dockerfile` |
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
- GitHub Actions–ready repo structure (CI/CD as a future extension)

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
│   ├── websocket_manager.py # Chat connection manager
│   ├── Dockerfile
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── Login.jsx
    │   │   ├── Projects.jsx
    │   │   ├── Board.jsx          # Kanban + Files + Chat
    │   │   ├── CodeEditor.jsx     # Monaco + AI + GitHub push
    │   │   ├── AIAssistant.jsx
    │   │   └── Dashboard.jsx
    │   └── App.jsx                 # Routing
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

Create a `.env` file in `backend/`:

```env
GEMINI_API_KEY=your_key_here
CLOUDINARY_CLOUD_NAME=your_value
CLOUDINARY_API_KEY=your_value
CLOUDINARY_API_SECRET=your_value
GITHUB_CLIENT_ID=your_value
GITHUB_CLIENT_SECRET=your_value
GITHUB_REDIRECT_URI=http://localhost:8000/auth/github/callback
```

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

Create a `.env` file in `frontend/`:

```env
VITE_API_URL=http://127.0.0.1:8000
```

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

---

## 🔑 Key Design Decisions

- **JWT over sessions** — stateless auth, no server-side session storage needed.
- **One code file per project** (for now) — kept the editor scope focused; multi-file support is a natural extension.
- **Cloudinary over local disk** — production-realistic file storage that survives redeploys.
- **Cascading deletes** — deleting a project cleans up its tasks, files, messages, and code file automatically via SQLAlchemy relationships.
- **Environment-variable-driven config** — database credentials and API URLs are never hardcoded, so the same codebase runs locally, in Docker, and in production without code changes.

---

## 🚧 Known Limitations / Future Improvements

- GitHub OAuth currently associates the connected account with a fixed test user rather than tracking the initiating user via OAuth `state` — a production version would fix this.
- WebSocket chat does not currently enforce JWT authentication on the connection itself.
- Single code file per project (no multi-file project support yet).
- No light theme toggle yet (dark theme only).
- Stretch goals not yet implemented: video meetings (WebRTC), notifications, admin dashboard, CI/CD pipeline.

---

## 📜 License

This project was built for academic purposes as a final-year college project.

---

## 🙋 Author

Built by **Govind Turkar** as a final-year college project — from first FastAPI route to live, deployed, multi-service production app.
