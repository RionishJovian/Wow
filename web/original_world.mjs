/**
 * Build 14: an ORIGINAL, offline, asset-free third-person exploration demo.
 * No Blizzard world, game-server packets, credentials or copyrighted data.
 * The deterministic simulation is separate from the WebGL2 renderer and can
 * be tested without a GPU, browser or network access.
 */
const TAU = Math.PI * 2;
const MOVE_SPEED = 4.2;
const GRAVITY = 14;
const JUMP_SPEED = 5.7;
const WORLD_BOUND = 18;
export const OBSTACLES = Object.freeze([
  Object.freeze({x: -5, z: 2, radius: 1.1}),
  Object.freeze({x: 6, z: 5, radius: 1.1}),
  Object.freeze({x: 4, z: -7, radius: 1.1}),
  Object.freeze({x: -9, z: -7, radius: 1.1}),
]);

export function initialWorld(avatar = 'sentinel') {
  if (!['sentinel', 'ranger'].includes(avatar)) throw new Error('Unknown original demo avatar');
  return {x: 0, z: 0, height: 0, vy: 0, yaw: 0.15, pitch: 0.12,
    facing: 0, moveX: 0, moveY: 0, jumpRequested: false, energy: 0,
    avatar, traveled: 0};
}

const valid = (n) => Number.isFinite(n) ? n : 0;
export function normalizedMove(x, y) {
  x = Math.max(-1, Math.min(1, valid(x)));
  y = Math.max(-1, Math.min(1, valid(y)));
  const magnitude = Math.max(1, Math.hypot(x, y));
  return {x: x / magnitude, y: y / magnitude};
}
export function applyWorldInput(state, input) {
  if (!input || typeof input !== 'object') return state;
  if (input.type === 'move') {
    const {x, y} = normalizedMove(input.x, input.y);
    return {...state, moveX: x, moveY: y};
  }
  if (input.type === 'camera') {
    return {...state, yaw: (state.yaw + Math.max(-120, Math.min(120, valid(input.dx))) * .006 + TAU) % TAU,
      pitch: Math.max(-.2, Math.min(.75, state.pitch + Math.max(-120, Math.min(120, valid(input.dy))) * .004))};
  }
  if (input.type === 'action' && input.down === true && input.index === 1) {
    return {...state, jumpRequested: true};
  }
  if (input.type === 'action' && input.down === true && input.index === 2) {
    return {...state, energy: 1};
  }
  if (input.type === 'layout_reset') {
    return {...state, moveX: 0, moveY: 0, jumpRequested: false};
  }
  return state;
}

function canStand(x, z) {
  if (Math.abs(x) > WORLD_BOUND || Math.abs(z) > WORLD_BOUND) return false;
  return OBSTACLES.every(o => Math.hypot(x - o.x, z - o.z) >= o.radius + .38);
}

/** A bounded step. Inputs, frame stalls and non-finite values never teleport. */
export function stepWorld(state, dt) {
  const seconds = Math.max(0, Math.min(.05, valid(dt)));
  const movement = normalizedMove(state.moveX, state.moveY);
  const dx = (Math.cos(state.yaw) * movement.x + Math.sin(state.yaw) * movement.y) * MOVE_SPEED * seconds;
  const dz = (-Math.sin(state.yaw) * movement.x + Math.cos(state.yaw) * movement.y) * MOVE_SPEED * seconds;
  let x = state.x, z = state.z, distance = 0;
  // Axis sliding keeps the character from sticking at object edges.
  if (canStand(x + dx, z)) { x += dx; distance += Math.abs(dx); }
  if (canStand(x, z + dz)) { z += dz; distance += Math.abs(dz); }
  let vy = state.vy, height = state.height;
  if (state.jumpRequested && height <= 0 && vy === 0) vy = JUMP_SPEED;
  height += vy * seconds;
  vy -= GRAVITY * seconds;
  if (height <= 0) { height = 0; vy = 0; }
  const moving = Math.hypot(dx, dz) > .00001;
  return {...state, x, z, height, vy, jumpRequested: false,
    facing: moving ? Math.atan2(dx, dz) : state.facing,
    energy: Math.max(0, state.energy - seconds * 1.4), traveled: state.traveled + distance};
}

// Two triangles rendered with gl_VertexID. Shader is original procedural art.
const VERTEX = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const FRAGMENT = `#version 300 es
precision highp float;
out vec4 color;
uniform vec2 u_resolution;
uniform vec4 u_player; // x,z,jump,facing
uniform vec4 u_camera; // yaw,pitch,energy,time
uniform float u_avatar;
float sphereHit(vec3 eye, vec3 dir, vec3 center, float radius) {
  vec3 oc = eye - center;
  float b = dot(oc,dir), h = b*b - dot(oc,oc)+radius*radius;
  if (h <= 0.0) return 1e5;
  float t = -b - sqrt(h);
  return t > .01 ? t : 1e5;
}
float cylinderHit(vec3 eye, vec3 dir, vec3 c, float radius, float y0, float y1) {
  vec2 oc = eye.xz-c.xz;
  float a = dot(dir.xz,dir.xz);
  float b = dot(oc,dir.xz);
  float h = b*b-a*(dot(oc,oc)-radius*radius);
  if (h < 0.0 || a < 1e-6) return 1e5;
  float t = (-b-sqrt(h))/a;
  float y=eye.y+dir.y*t;
  return t > .01 && y>y0 && y<y1 ? t : 1e5;
}
void main() {
  vec2 uv = (gl_FragCoord.xy - .5*u_resolution)/u_resolution.y;
  float yaw=u_camera.x, pitch=u_camera.y;
  vec3 f=normalize(vec3(sin(yaw), -sin(pitch), cos(yaw)));
  vec3 right=vec3(cos(yaw),0.,-sin(yaw));
  vec3 up=normalize(cross(f,right));
  vec3 dir=normalize(f*1.55+right*uv.x+up*uv.y);
  vec3 target=vec3(u_player.x,1.0,u_player.y);
  vec3 eye=target-f*6.2+vec3(0.,1.9,0.);
  vec3 sky=mix(vec3(.12,.30,.39),vec3(.035,.105,.21),smoothstep(-.4,.8,dir.y));
  float sun=pow(max(dot(dir,normalize(vec3(-.50,.46,.65))),0.),160.);
  sky+=vec3(.78,.52,.20)*sun;
  vec3 rgb=sky;
  float nearest=1e5;
  vec3 light=normalize(vec3(.45,.85,.30));
  float groundT=-eye.y/dir.y;
  if(dir.y<-.0001 && groundT>0.) {
    vec3 p=eye+groundT*dir;
    nearest=groundT;
    float path=1.-smoothstep(.95,1.65,abs(p.x+sin(p.z*.22)*.3));
    float stones=step(.88,fract(sin(dot(floor(p.xz*1.2),vec2(17.7,27.1)))*43758.54));
    vec3 grass=mix(vec3(.13,.29,.20),vec3(.09,.24,.19),.5+.5*sin(p.x*1.8)*sin(p.z*1.7));
    rgb=mix(grass,vec3(.33,.29,.23)+stones*.025,path*.8);
    float shade=clamp(length(p.xz-vec2(u_player.x,u_player.y))*.08,0.,1.);
    rgb*=1.-.09*(1.-shade);
  }
  // Original stone arches, shrubs and trees: simple ray-traced primitives.
  for(int i=0;i<9;i++) {
    float fi=float(i);
    vec3 p=vec3(sin(fi*3.17)*11.0,0.,cos(fi*2.81)*10.8);
    float t=cylinderHit(eye,dir,p,.24,0.,2.1);
    if(t<nearest){nearest=t;vec3 hit=eye+t*dir;vec3 n=normalize(vec3(hit.x-p.x,0.,hit.z-p.z));rgb=vec3(.33,.25,.19)*(.64+.36*dot(n,light));}
    t=sphereHit(eye,dir,p+vec3(0.,2.45,0.),1.15);
    if(t<nearest){nearest=t;vec3 n=normalize(eye+t*dir-(p+vec3(0.,2.45,0.)));rgb=vec3(.11,.34,.25)*(.65+.35*max(0.,dot(n,light)));}
  }
  // Four stones align with deterministic simulation collision boundaries.
  for(int i=0;i<4;i++) {
    vec2 p= i==0?vec2(-5.,2.):i==1?vec2(6.,5.):i==2?vec2(4.,-7.):vec2(-9.,-7.);
    float t=sphereHit(eye,dir,vec3(p.x,.55,p.y),.8);
    if(t<nearest){nearest=t;vec3 n=normalize(eye+t*dir-vec3(p.x,.55,p.y));rgb=vec3(.38,.41,.39)*(.65+.35*max(0.,dot(n,light)));}
  }
  // Simple original third-person avatar, not a WoW character model.
  vec3 c=vec3(u_player.x,u_player.z,u_player.y);
  float t=sphereHit(eye,dir,c+vec3(0.,1.55,0.),.23);
  if(t<nearest){nearest=t;vec3 n=normalize(eye+t*dir-(c+vec3(0.,1.55,0.)));rgb=vec3(.88,.68,.45)*(.7+.3*max(0.,dot(n,light)));}
  t=sphereHit(eye,dir,c+vec3(0.,1.06,0.),.40);
  if(t<nearest){nearest=t;vec3 n=normalize(eye+t*dir-(c+vec3(0.,1.06,0.)));rgb=mix(vec3(.18,.50,.67),vec3(.37,.62,.28),u_avatar)*(.55+.45*max(0.,dot(n,light)));rgb+=u_camera.z*vec3(.31,.20,.04);}
  for(int i=0;i<2;i++) {
    float side=i==0?-.19:.19;
    t=sphereHit(eye,dir,c+vec3(side,.48,0.),.21);
    if(t<nearest){nearest=t;rgb=vec3(.17,.22,.30);}
  }
  float fog=clamp(1.-exp(-nearest*.025),0.,.93);
  color=vec4(pow(mix(rgb,sky,fog),vec3(.92)),1.);
}`;

function shader(gl, type, text) {
  const object = gl.createShader(type);
  if (!object) throw new Error('WebGL2 shader allocation failed');
  gl.shaderSource(object, text); gl.compileShader(object);
  if (!gl.getShaderParameter(object, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(object) || 'Shader failed';
    gl.deleteShader(object); throw new Error(error);
  }
  return object;
}
function programFor(gl) {
  const vs = shader(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL2 program allocation failed');
  gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  gl.deleteShader(vs);gl.deleteShader(fs);
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) {
    const reason=gl.getProgramInfoLog(program)||'WebGL2 linking failed';
    gl.deleteProgram(program); throw new Error(reason);
  }
  return program;
}

export function createOriginalWorldRuntime({documentRef = globalThis.document,
  raf = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelRaf = globalThis.cancelAnimationFrame?.bind(globalThis)} = {}) {
  let gl = null, canvas = null, gpu = null, vao = null, observer = null, frameId = 0;
  let world = initialWorld(), mounted = false, callback = () => {}, fps = 0;
  let previous = 0, sampled = 0, frames = 0;
  function status(phase,detail) { callback({phase,detail,fps}); }
  const runtime = {
    apiVersion:1,
    get mounted() {return mounted;},
    get stats() {return {fps,...world,mode:'original-offline-demo',networkConnected:false};},
    async mount({element, avatar='sentinel', onState=()=>{}} = {}) {
      if (mounted) return;
      if (!element || !documentRef || !raf || !cancelRaf) throw new Error('World demo requires browser rendering APIs');
      world = initialWorld(avatar); callback = onState;
      canvas = documentRef.createElement('canvas');
      canvas.className = 'render-canvas';
      canvas.setAttribute('aria-label','Original offline 3D exploration demo, not World of Warcraft');
      element.replaceChildren(canvas);
      gl = canvas.getContext('webgl2',{alpha:false,antialias:false,powerPreference:'low-power'});
      if (!gl) { canvas.remove(); canvas=null; status('unsupported','WebGL2 is required for the original demo'); return; }
      try {
        gpu=programFor(gl);vao=gl.createVertexArray();
        if(!vao)throw new Error('WebGL2 vertex array unavailable');
        const player=gl.getUniformLocation(gpu,'u_player');
        const camera=gl.getUniformLocation(gpu,'u_camera');
        const avatarUniform=gl.getUniformLocation(gpu,'u_avatar');
        const resolution=gl.getUniformLocation(gpu,'u_resolution');
        const resize=()=>{
          if(!gl||!canvas)return;
          const rect=element.getBoundingClientRect();
          const ratio=Math.min(1.5,globalThis.devicePixelRatio||1);
          canvas.width=Math.max(1,Math.min(1280,Math.round(rect.width*ratio)));
          canvas.height=Math.max(1,Math.min(720,Math.round(rect.height*ratio)));
          gl.viewport(0,0,canvas.width,canvas.height);
        };
        resize();
        if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(resize);observer.observe(element);}
        canvas.addEventListener('webglcontextlost', e=>{
          e.preventDefault();
          mounted=false;
          if(frameId)cancelRaf(frameId);
          frameId=0; status('lost','Graphics context lost; restart the demo');
        });
        mounted=true;previous=0;sampled=0;frames=0;fps=0;
        status('running','Original offline world · synthetic character · no game server');
        function frame(now){
          if(!mounted)return;
          if(!previous) {previous=now;sampled=now;}
          if(now-previous<30){frameId=raf(frame);return;}
          const dt=Math.min(.05,(now-previous)/1000);previous=now;
          if(!documentRef.hidden)world=stepWorld(world,dt);
          gl.useProgram(gpu);gl.bindVertexArray(vao);
          gl.uniform4f(player,world.x,world.z,world.height,world.facing);
          gl.uniform4f(camera,world.yaw,world.pitch,world.energy,now/1000);
          gl.uniform1f(avatarUniform,world.avatar==='ranger'?1:0);
          gl.uniform2f(resolution,canvas.width,canvas.height);
          gl.drawArrays(gl.TRIANGLES,0,3);
          frames++;
          if(now-sampled>=1200){fps=Math.round(frames*1000/(now-sampled));frames=0;sampled=now;
            status('running',`Original offline world · ${world.traveled.toFixed(1)} m traveled · no game server`);}
          frameId=raf(frame);
        }
        frameId=raf(frame);
      } catch(error) {await runtime.unmount();throw error;}
    },
    onInput(event){if(mounted)world=applyWorldInput(world,event);},
    async unmount(){
      mounted=false;if(frameId&&cancelRaf)cancelRaf(frameId);frameId=0;
      if(observer)observer.disconnect();observer=null;
      if(gl&&vao)gl.deleteVertexArray(vao);
      if(gl&&gpu)gl.deleteProgram(gpu);
      if(canvas)canvas.remove();gl=null;vao=null;gpu=null;canvas=null;
      world=initialWorld(); fps=0; status('stopped','Original offline world stopped');
    },
  };
  return runtime;
}
