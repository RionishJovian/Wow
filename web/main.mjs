import { setupTouchInput } from './input.mjs';
import { detectRuntime } from './runtime_adapter.mjs';

const $ = id => document.getElementById(id);
const eventOut = $('input-event');
const runtime = detectRuntime();
let updateIndex = 0;
function emitInput(event) {
  updateIndex += 1;
  // Only forward to an authentic runtime after it has been explicitly mounted.
  if (runtime && runtime.mounted) runtime.onInput(event);
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
    const [healthResp, realmResp] = await Promise.all([
      fetch('/api/health', {cache:'no-store'}),
      fetch('/api/realm-status', {cache:'no-store'}),
    ]);
    if (!healthResp.ok || !realmResp.ok) throw new Error('Service error');
    const health = await healthResp.json();
    const realm = await realmResp.json();
    $('service-status').textContent = health.gateway === 'running' ? 'Running' : 'Unavailable';
    $('service-status').className = health.gateway === 'running' ? 'good' : 'bad';
    $('gateway-indicator').textContent = health.transport_enabled ? 'Local enabled' : 'Disabled by default';
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
  } finally { button.disabled = false; }
}
$('check-status').addEventListener('click', refreshStatus);
refreshStatus();
// Visible status only: polling is suspended while the page is hidden.
setInterval(() => { if (!document.hidden) refreshStatus(); }, 30_000);
