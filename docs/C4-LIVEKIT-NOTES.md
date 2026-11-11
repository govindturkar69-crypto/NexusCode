# C4 — LiveKit group video: groundwork notes

**Status: groundwork only. No feature code in this branch.** C4 replaces the
current 1:1 WebRTC-signaling meeting with LiveKit-based group video. This file
inventories what exists today, what C4 will remove/replace, the tests to rewrite,
and the deploy/CSP/permissions changes LiveKit needs. Per the project rule, **the
old meeting code stays until C4 replaces it** — nothing here is deleted yet.

## 1. Current meeting code (to be replaced by C4)

The current feature is a **1:1 WebRTC call** where the browser does the media and
the backend is only a signaling relay (offer / answer / ICE candidates).

### Frontend
| File | Lines | Role |
|------|-------|------|
| `frontend/src/pages/VideoMeeting.jsx` | 142 | The meeting page/UI (lazy route). |
| `frontend/src/meeting/session.js` | 134 | WebRTC session: `RTCPeerConnection`, `getUserMedia`, signaling over the meeting WebSocket. |
| `frontend/src/meeting/session.test.js` | 150 | Unit tests for the session. |

Wired in at:
- `frontend/src/App.jsx:18` — `const VideoMeeting = lazy(() => import("./pages/VideoMeeting"))`
- `frontend/src/App.jsx:76` — `<Route path="/projects/:projectId/meeting" element={protect(<VideoMeeting />)} />`
- `frontend/src/pages/Board.jsx:152` — `📹 Start Meeting` link to `/projects/:projectId/meeting`

### Backend
| File | What |
|------|------|
| `backend/app/services/realtime.py:73-92` | `VideoMeetingManager(_RoomManager)` + the `video_manager` singleton: `join_if_room` (caps the room at `MAX_MEETING_PEERS`), `broadcast_to_peer` (relays signals to the other peer). |
| `backend/app/routers/chat.py:193-232` | `@router.websocket("/ws/projects/{project_id}/meeting")` — authorizes, accepts, assigns the initiator role, relays `SIGNAL_TYPES` frames to the peer. |
| `backend/app/routers/chat.py:37-39` | Constants: `MAX_SIGNAL_FRAME_BYTES = 64*1024`, `SIGNAL_TYPES = {"offer","answer","ice-candidate"}`, `MAX_MEETING_PEERS = 2`. |

### Backend tests (meeting-specific)
In `backend/tests/test_websockets.py`:
- `test_websockets.py:32` — parametrized `["chat","meeting"]` auth/handshake tests (the `meeting` cases go; the `chat` cases stay — this test needs splitting, not deleting).
- `test_meeting_tells_exactly_one_peer_to_offer` (:98)
- `test_meeting_room_holds_two_peers` (:112)
- `test_meeting_relays_only_signals_and_never_to_chat` (:125)
- `test_meeting_drops_oversized_frames` (:143)

## 2. What C4 removes / replaces

**Removes (once LiveKit is wired):**
- `frontend/src/meeting/session.js` + `session.test.js` — browser WebRTC is replaced by the LiveKit client SDK.
- `backend/app/services/realtime.py` `VideoMeetingManager` + `video_manager` singleton.
- `backend/app/routers/chat.py` meeting WebSocket (`:193-232`) and signaling constants (`:37-39`). The backend no longer relays media signaling; LiveKit's SFU does.

**Replaces with:**
- A new **token endpoint** (e.g. `POST /projects/{project_id}/meeting/token`) that
  checks the project role (reuse `require_project_role`), then mints a short-lived
  LiveKit access token (room = project id, identity = user) signed with
  `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`. Needs the `livekit-api` server SDK.
- `VideoMeeting.jsx` rewired to join a LiveKit room with that token using the
  LiveKit JS client (grid of participants, mute/camera/screen-share controls).
- `Board.jsx:152` link can stay (same route), now a group call.

**Keep as-is:** `App.jsx` route and the `/meeting` path; the auth helper
`_authorize_websocket` (still useful if any realtime signaling remains, else drop).

### Tests to rewrite
- Split the `["chat","meeting"]` parametrization in `test_websockets.py:32` so the
  shared cases cover only `chat`.
- Delete the four meeting signaling tests (:98,:112,:125,:143) — they test the relay
  that LiveKit removes.
- Delete `frontend/src/meeting/session.test.js`; add tests for the token endpoint
  (role enforcement, token shape/TTL — mock the LiveKit signer) and a thin
  frontend test for the join flow (mock the LiveKit client).

## 3. Deploy / infrastructure changes LiveKit needs

### Environment variables (already stubbed, commented, in `backend/.env.example`)
- `LIVEKIT_URL` — e.g. `wss://<your-project>.livekit.cloud`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
Source: LiveKit Cloud project → Settings → Keys (or a self-hosted server). Add on
**Render** (backend) for signing; the frontend needs the `wss://` URL (via a
`VITE_LIVEKIT_URL` build var on **Vercel**, to add when C4 lands).

### CSP — not currently blocking (verified)
The app document has **no** `Content-Security-Policy` (see `frontend/vercel.json`
and `docs/CSP-RETEST-CHECKLIST.md`). The only CSPs are scoped to the two agent
**worker** bundles, which LiveKit never loads. **So nothing blocks LiveKit today.**

If a document-level CSP is ever introduced, LiveKit will need at least:
- `connect-src wss://*.livekit.cloud https://*.livekit.cloud`
- `media-src blob:` , `img-src blob:`
- `worker-src blob:`

### Permissions-Policy — must be added for camera/mic/screen-share
There is currently **no `Permissions-Policy` header anywhere** (backend `main.py`
sets nosniff/frame/referrer/HSTS only; `vercel.json` sets nosniff/frame/referrer on
the document). Modern browsers gate `getUserMedia` / `getDisplayMedia` behind
Permissions-Policy. For the **Vercel-served frontend** (the page that calls the
camera), add to the `/(.*)` header block in `vercel.json`:

```
Permissions-Policy: camera=(self), microphone=(self), display-capture=(self)
```

The backend API (Render) does not render the meeting UI, so it does not need this
header; leave the API's headers as they are. (If the frontend is ever embedded in
an iframe, the embedding page's `allow=` attribute also matters — out of scope.)

### Render / cold start
LiveKit media runs on LiveKit Cloud's SFU, not on Render, so the free-tier
single-instance / cold-start limits do **not** affect call quality. The backend is
only hit for the short token request. No new always-on process is required.

## 4. C4 implementation checklist (for when the feature is built — not now)
1. Add `livekit-api` to `backend/requirements.txt`; add the token endpoint with role check + tests.
2. Set `LIVEKIT_*` on Render; `VITE_LIVEKIT_URL` on Vercel.
3. Add the `Permissions-Policy` header to `vercel.json`.
4. Rewrite `VideoMeeting.jsx` on the LiveKit client; remove `meeting/session.*`.
5. Remove the backend meeting WebSocket + `VideoMeetingManager`; update `test_websockets.py`.
6. Re-run the CSP re-test checklist (confirm no new document CSP sneaks in).
