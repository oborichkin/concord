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
docker compose up                                    # dev: Caddy on :8080
docker compose -f docker-compose.prod.yml up -d      # production
```

Production requires a `.env` file (copy from `.env.prod` and set `DOMAIN`). Caddy auto-provisions TLS via Let's Encrypt for public domains.

Frontend is served as static files by Caddy — no build step. The signaling server is the only Node package (`signaling/`).

## Signaling server (`signaling/`)

- ESM (`"type": "module"` in package.json), requires Node >= 18
- Entrypoint: `server.js`
- Dependencies: `ws`, `uuid`
- Dev: `npm run dev` (uses nodemon, auto-restarts on changes)
- Test: `npm test` (integration tests in `server.test.js`)

## Architecture

- `frontend/` — plain HTML + JS, no framework, no bundler. docker-compose mounts the dir directly into Caddy.
- `Caddyfile` — Caddy reverse proxy config: `/` serves frontend static files, `/ws/` proxies WebSocket connections to signaling-server. Auto-HTTPS in production.
- `signaling/` — WebSocket signaling server. Manages peer connections via `Map<uuid, WebSocket>`. Messages are JSON; targeted (`data.target`) or broadcast.
- `specs/` — feature specifications (source of truth for spec-driven development).

## Spec-driven development

Specifications in `specs/` are the source of truth. When implementing or modifying features:

1. **Read the relevant spec first** — understand expected behavior before touching code
2. **Update the spec** — if the user requests a change, update the spec before writing code
3. **Keep code and tests in sync with the spec** — implementation must match the spec; tests must cover most behavior described in the spec if possible.
4. **Spec > code > tests** — if code and spec disagree, the spec wins. Update code to match. If tests and spec disagree, the spec wins. Update tests to match.

### Test command

```sh
cd signaling && npm test
```
