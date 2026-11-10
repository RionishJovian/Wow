/**
 * Build 18: combine keyboard and touch into ONE normalized runtime input stream.
 * The active touch joystick takes priority over WASD. When touch is released,
 * held WASD resumes; actions stay held until every input source releases them.
 * Pure offline input logic: no DOM, storage, network or game-server state.
 */
const SOURCES = Object.freeze(['touch', 'keyboard']);
const ACTION_MIN = 1;
const ACTION_MAX = 5;

function movement(x, y) {
  x = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
  y = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0;
  const magnitude = Math.max(1, Math.hypot(x, y));
  return {x: Math.round((x / magnitude) * 100) / 100,
          y: Math.round((y / magnitude) * 100) / 100};
}

export function createInputMixer(onEvent) {
  if (typeof onEvent !== 'function') throw new TypeError('Missing mixed-input receiver');
  const states = new Map(SOURCES.map(source => [source, {move: {x: 0, y: 0}, actions: new Set()}]));
  let current = {x: 0, y: 0};
  const effectiveActions = new Set();

  function updateMovement() {
    const touch = states.get('touch').move;
    const active = touch.x !== 0 || touch.y !== 0 ? touch : states.get('keyboard').move;
    if (active.x !== current.x || active.y !== current.y) {
      current = {...active};
      onEvent({type: 'move', ...current});
    }
  }

  function updateActions() {
    for (let index = ACTION_MIN; index <= ACTION_MAX; index++) {
      const down = [...states.values()].some(state => state.actions.has(index));
      const wasDown = effectiveActions.has(index);
      if (down === wasDown) continue;
      if (down) effectiveActions.add(index);
      else effectiveActions.delete(index);
      onEvent({type: 'action', index, down});
    }
  }

  function reset() {
    for (const state of states.values()) {
      state.move = {x: 0, y: 0};
      state.actions.clear();
    }
    updateMovement();
    updateActions();
  }

  function route(source, event) {
    if (!states.has(source)) throw new RangeError('Unknown input source');
    if (!event || typeof event !== 'object') return;
    const state = states.get(source);
    if (event.type === 'move') {
      state.move = movement(event.x, event.y);
      updateMovement();
    } else if (event.type === 'action') {
      if (!Number.isInteger(event.index) || event.index < ACTION_MIN ||
          event.index > ACTION_MAX || typeof event.down !== 'boolean') return;
      if (event.down) state.actions.add(event.index);
      else state.actions.delete(event.index);
      updateActions();
    } else if (event.type === 'layout_reset') {
      reset();
      onEvent({type: 'layout_reset'});
    } else if (event.type === 'camera' && source === 'touch') {
      // Never synthesize camera motions from keyboard or from invalid deltas.
      if (Number.isFinite(event.dx) && Number.isFinite(event.dy)) {
        onEvent({type: 'camera', dx: event.dx, dy: event.dy});
      }
    }
  }

  return {route, reset};
}
