# Build 18 — Combined input validation

**Scope:** keyboard + virtual joystick and action buttons, without real game
networking or account credentials. A local input mixer avoids one source
incorrectly cancelling another source's movement or held action.

- Keyboard movement works until the touch joystick is displaced.
- Touch movement temporarily takes priority; returning to center resumes WASD.
- An action stays pressed while either source is still holding the same index.
- Duplicate keydown, pointerup, and release events do not duplicate transitions.
- Hiding or switching tabs resets source handlers through the Build 17 input
  lifecycle; manually resetting controls clears every source as well.
- Invalid movement and unknown source names never reach the runtime.

Run `node --test tests/input_mixer.test.mjs` and `node --test tests/*.test.mjs`.
Browser device-level confirmation on iOS and Android remains pending.
