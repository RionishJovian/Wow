import test from 'node:test';
import assert from 'node:assert/strict';
import {setupTouchInput} from '../web/input.mjs';
class El {
 constructor(){this.handlers=new Map();this.capture=new Set();this.classes=new Set();this.dataset={};this.props={};this.style={setProperty:(k,v)=>this.props[k]=v};this.classList={add:k=>this.classes.add(k),remove:k=>this.classes.delete(k)};}
 addEventListener(t,fn){this.handlers.set(t,[...(this.handlers.get(t)||[]),fn]);}
 emit(t,v={}){for(const fn of this.handlers.get(t)||[])fn({type:t,...v});}
 setPointerCapture(id){this.capture.add(id);}
 hasPointerCapture(id){return this.capture.has(id);}
 releasePointerCapture(id){this.capture.delete(id);this.emit('lostpointercapture',{pointerId:id});}
}
function setup(){
 const joystick=new El(),knob=new El(),button=new El(),camera=new El(),page=new El(),view=new El(),events=[];
 joystick.querySelector=()=>({getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})});
 button.dataset.action='3';page.hidden=false;
 const input=setupTouchInput({joystick,knob,camera,actions:{querySelectorAll:()=>[button]},onEvent:e=>events.push(e),page,view});
 return {joystick,button,camera,page,view,events,input};
}
const evt=(pointerId,clientX=70,clientY=30)=>({pointerId,clientX,clientY});
test('blur releases joystick and held action once even with late lost capture',()=>{
 const x=setup();x.joystick.emit('pointerdown',evt(1));x.button.emit('pointerdown',evt(2));
 x.view.emit('blur');
 assert.deepEqual(x.events.slice(-2),[{type:'move',x:0,y:0},{type:'action',index:3,down:false}]);
 assert.equal(x.joystick.capture.size,0);assert.equal(x.button.capture.size,0);
 const n=x.events.length;x.view.emit('blur');x.button.emit('pointerup',evt(2));assert.equal(x.events.length,n);
});
test('hidden page and pagehide cancel held actions but visible change does not',()=>{
 const x=setup();x.button.emit('pointerdown',evt(1));x.page.emit('visibilitychange');
 assert.equal(x.events.at(-1).down,true);
 x.page.hidden=true;x.page.emit('visibilitychange');assert.equal(x.events.at(-1).down,false);
 x.button.emit('pointerdown',evt(2));x.view.emit('pagehide');assert.equal(x.events.at(-1).down,false);
});
test('camera is released and can be used with a fresh pointer',()=>{
 const x=setup();x.camera.emit('pointerdown',evt(1));x.input.reset();const n=x.events.length;
 x.camera.emit('pointermove',evt(1,90,90));assert.equal(x.events.length,n);
 x.camera.emit('pointerdown',evt(2));x.camera.emit('pointermove',evt(2,80,80));
 assert.equal(x.events.at(-1).type,'camera');
});
test('second fingers cannot steal an active joystick or action',()=>{
 const x=setup();x.joystick.emit('pointerdown',evt(1));x.joystick.emit('pointerdown',evt(3));
 x.button.emit('pointerdown',evt(2));x.button.emit('pointerdown',evt(4));
 x.joystick.emit('pointerup',evt(3));x.button.emit('pointerup',evt(4));
 assert.equal(x.joystick.capture.has(1),true);assert.equal(x.button.capture.has(2),true);
 x.joystick.emit('pointercancel',evt(1));x.button.emit('pointercancel',evt(2));
 assert.deepEqual(x.events.slice(-2),[{type:'move',x:0,y:0},{type:'action',index:3,down:false}]);
});
