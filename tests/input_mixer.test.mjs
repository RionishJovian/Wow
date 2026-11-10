import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputMixer} from '../web/input_mixer.mjs';

const lab = () => {
  const events=[];
  const mixer=createInputMixer(event=>events.push(event));
  const send=(source,event)=>mixer.route(source,event);
  return {events,mixer,send};
};

test('touch temporarily takes priority and keyboard resumes on release',()=>{
  const {events,send}=lab();
  send('keyboard',{type:'move',x:0,y:1});
  send('touch',{type:'move',x:-1,y:0});
  send('keyboard',{type:'move',x:.71,y:.71});
  send('touch',{type:'move',x:0,y:0});
  assert.deepEqual(events,[
    {type:'move',x:0,y:1},
    {type:'move',x:-1,y:0},
    {type:'move',x:.71,y:.71},
  ]);
});

test('two sources can hold same action without premature release',()=>{
  const {events,send}=lab();
  send('keyboard',{type:'action',index:3,down:true});
  send('touch',{type:'action',index:3,down:true});
  send('keyboard',{type:'action',index:3,down:false});
  assert.deepEqual(events,[{type:'action',index:3,down:true}]);
  send('touch',{type:'action',index:3,down:false});
  assert.deepEqual(events,[
    {type:'action',index:3,down:true},{type:'action',index:3,down:false},
  ]);
});

test('idempotent release and duplicate keydown never double-fire actions',()=>{
  const {events,send}=lab();
  for(let n=0;n<3;n++)send('touch',{type:'action',index:1,down:true});
  for(let n=0;n<3;n++)send('touch',{type:'action',index:1,down:false});
  assert.equal(events.length,2);
});

test('invalid movements clamp and never propagate NaN or Infinity',()=>{
  const {events,send}=lab();
  send('keyboard',{type:'move',x:Infinity,y:NaN});
  assert.equal(events.length,0);
  send('touch',{type:'move',x:5,y:5});
  assert.deepEqual(events.at(-1),{type:'move',x:.71,y:.71});
  send('touch',{type:'move',x:0,y:0});
  assert.deepEqual(events.at(-1),{type:'move',x:0,y:0});
});

test('reset releases mixed held state and emits nothing twice',()=>{
  const {events,mixer,send}=lab();
  send('keyboard',{type:'move',x:0,y:1});
  send('touch',{type:'action',index:2,down:true});
  mixer.reset();
  assert.deepEqual(events.slice(-2),[
    {type:'move',x:0,y:0},{type:'action',index:2,down:false},
  ]);
  const before=events.length;
  mixer.reset();
  assert.equal(events.length,before);
});

test('layout reset clears state and forwards exactly one reset event',()=>{
  const {events,send}=lab();
  send('keyboard',{type:'action',index:5,down:true});
  send('touch',{type:'layout_reset'});
  assert.deepEqual(events.slice(-2),[
    {type:'action',index:5,down:false},{type:'layout_reset'},
  ]);
});

test('forged camera, action, and source messages are ignored or rejected',()=>{
  const {events,send,mixer}=lab();
  assert.throws(()=>send('network',{type:'move',x:1,y:1}),RangeError);
  assert.throws(()=>createInputMixer(null),TypeError);
  for(const index of [0,6,1.2,NaN,'1'])send('touch',{type:'action',index,down:true});
  send('keyboard',{type:'camera',dx:20,dy:30});
  send('touch',{type:'camera',dx:Infinity,dy:30});
  send('touch',{type:'action',index:1,down:'true'});
  assert.equal(events.length,0);
  send('touch',{type:'camera',dx:-8,dy:2});
  assert.deepEqual(events,[{type:'camera',dx:-8,dy:2}]);
  mixer.reset();
});
