# Frontend Client Specification

Single-page vanilla JS WebRTC voice chat client. No frameworks, no bundler, no build step.

## Media

- Acquire local audio via `getUserMedia` with `echoCancellation`, `noiseSuppression`, `autoGainControl` enabled
- Video is disabled for now (`video: false`)
- No screen sharing for now

## Signaling connection

- Connect to `ws://${window.location.host}/ws/` after mic permission is granted
- No automatic reconnection on disconnect for now

## Peer management

Full-mesh topology: each client establishes a direct RTCPeerConnection with every other client.

### Peer lifecycle

1. **On `welcome`**: for each peer in `peers` array, create a `Peer` and send an SDP offer
2. **On `user-joined`**: create a `Peer` (do not send offer — the newcomer will send one)
3. **On `offer`**: from peer send answer.
3. **On `user-left`**: destroy the `Peer` (close RTCPeerConnection, remove DOM element)

### Peer connection setup

For each remote peer:
- Create `RTCPeerConnection` with STUN servers
- Add all local audio tracks
- Send ICE candidates via signaling as `{ type: "ice-candidate", candidate, target }`
- On remote track: create `<audio autoplay controls>` element, attach stream

### SDP exchange

| step | action |
|---|---|
| Offerer sends | `{ type: "offer", sdp, target }` |
| Responder sends | `{ type: "answer", sdp, target }` |
| Both exchange | `{ type: "ice-candidate", candidate, target }` |
