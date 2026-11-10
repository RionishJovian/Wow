"""Read-only, one-shot WotLK world/character check against an owned loopback lab.

Requires a disposable local AzerothCore auth account and an independently
running local worldserver with appropriately licensed world data. Does not
create characters, log into the world, or save game credentials/keys.
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import json

from .azerothcore_auth_probe import ProbeError, validate_target
from .azerothcore_lab_login import authenticate_lab_session
from .azerothcore_srp6 import validate_identity
from .azerothcore_world import enumerate_world_characters, WorldProtocolError


async def run_lab(*, account: str, password: str, realm_id: int,
                  auth_port: int = 3724, world_port: int = 8085,
                  world_host: str = '127.0.0.1') -> dict:
    validate_target('127.0.0.1', auth_port)
    validate_target(world_host, world_port)
    account, _ = validate_identity(account, password)
    if not account.startswith('LAB'):
        raise ProbeError('Use only a disposable LAB-prefixed account')
    lab_session = await authenticate_lab_session(account, password,
                                                 host='127.0.0.1', port=auth_port)
    matching = [realm for realm in lab_session.realms if realm.realm_id == realm_id]
    if len(matching) != 1:
        raise WorldProtocolError('Requested realm must be uniquely advertised by authserver')
    realm = matching[0]
    if realm.locked or (realm.flags & 0x02) or realm.client_build not in (None,12340):
        raise WorldProtocolError('Selected realm is locked, offline or wrong client build')
    # Explicitly do not follow realm.address. The target must be the OWNED numeric loopback host.
    report = await enumerate_world_characters(account=account,
                                               session_key=lab_session.session_key,
                                               realm_id=realm_id, host=world_host,
                                               port=world_port)
    return {'srp6_server_proof_verified': True,
            'advertised_realm_id_matched': True,
            **report}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--account', required=True, help='Disposable LAB account')
    parser.add_argument('--realm-id', required=True, type=int)
    parser.add_argument('--auth-port', type=int, default=3724)
    parser.add_argument('--world-port', type=int, default=8085)
    parser.add_argument('--world-host', default='127.0.0.1', help='Numeric loopback IP only')
    args = parser.parse_args()
    try:
        password = getpass.getpass('Disposable LAB password (not echoed): ')
        report = asyncio.run(run_lab(account=args.account, password=password,
                        realm_id=args.realm_id, auth_port=args.auth_port,
                        world_port=args.world_port, world_host=args.world_host))
    except (ProbeError, OSError, asyncio.TimeoutError,
            asyncio.IncompleteReadError, ConnectionError) as exc:
        parser.exit(1, f'Local world protocol test did not pass: {type(exc).__name__}\n')
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
