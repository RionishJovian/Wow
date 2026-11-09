/**
 * Browser-facing feature probe. No user tracking, identifiers, or server uploads.
 * Device capabilities are advisory; they do not establish WoW compatibility.
 */
export function probeCapabilities(env = globalThis) {
  const result = {
    wasm: typeof env.WebAssembly === 'object',
    webgl2: false,
    maxTextureSize: null,
    touch: (env.navigator?.maxTouchPoints || 0) > 0,
    gamepad: typeof env.navigator?.getGamepads === 'function',
    isolated: env.crossOriginIsolated === true,
  };
  try {
    const canvas = env.document?.createElement('canvas');
    const gl = canvas?.getContext('webgl2', {powerPreference: 'low-power'});
    if (gl) {
      result.webgl2 = true;
      result.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* Unknown/unavailable GPU is a normal outcome. */ }
  return result;
}
