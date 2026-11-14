# Screenshots

Captured on 2026-11-13 from a **local** stack only: a throwaway Postgres seeded with
`backend/scripts/seed_demo.py` (the demo project **NexusCode Demo — Weather CLI**
and the accounts `demo_priya`, `demo_alex`, `demo_sam`), the backend and the Vite dev
server, driven by headless Chromium (Playwright) at 1440×900 in the dark theme. No
production data and no real accounts or emails appear in them. PNGs are palette-
optimized (about 195 KB for the set).

**Updated on 2026-11-14 after the C6 UI polish.** These were re-captured the same way, from
the production build (`vite preview`), with reduced motion on so that no animation is caught
halfway: `00`, `01`, `02`, `03`, `04` and `08`, plus `frontend/public/og-image.png`.
`06`, `07` and `10` are **still the pre-C6 images**:
- `06` and `07` need a real Gemini agent run.
- `10` needs a real LiveKit call.
Re-taking those is a manual step and is listed below.

The landing page's own screenshots (`frontend/public/landing/*.webp`, board and editor in
both themes) come from the same local demo stack.

| File | What it shows | How it was made |
|------|---------------|-----------------|
| `00-landing.png` | The public landing page at `/` (signed out). | Automated. |
| `01-dashboard.png` | The project list after signing in as `demo_priya`. | Automated. |
| `02-board.png` | The Kanban board with the seeded tasks across To Do / In Progress / Done. | Automated. |
| `03-members-roles.png` | The Members panel: owner, editor, viewer. | Automated (element). |
| `04-editor-collab.png` | `src/weather.py` open as `demo_priya`, with `demo_alex`'s live cursor and name ("2 people editing"). | Automated: two signed-in browser sessions on the same file. |
| `06-agent-fix.png` | A real AI-agent run on the seeded bug: goal, quota ("1 of 2 runs left today"), step counter, timeline, and a change waiting for review. | Automated, one real agent run (Gemini). The bottom edge cuts the review buttons; `07` shows them. |
| `07-agent-diff.png` | That run's proposed diff for `src/weather.py`, with Accept / Reject. | Automated (element), same run. |
| `08-chat-activity.png` | Project chat (seeded messages) and the activity feed. | Automated: the two panels captured separately and placed side by side. The feed's two "started the AI agent" entries come from the capture run (the second, at the moment the script clicked Stop, made no AI calls). |
| `10-video-meeting.png` | A real two-person LiveKit call (`demo_priya` and `demo_sam`) with mic / camera / screen-share controls and device pickers. | Automated. The video is Chromium's **fake camera test pattern** and the devices are its fake devices ("Fake Default Audio Input", "fake_device_0"); the call itself was real. |

## Not captured

- **`06-agent-fix.png`, `07-agent-diff.png` and `10-video-meeting.png` are still the
  pre-C6 look.** Re-take them with the same flows once a Gemini key and a LiveKit project
  can be used for a demo run.

- **`05-run-python.png` — needs a manual screenshot.** The automated run clicked Run on
  `src/main.py` but the output did not appear within the 30-second limit, twice
  (headless first load of Pyodide), so it was skipped. To take it by hand: open
  `src/main.py` in the demo project and click **Run**; the seeded bug ends in
  `ValueError: could not convert string to float: ''`.
- **`09-architecture.png` — not needed.** The README embeds the architecture as a
  Mermaid diagram, which GitHub renders directly.

`frontend/public/og-image.png` (1200×630, the link preview for social sites) is a crop
of `00-landing.png`.
