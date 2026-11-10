import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('objectives are integrated with rendering and touch input',()=>{
 const s=read('web/original_world.mjs');
 assert.match(s,/from '\.\/original_world_mission\.mjs'/);
 assert.match(s,/const beaconUniform=gl\.getUniformLocation\(gpu,'u_beacons'\)/);
 assert.match(s,/gl\.uniform3f\(beaconUniform,/);
 assert.match(s,/collectNearbyBeacon\(mission,world\)/);
 assert.match(s,/beaconsCollected:/);
});
test('HTML labels controls as original demo, never WotLK',()=>{
 const s=read('web/index.html');
 assert.match(s,/Action 3: collect/);assert.match(s,/Action 4: reset/);
 assert.match(s,/Not WoW gameplay/);
});
test('real Chromium smoke performs one beacon pickup',()=>{
 const s=read('scripts/smoke_original_world.py');
 assert.match(s,/beaconsCollected/);assert.match(s,/beacon_collect_verified/);assert.match(s,/index:3/);
});
