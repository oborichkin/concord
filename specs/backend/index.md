# Signaling Server Specification

WebSocket relay server for WebRTC signaling. Manages peer connections via `Map<uuid, { ws, emoji, name }>`.

## Connection

- Assign a UUID, a random emoji (from a predefined pool), and a randomly generated nickname to each new WebSocket connection
- Nicknames are in the format `<Adjective> <Noun>` (Title Case, space-separated), e.g. `Brave Whale`, `Calm Panda`
- Nicknames are generated from a predefined list of ~50 adjectives and ~100 nouns
- If the generated nickname collides with an existing peer's nickname, append a numeric suffix starting at 2 (e.g. `Brave Whale 2`, `Brave Whale 3`)
- Send to the new peer:
  ```json
  { "type": "welcome", "id": "<uuid>", "emoji": "<emoji>", "name": "<nickname>", "peers": [{"id": "<existing-uuid>", "emoji": "<emoji>", "name": "<nickname>"}, ...], "iceServers": [...] }
  ```
- Broadcast to all existing peers:
  ```json
  { "type": "user-joined", "user": "<new-uuid>", "emoji": "<emoji>", "name": "<nickname>" }
  ```
- Then register the new peer in the connections map (value: `{ ws, emoji, name }`)

## ICE servers

The `welcome` message includes an `iceServers` array for WebRTC peer connection configuration.

When `TURN_SECRET` and `TURN_DOMAIN` environment variables are set (production):
- Generates time-limited TURN credentials using HMAC-SHA1
- Username format: `<expiry-timestamp>:concord` (expiry is 24 hours from now)
- Credential: base64-encoded HMAC-SHA1 of the username using `TURN_SECRET` as the key
- Includes three TURN entries: UDP, TCP, and TURNS (TLS over TCP)
- Also includes a Google STUN server as fallback

When `TURN_SECRET` or `TURN_DOMAIN` is not set (development):
- Returns only `[{ urls: 'stun:stun.l.google.com:19302' }]`

## Rename

A connected peer may change their display name and/or emoji:

```json
{ "type": "rename", "name": "<new-name>" }
{ "type": "rename", "emoji": "<new-emoji>" }
{ "type": "rename", "name": "<new-name>", "emoji": "<new-emoji>" }
```

- At least one of `name` or `emoji` must be present
- `name` must be a non-empty string (max 64 characters); otherwise it is ignored
- `emoji` must be a non-empty string (max 32 characters); otherwise it is ignored
- Duplicate names are allowed (no uniqueness enforcement on rename)
- Server updates the connection's stored name/emoji
- Server broadcasts to all connections (including the sender):
  ```json
  { "type": "user-renamed", "user": "<uuid>", "name": "<current-name>", "emoji": "<current-emoji>" }
  ```
- The broadcast always includes both `name` and `emoji` (the full current identity)

## Message routing

Each incoming message is parsed as JSON. Two routing modes:

### Targeted (when `data.target` is present)

- Strip `target` from the message
- Add `user` field with the sender's UUID
- Forward to `connections.get(target).ws`
- If target does not exist: silently drop (no error, no crash)

### Broadcast (when `data.target` is absent)

- Relay the raw message string to every peer except the sender (via `conn.ws`)

## Disconnection

- Remove the peer from the connections map
- Broadcast to all remaining peers via `conn.ws`:
  ```json
  { "type": "user-left", "user": "<disconnected-uuid>" }
  ```

## Error handling

- Malformed JSON: log the error, keep the connection alive
- Any other error during message processing: log and continue

## Signaling protocol (message types relayed between peers)

| type | direction | fields | purpose |
|---|---|---|---|
| `offer` | sender → target | `sdp`, `target` | SDP offer |
| `answer` | sender → target | `sdp`, `target` | SDP answer |
| `ice-candidate` | sender → target | `candidate`, `target` | ICE candidate |

These are all targeted messages. The server does not inspect or validate their contents — it only routes them.

## Exports

`createServer({ port?, server? })` — returns `{ wss, connections }`. If `server` is provided, the WebSocket server attaches to that HTTP server at path `/ws/`; otherwise a new HTTP server is created on the given `port`.
