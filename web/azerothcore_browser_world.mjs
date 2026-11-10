/**
 * WotLK build 12340, READ-ONLY world protocol interoperability for OWNED local labs.
 * No character login, avatar movement, original game data, or public networking.
 * The legacy RC4/SHA-1 protocol is unsuitable for modern production credentials.
 */
import {createByteReader, localBridgeUrl, concatBytes} from './azerothcore_browser_auth.mjs';

export const WORLD_OPCODES = Object.freeze({
  SMSG_AUTH_CHALLENGE: 0x1ec, CMSG_AUTH_SESSION: 0x1ed,
  SMSG_AUTH_RESPONSE: 0x1ee, CMSG_CHAR_ENUM: 0x037, SMSG_CHAR_ENUM: 0x03b,
});
export const MAX_WORLD_PAYLOAD = 65536;
const SERVER_ENCRYPTION = Uint8Array.from([0xcc,0x98,0xae,0x04,0xe8,0x97,0xea,0xca,0x12,0xdd,0xc0,0x93,0x42,0x91,0x53,0x57]);
const SERVER_DECRYPTION = Uint8Array.from([0xc2,0xb3,0x72,0x3c,0xc6,0xae,0xd9,0xb5,0x34,0x3c,0x53,0xee,0x2f,0x43,0x67,0xce]);
const decoder = new TextDecoder('utf-8', {fatal: true});
const encoder = new TextEncoder();
const EMPTY_ADDON_LIST = Uint8Array.from([4,0,0,0,0x78,0x9c,0x63,0x60,0x60,0x60,0,0,0,4,0,1]);
const be16 = n => Uint8Array.of(n >>> 8 & 255, n & 255);
const le16 = n => Uint8Array.of(n & 255, n >>> 8 & 255);
const le32 = n => Uint8Array.of(n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255);

export class WorldProtocolError extends Error {}

/** Stateful ARC4 only for the WotLK 3.3.5a *header* cipher, with 1024-byte drop. */
export class LegacyHeaderCipher {
  constructor(key) {
    if (!(key instanceof Uint8Array) || key.length !== 20) throw new WorldProtocolError('Invalid world header cipher key');
    this.state = Uint8Array.from({length:256}, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + this.state[i] + key[i % key.length]) & 255;
      [this.state[i],this.state[j]] = [this.state[j],this.state[i]];
    }
    this.i = 0; this.j = 0;
    this.apply(new Uint8Array(1024));
  }
  apply(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new WorldProtocolError('Expected header bytes');
    const out = new Uint8Array(bytes.length);
    for (let k = 0; k < bytes.length; k++) {
      this.i = (this.i + 1) & 255;
      this.j = (this.j + this.state[this.i]) & 255;
      [this.state[this.i],this.state[this.j]] = [this.state[this.j],this.state[this.i]];
      out[k] = bytes[k] ^ this.state[(this.state[this.i] + this.state[this.j]) & 255];
    }
    return out;
  }
  dispose() {this.state.fill(0); this.i=0; this.j=0;}
}

async function hmacSha1(cryptoRef, keyBytes, message) {
  if (!cryptoRef?.subtle?.importKey || !cryptoRef?.subtle?.sign) throw new WorldProtocolError('WebCrypto HMAC unavailable');
  const key = await cryptoRef.subtle.importKey('raw', keyBytes, {name:'HMAC',hash:'SHA-1'}, false, ['sign']);
  return new Uint8Array(await cryptoRef.subtle.sign('HMAC', key, message));
}
export async function createHeaderCiphers(sessionKey, cryptoRef = globalThis.crypto) {
  if (!(sessionKey instanceof Uint8Array) || sessionKey.length !== 40) {
    throw new WorldProtocolError('World session requires a verified 40-byte SRP6 key');
  }
  const [sending, receiving] = await Promise.all([
    hmacSha1(cryptoRef, SERVER_DECRYPTION, sessionKey),
    hmacSha1(cryptoRef, SERVER_ENCRYPTION, sessionKey),
  ]);
  try {return {outbound:new LegacyHeaderCipher(sending), inbound:new LegacyHeaderCipher(receiving)};}
  finally {sending.fill(0); receiving.fill(0);}
}

export function encodeClientWorldPacket(opcode, payload = new Uint8Array(0), cipher = null) {
  if (!Number.isInteger(opcode) || opcode < 0 || opcode > 65535 || !(payload instanceof Uint8Array) ||
      payload.length + 4 >= 10240) throw new WorldProtocolError('Invalid client world packet');
  const header = concatBytes(be16(payload.length + 4), le32(opcode));
  return concatBytes(cipher ? cipher.apply(header) : header, payload);
}
export function encodeServerWorldPacket(opcode, payload = new Uint8Array(0), cipher = null) {
  // Fixture-only utility: source protocol's server header is big endian size + LE opcode.
  if (!Number.isInteger(opcode) || opcode < 0 || opcode > 65535 || !(payload instanceof Uint8Array) ||
      payload.length + 2 > MAX_WORLD_PAYLOAD) throw new WorldProtocolError('Invalid fixture world packet');
  const size = payload.length + 2;
  const header = concatBytes(size > 0x7fff ? Uint8Array.of(0x80 | (size >>> 16)) : new Uint8Array(0),
    be16(size), le16(opcode));
  return concatBytes(cipher ? cipher.apply(header) : header, payload);
}
export async function readWorldPacket(reader, cipher = null) {
  const firstEncrypted = await reader.read(1);
  const first = cipher ? cipher.apply(firstEncrypted) : firstEncrypted;
  const large = Boolean(first[0] & 0x80);
  const restEncrypted = await reader.read(large ? 4 : 3);
  const rest = cipher ? cipher.apply(restEncrypted) : restEncrypted;
  const header = concatBytes(first,rest);
  const size = large ? ((header[0] & 0x7f) * 65536 + (header[1] << 8) + header[2])
    : (header[0] << 8) + header[1];
  const opcode = large ? header[3] + (header[4] << 8) : header[2] + (header[3] << 8);
  if (size < 2 || size > MAX_WORLD_PAYLOAD) throw new WorldProtocolError('Unsafe world packet length');
  return {opcode, payload: size === 2 ? new Uint8Array(0) : await reader.read(size - 2)};
}
export function parseWorldChallenge({opcode, payload}) {
  if (opcode !== WORLD_OPCODES.SMSG_AUTH_CHALLENGE || !(payload instanceof Uint8Array) ||
      payload.length !== 40 || payload[0] !== 1 || payload[1] !== 0 || payload[2] !== 0 || payload[3] !== 0) {
    throw new WorldProtocolError('Unexpected AzerothCore world challenge');
  }
  return payload.slice(4,8);
}
export async function makeWorldAuthSession({username, sessionKey, realmId, serverSeed,
  cryptoRef = globalThis.crypto, clientSeed = null}) {
  if (typeof username !== 'string' || !/^LAB[A-Z0-9]{1,13}$/.test(username) ||
      !(sessionKey instanceof Uint8Array) || sessionKey.length !== 40 ||
      !(serverSeed instanceof Uint8Array) || serverSeed.length !== 4 ||
      !Number.isInteger(realmId) || realmId < 1 || realmId > 255) {
    throw new WorldProtocolError('Invalid local world authentication parameters');
  }
  const seed = clientSeed === null ? cryptoRef?.getRandomValues?.(new Uint8Array(4)) : clientSeed;
  if (!(seed instanceof Uint8Array) || seed.length !== 4 || !cryptoRef?.subtle?.digest) {
    throw new WorldProtocolError('Secure client seed and WebCrypto required');
  }
  const digest = new Uint8Array(await cryptoRef.subtle.digest('SHA-1',concatBytes(
    encoder.encode(username), new Uint8Array(4), seed, serverSeed, sessionKey)));
  const payload = concatBytes(le32(12340), le32(0), encoder.encode(username), Uint8Array.of(0),
    le32(0), seed, le32(0), le32(0), le32(realmId), new Uint8Array(8), digest, EMPTY_ADDON_LIST);
  return encodeClientWorldPacket(WORLD_OPCODES.CMSG_AUTH_SESSION,payload);
}

/** Read-only character metadata. No GUID is ever returned or retained. */
export function parseCharacterList(payload) {
  if (!(payload instanceof Uint8Array) || !payload.length) throw new WorldProtocolError('No character enumeration payload');
  const count = payload[0];
  if (count > 12) throw new WorldProtocolError('Character count exceeds safe limit');
  const view = new DataView(payload.buffer,payload.byteOffset,payload.byteLength);
  const characters = [];
  let pos = 1;
  for (let i = 0; i < count; i++) {
    if (pos + 8 >= payload.length) throw new WorldProtocolError('Truncated character GUID');
    pos += 8;
    const nameStart = pos;
    while (pos < payload.length && pos - nameStart <= 48 && payload[pos] !== 0) pos++;
    if (pos >= payload.length || pos === nameStart || pos - nameStart > 48) throw new WorldProtocolError('Invalid character name');
    let name;
    try {name = decoder.decode(payload.subarray(nameStart,pos));}
    catch {throw new WorldProtocolError('Invalid character name UTF-8');}
    pos++;
    if (pos + 54 + 23 * 9 > payload.length) throw new WorldProtocolError('Truncated character equipment');
    const race = view.getUint8(pos), classId = view.getUint8(pos+1), gender = view.getUint8(pos+2);
    const level = view.getUint8(pos+8);
    const zone = view.getUint32(pos+9,true), mapId = view.getUint32(pos+13,true);
    if (race < 1 || race > 12 || classId < 1 || classId > 11 || gender > 1 || level < 1 || level > 80) {
      throw new WorldProtocolError('Invalid character metadata');
    }
    pos += 54 + 23 * 9;
    characters.push({name, race, classId, gender, level, zone, mapId});
  }
  if (pos !== payload.length) throw new WorldProtocolError('Unexpected character list bytes');
  return characters;
}
export function localWorldBridgeUrl(locationRef) {
  return localBridgeUrl(locationRef).replace(/\/ws\/auth$/, '/ws/world');
}

/**
 * Uses a verified temporary SRP6 key from the same login transaction.
 * Source realm address is deliberately ignored, never treated as a network target.
 */
export async function enumerateBrowserCharacters({username,sessionKey,realmId,
  locationRef=globalThis.location, socketFactory=url=>new WebSocket(url), cryptoRef=globalThis.crypto,
  timeoutMs=8000,onStage=()=>{}}) {
  const url = localWorldBridgeUrl(locationRef);
  if (!(sessionKey instanceof Uint8Array) || sessionKey.length !== 40 ||
      typeof username !== 'string' || !/^LAB[A-Z0-9]{1,13}$/.test(username) ||
      !Number.isInteger(realmId) || realmId < 1 || realmId > 255 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15000) {
    throw new WorldProtocolError('Invalid disposable local world session');
  }
  const socket = socketFactory(url);
  socket.binaryType = 'arraybuffer';
  const reader = createByteReader(socket);
  let outbound = null, inbound = null, timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new WorldProtocolError('Local world exchange timed out')), timeoutMs);
  });
  const exchange = async () => {
    await new Promise((resolve, reject) => {
      if (socket.readyState === 1) return resolve();
      socket.addEventListener('open', resolve, {once:true});
      socket.addEventListener('error', () => reject(new WorldProtocolError('Cannot open local world bridge')), {once:true});
      socket.addEventListener('close', () => reject(new WorldProtocolError('Local world bridge closed')), {once:true});
    });
    onStage('world-connected');
    const seed = parseWorldChallenge(await readWorldPacket(reader));
    const authPacket = await makeWorldAuthSession({username,sessionKey,realmId,serverSeed:seed,cryptoRef});
    socket.send(authPacket);
    ({outbound,inbound} = await createHeaderCiphers(sessionKey,cryptoRef));
    let authenticated = false;
    for (let i=0;i<24;i++) {
      const response = await readWorldPacket(reader,inbound);
      if (response.opcode === WORLD_OPCODES.SMSG_AUTH_RESPONSE) {
        if (response.payload.length === 0 || response.payload[0] !== 0x0c) throw new WorldProtocolError('Worldserver rejected local session');
        authenticated = true;
        break;
      }
    }
    if (!authenticated) throw new WorldProtocolError('No verified world authentication reply');
    onStage('world-authenticated');
    socket.send(encodeClientWorldPacket(WORLD_OPCODES.CMSG_CHAR_ENUM, new Uint8Array(0), outbound));
    for (let i=0;i<24;i++) {
      const response = await readWorldPacket(reader,inbound);
      if (response.opcode === WORLD_OPCODES.SMSG_CHAR_ENUM) {
        const characters = parseCharacterList(response.payload);
        onStage('characters');
        return {world_authenticated:true,character_list_received:true,character_count:characters.length,
          characters,gameplay_verified:false,source:'verified-local-protocol'};
      }
    }
    throw new WorldProtocolError('No character enumeration response');
  };
  try {return await Promise.race([exchange(),timeout]);}
  finally {
    clearTimeout(timer);
    reader.close(); socket.close();
    outbound?.dispose(); inbound?.dispose();
  }
}
