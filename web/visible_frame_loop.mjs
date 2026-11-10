/**
 * Page-visibility-aware requestAnimationFrame lifecycle for the original,
 * entirely offline WebGL2 demo. No timers, storage or network requests.
 * A hidden page MUST have zero queued animation callbacks.
 */
export function createVisibleFrameLoop({page, raf, cancelRaf, onFrame,
  onHide = () => {}, onShow = () => {}} = {}) {
  if (!page || typeof raf !== 'function' || typeof cancelRaf !== 'function' ||
      typeof onFrame !== 'function' || typeof onHide !== 'function' ||
      typeof onShow !== 'function') {
    throw new TypeError('Missing page, animation APIs, or frame handlers');
  }
  let running = false;
  let pending = null;

  function schedule() {
    if (running && !page.hidden && pending === null) pending = raf(tick);
  }
  function tick(now) {
    pending = null;
    if (!running || page.hidden) return;
    onFrame(now);
    // A frame callback may stop the loop, hide the page, or throw.
    schedule();
  }
  function visibilityChange() {
    if (!running) return;
    if (page.hidden) {
      if (pending !== null) cancelRaf(pending);
      pending = null;
      onHide();
    } else {
      onShow();
      schedule();
    }
  }
  return {
    get running() { return running; },
    get hasPendingFrame() { return pending !== null; },
    start() {
      if (running) return;
      running = true;
      page.addEventListener?.('visibilitychange', visibilityChange);
      schedule();
    },
    stop() {
      if (!running && pending === null) return;
      running = false;
      if (pending !== null) cancelRaf(pending);
      pending = null;
      page.removeEventListener?.('visibilitychange', visibilityChange);
    },
  };
}
