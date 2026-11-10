"""Bounded parser for 3.3.5a AzerothCore realm-list replies (after SRP6)."""
from __future__ import annotations

import math
import struct
from dataclasses import dataclass

from .azerothcore_auth_probe import ProbeError

REALM_LIST_REQUEST = b"\x10\x00\x00\x00\x00"
FLAG_SPECIFY_BUILD = 0x04
MAX_REALMS = 128
MAX_REPLY = 16384


@dataclass(frozen=True)
class Realm:
    realm_id: int
    name: str
    address: str
    realm_type: int
    locked: bool
    flags: int
    population: float
    characters: int
    timezone: int
    client_build: int | None


def parse_realm_list(response: bytes) -> list[Realm]:
    if len(response) < 3 or response[0] != 0x10:
        raise ProbeError("Unexpected realm-list header")
    length = int.from_bytes(response[1:3], "little")
    if length > MAX_REPLY or len(response) != length + 3 or length < 8:
        raise ProbeError("Invalid realm-list frame length")
    packet = memoryview(response)[3:]
    realm_count = int.from_bytes(packet[4:6], "little")
    if realm_count > MAX_REALMS:
        raise ProbeError("Realm count exceeds local safety limit")
    cursor = 6

    def read_bytes(size: int) -> bytes:
        nonlocal cursor
        if size < 0 or cursor + size > len(packet):
            raise ProbeError("Truncated realm-list entry")
        result = bytes(packet[cursor:cursor + size])
        cursor += size
        return result

    def read_string() -> str:
        nonlocal cursor
        # Untrusted server data: bound each UTF-8 string to 256 bytes.
        end = bytes(packet[cursor:cursor + 257]).find(b"\x00")
        if end < 0 or end > 255:
            raise ProbeError("Realm string missing terminator or too long")
        raw = read_bytes(end + 1)[:-1]
        try:
            return raw.decode("utf-8")
        except UnicodeError as exc:
            raise ProbeError("Invalid realm text encoding") from exc

    realms: list[Realm] = []
    for _ in range(realm_count):
        realm_type, lock, flags = read_bytes(3)
        name = read_string()
        address = read_string()
        population = struct.unpack("<f", read_bytes(4))[0]
        chars, timezone, realm_id = read_bytes(3)
        if not math.isfinite(population) or population < 0:
            raise ProbeError("Invalid realm population")
        client_build = None
        if flags & FLAG_SPECIFY_BUILD:
            major, minor, patch = read_bytes(3)
            client_build = int.from_bytes(read_bytes(2), "little")
            if not (major == 3 and minor == 3 and patch == 5):
                # Report specified build as-is, never accept as 3.3.5a.
                pass
        realms.append(Realm(realm_id, name, address, realm_type, bool(lock), flags,
                            population, chars, timezone, client_build))
    if read_bytes(2) != b"\x10\x00" or cursor != len(packet):
        raise ProbeError("Invalid realm-list terminator or trailing bytes")
    return realms
