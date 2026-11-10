import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisibleFrameLoop} from '../web/visible_frame_loop.mjs';

function harness(initiallyHidden = false) {
  let id = 0;
  const tasks = new Map();
  const listeners = new Set();
  const page = {
    hidden: initiallyHidden,
    addEventListener(type, handler) { assert.equal(type, 'visibilitychange'); listeners.add(handler); },
    removeEventListener(type, handler) { assert.equal(type, 'visibilitychange'); listeners.delete(handler); },
    change(hidden) { this.hidden = hidden; for (const handler of listeners) handler(); },
  };
  return {
    page, tasks, listeners,
    raf(fn) { const key = ++id; tasks.set(key, fn); return key; },
    cancelRaf(key) { tasks.delete(key); },
    pump(timestamp) {
      assert.equal(tasks.size, 1, 'only one frame is queued');
      const [[key, fn]] = tasks;
      tasks.delete(key); fn(timestamp);
    },
  };
}

test('only one RAF is queued, and starting/stopping twice is safe', () => {
  const h = harness();
  let count = 0;
  const loop = createVisibleFrameLoop({...h, onFrame() { count++; }});
  loop.start(); loop.start();
  assert.equal(h.tasks.size, 1); assert.equal(h.listeners.size, 1);
  h.pump(10); h.pump(20);
  assert.equal(count, 2); assert.equal(h.tasks.size, 1);
  loop.stop(); loop.stop();
  assert.equal(h.tasks.size, 0); assert.equal(h.listeners.size, 0);
  assert.equal(loop.running, false);
});

test('hidden tab cancels pending frame and resumes only once', () => {
  const h = harness();
  const calls = [];
  const loop = createVisibleFrameLoop({...h, onFrame(now) { calls.push(now); },
    onHide() { calls.push('hide'); }, onShow() { calls.push('show'); }});
  loop.start(); h.pump(100);
  h.page.change(true);
  assert.equal(h.tasks.size, 0);
  assert.equal(loop.hasPendingFrame, false);
  h.page.change(false); h.page.change(false);
  assert.equal(h.tasks.size, 1);
  h.pump(10000);
  assert.deepEqual(calls, [100, 'hide', 'show', 'show', 10000]);
  loop.stop();
});

test('initially hidden page never renders until visible', () => {
  const h = harness(true);
  const calls = [];
  const loop = createVisibleFrameLoop({...h, onFrame: n => calls.push(n)});
  loop.start(); assert.equal(h.tasks.size, 0);
  h.page.change(false); assert.equal(h.tasks.size, 1);
  h.pump(1234); assert.deepEqual(calls, [1234]);
  loop.stop();
});

test('stop inside a frame does not reschedule and listeners are cleaned up', () => {
  const h = harness();
  let loop;
  loop = createVisibleFrameLoop({...h, onFrame: () => loop.stop()});
  loop.start(); h.pump(500);
  assert.equal(h.tasks.size, 0);
  assert.equal(h.listeners.size, 0);
});

test('reject missing handlers and unsupported APIs', () => {
  assert.throws(() => createVisibleFrameLoop(), TypeError);
  assert.throws(() => createVisibleFrameLoop({page:{},raf:()=>1,onFrame:()=>{}}), TypeError);
});

test('page without visibilitychange support still runs and stops normally', () => {
  const frames = [];
  const pending = new Map();
  let i=0;
  const loop = createVisibleFrameLoop({page:{hidden:false},
    raf: fn => { pending.set(++i, fn); return i; },cancelRaf: n=>pending.delete(n),
    onFrame: n=>frames.push(n)});
  loop.start(); const [[id,fn]]=[...pending]; pending.delete(id); fn(123);
  assert.deepEqual(frames,[123]);
  loop.stop(); assert.equal(pending.size,0);
});
