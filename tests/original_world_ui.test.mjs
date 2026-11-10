import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path,root),'utf-8');

test('asset-free world has a labeled UI entry point and two demo avatars',()=>{
  const html=read('web/index.html');
  assert.match(html,/id="start-world"/);
  assert.match(html,/id="world-avatar"/);
  assert.match(html,/value="sentinel"/);
  assert.match(html,/value="ranger"/);
  assert.match(html,/Original, asset-free exploration\. Not WoW gameplay/);
  assert.match(html,/build14_world\.css/);
});

test('main forwards input to demo runtime without sending it to any game server',()=>{
  const source=read('web/main.mjs');
  assert.match(source,/createOriginalWorldRuntime/);
  assert.match(source,/if \(worldRuntime\.mounted\) worldRuntime\.onInput\(event\);/);
  assert.match(source,/if \(worldRuntime\.mounted\) \{ await worldRuntime\.unmount\(\);/);
  assert.match(source,/onState: state =>/);
});

test('the demo engine is offline and has no network endpoints or credentials',()=>{
  const src=read('web/original_world.mjs');
  for (const unexpected of ['fetch(', 'WebSocket(', 'XMLHttpRequest', 'localStorage', 'sessionStorage']) {
    assert.ok(!src.includes(unexpected), `${unexpected} must not appear in offline demo runtime`);
  }
  assert.match(src,/networkConnected:false/);
});
