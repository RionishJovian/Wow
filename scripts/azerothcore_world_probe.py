"""Credential-free, read-only WotLK worldserver challenge probe for an OWNED local lab.

No login, no game data, no outgoing game packets, no remote hosts. A matching
hello is *format evidence*, not proof of AzerothCore server identity or gameplay.
"""
from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import asdict, dataclass

from .azerothcore_auth_probe import ProbeError, validate_target
from .azerothcore_world import (WorldProtocolError, parse_world_challenge,
                               read_server_packet)


@dataclass(frozen=True)
class ChallengeObservation:
    transport_connected: bool
    world_challenge_format_valid: bool
    observation: str
    build_confirmed: bool = False
    authenticated: bool = False
    characters_received: bool = False
    gameplay_verified: bool = False


async def observe_world_challenge(host: str = '127.0.0.1', port: int = 8085,
                                  timeout: float = 2.0) -> ChallengeObservation:
    validate_target(host, port)
    if not isinstance(timeout, (float, int)) or isinstance(timeout, bool) or not .1 <= timeout <= 5:
        raise ProbeError('World challenge timeout must be 0.1–5 seconds')
    writer = None
    connected = False
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
        connected = True
        opcode, payload = await read_server_packet(reader, timeout=timeout)
        # Do not expose the per-connection random server seed in a report.
        parse_world_challenge(opcode, payload)
        return ChallengeObservation(True, True, 'wotlk-world-challenge-shaped')
    except (OSError, EOFError, asyncio.TimeoutError, asyncio.IncompleteReadError):
        return ChallengeObservation(connected, False,
            'no-valid-challenge' if connected else 'tcp-unreachable')
    except WorldProtocolError:
        return ChallengeObservation(connected, False, 'unexpected-world-protocol')
    finally:
        if writer is not None:
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), timeout)
            except (OSError, asyncio.TimeoutError):
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1', help='Numeric loopback IP only')
    parser.add_argument('--port', type=int, default=8085)
    parser.add_argument('--timeout', type=float, default=2.0)
    args = parser.parse_args()
    try:
        result = asyncio.run(observe_world_challenge(args.host, args.port, args.timeout))
    except ProbeError as exc:
        parser.error(str(exc))
    print(json.dumps(asdict(result), sort_keys=True))
    return 0 if result.world_challenge_format_valid else 1


if __name__ == '__main__':
    raise SystemExit(main())
