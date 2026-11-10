/** Browser input transport. Normalized events only; no WoW protocol assumptions. */
export function setupTouchInput({joystick, knob, actions, camera, onEvent, sensitivity = 1,
  page = globalThis.document, view = globalThis.window}) {
  let active = null;
  let factor = sensitivity;
  let last = null;
  const actionResets = [];
  const emit = (type, values) => onEvent({ type, ...values });
  function dropCapture(element, id) {
    try {
      if (id !== null && element.hasPointerCapture?.(id)) element.releasePointerCapture(id);
    } catch { /* A browser may invalidate capture while backgrounding. */ }
  }
  function setJoystick(dx, dy) {
    const limit = Math.max(1, joystick.querySelector('.joystick-ring').getBoundingClientRect().width * 0.32);
    const distance = Math.hypot(dx, dy);
    const scale = Math.min(1, limit / (distance || 1));
    const x = dx * scale, y = dy * scale;
    knob.style.setProperty('--joy-x', `${x}px`);
    knob.style.setProperty('--joy-y', `${y}px`);
    emit('move', { x: Math.round(x / limit * factor * 100) / 100, y: Math.round(-y / limit * factor * 100) / 100 });
  }
  function moveEvent(event) {
    if (active !== event.pointerId) return;
    const rect = joystick.querySelector('.joystick-ring').getBoundingClientRect();
    setJoystick(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
  }
  joystick.addEventListener('pointerdown', e => {
    if (active !== null) return;
    active = e.pointerId;
    joystick.setPointerCapture(active);
    moveEvent(e);
  });
  joystick.addEventListener('pointermove', moveEvent);
  function resetJoystick(e) {
    if (e.pointerId !== active) return;
    const previous = active;
    active = null;
    knob.style.setProperty('--joy-x', '0px');
    knob.style.setProperty('--joy-y', '0px');
    emit('move', { x: 0, y: 0 });
    dropCapture(joystick, previous);
  }
  joystick.addEventListener('pointerup', resetJoystick);
  joystick.addEventListener('pointercancel', resetJoystick);
  joystick.addEventListener('lostpointercapture', resetJoystick);
  actions.querySelectorAll('[data-action]').forEach(button => {
    let pointer = null;
    button.addEventListener('pointerdown', e => {
      if (pointer !== null) return;
      pointer = e.pointerId;
      button.setPointerCapture(pointer);
      button.classList.add('is-pressed');
      emit('action', { index: Number(button.dataset.action), down: true });
    });
    function release(e) {
      if (pointer !== e.pointerId) return;
      const previous = pointer;
      pointer = null;
      button.classList.remove('is-pressed');
      emit('action', { index: Number(button.dataset.action), down: false });
      dropCapture(button, previous);
    }
    actionResets.push(() => { if (pointer !== null) release({pointerId: pointer}); });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  });
  camera.addEventListener('pointerdown', e => {
    if (last) return;
    last = { id: e.pointerId, x: e.clientX, y: e.clientY };
    camera.setPointerCapture(e.pointerId);
  });
  camera.addEventListener('pointermove', e => {
    if (!last || e.pointerId !== last.id) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last.x = e.clientX; last.y = e.clientY;
    if (dx || dy) emit('camera', { dx, dy });
  });
  function releaseCamera(e) { if (last?.id === e.pointerId) last = null; }
  camera.addEventListener('pointerup', releaseCamera);
  camera.addEventListener('pointercancel', releaseCamera);
  camera.addEventListener('lostpointercapture', releaseCamera);
  // Mobile app-switching, tab hiding and page teardown must never leave held keys.
  function reset() {
    if (active !== null) resetJoystick({pointerId: active});
    for (const release of actionResets) release();
    const previous = last?.id ?? null;
    last = null;
    dropCapture(camera, previous);
  }
  view?.addEventListener?.('blur', reset);
  view?.addEventListener?.('pagehide', reset);
  page?.addEventListener?.('visibilitychange', () => { if (page.hidden) reset(); });
  return { setSensitivity: value => { factor = value; }, reset };
}
