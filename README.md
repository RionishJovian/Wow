# WotLK Mobile Browser Lab — Build 01

**Status: Engineering prototype, NOT a playable World of Warcraft client.**

A standalone, mobile-first browser shell to evaluate a future **legally sourced** WotLK 3.3.5a-compatible runtime. It contains a touch joystick, action buttons, camera drag input, a diagnostics panel, and a **disabled-by-default**, byte-transparent WebSocket-to-TCP development bridge. There is **no** WoW authentication, character selection, rendering, game-server implementation, or game content included.

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

## Optional local gateway — development only

The gateway is **off by default**, and must never be exposed as a public unauthenticated TCP proxy. Configuration is in `.env.example`, but no `.env` file is loaded automatically: supply environment variables to the launch process. An allowlisted browser Origin is necessary, **not sufficient authentication**. The configured upstream hosts and ports must be controlled, local development endpoints.

```bash
WOTLK_ENABLE_GATEWAY=true WOTLK_ALLOWED_ORIGINS=http://127.0.0.1:8765 \
  python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
```

In a local lab only, it bridges `/ws/auth` to `127.0.0.1:3724` and `/ws/world` to `127.0.0.1:8085` unless overridden. Both endpoints transport opaque binary frames and **do not implement** the WoW 3.3.5a protocol. Real production use would require proper authentication, admission control, isolation, WSS and abuse protection.

## Integration contract

`web/runtime_adapter.mjs` defines a future `window.WotlkBrowserRuntime` adapter (`apiVersion: 1`) that accepts normalized inputs. **No runtime has been selected or mounted.** The native Rust/Bevy project [Benilla-WotLK](https://github.com/Onixaz/benilla-wotlk) is a **research candidate**, not a browser engine or integrated dependency. [Wowser](https://github.com/wowserhq/client) is an incomplete browser proof of concept, not a drop-in playable engine. [AzerothCore](https://github.com/azerothcore/azerothcore-wotlk) may be suitable for *authorized, local interoperability experiments*, subject to license review.

### Intended milestones

1. **Build 01 (this repo):** touch controls, status UI, isolated local diagnostic/gateway prototype, tests.
2. **Feasibility gate:** verify a compatible, licensed runtime can render a real 3.3.5a scene, authenticate, and move a test character in Android Chrome and iOS Safari.
3. **Community prototype:** security, accounts, moderation, staging, and controlled load tests. 500–1,000 concurrent players is a **goal, not measured capacity**.

## Intellectual property and safety

No copyrighted Blizzard client files, game assets, client patches, game data, account credentials, or reverse-engineered Lasthavens code are distributed here. Publishing an original WoW game client or assets, or operating a public community realm, requires careful rights/license assessment. Do not deploy the development gateway to the public internet.
