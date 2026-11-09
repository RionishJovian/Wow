# WotLK Mobile Browser Lab — Build 05

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

The browser interface works without a game server. Build 03 adds an opt-in host for a separately built external WotLK browser client; see [client integration instructions](docs/CLIENT_INTEGRATION.md). The `/api/health` endpoint explicitly says `gameplay_ready: false`. `/api/realm-status` tests only TCP reachability, not authentic gameplay readiness.

## Build 02 graphics test

Select **Start graphics test** in the Touch controls lab. It draws a completely original
procedural landscape in WebGL2, responds to joystick/WASD movement, camera drag, and action
buttons, and displays approximate FPS. It caps rendering around 30 FPS to reduce unnecessary
battery use. **No WoW client, real game assets, or live characters are involved.**

This is a browser rendering and input feasibility check, not proof that a 3.3.5a
game engine can run in Safari or Chrome. The project has **not** been tested
on real Android/iOS hardware. Headless Chromium in the development sandbox lacks WebGL2,
so shader compilation and live GPU output still need verification on real hardware.

## Build 04: build a pinned upstream Wowser UI

Build 04 adds **actual source integration** with the MIT-licensed
[`wowserhq/client`](https://github.com/wowserhq/client) browser UI at a
**fixed reviewed source commit** (see `scripts/prepare_wowser.py`). The script
fetches that exact revision, builds the TypeScript/Vite project, adds a tiny
instrumentation adapter, and installs the resulting UI locally.

```bash
python scripts/build_wowser_client.py  # needs Git, Node.js 22+, npm, network
WOTLK_ENABLE_CLIENT=true python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
```

This script will download and run pinned *open-source client build tooling* and
npm dependencies, **not Blizzard assets**. Inspect the code/dependencies before
running them on your computer. `--source ../wowser-client` also accepts an
already cloned Git checkout **only at the pinned SHA** and leaves it unchanged;
use `--force` to replace an existing local client installation.

The client host now distinguishes **engine constructed**, **UI resource load**,
**UI render invoked**, and **resource/render failure** through authenticated,
fixed-status messages. These are precise instrumentation stages, **not** a
claim that 3.3.5a login, gameplay, or world rendering works. The upstream
production Vite build intentionally omits third-party game files, so required
`Wowser/`, `Interface/` or `Shaders/` resources will be missing until legally
sourced assets are provided *locally*. We neither copy nor upload them.

A separate GitHub Actions job builds the pinned upstream UI *without assets*
and publishes a temporary developer artifact. CI success confirms compilation
and installation only; it does not test a game realm or mobile browsers.

## Build 05: verified Wowser compilation and startup diagnostics

The pinned Wowser client source compiles to a standalone, **asset-free UI bundle**.
Build 05 verifies the installed client package before its use in the development
host. It checks the pin, file checksums, embedded bridge, local-only resource
references, upstream license and rejects unexpected files or symlinks.

```bash
python -m scripts.verify_client_install --path .local-wowser-client
```

The GitHub Actions integration pipeline also loads the **real compiled
JavaScript** in a headless Chromium page, requires WebGL2, and waits for
an instrumented UI startup stage. **A missing-resource stage is expected and
acceptable without Blizzard assets**. This test does not validate world
rendering, login, character movement, game-server connectivity, or
mobile Safari/Android Chrome compatibility. The sandbox's browser
cannot access localhost due to administrative restrictions; rely on the
independent CI run for this smoke result.

## Build 03: mount a separately built browser client

The new **Mount external client** button activates only after a client build
has been installed locally using `scripts/install_wowser.py` and
`WOTLK_ENABLE_CLIENT=true`. The client is isolated behind a local-only route,
a same-origin iframe and a nonce-bound input bridge. Joystick and action inputs
are forwarded to the client page, but actual movement requires upstream client
API integration; synthetic browser events are not guaranteed to work.

No upstream code, Blizzard assets or downloaded builds are included here.
**Client UI installation ≠ authentication or real game readiness.**
See [docs/CLIENT_INTEGRATION.md](docs/CLIENT_INTEGRATION.md).

## Optional local gateway — development only

The gateway is **off by default**, rejects non-loopback WebSocket peers and non-loopback configured upstreams, and must never be exposed as a public unauthenticated TCP proxy. Configuration is in `.env.example`, but no `.env` file is loaded automatically: supply environment variables to the launch process. An allowlisted browser Origin is necessary, **not sufficient authentication**. The configured upstream hosts and ports must be controlled, local development endpoints.

```bash
WOTLK_ENABLE_GATEWAY=true WOTLK_ALLOWED_ORIGINS=http://127.0.0.1:8765 \
  python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
```

In a local lab only, it bridges `/ws/auth` to `127.0.0.1:3724` and `/ws/world` to `127.0.0.1:8085` unless overridden. Both endpoints transport opaque binary frames and **do not implement** the WoW 3.3.5a protocol. Real production use would require proper authentication, admission control, isolation, WSS and abuse protection.

## Integration contract

`web/runtime_adapter.mjs` defines a future `window.WotlkBrowserRuntime` adapter (`apiVersion: 1`) that accepts normalized inputs. **The standalone runtime contract has no backing implementation yet; Build 03 can mount a separately installed web client UI.** The native Rust/Bevy project [Benilla-WotLK](https://github.com/Onixaz/benilla-wotlk) is a **research candidate**, not a browser engine or integrated dependency. [Wowser](https://github.com/wowserhq/client) is an incomplete browser proof of concept, not a drop-in playable engine. [AzerothCore](https://github.com/azerothcore/azerothcore-wotlk) may be suitable for *authorized, local interoperability experiments*, subject to license review.

### Intended milestones

1. **Build 01:** touch controls, status UI, isolated local diagnostic/gateway prototype.
2. **Build 02:** original procedural WebGL2 renderer, input movement/camera, browser capability checks.
3. **Build 03:** optional external browser-client install, iframe lifecycle, nonce-bound input bridge and local-only client hosting.
4. **Build 04 (this commit):** pinned upstream UI build and safe stage reporting; actual gameplay still unverified.
5. **Feasibility gate:** verify a compatible, licensed runtime can render a real 3.3.5a scene, authenticate, and move a test character in Android Chrome and iOS Safari.
6. **Community prototype:** security, accounts, moderation, staging, and controlled load tests. 500–1,000 concurrent players is a **goal, not measured capacity**.

## Intellectual property and safety

No copyrighted Blizzard client files, game assets, client patches, game data, account credentials, or reverse-engineered Lasthavens code are distributed here. Publishing an original WoW game client or assets, or operating a public community realm, requires careful rights/license assessment. Do not deploy the development gateway to the public internet.
