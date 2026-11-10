/**
 * Experimental WotLK 3.3.5a auth-only client for an OWNED, loopback-only lab.
 * Implements AUTH_LOGON_CHALLENGE -> SRP6 M1/M2 -> REALM_LIST over the existing
 * opaque /ws/auth local TCP bridge. No game client, world protocol or assets.
 *
 * WARNING: Classic SRP6 uses SHA-1; this unreviewed browser prototype is not
 * suitable for production account credentials, public sites or real realms.
 */
export const BUILD = 12340;
export const MODULUS = BigInt('0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7');
export const GENERATOR = 7n;
const GROUP_BYTES = 32;
const REALM_LIMIT = 16384;
const BUFFER_LIMIT = 65536;
const textDecoder = new TextDecoder('utf-8', {fatal: true});

export function concatBytes(...pieces) {
  const size = pieces.reduce((sum, p) => sum + p.length, 0);
  const output = new Uint8Array(size);
  let cursor = 0;
  for (const piece of pieces) { output.set(piece, cursor); cursor += piece.length; }
  return output;
}
const ascii = text => new TextEncoder().encode(text);

export function toLE(value, length = GROUP_BYTES) {
  if (value < 0n) throw new Error('Invalid SRP6 integer');
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; ++i) { bytes[i] = Number(value & 255n); value >>= 8n; }
  if (value) throw new Error('Oversized SRP6 integer');
  return bytes;
}
export function fromLE(bytes) {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; --i) value = value * 256n + BigInt(bytes[i]);
  return value;
}
export function modPow(base, exponent, modulus) {
  if (modulus <= 1n || exponent < 0n) throw new Error('Invalid modular exponent');
  let result = 1n;
  base = ((base % modulus) + modulus) % modulus;
  while (exponent > 0n) {
    if (exponent & 1n) result = result * base % modulus;
    base = base * base % modulus;
    exponent >>= 1n;
  }
  return result;
}
async function sha1(subtle, ...pieces) {
  return new Uint8Array(await subtle.digest('SHA-1', concatBytes(...pieces)));
}
export function checkLabCredentials(username, password) {
  if (typeof username !== 'string' || !/^[a-z0-9]{1,16}$/i.test(username)) {
    throw new Error('Use a disposable ASCII lab username (1–16 letters/digits)');
  }
  if (typeof password !== 'string' || password.length < 1 || password.length > 64 ||
      !/^[\x20-\x7e]+$/.test(password)) {
    throw new Error('Use a disposable ASCII lab password (1–64 printable characters)');
  }
  return {username: username.toUpperCase(), password: password.toUpperCase()};
}
export function encodeChallenge(username) {
  if (typeof username !== 'string' || !/^[A-Z0-9]{1,16}$/.test(username)) {
    throw new Error('Invalid 3.3.5a challenge account');
  }
  const account = ascii(username);
  const body = concatBytes(
    ascii('WoW\0'), Uint8Array.of(3, 3, 5, BUILD & 255, BUILD >> 8),
    ascii('68x\0'), ascii('niW\0'), ascii('SUne'), new Uint8Array(8),
    Uint8Array.of(account.length), account,
  );
  return concatBytes(Uint8Array.of(0, 0, body.length & 255, body.length >> 8), body);
}
export function parseChallenge(packet) {
  if (!(packet instanceof Uint8Array) || packet.length !== 119 ||
      packet[0] !== 0 || packet[1] !== 0 || packet[2] !== 0) {
    throw new Error('Rejected or invalid authserver challenge');
  }
  const B = packet.slice(3, 35);
  const salt = packet.slice(70, 102);
  if (packet[35] !== 1 || packet[36] !== 7 || packet[37] !== 32 ||
      !sameBytes(packet.slice(38, 70), toLE(MODULUS))) {
    throw new Error('Unexpected SRP6 group; authentication aborted');
  }
  const publicB = fromLE(B);
  if (publicB === 0n || publicB >= MODULUS || packet[118] !== 0) {
    throw new Error('Invalid SRP6 public key or unsupported second factor');
  }
  return {B, salt};
}
function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}
async function interleave(subtle, shared) {
  let start = 0;
  while (start < 32 && shared[start] === 0) start += 1;
  if (start & 1) start++;
  const even = [], odd = [];
  for (let i = start; i < 32; i += 2) { even.push(shared[i]); odd.push(shared[i + 1]); }
  const [h0, h1] = await Promise.all([sha1(subtle, Uint8Array.from(even)), sha1(subtle, Uint8Array.from(odd))]);
  const K = new Uint8Array(40);
  for (let i = 0; i < 20; i++) { K[i * 2] = h0[i]; K[i * 2 + 1] = h1[i]; }
  return K;
}
export async function calculateClientProof(username, password, challenge, {
  cryptoRef = globalThis.crypto, secretA = null,
} = {}) {
  const credentials = checkLabCredentials(username, password);
  if (!cryptoRef?.subtle?.digest || !cryptoRef?.getRandomValues) {
    throw new Error('Browser WebCrypto is required for local SRP6');
  }
  if (!(challenge?.B instanceof Uint8Array) || challenge.B.length !== 32 ||
      !(challenge.salt instanceof Uint8Array) || challenge.salt.length !== 32) {
    throw new Error('Invalid SRP6 challenge');
  }
  const B = fromLE(challenge.B);
  if (B === 0n || B >= MODULUS) throw new Error('Invalid SRP6 server key');
  const secret = secretA === null ? cryptoRef.getRandomValues(new Uint8Array(32)) : secretA;
  if (!(secret instanceof Uint8Array) || secret.length !== 32 || fromLE(secret) === 0n) {
    throw new Error('Invalid ephemeral SRP6 secret');
  }
  const A = toLE(modPow(GENERATOR, fromLE(secret), MODULUS));
  const x = fromLE(await sha1(cryptoRef.subtle, challenge.salt,
    await sha1(cryptoRef.subtle, ascii(`${credentials.username}:${credentials.password}`))));
  const u = fromLE(await sha1(cryptoRef.subtle, A, challenge.B));
  if (u === 0n) throw new Error('Invalid SRP6 scrambling parameter');
  const base = ((B - 3n * modPow(GENERATOR, x, MODULUS)) % MODULUS + MODULUS) % MODULUS;
  if (base === 0n) throw new Error('Invalid SRP6 proof base');
  const S = toLE(modPow(base, fromLE(secret) + u * x, MODULUS));
  const K = await interleave(cryptoRef.subtle, S);
  const [NHash, gHash, IHash] = await Promise.all([
    sha1(cryptoRef.subtle, toLE(MODULUS)),
    sha1(cryptoRef.subtle, Uint8Array.of(7)),
    sha1(cryptoRef.subtle, ascii(credentials.username)),
  ]);
  const xor = NHash.map((n, index) => n ^ gHash[index]);
  const M1 = await sha1(cryptoRef.subtle, xor, IHash, challenge.salt, A, challenge.B, K);
  const M2 = await sha1(cryptoRef.subtle, A, M1, K);
  // CRC/version proof is zero for the limited non-strict local test realm.
  return {packet: concatBytes(Uint8Array.of(1), A, M1, new Uint8Array(22)), expectedM2: M2,
    // Ephemeral verified SRP key. Only pass to an optional same-transaction callback, then zero.
    sessionKey: K};
}
export function verifyServerProof(packet, expectedM2) {
  if (!(packet instanceof Uint8Array) || packet.length !== 32 || packet[0] !== 1 || packet[1] !== 0 ||
      !(expectedM2 instanceof Uint8Array) || expectedM2.length !== 20 ||
      !sameBytes(packet.slice(2, 22), expectedM2)) {
    throw new Error('SRP6 server proof rejected; no realm request sent');
  }
}
export function parseRealmList(packet) {
  if (!(packet instanceof Uint8Array) || packet.length < 11 || packet.length > REALM_LIMIT + 3 ||
      packet[0] !== 0x10 || (packet[1] | (packet[2] << 8)) !== packet.length - 3) {
    throw new Error('Invalid 3.3.5a realm-list frame');
  }
  const payload = new DataView(packet.buffer, packet.byteOffset + 3, packet.length - 3);
  const count = payload.getUint16(4, true);
  if (count > 128) throw new Error('Realm count over limit');
  let offset = 6;
  const read = size => {
    if (offset + size > payload.byteLength) throw new Error('Truncated realm-list data');
    const result = new Uint8Array(payload.buffer, payload.byteOffset + offset, size);
    offset += size;
    return result;
  };
  const readName = () => {
    const bytes = [];
    while (bytes.length <= 255) {
      const x = read(1)[0];
      if (x === 0) return textDecoder.decode(Uint8Array.from(bytes));
      bytes.push(x);
    }
    throw new Error('Realm text exceeds limit');
  };
  const realms = [];
  for (let i = 0; i < count; i++) {
    const [type, lock, flags] = read(3);
    const name = readName();
    const address = readName();
    const populationBytes = read(4);
    const population = new DataView(populationBytes.buffer, populationBytes.byteOffset, 4).getFloat32(0, true);
    const [characters, timezone, realmId] = read(3);
    if (!Number.isFinite(population) || population < 0) throw new Error('Invalid realm population');
    let clientBuild = null;
    if (flags & 4) {
      read(3); // major/minor/patch, not sufficient evidence for game compatibility
      const b = read(2);
      clientBuild = b[0] | (b[1] << 8);
    }
    realms.push({id: realmId, name, address, locked: Boolean(lock),
      flags, type, population, characters, timezone, build: clientBuild});
  }
  const tail = read(2);
  if (tail[0] !== 0x10 || tail[1] !== 0 || offset !== payload.byteLength) {
    throw new Error('Realm-list trailing data invalid');
  }
  return realms;
}

/** Frame accumulator: TCP bytes delivered via WebSocket are not message-aligned. */
export function createByteReader(socket) {
  let buffer = new Uint8Array(0);
  let waiter = null;
  let stopped = null;
  const reject = reason => {
    stopped = reason;
    if (waiter) { waiter.reject(reason); waiter = null; }
  };
  const pump = () => {
    if (waiter && buffer.length >= waiter.size) {
      const {size, resolve} = waiter;
      waiter = null;
      const slice = buffer.slice(0, size);
      buffer = buffer.slice(size);
      resolve(slice);
    }
  };
  socket.addEventListener('message', event => {
    if (stopped) return;
    const value = event.data;
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value)
      : (ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null);
    if (!bytes || buffer.length + bytes.length > BUFFER_LIMIT) {
      reject(new Error('Unexpected or oversized authserver response'));
      return;
    }
    buffer = concatBytes(buffer, bytes);
    pump();
  });
  socket.addEventListener('close', () => reject(new Error('Local auth bridge closed')));
  socket.addEventListener('error', () => reject(new Error('Local auth bridge failed')));
  return {
    read(size) {
      if (!Number.isInteger(size) || size < 1 || size > BUFFER_LIMIT || waiter) {
        return Promise.reject(new Error('Invalid or concurrent auth read'));
      }
      if (stopped) return Promise.reject(stopped);
      return new Promise((resolve, rejectRead) => {
        waiter = {size, resolve, reject: rejectRead};
        pump();
      });
    },
    close() { reject(new Error('Auth reader closed')); },
  };
}
export function localBridgeUrl(locationRef) {
  if (!locationRef || !['localhost', '127.0.0.1', '[::1]'].includes(locationRef.hostname) ||
      !['http:', 'https:'].includes(locationRef.protocol)) {
    throw new Error('Auth lab requires a locally opened browser (127.0.0.1 or localhost)');
  }
  return `${locationRef.protocol === 'https:' ? 'wss:' : 'ws:'}//${locationRef.host}/ws/auth`;
}

/** No persistence or logging. Caller must discard password after this call. */
export async function browserLabLogin({username, password, locationRef = globalThis.location,
  socketFactory = url => new WebSocket(url), cryptoRef = globalThis.crypto,
  timeoutMs = 5000, onStage = () => {}, onVerifiedSession = null,
}) {
  const bridge = localBridgeUrl(locationRef);
  checkLabCredentials(username, password);
  if (onVerifiedSession !== null && typeof onVerifiedSession !== 'function') {
    throw new Error('Invalid local session callback');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) {
    throw new Error('Invalid local auth timeout');
  }
  const socket = socketFactory(bridge);
  socket.binaryType = 'arraybuffer';
  const reader = createByteReader(socket);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Local auth exchange timed out')), timeoutMs);
  });
  const exchange = async () => {
    await new Promise((resolve, reject) => {
      if (socket.readyState === 1) return resolve();
      socket.addEventListener('open', resolve, {once: true});
      socket.addEventListener('error', () => reject(new Error('Cannot open local auth bridge')), {once: true});
      socket.addEventListener('close', () => reject(new Error('Local auth bridge closed')), {once: true});
    });
    onStage('connected');
    socket.send(encodeChallenge(username.toUpperCase()));
    const header = await reader.read(3);
    if (!sameBytes(header, Uint8Array.of(0, 0, 0))) throw new Error('Account or build rejected by authserver');
    const challenge = parseChallenge(concatBytes(header, await reader.read(116)));
    onStage('challenge');
    const proof = await calculateClientProof(username, password, challenge, {cryptoRef});
    // Do not release this key in any public result. It is only valid within this transaction.
    try {
      socket.send(proof.packet);
      const proofHeader = await reader.read(2);
      if (!sameBytes(proofHeader, Uint8Array.of(1, 0))) throw new Error('SRP6 proof rejected');
      verifyServerProof(concatBytes(proofHeader, await reader.read(30)), proof.expectedM2);
      onStage('srp6-verified');
      socket.send(Uint8Array.of(0x10, 0, 0, 0, 0));
      const realmHeader = await reader.read(3);
      if (realmHeader[0] !== 0x10) throw new Error('Invalid realm-list response');
      const length = realmHeader[1] | (realmHeader[2] << 8);
      if (length < 8 || length > REALM_LIMIT) throw new Error('Realm-list frame exceeds bounds');
      const realms = parseRealmList(concatBytes(realmHeader, await reader.read(length)));
      onStage('realms');
      // Only after both the server M2 proof and the realm framing are verified.
      const world = onVerifiedSession ? await onVerifiedSession({
        username: username.toUpperCase(), sessionKey: proof.sessionKey, realms,
      }) : null;
      return {srp6_server_proof_verified: true, realm_list_decoded: true,
        realms: realms.map(r => ({id: r.id, name: r.name, characters: r.characters,
          locked: r.locked, build: r.build})),
        ...(world ? {world} : {}),
        world_connected: Boolean(world?.world_authenticated), gameplay_verified: false,
        server_identity_verified: false};
    } finally {
      // JS string passwords cannot reliably be erased; do not store/log them.
      proof.sessionKey.fill(0);
    }
  };
  try {
    return await Promise.race([exchange(), timeout]);
  } finally {
    clearTimeout(timer);
    reader.close();
    socket.close();
  }
}
