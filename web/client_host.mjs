/**
 * Build 03 - locally installed, independently supplied browser client host.
 * The host never treats iframe load/bridge handshake as successful WoW gameplay.
 * All messages use an exact same-origin + source + nonce handshake.
 */
const CHANNEL = 'wotlk-lab-client-v1';
// Progress signals from the specifically instrumented Wowser UI (not gameplay).
export const UPSTREAM_MESSAGES = Object.freeze({
  'client-created': 'Wowser engine constructed; no gameplay verified',
  'loading-ui': 'Wowser loading local UI resources',
  'ui-loader-returned': 'Wowser UI loader returned; assets may still be incomplete',
  'resource-load-failed': 'Wowser UI resource load failed; check permitted local assets',
  'first-render-call': 'Wowser executed a UI render call; NOT world rendering',
  'render-failed': 'Wowser UI rendering failed; inspect local developer console',
});

export function normalizeClientInput(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.type === 'move') {
    if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return null;
    const scale = Math.max(1, Math.hypot(input.x, input.y));
    return {type: 'move', x: Math.max(-1, Math.min(1, input.x / scale)),
      y: Math.max(-1, Math.min(1, input.y / scale))};
  }
  if (input.type === 'camera') {
    if (!Number.isFinite(input.dx) || !Number.isFinite(input.dy)) return null;
    return {type: 'camera', dx: Math.max(-100, Math.min(100, input.dx)),
      dy: Math.max(-100, Math.min(100, input.dy))};
  }
  if (input.type === 'action') {
    if (!Number.isInteger(input.index) || input.index < 1 || input.index > 5 ||
        typeof input.down !== 'boolean') return null;
    return {type: 'action', index: input.index, down: input.down};
  }
  if (input.type === 'layout_reset') return {type: 'layout_reset'};
  return null;
}

export function createClientHost({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  origin = globalThis.location?.origin,
  setTimeoutRef = globalThis.setTimeout?.bind(globalThis),
  clearTimeoutRef = globalThis.clearTimeout?.bind(globalThis),
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
  readyTimeoutMs = 8000,
} = {}) {
  let element = null;
  let iframe = null;
  let nonce = null;
  let timeout = null;
  let onState = () => {};
  let mounted = false;
  let ready = false;
  let upstreamStage = null;

  const publish = (phase, detail) => onState({phase, detail});
  function clearHandshakeTimeout() {
    if (timeout !== null) clearTimeoutRef(timeout);
    timeout = null;
  }
  function send(kind, extra = {}) {
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({channel: CHANNEL, kind, nonce, ...extra}, origin);
  }
  function onMessage(message) {
    if (!mounted || message.origin !== origin || message.source !== iframe.contentWindow) return;
    const payload = message.data;
    if (!payload || payload.channel !== CHANNEL || payload.nonce !== nonce) return;
    if (payload.kind === 'upstream-stage' && ready &&
        Object.hasOwn(UPSTREAM_MESSAGES, payload.stage)) {
      upstreamStage = payload.stage;
      publish('upstream-stage', UPSTREAM_MESSAGES[payload.stage]);
      return;
    }
    if (payload.kind === 'bridge-ready') {
      clearHandshakeTimeout();
      ready = true;
      // The bridge's readiness only establishes input plumbing, not game login.
      publish('bridge-ready', 'Client page and input bridge loaded; gameplay NOT verified');
    }
  }
  function onFrameLoad() {
    if (!mounted) return;
    publish('frame-loaded', 'Client document loaded; waiting for bridge handshake');
    send('init');
  }
  return {
    get mounted() { return mounted; },
    get inputReady() { return ready; },
    get upstreamStage() { return upstreamStage; },
    async mount({element: target, onState: callback = () => {}} = {}) {
      if (mounted) throw new Error('Client host already mounted');
      if (!target || !documentRef || !windowRef || !origin ||
          typeof randomUUID !== 'function' || !setTimeoutRef || !clearTimeoutRef) {
        throw new Error('Secure browser embedding is unavailable');
      }
      element = target;
      onState = callback;
      nonce = randomUUID();
      iframe = documentRef.createElement('iframe');
      iframe.setAttribute('title', 'Installed WotLK browser client (development only)');
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.setAttribute('loading', 'eager');
      iframe.className = 'client-frame';
      iframe.addEventListener('load', onFrameLoad);
      windowRef.addEventListener('message', onMessage);
      mounted = true;
      ready = false;
      upstreamStage = null;
      element.replaceChildren(iframe);
      publish('loading', 'Loading locally installed browser client; not playable yet');
      timeout = setTimeoutRef(() => {
        timeout = null;
        if (mounted && !ready) {
          publish('unavailable', 'Input bridge did not respond; verify installed client build');
        }
      }, readyTimeoutMs);
      iframe.src = '/client/index.html?embedded=1';
    },
    onInput(event) {
      if (!mounted || !ready) return false;
      const normalized = normalizeClientInput(event);
      if (!normalized) return false;
      send('input', {input: normalized});
      return true;
    },
    async unmount() {
      // Send a final neutral movement event before tearing down the bridge.
      if (ready) send('input', {input: {type: 'move', x: 0, y: 0}});
      clearHandshakeTimeout();
      windowRef?.removeEventListener('message', onMessage);
      if (iframe) {
        iframe.removeEventListener('load', onFrameLoad);
        iframe.remove();
      }
      iframe = null;
      element = null;
      mounted = false;
      ready = false;
      upstreamStage = null;
      nonce = null;
      publish('stopped', 'Client closed');
    },
  };
}
