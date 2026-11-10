import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto, createHash} from 'node:crypto';
import {
  BUILD, MODULUS, GENERATOR, checkLabCredentials, encodeChallenge, toLE, fromLE,
  parseChallenge, calculateClientProof, verifyServerProof, parseRealmList,
  createByteReader, localBridgeUrl, browserLabLogin, modPow, concatBytes,
} from '../web/azerothcore_browser_auth.mjs';

const USER = 'LABUSER';
const PASSWORD = 'ONLY-FOR-OFFLINE-TESTS';
const SALT = Uint8Array.from({length: 32}, (_, i) => i);
const sha = (...pieces) => {
  const hash = createHash('sha1');
  for (const p of pieces) hash.update(p);
  return new Uint8Array(hash.digest());
};
const X = fromLE(sha(SALT, sha(new TextEncoder().encode(`${USER}:${PASSWORD}`))));
const V = modPow(GENERATOR, X, MODULUS);
const secretB = fromLE(Uint8Array.from({length: 32}, (_, i) => 32 - i));
const SERVER_B = toLE((3n * V + modPow(GENERATOR, secretB, MODULUS)) % MODULUS);
const authChallenge = concatBytes(Uint8Array.of(0, 0, 0), SERVER_B,
  Uint8Array.of(1, 7, 32), toLE(MODULUS), SALT,
  Uint8Array.from({length: 16}, (_, i) => i), Uint8Array.of(0));
const clientCrypto = {
  subtle: webcrypto.subtle,
  getRandomValues(arr) { arr.fill(9); return arr; },
};
const realmPacket = () => {
  const enc = new TextEncoder();
  const row = concatBytes(Uint8Array.of(1, 0, 4), enc.encode('Local Realm\0'),
    enc.encode('127.0.0.1:8085\0'), Uint8Array.of(0, 0, 128, 62),
    Uint8Array.of(1, 1, 1, 3, 3, 5, BUILD & 255, BUILD >> 8));
  const data = concatBytes(new Uint8Array(4), Uint8Array.of(1, 0), row, Uint8Array.of(0x10, 0));
  return concatBytes(Uint8Array.of(0x10, data.length & 255, data.length >> 8), data);
};

function digestServerProof(clientPacket) {
  const A = clientPacket.slice(1, 33);
  const u = fromLE(sha(A, SERVER_B));
  const S = toLE(modPow((fromLE(A) * modPow(V, u, MODULUS)) % MODULUS, secretB, MODULUS));
  const odd = [], even = [];
  for (let i = 0; i < 32; i += 2) { even.push(S[i]); odd.push(S[i + 1]); }
  const h0 = sha(Uint8Array.from(even));
  const h1 = sha(Uint8Array.from(odd));
  const K = new Uint8Array(40);
  for (let i = 0; i < 20; i++) { K[2*i] = h0[i]; K[2*i+1] = h1[i]; }
  const group = sha(toLE(MODULUS)).map((x, i) => x ^ sha(Uint8Array.of(7))[i]);
  const expectedM1 = sha(group, sha(new TextEncoder().encode(USER)), SALT, A, SERVER_B, K);
  assert.deepEqual(clientPacket.slice(33, 53), expectedM1, 'Server verifies client M1');
  return sha(A, expectedM1, K);
}

class FakeSocket {
  constructor({badProof = false} = {}) {
    this.listeners = new Map();
    this.sent = [];
    this.readyState = 0;
    this.badProof = badProof;
    queueMicrotask(() => {this.readyState = 1; this.emit('open', {});});
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  emit(type, event) {for (const handler of this.listeners.get(type) || []) handler(event);}
  deliver(bytes) {
    // TCP fragments are not WebSocket frame boundaries; test arbitrary splits.
    for (let i = 0; i < bytes.length; i += 7) {
      const piece = bytes.slice(i, i + 7);
      queueMicrotask(() => this.emit('message', {data: piece.buffer}));
    }
  }
  send(bytes) {
    assert.equal(this.readyState, 1);
    this.sent.push(new Uint8Array(bytes));
    if (this.sent.length === 1) {
      assert.deepEqual(this.sent[0], encodeChallenge(USER));
      this.deliver(authChallenge);
    } else if (this.sent.length === 2) {
      const M2 = digestServerProof(this.sent[1]);
      if (this.badProof) M2.fill(0);
      this.deliver(concatBytes(Uint8Array.of(1, 0), M2, new Uint8Array(10)));
    } else if (this.sent.length === 3) {
      assert.deepEqual(this.sent[2], Uint8Array.of(0x10, 0, 0, 0, 0));
      this.deliver(realmPacket());
    } else assert.fail('Unexpected extra command');
  }
  close() { if (this.readyState !== 3) { this.readyState = 3; this.emit('close', {}); } }
}

test('WotLK challenge bytes exactly match build-12340 Python fixture', () => {
  const packet = encodeChallenge(USER);
  assert.equal(packet[0], 0);
  assert.equal(packet[1], 0);
  assert.equal(packet[11] | packet[12] << 8, BUILD);
  assert.equal(packet[2] | packet[3] << 8, packet.length - 4);
  assert.deepEqual(Array.from(packet.slice(34)), [...new TextEncoder().encode(USER)]);
});

test('SRP6 browser proof equals independently verified Python Build 09 vector', async () => {
  const proof = await calculateClientProof(USER, PASSWORD, parseChallenge(authChallenge),
    {cryptoRef: clientCrypto, secretA: new Uint8Array(32).fill(9)});
  assert.equal(Buffer.from(proof.packet).toString('hex'),
    '0132620b7317164748a8d55aafe98263e6b4368027b272c662f4343283408a1e577aa476ed706a771313b19413951a9ba5a4453afd00000000000000000000000000000000000000000000');
  assert.equal(Buffer.from(proof.expectedM2).toString('hex'),
    'bf63f4daa5fa17b551cd8a156f9de84be918e25b');
  verifyServerProof(concatBytes(Uint8Array.of(1, 0), proof.expectedM2, new Uint8Array(10)), proof.expectedM2);
});

test('full local browser SRP6 and realm list through fragmented WebSocket bridge', async () => {
  const socket = new FakeSocket();
  const stages = [];
  const output = await browserLabLogin({username: USER.toLowerCase(), password: PASSWORD.toLowerCase(),
    locationRef: {hostname: 'localhost', host: 'localhost:8765', protocol: 'http:'},
    socketFactory: url => { assert.equal(url, 'ws://localhost:8765/ws/auth'); return socket; },
    cryptoRef: clientCrypto, onStage: step => stages.push(step)});
  assert.deepEqual(stages, ['connected', 'challenge', 'srp6-verified', 'realms']);
  assert.equal(output.srp6_server_proof_verified, true);
  assert.equal(output.realms[0].name, 'Local Realm');
  assert.equal(output.realms[0].build, 12340);
  assert.equal(output.gameplay_verified, false);
  assert.equal(output.world_connected, false);
  assert.equal(socket.sent.length, 3);
  assert.equal(socket.readyState, 3);
});

test('invalid server M2 never triggers realm request', async () => {
  const socket = new FakeSocket({badProof:true});
  await assert.rejects(browserLabLogin({username: USER, password: PASSWORD,
    locationRef: {hostname:'127.0.0.1',host:'127.0.0.1:8765',protocol:'http:'},
    socketFactory: () => socket, cryptoRef: clientCrypto}), /SRP6 server proof rejected/);
  assert.equal(socket.sent.length, 2);
});

test('realm decode rejects overflow, malformed strings, NaN and trailing data', () => {
  assert.equal(parseRealmList(realmPacket())[0].name, 'Local Realm');
  const corrupt = realmPacket();
  corrupt[1] = 1;
  assert.throws(() => parseRealmList(corrupt), /frame/);
  const extra = concatBytes(realmPacket(), Uint8Array.of(0));
  assert.throws(() => parseRealmList(extra), /frame/);
  assert.throws(() => parseRealmList(new Uint8Array(9)), /frame/);
});

test('auth bridge only resolves to local loopback browser origin', () => {
  assert.equal(localBridgeUrl({hostname:'localhost',host:'localhost:8765',protocol:'http:'}),
    'ws://localhost:8765/ws/auth');
  assert.equal(localBridgeUrl({hostname:'127.0.0.1',host:'127.0.0.1:8765',protocol:'https:'}),
    'wss://127.0.0.1:8765/ws/auth');
  for (const hostname of ['127.0.0.2', '192.168.1.4','example.com','evil.localhost.net']) {
    assert.throws(() => localBridgeUrl({hostname,host:hostname,protocol:'http:'}), /locally opened/);
  }
  assert.throws(() => checkLabCredentials('foo bar','password'), /username/);
  assert.throws(() => checkLabCredentials('user',''), /password/);
});

test('frame reader accepts partial chunks and errors on oversized or text frames', async () => {
  const socket = new FakeSocket();
  const reader = createByteReader(socket);
  const result = reader.read(4);
  socket.emit('message', {data: Uint8Array.of(1,2).buffer});
  socket.emit('message', {data: Uint8Array.of(3,4,5).buffer});
  assert.deepEqual(await result, Uint8Array.of(1,2,3,4));
  assert.deepEqual(await reader.read(1), Uint8Array.of(5));
  const next = reader.read(1);
  socket.emit('message', {data: 'not-binary'});
  await assert.rejects(next, /Unexpected or oversized/);
});
