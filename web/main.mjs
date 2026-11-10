import { setupTouchInput } from './input.mjs';
import { detectRuntime } from './runtime_adapter.mjs';
import { createProbeRuntime } from './render_probe.mjs';
import { probeCapabilities } from './capabilities.mjs';
import { createClientHost } from './client_host.mjs';
import { browserLabLogin, localBridgeUrl } from './azerothcore_browser_auth.mjs';

const $ = id => document.getElementById(id);
const eventOut = $('input-event');
const runtime = detectRuntime();
const probeRuntime = createProbeRuntime();
const clientHost = createClientHost();
let clientInstalled = false;
let clientBusy = false;
const stage = $('control-stage');
const cameraToggle = $('camera-toggle');
let authGatewayReady = false;
let authBusy = false;
let localPage = false;
try { localBridgeUrl(window.location); localPage = true; } catch { /* Remote pages cannot use the auth lab. */ }
$('auth-lab-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!localPage || !authGatewayReady || authBusy) return;
  authBusy = true;
  $('lab-login').disabled = true;
  const username = $('lab-username').value.trim();
  let password = $('lab-password').value;
  $('lab-password').value = ''; // Never retain in a form, preference or log.
  $('lab-realms').replaceChildren();
  $('lab-login-status').textContent = 'Connecting to local authserver…';
  try {
    const result = await browserLabLogin({username, password, onStage: phase => {
      const messages = {connected: 'Local bridge connected', challenge: 'SRP6 challenge received',
        'srp6-verified': 'Server M2 proof verified', realms: 'Realm list received'};
      $('lab-login-status').textContent = messages[phase] || 'Authentication in progress';
    }});
    $('lab-login-status').textContent = `SRP6 verified · ${result.realms.length} realm(s) · gameplay NOT verified`;
    for (const realm of result.realms) {
      const item = document.createElement('li');
      item.textContent = `${realm.name} · ${realm.locked ? 'Locked' : 'Listed'} · ${realm.characters} character(s) · ${realm.build || 'build unknown'}`;
      $('lab-realms').appendChild(item);
    }
  } catch (error) {
    // Error messages come from our fixed protocol/client code, not the server.
    $('lab-login-status').textContent = `Lab auth failed: ${error.message}`;
  } finally {
    password = '';
    authBusy = false;
    $('lab-login').disabled = !(authGatewayReady && localPage);
  }
});
function setCameraCapture(enabled) {
  stage.classList.toggle('camera-capture', enabled);
  cameraToggle.setAttribute('aria-pressed', String(enabled));
  cameraToggle.textContent = enabled ? 'Allow client taps' : 'Enable camera drag';
}
cameraToggle.addEventListener('click', () => {
  setCameraCapture(!stage.classList.contains('camera-capture'));
});
let probeBusy = false;
const capabilities = probeCapabilities();
$('webgl-support').textContent = capabilities.webgl2
  ? `Supported · max texture ${capabilities.maxTextureSize}`
  : 'Not available';
$('wasm-support').textContent = capabilities.wasm ? 'Supported' : 'Not available';
$('webgl-support').className = capabilities.webgl2 ? 'good' : 'unavailable';
$('wasm-support').className = capabilities.wasm ? 'good' : 'unavailable';

function restorePlaceholder() {
  const placeholder = document.createElement('div');
  placeholder.className = 'runtime-placeholder';
  const title = document.createElement('strong');
  title.textContent = 'Game runtime not mounted';
  const detail = document.createElement('span');
  detail.textContent = 'External client unmounted; gameplay still unverified';
  placeholder.append(title, detail);
  $('game-runtime').replaceChildren(placeholder);
}
function updateClientState(state) {
  const mounted = clientHost.mounted;
  $('client-host-status').textContent = state.detail;
  const good = state.phase === 'bridge-ready' ||
    (state.phase === 'upstream-stage' && !['resource-load-failed', 'render-failed'].includes(clientHost.upstreamStage));
  $('client-host-status').className = good ? 'good' : 'unavailable';
  $('launch-client').textContent = mounted ? 'Close external client' : 'Mount external client';
  $('render-label').textContent = mounted ? 'EXTERNAL CLIENT UI — GAMEPLAY NOT VERIFIED' : 'RENDERER NOT MOUNTED';
}
$('launch-client').addEventListener('click', async () => {
  if (clientBusy || (!clientInstalled && !clientHost.mounted)) return;
  clientBusy = true;
  $('launch-client').disabled = true;
  try {
    if (clientHost.mounted) {
      await clientHost.unmount();
      stage.classList.remove('client-active');
      cameraToggle.hidden = true;
      setCameraCapture(false);
      restorePlaceholder();
    } else {
      if (probeRuntime.mounted) await probeRuntime.unmount();
      setCameraCapture(false);
      stage.classList.add('client-active');
      cameraToggle.hidden = false;
      await clientHost.mount({element: $('game-runtime'), onState: updateClientState});
    }
  } catch (error) {
    $('client-host-status').textContent = `Client failed: ${error.message}`;
    if (!clientHost.mounted) { stage.classList.remove('client-active'); cameraToggle.hidden = true; }
  } finally {
    clientBusy = false;
    $('launch-client').disabled = !clientInstalled && !clientHost.mounted;
    $('launch-client').textContent = clientHost.mounted ? 'Close external client' : 'Mount external client';
  }
});

function updateRendererState(state) {
  const isRunning = state.phase === 'running';
  $('render-status').textContent = isRunning ? 'Original graphics test running' :
    (state.detail || 'Graphics test stopped');
  $('render-status').className = isRunning ? 'good' : 'unavailable';
  $('fps-status').textContent = isRunning && Number.isFinite(state.fps) ? `${state.fps} FPS` : '—';
  $('render-label').textContent = isRunning ? 'WEBGL2 TEST — NOT WOW' : 'RENDERER NOT MOUNTED';
  $('start-render').textContent = isRunning ? 'Stop graphics test' : 'Start graphics test';
}
$('start-render').addEventListener('click', async () => {
  if (probeBusy) return;
  probeBusy = true;
  $('start-render').disabled = true;
  try {
    if (probeRuntime.mounted) {
      await probeRuntime.unmount();
      restorePlaceholder();
    } else {
      if (clientHost.mounted) {
        await clientHost.unmount();
        stage.classList.remove('client-active');
        cameraToggle.hidden = true;
        setCameraCapture(false);
      }
      await probeRuntime.mount({element: $('game-runtime'), onState: updateRendererState});
    }
  } catch (error) {
    updateRendererState({phase: 'error', detail: `Rendering failed: ${error.message}`});
  } finally {
    $('start-render').disabled = false;
    probeBusy = false;
  }
});

let updateIndex = 0;
function emitInput(event) {
  updateIndex += 1;
  // Only forward to an authentic runtime after it has been explicitly mounted.
  if (probeRuntime.mounted) probeRuntime.onInput(event);
  else if (clientHost.mounted) clientHost.onInput(event);
  else if (runtime && runtime.mounted) runtime.onInput(event);
  const fields = Object.entries(event).filter(([key]) => key !== 'type').map(([k, v]) => `${k}: ${v}`).join(' · ');
  eventOut.textContent = `#${updateIndex} ${event.type} ${fields}`;
}

const prefKey = 'wotlk-lab-controls-v1';
let preferences = { sensitivity: 100, leftHanded: false };
try {
  const saved = JSON.parse(localStorage.getItem(prefKey) || '{}');
  preferences = { sensitivity: Number(saved.sensitivity) || 100, leftHanded: Boolean(saved.leftHanded) };
} catch { /* Treat invalid local preferences as defaults. */ }
const touch = setupTouchInput({
  joystick: $('joystick'), knob: $('joystick-knob'), actions: $('actions'),
  camera: $('camera-pad'), onEvent: emitInput,
  sensitivity: preferences.sensitivity / 100,
});
function applyPrefs() {
  document.body.classList.toggle('left-handed', preferences.leftHanded);
  $('joystick-sensitivity').value = String(preferences.sensitivity);
  $('sensitivity-output').textContent = `${preferences.sensitivity}%`;
  $('left-handed').checked = preferences.leftHanded;
  touch.setSensitivity(preferences.sensitivity / 100);
  localStorage.setItem(prefKey, JSON.stringify(preferences));
}
$('joystick-sensitivity').addEventListener('input', event => {
  preferences.sensitivity = Number(event.target.value);
  applyPrefs();
});
$('left-handed').addEventListener('change', event => {
  preferences.leftHanded = event.target.checked;
  applyPrefs();
});
$('reset-controls').addEventListener('click', () => {
  preferences = { sensitivity: 100, leftHanded: false };
  applyPrefs();
  emitInput({ type: 'layout_reset' });
});
applyPrefs();

// Desktop keys help test one shared input contract for mobile and desktop.
const pressed = new Set();
const keyMap = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] };
function keyboardMovement() {
  let x = 0, y = 0;
  for (const key of pressed) {
    if (keyMap[key]) { x += keyMap[key][0]; y += keyMap[key][1]; }
  }
  const mag = Math.max(1, Math.hypot(x, y));
  emitInput({ type: 'move', x: Math.round(x / mag * 100) / 100, y: Math.round(y / mag * 100) / 100 });
}
window.addEventListener('keydown', e => {
  if (e.repeat || e.target instanceof HTMLInputElement) return;
  if (keyMap[e.code]) { pressed.add(e.code); keyboardMovement(); }
  if (/^Digit[1-5]$/.test(e.code)) emitInput({type:'action', index: Number(e.code.slice(-1)), down:true });
});
window.addEventListener('keyup', e => {
  if (keyMap[e.code]) { pressed.delete(e.code); keyboardMovement(); }
  if (/^Digit[1-5]$/.test(e.code)) emitInput({type:'action', index: Number(e.code.slice(-1)), down:false });
});
window.addEventListener('blur', () => { if (pressed.size) { pressed.clear(); keyboardMovement(); } });

async function refreshStatus() {
  const button = $('check-status');
  button.disabled = true;
  $('service-status').textContent = 'Checking…';
  try {
    const [healthResp, realmResp, clientResp] = await Promise.all([
      fetch('/api/health', {cache:'no-store'}),
      fetch('/api/realm-status', {cache:'no-store'}),
      fetch('/api/client', {cache:'no-store'}),
    ]);
    if (!healthResp.ok || !realmResp.ok || !clientResp.ok) throw new Error('Service error');
    const health = await healthResp.json();
    const realm = await realmResp.json();
    const externalClient = await clientResp.json();
    clientInstalled = externalClient.available === true;
    $('launch-client').disabled = clientBusy || (!clientInstalled && !clientHost.mounted);
    if (!clientHost.mounted) {
      $('client-host-status').textContent = clientInstalled ? 'Installed locally · unverified UI' : 'No external client installed';
      $('client-host-status').className = clientInstalled ? 'good' : 'unavailable';
    }
    $('service-status').textContent = health.gateway === 'running' ? 'Running' : 'Unavailable';
    $('service-status').className = health.gateway === 'running' ? 'good' : 'bad';
    $('gateway-indicator').textContent = health.transport_enabled ? 'Local enabled' : 'Disabled by default';
    authGatewayReady = health.transport_enabled === true;
    $('lab-login').disabled = !localPage || !authGatewayReady || authBusy;
    if (!authBusy) $('lab-login-status').textContent = !localPage
      ? 'Local-only: open this project on localhost to use SRP6 tests.'
      : authGatewayReady ? 'Ready for a disposable test account on your local authserver.'
      : 'Gateway disabled. Set WOTLK_ENABLE_GATEWAY=true only in a private local lab.';
    for (const [elementId, status] of [['auth-status',realm.auth_tcp], ['world-status',realm.world_tcp]]) {
      const element = $(elementId);
      element.textContent = status === 'reachable' ? 'TCP reachable' : 'Not reachable';
      element.className = status === 'reachable' ? 'good' : 'unavailable';
    }
  } catch {
    $('service-status').textContent = 'Unreachable';
    $('service-status').className = 'bad';
    $('auth-status').textContent = 'Unknown';
    $('world-status').textContent = 'Unknown';
    $('gateway-indicator').textContent = 'Unavailable';
    authGatewayReady = false;
    $('lab-login').disabled = true;
    $('launch-client').disabled = true;
  } finally { button.disabled = false; }
}
$('check-status').addEventListener('click', refreshStatus);
refreshStatus();
// Visible status only: polling is suspended while the page is hidden.
setInterval(() => { if (!document.hidden) refreshStatus(); }, 30_000);
