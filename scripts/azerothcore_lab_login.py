"""One-shot SRP6 + realm-list integration for an OWNED loopback AzerothCore authserver.

This CLI is intentionally opt-in and never accepts a password argument or
prints any proof/session key. No network traffic reaches a remote host.
This lab has no worldserver or in-game character handling.
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import struct
from dataclasses import dataclass, field

from .azerothcore_auth_probe import ProbeError, encode_logon_challenge, validate_target
from .azerothcore_realm_list import MAX_REPLY, REALM_LIST_REQUEST, parse_realm_list
from .azerothcore_srp6 import (create_client_proof, parse_server_challenge,
                              validate_identity, verify_server_proof)


@dataclass(frozen=True)
class LabSession:
    """Private, in-memory login outcome. Never serialize or log session_key."""
    realms: list
    session_key: bytes = field(repr=False)


async def authenticate_lab_session(account: str, password: str, *,
                                       host: str = "127.0.0.1", port: int = 3724,
                                       timeout: float = 3.0) -> LabSession:
    validate_target(host, port)
    account, _ = validate_identity(account, password)
    if not 0.2 <= timeout <= 5.0:
        raise ProbeError("Timeout must be between 0.2 and 5 seconds")
    reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
    try:
        writer.write(encode_logon_challenge(account))
        await asyncio.wait_for(writer.drain(), timeout)
        prefix = await asyncio.wait_for(reader.readexactly(3), timeout)
        if prefix != b"\x00\x00\x00":
            # Do not fetch SRP payload if account/build was refused.
            raise ProbeError("Server refused account or build in auth challenge")
        # Standard AzerothCore no-second-factor challenge is 119 bytes total.
        challenge = parse_server_challenge(prefix + await asyncio.wait_for(reader.readexactly(116), timeout))
        proof = create_client_proof(account, password, challenge)
        writer.write(proof.packet)
        await asyncio.wait_for(writer.drain(), timeout)
        response_header = await asyncio.wait_for(reader.readexactly(2), timeout)
        if response_header != b"\x01\x00":
            raise ProbeError("Server rejected SRP6 proof")
        server_proof = response_header + await asyncio.wait_for(reader.readexactly(30), timeout)
        verify_server_proof(server_proof, proof.expected_M2)
        writer.write(REALM_LIST_REQUEST)
        await asyncio.wait_for(writer.drain(), timeout)
        frame = await asyncio.wait_for(reader.readexactly(3), timeout)
        if frame[0] != 0x10:
            raise ProbeError("Invalid realm-list response")
        length = struct.unpack_from("<H", frame, 1)[0]
        if length < 8 or length > MAX_REPLY:
            raise ProbeError("Unexpected realm list response length")
        realms = parse_realm_list(frame + await asyncio.wait_for(reader.readexactly(length), timeout))
        # Session key is returned privately for the optional local world handshake.
        return LabSession(realms, proof.session_key)

    finally:
        writer.close()
        try:
            await asyncio.wait_for(writer.wait_closed(), 1)
        except (OSError, TimeoutError):
            pass



async def authenticate_and_list_realms(account: str, password: str, *,
                                       host: str = "127.0.0.1", port: int = 3724,
                                       timeout: float = 3.0) -> dict:
    """Existing sanitized API; deliberately omits the private session key."""
    lab = await authenticate_lab_session(account, password, host=host,
                                         port=port, timeout=timeout)
    return {
        "srp6_server_proof_verified": True,
        "realm_list_decoded": True,
        "realms": [{"id": r.realm_id, "name": r.name, "characters": r.characters,
                    "locked": r.locked, "build": r.client_build} for r in lab.realms],
        "world_connected": False,
        "gameplay_verified": False,
    }

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account", required=True, help="Your own disposable lab account, no password on command line")
    parser.add_argument("--host", default="127.0.0.1", help="Numeric loopback IP only")
    parser.add_argument("--port", type=int, default=3724)
    args = parser.parse_args()
    try:
        password = getpass.getpass("Lab account password (not echoed): ")
        report = asyncio.run(authenticate_and_list_realms(args.account, password, host=args.host, port=args.port))
    except (ProbeError, OSError, asyncio.TimeoutError, asyncio.IncompleteReadError) as exc:
        parser.exit(1, f"Local lab login failed: {type(exc).__name__}\n")
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
