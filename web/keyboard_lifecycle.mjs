/** Original-demo keyboard input; releases held keys on interruption. */
const MOVES = Object.freeze({KeyW:[0,1],KeyS:[0,-1],KeyA:[-1,0],KeyD:[1,0]});
function digit(code){return typeof code==='string' && /^Digit[1-5]$/.test(code)?Number(code.slice(-1)):null;}
function typing(target){
 const tag=target?.tagName?.toUpperCase?.();
 return target?.isContentEditable===true||['INPUT','TEXTAREA','SELECT'].includes(tag);
}
export function setupKeyboardInput({view=globalThis.window,page=globalThis.document,onEvent}){
 if(typeof onEvent!=='function')throw new TypeError('Missing keyboard event receiver');
 const moving=new Set(),actions=new Set();
 function emit(type,values){onEvent({type,...values});}
 function updateMove(){
  let x=0,y=0;
  for(const key of moving){x+=MOVES[key][0];y+=MOVES[key][1];}
  const magnitude=Math.max(1,Math.hypot(x,y));
  emit('move',{x:Math.round(x/magnitude*100)/100,y:Math.round(y/magnitude*100)/100});
 }
 function down(e){
  if(page?.hidden||e.repeat||e.ctrlKey||e.metaKey||e.altKey||typing(e.target))return;
  if(Object.hasOwn(MOVES,e.code)&&!moving.has(e.code)){moving.add(e.code);updateMove();}
  const index=digit(e.code);
  if(index!==null&&!actions.has(index)){actions.add(index);emit('action',{index,down:true});}
 }
 function up(e){
  if(moving.delete(e.code))updateMove();
  const index=digit(e.code);
  if(index!==null&&actions.delete(index))emit('action',{index,down:false});
 }
 function reset(){
  if(moving.size){moving.clear();updateMove();}
  for(const index of actions)emit('action',{index,down:false});
  actions.clear();
 }
 view?.addEventListener?.('keydown',down);
 view?.addEventListener?.('keyup',up);
 view?.addEventListener?.('blur',reset);
 view?.addEventListener?.('pagehide',reset);
 page?.addEventListener?.('visibilitychange',()=>{if(page.hidden)reset();});
 return {reset};
}
