import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHmac,createHash} from 'node:crypto';
import {createByteReader,concatBytes} from '../web/azerothcore_browser_auth.mjs';
import {LegacyHeaderCipher,createHeaderCiphers,encodeClientWorldPacket,encodeServerWorldPacket,
  readWorldPacket,parseWorldChallenge,makeWorldAuthSession,parseCharacterList,
  localWorldBridgeUrl,enumerateBrowserCharacters,WORLD_OPCODES} from '../web/azerothcore_browser_world.mjs';
import {rosterViewModel,SAMPLE_CHARACTERS} from '../web/character_roster.mjs';

const ACCOUNT='LABUSER';
const K=Uint8Array.from({length:40},(_,i)=>i);
const SEED=Uint8Array.of(8,9,10,11);
const CLIENT=Uint8Array.of(1,2,3,4);
const cryptoRef={subtle:webcrypto.subtle,getRandomValues(x){x.set(CLIENT);return x;}};
const hmac=(key,message)=>new Uint8Array(createHmac('sha1',key).update(message).digest());
const sha=(...pieces)=>new Uint8Array(createHash('sha1').update(Buffer.concat(pieces.map(Buffer.from))).digest());
const enc=new TextEncoder();
// Independent reference cipher implementation: intentionally not invoking production RC4.
function referenceCipher(key) {
  const state=Array.from({length:256},(_,i)=>i);
  let a=0,b=0;
  for(let i=0;i<256;i++) {b=(b+state[i]+key[i%key.length])&255;[state[i],state[b]]=[state[b],state[i]];}
  a=0;b=0;
  const encBytes=data=>Uint8Array.from(data,byte=>{
    a=(a+1)&255;b=(b+state[a])&255;[state[a],state[b]]=[state[b],state[a]];
    return byte ^ state[(state[a]+state[b])&255];
  });
  encBytes(new Uint8Array(1024));
  return encBytes;
}
const keyForServer=()=>hmac(Buffer.from('cc98ae04e897eaca12ddc09342915357','hex'),K);
const keyForClient=()=>hmac(Buffer.from('c2b3723cc6aed9b5343c53ee2f4367ce','hex'),K);
const be16=n=>Uint8Array.of(n>>>8,n&255);
const le16=n=>Uint8Array.of(n&255,n>>>8);
const serverFrame=(opcode,payload,encryption=null)=>{
  const size=payload.length+2;
  let header=concatBytes(be16(size),le16(opcode));
  if(encryption)header=encryption(header);
  return concatBytes(header,payload);
};
const characterPayload=()=>{
  const char=concatBytes(new Uint8Array(8),enc.encode('LabHero\0'),new Uint8Array(54+207));
  // 9 appearance bytes: race/class/gender/skin/face/hair/style/color/facial/level
  const statsPos=8+8;
  char[statsPos]=1;char[statsPos+1]=1;char[statsPos+2]=0;
  char[statsPos+8]=80;
  new DataView(char.buffer).setUint32(statsPos+9,12,true);
  new DataView(char.buffer).setUint32(statsPos+13,0,true);
  return concatBytes(Uint8Array.of(1),char);
};

class WorldSocketFixture {
  constructor({badResponse=false}={}) {
    this.listeners=new Map();this.sent=[];this.badResponse=badResponse;
    this.readyState=0;
    this.encryptServer=referenceCipher(keyForServer());
    this.decryptClient=referenceCipher(keyForClient());
    queueMicrotask(()=>{
      this.readyState=1;this.emit('open',{});
      const challenge=concatBytes(Uint8Array.of(1,0,0,0),SEED,new Uint8Array(32));
      this.deliver(serverFrame(WORLD_OPCODES.SMSG_AUTH_CHALLENGE,challenge));
    });
  }
  addEventListener(t,handler){if(!this.listeners.has(t))this.listeners.set(t,[]);this.listeners.get(t).push(handler);}
  emit(t,e){for(const cb of this.listeners.get(t)||[])cb(e);}
  deliver(data){for(let offset=0;offset<data.length;offset+=3){
    const bytes=data.slice(offset,offset+3);
    queueMicrotask(()=>this.emit('message',{data:bytes.buffer}));
  }}
  send(bytes){
    assert.equal(this.readyState,1);
    const buf=Uint8Array.from(bytes);this.sent.push(buf);
    if(this.sent.length===1){
      const declared=buf[0]<<8|buf[1];assert.equal(declared,buf.length-2);
      assert.deepEqual(buf.slice(2,6),Uint8Array.of(0xed,1,0,0));
      const payload=buf.slice(6);
      assert.equal(new DataView(payload.buffer,payload.byteOffset).getUint32(0,true),12340);
      assert.deepEqual(payload.slice(8,16),enc.encode(`${ACCOUNT}\0`));
      const clientSeedOffset=8+8+4;
      assert.deepEqual(payload.slice(clientSeedOffset,clientSeedOffset+4),CLIENT);
      const digestOffset=clientSeedOffset+4+4+4+4+8;
      const expected=sha(enc.encode(ACCOUNT),new Uint8Array(4),CLIENT,SEED,K);
      assert.deepEqual(payload.slice(digestOffset,digestOffset+20),expected);
      const status=Uint8Array.of(this.badResponse?0x0d:0x0c);
      this.deliver(serverFrame(WORLD_OPCODES.SMSG_AUTH_RESPONSE,status,this.encryptServer));
    }else if(this.sent.length===2){
      const decryptedHeader=this.decryptClient(buf.slice(0,6));
      assert.deepEqual(decryptedHeader,Uint8Array.of(0,4,0x37,0,0,0));
      assert.equal(buf.length,6);
      this.deliver(serverFrame(WORLD_OPCODES.SMSG_CHAR_ENUM,characterPayload(),this.encryptServer));
    } else assert.fail('Unexpected outbound command from read-only world client');
  }
  close(){if(this.readyState!==3){this.readyState=3;this.emit('close',{});}}
}

test('AzerothCore header crypto matches independent HMAC-SHA1/ARC4-drop1024 reference',async()=>{
  const {outbound,inbound}=await createHeaderCiphers(K,cryptoRef);
  const src=Uint8Array.of(0,4,0x37,0,0,0);
  assert.deepEqual(outbound.apply(src),referenceCipher(keyForClient())(src));
  const srcServer=Uint8Array.of(0,3,0xee,1);
  assert.deepEqual(inbound.apply(srcServer),referenceCipher(keyForServer())(srcServer));
  outbound.dispose();inbound.dispose();
  assert.deepEqual(outbound.state,new Uint8Array(256));
});

test('world challenge and auth session digest match the independent reference',async()=>{
  const seed=parseWorldChallenge({opcode:WORLD_OPCODES.SMSG_AUTH_CHALLENGE,
    payload:concatBytes(Uint8Array.of(1,0,0,0),SEED,new Uint8Array(32))});
  assert.deepEqual(seed,SEED);
  const pkt=await makeWorldAuthSession({username:ACCOUNT,sessionKey:K,realmId:1,
    serverSeed:SEED,cryptoRef,clientSeed:CLIENT});
  assert.equal(pkt[0]<<8|pkt[1],pkt.length-2);
  assert.equal(pkt[2],0xed);assert.equal(pkt[3],1);
  assert.ok(Buffer.from(pkt).includes(Buffer.from(sha(enc.encode(ACCOUNT),new Uint8Array(4),CLIENT,SEED,K))));
  assert.throws(()=>parseWorldChallenge({opcode:WORLD_OPCODES.SMSG_AUTH_RESPONSE,payload:new Uint8Array(40)}),/challenge/);
});

test('browser world bridge simulates verified auth and returns read-only characters',async()=>{
  const fake=new WorldSocketFixture();
  const stages=[];
  const output=await enumerateBrowserCharacters({username:ACCOUNT,sessionKey:K,realmId:1,
    locationRef:{hostname:'localhost',host:'localhost:8765',protocol:'http:'},
    socketFactory:url=>{assert.equal(url,'ws://localhost:8765/ws/world');return fake;},
    cryptoRef,onStage:stage=>stages.push(stage)});
  assert.deepEqual(stages,['world-connected','world-authenticated','characters']);
  assert.equal(output.world_authenticated,true);
  assert.equal(output.gameplay_verified,false);
  assert.equal(output.source,'verified-local-protocol');
  assert.equal(output.characters[0].name,'LabHero');
  assert.equal(output.characters[0].level,80);
  assert.equal(output.characters[0].classId,1);
  assert.equal(Object.hasOwn(output.characters[0],'guid'),false);
  assert.equal(fake.sent.length,2);
  assert.equal(fake.readyState,3);
});

test('failed auth response never triggers character enumeration',async()=>{
  const fake=new WorldSocketFixture({badResponse:true});
  await assert.rejects(enumerateBrowserCharacters({username:ACCOUNT,sessionKey:K,realmId:1,
    locationRef:{hostname:'127.0.0.1',host:'127.0.0.1:8765',protocol:'http:'},
    socketFactory:()=>fake,cryptoRef}),/rejected/);
  assert.equal(fake.sent.length,1);
});

test('parser rejects truncation, excess characters, malformed metadata, extra bytes',()=>{
  assert.equal(parseCharacterList(Uint8Array.of(0)).length,0);
  const base=characterPayload();
  assert.equal(parseCharacterList(base)[0].name,'LabHero');
  assert.throws(()=>parseCharacterList(new Uint8Array(0)),/payload/);
  assert.throws(()=>parseCharacterList(Uint8Array.of(13)),/count/);
  assert.throws(()=>parseCharacterList(base.slice(0,-1)),/Truncated/);
  assert.throws(()=>parseCharacterList(concatBytes(base,Uint8Array.of(1))),/character list bytes/);
  const badRace=base.slice();badRace[1+8+8]=0;
  assert.throws(()=>parseCharacterList(badRace),/metadata/);
});

test('world client is loopback-only and requires a disposable verified SRP6 session',async()=>{
  assert.equal(localWorldBridgeUrl({hostname:'localhost',host:'localhost:8765',protocol:'http:'}),
    'ws://localhost:8765/ws/world');
  assert.throws(()=>localWorldBridgeUrl({hostname:'evil.test',host:'evil.test',protocol:'https:'}),/locally opened/);
  await assert.rejects(enumerateBrowserCharacters({username:'OTHER',sessionKey:K,realmId:1,
    locationRef:{hostname:'localhost',host:'localhost:8765',protocol:'http:'}}),/disposable/);
  assert.throws(()=>encodeClientWorldPacket(1,new Uint8Array(11000)),/Invalid/);
});

test('character view models keep synthetic examples unmistakably distinct',()=>{
  const demos=rosterViewModel(SAMPLE_CHARACTERS,{source:'demo'});
  assert.equal(demos.length,2);
  assert.equal(demos[0].source,'demo');assert.equal(demos[0].readOnly,true);
  assert.equal(rosterViewModel([{name:'<img src=x onerror=alert(1)>',level:17,race:1,classId:1}],
    {source:'verified-local-protocol'})[0].name,'<img src=x onerror=alert(1)>');
  assert.throws(()=>rosterViewModel(SAMPLE_CHARACTERS,{source:'live-gameplay'}),/roster/);
});
