"""Asset-free WoW 3.3.5a world handshake and read-only character enumeration lab.

No world movement, public network connection, game assets, or non-lab accounts.
Derived from publicly inspectable AzerothCore WorldSocket, AuthCrypt and
Player::BuildEnumData protocol framing; not a production security implementation.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import struct
import zlib
from dataclasses import dataclass

from .azerothcore_auth_probe import BUILD, ProbeError, validate_target

SMSG_AUTH_CHALLENGE = 0x1EC
CMSG_AUTH_SESSION = 0x1ED
SMSG_AUTH_RESPONSE = 0x1EE
CMSG_CHAR_ENUM = 0x037
SMSG_CHAR_ENUM = 0x03B
AUTH_OK = 0x0C
MAX_WORLD_PAYLOAD = 65536
MAX_CHARACTERS = 12
# AzerothCore AuthCrypt.cpp; these are protocol constants, not account secrets.
SERVER_ENCRYPTION = bytes.fromhex("CC98AE04E897EACA12DDC09342915357")
SERVER_DECRYPTION = bytes.fromhex("C2B3723CC6AED9B5343C53EE2F4367CE")


class WorldProtocolError(ProbeError):
    """Untrusted packet or unsupported worldserver protocol state."""


class RC4:
    """Legacy WoW header cipher; do NOT use for new protocols or credentials."""
    def __init__(self, key: bytes, *, drop: int = 1024):
        if not isinstance(key, bytes) or len(key) < 1 or not 0 <= drop <= 4096:
            raise WorldProtocolError("Invalid legacy header-cipher parameters")
        self.s = list(range(256))
        j = 0
        for i in range(256):
            j = (j + self.s[i] + key[i % len(key)]) & 255
            self.s[i], self.s[j] = self.s[j], self.s[i]
        self.i = self.j = 0
        if drop:
            self.apply(bytes(drop))

    def apply(self, data: bytes) -> bytes:
        result = bytearray(len(data))
        for k, value in enumerate(data):
            self.i = (self.i + 1) & 255
            self.j = (self.j + self.s[self.i]) & 255
            self.s[self.i], self.s[self.j] = self.s[self.j], self.s[self.i]
            result[k] = value ^ self.s[(self.s[self.i] + self.s[self.j]) & 255]
        return bytes(result)


def header_ciphers(session_key: bytes) -> tuple[RC4, RC4]:
    """Returns (client outgoing encrypt, incoming server decrypt)."""
    if not isinstance(session_key, bytes) or len(session_key) != 40:
        raise WorldProtocolError("Expected a verified 40-byte SRP6 session key")
    send_key = hmac.new(SERVER_DECRYPTION, session_key, hashlib.sha1).digest()
    receive_key = hmac.new(SERVER_ENCRYPTION, session_key, hashlib.sha1).digest()
    return RC4(send_key), RC4(receive_key)


def encode_client_packet(opcode: int, payload: bytes, cipher: RC4 | None = None) -> bytes:
    if not isinstance(opcode, int) or not 0 <= opcode <= 0xFFFF:
        raise WorldProtocolError("Invalid world opcode")
    if not isinstance(payload, bytes) or len(payload) + 4 > 10240:
        raise WorldProtocolError("Unsupported client world packet size")
    # ClientPktHeader: size big endian (includes 4-byte command), opcode LE uint32.
    header = struct.pack(">H", len(payload) + 4) + struct.pack("<I", opcode)
    return (cipher.apply(header) if cipher else header) + payload


def encode_server_packet(opcode: int, payload: bytes, cipher: RC4 | None = None) -> bytes:
    """Server-side framing used only by simulated fixture tests."""
    if not isinstance(payload, bytes) or len(payload) + 2 > MAX_WORLD_PAYLOAD:
        raise WorldProtocolError("Unsupported server world packet size")
    size = len(payload) + 2
    header = (bytes((0x80 | ((size >> 16) & 0x7f),)) + struct.pack(">H", size)
              if size > 0x7fff else struct.pack(">H", size))
    header += struct.pack("<H", opcode)
    return (cipher.apply(header) if cipher else header) + payload


async def read_server_packet(reader: asyncio.StreamReader, cipher: RC4 | None = None,
                             *, timeout: float = 4.0) -> tuple[int, bytes]:
    if not 0.1 <= timeout <= 10:
        raise WorldProtocolError("Invalid world timeout")
    async def exact(n: int) -> bytes:
        return await asyncio.wait_for(reader.readexactly(n), timeout)
    first = await exact(1)
    if cipher: first = cipher.apply(first)
    large = bool(first[0] & 0x80)
    remaining = await exact(4 if large else 3)
    if cipher: remaining = cipher.apply(remaining)
    header = first + remaining
    if large:
        size = ((header[0] & 0x7f) << 16) | int.from_bytes(header[1:3], "big")
        opcode = int.from_bytes(header[3:5], "little")
    else:
        size = int.from_bytes(header[0:2], "big")
        opcode = int.from_bytes(header[2:4], "little")
    if not 2 <= size <= MAX_WORLD_PAYLOAD:
        raise WorldProtocolError("World packet exceeds maximum allowed size")
    return opcode, await exact(size - 2)


def parse_world_challenge(opcode: int, payload: bytes) -> bytes:
    if opcode != SMSG_AUTH_CHALLENGE or len(payload) != 40 or payload[:4] != b"\x01\x00\x00\x00":
        raise WorldProtocolError("Invalid WotLK 3.3.5a world challenge")
    return payload[4:8]  # The other 32 bytes are protocol random padding.


def make_auth_session(account: str, session_key: bytes, realm_id: int, server_seed: bytes,
                      *, client_seed: bytes | None = None) -> bytes:
    if not isinstance(account, str) or not 1 <= len(account) <= 16 or not account.isascii() or not account.isalnum() or account != account.upper():
        raise WorldProtocolError("Invalid lab account name")
    if len(session_key) != 40 or len(server_seed) != 4:
        raise WorldProtocolError("Invalid world authentication context")
    if not isinstance(realm_id, int) or not 1 <= realm_id <= 255:
        raise WorldProtocolError("Invalid selected realm ID")
    client_seed = client_seed if client_seed is not None else secrets.token_bytes(4)
    if not isinstance(client_seed, bytes) or len(client_seed) != 4:
        raise WorldProtocolError("Client seed must be four bytes")
    proof = hashlib.sha1(account.encode("ascii") + bytes(4) + client_seed + server_seed + session_key).digest()
    # Empty compressed addon list: upstream requires non-empty AddonInfo; no proprietary game files.
    addon_list = struct.pack("<I", 0)
    addon_info = struct.pack("<I", len(addon_list)) + zlib.compress(addon_list)
    payload = (struct.pack("<II", BUILD, 0) + account.encode("ascii") + b"\0"
               + struct.pack("<I", 0) + client_seed + struct.pack("<IIIQ", 0, 0, realm_id, 0)
               + proof + addon_info)
    return encode_client_packet(CMSG_AUTH_SESSION, payload)


@dataclass(frozen=True)
class Character:
    name: str
    race: int
    character_class: int
    gender: int
    level: int
    zone: int
    map_id: int
    # GUID intentionally omitted from summaries. No character mutations permitted.


def parse_char_enum(payload: bytes) -> list[Character]:
    if not isinstance(payload, bytes) or not payload:
        raise WorldProtocolError("Missing character enumeration payload")
    count = payload[0]
    if count > MAX_CHARACTERS:
        raise WorldProtocolError("Too many characters returned by worldserver")
    pos = 1
    result = []
    for _ in range(count):
        if pos + 8 > len(payload):
            raise WorldProtocolError("Truncated character GUID")
        pos += 8
        end = payload.find(b"\x00", pos, min(len(payload), pos + 65))
        if end < 0 or end == pos or end - pos > 48:
            raise WorldProtocolError("Invalid character name")
        try:
            name = payload[pos:end].decode("utf-8")
        except UnicodeError as exc:
            raise WorldProtocolError("Invalid character name encoding") from exc
        pos = end + 1
        # Race/class/gender, appearance 5, level, zone + map, x/y/z, guild + flags + customise.
        format_string = "<9BIIfffIII B III"  # 9 bytes, zone/map, coords, guild/flags/customise, firstLogin, pet data
        # Explicit layout avoids accidentally skipping or logging personal game data.
        fixed_size = struct.calcsize(format_string)
        if pos + fixed_size + 23 * 9 > len(payload):
            raise WorldProtocolError("Truncated character appearance or equipment")
        values = struct.unpack_from(format_string, payload, pos)
        pos += fixed_size + 23 * 9
        race, klass, gender = values[:3]
        level = values[8]
        zone, map_id = values[9:11]
        if not (1 <= level <= 80 and 1 <= race <= 12 and 1 <= klass <= 11 and gender in (0, 1)):
            raise WorldProtocolError("Invalid WotLK character stats")
        result.append(Character(name, race, klass, gender, level, zone, map_id))
    if pos != len(payload):
        raise WorldProtocolError("Character list has unexpected trailing bytes")
    return result


async def enumerate_world_characters(*, account: str, session_key: bytes,
                                     realm_id: int, host: str = "127.0.0.1",
                                     port: int = 8085, timeout: float = 4.0) -> dict:
    """Only an OWNED local worldserver. Never reads credentials or loads game data."""
    validate_target(host, port)
    reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
    try:
        opcode, body = await read_server_packet(reader, timeout=timeout)
        seed = parse_world_challenge(opcode, body)
        writer.write(make_auth_session(account, session_key, realm_id, seed))
        await asyncio.wait_for(writer.drain(), timeout)
        outbound, inbound = header_ciphers(session_key)
        for _ in range(24):
            opcode, body = await read_server_packet(reader, inbound, timeout=timeout)
            if opcode == SMSG_AUTH_RESPONSE:
                if not body or body[0] != AUTH_OK:
                    raise WorldProtocolError("Worldserver rejected lab session")
                break
        else:
            raise WorldProtocolError("No successful world authentication response")
        writer.write(encode_client_packet(CMSG_CHAR_ENUM, b"", outbound))
        await asyncio.wait_for(writer.drain(), timeout)
        for _ in range(24):
            opcode, body = await read_server_packet(reader, inbound, timeout=timeout)
            if opcode == SMSG_CHAR_ENUM:
                characters = parse_char_enum(body)
                return {
                    "world_authenticated": True,
                    "character_list_received": True,
                    "character_count": len(characters),
                    "characters": [{"name": c.name, "race": c.race,
                                    "class": c.character_class, "level": c.level}
                                   for c in characters],
                    "gameplay_verified": False,
                }
        raise WorldProtocolError("No character list received")
    finally:
        writer.close()
        try:
            await asyncio.wait_for(writer.wait_closed(), 1)
        except (OSError, asyncio.TimeoutError):
            pass
