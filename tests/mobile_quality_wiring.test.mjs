import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const load=path=>readFileSync(new URL(path,root),'utf8');

test('offline original world owns an adaptive GPU budget and advertises its draw size',()=>{
 const src=load('web/original_world.mjs');
 assert.match(src,/createAdaptiveResolution/);
 assert.match(src,/quality\.resolution\(/);
 assert.match(src,/quality\.sampleFrame\(/);
 assert.match(src,/renderPixels:/);
 // Visibility handling is centralized, not duplicated inside the renderer.
 assert.match(src,/createVisibleFrameLoop/);
 const scheduler=load('web/visible_frame_loop.mjs');
 assert.match(scheduler,/page\.hidden/);
 assert.match(scheduler,/cancelRaf\(pending\)/);
 assert.match(scheduler,/onHide\(\)/);
});

test('Chromium original world smoke enforces budget, not just shader startup',()=>{
 const src=load('scripts/smoke_original_world.py');
 assert.match(src,/renderPixels/);
 assert.match(src,/quality_budget_verified/);
});
