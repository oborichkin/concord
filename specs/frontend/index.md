# Frontend Client Specification

Single-page vanilla JS WebRTC voice chat client. No frameworks, no bundler, no build step.

## HTML structure

The page uses semantic HTML only — no layout divs, no styling hooks. All presentation is controlled by the active theme CSS (CSS Zen Garden approach).

- `<h1>` — application title ("Concord")
- `<label>` with `<select id="theme-selector">` — theme picker (between title and peers section)
- `<section id="videos">` — video grid for webcam feeds (hidden when empty)
- `<section id="peers">` — contains peer templates and dynamically rendered peer articles
- `<template id="self-template">` — self entry template
- `<template id="peer-template">` — remote peer entry template

## Theming

Themes are self-contained CSS files in `frontend/themes/`. The active theme is set via `<link rel="stylesheet" id="theme-stylesheet">` whose `href` is swapped at runtime.

### Available themes

| name | file | description |
|---|---|---|
| `default` | `themes/default.css` | Clean minimal look (loaded when no preference saved) |
| `win98` | `themes/win98.css` | Windows 98 aesthetic — silver chrome, blue title bar, 3D beveled controls |

### Theme selector

- `<select id="theme-selector">` lists all available themes as `<option>` elements
- On change: update `<link>` href to `themes/{value}.css`, persist choice to `localStorage` key `theme`
- On page load: restore saved theme from `localStorage`, falling back to `default`
- If saved theme doesn't match any available `<option>`, fall back to `default` and overwrite `localStorage`
- An inline `<script>` in `<head>` (after the `<link>`) sets the correct href before first paint to prevent FOUC
- Each theme CSS is responsible for styling the `<label>`/`<select>` element (positioned top-right by default theme)

### Adding a new theme

1. Create `frontend/themes/<name>.css` — must style all semantic elements present in the HTML
2. Add `<option value="<name>">Display Name</option>` to `<select id="theme-selector">`
3. No other changes needed — CSS Zen Garden approach means the theme controls all presentation

## Media

- Acquire local audio via `getUserMedia` with `echoCancellation`, `noiseSuppression`, `autoGainControl` enabled
- Video is optional and off by default — the user can toggle their webcam on/off via a "Camera" button in the self entry
- No screen sharing for now
- The local media stream must be assigned to `window.localStream` — the E2E tests access it via `page.evaluate()` to assert mute state. Do not remove this assignment.

### Webcam sharing

- The self entry has a "Camera" button alongside the mute button
- Clicking "Camera" requests webcam access via `getUserMedia({ video: true })`, adds the video track to all existing peer connections, and shows a self-preview in the video grid
- Clicking "Stop Camera" stops the video track (camera light turns off), removes video tracks from all peer connections, and hides the self-preview
- When a remote peer's video track arrives, it is displayed in the video grid under that peer's name
- The video grid (`<section id="videos">`) is hidden when no participants have camera enabled

#### Video grid

- `<section id="videos">` sits above `<section id="peers">` in the HTML
- Hidden by default (no `active` class)
- Gains class `active` when any participant (self or remote) has an active video track
- Contains individual video cards, each with a `<video>` element and the peer's name
- Self-preview `<video>` is muted (no audio feedback) and mirrored horizontally via CSS

#### Camera toggling (signaling-driven, no renegotiation)

- Each `RTCPeerConnection` pre-allocates a video transceiver via `addTransceiver('video', { direction: 'sendrecv' })` at creation time
- The video m-line is always present in the SDP from the initial offer/answer — no renegotiation is ever needed for camera toggling
- Camera on: `replaceTrack(videoTrack)` on the stored `videoSender`, then broadcast `{ type: "camera-on" }` via signaling
- Camera off: `replaceTrack(null)` on the stored `videoSender`, then broadcast `{ type: "camera-off" }` via signaling
- New peers joining after camera is enabled: `replaceTrack` in the constructor sends the video track in the initial offer, plus a targeted `{ type: "camera-on", target }` is sent to the new peer
- On receiving `camera-on`: the remote peer calls `showRemoteVideo()` which attaches the pre-existing receiver stream to a video card
- On receiving `camera-off`: the remote peer calls `_hideVideo()` which removes the video card

## Signaling connection

- Connect to `ws://${window.location.host}/ws/` after mic permission is granted
- No automatic reconnection on disconnect for now

## Peer management

Full-mesh topology: each client establishes a direct RTCPeerConnection with every other client.

### Class hierarchy

- `PeerBase` — base class for all peer entries. Handles template cloning and provides reactive `name` and `emoji` getters/setters that automatically update the DOM when changed.
- `Self extends PeerBase` — the local user's entry. Handles local mute button (toggles `localStream` audio tracks) and camera toggle (starts/stops webcam, manages video grid self-preview).
- `Peer extends PeerBase` — a remote peer entry. Handles WebRTC (`RTCPeerConnection`), remote audio, mute, and volume slider.

### Self entry

On `welcome`, before creating any remote peer entries, render a self entry for the local user:

- Clone `<template id="self-template">` (contains `<article class="self">`, `<span class="peer-emoji">`, `<h2 class="peer-name">`, mute button, camera button)
- Set the assigned emoji and nickname via the `Self` class setters
- UUID is stored internally but never displayed — the `.peer-name` element shows the server-assigned nickname
- No `<audio>` element, no volume slider (no need to hear or adjust yourself)
- Marked with `class="self"` on the `<article>` for visual distinction
- Mute button toggles `localStream` audio tracks' `enabled` property (enables/disables microphone)
- Button text: "Mute" when mic is active, "Unmute" when mic is disabled
- Camera button toggles webcam on/off
  - "Camera" when webcam is off, "Stop Camera" when webcam is on
  - On enable: calls `getUserMedia({ video: true })`, adds video tracks to all peer connections, shows self-preview in video grid
  - On disable: stops video tracks, removes them from peer connections, hides self-preview from video grid
  - Self-preview video is muted (no audio feedback) and mirrored via CSS

### Rename / Change emoji

The self entry's name and emoji are editable:
- Clicking on `.peer-name` in the self entry activates inline editing (text input)
  - Enter commits the edit, Escape cancels
  - On commit: the client optimistically updates the display and sends a `{ type: "rename", name }` signaling message
  - Empty values are rejected (edit is cancelled)
- Clicking on `.peer-emoji` in the self entry opens an emoji picker panel
  - The picker is a floating `<div class="emoji-picker">` positioned near the self entry
  - Emoji data is loaded from `emojis.js`, which defines `EMOJI_CATEGORIES` — a map of category names to emoji arrays
  - Category tabs (`.emoji-picker-tab`) at the top show the first emoji of each category as the tab label; clicking switches the grid
  - An emoji grid (`.emoji-picker-grid`) displays emojis for the active category in a 10-column grid
  - Clicking an emoji applies it immediately, closes the picker, and sends a `{ type: "rename", emoji }` signaling message
  - Clicking outside the picker or pressing Escape closes it without changing

On receiving a `user-renamed` message:
- If the message's `user` matches the self entry's ID: update `name` and `emoji` on the self entry (unless currently being edited inline)
- Otherwise: update `name` and `emoji` on the matching `Peer` entry
- The `PeerBase` reactive setters automatically update the DOM

### Peer lifecycle

1. **On `welcome`**: render self entry (with emoji and name from `message.emoji`/`message.name`), then for each peer in `peers` array (objects with `id`, `emoji`, and `name`), create a `Peer` and send an SDP offer
2. **On `user-joined`**: create a `Peer` with `message.emoji` and `message.name` (do not send offer — the newcomer will send one)
3. **On `offer`**: from peer send answer.
4. **On `user-left`**: destroy the `Peer` (close RTCPeerConnection, remove DOM element)

### Peer connection setup

For each remote peer:
- Create `RTCPeerConnection` with ICE servers from the `welcome` message's `iceServers` field
- On `welcome`, store `message.iceServers` as the active ICE server list; fallback to `[stun:stun.l.google.com:19302]` if not provided
- Add all local audio tracks
- Pre-allocate a video transceiver via `addTransceiver('video', { direction: 'sendrecv' })` so the video m-line is always in the SDP
- If local webcam is active, set the video track on the transceiver's sender via `replaceTrack`
- Send ICE candidates via signaling as `{ type: "ice-candidate", candidate, target }`
- On remote track: audio tracks are attached to `<audio>` element; video tracks show/hide via `mute`/`unmute` events on the track

### SDP exchange

| step | action |
|---|---|
| Offerer sends | `{ type: "offer", sdp, target }` |
| Responder sends | `{ type: "answer", sdp, target }` |
| Both exchange | `{ type: "ice-candidate", candidate, target }` |
