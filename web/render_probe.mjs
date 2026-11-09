/**
 * Build 02: asset-free WebGL2 rendering and input performance probe.
 * This procedural scene is original diagnostic content, NOT WoW gameplay.
 * No accounts, assets, or game-server traffic.
 */
const VERTEX_SOURCE = `#version 300 es
precision highp float;
void main() {
  vec2 point = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(point * 2.0 - 1.0, 0.0, 1.0);
}`;
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec4 u_view;
uniform float u_pulse;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float heading = u_view.z;
  float pitch = u_view.w;
  vec3 forward = normalize(vec3(sin(heading), pitch, cos(heading)));
  vec3 right = vec3(cos(heading), 0.0, -sin(heading));
  vec3 up = normalize(cross(forward, right));
  vec3 dir = normalize(forward * 1.4 + right * uv.x + up * uv.y);
  vec3 eye = vec3(u_view.x, 1.6, u_view.y);
  float skyMix = smoothstep(-0.15, 0.6, dir.y);
  vec3 sky = mix(vec3(0.11, 0.25, 0.30), vec3(0.035, 0.10, 0.20), skyMix);
  float sun = pow(max(dot(dir, normalize(vec3(-0.4, 0.28, 0.8))), 0.0), 95.0);
  sky += vec3(0.3, 0.27, 0.15) * sun;
  float groundDistance = 10000.0;
  vec3 result = sky;
  if (dir.y < -0.0001) {
    groundDistance = -eye.y / dir.y;
    vec3 pos = eye + groundDistance * dir;
    float gx = abs(fract(pos.x * 0.45) - 0.5);
    float gy = abs(fract(pos.z * 0.45) - 0.5);
    float grid = 1.0 - smoothstep(0.010, 0.035, min(gx, gy));
    float checker = mod(floor(pos.x * 0.45) + floor(pos.z * 0.45), 2.0);
    float path = 1.0 - smoothstep(0.65, 1.0, abs(pos.x));
    vec3 base = mix(vec3(0.065, 0.13, 0.13), vec3(0.10, 0.18, 0.17), checker);
    base = mix(base, vec3(0.24, 0.23, 0.20), path * 0.50);
    base += grid * vec3(0.07, 0.11, 0.12);
    float fog = 1.0 - exp(-groundDistance * 0.032);
    result = mix(base, sky, clamp(fog, 0.0, 0.95));
  }
  // Original luminous diagnostic sphere: depth-checked against ground.
  vec3 center = vec3(2.5, 2.1 + sin(u_time * 0.8) * 0.16, 9.0);
  vec3 oc = eye - center;
  float b = dot(oc, dir);
  float h = b * b - dot(oc, oc) + 2.3;
  if (h > 0.0) {
    float t = -b - sqrt(h);
    if (t > 0.0 && t < groundDistance) {
      vec3 n = normalize(eye + dir * t - center);
      float outline = pow(1.0 - max(dot(n, -dir), 0.0), 2.5);
      float bands = sin(22.0 * atan(n.x, n.z) + u_time * 0.9) * 0.05;
      result = vec3(0.17, 0.48, 0.49) + outline * vec3(0.56, 0.43, 0.19) + bands;
      result += u_pulse * vec3(0.25, 0.17, 0.04);
    }
  }
  result = pow(max(result, vec3(0.0)), vec3(0.93));
  outColor = vec4(result, 1.0);
}`;

export function clampMovement(x, y) {
  const nx = Number.isFinite(x) ? x : 0;
  const ny = Number.isFinite(y) ? y : 0;
  const size = Math.max(1, Math.hypot(nx, ny));
  return {x: Math.max(-1, Math.min(1, nx / size)),
          y: Math.max(-1, Math.min(1, ny / size))};
}

export function advanceView(view, movement, dt) {
  const {x, y} = clampMovement(movement.x, movement.y);
  const seconds = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.05));
  const speed = 3.5 * seconds;
  return {
    ...view,
    x: view.x + (Math.cos(view.yaw) * x + Math.sin(view.yaw) * y) * speed,
    z: view.z + (-Math.sin(view.yaw) * x + Math.cos(view.yaw) * y) * speed,
  };
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Cannot create WebGL shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`WebGL shader failed: ${error || 'Unknown error'}`);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  const program = gl.createProgram();
  if (!program) throw new Error('Cannot create WebGL program');
  try {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`WebGL linking failed: ${gl.getProgramInfoLog(program) || 'Unknown error'}`);
    }
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  }
  return program;
}

/** Create an opt-in rendering benchmark using the same normalized input contract. */
export function createProbeRuntime({
  documentRef = globalThis.document,
  raf = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelRaf = globalThis.cancelAnimationFrame?.bind(globalThis),
} = {}) {
  let gl, canvas, program, vao, observer, frameId = 0, mounted = false;
  let started = 0, previous = 0, frames = 0, reporting = 0, pulse = 0;
  let fps = 0, lastStatus = null, onState = () => {};
  let view = {x: 0, z: 0, yaw: 0, pitch: -0.05};
  let movement = {x: 0, y: 0};
  const emit = (state) => { lastStatus = state; onState(state); };
  const runtime = {
    apiVersion: 1,
    get mounted() { return mounted; },
    get stats() { return {fps, x: view.x, z: view.z, lastStatus}; },

    async mount({element, onState: callback = () => {}} = {}) {
      if (mounted) return;
      if (!element || !documentRef || !raf || !cancelRaf) throw new Error('Browser rendering APIs unavailable');
      onState = callback;
      canvas = documentRef.createElement('canvas');
      canvas.className = 'render-canvas';
      canvas.setAttribute('aria-label', 'Original procedural 3D graphics diagnostic; not World of Warcraft');
      element.replaceChildren(canvas);
      gl = canvas.getContext('webgl2', {alpha: false, antialias: false, powerPreference: 'low-power'});
      if (!gl) {
        element.replaceChildren();
        canvas = null;
        emit({phase: 'unsupported', detail: 'WebGL2 not available on this browser'});
        return;
      }
      try {
        program = createProgram(gl);
        vao = gl.createVertexArray();
        if (!vao) throw new Error('Cannot create vertex array');
        gl.bindVertexArray(vao);
        const resolution = gl.getUniformLocation(program, 'u_resolution');
        const time = gl.getUniformLocation(program, 'u_time');
        const viewUniform = gl.getUniformLocation(program, 'u_view');
        const pulseUniform = gl.getUniformLocation(program, 'u_pulse');
        const resize = () => {
          if (!canvas || !gl) return;
          const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
          const rect = element.getBoundingClientRect();
          // Cap the buffer for memory-constrained phones.
          const width = Math.min(2048, Math.max(1, Math.round(rect.width * ratio)));
          const height = Math.min(1080, Math.max(1, Math.round(rect.height * ratio)));
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width; canvas.height = height;
          }
          gl.viewport(0, 0, width, height);
        };
        resize();
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(resize);
          observer.observe(element);
        }
        let stoppedByContextLoss = false;
        canvas.addEventListener('webglcontextlost', event => {
          event.preventDefault();
          stoppedByContextLoss = true;
          if (frameId) cancelRaf(frameId);
          frameId = 0;
          emit({phase: 'lost', detail: 'Graphics context lost; restart the test'});
        });
        canvas.addEventListener('webglcontextrestored', () => {
          emit({phase: 'lost', detail: 'Graphics restored; restart the test to rebuild resources'});
        });
        mounted = true;
        started = 0; previous = 0; reporting = 0; frames = 0; pulse = 0;
        emit({phase: 'running', detail: 'Original WebGL2 test scene, NOT WoW gameplay'});
        const frame = (timestamp) => {
          if (!mounted || stoppedByContextLoss) return;
          if (!started) { started = timestamp; previous = timestamp; reporting = timestamp; }
          if (timestamp - previous < 30) {
            frameId = raf(frame); return; // ~30 FPS cap for mobile battery
          }
          const dt = (timestamp - previous) / 1000;
          previous = timestamp;
          view = advanceView(view, movement, dt);
          pulse = Math.max(0, pulse - dt * 1.3);
          gl.useProgram(program);
          gl.uniform2f(resolution, canvas.width, canvas.height);
          gl.uniform1f(time, (timestamp - started) / 1000);
          gl.uniform4f(viewUniform, view.x, view.z, view.yaw, view.pitch);
          gl.uniform1f(pulseUniform, pulse);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          frames++;
          if (timestamp - reporting >= 1200) {
            fps = Math.round(frames * 1000 / (timestamp - reporting));
            emit({phase: 'running', detail: 'Original WebGL2 test scene, NOT WoW gameplay', fps});
            frames = 0; reporting = timestamp;
          }
          frameId = raf(frame);
        };
        frameId = raf(frame);
      } catch (error) {
        await runtime.unmount();
        throw error;
      }
    },

    onInput(event) {
      if (!mounted) return;
      if (event.type === 'move') movement = clampMovement(Number(event.x), Number(event.y));
      if (event.type === 'camera') {
        view.yaw += Math.max(-100, Math.min(100, Number(event.dx) || 0)) * 0.005;
        view.pitch = Math.max(-0.7, Math.min(0.7, view.pitch - (Number(event.dy) || 0) * 0.003));
      }
      if (event.type === 'action' && event.down) pulse = 1;
    },

    async unmount() {
      mounted = false;
      if (frameId && cancelRaf) cancelRaf(frameId);
      frameId = 0;
      if (observer) { observer.disconnect(); observer = null; }
      if (gl && vao) gl.deleteVertexArray(vao);
      if (gl && program) gl.deleteProgram(program);
      if (canvas) canvas.remove();
      gl = null; vao = null; canvas = null; program = null;
      movement = {x: 0, y: 0};
      fps = 0;
      emit({phase: 'stopped', detail: 'Rendering test stopped'});
    },
  };
  return runtime;
}
