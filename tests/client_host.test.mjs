import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientHost, normalizeClientInput} from '../web/client_host.mjs';
import {createClientInputBridge, translateMoveToKeyCodes} from '../web/client_bridge.mjs';

test('normalized client inputs reject invalid, oversized, and unsupported messages', () => {
  assert.deepEqual(normalizeClientInput({type: 'move', x: 3, y: 4}), {type: 'move', x: 0.6, y: 0.8});
  assert.equal(normalizeClientInput({type: 'move', x: Infinity, y: 0}), null);
  assert.deepEqual(normalizeClientInput({type: 'camera', dx: 200, dy: -220}),
    {type: 'camera', dx: 100, dy: -100});
  assert.equal(normalizeClientInput({type: 'action', index: 6, down: true}), null);
  assert.equal(normalizeClientInput({type: 'action', index: 2, down: 'false'}), null);
  assert.deepEqual(normalizeClientInput({type: 'action', index: 2, down: true}),
    {type: 'action', index: 2, down: true});
  assert.equal(normalizeClientInput({type: 'credentials', password: 'secret'}), null);
});

test('client host validates source, origin and nonce before forwarding input', async () => {
  const listeners = new Map();
  const iframeListeners = new Map();
  const messages = [];
  const child = {postMessage(data, targetOrigin) {messages.push({data, targetOrigin});}};
  const iframe = {
    contentWindow: child,
    setAttribute() {},
    addEventListener(name, callback) {iframeListeners.set(name, callback);},
    removeEventListener(name) {iframeListeners.delete(name);},
    remove() {this.removed = true;},
  };
  const state = [];
  let timer;
  const host = createClientHost({
    documentRef: {createElement(name) {assert.equal(name, 'iframe'); return iframe;}},
    windowRef: {addEventListener(name, callback) {listeners.set(name, callback);},
      removeEventListener(name) {listeners.delete(name);}},
    origin: 'http://127.0.0.1:8765',
    randomUUID() {return 'nonce-for-test';},
    setTimeoutRef(callback) {timer = callback; return 101;},
    clearTimeoutRef() {},
  });
  await host.mount({element: {replaceChildren(value) {assert.equal(value, iframe);}},
    onState: next => state.push(next)});
  assert.equal(host.mounted, true);
  assert.equal(host.inputReady, false);
  iframeListeners.get('load')();
  assert.equal(messages.at(-1).data.kind, 'init');
  assert.equal(host.onInput({type: 'move', x: 1, y: 0}), false);
  const ack = {channel: 'wotlk-lab-client-v1', kind: 'bridge-ready', nonce: 'nonce-for-test'};
  const dispatch = listeners.get('message');
  dispatch({source: {}, origin: 'http://127.0.0.1:8765', data: ack});
  dispatch({source: child, origin: 'http://malicious.local', data: ack});
  dispatch({source: child, origin: 'http://127.0.0.1:8765', data: {...ack, nonce: 'wrong'}});
  assert.equal(host.inputReady, false);
  dispatch({source: child, origin: 'http://127.0.0.1:8765', data: ack});
  assert.equal(host.inputReady, true);
  assert.equal(state.at(-1).phase, 'bridge-ready');
  assert.ok(state.at(-1).detail.includes('NOT verified'));
  assert.equal(host.onInput({type: 'move', x: 1, y: 0}), true);
  assert.equal(messages.at(-1).data.kind, 'input');
  assert.equal(messages.at(-1).targetOrigin, 'http://127.0.0.1:8765');
  assert.equal(host.onInput({type: 'credentials', token: 'private'}), false);
  assert.equal(messages.length, 2);
  await host.unmount();
  assert.equal(host.inputReady, false);
  assert.equal(host.mounted, false);
  assert.ok(iframe.removed);
  assert.equal(listeners.has('message'), false);
  assert.equal(state.at(-1).phase, 'stopped');
  timer();
  assert.equal(state.at(-1).phase, 'stopped');
});

test('client host reports missing bridge without claiming game readiness', async () => {
  const listeners = new Map();
  let timeout;
  const iframe = {contentWindow: {postMessage() {}}, setAttribute() {},
    addEventListener() {}, removeEventListener() {}, remove() {}};
  const state = [];
  const host = createClientHost({
    documentRef: {createElement() {return iframe;}},
    windowRef: {addEventListener(name, fn) {listeners.set(name, fn);},
      removeEventListener(name) {listeners.delete(name);}},
    origin: 'http://localhost:8765', randomUUID() {return 'test';},
    setTimeoutRef(fn) {timeout = fn; return 17;}, clearTimeoutRef() {},
  });
  await host.mount({element: {replaceChildren() {}}, onState: x => state.push(x)});
  timeout();
  assert.equal(state.at(-1).phase, 'unavailable');
  assert.equal(host.inputReady, false);
  await host.unmount();
});

test('bridge maps movement to key codes and rejects unrelated events', () => {
  assert.deepEqual([...translateMoveToKeyCodes(-1, 1)], ['KeyA', 'KeyW']);
  assert.deepEqual([...translateMoveToKeyCodes(0.1, 0.1)], []);
  assert.deepEqual([...translateMoveToKeyCodes(NaN, 1)], []);
  const savedKey = globalThis.KeyboardEvent;
  const savedCustom = globalThis.CustomEvent;
  globalThis.KeyboardEvent = class KeyboardEvent {constructor(type, options) {
    this.type = type; this.code = options.code; this.isTrusted = false;
  }};
  globalThis.CustomEvent = class CustomEvent {constructor(type, options) {
    this.type = type; this.detail = options.detail;
  }};
  try {
    const callbacks = new Map();
    const dispatched = [];
    const parent = {postMessage(data, targetOrigin) {dispatched.push({from: 'ack', data, targetOrigin});}};
    const win = {parent, addEventListener(name, fn) {callbacks.set(name, fn);},
      removeEventListener(name) {callbacks.delete(name);}};
    const bridge = createClientInputBridge({windowRef: win,
      documentRef: {dispatchEvent(event) {dispatched.push(event);}},
      parentOrigin: 'http://localhost:8765'});
    const receive = callbacks.get('message');
    const packet = (kind, input) => ({source: parent, origin: 'http://localhost:8765',
      data: {channel: 'wotlk-lab-client-v1', nonce: 'nonce', kind, input}});
    receive(packet('input', {type: 'move', x: 0, y: 1}));
    assert.equal(dispatched.length, 0);
    receive({...packet('init'), origin: 'https://bad.example'});
    assert.equal(dispatched.length, 0);
    receive(packet('init'));
    assert.equal(dispatched.at(-1).data.kind, 'bridge-ready');
    receive(packet('input', {type: 'move', x: 0, y: 1}));
    assert.ok(dispatched.some(event => event.type === 'keydown' && event.code === 'KeyW'));
    receive(packet('input', {type: 'move', x: 0, y: 0}));
    assert.ok(dispatched.some(event => event.type === 'keyup' && event.code === 'KeyW'));
    receive(packet('input', {type: 'action', index: 1, down: true}));
    assert.ok(dispatched.some(event => event.type === 'keydown' && event.code === 'Digit1'));
    receive(packet('input', {type: 'camera', dx: 9999, dy: -9999}));
    assert.deepEqual(dispatched.at(-1).detail, {dx: 100, dy: -100});
    bridge.dispose();
    assert.equal(callbacks.size, 0);
  } finally {
    globalThis.KeyboardEvent = savedKey;
    globalThis.CustomEvent = savedCustom;
  }
});
