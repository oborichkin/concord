# Bugs

- [ ] **Server crash on targeted message to disconnected peer** (`signaling/server.js:35`)
  `connections.get(target)` returns `undefined` if target disconnected. Calling `.send()` on `undefined` throws.

- [ ] **ICE candidates arriving before remote description** (`frontend/client.js:63-65`)
  `addIceCandidate()` throws if called before `setRemoteDescription()`. Need to queue candidates and flush after remote description is set.

- [ ] **`peers.get()` can return `undefined` in message handlers** (`frontend/client.js:93,100,103,106`)
  Race condition during connect/disconnect causes crash when calling methods on `undefined`.

- [ ] **No reconnection on WebSocket close** (`frontend/client.js:135-137`)
  User is permanently disconnected with no recovery and no UI feedback.

- [ ] **Broadcast path in server is inconsistent** (`signaling/server.js:37-41`)
  Targeted path strips `target` and injects `user`, but broadcast path forwards raw messages without adding `user`. Unused now but a latent bug.

- [ ] **Unhandled rejection in `onmessage` handler** (`frontend/client.js:139-141`)
  `await handleMessage(message)` runs inside `onmessage`. If it throws, the rejection is silently swallowed.

# Inconsistencies

- [ ] **Leftover debug text in log** (`signaling/server.js:25`)
  `"New client ababa connected"` should be cleaned up.

# Suggestions

- [ ] **Show feedback when mic permission denied** (`frontend/client.js:143-145`)
  `getUserMedia` catch only logs to console. User sees nothing.

- [ ] **Monitor ICE connection state**
  No `oniceconnectionstatechange` handling. Stale/failed peer connections go undetected and accumulate.

- [ ] **Add WebSocket ping/keepalive**
  No application-level heartbeat. Silent TCP drops go undetected.

- [ ] **Queue ICE candidates until remote description is set**
  Related to ICE candidates bug — buffer early candidates and drain after `setRemoteDescription`.
