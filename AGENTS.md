# AGENTS.md — Concord

WebRTC voice/video/screen-sharing chat: static frontend + Node.js WebSocket signaling server + nginx reverse proxy.

## Design philosophy

Minimal, bare-bones implementation. Goals:

- Voice, video, and screen sharing in as few lines of code as possible (without sacrificing readability)
- As few dependencies as possible
- No JS frameworks on the frontend
- Frontend HTML must have solid semantic structure — no styling hooks, no layout divs. The HTML alone should define the document, and a separate CSS file should fully control presentation (CSS Zen Garden approach)

## Running

```sh
docker-compose up          # nginx on :8080, signaling-server on :3001 (internal :8080)
```

Frontend is served as static files by nginx — no build step. The signaling server is the only Node package (`signaling/`).

## Signaling server (`signaling/`)

- ESM (`"type": "module"` in package.json), requires Node >= 18
- Entrypoint: `server.js`
- Dependencies: `ws`, `uuid`
- Dev: `npm run dev` (uses nodemon, auto-restarts on changes)
- No tests, no linter, no typecheck configured

## Architecture

- `frontend/` — plain HTML + JS, no framework, no bundler. `frontend/Dockerfile` is empty/unused (docker-compose mounts the dir directly into nginx).
- `nginx/nginx.conf` — reverse proxy: `/` serves frontend static files, `/ws/` proxies WebSocket connections to signaling-server.
- `signaling/` — WebSocket signaling server. Manages peer connections via `Map<uuid, WebSocket>`. Messages are JSON; targeted (`data.target`) or broadcast.
