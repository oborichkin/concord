# Concord

WebRTC voice/video/screen-sharing chat. Static frontend + Node.js WebSocket signaling server + Caddy reverse proxy + Coturn TURN server.

## Development

```sh
docker compose up
```

Caddy serves the frontend on `http://localhost:8080` and proxies `/ws/` to the signaling server. The signaling server runs with nodemon and auto-restarts on changes. No TURN server in dev — the client falls back to Google's public STUN.

### Signaling server only

```sh
cd signaling
npm install
npm run dev
```

### Tests

```sh
cd signaling && npm test          # integration tests
cd e2e && npm test                # E2E tests (Playwright)
```

## Production deployment

### Prerequisites

- A server with Docker and Docker Compose
- A public domain name pointing to the server's IP address
- Open firewall ports: 80/tcp, 443/tcp, 3478/tcp, 3478/udp, 5349/tcp, 5349/udp, 49152-65535/udp

### Setup

1. Copy the example env file:

```sh
cp .env.prod .env
```

2. Edit `.env` and set your values:

```sh
COMPOSE_FILE=docker-compose.prod.yml
DOMAIN=chat.example.com
HTTP_PORT=80
HTTPS_PORT=443
TURN_SECRET=<your-secret>
```

3. Generate a strong TURN secret:

```sh
openssl rand -base64 32
```

Use the output as `TURN_SECRET`.

4. Start the stack:

```sh
docker compose up -d
```

Caddy automatically provisions TLS certificates via Let's Encrypt for your domain. The coturn server discovers those certificates from Caddy's shared data volume and uses them for TURNS (TLS) on port 5349. If TLS certs are not yet provisioned, coturn starts without TLS — TURN over UDP/TCP on port 3478 still works.

### How it works

- **Caddy** serves the static frontend, proxies WebSocket connections to the signaling server, and auto-provisions TLS
- **Signaling server** manages peer connections, relays WebRTC signaling messages, and generates time-limited TURN credentials (HMAC-SHA1, 24h expiry) sent in the `welcome` message
- **Coturn** provides STUN/TURN relay for WebRTC when direct peer connections are blocked by NATs/firewalls — uses the same `TURN_SECRET` to validate credentials
- **Frontend** uses the ICE servers from the signaling server's `welcome` message to configure WebRTC peer connections

### Architecture

```
Client ──HTTPS/WSS──▶ Caddy ──WS──▶ Signaling Server
   │                                       │
   │  ◀── welcome + ICE servers ──────────┘
   │
   ├── STUN/TURN (UDP 3478) ──▶ Coturn
   └── TURNS   (TCP 5349) ──▶ Coturn
```
