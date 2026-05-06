# Tech Debt Assessment

## 1. Mixed async/await and promise usage in client.js

**Status:** DONE

The client mixed `.then()` chains and `async`/`await` for equivalent operations:
- `createOffer()` chain used nested `.then()` with no error handling
- `connect()` was declared `async` but used `.then()`/`.catch()` internally
- `handleOffer()`, `handleAnswer()`, `addIceCandidate()` used `async`/`await`

**Fix:** Standardized on `async`/`await` throughout. Added `createAndSendOffer()` method on Peer class. Rewrote `connect()` to use `await`.

---

## 2. Crash bugs

**Status:** TODO

### 2a. No `ws.on('error')` handler in server.js
Unhandled WebSocket errors will crash the Node.js process (ws v8 throws on unhandled `error` events).

**Fix:** Add `ws.on('error', (err) => console.error('WebSocket error:', err))` inside the `connection` handler, alongside the existing `message` and `close` listeners.

### 2b. Unhandled promise rejections from `ws.send()` in server.js
In ws v8, `.send()` returns a Promise when no callback is given. All 5 `.send()` calls are fire-and-forget with no `.catch()`.

**Fix:** Add a helper `function send(ws, data)` that calls `ws.send(data).catch((err) => console.error('Send error:', err))` and use it at all 5 send sites (welcome, user-joined broadcast, targeted forward, broadcast forward, user-left broadcast).

### 2c. No null checks on `peers.get()` in client.js
If a message arrives for a peer not in the map (race condition, stale message), calling methods on `undefined` throws `TypeError`. Lines 114, 121, 124, 127.

**Fix:** Add early-return null checks in `handleMessage` for `user-left`, `offer`, `answer`, and `ice-candidate` cases:
```js
case "user-left": {
    const peer = peers.get(message.user);
    if (peer) { peer.destroy(); peers.delete(message.user); }
    break;
}
case "offer": {
    const peer = peers.get(message.user);
    if (peer) await peer.handleOffer(message);
    break;
}
// same pattern for "answer" and "ice-candidate"
```

### 2d. No try/catch in client's message handling pipeline
`handleMessage` and the `onmessage` handler have no error handling. Any error becomes an unhandled promise rejection.

**Fix:** Wrap the body of `handleMessage` in try/catch, logging errors with `console.error`.

### Tests to add

- **Server: "does not crash when sending to a connection that closed mid-message"** — open two clients, get IDs, abruptly close client 1, have client 2 send a targeted message to client 1's now-stale ID. Verify server and client 2 both survive (client 2 still OPEN).

---

## 3. Robustness

**Status:** TODO

### 3a. No WebSocket heartbeat/ping
Silently-dropped connections leave stale entries in the server's `connections` Map forever. Add periodic ping/pong or idle timeout.

### 3b. No graceful shutdown
No SIGTERM/SIGINT handler. Server dies without sending `user-left` notifications to remaining clients.

### 3c. Connection registered after notifications (server.js)
Server adds new connection to the Map *after* notifying peers (lines 28-43). Logically backwards — should register first, then notify.

### 3d. `localStream` tracks never stopped
Microphone stays active even when all peers disconnect.

### 3e. `window.localStream` debug leftover
Line 148 exposes the stream globally. Remove.

---

## 4. Style cleanup

**Status:** TODO

### 4a. Inconsistent semicolons
Many missing throughout server.js and client.js.

### 4b. Loose equality `!=` in server.js
Line 59 uses `!=` instead of `!==` for broadcast filtering.

### 4c. Unnecessary double-quoted object keys in server.js
`"type": "welcome"` etc. — unnecessary in modern JS.

### 4d. `peersDiv` declared with `let` but never reassigned
Should be `const`.

### 4e. Mute state tracked via button text comparison
Fragile. Should use a boolean or data attribute.

### 4f. Empty `.catch()` on `audioElement.play()`
Silently swallows autoplay errors.

### 4g. Console logging in production
`console.log('Received message:', message)` and other debug logs left in.

### 4h. Commented-out code
`// console.warn("Unexpected message", message)` at line 130.

### 4i. Low-value comments
`// Objects`, `// Peer`, `// Stream setup`, `// Signaling socket setup`, `// DOM Elements` — describe what code already says.

---

## 5. Infrastructure

**Status:** TODO

### 5a. Dockerfile health check targets HTTP on WebSocket-only server
Health check makes HTTP GET to port 8080, but standalone signaling server has no HTTP endpoints. Container will be permanently unhealthy.
