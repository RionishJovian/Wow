"""Protocol-only fake-server transport checks. NEVER claimed as live AzerothCore."""
import asyncio
import pytest

from scripts.azerothcore_auth_probe import ProbeError
from scripts.azerothcore_world import SMSG_AUTH_CHALLENGE, encode_server_packet
from scripts.azerothcore_world_probe import observe_world_challenge


@pytest.mark.asyncio
async def test_fragmented_40_byte_challenge_is_recognized_but_never_claims_login():
    async def fake(reader, writer):
        frame = encode_server_packet(SMSG_AUTH_CHALLENGE, b'\x01\0\0\0' + b'abcd' + b'q'*32)
        for part in (frame[:2], frame[2:8], frame[8:]):
            writer.write(part)
            await writer.drain()
            await asyncio.sleep(.002)
        # No client credentials or packets are transmitted by the probe.
        assert await reader.read() == b''
        writer.close()
        await writer.wait_closed()
    server = await asyncio.start_server(fake, '127.0.0.1', 0)
    try:
        result = await observe_world_challenge('127.0.0.1', server.sockets[0].getsockname()[1])
        assert result.world_challenge_format_valid
        assert result.transport_connected
        assert not result.build_confirmed
        assert not result.authenticated
        assert not result.characters_received
        assert not result.gameplay_verified
        assert 'abcd' not in repr(result)
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
@pytest.mark.parametrize('opcode,payload', [
    (0x1ee, b'\x01\0\0\0' + b'abcd' + b'q'*32),
    (0x1ec, b'\0'*40),
    (0x1ec, b'\x01\0\0\0' + b'abcd' + b'q'*31),
])
async def test_unexpected_challenge_fails_closed(opcode,payload):
    async def fake(_reader, writer):
        writer.write(encode_server_packet(opcode,payload))
        await writer.drain()
        writer.close()
        await writer.wait_closed()
    server=await asyncio.start_server(fake, '127.0.0.1', 0)
    try:
        result=await observe_world_challenge('127.0.0.1', server.sockets[0].getsockname()[1])
        assert result.transport_connected and not result.world_challenge_format_valid
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_not_a_game_server_is_not_treated_as_compatibility():
    async def fake(_reader,writer):
        writer.write(b'HTTP/1.1 200 OK\r\n')
        await writer.drain()
        writer.close()
    server=await asyncio.start_server(fake, '127.0.0.1', 0)
    try:
        result=await observe_world_challenge('127.0.0.1',server.sockets[0].getsockname()[1],timeout=.5)
        assert not result.world_challenge_format_valid
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_rejects_non_loopback_and_unbounded_timeout():
    with pytest.raises(ProbeError):
        await observe_world_challenge('192.0.2.1', 8085)
    with pytest.raises(ProbeError):
        await observe_world_challenge('127.0.0.1', 8085, timeout=999)
