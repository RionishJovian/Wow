/** Asset-free, offline objectives for the ORIGINAL demo; no WotLK assets/server. */
export const BEACONS=Object.freeze([
 Object.freeze({id:'meadow',name:'Meadow beacon',x:0,z:7}),
 Object.freeze({id:'ridge',name:'Ridge beacon',x:9,z:0}),
 Object.freeze({id:'grove',name:'Grove beacon',x:-10,z:-12}),
]);
export const INTERACTION_RADIUS=2;
export const initialMission=()=>({collected:[false,false,false],message:'Find the three glowing beacons'});
export function missionProgress(s){
 const count=s.collected.filter(v=>v===true).length;
 return {count,total:BEACONS.length,complete:count===BEACONS.length};
}
export function nearbyBeacon(s,loc){
 if(!loc||!Number.isFinite(loc.x)||!Number.isFinite(loc.z))return null;
 let best=null;
 for(let i=0;i<BEACONS.length;i++){
  if(s.collected[i])continue;
  const beacon=BEACONS[i],distance=Math.hypot(loc.x-beacon.x,loc.z-beacon.z);
  if(distance<=INTERACTION_RADIUS&&(!best||distance<best.distance))best={index:i,beacon,distance};
 }
 return best;
}
export function collectNearbyBeacon(s,loc){
 const best=nearbyBeacon(s,loc);
 if(!best)return {...s,message:'No uncollected beacon within reach'};
 const collected=s.collected.slice();collected[best.index]=true;
 const count=collected.filter(Boolean).length;
 return {collected,message:count===BEACONS.length?'All three original-demo beacons collected!'
  :best.beacon.name+' collected ('+count+'/'+BEACONS.length+')'};
}
export function missionStatus(s,loc){
 const {count,total,complete}=missionProgress(s);
 if(complete)return 'Demo complete: '+count+'/'+total+' beacons · Action 4 resets';
 const near=nearbyBeacon(s,loc);
 return count+'/'+total+' beacons · '+(near?'Action 3: collect '+near.beacon.name:'Explore to find glowing beacons');
}
