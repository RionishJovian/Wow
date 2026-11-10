"""Asset-free 3.3.5a world handshake/character enumeration tests; no Blizzard files."""
import asyncio
import hashlib
import hmac
import struct
import zlib

import pytest

from scripts.azerothcore_world import (
    RC4, SERVER_ENCRYPTION, SERVER_DECRYPTION, SMSG_AUTH_CHALLENGE,
    CMSG_AUTH_SESSION, SMSG_AUTH_RESPONSE, CMSG_CHAR_ENUM, SMSG_CHAR_ENUM,
    WorldProtocolError, encode_client_packet, encode_server_packet,
    read_server_packet, parse_world_challenge, make_auth_session,
    header_ciphers, parse_char_enum, enumerate_world_characters,
)
from scripts.azerothcore_auth_probe import ProbeError

KEY = bytes(range(40))
SEED = b'\x12\x34\x56\x78'
CLIENT_SEED = b'\x98\x76\x54\x32'


def char_fixture():
    # AzerothCore's Player::BuildEnumData: GUID, name, race/class/gender,
    # 5 appearance bytes, level, zone/map, xyz, guild/flags/custom, first,
    # three pet fields, 23 item visuals (uint32 + uint8 + uint32 each).
    values = (1, 1, 0, 0, 0, 0, 0, 0, 30, 12, 571, 1.5, 2.5, 3.5,
              0, 0, 0, 0, 0, 0, 0)
    return b'\x01' + struct.pack('<Q', 0x1234) + b'LabHero\0' + struct.pack('<9BIIfffIII B III', *values) + bytes(23 * 9)


def test_arc4_legacy_reference_vector_and_chunking():
    assert RC4(b'Key', drop=0).apply(b'Plaintext').hex().upper() == 'BBF316E8D940AF0AD3'
    x = RC4(b'Key', drop=1024)
    y = RC4(b'Key', drop=1024)
    assert x.apply(b'hello world') == y.apply(b'he') + y.apply(b'llo') + y.apply(b' world')


def test_crypt_direction_and_first_packet_headers():
    outgoing, incoming = header_ciphers(KEY)
    assert outgoing.apply(bytes(8)) != incoming.apply(bytes(8))
    assert encode_client_packet(CMSG_CHAR_ENUM, b'') == b'\x00\x04\x37\x00\x00\x00'
    assert encode_server_packet(SMSG_CHAR_ENUM, b'\x00') == b'\x00\x03\x3b\x00\x00'
    # Compare against independently constructed HMAC key and ARC4 stream.
    assert header_ciphers(KEY)[0].apply(bytes(6)) == RC4(hmac.new(SERVER_DECRYPTION, KEY, hashlib.sha1).digest()).apply(bytes(6))
    assert header_ciphers(KEY)[1].apply(bytes(4)) == RC4(hmac.new(SERVER_ENCRYPTION, KEY, hashlib.sha1).digest()).apply(bytes(4))


def test_world_auth_session_digest_and_addon_zlib():
    challenge = struct.pack('<I', 1) + SEED + bytes(32)
    assert parse_world_challenge(SMSG_AUTH_CHALLENGE, challenge) == SEED
    packet = make_auth_session('LABUSER', KEY, 1, SEED, client_seed=CLIENT_SEED)
    assert struct.unpack_from('>H', packet)[0] == len(packet) - 2
    assert struct.unpack_from('<I', packet, 2)[0] == CMSG_AUTH_SESSION
    body = packet[6:]
    assert struct.unpack_from('<I', body)[0] == 12340
    assert body[8:16] == b'LABUSER\x00'
    pos = 16 + 4 + 4 + 4 + 4 + 4 + 8
    digest = hashlib.sha1(b'LABUSER' + bytes(4) + CLIENT_SEED + SEED + KEY).digest()
    assert body[pos:pos+20] == digest
    addon = body[pos+20:]
    assert struct.unpack_from('<I', addon)[0] == 4
    assert zlib.decompress(addon[4:]) == bytes(4)


def test_realistic_character_list():
    characters = parse_char_enum(char_fixture())
    assert len(characters) == 1
    assert characters[0].name == 'LabHero'
    assert characters[0].level == 30
    assert characters[0].map_id == 571
    assert parse_char_enum(b'\0') == []


@pytest.mark.parametrize('payload', [b'', b'\x01', b'\x0d', b'\x00\x00', char_fixture()[:-1], char_fixture()+b'Z',
                                    b'\x01' + bytes(8) + b'\xff\0' + bytes(400)])
def test_bad_character_frames_rejected(payload):
    with pytest.raises(WorldProtocolError):
        parse_char_enum(payload)


@pytest.mark.parametrize('opcode,payload', [
    (1, struct.pack('<I',1)+SEED+bytes(32)),
    (SMSG_AUTH_CHALLENGE, b''),
    (SMSG_AUTH_CHALLENGE, struct.pack('<I',2)+SEED+bytes(32))])
def test_bad_world_challenge_rejected(opcode,payload):
    with pytest.raises(WorldProtocolError):
        parse_world_challenge(opcode,payload)


@pytest.mark.parametrize('kwargs', [
    {'realm_id': 0}, {'realm_id': 256}, {'session_key': b'wrong'},
    {'server_seed': b'abc'}, {'client_seed': b'abc'}, {'account':'../BAD'}])
def test_auth_session_rejects_invalid_fields(kwargs):
    args={'account':'LABUSER','session_key':KEY,'realm_id':1,'server_seed':SEED,'client_seed':CLIENT_SEED}
    args.update(kwargs)
    with pytest.raises(WorldProtocolError): make_auth_session(**args)


@pytest.mark.asyncio
async def test_mock_world_session_and_character_enumeration():
    observed = []
    async def fake_world(reader, writer):
        try:
            challenge = struct.pack('<I',1)+SEED+bytes(32)
            packet = encode_server_packet(SMSG_AUTH_CHALLENGE,challenge)
            writer.write(packet[:2]);await writer.drain();await asyncio.sleep(.005)
            writer.write(packet[2:]);await writer.drain()
            header = await reader.readexactly(6)
            size = struct.unpack_from('>H',header)[0]
            body = await reader.readexactly(size-4)
            assert struct.unpack_from('<I',header,2)[0] == CMSG_AUTH_SESSION
            observed.append('auth')
            assert hashlib.sha1(b'LABUSER'+bytes(4)+body[20:24]+SEED+KEY).digest() in body
            writer_cipher = RC4(hmac.new(SERVER_ENCRYPTION,KEY,hashlib.sha1).digest())
            reader_cipher = RC4(hmac.new(SERVER_DECRYPTION,KEY,hashlib.sha1).digest())
            writer.write(encode_server_packet(SMSG_AUTH_RESPONSE,b'\x0c',writer_cipher))
            await writer.drain()
            decrypted_header = reader_cipher.apply(await reader.readexactly(6))
            assert decrypted_header == b'\x00\x04\x37\x00\x00\x00'
            observed.append('enumerate')
            writer.write(encode_server_packet(SMSG_CHAR_ENUM,char_fixture(),writer_cipher))
            await writer.drain()
        finally:
            writer.close();await writer.wait_closed()
    srv = await asyncio.start_server(fake_world,'127.0.0.1',0)
    try:
        result=await enumerate_world_characters(account='LABUSER',session_key=KEY,realm_id=1,
                                                 port=srv.sockets[0].getsockname()[1])
        assert result['world_authenticated']
        assert result['character_list_received']
        assert result['character_count'] == 1
        assert result['characters'][0]['name'] == 'LabHero'
        assert not result['gameplay_verified']
        assert observed == ['auth','enumerate']
        assert 'session_key' not in str(result)
    finally:
        srv.close();await srv.wait_closed()


@pytest.mark.asyncio
async def test_world_auth_failure_does_not_enumerate():
    requests = []
    async def fake_world(reader, writer):
        try:
            writer.write(encode_server_packet(SMSG_AUTH_CHALLENGE,struct.pack('<I',1)+SEED+bytes(32)))
            await writer.drain()
            header=await reader.readexactly(6)
            await reader.readexactly(struct.unpack_from('>H',header)[0]-4)
            requests.append('auth')
            cipher=RC4(hmac.new(SERVER_ENCRYPTION,KEY,hashlib.sha1).digest())
            writer.write(encode_server_packet(SMSG_AUTH_RESPONSE,b'\x0d',cipher))
            await writer.drain()
        finally:
            writer.close();await writer.wait_closed()
    srv=await asyncio.start_server(fake_world,'127.0.0.1',0)
    try:
        with pytest.raises(WorldProtocolError,match='rejected'):
            await enumerate_world_characters(account='LABUSER',session_key=KEY,realm_id=1,
                                              port=srv.sockets[0].getsockname()[1])
        assert requests == ['auth']
    finally:
        srv.close();await srv.wait_closed()


@pytest.mark.asyncio
async def test_world_never_connects_non_loopback():
    for host in ['8.8.8.8','10.0.0.1','localhost','example.org']:
        with pytest.raises(ProbeError):
            await enumerate_world_characters(account='LABUSER',session_key=KEY,
                                              realm_id=1,host=host)


@pytest.mark.asyncio
async def test_oversized_server_packet_rejected_before_payload_read():
    async def oversized(reader,writer):
        writer.write(b'\x80\x01\x01\x3b\x00')  # size 65537 exceeds limit
        await writer.drain()
        writer.close();await writer.wait_closed()
    srv=await asyncio.start_server(oversized,'127.0.0.1',0)
    try:
        reader,writer=await asyncio.open_connection('127.0.0.1',srv.sockets[0].getsockname()[1])
        # 0x010001 >65536
        with pytest.raises((asyncio.IncompleteReadError,WorldProtocolError)):
            await read_server_packet(reader,timeout=.2)
        writer.close();await writer.wait_closed()
    finally:
        srv.close();await srv.wait_closed()
