# Split specs into individual files

Split `specs/frontend/index.md` and `specs/backend/index.md` into focused single-topic files. Add a TOC in `specs/index.md`.

## Target structure

```
specs/
  index.md                  ← TOC linking to all specs
  plans/                    ← future plans (this directory)
  frontend/
    theming.md              ← theme system, selector, adding themes
    peers.md                ← self entry, peer lifecycle, SDP exchange
    media.md                ← getUserMedia, audio constraints
    signaling-client.md     ← WebSocket connection, message handling
  backend/
    connection.md           ← UUID assignment, welcome, user-joined
    message-routing.md      ← targeted vs broadcast, protocol table
    disconnection.md        ← cleanup, user-left broadcast
```

## Rules

- Each file covers one concern
- `specs/index.md` is a flat TOC with links — no content, just a map of what exists and where
- Individual spec files are self-contained — no need to read other files to understand the topic
- Cross-reference other specs by filename when there's a dependency (e.g., "see `signaling-client.md` for message format")

## Status

Not urgent — current files are small enough to be manageable. Revisit when specs grow (e.g., when adding video/screen-sharing specs).
