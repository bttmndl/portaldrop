# PortalDrop — Phase 1

Capture anything with your phone camera and watch it fly through a portal onto your desktop canvas.

Phase 1 proves the full pipe end-to-end: QR pairing → live rear camera → capture → synchronized portal animation → draggable object on the desktop stage. No AI segmentation yet (that's Phase 2) — captures travel as full-frame JPEGs.

## Structure

```
portaldrop/
├── server/   Express + Socket.IO (deploy: Render)
└── client/   Vite + React, plain JavaScript (deploy: Vercel)
```

## Run locally

Terminal 1 — server:

```bash
cd server
npm install
npm run dev        # listens on :3001
```

Terminal 2 — client:

```bash
cd client
npm install
npm run dev        # listens on :5173, exposed on your LAN via --host
```

Open `http://localhost:5173` on the desktop. To test with a real phone on the same Wi-Fi, note the LAN URL Vite prints (e.g. `http://192.168.x.x:5173`) — **but** phone cameras require HTTPS or localhost, so for camera testing either:

- use a tunnel: `npx localtunnel --port 5173` (or ngrok / cloudflared), and set `VITE_SERVER_URL` to a tunnel for :3001 too, or
- just deploy — it's a two-minute push with the setup below.

## Environment

`client/.env`:

```
VITE_SERVER_URL=http://localhost:3001
```

Server env (optional):

```
PORT=3001
CLIENT_ORIGIN=https://your-client.vercel.app   # lock CORS in production
```

## Deploy (same shape as MST)

**Server → Render**
- New Web Service, root directory `server`
- Build: `npm install` · Start: `npm start`
- Set `CLIENT_ORIGIN` to your Vercel URL

**Client → Vercel**
- Root directory `client` (framework preset: Vite)
- Env var `VITE_SERVER_URL` = your Render URL
- `vercel.json` already rewrites all routes to `index.html` so `/join/CODE` deep links work

## Socket events

| Event | Direction | Payload |
|---|---|---|
| `room:create` | desktop → server | ack `{ ok, code }` |
| `room:join` | phone → server | `{ code }`, ack `{ ok }` |
| `room:phone-connected` / `-disconnected` | server → desktop | `{ phones }` |
| `object:transfer` | phone → server | `{ code, image, width, height, sentAt }` |
| `object:incoming` | server → desktop | `{ id, image, width, height, sentAt }` |
| `room:closed` | server → room | — |

Rooms live in memory and expire after 30 minutes. Redis replaces this when scaling to multiple server instances.

## Roadmap

- **Phase 2** — tap-to-segment with MediaPipe Interactive Segmenter (transparent PNG extraction on-device)
- **Phase 3** — full synchronized portal choreography (GSAP timeline, particles, shockwave)
- **Phase 4** — physics playground (throw, bounce, stack), undo/redo, persistence
- **Phase 5+** — point-at-monitor marker detection, multiplayer, auth, dashboard
