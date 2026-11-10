# Build 19: pause the offline 3D demo while hidden

This change improves the **original asset-free exploration demo only**.
It does not implement WoW gameplay or establish a server connection.

The world renderer now uses one visibility-aware \`requestAnimationFrame\` loop:

- Hide the tab / switch apps: immediately cancel the queued animation frame,
  discard held movement and pending jump input, and stop scheduling frames.
- Return to the visible tab: reset frame timing (no huge physics step or
  quality downgrade from time spent in the background) and queue one frame.
- Exit the demo or lose the WebGL2 context: cancel the frame and detach the
  visibility listener so the inactive renderer does not consume battery.
- Start on an already hidden page: wait until visible before scheduling a frame.

The touch/keyboard lifecycle introduced in earlier builds still releases held
actions when the page becomes hidden. This renderer-level safeguard prevents
drift even if an input event is missed.

Test with \`node --test tests/visible_frame_loop.test.mjs\`.
Full repo CI and browser smoke must independently pass; real iOS/Android
performance is not established by these synthetic checks.

No storage, networking, original game assets, or live character control added.
