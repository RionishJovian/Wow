# WotLK Mobile Browser Lab — Build 19

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

## Build 07: real-data preflight and safer local UI paths

**No original 3.3.5a game files were available in this environment.** Build 07
adds a *read-only* local installation checker and a patched pinned Wowser asset
resolver, which translates upstream `Wowser\...` relative resource names into
same-origin `/client/...` URLs and rejects traversal/foreign-origin requests.
The resources are neither copied nor uploaded by the scanner.

```bash
# On a computer where YOU already have a legally obtained WotLK installation:
python -m scripts.preflight_wotlk_install "/path/to/World of Warcraft"
# Exit 0 = likely WotLK data structure and MPQ headers; NOT verified build 12340.

# Optional local-only UI test, AFTER you independently extract permitted UI
# resources to an Interface/ directory and install the pinned Wowser build:
python scripts/install_local_ui_assets.py "/path/to/extracted" --dest .local-wowser-client
WOTLK_ENABLE_CLIENT=true python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
# Separately, with Chromium available:
python -m scripts.smoke_wowser_browser --require-ui-render
```

Only the real UI render method is checked by `--require-ui-render`; it does not
prove correct game content, 3D world rendering, login, movement, or game-server
compatibility. To certify build **3.3.5a (12340)**, additional trusted build
identity evidence is required; MPQ magic alone is not version evidence.
**Never put original game files or extracted Blizzard assets in GitHub, CI, or a
publicly accessible server.** Use an isolated local test setup and assess rights.

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

## Build 05: verified compiled-client artifact and browser smoke gate

The upstream Wowser UI successfully compiled in [Build 04 GitHub Actions run
#42699700643](https://github.com/RionishJovian/Wow/actions/runs/42699700643).
Its no-game-assets ZIP contains a compiled `.js` bundle, HTML, bridge and MIT
license. The artifact was downloaded for offline inspection; checksums and the
original bridge matched the recorded manifest.

Build 05 adds `scripts/verify_client_install.py` to check every installed file
against the pinned upstream source manifest, reject extra/unexpected files,
and validate script references and the injected input bridge:

```bash
python scripts/build_wowser_client.py
python -m scripts.verify_client_install --path .local-wowser-client
```

On GitHub Actions, the same pinned UI build is also exercised with a headless
Chromium startup smoke test (`scripts/smoke_wowser_browser.py`). It requires
WebGL2, loading the real compiled JavaScript, and reaching an instrumented UI
stage. **A missing-resource stage is an acceptable result of the no-assets build,
not proof of actual WotLK graphics or gameplay.** GitHub CI must independently
report the browser smoke result; local sandbox browser requests were blocked by
administrator network policy, so no real-device/browser pass is claimed here.

### Remaining critical functionality

- Render legally provided WotLK world terrain and character models in mobile browsers.
- Implement real 3.3.5a login/session protocol via a reviewed client engine.
- Connect actual client input APIs to avatar movement, not synthetic DOM keys.
- Validate Android Chrome and iOS Safari on physical devices.

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
4. **Build 04:** pinned upstream UI build and safe stage reporting; actual gameplay still unverified.
5. **Build 05:** artifact integrity verifier and compiled upstream browser smoke test in CI.
6. **Feasibility gate:** verify a compatible, licensed runtime can render a real 3.3.5a scene, authenticate, and move a test character in Android Chrome and iOS Safari.
7. **Community prototype:** security, accounts, moderation, staging, and controlled load tests. 500–1,000 concurrent players is a **goal, not measured capacity**.

## Intellectual property and safety

No copyrighted Blizzard client files, game assets, client patches, game data, account credentials, or reverse-engineered Lasthavens code are distributed here. Publishing an original WoW game client or assets, or operating a public community realm, requires careful rights/license assessment. Do not deploy the development gateway to the public internet.

## Build 06: start loading real extracted 3.3.5a interface resources locally

Build 06 resolves the **first missing UI-resource layer** of the pinned Wowser
build. The build script now packages only three MIT-licensed, upstream-authored
sample files (`Wowser.toc`, `WowserFrame.xml`, `WowserParent.xml`). It still
**does not ship any Blizzard game files**. Wowser's sample UI loads Blizzard
`Interface/GlueXML` files and PNG-converted texture references, so the compiled
UI cannot fully initialize without local resources.

If you have the right to use a WoW 3.3.5a (build 12340) installation, use your
**own local tools** to extract the interface resources to a private folder.
For example, arrange pre-extracted files at `./private-extracted/Interface/GlueXML/GlueFonts.xml`
and `GlueFontStyles.xml`. Any `.blp` images required by this upstream client
must be converted locally to `.png`; this repository does **not** contain an
MPQ/BLP extractor or game data.

```sh
python scripts/build_wowser_client.py                 # pinned upstream code only
python -m scripts.install_local_ui_assets ./private-extracted
python -m scripts.verify_client_install --path .local-wowser-client
WOTLK_ENABLE_CLIENT=true python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
```

The local installer rejects symlinks, executables, MPQ/BLP/DBC archives,
unsupported extensions, source overlap, oversized content, and untracked
changes. Only `Interface/` UI resources are supported, including XML, Lua,
fonts and converted images. The installed data is checksum-tracked but stays in
`.local-wowser-client/`, which is **gitignored and loopback-only**. It is never
copied into GitHub Actions artifacts or committed to this repository.
Use `--force` to replace an existing local UI overlay after validating it.

This advances the actual upstream UI resource path; it **does not implement
WotLK SRP6 authentication, realm/character selection, in-world rendering,
packet protocol, or actual game movement**. Those require a substantially more
complete game client (or a researched port of the native 3.3.5a client engine)
and a legally operated isolated test realm.

## Build 08: asset-free AzerothCore auth-protocol interoperability

This milestone adds an initial **WotLK 3.3.5a build-12340 authentication
challenge** check. Offline tests simulate a local authserver, and an optional
CLI contacts only numeric loopback addresses using a random non-existent
identifier. No original game files or real account credentials are needed.

```sh
python -m pytest tests/test_azerothcore_auth_probe.py -q
# Only against your own local authserver:
python -m scripts.azerothcore_auth_probe --host 127.0.0.1 --port 3724
```

See [Build 08 protocol lab](docs/AZEROTHCORE_LAB.md). A valid challenge reply
does **not** mean login, a working realm, in-world rendering, or gameplay.

## Build 09 — SRP6 client proof and realm list (offline lab)

A dependency-free WotLK 3.3.5a SRP6 authentication proof client is now implemented
in `scripts/azerothcore_srp6.py`, with bounded realm-list parsing in
`scripts/azerothcore_realm_list.py` and an **optional loopback-only** interactive
login utility in `scripts/azerothcore_lab_login.py`. The offline tests run a
synthetic authserver with independent server-side SRP6 proof verification and
one test realm. **No real user account, original WoW client, or game asset is
required** to run these tests.

```bash
python -m pytest tests/test_azerothcore_srp6.py -q
# ONLY with your own disposable lab account on a local authserver:
python -m scripts.azerothcore_lab_login --account LABUSER
```

This implementation is **experimental, not security-audited**, and intended for
one-shot isolated testing. It does not connect to the worldserver or enable
playable gameplay. See [AzerothCore protocol lab](docs/AZEROTHCORE_LAB.md) for
exact test evidence, precautions, and remaining gates.

## Build 10 — browser SRP6 and realm list over the local gateway

Build 10 implements 3.3.5a SRP6 authentication **inside the browser**, not only
in the Python laboratory utility. `web/azerothcore_browser_auth.mjs` uses WebCrypto
SHA-1, JS BigInt, an arbitrary-chunk binary WebSocket reader, M1/M2 proof checks,
and a bounded realm-list decoder. Deterministic tests compare outputs to the
independent Python Build 09 test vector and simulate an entire auth/realm session
with fragmented WebSocket frames. The UI has a separate **Local protocol lab**
form and does not persist the password (browser password managers are separate); the form is enabled only from a loopback
page when the local gateway is explicitly enabled. This code is not audited and
is NOT suitable for public authentication or valuable account credentials.

To evaluate **only** with your own separately installed AzerothCore authserver
and a disposable account:

```sh
WOTLK_ENABLE_GATEWAY=true python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
# Open http://127.0.0.1:8765 and navigate to Local protocol lab.
```

Gateway target remains fixed to **127.0.0.1:3724** by default and rejects
nonloopback upstream/peers. Build 10 only verifies an authserver SRP6 proof and
realm list: it does **not** start worldserver, enter the game, render WotLK assets,
or claim compatibility with real iOS/Android hardware. A real AzerothCore server
has not yet been tested in this environment. Do not publish the gateway or expose
it outside the loopback lab.

## Build 11 — real AzerothCore authentication acceptance (Docker)

Build 11 adds an isolated, loopback-bound official AzerothCore **authserver**, MySQL,
and database-importer Compose lab, and a GitHub Actions job that checks actual
SRP6 proof verification and realm-list retrieval using a randomly generated
disposable, nonprivileged account. The account is removed afterward.

No original 3.3.5a game client or Blizzard assets are needed for this auth-only
check. Worldserver, character selection, world rendering, and gameplay are **not**
implemented or validated. The actual Docker image integration result must be
confirmed by GitHub Actions; unit tests alone do not prove it works.

See [Build 11 Docker authserver lab](docs/AZEROTHCORE_REAL_LAB.md).


## Build 12 — world connection and read-only character listing (protocol lab)

The Python lab now understands AzerothCore's WotLK 3.3.5a world handshake,
SRP6 session-key digest, encrypted header framing, and the character enum wire
layout. It is tested **only against an isolated synthetic worldserver**. The
preceding authserver test is separate: a real 3.3.5a worldserver still requires
legally usable game-derived data, which is not bundled or downloaded here.

```sh
python -m pytest tests/test_azerothcore_world.py -q
# OPTIONAL: only after independently provisioning a legitimate loopback worldserver,
# disposable account and matching 3.3.5a realm:
python -m scripts.azerothcore_world_lab --account LABTEST --realm-id 1
```

See [worldserver integration lab](docs/AZEROTHCORE_WORLD_LAB.md).
**This is not playable WoW:** the browser client lacks an integrated world
protocol, original character models/terrain, and in-game movement.

## Build 13 — browser read-only character roster

The experimental browser can optionally continue a verified, disposable local SRP6 session to the **loopback-only** `/ws/world` bridge. It implements the AzerothCore world challenge, session proof, legacy encrypted packet headers and `CMSG_CHAR_ENUM` / `SMSG_CHAR_ENUM` read-only character metadata. It never follows realm-list network addresses, saves passwords or session keys, exposes character GUIDs, enters the world or controls characters. A separately labeled synthetic character preview works without any server.

On `localhost`, enable the private gateway only when you have your own local authserver/worldserver and a disposable `LAB` account. The **Also read characters** option requires selecting a realm ID explicitly; game data stays outside this repository. Run `node --test tests/*.test.mjs` for offline simulated worldserver and independent crypto checks. Actual live worldserver acceptance, 3D world rendering, in-world movement and mobile hardware testing are still pending. See [world-protocol lab](docs/AZEROTHCORE_WORLD_LAB.md).

## Build 15 — offline collectible objectives

The original, asset-free third-person demo now has three glowing beacons. Use
Action 3 to collect a nearby beacon and Action 4 to reset. This is a controlled
local interaction test, **not World of Warcraft gameplay**. The original-world
Chromium smoke now checks actual pickup and movement. See
[Build 15 interaction lab](docs/ORIGINAL_WORLD_MISSIONS.md).

## Build 16 — mobile performance and worldserver preflight

The offline exploration renderer now uses an adaptive mobile framebuffer
budget (maximum 550,000 pixels / 1,280 on the longest edge), with hysteresis
to lower resolution after sustained frame slowness and recover cautiously.
Drawing is suspended while the page is hidden; quality diagnostics expose
renderScale and renderPixels. This is a heuristic, **not an FPS improvement
measured on iOS/Android**.

A separate **credential-free** worldserver preflight reads only the 40-byte
3.3.5a-format `SMSG_AUTH_CHALLENGE` from an owned local server. It never logs
in or sends packets, and a format match **does not prove server identity**.
No real worldserver was available, so its tests use isolated fake services.

```sh
python -m scripts.azerothcore_world_probe --host 127.0.0.1 --port 8085
node --test tests/mobile_quality.test.mjs
python -m pytest tests/test_world_probe.py -q
```

See [Build 16 verification notes](docs/MOBILE_AND_WORLD_VALIDATION.md).

## Build 17 — interrupted input recovery

Touch movement, action buttons, camera drag, and WASD/action keys now release
when a browser tab becomes hidden or the user switches apps. Late pointer-capture
or keyup events cannot duplicate releases. Keyboard shortcuts ignore text fields.
This is offline control reliability work, not a real WoW login or gameplay test.
See [touch lifecycle](docs/TOUCH_LIFECYCLE.md).

## Build 18 — touch + keyboard input arbitration

The offline browser demo now merges joystick and WASD inputs before forwarding
movement to the mounted runtime. A nonzero joystick overrides keyboard movement;
when touch returns to center, any still-held WASD direction immediately resumes.
Action 1–5 holds are independently tracked for both input sources and forwarded
only on a real transition, preventing accidental release while the other source
is still holding the action. Invalid deltas and indices are rejected. Camera
drag remains touch-only. Reset now neutralizes both physical input handlers and
the combined runtime state before sending `layout_reset`.

Check: `node --test tests/input_mixer.test.mjs`. This is original offline demo
input reliability, **not** authentic WotLK gameplay or real-device validation.


## Build 19 — background-tab rendering lifecycle

The offline WebGL2 scene now cancels its scheduled animation frame immediately
when the browser page becomes hidden, clears held movement and jump, and resumes
with fresh frame timing only when visible. This avoids hidden-tab RAF churn,
resumed movement drift, and false FPS/quality sampling after app switches.
The standalone visibility-loop module is tested by six deterministic Node tests;
the complete JavaScript and Python suites and Chromium smoke run in GitHub CI.
No WotLK assets, real gameplay, credentials, or external endpoints are added.
See [frame lifecycle details](docs/FRAME_LIFECYCLE.md).
