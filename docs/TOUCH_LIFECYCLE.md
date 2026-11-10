# Build 17 — mobile/desktop interrupted-input recovery

The existing original WebGL2 demo shares its input layer with the optional
external-client input bridge. App switching, screen locking, backgrounding or
browser focus loss can prevent pointerup/keyup events from arriving.

Joystick movement, action-button holds, camera drag, and keyboard actions
now return to a neutral state on blur, pagehide, or hidden visibilitychange.
Pointer releases are idempotent even if lostpointercapture fires later.
Text inputs, dropdowns and editable fields do not trigger keyboard actions.
No game files, server protocol or credentials are involved.

Offline check: `node --test tests/touch_lifecycle.test.mjs tests/keyboard_lifecycle.test.mjs`.
Physical iOS Safari / Android Chrome interruption testing remains pending.
