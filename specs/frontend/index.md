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

### Self entry

On `welcome`, before creating any remote peer entries, render a self entry for the local user:

- Clone `<template id="self-template">` (contains `<article class="self">`, `<h2 class="peer-name">`, mute button only)
- Display the user's own UUID as the name
- No `<audio>` element, no volume slider (no need to hear or adjust yourself)
- Marked with `class="self"` on the `<article>` for visual distinction
- Mute button toggles `localStream` audio tracks' `enabled` property (enables/disables microphone)
- Button text: "Mute" when mic is active, "Unmute" when mic is disabled

### Peer lifecycle

1. **On `welcome`**: render self entry, then for each peer in `peers` array, create a `Peer` and send an SDP offer
2. **On `user-joined`**: create a `Peer` (do not send offer — the newcomer will send one)
3. **On `offer`**: from peer send answer.
4. **On `user-left`**: destroy the `Peer` (close RTCPeerConnection, remove DOM element)

### Peer connection setup

For each remote peer:
- Create `RTCPeerConnection` with STUN servers
- Add all local audio tracks
- Send ICE candidates via signaling as `{ type: "ice-candidate", candidate, target }`
- On remote track: clone `<template id="peer-template">` (contains `<audio autoplay>`, mute button, volume slider), attach stream to `<audio>` element

### SDP exchange

| step | action |
|---|---|
| Offerer sends | `{ type: "offer", sdp, target }` |
| Responder sends | `{ type: "answer", sdp, target }` |
| Both exchange | `{ type: "ice-candidate", candidate, target }` |
