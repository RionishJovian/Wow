"""Local-only browser shell and byte-transparent WebSocket/TCP bridge.

The gateway does NOT implement World of Warcraft authentication, rendering,
asset handling or the client protocol. It is an optional transport for a
separate, lawful client runtime. Do not expose it to the public internet.
"""
from __future__ import annotations

import asyncio
import ipaddress
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, WebSocket
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketDisconnect

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
BUILD_VERSION = "0.2.0"
MAX_FRAME = 64 * 1024


def is_loopback(host: str) -> bool:
    """Fail closed: this opaque TCP bridge is strictly a loopback-only lab."""
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


@dataclass(frozen=True)
class Config:
    auth_host: str = "127.0.0.1"
    auth_port: int = 3724
    world_host: str = "127.0.0.1"
    world_port: int = 8085
    gateway_enabled: bool = False
    allowed_origins: tuple[str, ...] = (
        "http://127.0.0.1:8765",
        "http://localhost:8765",
    )
    max_connections: int = 20
    probe_timeout: float = 0.5
    connection_timeout: float = 2.0

    @classmethod
    def from_env(cls) -> "Config":
        raw_origins = os.getenv("WOTLK_ALLOWED_ORIGINS", "")
        return cls(
            auth_host=os.getenv("WOTLK_AUTH_HOST", "127.0.0.1"),
            auth_port=int(os.getenv("WOTLK_AUTH_PORT", "3724")),
            world_host=os.getenv("WOTLK_WORLD_HOST", "127.0.0.1"),
            world_port=int(os.getenv("WOTLK_WORLD_PORT", "8085")),
            gateway_enabled=os.getenv("WOTLK_ENABLE_GATEWAY", "false").lower() == "true",
            allowed_origins=tuple(x.strip() for x in raw_origins.split(",") if x.strip())
            if raw_origins else cls.allowed_origins,
            max_connections=int(os.getenv("WOTLK_MAX_CONNECTIONS", "20")),
        )


def create_app(config: Config | None = None) -> FastAPI:
    config = config or Config.from_env()
    app = FastAPI(title="WotLK Mobile Browser Lab", docs_url=None, redoc_url=None)
    live_connections = 0
    connection_lock = asyncio.Lock()

    @app.middleware("http")
    async def security_headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else "max-age=300"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data:; script-src 'self'; "
            "style-src 'self'; connect-src 'self' ws: wss:; "
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        )
        return response

    @app.get("/api/health")
    async def health():
        return {
            "gateway": "running",
            "version": BUILD_VERSION,
            "client_runtime": "not_installed",
            "gameplay_ready": False,
            "transport_enabled": config.gateway_enabled,
            "scope": "development_only",
        }

    async def probe(host: str, port: int) -> bool:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=config.probe_timeout
            )
            writer.close()
            await writer.wait_closed()
            return True
        except (OSError, asyncio.TimeoutError):
            return False

    @app.get("/api/realm-status")
    async def realm_status():
        auth, world = await asyncio.gather(
            probe(config.auth_host, config.auth_port),
            probe(config.world_host, config.world_port),
        )
        return {
            "auth_tcp": "reachable" if auth else "unreachable",
            "world_tcp": "reachable" if world else "unreachable",
            "interpretation": "Transport probes only; not an in-game realm status check.",
            "players_online": None,
        }

    @app.websocket("/ws/{service}")
    async def stream(ws: WebSocket, service: str):
        nonlocal live_connections
        if service not in {"auth", "world"} or not config.gateway_enabled:
            await ws.close(code=1008, reason="Gateway not enabled")
            return
        # Origin is browser-controlled, but non-browser clients can spoof it.
        # Enforce BOTH loopback peer address and loopback upstreams; do not
        # mistake an Origin allowlist for a production authentication system.
        if not (ws.client and is_loopback(ws.client.host)
                and is_loopback(config.auth_host) and is_loopback(config.world_host)):
            await ws.close(code=1008, reason="Local-only bridge")
            return
        origin = ws.headers.get("origin", "")
        if origin not in config.allowed_origins:
            await ws.close(code=1008, reason="Unapproved origin")
            return
        # Prevent this application from becoming an unauthenticated open TCP proxy.
        # The endpoint host is fixed in server config, never supplied by browser.
        async with connection_lock:
            if live_connections >= config.max_connections:
                await ws.close(code=1013, reason="Connection limit")
                return
            live_connections += 1

        upstream_writer = None
        try:
            host, port = (
                (config.auth_host, config.auth_port) if service == "auth"
                else (config.world_host, config.world_port)
            )
            try:
                upstream_reader, upstream_writer = await asyncio.wait_for(
                    asyncio.open_connection(host, port), timeout=config.connection_timeout
                )
            except (OSError, asyncio.TimeoutError):
                await ws.close(code=1013, reason="Upstream not available")
                return
            await ws.accept()

            async def browser_to_tcp():
                while True:
                    message = await ws.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    data = message.get("bytes")
                    if data is None or len(data) > MAX_FRAME:
                        await ws.close(code=1003 if data is None else 1009)
                        return
                    upstream_writer.write(data)
                    await upstream_writer.drain()

            async def tcp_to_browser():
                while True:
                    data = await upstream_reader.read(MAX_FRAME)
                    if not data:
                        return
                    await ws.send_bytes(data)

            tasks = [
                asyncio.create_task(browser_to_tcp()),
                asyncio.create_task(tcp_to_browser()),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                try:
                    task.result()
                except (WebSocketDisconnect, RuntimeError, OSError, ConnectionError):
                    pass
            try:
                await ws.close()
            except (WebSocketDisconnect, RuntimeError, OSError):
                pass
        finally:
            if upstream_writer:
                upstream_writer.close()
                try:
                    await asyncio.wait_for(upstream_writer.wait_closed(), timeout=1)
                except (OSError, asyncio.TimeoutError):
                    pass
            async with connection_lock:
                live_connections -= 1

    @app.get("/")
    async def index():
        return FileResponse(WEB / "index.html")

    app.mount("/assets", StaticFiles(directory=WEB), name="assets")
    return app


app = create_app()
