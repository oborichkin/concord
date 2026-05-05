# Signaling Server Specification

WebSocket relay server for WebRTC signaling. Manages peer connections via `Map<uuid, WebSocket>`.

## Connection

- Assign a UUID to each new WebSocket connection
- Send to the new peer:
  ```json
  { "type": "welcome", "id": "<uuid>", "peers": ["<existing-uuid>", ...] }
  ```
- Broadcast to all existing peers:
  ```json
  { "type": "user-joined", "user": "<new-uuid>" }
  ```
- Then register the new peer in the connections map

## Message routing

Each incoming message is parsed as JSON. Two routing modes:

### Targeted (when `data.target` is present)

- Strip `target` from the message
- Add `user` field with the sender's UUID
- Forward to `connections.get(target)`
- If target does not exist: silently drop (no error, no crash)

### Broadcast (when `data.target` is absent)

- Relay the raw message string to every peer except the sender

## Disconnection

- Remove the peer from the connections map
- Broadcast to all remaining peers:
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
