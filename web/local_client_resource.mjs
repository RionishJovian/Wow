/**
 * Canonical Wowser UI resource URL resolver for *local* development only.
 * Upstream Wowser paths use Windows-style backslashes and ../ segments.
 * Enforce /client/ confinement and never issue network/foreign-origin URLs.
 * This does not retrieve, convert, or license Blizzard data.
 */
export function localClientResource(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > 1024 ||
      /[%?#:\u0000-\u001f\u007f]/.test(input)) {
    throw new Error('Unsafe local client resource name');
  }
  // Windows drive letters are never a valid in-game resource name.
  if (/^[a-zA-Z]:/.test(input) || input.startsWith('/') || input.startsWith('\\')) {
    throw new Error('Absolute client resource not allowed');
  }
  const segments = [];
  for (const part of input.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!segments.length) throw new Error('Resource escapes local client installation');
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  if (!segments.length) throw new Error('Empty resource name');
  return '/client/' + segments.map(encodeURIComponent).join('/');
}
