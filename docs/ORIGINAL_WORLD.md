## Build 14 — original offline exploration world (not WoW gameplay)

Build 14 adds an opt-in WebGL2 **original asset-free** third-person exploration
scene with a synthetic Sentinel/Ranger avatar, camera-relative joystick/WASD
movement, jump (Action 1), pulse (Action 2), obstacles and bounds. There are
**no Blizzard assets, WoW world models, real characters or network packets** in
this mode. This is a standalone demo for testing browser controls, mobile GPU
performance and deterministic movement physics. It is not an AzerothCore world
session, and neither movement nor animation is synchronized with any realm.

Launch the local app and select **Enter original demo world** from the Touch
controls lab. Choose an avatar from the synthetic selector. The existing
AzerothCore lab roster remains **read-only** and is not used as a game login.

Offline physics and UI checks:

```sh
node --test tests/original_world.test.mjs tests/original_world_ui.test.mjs
node --test tests/*.test.mjs
```

A separate GitHub Actions workflow, `original-world-smoke.yml`, runs the actual
scene in Playwright Chromium with software WebGL2 and checks rendered startup,
movement and jump. This is **separate** from real iOS Safari / Android Chrome
acceptance. The development environment blocks local browser navigation and
has no WebGL2, so a local GPU render pass has not been asserted here; consult
GitHub Actions for its independent outcome. The original demo is safe to test
without an AzerothCore installation or proprietary game files.
