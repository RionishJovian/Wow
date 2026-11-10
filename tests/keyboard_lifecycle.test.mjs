import test from 'node:test';
import assert from 'node:assert/strict';
import {setupKeyboardInput} from '../web/keyboard_lifecycle.mjs';
class Target {
 constructor(){this.handlers=new Map();this.hidden=false;}
 addEventListener(type,fn){this.handlers.set(type,[...(this.handlers.get(type)||[]),fn]);}
 emit(type,body={}){for(const fn of this.handlers.get(type)||[])fn({type,...body});}
}
function setup(){const view=new Target(),page=new Target(),events=[];
 const input=setupKeyboardInput({view,page,onEvent:e=>events.push(e)});return {view,page,events,input};}
const key=(code,extra={})=>({code,repeat:false,...extra});
test('WASD normalizes diagonals and releases to idle',()=>{
 const x=setup();x.view.emit('keydown',key('KeyW'));x.view.emit('keydown',key('KeyD'));
 assert.deepEqual(x.events.at(-1),{type:'move',x:.71,y:.71});
 x.view.emit('keyup',key('KeyW'));x.view.emit('keyup',key('KeyD'));
 assert.deepEqual(x.events.at(-1),{type:'move',x:0,y:0});
});
test('blur releases held actions and movement once; late keyups are harmless',()=>{
 const x=setup();x.view.emit('keydown',key('KeyA'));x.view.emit('keydown',key('Digit2'));
 x.view.emit('blur');assert.deepEqual(x.events.slice(-2),[{type:'move',x:0,y:0},{type:'action',index:2,down:false}]);
 const n=x.events.length;x.view.emit('keyup',key('KeyA'));x.view.emit('keyup',key('Digit2'));x.view.emit('blur');assert.equal(x.events.length,n);
});
test('backgrounding cancels inputs; new keys ignored until visible',()=>{
 const x=setup();x.view.emit('keydown',key('Digit1'));x.page.hidden=true;x.page.emit('visibilitychange');
 assert.deepEqual(x.events.at(-1),{type:'action',index:1,down:false});
 const n=x.events.length;x.view.emit('keydown',key('KeyW'));assert.equal(x.events.length,n);
 x.page.hidden=false;x.view.emit('keydown',key('KeyW'));assert.deepEqual(x.events.at(-1),{type:'move',x:0,y:1});
 x.view.emit('pagehide');assert.deepEqual(x.events.at(-1),{type:'move',x:0,y:0});
});
test('does not steal typing or keyboard shortcuts; repeats suppressed',()=>{
 const x=setup();
 for(const target of [{tagName:'INPUT'},{tagName:'textarea'},{tagName:'select'},{isContentEditable:true}])x.view.emit('keydown',key('Digit1',{target}));
 x.view.emit('keydown',key('Digit1',{ctrlKey:true}));
 x.view.emit('keydown',key('Digit1',{metaKey:true}));assert.equal(x.events.length,0);
 x.view.emit('keydown',key('Digit1'));x.view.emit('keydown',key('Digit1',{repeat:true}));x.view.emit('keydown',key('Digit1'));
 assert.deepEqual(x.events,[{type:'action',index:1,down:true}]);
});
