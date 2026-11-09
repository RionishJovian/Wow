import test from 'node:test';
import assert from 'node:assert/strict';
import {clampMovement, advanceView, createProbeRuntime} from '../web/render_probe.mjs';
import {probeCapabilities} from '../web/capabilities.mjs';

test('diagonal movement is normalized and malicious values are rejected', () => {
  const diagonal = clampMovement(1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 0.00001);
  assert.deepEqual(clampMovement(NaN, Infinity), {x: 0, y: 0});
});

test('movement uses heading and clamps frame-time spikes', () => {
  const start = {x: 0, z: 0, yaw: 0, pitch: 0};
  const straight = advanceView(start, {x: 0, y: 1}, 1);
  assert.ok(straight.z > 0 && straight.z <= 0.17500001);
  const rotated = advanceView({...start, yaw: Math.PI / 2}, {x: 0, y: 1}, .05);
  assert.ok(rotated.x > .17 && Math.abs(rotated.z) < 0.000001);
});

test('browser capability probe reports unsupported WebGL2 without crashing', () => {
  const result = probeCapabilities({
    WebAssembly: {},
    navigator: {maxTouchPoints: 5},
    document: {createElement: () => ({getContext: () => null})},
    crossOriginIsolated: false,
  });
  assert.equal(result.wasm, true);
  assert.equal(result.webgl2, false);
  assert.equal(result.touch, true);
  assert.equal(result.maxTextureSize, null);
});

test('rendering test fails safely on browsers without WebGL2', async () => {
  const states = [];
  let cleared = false;
  const element = {replaceChildren() {cleared = true;}};
  const runtime = createProbeRuntime({
    documentRef: {createElement: () => ({
      className: '', setAttribute() {}, getContext() {return null;}
    })},
    raf() {return 1;},
    cancelRaf() {},
  });
  await runtime.mount({element, onState: state => states.push(state)});
  assert.equal(runtime.mounted, false);
  assert.equal(states[0].phase, 'unsupported');
  assert.equal(cleared, true);
  await runtime.unmount();
});

test('browser capabilities include WebGL2 texture support when available', () => {
  let lost = false;
  const gl = {
    MAX_TEXTURE_SIZE: 0x0D33,
    getParameter() {return 4096;},
    getExtension() {return {loseContext() {lost = true;}};},
  };
  const result = probeCapabilities({
    navigator: {maxTouchPoints: 0, getGamepads() {return [];}},
    document: {createElement: () => ({getContext: () => gl})},
  });
  assert.equal(result.webgl2, true);
  assert.equal(result.maxTextureSize, 4096);
  assert.equal(result.gamepad, true);
  assert.equal(lost, true);
});

test('opt-in renderer mounts, accepts movement and cleans up with a fake GPU', async () => {
  let callback;
  let draws = 0, removed = false, disconnected = false;
  const gl = {
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713,
    LINK_STATUS: 35714, TRIANGLES: 4,
    createShader() {return {};}, shaderSource() {}, compileShader() {},
    getShaderParameter() {return true;}, deleteShader() {},
    createProgram() {return {};}, attachShader() {}, linkProgram() {},
    getProgramParameter() {return true;}, deleteProgram() {},
    createVertexArray() {return {};}, bindVertexArray() {}, deleteVertexArray() {},
    getUniformLocation() {return {};}, useProgram() {},
    uniform2f() {}, uniform1f() {}, uniform4f() {}, viewport() {},
    drawArrays() {draws += 1;},
  };
  const canvas = {
    className: '', width: 0, height: 0,
    setAttribute() {}, addEventListener() {},
    getContext(type) {assert.equal(type, 'webgl2'); return gl;},
    remove() {removed = true;},
  };
  const element = {
    replaceChildren() {}, getBoundingClientRect() {return {width: 400, height: 260};}
  };
  const states = [];
  const runtime = createProbeRuntime({
    documentRef: {createElement: () => canvas},
    raf(fn) {callback = fn; return 42;},
    cancelRaf() {},
  });
  await runtime.mount({element, onState: x => states.push(x)});
  assert.equal(runtime.mounted, true);
  runtime.onInput({type: 'move', x: 0, y: 1});
  callback(1000);
  callback(1050);
  assert.ok(draws >= 1);
  assert.ok(runtime.stats.z > 0);
  runtime.onInput({type: 'camera', dx: 20, dy: -10});
  runtime.onInput({type: 'action', down: true, index: 1});
  callback(1100);
  await runtime.unmount();
  assert.equal(runtime.mounted, false);
  assert.equal(removed, true);
  assert.equal(states.at(-1).phase, 'stopped');
  assert.equal(runtime.stats.fps, 0);
});
