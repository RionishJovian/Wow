# Build 20 — real-worldserver acceptance gate

**Status: the CLI and end-to-end offline dual-service fixture are testable. A genuine AzerothCore worldserver with authorized world data has NOT been available for this build. Do not claim real-worldserver acceptance until a run against that server succeeds.**

This tool adds a repeatable, one-shot **read-only** check across both existing authentication and world-protocol clients. It does not implement actual character login, the world map, movement, rendering, or a full WoW client.

## Prerequisites

An **owned, isolated** AzerothCore 3.3.5a authserver and worldserver are needed, already started outside this repository, with a *disposable* non-admin account whose name starts with `LAB` and a compatible realm ID. Actual worldserver startup normally requires authorized, privately provisioned game-derived map/DBC data. This repository and GitHub Actions neither download nor publish that data. The Build 11 authentication-only Compose file does **not** start a worldserver.

Both TCP ports must be reachable as **numeric loopback addresses** from the computer where the CLI executes (default auth `127.0.0.1:3724`, world `127.0.0.1:8085`). Never expose those ports publicly. For a remote server you own, use a separately secured SSH tunnel terminating at localhost; do not give this CLI a remote address. Ensure that the tunnel and the local machine are trusted.

## One-shot verification

```sh
python -m scripts.azerothcore_world_probe --host 127.0.0.1 --port 8085
python -m scripts.azerothcore_world_acceptance --account LABTEST --realm-id 1 --require-character
```

The acceptance command validates its account, realm ID and host first, then checks an uncredentialed WotLK-shaped world challenge **before** prompting for the disposable password. It then performs SRP6 login with M2 verification, verifies the advertised realm, authenticates to the local worldserver using the temporary session key, requests a character list, and closes the connection. The real character names, GUIDs, password, session key, proof and packet contents are intentionally omitted from the final evidence. The `--require-character` flag requires a **nonempty** roster; omit it only when a zero-character account is expected.

Success prints JSON with explicit observed gates, character count, and `gameplay_verified: false`. The field `authenticated_server_identity_verified: false` remains false because WotLK's historical protocol lacks modern cryptographic transport identity guarantees; a matching challenge alone proves only a protocol shape. On failure, the CLI returns nonzero with a sanitized reason category, not raw network or credential data.

**Acceptance evidence levels:**

- Offline mock tests prove correct *local client behavior*, including the complete SRP6 → world auth → character enumeration sequence; they do **not** prove an actual AzerothCore process was involved.
- The Build 11 CI checks proved real AzerothCore **authserver** interoperability, not a worldserver connection.
- Only a documented real local worldserver run with a nonempty authorized test roster can promote **real worldserver character-enumeration acceptance**.

Never check disposable credentials or world-data files into source control or print their raw values in CI logs. Keep world acceptance as an explicitly manual gate on an owned local machine, not a public or shared GitHub-hosted worker.

## Offline regression tests

```sh
python -m pytest tests/test_world_acceptance.py -q
python -m pytest -q
node --test tests/*.test.mjs
```

No external network or original game files are needed by these tests.
