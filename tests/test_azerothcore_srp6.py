"""Offline interoperability tests; no Blizzard assets, real accounts or public realms."""
from __future__ import annotations

import asyncio
import hashlib
import struct

import pytest

from scripts.azerothcore_auth_probe import ProbeError
from scripts.azerothcore_lab_login import authenticate_and_list_realms
from scripts.azerothcore_realm_list import REALM_LIST_REQUEST, parse_realm_list
from scripts.azerothcore_srp6 import (
    GENERATOR, MODULUS, N_BYTES, ServerChallenge, create_client_proof,
    parse_server_challenge, session_key_interleave, verify_server_proof,
)


def sha(*chunks: bytes) -> bytes:
    h = hashlib.sha1()
    for c in chunks:
        h.update(c)
    return h.digest()


def le(i: int) -> bytes:
    return i.to_bytes(32, 'little')


# Distinct test-side server implementation, not the client's proof builder.
# This models AzerothCore SRP6 server arithmetic with fixed lab inputs.
USER = 'LABUSER'
PASS = 'ONLY-FOR-OFFLINE-TESTS'
SALT = bytes(range(32))
B_SECRET = int.from_bytes(bytes(range(32, 0, -1)), 'little')
X = int.from_bytes(sha(SALT, sha(f'{USER}:{PASS}'.encode())), 'little')
VERIFIER = pow(GENERATOR, X, MODULUS)
SERVER_B = le((3 * VERIFIER + pow(GENERATOR, B_SECRET, MODULUS)) % MODULUS)


def sample_challenge(*, flags=0, modulus=N_BYTES, B=SERVER_B) -> bytes:
    return (b'\x00\x00\x00' + B + b'\x01\x07\x20' + modulus + SALT
            + bytes(range(16)) + bytes((flags,)))


def sample_realm(*, flags=0, name='Testing Realm', address='127.0.0.1:8085',
                 extra=b'') -> bytes:
    row = (bytes((1, 0, flags)) + name.encode() + b'\x00' + address.encode() + b'\x00'
           + struct.pack('<f', 0.25) + bytes((1, 1, 1)))
    if flags & 4:
        row += bytes((3, 3, 5)) + struct.pack('<H', 12340)
    content = b'\x00'*4 + struct.pack('<H', 1) + row + b'\x10\x00' + extra
    return b'\x10' + struct.pack('<H', len(content)) + content


def test_wire_group_matches_upstream_and_standard_challenge_parses():
    assert N_BYTES == bytes.fromhex('894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7')[::-1]
    parsed = parse_server_challenge(sample_challenge())
    assert parsed.B == SERVER_B and parsed.salt == SALT and parsed.security_flags == 0
    assert len(parsed.version_challenge) == 16


@pytest.mark.parametrize('wrong', [b'', b'\x00\x00\x00', b'\x01' * 119,
                                       sample_challenge(flags=4),
                                       sample_challenge(modulus=b'\x02' * 32),
                                       sample_challenge(B=b'\x00' * 32)])
def test_reject_nonstandard_or_unsafe_challenge(wrong):
    with pytest.raises(ProbeError):
        parse_server_challenge(wrong)


def test_srp6_client_proof_round_trip_against_independent_fake_server():
    challenge = parse_server_challenge(sample_challenge())
    proof = create_client_proof(USER, PASS, challenge, secret_a=bytes([9] * 32))
    assert len(proof.packet) == 75 and proof.packet[0] == 1
    assert proof.packet[53:73] == bytes(20) and proof.packet[73:75] == b'\x00\x00'
    A_bytes = proof.packet[1:33]
    A = int.from_bytes(A_bytes, 'little')
    u = int.from_bytes(sha(A_bytes, SERVER_B), 'little')
    server_S = le(pow(A * pow(VERIFIER, u, MODULUS) % MODULUS, B_SECRET, MODULUS))
    server_K = session_key_interleave(server_S)
    Ng = bytes(a ^ b for a, b in zip(sha(N_BYTES), sha(bytes([7]))))
    server_M = sha(Ng, sha(USER.encode()), SALT, A_bytes, SERVER_B, server_K)
    assert server_M == proof.packet[33:53]
    assert server_K == proof.session_key
    expected_server_M2 = sha(A_bytes, server_M, server_K)
    assert expected_server_M2 == proof.expected_M2
    verify_server_proof(b'\x01\x00' + expected_server_M2 + bytes(10), proof.expected_M2)
    with pytest.raises(ProbeError, match='mismatch'):
        verify_server_proof(b'\x01\x00' + bytes(30), proof.expected_M2)



def test_incorrect_password_cannot_match_servers_srp_proof():
    challenge = parse_server_challenge(sample_challenge())
    proof = create_client_proof(USER, 'WRONG-PASSWORD', challenge, secret_a=bytes([9] * 32))
    A_bytes = proof.packet[1:33]
    u = int.from_bytes(sha(A_bytes, SERVER_B), 'little')
    server_S = le(pow(int.from_bytes(A_bytes, 'little') * pow(VERIFIER, u, MODULUS) % MODULUS, B_SECRET, MODULUS))
    K = session_key_interleave(server_S)
    group = bytes(a ^ b for a, b in zip(sha(N_BYTES), sha(b'\x07')))
    correct_M1 = sha(group, sha(USER.encode()), SALT, A_bytes, SERVER_B, K)
    assert proof.packet[33:53] != correct_M1

def test_srp6_cannot_accept_fake_server_key_and_rejects_identity_errors():
    challenge = parse_server_challenge(sample_challenge())
    for bad in ['', 'NAME SPACE', 'éééé']:
        with pytest.raises(ProbeError):
            create_client_proof(bad, PASS, challenge)
    with pytest.raises(ProbeError):
        create_client_proof(USER, PASS, challenge, secret_a=bytes(32))
    with pytest.raises(ProbeError):
        verify_server_proof(b'\x01\x04', bytes(20))


def test_realm_list_decode_and_build_variants():
    items = parse_realm_list(sample_realm(flags=4))
    assert len(items) == 1
    realm = items[0]
    assert (realm.name, realm.address, realm.client_build, realm.characters) == ('Testing Realm', '127.0.0.1:8085', 12340, 1)
    assert parse_realm_list(sample_realm())[0].client_build is None


@pytest.mark.parametrize('bad', [b'', b'\x00\x00\x00', sample_realm(extra=b'\x05'),
                                sample_realm(name='B' * 300), sample_realm()[:-1],
                                sample_realm() + b'X'])
def test_fail_closed_on_unexpected_realm_frames(bad):
    with pytest.raises(ProbeError):
        parse_realm_list(bad)


@pytest.mark.asyncio
async def test_complete_srp6_realm_session_in_isolated_mock_server():
    observations = []

    async def fake_auth(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            header = await reader.readexactly(4)
            body = await reader.readexactly(int.from_bytes(header[2:4], 'little'))
            observations.append(('challenge', header + body))
            writer.write(sample_challenge())
            await writer.drain()
            proof_packet = await reader.readexactly(75)
            observations.append(('proof', len(proof_packet)))
            A_bytes = proof_packet[1:33]
            u = int.from_bytes(sha(A_bytes, SERVER_B), 'little')
            server_S = le(pow(int.from_bytes(A_bytes, 'little') * pow(VERIFIER, u, MODULUS) % MODULUS, B_SECRET, MODULUS))
            K = session_key_interleave(server_S)
            Ng = bytes(a ^ b for a, b in zip(sha(N_BYTES), sha(b'\x07')))
            server_M = sha(Ng, sha(USER.encode()), SALT, A_bytes, SERVER_B, K)
            assert server_M == proof_packet[33:53]
            writer.write(b'\x01\x00' + sha(A_bytes, server_M, K) + bytes(10))
            await writer.drain()
            realm_req = await reader.readexactly(5)
            observations.append(('realm-request', realm_req))
            writer.write(sample_realm(flags=4))
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    srv = await asyncio.start_server(fake_auth, '127.0.0.1', 0)
    try:
        result = await authenticate_and_list_realms(USER, PASS, port=srv.sockets[0].getsockname()[1])
        assert result['srp6_server_proof_verified']
        assert result['realms'][0]['build'] == 12340
        assert result['world_connected'] is False
        assert result['gameplay_verified'] is False
        assert observations[-1] == ('realm-request', REALM_LIST_REQUEST)
    finally:
        srv.close()
        await srv.wait_closed()


@pytest.mark.asyncio
async def test_reject_remote_authserver_before_contacting_it():
    with pytest.raises(ProbeError):
        await authenticate_and_list_realms(USER, PASS, host='8.8.8.8')
