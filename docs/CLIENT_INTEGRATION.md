# Build 03 — external WotLK browser-client integration

**Status:** Implemented local client mounting, isolated iframe, optional bridge,
normalized input delivery and offline installer. **Not actual WoW gameplay**.
No WoW assets or upstream client source are shipped in this repository.

## Why this client integration uses an external build

[Benilla-WotLK](https://github.com/Onixaz/benilla-wotlk) has a native
Rust/Bevy implementation but does not document a functioning WebAssembly
browser build. `cargo play` produces a native executable, not a mobile PWA.

[Wowser client](https://github.com/wowserhq/client) is a TypeScript/Vite
WebGL2 browser proof of concept. It currently advertises primitive rendering
and interface loading, **not** a complete login-to-world client.
The [older Wowser](https://github.com/wowserhq/wowser) reports authentication
and world packet handling, but is a separate legacy codebase, requiring
additional compatibility work. Neither qualifies as a turnkey mobile MMO.

This repository provides the mount lifecycle for whichever independent,
legally distributable client build proves viable. It does not modify,
redistribute or fetch either upstream project automatically.

## Try the external Wowser UI locally

The following steps require Node.js 22+, Python 3.11+, and an independently
obtained client build. Clone the **upstream code**, not Blizzard game assets.
Review the upstream MIT license and dependencies before running it.

```sh
git clone https://github.com/wowserhq/client.git ../wowser-client
cd ../wowser-client
npm ci
npm run build -- --base=/client/
cd ../Wow
python scripts/install_wowser.py ../wowser-client/dist
WOTLK_ENABLE_CLIENT=true python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
```

Open http://127.0.0.1:8765, select **Mount external client**, and inspect
client UI/renderer behavior. If the upstream build expects locally supplied
files (e.g. its own `public/Wowser` or user-provided 3.3.5a resources),
it can fail to render. This project does not provide or fetch them.

Never set `WOTLK_ENABLE_CLIENT=true` on a publicly accessible host. The
server additionally refuses all non-loopback client requests and nonlocal
Host headers. `WOTLK_ENABLE_GATEWAY` remains independent and disabled by
default. Successful mounting is not proof of authenticated gameplay.

## What the integration bridge actually does

`web/client_host.mjs` mounts the installed client in a sandboxed same-origin
iframe, performs an origin/source/nonce handshake with the injected
`web/client_bridge.mjs`, then forwards normalized input. The bridge translates
joystick input into synthetic W/A/S/D keyboard events and action buttons into
1–5; by default you can tap the embedded client UI. Switch on **Enable camera drag**
when you need the camera overlay instead of tapping menus. Camera deltas are dispatched as `wotlk-lab:camera` custom DOM events.

**Important limitation:** Modern browser engines can reject synthetic
keyboard events (`isTrusted=false`), and upstream Wowser may not listen to
these events. Actual game movement requires an explicit upstream integration
with the real client's input API. The bridge never claims game readiness.

`/api/client` truthfully advertises UI installation status, always reports
`gameplay_verified: false`, and does not reveal credentials or asset lists.
The installer rejects symlinks, raw game data formats, oversized builds,
root-absolute `/assets` references, and overlapping source/destination.
The installed client is excluded from version control.

## Next acceptance milestones (currently **not passed**)

1. Build upstream in a controlled environment and verify its UI loads.
2. Integrate a specific client input API (not synthetic key fallback).
3. Prove actual 3.3.5a world rendering with appropriately licensed data.
4. Verify account authentication and avatar movement against an authorized
   isolated test realm.
5. Test mobile Chrome + Safari with real hardware and load-performance logging.

Publicly hosting Blizzard game assets or an unauthorized public realm poses
separate intellectual-property and licensing issues.
