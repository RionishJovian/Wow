"""One-shot, local-only WoW 3.3.5a authentication-challenge interoperability probe.

This tests a small PUBLICLY DOCUMENTED auth wire format (AzerothCore AuthSession.cpp).
It never sends a user account name, password, SRP6 proof, or game assets.
It must not be used against public/community realms or as a login system.
"""
from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import secrets
import struct
from dataclasses import asdict, dataclass

AUTH_LOGON_CHALLENGE = 0x00
BUILD = 12340
HEADER = b"\x00\x00"
DEFAULT_TIMEOUT = 2.0


class ProbeError(ValueError):
    """Unsafe target or invalid protocol message."""


def validate_target(host: str, port: int) -> None:
    """Only numeric loopback addresses; no DNS rebind or remote scanning."""
    try:
        address = ipaddress.ip_address(host)
    except ValueError as exc:
        raise ProbeError("Use a numeric loopback IP address, not a hostname") from exc
    if not address.is_loopback:
        raise ProbeError("Authentication probe only permits local loopback addresses")
    if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
        raise ProbeError("Invalid local TCP port")


def encode_logon_challenge(account: str) -> bytes:
    """Encode build-12340 WoW auth challenge, never an authentication proof.

    AzerothCore expects a little-endian payload size after cmd/error, with a
    fixed 30-byte body and one-byte account length. Version/platform/os and
    locale mirror the 3.3.5a wire convention, not a modern login API.
    """
    if not isinstance(account, str) or not 1 <= len(account) <= 16 or not (
        account.isascii() and account.isupper() and account.isalnum()
    ):
        raise ProbeError("Probe identifier must be 1-16 uppercase ASCII letters/digits")
    encoded = account.encode("ascii")
    payload = (
        b"WoW\x00" + bytes((3, 3, 5)) + struct.pack("<H", BUILD)
        + b"68x\x00" + b"niW\x00" + b"SUne"
        + struct.pack("<iI", 0, 0) + bytes((len(encoded),)) + encoded
    )
    assert len(payload) == 30 + len(encoded)
    return bytes((AUTH_LOGON_CHALLENGE, 0)) + struct.pack("<H", len(payload)) + payload


def interpret_challenge_reply(prefix: bytes) -> tuple[bool, str]:
    """Interpret only first 3 bytes; never parse / retain SRP6 server secrets."""
    if len(prefix) != 3 or prefix[:2] != HEADER:
        raise ProbeError("Not a 3.3.5a authentication challenge reply header")
    code = prefix[2]
    if code == 4:
        return True, "unknown-probe-account"
    if code == 0:
        return True, "challenge-accepted-no-login"
    # Other 3.3.5a codes can mean version mismatch, maintenance, ban, etc.
    # Without proof exchange, we cannot conclude the realm is usable.
    return True, f"auth-error-0x{code:02x}"


@dataclass(frozen=True)
class ProbeResult:
    target: str
    build: int
    transport_connected: bool
    challenge_reply_valid: bool
    observation: str
    authentication_completed: bool = False
    world_connected: bool = False
    gameplay_verified: bool = False


async def probe_authserver(host: str = "127.0.0.1", port: int = 3724,
                           timeout: float = DEFAULT_TIMEOUT) -> ProbeResult:
    validate_target(host, port)
    if not 0.05 <= timeout <= 5:
        raise ProbeError("Probe timeout must be between 0.05 and 5 seconds")

    target = f"{host}:{port}"
    writer = None
    transport_connected = False
    try:
        # Fresh ephemeral identifier: no existing account lookup or credential.
        # The auth server may log the name, so do not call repeatedly.
        fake_account = "LAB" + secrets.token_hex(5).upper()
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=timeout
        )
        transport_connected = True
        writer.write(encode_logon_challenge(fake_account))
        await asyncio.wait_for(writer.drain(), timeout=timeout)
        prefix = await asyncio.wait_for(reader.readexactly(3), timeout=timeout)
        _, note = interpret_challenge_reply(prefix)
        return ProbeResult(target, BUILD, True, True, note)
    except (OSError, EOFError, asyncio.TimeoutError, asyncio.IncompleteReadError):
        return ProbeResult(target, BUILD, transport_connected, False,
                           "invalid-or-absent-protocol-reply" if transport_connected
                           else "tcp-unreachable")
    except ProbeError:
        return ProbeResult(target, BUILD, transport_connected, False,
                           "invalid-or-absent-protocol-reply")
    finally:
        if writer:
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), timeout=timeout)
            except (OSError, asyncio.TimeoutError):
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="Numeric loopback IP only")
    parser.add_argument("--port", type=int, default=3724)
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    args = parser.parse_args()
    try:
        result = asyncio.run(probe_authserver(args.host, args.port, args.timeout))
    except ProbeError as exc:
        parser.error(str(exc))
    print(json.dumps(asdict(result), sort_keys=True))
    # Exit nonzero if no challenge reply; never equate valid reply with login.
    return 0 if result.challenge_reply_valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
