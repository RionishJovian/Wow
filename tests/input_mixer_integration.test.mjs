import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main = readFileSync(new URL('../web/main.mjs', import.meta.url), 'utf8');

test('browser routes keyboard and touch through the shared mixer', () => {
  assert.match(main, /createInputMixer\(emitInput\)/);
  assert.match(main, /mixer\.route\('touch', event\)/);
  assert.match(main, /mixer\.route\('keyboard', event\)/);
  assert.match(main, /touch\.reset\(\); keyboard\.reset\(\); mixer\.reset\(\)/);
});
