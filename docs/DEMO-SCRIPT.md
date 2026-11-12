# NexusCode — demo script (5–7 minutes)

A tight walkthrough that shows the real features on live data. It assumes the demo
project has been seeded (see **Setup**) so you never type boilerplate on stage.

## Setup (before the demo)
1. Seed the demo data against a **local or throwaway** database (never production):
   ```
   cd backend
   DEMO_SEED=1 python scripts/seed_demo.py
   ```
   This creates the **"NexusCode Demo — Weather CLI"** project and three accounts,
   all with the password printed by the script:
   - `demo_priya` — **owner**
   - `demo_alex` — **editor**
   - `demo_sam` — **viewer**
2. Start backend + frontend. Have two browsers (or a normal + incognito window)
   ready so you can be two people at once for the collab + presence bits.
3. Afterwards: `DEMO_SEED=1 python scripts/seed_demo.py --remove`.

## The flow

**0:00 — Sign in & the dashboard (45s)**
Sign in as `demo_priya`. Show the project list and open *Weather CLI*. One line on
what NexusCode is: *a shared workspace where a team plans, writes, runs and
AI-assists code in one place.*

**0:45 — Roles & members (45s)**
Open Members. Show the three roles. Mention access is enforced server-side (and in
the database via row-level security), not just hidden in the UI. Open a second
window signed in as `demo_sam` (viewer) to show the same project read-only.

**1:30 — The Kanban board (60s)**
Walk the board: *todo / in progress / done*, priorities, assignees, due dates.
Drag "Fix the average() off-by-one bug" between columns — the move shows up in the
**Activity** feed. Point out that `demo_sam` (viewer) can't move cards.

**2:30 — Collaborative editing (75s)**
Open `src/weather.py` in the editor. In the second window (as `demo_alex`), open the
same file. Type in one window and show it appear live in the other, with the other
person's cursor and name (presence). Call out: real Yjs CRDT sync, survives
reconnects, persisted so it's there after a refresh.

**3:45 — Run the code (45s)**
Open `src/main.py` and Run it (Python via Pyodide, in the browser). It misbehaves
because of the seeded bugs — a nice segue. (JS files run too, in a sandboxed
worker.)

**4:30 — The AI agent fixes the bug (90s)**
Open the agent on `src/weather.py`. Ask it: *"average() returns a number that's too
low and parse_temps crashes on blank lines — find and fix both bugs."* Watch it read
the file, propose edits, and apply them. Re-run `main.py` to show it now works. Call
out the guardrails: step/token/time caps, network-blocked sandbox, review-before-apply.

**6:00 — Chat & activity (30s)**
Show the project chat (seeded conversation) and the activity feed reflecting
everything that just happened. Then click **📹 Start Meeting**: both windows join
the same call (camera, mic, screen share), and the viewer can join too.

**6:30 — Close (30s)**
One slide on the stack: React + Vite front end, FastAPI back end, Supabase Postgres
with RLS, deployed on Vercel + Render, GitHub Actions CI. End on the architecture
diagram (see `docs/ARCHITECTURE-NOTES.md`).

## If something fails live
- Agent quota hit → show a previous successful run / screenshots instead.
- Collab not syncing → refresh both windows; confirm the WebSocket connected.
- Keep the seed/remove commands handy to reset between runs.
