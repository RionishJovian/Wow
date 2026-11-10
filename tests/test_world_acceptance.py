"""Build 20: fail-closed acceptance and one full in-memory dual-TCP-server test.

Both servers are SYNTHETIC; no real AzerothCore worldserver is claimed here.
No copyrighted game files, remote connections or persistent credentials.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import struct

import pytest

from scripts.azerothcore_auth_probe import ProbeError
from scripts.azerothcore_srp6 import GENERATOR, MODULUS, N_BYTES, session_key_interleave
from scripts.azerothcore_world import (
    AUTH_OK, CMSG_AUTH_SESSION, CMSG_CHAR_ENUM, RC4, SERVER_DECRYPTION,
    SERVER_ENCRYPTION, SMSG_AUTH_CHALLENGE, SMSG_AUTH_RESPONSE,
    SMSG_CHAR_ENUM, WorldProtocolError, encode_server_packet,
)
from scripts.azerothcore_world_probe import ChallengeObservation
import scripts.azerothcore_world_acceptance as acceptance

USER = 'LABTEST'
PASS = 'OFFLINE-FIXTURE-ONLY'
SALT = bytes(range(32))
SEED = b'\x10\x20\x30\x40'
B_SECRET = 0xC123456789ABCDEF


def sha(*chunks):
    d = hashlib.sha1()
    for c in chunks:
        d.update(c)
    return d.digest()


def le(n):
    return n.to_bytes(32, 'little')


def server_srp_parameters():
    x = int.from_bytes(sha(SALT, sha(f'{USER}:{PASS}'.encode('ascii'))), 'little')
    verifier = pow(GENERATOR, x, MODULUS)
    server_B = le((3 * verifier + pow(GENERATOR, B_SECRET, MODULUS)) % MODULUS)
    return verifier, server_B


def challenge_packet(server_B):
    return b'\x00\x00\x00' + server_B + b'\x01\x07\x20' + N_BYTES + SALT + bytes(16) + b'\x00'


def realm_packet(*, address='outside.invalid:9999', count=1):
    row = (b'\x01\x00\x04' + b'Owned Lab\x00' + address.encode('ascii') + b'\x00'
           + struct.pack('<f', 0.1) + bytes((1, count, 1))
           + bytes((3, 3, 5)) + struct.pack('<H', 12340))
    content = bytes(4) + struct.pack('<H', 1) + row + b'\x10\x00'
    return b'\x10' + struct.pack('<H', len(content)) + content


def character_payload():
    # Same 3.3.5a layout used by AzerothCore Player::BuildEnumData.
    body = struct.pack('<Q', 0xABC123) + b'LabKnight\x00'
    fixed = (1, 1, 0, 0, 0, 0, 0, 0, 23, 12, 571,
             1.5, 2.5, 3.5, 0, 0, 0, 0, 0, 0, 0)
    return b'\x01' + body + struct.pack('<9BIIfffIII B III', *fixed) + bytes(23 * 9)


@pytest.mark.parametrize('account,realm,host,port', [
    ('NORMAL', 1, '127.0.0.1', 8085),
    ('LAB', 1, '127.0.0.1', 8085),
    ('labtest', 1, '127.0.0.1', 8085),
    ('LABTEST', 0, '127.0.0.1', 8085),
    ('LABTEST', 256, '127.0.0.1', 8085),
    ('LABTEST', 1, 'example.com', 8085),
    ('LABTEST', 1, '192.0.2.1', 8085),
    ('LABTEST', 1, '127.0.0.1', 0),
])
def test_request_gate_refuses_untrusted_inputs(account, realm, host, port):
    with pytest.raises(ProbeError):
        acceptance.validate_request(account, realm, 3724, host, port)


@pytest.mark.asyncio
async def test_no_auth_attempt_before_valid_world_preflight(monkeypatch):
    calls = []
    async def probe(_host, _port):
        calls.append('probe')
        return ChallengeObservation(False, False, 'tcp-unreachable')
    async def auth(**_kwargs):
        calls.append('auth')
        raise AssertionError('must never authenticate when world preflight fails')
    monkeypatch.setattr(acceptance, 'observe_world_challenge', probe)
    monkeypatch.setattr(acceptance, 'run_lab', auth)
    with pytest.raises(WorldProtocolError, match='challenge'):
        await acceptance.run_acceptance(account=USER, password=PASS, realm_id=1)
    assert calls == ['probe']


@pytest.mark.asyncio
async def test_evidence_never_contains_character_names_or_session_keys(monkeypatch):
    async def probe(_host, _port):
        return ChallengeObservation(True, True, 'wotlk-world-challenge-shaped')
    async def auth(**kwargs):
        assert kwargs['world_host'] == '127.0.0.1'
        return dict(srp6_server_proof_verified=True, advertised_realm_id_matched=True,
                    world_authenticated=True, character_list_received=True,
                    character_count=1, characters=[{'name':'SecretName', 'guid':1234}],
                    session_key='DO-NOT-LOG', gameplay_verified=False)
    monkeypatch.setattr(acceptance, 'observe_world_challenge', probe)
    monkeypatch.setattr(acceptance, 'run_lab', auth)
    result = await acceptance.run_acceptance(account=USER, password=PASS, realm_id=1,
                                             require_character=True)
    summary = repr(result)
    assert result.character_count == 1
    assert not result.authenticated_server_identity_verified
    assert not result.gameplay_verified
    assert 'SecretName' not in summary
    assert 'DO-NOT-LOG' not in summary


@pytest.mark.asyncio
async def test_empty_roster_is_not_nonempty_character_acceptance(monkeypatch):
    async def probe(_host, _port):
        return ChallengeObservation(True, True, 'wotlk-world-challenge-shaped')
    async def auth(**_kwargs):
        return dict(srp6_server_proof_verified=True, advertised_realm_id_matched=True,
                    world_authenticated=True, character_list_received=True, character_count=0)
    monkeypatch.setattr(acceptance, 'observe_world_challenge', probe)
    monkeypatch.setattr(acceptance, 'run_lab', auth)
    with pytest.raises(WorldProtocolError, match='empty'):
        await acceptance.run_acceptance(account=USER,password=PASS,realm_id=1,
                                        require_character=True)
    report = await acceptance.run_acceptance(account=USER,password=PASS,realm_id=1)
    assert report.character_list_received
    assert report.character_count == 0
    assert not report.nonempty_character_list


@pytest.mark.asyncio
async def test_offline_two_service_srp6_world_and_character_enumeration():
    """Actual TCP frames through both clients, but both servers are mocks."""
    verifier, server_B = server_srp_parameters()
    session_key = None
    observed = []
    errors = []

    async def fake_auth(reader, writer):
        nonlocal session_key
        try:
            header = await reader.readexactly(4)
            account_body = await reader.readexactly(int.from_bytes(header[2:], 'little'))
            assert account_body.endswith(bytes((len(USER),)) + USER.encode('ascii'))
            writer.write(challenge_packet(server_B))
            await writer.drain()
            proof = await reader.readexactly(75)
            assert proof[0] == 1
            A = proof[1:33]
            u = int.from_bytes(sha(A, server_B), 'little')
            S = le(pow((int.from_bytes(A, 'little') * pow(verifier, u, MODULUS)) % MODULUS,
                       B_SECRET, MODULUS))
            key = session_key_interleave(S)
            xor = bytes(a ^ b for a,b in zip(sha(N_BYTES), sha(b'\x07')))
            m1 = sha(xor, sha(USER.encode('ascii')), SALT, A, server_B, key)
            assert hmac.compare_digest(m1, proof[33:53])
            session_key = key
            writer.write(b'\x01\x00' + sha(A, m1, key) + bytes(10))
            await writer.drain()
            assert await reader.readexactly(5) == b'\x10\x00\x00\x00\x00'
            writer.write(realm_packet())
            await writer.drain()
            observed.append('srp6-m2-and-realm')
        except Exception as exc:
            errors.append(type(exc).__name__)
        finally:
            writer.close()
            await writer.wait_closed()

    async def fake_world(reader, writer):
        try:
            writer.write(encode_server_packet(SMSG_AUTH_CHALLENGE,
                                              struct.pack('<I',1) + SEED + bytes(32)))
            await writer.drain()
            try:
                header = await reader.readexactly(6)
            except asyncio.IncompleteReadError:
                observed.append('uncredentialed-preflight')
                return
            length = int.from_bytes(header[:2], 'big')
            assert int.from_bytes(header[2:6], 'little') == CMSG_AUTH_SESSION
            body = await reader.readexactly(length - 4)
            assert struct.unpack_from('<I', body)[0] == 12340
            end = body.index(b'\0', 8)
            assert body[8:end] == USER.encode('ascii')
            position = end + 1
            client_seed = body[position+4:position+8]
            realm_id = struct.unpack_from('<I',body,position+16)[0]
            assert realm_id == 1
            digest = body[position+28:position+48]
            assert session_key is not None
            assert digest == sha(USER.encode('ascii'), bytes(4), client_seed, SEED, session_key)
            outgoing_key = hmac.new(SERVER_ENCRYPTION, session_key, hashlib.sha1).digest()
            incoming_key = hmac.new(SERVER_DECRYPTION, session_key, hashlib.sha1).digest()
            outgoing = RC4(outgoing_key)
            incoming = RC4(incoming_key)
            writer.write(encode_server_packet(SMSG_AUTH_RESPONSE, bytes((AUTH_OK,)), outgoing))
            await writer.drain()
            request = incoming.apply(await reader.readexactly(6))
            assert request == b'\x00\x04\x37\x00\x00\x00'
            writer.write(encode_server_packet(SMSG_CHAR_ENUM, character_payload(), outgoing))
            await writer.drain()
            observed.append('authenticated-character-enum')
        except Exception as exc:
            errors.append(type(exc).__name__)
        finally:
            writer.close()
            await writer.wait_closed()

    auth = await asyncio.start_server(fake_auth, '127.0.0.1', 0)
    world = await asyncio.start_server(fake_world, '127.0.0.1', 0)
    try:
        report = await acceptance.run_acceptance(
            account=USER, password=PASS, realm_id=1,
            auth_port=auth.sockets[0].getsockname()[1],
            world_port=world.sockets[0].getsockname()[1],
            require_character=True)
        assert report.nonempty_character_list
        assert report.character_count == 1
        assert not report.gameplay_verified
        assert not report.authenticated_server_identity_verified
        assert observed == ['uncredentialed-preflight', 'srp6-m2-and-realm',
                            'authenticated-character-enum']
        assert not errors, errors
    finally:
        auth.close();world.close()
        await auth.wait_closed();await world.wait_closed()


def test_cli_preflight_failure_does_not_prompt_or_attempt_auth(monkeypatch, capsys):
    async def invalid(**_kwargs):
        return False
    def password_prompt(_message):
        raise AssertionError('password prompt occurred before world preflight')
    monkeypatch.setattr(acceptance, 'preflight_world', invalid)
    monkeypatch.setattr(acceptance.getpass, 'getpass', password_prompt)
    assert acceptance.main(['--account',USER,'--realm-id','1']) == 1
    captured = capsys.readouterr()
    assert captured.out == ''
    assert 'world-preflight' in captured.err
    assert PASS not in captured.err


@pytest.mark.asyncio
async def test_acceptance_rejects_incomplete_auth_evidence(monkeypatch):
    async def probe(_host, _port):
        return ChallengeObservation(True, True, 'wotlk-world-challenge-shaped')
    async def incomplete(**_kwargs):
        return dict(srp6_server_proof_verified=True, advertised_realm_id_matched=True,
                    world_authenticated=False, character_list_received=True, character_count=1)
    monkeypatch.setattr(acceptance, 'observe_world_challenge', probe)
    monkeypatch.setattr(acceptance, 'run_lab', incomplete)
    with pytest.raises(WorldProtocolError, match='not confirmed'):
        await acceptance.run_acceptance(account=USER,password=PASS,realm_id=1)
