"""Disposable, read-only Build 21 REAL authserver->worldserver acceptance.

Opt-in ONLY for an isolated, owned loopback Docker lab with authorized data.
No GM/character creation, client assets, world movement, or remote endpoints.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import socket
import subprocess
import time
from pathlib import Path

from .azerothcore_auth_probe import ProbeError, validate_target
from .azerothcore_real_lab import registration_sql, registration_values, removal_sql
from .azerothcore_world import WorldProtocolError
from .azerothcore_world_acceptance import run_acceptance, preflight_world
from .azerothcore_world_data_preflight import inspect_data_dir, DataPreflightError

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'lab' / 'azerothcore-auth.compose.yml'
WORLD = ROOT / 'lab' / 'azerothcore-world.compose.yml'
PROJECT = 'wotlk-world-lab-21'


def world_compose_args() -> list[str]:
    return ['docker', 'compose', '--project-name', PROJECT,
            '-f', str(BASE), '-f', str(WORLD)]


def compose_world_sql(sql: str, *, runner=subprocess.run) -> None:
    """Pipe SQL on stdin to the isolated Compose DB; never put secrets in argv."""
    if not BASE.is_file() or not WORLD.is_file():
        raise ProbeError('World lab Compose files missing')
    if not isinstance(sql, str) or not sql.endswith(';\n'):
        raise ProbeError('Invalid generated lab SQL')
    command = world_compose_args() + ['exec', '-T', 'ac-database', 'sh', '-c',
                                     'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root acore_auth']
    runner(command, input=sql, text=True, capture_output=True, check=True, timeout=25)


def wait_world_port(port: int, *, timeout: float = 240) -> None:
    validate_target('127.0.0.1', port)
    if not 1 <= timeout <= 600:
        raise ProbeError('Invalid worldserver startup timeout')
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                return
        except OSError:
            time.sleep(1)
    raise ProbeError('Owned local worldserver did not open port')


async def verify_disposable_world(*, realm_id: int = 1, auth_port: int = 3724,
                                  world_port: int = 8085,
                                  sql_writer=compose_world_sql) -> dict:
    validate_target('127.0.0.1', auth_port)
    validate_target('127.0.0.1', world_port)
    if isinstance(realm_id, bool) or not isinstance(realm_id, int) or not 1 <= realm_id <= 255:
        raise ProbeError('Invalid world realm')
    # No credentials or database changes before the world challenge preflight.
    if not await preflight_world(world_port=world_port):
        raise WorldProtocolError('Local world challenge not recognized')
    username = 'LAB' + secrets.token_hex(6).upper()
    password = secrets.token_hex(16).upper()
    salt, verifier = registration_values(username, password, secrets.token_bytes(32))
    registration_attempted = False
    try:
        # Cleanup is attempted even if an insert partly succeeds before raising.
        registration_attempted = True
        sql_writer(registration_sql(username, salt, verifier))
        result = await run_acceptance(account=username, password=password, realm_id=realm_id,
                                      auth_port=auth_port, world_port=world_port,
                                      preflight_verified=True)
        # No account names, character names, addresses, cryptographic values or paths.
        return {
            'real_worldserver_interop_passed': True,
            'world_challenge_format_valid': result.world_challenge_format_valid,
            'srp6_server_proof_verified': result.srp6_server_proof_verified,
            'advertised_realm_matched': result.advertised_realm_matched,
            'world_auth_response_ok': result.world_auth_response_ok,
            'character_list_received': result.character_list_received,
            'character_count': result.character_count,
            'nonempty_character_list': result.nonempty_character_list,
            'gameplay_verified': False,
            'server_identity_verified': False,
        }
    finally:
        if registration_attempted:
            # Do not suppress cleanup failures: they must fail the acceptance gate.
            sql_writer(removal_sql(username))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--realm-id', type=int, default=1)
    parser.add_argument('--auth-port', type=int, default=3724)
    parser.add_argument('--world-port', type=int, default=8085)
    parser.add_argument('--wait-seconds', type=float, default=240)
    args = parser.parse_args(argv)
    try:
        if not os.getenv('WOTLK_LAB_DB_PASSWORD'):
            raise ProbeError('Set the disposable lab database password')
        layout = inspect_data_dir(os.getenv('WOTLK_LAB_DATA_DIR', ''))
        if not layout['data_layout_ready']:
            raise DataPreflightError('Missing required local server data')
        validate_target('127.0.0.1', args.auth_port)
        validate_target('127.0.0.1', args.world_port)
        wait_world_port(args.world_port, timeout=args.wait_seconds)
        print(json.dumps(asyncio.run(verify_disposable_world(realm_id=args.realm_id,
                                         auth_port=args.auth_port, world_port=args.world_port)),
                         sort_keys=True))
    except (ProbeError, DataPreflightError, WorldProtocolError, OSError,
            subprocess.CalledProcessError, subprocess.TimeoutExpired,
            asyncio.TimeoutError, asyncio.IncompleteReadError, ValueError) as exc:
        # Fixed error type only. Never print input values or server replies.
        print(json.dumps({'real_worldserver_interop_passed': False,
                          'failure_type': type(exc).__name__, 'gameplay_verified': False}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
