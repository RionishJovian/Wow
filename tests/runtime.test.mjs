import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRuntime } from '../web/runtime_adapter.mjs';

test('does not report a game runtime when none is installed', () => {
  delete globalThis.WotlkBrowserRuntime;
  assert.equal(detectRuntime(), null);
});

test('rejects incomplete or incompatible runtime contracts', () => {
  globalThis.WotlkBrowserRuntime = { apiVersion: 2, mount() {}, onInput() {} };
  assert.equal(detectRuntime(), null);
  globalThis.WotlkBrowserRuntime = { apiVersion: 1, mount() {} };
  assert.equal(detectRuntime(), null);
  delete globalThis.WotlkBrowserRuntime;
});

test('recognizes a valid runtime adapter without claiming mounted state', () => {
  const runtime = {apiVersion: 1, mount() {}, onInput() {}, mounted: false};
  globalThis.WotlkBrowserRuntime = runtime;
  assert.equal(detectRuntime(), runtime);
  assert.equal(detectRuntime().mounted, false);
  delete globalThis.WotlkBrowserRuntime;
});
