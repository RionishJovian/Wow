import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientInputBridge} from '../web/client_bridge.mjs';
import {createClientHost, UPSTREAM_MESSAGES} from '../web/client_host.mjs';

const ORIGIN = 'http://127.0.0.1:8765';

test('upstream bridge only sends a fixed status vocabulary to the authenticated parent', () => {
  const listeners = new Map();
  const messages = [];
  let stage = 'client-created';
  const parent = {postMessage(data, target) {messages.push({data, target});}};
  const windowRef = {
    parent,
    addEventListener(name, fn) {listeners.set(name, fn);},
    removeEventListener(name) {listeners.delete(name);},
  };
  const doc = {documentElement: {getAttribute(key) {
    assert.equal(key, 'data-wotlk-lab-stage'); return stage;
  }}, dispatchEvent() {}};
  const bridge = createClientInputBridge({windowRef, documentRef: doc, parentOrigin: ORIGIN});
  assert.equal(messages.length, 0);
  const init = {source: parent, origin: ORIGIN, data: {channel: 'wotlk-lab-client-v1', kind: 'init', nonce: 'fixed'}};
  listeners.get('message')({...init, origin: 'https://other.example'});
  assert.equal(messages.length, 0);
  listeners.get('message')(init);
  assert.equal(messages[0].data.kind, 'bridge-ready');
  assert.deepEqual(messages[1].data, {channel: 'wotlk-lab-client-v1', kind: 'upstream-stage', nonce: 'fixed', stage});
  stage = 'resource-load-failed';
  listeners.get('wotlk-lab:upstream-stage')();
  assert.equal(messages.at(-1).data.stage, 'resource-load-failed');
  stage = 'arbitrary-status-with-a-token';
  const count = messages.length;
  listeners.get('wotlk-lab:upstream-stage')();
  assert.equal(messages.length, count);
  bridge.dispose();
  assert.equal(listeners.size, 0);
});

test('parent recognizes only authenticated, allowlisted upstream stages', async () => {
  const handlers = new Map();
  const frames = new Map();
  const child = {postMessage() {}};
  const iframe = {contentWindow: child, setAttribute() {},
    addEventListener(name, fn) {frames.set(name, fn);},
    removeEventListener(name) {frames.delete(name);}, remove() {}};
  const events = [];
  const host = createClientHost({
    documentRef: {createElement() {return iframe;}},
    windowRef: {addEventListener(name, fn) {handlers.set(name, fn);},
      removeEventListener(name) {handlers.delete(name);}},
    origin: ORIGIN, randomUUID: () => 'only-this-nonce',
    setTimeoutRef: () => 1, clearTimeoutRef() {},
  });
  await host.mount({element: {replaceChildren() {}}, onState: event => events.push(event)});
  const send = (kind, stage, changes = {}) => handlers.get('message')({
    source: child, origin: ORIGIN, data: {channel: 'wotlk-lab-client-v1', nonce: 'only-this-nonce', kind, stage},
    ...changes,
  });
  send('upstream-stage', 'client-created');
  assert.equal(host.upstreamStage, null);
  send('bridge-ready');
  send('upstream-stage', 'client-created', {origin: 'http://not-local.invalid'});
  assert.equal(host.upstreamStage, null);
  send('upstream-stage', 'password:do-not-log');
  assert.equal(host.upstreamStage, null);
  send('upstream-stage', 'ui-loader-returned');
  assert.equal(host.upstreamStage, 'ui-loader-returned');
  assert.equal(events.at(-1).detail, UPSTREAM_MESSAGES['ui-loader-returned']);
  assert.ok(events.at(-1).detail.includes('may still be incomplete'));
  send('upstream-stage', 'resource-load-failed');
  assert.equal(host.upstreamStage, 'resource-load-failed');
  await host.unmount();
  assert.equal(host.upstreamStage, null);
});
