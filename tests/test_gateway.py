import asyncio
import socket
from contextlib import asynccontextmanager

import httpx
import pytest
import uvicorn
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from server.app import Config, create_app, is_loopback


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@asynccontextmanager
async def running_server(app, port):
    cfg = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(cfg)
    task = asyncio.create_task(server.serve())
    for _ in range(200):
        if server.started:
            break
        await asyncio.sleep(.01)
    assert server.started, "Server didn't start"
    try:
        yield
    finally:
        server.should_exit = True
        await task


@pytest.mark.asyncio
async def test_http_status_has_no_fake_gameplay_claim():
    port = free_port()
    async with running_server(create_app(Config()), port):
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}") as client:
            health = (await client.get("/api/health")).json()
            assert health["gameplay_ready"] is False
            assert health["client_runtime"] == "not_installed"
            assert health["transport_enabled"] is False
            status = (await client.get("/api/realm-status")).json()
            assert status["players_online"] is None
            assert status["interpretation"].startswith("Transport probes")
            response = await client.get("/")
            assert response.status_code == 200
            assert "MOBILE FIRST" in response.text
            assert response.headers["X-Content-Type-Options"] == "nosniff"


@pytest.mark.asyncio
async def test_local_proxy_binary_round_trip_and_origin_rejection():
    async def echo(reader, writer):
        try:
            while raw := await reader.read(1024):
                writer.write(raw)
                await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    upstream = await asyncio.start_server(echo, "127.0.0.1", 0)
    upstream_port = upstream.sockets[0].getsockname()[1]
    port = free_port()
    cfg = Config(auth_port=upstream_port, world_port=upstream_port,
                 gateway_enabled=True, allowed_origins=(f"http://127.0.0.1:{port}",))
    async with running_server(create_app(cfg), port):
        uri = f"ws://127.0.0.1:{port}/ws/auth"
        async with connect(uri, origin=f"http://127.0.0.1:{port}") as ws:
            await ws.send(b"\x00\xff\x01\x02")
            assert await asyncio.wait_for(ws.recv(), 2) == b"\x00\xff\x01\x02"
        with pytest.raises(InvalidStatus):
            async with connect(uri, origin="https://unapproved.example"):
                pass
    upstream.close()
    await upstream.wait_closed()


@pytest.mark.asyncio
async def test_disabled_bridge_is_not_open_proxy():
    port = free_port()
    async with running_server(create_app(Config()), port):
        with pytest.raises(InvalidStatus):
            async with connect(f"ws://127.0.0.1:{port}/ws/world", origin=f"http://127.0.0.1:{port}"):
                pass


def test_gateway_only_accepts_local_upstreams_and_loopback_addresses():
    assert is_loopback("127.0.0.1")
    assert is_loopback("::1")
    assert is_loopback("localhost")
    assert not is_loopback("example.org")
    assert not is_loopback("8.8.8.8")
    assert not is_loopback("192.168.0.20")
    assert not is_loopback("")
