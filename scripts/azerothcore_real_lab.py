"""One-shot, disposable account interoperability check against OWNED local AzerothCore.

The database is only reached through `docker compose exec` inside a dedicated
non-public lab. This never handles real account credentials or game assets.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import secrets
import socket
import subprocess
import time
from pathlib import Path

from .azerothcore_auth_probe import ProbeError, validate_target
from .azerothcore_lab_login import authenticate_and_list_realms
from .azerothcore_srp6 import GENERATOR, MODULUS, validate_identity

ROOT = Path(__file__).resolve().parents[1]
COMPOSE_FILE = ROOT / "lab" / "azerothcore-auth.compose.yml"


def registration_values(username: str, password: str, salt: bytes) -> tuple[bytes, bytes]:
    """AzerothCore account salt/verifier, independently checked with SRP6 fixtures."""
    username, password = validate_identity(username, password)
    if not isinstance(salt, bytes) or len(salt) != 32:
        raise ProbeError("Lab registration requires a 32-byte random salt")
    identity = hashlib.sha1(f"{username}:{password}".encode("ascii")).digest()
    x = int.from_bytes(hashlib.sha1(salt + identity).digest(), "little")
    verifier = pow(GENERATOR, x, MODULUS).to_bytes(32, "little")
    return salt, verifier


def registration_sql(username: str, salt: bytes, verifier: bytes) -> str:
    username, _ = validate_identity(username, "DUMMY")
    if not isinstance(salt, bytes) or len(salt) != 32 or not isinstance(verifier, bytes) or len(verifier) != 32:
        raise ProbeError("Invalid lab account verifier or salt")
    return (
        "INSERT INTO account (username, salt, verifier, expansion, reg_mail, email, joindate) "
        f"VALUES ('{username}', X'{salt.hex()}', X'{verifier.hex()}', 2, '', '', NOW());\n"
    )


def removal_sql(username: str) -> str:
    username, _ = validate_identity(username, "DUMMY")
    if not username.startswith("LAB") or len(username) < 10:
        raise ProbeError("Refusing to remove a non-disposable account")
    return f"DELETE FROM account WHERE username = '{username}';\n"


def compose_database_sql(sql: str, *, compose_file: Path = COMPOSE_FILE,
                         runner=subprocess.run) -> None:
    # No passwords, SQL, or secrets appear in the command-line arguments.
    if not compose_file.is_file():
        raise ProbeError("Dedicated lab Compose file missing")
    argv = [
        "docker", "compose", "-f", str(compose_file), "exec", "-T",
        "ac-database", "sh", "-c",
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root acore_auth',
    ]
    runner(argv, input=sql, text=True, check=True, capture_output=True, timeout=25)


def wait_local_port(port: int, *, wait_seconds: float = 120) -> None:
    validate_target("127.0.0.1", port)
    if not 0 < wait_seconds <= 600:
        raise ProbeError("Invalid startup wait interval")
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return
        except OSError:
            time.sleep(1)
    raise ProbeError("Local authserver did not open its TCP port")


async def verify_disposable_login(*, port: int = 3724,
                                  sql_writer=compose_database_sql) -> dict:
    validate_target("127.0.0.1", port)
    username = "LAB" + secrets.token_hex(6).upper()
    password = secrets.token_hex(16).upper()
    salt, verifier = registration_values(username, password, secrets.token_bytes(32))
    registered = False
    try:
        sql_writer(registration_sql(username, salt, verifier))
        registered = True
        report = await authenticate_and_list_realms(username, password, port=port, timeout=5)
        if not report.get("srp6_server_proof_verified") or not report.get("realm_list_decoded"):
            raise ProbeError("Local real authserver proof or realm list did not verify")
        return {
            "real_authserver_login_verified": True,
            "srp6_server_proof_verified": True,
            "realm_list_decoded": True,
            "realm_count": len(report.get("realms", ())),
            "world_connected": False,
            "gameplay_verified": False,
            "client_assets_required": False,
        }
    finally:
        # Remove only the generated LAB* account. No user accounts are touched.
        if registered:
            sql_writer(removal_sql(username))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=3724)
    parser.add_argument("--wait-seconds", type=float, default=120)
    args = parser.parse_args()
    try:
        if not os.getenv("WOTLK_LAB_DB_PASSWORD"):
            raise ProbeError("Set WOTLK_LAB_DB_PASSWORD for the disposable Compose lab")
        wait_local_port(args.port, wait_seconds=args.wait_seconds)
        print(json.dumps(asyncio.run(verify_disposable_login(port=args.port)), sort_keys=True))
    except (ProbeError, OSError, subprocess.CalledProcessError,
            subprocess.TimeoutExpired, asyncio.TimeoutError,
            asyncio.IncompleteReadError) as exc:
        parser.exit(1, f"Local AzerothCore integration did not pass: {type(exc).__name__}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
