import test from 'node:test';
import assert from 'node:assert/strict';
import {framebufferSize,createAdaptiveResolution,MOBILE_MAX_PIXELS} from '../web/mobile_quality.mjs';

test('mobile framebuffer retains aspect and never exceeds fragment budget', () => {
  const {width,height,pixels} = framebufferSize(390,844,3,.85);
  assert.ok(width > 0 && height > 0 && pixels <= MOBILE_MAX_PIXELS);
  assert.ok(Math.abs(width/height - 390/844) < .01);
  const landscape = framebufferSize(1600,900,3,1);
  assert.ok(landscape.pixels <= MOBILE_MAX_PIXELS);
  assert.ok(Math.max(landscape.width,landscape.height) <= 1280);
});

test('minimised or invalid surface cannot allocate a huge framebuffer', () => {
  for (const input of [[0,500,2,1],[-1,300,1,1],[NaN,300,1,1],
    [300,Infinity,1,1],[300,300,0,1],[300,300,2,NaN]]) {
    assert.deepEqual(framebufferSize(...input),{width:1,height:1,pixels:1});
  }
});

test('sustained slow frames degrade resolution and respect floor', () => {
  const quality = createAdaptiveResolution({downSamples:3,upSamples:4});
  assert.equal(quality.scale,.85);
  assert.equal(quality.sampleFrame(47),false);
  assert.equal(quality.sampleFrame(48),false);
  assert.equal(quality.sampleFrame(47),true);
  assert.equal(quality.scale,.75);
  for(let i=0;i<100;i++) quality.sampleFrame(60);
  assert.equal(quality.scale,.55);
});

test('fast frames recover cautiously and reset does not keep stale measurements', () => {
  const quality = createAdaptiveResolution({downSamples:3,upSamples:4});
  for(let i=0;i<3;i++) quality.sampleFrame(50);
  assert.equal(quality.scale,.75);
  for(let i=0;i<4;i++) quality.sampleFrame(32);
  assert.equal(quality.scale,.8);
  for(let i=0;i<100;i++) quality.sampleFrame(32);
  assert.equal(quality.scale,1);
  quality.reset();
  assert.equal(quality.scale,.85);
});

test('tab-suspension gaps and mixed samples do not trigger unnecessary resizes', () => {
  const quality = createAdaptiveResolution({downSamples:3,upSamples:4});
  assert.equal(quality.sampleFrame(65),false);
  assert.equal(quality.sampleFrame(10000),false);
  assert.equal(quality.sampleFrame(62),false);
  assert.equal(quality.sampleFrame(34),false);
  assert.equal(quality.sampleFrame(62),false);
  assert.equal(quality.scale,.85);
});

test('rejected invalid quality policy stays fail-closed',()=>{
  assert.throws(()=>createAdaptiveResolution({minScale:0}),RangeError);
  assert.throws(()=>createAdaptiveResolution({downSamples:1}),RangeError);
  assert.throws(()=>createAdaptiveResolution({initialScale:2}),RangeError);
});
