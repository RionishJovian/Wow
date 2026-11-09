/**
 * This small host bridge is injected into a locally built third-party client.
 * It DOES NOT implement WoW packet handling, authentication, rendering, or
 * gameplay. The browser client's actual input support is upstream-dependent.
 */
const CHANNEL = 'wotlk-lab-client-v1';
const STAGE_EVENT = 'wotlk-lab:upstream-stage';
// Restricted fixed vocabulary: do not forward error messages, URLs or data.
export const UPSTREAM_STAGES = Object.freeze([
  'client-created', 'loading-ui', 'ui-loader-returned',
  'resource-load-failed', 'first-render-call', 'render-failed',
]);
const ALLOWED_STAGES = new Set(UPSTREAM_STAGES);
const ALLOWED_KEY_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']);

export function translateMoveToKeyCodes(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return new Set();
  const keys = new Set();
  if (x < -0.2) keys.add('KeyA');
  if (x > 0.2) keys.add('KeyD');
  if (y < -0.2) keys.add('KeyS');
  if (y > 0.2) keys.add('KeyW');
  return keys;
}

export function createClientInputBridge({windowRef = globalThis.window,
  documentRef = globalThis.document, parentOrigin = globalThis.location?.origin} = {}) {
  if (!windowRef || !documentRef || !parentOrigin) throw new Error('No browser context');
  const pressed = new Set();
  let nonce = null;
  function forwardUpstreamStage() {
    if (!nonce) return;
    const stage = documentRef.documentElement?.getAttribute?.('data-wotlk-lab-stage');
    if (!ALLOWED_STAGES.has(stage)) return;
    windowRef.parent.postMessage({channel: CHANNEL, kind: 'upstream-stage', nonce, stage}, parentOrigin);
  }
  const keyName = code => code.startsWith('Digit') ? code.slice(5) : code.slice(-1).toLowerCase();
  function key(code, down) {
    if (!ALLOWED_KEY_CODES.has(code) || pressed.has(code) === down) return;
    down ? pressed.add(code) : pressed.delete(code);
    // Only legacy clients that accept synthetic keyboard events will respond.
    // isTrusted remains false; never pretend this is the upstream input API.
    documentRef.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {
      key: keyName(code), code, bubbles: true, cancelable: true,
    }));
  }
  function release() {
    for (const code of [...pressed]) key(code, false);
  }
  function handle(event) {
    if (event.source !== windowRef.parent || event.origin !== parentOrigin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || typeof data.nonce !== 'string') return;
    if (data.kind === 'init') {
      release();
      nonce = data.nonce;
      windowRef.parent.postMessage({channel: CHANNEL, kind: 'bridge-ready', nonce}, parentOrigin);
      // The actual engine constructor can run before the iframe handshake.
      forwardUpstreamStage();
      return;
    }
    if (data.kind !== 'input' || data.nonce !== nonce) return;
    const input = data.input;
    if (!input || typeof input !== 'object') return;
    if (input.type === 'move' && Number.isFinite(input.x) && Number.isFinite(input.y)) {
      const movementKeys = translateMoveToKeyCodes(input.x, input.y);
      for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) key(code, movementKeys.has(code));
    } else if (input.type === 'action' && Number.isInteger(input.index) &&
        input.index >= 1 && input.index <= 5 && typeof input.down === 'boolean') {
      key(`Digit${input.index}`, input.down);
    } else if (input.type === 'camera' && Number.isFinite(input.dx) && Number.isFinite(input.dy)) {
      documentRef.dispatchEvent(new CustomEvent('wotlk-lab:camera', {
        detail: {dx: Math.max(-100, Math.min(100, input.dx)),
          dy: Math.max(-100, Math.min(100, input.dy))},
      }));
    } else if (input.type === 'layout_reset') {
      release();
    }
  }
  windowRef.addEventListener(STAGE_EVENT, forwardUpstreamStage);
  windowRef.addEventListener('message', handle);
  windowRef.addEventListener('blur', release);
  return {
    dispose() {
      release();
      windowRef.removeEventListener('message', handle);
      windowRef.removeEventListener(STAGE_EVENT, forwardUpstreamStage);
      windowRef.removeEventListener('blur', release);
      nonce = null;
    },
  };
}

// Auto-initialize only when installed inside a child frame.
if (typeof window !== 'undefined' && window.parent !== window &&
    new URLSearchParams(window.location.search).get('embedded') === '1') {
  createClientInputBridge();
}
