# NexusCode — demo script (about 7 minutes)

A walkthrough of the real features on the seeded demo project, in order. Nothing is
typed from scratch on stage.

## Setup (before the demo)
1. Seed the demo data into a **local or throwaway** database (never production):
   ```
   cd backend
   DEMO_SEED=1 python scripts/seed_demo.py
   ```
   It creates the **"NexusCode Demo — Weather CLI"** project and three accounts, all
   with the password the script prints:
   - `demo_priya`: **owner**
   - `demo_alex`: **editor**
   - `demo_sam`: **viewer**
2. Start the backend and the frontend. For the video step, set `LIVEKIT_*` in
   `backend/.env` and `VITE_LIVEKIT_URL` in `frontend/.env` (see `docs/DEPLOY.md`).
3. Open two browsers (or a normal and a private window) so you can be two people at
   once. Sign the second one in as `demo_alex`.
4. Agent check: each user gets 2 agent runs a day. Do one rehearsal run at most, or use
   a fresh database.
5. Afterwards: `DEMO_SEED=1 python scripts/seed_demo.py --remove`.

## The flow

**0:00 — Landing page (20s)**
Open the site signed out: the landing page lists what NexusCode does. One line: *a
shared workspace where a team plans, writes, runs and AI-assists code in one place.*
Click **Sign in**.

**0:20 — Sign in and projects (25s)**
Sign in as `demo_priya`. Show the project list and open *Weather CLI*.

**0:45 — Roles and members (45s)**
Scroll to **Members**: owner, editor, viewer. Access is enforced on the server and by
row-level security in the database, not just hidden in the UI.

**1:30 — The Kanban board (60s)**
To Do / In Progress / Done, with priorities, assignees and due dates. Drag "Fix the
average() off-by-one bug" to another column (keyboard works too); the move appears in
**Activity**. A viewer (`demo_sam`) can't drag tasks.

**2:30 — Collaborative editing (75s)**
Open the code editor and `src/weather.py` in both windows. Type in one and it appears
in the other, with the other person's cursor and name ("2 people editing"). It is a
Yjs document: it survives reconnects and is saved, so it's there after a refresh.

**3:45 — Run the code (45s)**
Open `src/main.py` and click **Run** (Python via Pyodide, in the browser, nothing on
the server). It stops with `ValueError: could not convert string to float: ''`,
the planted bug in `parse_temps`. (The other planted bug makes the average too low.)

**4:30 — The AI agent fixes it (90s)**
Click **🤖 Agent** and give it: *"average() returns a number that's too low and
parse_temps crashes on blank lines in src/weather.py. Fix both bugs, then run
src/main.py to check."* Watch the timeline: it lists and reads files, then proposes a
change as a diff. Click **Accept**, then run `src/main.py` again: it prints
`average: 31.2` and `hottest: Pune`. Point out the limits on screen: steps (8 per
run), the daily quota, no network for its code, and that nothing is saved until you
accept it.

**6:00 — Chat and activity (20s)**
The project chat (seeded conversation, who is online) and the activity feed showing
the task move and the agent run.

**6:20 — Video meeting (30s)**
Click **📹 Start Meeting** in both windows and **Join**: camera, mic, screen share and
device choice. Any member can join, viewers too. **Leave** turns the camera off.

**6:50 — Close (10s)**
The stack: React + Vite, FastAPI, Supabase Postgres with RLS, LiveKit, on Vercel and
Render, with GitHub Actions CI. End on the architecture diagram in the README.

## If something goes wrong live
- **Agent quota used up, or Gemini busy:** show `docs/screenshots/06-agent-fix.png` and
  `07-agent-diff.png`, which are from a real run.
- **Live editing not syncing:** refresh both windows. The first request after the free
  tier has slept can take up to a minute.
- **"Video is not configured":** `VITE_LIVEKIT_URL` is missing on the frontend (it
  needs a rebuild or restart after setting it). A 503 on Join means the backend's
  `LIVEKIT_*` are missing.
- Reset between rehearsals with the seed `--remove` command, then seed again.
