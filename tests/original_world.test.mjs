import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorld, normalizedMove, applyWorldInput, stepWorld, OBSTACLES,
  createOriginalWorldRuntime } from '../web/original_world.mjs';

test('two entirely synthetic avatars; unsupported names rejected', () => {
  assert.equal(initialWorld('sentinel').avatar, 'sentinel');
  assert.equal(initialWorld('ranger').avatar, 'ranger');
  assert.throws(() => initialWorld('real_wow_character'), /Unknown/);
  assert.equal(initialWorld().traveled, 0);
});

test('normalized movement bounds diagonal and non-finite values', () => {
  assert.deepEqual(normalizedMove(Infinity, NaN), {x:0,y:0});
  assert.ok(Math.abs(Math.hypot(...Object.values(normalizedMove(1,1))) - 1) < 1e-12);
  assert.deepEqual(normalizedMove(-500, 0), {x:-1,y:0});
});

test('moving forward advances at a bounded frame step; no teleport on stalls', () => {
  const s = applyWorldInput(initialWorld(), {type:'move',x:0,y:1});
  const moved = stepWorld(s, .05);
  assert.ok(moved.z > 0);
  assert.ok(moved.z < .22);
  const stalled = stepWorld(s, 500);
  assert.ok(Math.abs(stalled.z-moved.z)<1e-9);
  assert.deepEqual(stepWorld(s, NaN), {...s, jumpRequested:false});
});

test('movement respects camera-relative forward and strafe; input reset stops motion', () => {
  let s = initialWorld();
  s = applyWorldInput(s,{type:'camera',dx:120,dy:30});
  assert.ok(s.yaw > .15 && s.pitch > .12);
  s = applyWorldInput(s,{type:'move',x:0,y:1});
  const moved = stepWorld(s,.05);
  assert.ok(moved.x > 0);
  assert.ok(moved.z > 0);
  const stopped = stepWorld(applyWorldInput(moved,{type:'layout_reset'}),.05);
  assert.equal(stopped.x,moved.x);
  assert.equal(stopped.z,moved.z);
});

test('camera clamps pitch, accepts only finite delta, wraps yaw', () => {
  let s = initialWorld();
  for(let i=0;i<40;i++)s=applyWorldInput(s,{type:'camera',dy:1000,dx:1000});
  assert.equal(s.pitch,.75);
  assert.ok(s.yaw>=0 && s.yaw<2*Math.PI);
  for(let i=0;i<40;i++)s=applyWorldInput(s,{type:'camera',dy:-1000,dx:-1000});
  assert.equal(s.pitch,-.2);
  assert.deepEqual(applyWorldInput(s,{type:'camera',dy:NaN,dx:NaN}),s);
});

test('jump starts only on action 1 and lands; action 2 is a visual pulse', () => {
  let s=initialWorld();
  s=applyWorldInput(s,{type:'action',index:2,down:true});
  assert.equal(s.vy,0);
  assert.equal(s.energy,1);
  s=applyWorldInput(s,{type:'action',index:1,down:false});
  assert.equal(s.jumpRequested,false);
  s=applyWorldInput(s,{type:'action',index:1,down:true});
  s=stepWorld(s,.05);
  assert.ok(s.height>0 && s.vy>0);
  let peak=s.height;
  for(let i=0;i<60;i++) {s=stepWorld(s,.05);peak=Math.max(peak,s.height);}
  assert.ok(peak>0.5);
  assert.equal(s.height,0);
  assert.equal(s.vy,0);
  assert.equal(s.energy,0);
});

test('repeated input cannot cross world boundaries', () => {
  let s=applyWorldInput(initialWorld(),{type:'move',x:1,y:0});
  for(let i=0;i<900;i++)s=stepWorld(s,.05);
  assert.ok(s.x<=18);
  assert.ok(s.x>=17);
});

test('collision circles cannot be entered from any movement direction', () => {
  for(const obstacle of OBSTACLES) {
    let s={...initialWorld(),x:obstacle.x+1.53,z:obstacle.z,yaw:0};
    s=applyWorldInput(s,{type:'move',x:-1,y:0});
    for(let i=0;i<100;i++)s=stepWorld(s,.05);
    assert.ok(Math.hypot(s.x-obstacle.x,s.z-obstacle.z)>=obstacle.radius+.38-1e-8);
  }
});

test('runtime without WebGL2 reports unsupported; does not claim connection', async()=>{
  const states=[];
  const canvas={className:'',setAttribute(){},getContext(){return null;},remove(){}};
  const el={replaceChildren(){}};
  const runtime=createOriginalWorldRuntime({documentRef:{createElement(){return canvas;}},
    raf:()=>1,cancelRaf:()=>{}});
  await runtime.mount({element:el,onState:s=>states.push(s)});
  assert.equal(runtime.mounted,false);
  assert.equal(states[0].phase,'unsupported');
  assert.equal(runtime.stats.networkConnected,false);
});

test('runtime resets to default on unmount; no client transport dependency', async()=>{
  const events=[];
  let next=0;
  const canvas={setAttribute(){},remove(){},getContext(){return {}},addEventListener(){}};
  // Fake GL cannot compile program and must fail closed.
  const runtime=createOriginalWorldRuntime({documentRef:{createElement(){return canvas;}},
    raf:()=>++next,cancelRaf:()=>{}});
  await assert.rejects(()=>runtime.mount({element:{replaceChildren(){}},onState:s=>events.push(s)}));
  assert.equal(runtime.mounted,false);
  assert.equal(runtime.stats.x,0);
  assert.equal(runtime.stats.networkConnected,false);
});
