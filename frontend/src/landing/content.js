// The landing page's words. Every feature here exists in this codebase; keep it
// that way when editing (see README.md for where each one lives).

export const REPO_URL = "https://github.com/govindturkar69-crypto/NexusCode";
export const PAGE_TITLE = "NexusCode — plan, write, run and ship code together";

export const FEATURES = [
  {
    icon: "🗂️",
    title: "Kanban board with roles",
    text: "Drag tasks across To do, In progress and Done, with assignees, priorities and due dates. Owner, editor and viewer roles are enforced on the server and by row-level security in the database.",
  },
  {
    icon: "🧑‍💻",
    title: "Multi-file code editor",
    text: "Monaco, the editor inside VS Code, with folders and many files per project.",
  },
  {
    icon: "🤝",
    title: "Real-time collaborative editing",
    text: "Edit the same file together. Yjs keeps everyone in sync, shows each person's cursor and name, and merges changes made while offline.",
  },
  {
    icon: "🤖",
    title: "AI coding agent",
    text: "Give it a goal and it reads your files, runs Python or JavaScript in a sandboxed browser worker to check its work, and proposes changes you accept or reject. Steps are capped, its network is blocked, and there is a small daily quota.",
  },
  {
    icon: "✨",
    title: "Streaming AI assistant",
    text: "Generate code, find bugs, write documentation and get task suggestions, with answers streamed as they are written. Powered by Google Gemini.",
  },
  {
    icon: "▶️",
    title: "Run code in the browser",
    text: "Python through Pyodide, JavaScript in a sandboxed worker, and a live HTML preview. Your code never runs on the server.",
  },
  {
    icon: "🐙",
    title: "Push to GitHub",
    text: "Send every file in a project to a new or existing GitHub repository as a single commit.",
  },
  {
    icon: "🔐",
    title: "Sign in your way",
    text: "Username and password, Google or GitHub. Add an email address to verify it and to reset a forgotten password.",
  },
  {
    icon: "📹",
    title: "Group video meetings",
    text: "Each project has its own call on LiveKit, with camera, microphone, screen sharing and a choice of devices.",
  },
  {
    icon: "💬",
    title: "Chat, activity and notifications",
    text: "Project chat with history, an activity feed of what changed, and notifications when you are added, assigned a task or given a new role.",
  },
];

export const STEPS = [
  { title: "Create a project", text: "Invite teammates as owners, editors or viewers." },
  { title: "Plan the work", text: "Break it into tasks on the board and assign them." },
  { title: "Code together", text: "Write in the shared editor, run it in the browser, and ask the AI when you are stuck." },
  { title: "Ship and talk", text: "Push to GitHub, and jump on a video call from the project." },
];

export const STACK = [
  { area: "Frontend", items: "React 19, Vite, React Router, Monaco, Yjs, Pyodide, LiveKit" },
  { area: "Backend", items: "FastAPI, SQLAlchemy, Alembic, pycrdt, Google Gemini" },
  { area: "Data and hosting", items: "Supabase Postgres with row-level security, Render, Vercel, GitHub Actions, Sentry" },
];
