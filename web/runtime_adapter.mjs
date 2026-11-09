/** Contract for a FUTURE independently provided WotLK browser engine.
 * Never claims a playable client exists. No Blizzard files are included.
 *
 * Expected runtime object (supplied by a separate licensed implementation):
 *   window.WotlkBrowserRuntime = {
 *     apiVersion: 1,
 *     async mount({element, gatewayPath, onState}) {},
 *     onInput({type, ...fields}) {},
 *     async unmount() {}
 *   }
 *
 * The runtime must implement its own authentication, WoW packet handling,
 * asset loading, 3D rendering, session state, and UI. This is only an adapter.
 */
export function detectRuntime() {
  const r = globalThis.WotlkBrowserRuntime;
  return r?.apiVersion === 1 && typeof r.mount === 'function' && typeof r.onInput === 'function' ? r : null;
}
