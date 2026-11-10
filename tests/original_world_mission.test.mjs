import test from 'node:test';
import assert from 'node:assert/strict';
import {BEACONS,INTERACTION_RADIUS,initialMission,missionProgress,nearbyBeacon,collectNearbyBeacon,missionStatus} from '../web/original_world_mission.mjs';
test('beacons have unique IDs, are inside scene, and cannot be mutated',()=>{
 assert.equal(BEACONS.length,3);
 assert.equal(new Set(BEACONS.map(b=>b.id)).size,3);
 assert.ok(Object.isFrozen(BEACONS));
 assert.ok(BEACONS.every(b=>Object.isFrozen(b)&&Math.abs(b.x)<=18&&Math.abs(b.z)<=18));
});
test('bounded pickup and duplicate interaction never inflate progress',()=>{
 const original=initialMission(),b=BEACONS[0];
 assert.equal(nearbyBeacon(original,{x:b.x+INTERACTION_RADIUS+.01,z:b.z}),null);
 assert.ok(nearbyBeacon(original,{x:b.x+INTERACTION_RADIUS,z:b.z}));
 assert.equal(nearbyBeacon(original,{x:Infinity,z:0}),null);
 const collected=collectNearbyBeacon(original,b),duplicate=collectNearbyBeacon(collected,b);
 assert.deepEqual(original.collected,[false,false,false]);
 assert.deepEqual(missionProgress(duplicate),{count:1,total:3,complete:false});
});
test('three collectibles complete exactly once, and mission resets',()=>{
 let s=initialMission();
 for(const b of BEACONS)s=collectNearbyBeacon(s,b);
 assert.deepEqual(missionProgress(s),{count:3,total:3,complete:true});
 assert.match(missionStatus(s,BEACONS[0]),/Demo complete/);
 assert.equal(missionProgress(initialMission()).count,0);
});
test('interaction labels are local-only, no false real gameplay claims',()=>{
 const s=initialMission();
 assert.match(missionStatus(s,BEACONS[1]),/Action 3: collect Ridge beacon/);
 assert.match(missionStatus(s,{x:0,z:0}),/Explore/);
 assert.equal('realmId' in s,false);
});
