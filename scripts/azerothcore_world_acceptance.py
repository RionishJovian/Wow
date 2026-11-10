"""One-shot, read-only WotLK authserver -> worldserver acceptance on owned loopback.

No account creation, character mutation, game assets, or remote networking.
The legacy SHA-1/ARC4 protocol is experimental, not audited or production-safe.
The challenge preflight is protocol-shape evidence, NOT server identity.
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import re
import sys
from dataclasses import asdict, dataclass

from .azerothcore_auth_probe import ProbeError, validate_target
from .azerothcore_srp6 import validate_identity
from .azerothcore_world import WorldProtocolError
from .azerothcore_world_lab import run_lab
from .azerothcore_world_probe import observe_world_challenge


@dataclass(frozen=True)
class AcceptanceEvidence:
    evidence_scope: str
    world_challenge_format_valid: bool
    srp6_server_proof_verified: bool
    advertised_realm_matched: bool
    world_auth_response_ok: bool
    character_list_received: bool
    character_count: int
    nonempty_character_list: bool
    authenticated_server_identity_verified: bool = False
    gameplay_verified: bool = False


def validate_request(account: str, realm_id: int, auth_port: int,
                     world_host: str, world_port: int) -> None:
    """Reject unapproved targets and non-disposable accounts before any I/O."""
    if not isinstance(account, str) or not re.fullmatch(r'LAB[A-Z0-9]{1,13}', account, flags=re.ASCII):
        raise ProbeError('Use a disposable LAB-prefixed uppercase account (4-16 characters)')
    if isinstance(realm_id, bool) or not isinstance(realm_id, int) or not 1 <= realm_id <= 255:
        raise ProbeError('Realm ID must be 1-255')
    validate_target('127.0.0.1', auth_port)
    validate_target(world_host, world_port)


async def preflight_world(*, world_host: str = '127.0.0.1',
                          world_port: int = 8085) -> bool:
    """Read only an initial challenge before prompting for a password."""
    observation = await observe_world_challenge(world_host, world_port)
    return observation.world_challenge_format_valid is True


async def run_acceptance(*, account: str, password: str, realm_id: int,
                         auth_port: int = 3724, world_host: str = '127.0.0.1',
                         world_port: int = 8085, require_character: bool = False,
                         preflight_verified: bool = False) -> AcceptanceEvidence:
    validate_request(account, realm_id, auth_port, world_host, world_port)
    # Never put arbitrary account passwords or keys in error output.
    validate_identity(account, password)
    if not preflight_verified and not await preflight_world(world_host=world_host, world_port=world_port):
        raise WorldProtocolError('No compatible local worldserver challenge')
    result = await run_lab(account=account, password=password, realm_id=realm_id,
                           auth_port=auth_port, world_host=world_host, world_port=world_port)
    gates = ('srp6_server_proof_verified', 'advertised_realm_id_matched',
             'world_authenticated', 'character_list_received')
    if any(result.get(key) is not True for key in gates):
        raise WorldProtocolError('Full read-only world acceptance not confirmed')
    count = result.get('character_count')
    if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= 12:
        raise WorldProtocolError('Invalid character count in acceptance result')
    if require_character and count == 0:
        raise WorldProtocolError('World returned an empty character roster')
    return AcceptanceEvidence(
        evidence_scope='owned-loopback-protocol-exchange',
        world_challenge_format_valid=True,
        srp6_server_proof_verified=True,
        advertised_realm_matched=True,
        world_auth_response_ok=True,
        character_list_received=True,
        character_count=count,
        nonempty_character_list=count > 0,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--account', required=True, help='Disposable LAB-prefixed test account')
    parser.add_argument('--realm-id', type=int, required=True, help='ID advertised by local authserver')
    parser.add_argument('--auth-port', type=int, default=3724)
    parser.add_argument('--world-host', default='127.0.0.1', help='Numeric loopback IP only')
    parser.add_argument('--world-port', type=int, default=8085)
    parser.add_argument('--require-character', action='store_true',
                        help='Fail unless at least one authorized test character is enumerated')
    args = parser.parse_args(argv)
    try:
        validate_request(args.account, args.realm_id, args.auth_port,
                         args.world_host, args.world_port)
        # No password entered until a valid-looking world challenge is observed.
        if not asyncio.run(preflight_world(world_host=args.world_host, world_port=args.world_port)):
            print(json.dumps({'status':'blocked', 'stage':'world-preflight',
                              'character_list_received':False, 'gameplay_verified':False}), file=sys.stderr)
            return 1
        password = getpass.getpass('Disposable local LAB password (not echoed): ')
        evidence = asyncio.run(run_acceptance(
            account=args.account, password=password, realm_id=args.realm_id,
            auth_port=args.auth_port, world_host=args.world_host,
            world_port=args.world_port, require_character=args.require_character,
            preflight_verified=True))
    except (ProbeError, WorldProtocolError, OSError, asyncio.TimeoutError,
            asyncio.IncompleteReadError, ConnectionError, EOFError, KeyboardInterrupt) as exc:
        # The exception message may originate from untrusted packets. Never print it.
        print(json.dumps({'status':'failed', 'error_type':type(exc).__name__,
                          'character_list_received':False, 'gameplay_verified':False}), file=sys.stderr)
        return 1
    print(json.dumps(asdict(evidence), sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
