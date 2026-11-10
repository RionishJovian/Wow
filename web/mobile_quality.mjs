/**
 * Adaptive framebuffer budget for the original, OFFLINE WebGL2 demo.
 * Pure math: no GPU APIs, networking, cookies or persisted user tracking.
 */
export const MOBILE_MAX_PIXELS = 550_000;

/** Bound fragment cost while preserving the CSS aspect ratio. */
export function framebufferSize(width, height, dpr = 1, scale = 1, options = {}) {
  const {maxPixels = MOBILE_MAX_PIXELS, maxDimension = 1280} = options;
  if (![width, height, dpr, scale, maxPixels, maxDimension].every(Number.isFinite) ||
      width <= 0 || height <= 0 || dpr <= 0 || scale <= 0 || maxPixels < 4 || maxDimension < 2) {
    return {width: 1, height: 1, pixels: 1};
  }
  const ratio = Math.min(1.5, dpr) * Math.min(1, scale);
  const desiredW = width * ratio, desiredH = height * ratio;
  const bound = Math.min(1, maxDimension / Math.max(desiredW, desiredH),
    Math.sqrt(maxPixels / (desiredW * desiredH)));
  let w = Math.max(1, Math.floor(desiredW * bound));
  let h = Math.max(1, Math.floor(desiredH * bound));
  // Defensive rounding check for non-integer user-supplied budgets.
  while (w * h > maxPixels) {
    if (w >= h && w > 1) w--;
    else if (h > 1) h--;
    else break;
  }
  return {width: w, height: h, pixels: w * h};
}

/**
 * Hysteresis: degrade on sustained slow frames, recover cautiously.
 * Ignore huge background-tab gaps and very short/invalid scheduling samples.
 */
export function createAdaptiveResolution({initialScale = .85, minScale = .55,
  downSamples = 12, upSamples = 100} = {}) {
  if (![initialScale, minScale, downSamples, upSamples].every(Number.isFinite) ||
      minScale < .2 || initialScale < minScale || initialScale > 1 ||
      !Number.isInteger(downSamples) || downSamples < 2 ||
      !Number.isInteger(upSamples) || upSamples < 2) {
    throw new RangeError('Invalid mobile framebuffer quality settings');
  }
  let scale = initialScale, slow = 0, fast = 0;
  return {
    get scale() { return scale; },
    resolution(width, height, dpr) { return framebufferSize(width, height, dpr, scale); },
    reset() { scale = initialScale; slow = 0; fast = 0; },
    sampleFrame(ms) {
      if (!Number.isFinite(ms) || ms < 16 || ms > 250) {
        slow = 0; fast = 0; return false;
      }
      if (ms >= 46) {slow++; fast = 0;}
      else if (ms <= 35) {fast++; slow = 0;}
      else {slow = 0; fast = 0;}
      if (slow >= downSamples && scale > minScale) {
        const next = Math.max(minScale, Math.round((scale - .1) * 100) / 100);
        slow = 0; fast = 0;
        if (next !== scale) {scale = next; return true;}
      }
      if (fast >= upSamples && scale < 1) {
        const next = Math.min(1, Math.round((scale + .05) * 100) / 100);
        slow = 0; fast = 0;
        if (next !== scale) {scale = next; return true;}
      }
      return false;
    },
  };
}
