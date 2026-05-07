# Frontend Client Specification

Single-page vanilla JS WebRTC voice chat client. No frameworks, no bundler, no build step.

## HTML structure

The page uses semantic HTML only — no layout divs, no styling hooks. All presentation is controlled by the active theme CSS (CSS Zen Garden approach).

- `<h1>` — application title ("Concord")
- `<label>` with `<select id="theme-selector">` — theme picker (between title and peers section)
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
- Video is disabled for now (`video: false`)
- No screen sharing for now
- The local media stream must be assigned to `window.localStream` — the E2E tests access it via `page.evaluate()` to assert mute state. Do not remove this assignment.

## Signaling connection

- Connect to `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/` after mic permission is granted
- No automatic reconnection on disconnect for now

## Peer management

Full-mesh topology: each client establishes a direct RTCPeerConnection with every other client.

### Class hierarchy

- `PeerBase` — base class for all peer entries. Handles template cloning and provides reactive `name` and `emoji` getters/setters that automatically update the DOM when changed.
- `Self extends PeerBase` — the local user's entry. Handles local mute button (toggles `localStream` audio tracks).
- `Peer extends PeerBase` — a remote peer entry. Handles WebRTC (`RTCPeerConnection`), remote audio, mute, and volume slider.

### Self entry

On `welcome`, before creating any remote peer entries, render a self entry for the local user:

- Clone `<template id="self-template">` (contains `<article class="self">`, `<span class="peer-emoji">`, `<h2 class="peer-name">`, mute button only)
- Set the assigned emoji and nickname via the `Self` class setters
- UUID is stored internally but never displayed — the `.peer-name` element shows the server-assigned nickname
- No `<audio>` element, no volume slider (no need to hear or adjust yourself)
- Marked with `class="self"` on the `<article>` for visual distinction
- Mute button toggles `localStream` audio tracks' `enabled` property (enables/disables microphone)
- Button text: "Mute" when mic is active, "Unmute" when mic is disabled

### Rename / Change emoji

The self entry's name and emoji are editable:
- Clicking on `.peer-name` in the self entry activates inline editing (text input)
  - Enter commits the edit, Escape cancels
  - On commit: the client optimistically updates the display and sends a `{ type: "user-renamed", name }` signaling message
- Clicking on `.peer-emoji` in the self entry opens an emoji picker panel
  - The picker is a floating `<div class="emoji-picker">` positioned near the self entry
  - Emoji data is loaded from `emojis.js`, which defines `EMOJI_CATEGORIES` — a map of category names to emoji arrays
  - Category tabs (`.emoji-picker-tab`) at the top show the first emoji of each category as the tab label; clicking switches the grid
  - An emoji grid (`.emoji-picker-grid`) displays emojis for the active category in a 10-column grid
  - Clicking an emoji applies it immediately, closes the picker, and sends a `{ type: "user-renamed", emoji }` signaling message
  - Clicking outside the picker or pressing Escape closes it without changing

On receiving a `user-renamed` message:
- Update `name` and `emoji` on the matching `Peer` entry
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
- Send ICE candidates via signaling as `{ type: "ice-candidate", candidate, target }`
- On remote track: the `Peer` template (contains `<span class="peer-emoji">`, `<h2 class="peer-name">`, `<audio autoplay>`, mute button, volume slider) is already cloned in the constructor; attach stream to `<audio>` element

### SDP exchange

| step | action |
|---|---|
| Offerer sends | `{ type: "offer", sdp, target }` |
| Responder sends | `{ type: "answer", sdp, target }` |
| Both exchange | `{ type: "ice-candidate", candidate, target }` |
