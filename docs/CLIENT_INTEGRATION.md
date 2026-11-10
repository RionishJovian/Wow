# Build 05 — verified compiled browser UI integration

**Status:** Implemented local client mounting, isolated iframe, optional bridge,
normalized input delivery and offline installer. **Not actual WoW gameplay**.
No WoW assets or upstream client source are shipped in this repository.

Build 04 adds a reproducible pinned upstream *build path* and honest UI-stage
telemetry. It remains a proof of concept, not authenticated WoW gameplay.

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

## Pinned upstream compilation (recommended)

The exact `wowserhq/client` revision is declared in
`scripts/prepare_wowser.py` and verified with `git rev-parse HEAD` before
instrumentation. The source is patched **in a disposable clone only**;
original local checkouts remain unchanged. The patch checks for the known
`Client` constructor, UI loader, and `screen.render()` call and fails closed
when upstream changes. The compiled UI includes its upstream MIT license.

```sh
# Requires Git, Node.js 22+, npm and an internet connection.
python scripts/build_wowser_client.py
# Equivalent for an already downloaded pinned checkout:
# python scripts/build_wowser_client.py --source ../wowser-client
WOTLK_ENABLE_CLIENT=true python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
```

The new upstream UI reports only **client-created**, **loading-ui**,
**ui-loader-returned**, **resource-load-failed**, **first-render-call**, and
**render-failed** over the existing nonce-checked bridge. Stage names cannot
contain URLs, tokens, exception text or file paths. A render call is **not**
evidence of original game-world rendering. Missing local asset files will
commonly produce `resource-load-failed`; no assets are published by the pipeline.

The opt-in `.github/workflows/wowser-integration.yml` workflow checks upstream
compilation in CI and temporarily uploads the **no-assets** UI bundle. This
workflow also runs on changes to the integration scripts. It does not perform
mobile or real-realm acceptance tests.

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

## Build 05 verification and browser smoke

The initial no-assets Wowser UI compilation succeeded in [GitHub Actions
run 42699700643](https://github.com/RionishJovian/Wow/actions/runs/42699700643).
Build 05 checks the **downloaded compiled artifact** (not merely the source)
using `python -m scripts.verify_client_install --path <installed-directory>`.
This verifies the exact pinned upstream commit, source-file SHA256 values,
bridge injection, no unrecorded files, and resolvable local script assets.
It does not establish legal rights to game data or a successful login.

The upstream CI job now runs a Playwright/Chromium smoke test after building.
The test requires a WebGL2 context and stage telemetry from the real compiled
script. Since original game resources are intentionally absent, failure to load
`Wowser.toc` is an **expected UI resource error**, not an engine/gameplay pass.
A production-usable client still requires a much more complete implementation.

## Build 06: local resources for actual 3.3.5a UI loading

The pinned modern Wowser client has a *real* `UIContext.load()` entrypoint but
its Vite production build disables `publicDir`. This left its own sample
`Wowser/Wowser.toc` missing. Build 06 copies just three original MIT Wowser
sample files into the build; their `.toc` then references Blizzard-owned
`Interface/GlueXML` files, which are **not provided** in source or CI.

To test against legitimately sourced, locally pre-extracted game interface data:

```sh
python scripts/build_wowser_client.py --force
python -m scripts.install_local_ui_assets /absolute/path/to/private-extraction
python -m scripts.verify_client_install --path .local-wowser-client
```

The extraction root must have `Interface/GlueXML/GlueFonts.xml` and
`Interface/GlueXML/GlueFontStyles.xml`. Also provide other referenced UI XML,
Lua, fonts and already-PNG-converted images as needed. Paths are retained
under `/client/Interface/` on loopback only; the browser normalizes the
upstream's `Wowser\\..\\Interface` path separators to the mounted route.
Do not use a public host, and do not put original Blizzard game files in Git.

**Acceptance gate (not passed):** The actual compiled Wowser client must load
UI files and display the correct interface with no missing resources, then a
separate engine must provide real game-world assets and 3.3.5a packet handling.
The new pipeline is a verifiable dependency toward that goal, not evidence of
full playable WoW. Modern Wowser is still only an incomplete UI/graphics client.


## Build 07: local real-data preflight and strict UI acceptance

Use `python -m scripts.preflight_wotlk_install "/path/to/World of Warcraft"`
to inspect **only archive names and MPQ headers** from a user-owned local game
installation. The checker does not open an executable, extract game resources,
copy files, upload anything, or authenticate against a realm. It returns a
candidate result, **never** "confirmed 3.3.5a build 12340".

The pinned Wowser source overlay now normalizes backslash-based relative asset
paths and confines requests to `/client/`. Run `node --test tests/*.test.mjs`
to validate rejection of absolute, external, encoded, and traversal paths.

After a developer has independently prepared authorized extracted `Interface/`
resources on the **same local machine**, use `scripts/install_local_ui_assets.py`
for the verified client overlay and `python -m scripts.smoke_wowser_browser
--require-ui-render` for a stricter UI-only result. The previous default
assetless probe still accepts an *expected* missing-resources stage, but the
strict UI gate **never** counts missing-resource failures as a pass.

The current Wowser implementation does not demonstrate a complete working
3.3.5a login-to-world engine. Even a strict UI render pass would not prove
original game-world rendering, authentication, or mobile hardware compatibility.
