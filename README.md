# WotLK Mobile Browser Lab — Build 02

**Status: Engineering prototype, NOT a playable World of Warcraft client.**

A standalone, mobile-first browser shell to evaluate a future **legally sourced** WotLK 3.3.5a-compatible runtime. It contains a touch joystick, action buttons, camera drag input, browser WebAssembly/WebGL2 capability diagnostics, an **opt-in, original WebGL2 graphics test**, and a **disabled-by-default**, byte-transparent WebSocket-to-TCP development bridge. There is **no** WoW authentication, character selection, original WoW world rendering, game-server implementation, or game content included. The rendering test is a procedural, asset-free environment: **not the WoW world**.

This repository is intentionally separate from MikroMagic/Mega-Magic and from any existing production hosting.

## Run locally

Requires Python 3.11+.

```bash
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
```

Open **http://127.0.0.1:8765** on the same computer, then try the touch/mouse controls and check diagnostics. For a **phone** on the same LAN, the server would need LAN exposure with suitable network restrictions and TLS for production-like browser behavior; this prototype is **not safe to expose publicly**.

Test:

```bash
python -m pytest -q
node --test tests/*.test.mjs   # optional Node.js 20+ JS tests
```

The browser interface works without a game server. The `/api/health` endpoint explicitly says `gameplay_ready: false`. `/api/realm-status` tests only TCP reachability, not authentic gameplay readiness.

## Build 02 graphics test

Select **Start graphics test** in the Touch controls lab. It draws a completely original
procedural landscape in WebGL2, responds to joystick/WASD movement, camera drag, and action
buttons, and displays approximate FPS. It caps rendering around 30 FPS to reduce unnecessary
battery use. **No WoW client, real game assets, or live characters are involved.**

This is a browser rendering and input feasibility check, not proof that a 3.3.5a
game engine can run in Safari or Chrome. The project has **not** been tested
on real Android/iOS hardware. Headless Chromium in the development sandbox lacks WebGL2,
so shader compilation and live GPU output still need verification on real hardware.

## Optional local gateway — development only

The gateway is **off by default**, rejects non-loopback WebSocket peers and non-loopback configured upstreams, and must never be exposed as a public unauthenticated TCP proxy. Configuration is in `.env.example`, but no `.env` file is loaded automatically: supply environment variables to the launch process. An allowlisted browser Origin is necessary, **not sufficient authentication**. The configured upstream hosts and ports must be controlled, local development endpoints.

```bash
WOTLK_ENABLE_GATEWAY=true WOTLK_ALLOWED_ORIGINS=http://127.0.0.1:8765 \
  python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
```

In a local lab only, it bridges `/ws/auth` to `127.0.0.1:3724` and `/ws/world` to `127.0.0.1:8085` unless overridden. Both endpoints transport opaque binary frames and **do not implement** the WoW 3.3.5a protocol. Real production use would require proper authentication, admission control, isolation, WSS and abuse protection.

## Integration contract

`web/runtime_adapter.mjs` defines a future `window.WotlkBrowserRuntime` adapter (`apiVersion: 1`) that accepts normalized inputs. **No runtime has been selected or mounted.** The native Rust/Bevy project [Benilla-WotLK](https://github.com/Onixaz/benilla-wotlk) is a **research candidate**, not a browser engine or integrated dependency. [Wowser](https://github.com/wowserhq/client) is an incomplete browser proof of concept, not a drop-in playable engine. [AzerothCore](https://github.com/azerothcore/azerothcore-wotlk) may be suitable for *authorized, local interoperability experiments*, subject to license review.

### Intended milestones

1. **Build 01:** touch controls, status UI, isolated local diagnostic/gateway prototype.
2. **Build 02 (this commit):** original procedural WebGL2 scene, normalized live movement/camera input, graphics capability checks, loopback gateway hardening, tests.
3. **Feasibility gate:** verify a compatible, licensed runtime can render a real 3.3.5a scene, authenticate, and move a test character in Android Chrome and iOS Safari.
4. **Community prototype:** security, accounts, moderation, staging, and controlled load tests. 500–1,000 concurrent players is a **goal, not measured capacity**.

## Intellectual property and safety

No copyrighted Blizzard client files, game assets, client patches, game data, account credentials, or reverse-engineered Lasthavens code are distributed here. Publishing an original WoW game client or assets, or operating a public community realm, requires careful rights/license assessment. Do not deploy the development gateway to the public internet.
