"""Asset-free local simulation of the upstream 3.3.5a auth challenge transport."""
import asyncio
import struct

import pytest

from scripts.azerothcore_auth_probe import (
    BUILD, ProbeError, encode_logon_challenge, interpret_challenge_reply,
    probe_authserver, validate_target,
)


def test_packet_matches_azerothcore_logon_challenge_layout():
    packet = encode_logon_challenge("LAB0123")
    assert packet[:2] == b"\x00\x00"
    assert struct.unpack_from("<H", packet, 2)[0] == len(packet) - 4
    assert packet[4:8] == b"WoW\x00"
    assert packet[8:11] == bytes((3, 3, 5))
    assert struct.unpack_from("<H", packet, 11)[0] == BUILD
    assert packet[13:17] == b"68x\x00"
    assert packet[17:21] == b"niW\x00"
    assert packet[21:25] == b"SUne"
    assert packet[33] == 7
    assert packet[34:] == b"LAB0123"


@pytest.mark.parametrize("account", ["", "alice", "a" * 18, "A B", "!", "é", 23])
def test_reject_account_names_that_are_not_safe_probe_identifiers(account):
    with pytest.raises(ProbeError):
        encode_logon_challenge(account)


@pytest.mark.parametrize("host", ["localhost", "example.com", "0.0.0.0", "10.0.0.1",
                                        "192.168.1.1", "::", "8.8.8.8"])
def test_never_probe_non_loopback_and_dns(host):
    with pytest.raises(ProbeError):
        validate_target(host, 3724)


def test_accept_numeric_v4_and_v6_loopback_and_good_port():
    validate_target("127.0.0.1", 3724)
    validate_target("::1", 3724)
    for port in (0, 65536, True):
        with pytest.raises(ProbeError):
            validate_target("127.0.0.1", port)


@pytest.mark.parametrize("reply,expected", [
    (b"\x00\x00\x04", "unknown-probe-account"),
    (b"\x00\x00\x00", "challenge-accepted-no-login"),
    (b"\x00\x00\x09", "auth-error-0x09"),
])
def test_interpret_reply_and_never_accept_credential_login(reply, expected):
    recognized, code = interpret_challenge_reply(reply)
    assert recognized and code == expected


@pytest.mark.parametrize("invalid", [b"", b"\x00", b"\x01\x00\x04", b"\x00\xff\x04", b"\x00\x00\x04\x00"])
def test_reject_wrong_auth_response_header(invalid):
    with pytest.raises(ProbeError):
        interpret_challenge_reply(invalid)


@pytest.mark.asyncio
async def test_one_shot_challenge_round_trip_never_proves_gameplay():
    requests = []
    async def fake_auth(reader, writer):
        try:
            header = await reader.readexactly(4)
            length = struct.unpack_from("<H", header, 2)[0]
            requests.append(header + await reader.readexactly(length))
            writer.write(b"\x00\x00\x04")  # WotLK unknown account
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()
    srv = await asyncio.start_server(fake_auth, "127.0.0.1", 0)
    try:
        port = srv.sockets[0].getsockname()[1]
        result = await probe_authserver("127.0.0.1", port)
        assert result.challenge_reply_valid is True
        assert result.observation == "unknown-probe-account"
        assert result.transport_connected is True
        assert result.authentication_completed is False
        assert result.world_connected is False
        assert result.gameplay_verified is False
        assert len(requests) == 1
        assert requests[0][4:8] == b"WoW\x00"
        assert b"LAB" in requests[0]
    finally:
        srv.close()
        await srv.wait_closed()


@pytest.mark.asyncio
async def test_non_protocol_server_not_mistaken_for_authserver():
    async def wrong(reader, writer):
        await reader.read(64)
        writer.write(b"OK!")
        await writer.drain()
        writer.close()
        await writer.wait_closed()
    srv = await asyncio.start_server(wrong, "127.0.0.1", 0)
    try:
        result = await probe_authserver("127.0.0.1", srv.sockets[0].getsockname()[1])
        assert result.transport_connected and not result.challenge_reply_valid
        assert not result.gameplay_verified
    finally:
        srv.close()
        await srv.wait_closed()


@pytest.mark.asyncio
async def test_closed_local_port_reports_unavailable():
    srv = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 0)
    port = srv.sockets[0].getsockname()[1]
    srv.close()
    await srv.wait_closed()
    result = await probe_authserver("127.0.0.1", port, .1)
    assert result.observation == "tcp-unreachable"
    assert not result.challenge_reply_valid
