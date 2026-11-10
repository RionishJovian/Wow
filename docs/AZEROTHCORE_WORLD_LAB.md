# Build 12 — worldserver protocol lab (WotLK 3.3.5a / 12340)

**State: asset-free protocol simulation passes. Real worldserver acceptance has not been performed.**

This build implements the minimal client-side steps after AzerothCore SRP6 auth:

1. Connect to the **owned, loopback-only** worldserver (never trust a realm-list URL as a network target).
2. Parse `SMSG_AUTH_CHALLENGE` (40 bytes; opcode `0x1EC`).
3. Compute `CMSG_AUTH_SESSION` using the verified SRP6 session key and random client seed (opcode `0x1ED`).
4. Encrypt/decrypt only 3.3.5a packet headers using HMAC-SHA1-derived ARC4-drop1024, matching AzerothCore's historical wire format.
5. Require `SMSG_AUTH_RESPONSE` with `AUTH_OK` (opcode `0x1EE`, result `0x0C`), then request `CMSG_CHAR_ENUM` (`0x037`).
6. Read `SMSG_CHAR_ENUM` (`0x03B`) with bounded packet/character sizes and decode *read-only* character metadata. No character selection, creation, login or world movement is attempted.

The pure-Python crypto implementation uses obsolete ARC4 and SHA-1 **only** to interoperate with legacy 3.3.5a clients. It is not security audited, not suitable for ordinary user credentials, and must never be publicly exposed.

## Local offline tests (no game client or assets)

```bash
python -m pytest tests/test_azerothcore_world.py -q
python -m pytest -q
node --test tests/*.test.mjs
```

The fake worldserver fixture independently verifies the `CMSG_AUTH_SESSION` packet digest and header cipher, then returns an encrypted auth acknowledgment and character list. It rejects errors rather than claiming gameplay. CI tests use only synthetic player metadata.

## Optional real-worldserver acceptance — not yet run

The earlier Build 11 Docker lab deliberately contains only an authserver and database. A real AzerothCore **worldserver requires separately authorized game-derived map/DBC data**, which is not available here. Do not download, distribute, publish, or put that data into GitHub Actions or this repository.

If an administrator later provisions a lawful, isolated, loopback-only AzerothCore worldserver on `127.0.0.1:8085`, with a disposable account and a realm configured for build 12340, this **read-only** check is available:

```bash
python -m scripts.azerothcore_world_lab --account LABTEST --realm-id 1
```

The CLI prompts privately for the password, never accepts it as a command-line argument, and prints a sanitized summary without passwords, proofs, raw packets, SRP session keys, or character GUIDs. The CLI refuses foreign addresses, locked/offline/foreign-build realms and non-LAB accounts. It connects only to the explicitly selected local worldserver, **not** to the address sent in the realm listing.

## Acceptance status

- [x] World challenge, auth packet, ARC4-header crypto, and character list simulated in offline tests.
- [x] No external network access or original WoW data required for automated tests.
- [ ] Real AzerothCore worldserver 8085 connection, server proof validation, character enumeration.
- [ ] Fully implemented 3.3.5a gameplay client, terrain, character movement.
- [ ] Browser world-client port and iOS/Android physical tests.

Upstream implementation references:
- [AzerothCore WorldSocket.cpp](https://github.com/azerothcore/azerothcore-wotlk/blob/master/src/server/game/Server/WorldSocket.cpp)
- [AzerothCore AuthCrypt.cpp](https://github.com/azerothcore/azerothcore-wotlk/blob/master/src/common/Cryptography/Authentication/AuthCrypt.cpp)
- [AzerothCore Player::BuildEnumData](https://github.com/azerothcore/azerothcore-wotlk/blob/master/src/server/game/Entities/Player/Player.cpp)

## Build 13 — browser read-only roster

The web UI exposes a separate opt-in step to run `web/azerothcore_browser_world.mjs`
after browser SRP6 proof and realm list verification. Only locally configured
`/ws/world` is allowed; the realm-list host is ignored. The browser performs
3.3.5a challenge/digest and encrypted header framing, requests character
enumeration, then immediately closes the local world socket. Character names
and basic appearance metadata are shown as read-only text. **Never** store
client SRP session keys or mark a synthetic roster as a live realm.

Validation of the JavaScript implementation currently uses an independent
Node fake-worldserver and synthetic characters. This is not real AzerothCore
worldserver acceptance. Original game assets, a real server with authorized
world data, character login, in-world movement and mobile-device tests remain
unavailable.
