# Build 08 — asset-free AzerothCore authentication interoperability lab

**Not a World of Warcraft client. Not real login or gameplay.**

AzerothCore's authserver listens on TCP 3724 by default and uses a binary
3.3.5a login-challenge request. Its worldserver is a separate game service
and is not validated by this check.

This implementation uses only the initial AUTH_LOGON_CHALLENGE framing from
https://github.com/azerothcore/azerothcore-wotlk/blob/master/src/server/apps/authserver/Server/AuthSession.cpp

The probe sends a fresh, deliberately nonexistent LAB identifier to numeric
loopback IPs only and reads three response bytes. It does not send a password,
perform SRP6, query real account details, or connect to a realm. No original WoW
client, MPQ files, copyrighted graphics, or credentials are required.

## Run the asset-free local simulation

    python -m pytest tests/test_azerothcore_auth_probe.py -q

## Optional: check your own local authserver

Install a legitimate AzerothCore authserver and database separately in an
isolated development environment. This project does not install or start one.

    python -m scripts.azerothcore_auth_probe --host 127.0.0.1 --port 3724

Use once: the invalid-account challenge may create an authserver log entry.
The CLI rejects remote hosts. A recognized challenge response means only the
transport speaks a compatible 3.3.5a format, **not** authentication,
server-identity verification, realm access, or gameplay.

The official AzerothCore Docker Compose can download client-derived files for
worldserver startup. Review its data sources and rights before use. Never publish
copyrighted assets or expose the local gateway to the public internet.

## Acceptance

- Auth challenge structure: tested against offline fixture bytes.
- Local simulated challenge response and failure parsing: tested.
- Actual AzerothCore authserver on 127.0.0.1:3724: NOT TESTED.
- Full SRP6 login, realm listing, world connection: NOT IMPLEMENTED.
- World rendering, avatar movement, mobile Safari/Chrome: NOT TESTED.

## Build 09 — SRP6 proof and realm list (local account only)

**Status:** Protocol implementation and offline mock-server test **passed**.
Connection to an actual AzerothCore authserver **not tested**. This is not a
character-select screen or a playable game.

Build 09 adds a small, dependency-free implementation of the WotLK 3.3.5a
SRP6 authentication exchange, including the client `A`/`M1` proof, verification
of the server's `M2` proof, and bounded parsing of the AzerothCore 3.3.5a realm
list. The protocol arithmetic was checked against AzerothCore
`src/common/Cryptography/Authentication/SRP6.cpp` and the wire framing against
`src/server/apps/authserver/Server/AuthSession.cpp`.

No original client/MPQ content is needed for these steps. The tests include an
independent ephemeral local server that verifies the client's cryptographic
proof and returns a one-realm fixture. The test credentials are synthetic.

```bash
python -m pytest tests/test_azerothcore_srp6.py -q
```

Only if you have separately configured **your own** local AzerothCore authserver
with a disposable non-privileged account, you can perform a one-shot test:

```bash
python -m scripts.azerothcore_lab_login --account LABUSER --host 127.0.0.1 --port 3724
# The CLI prompts privately for the password; it never accepts --password.
```

The CLI accepts only numeric loopback addresses. It never logs the password,
SRP6 session key, client proof, or server proof. It returns a sanitized summary
of realm IDs/names, character counts, locks, and optional client build.
**Never use a valuable account or shared credentials**: the Python
implementation has not had a professional cryptographic review, strings cannot
be reliably wiped from memory, the classic protocol uses SHA-1, and loopback
TCP does not provide modern TLS/server-identity guarantees. The lab deliberately
rejects PIN/matrix/TOTP challenges and servers with unexpected SRP parameters.
It sends the zero legacy client CRC proof; strict executable-version checks
may reject it without access to an original authorized client.

Acceptance checklist:

- [x] SRP6 fixture with independent server-side calculations
- [x] Wrong-password proof cannot validate against the simulated server
- [x] Server M2 proof must match before requesting realms
- [x] Frame bounds and path/host restrictions tested
- [x] Parse one synthetic 3.3.5a realm response
- [ ] Actual AzerothCore authentication with a disposable local account
- [ ] Worldserver connect, character enumeration, world rendering or movement
- [ ] iOS Safari / Android Chrome hardware verification

Do not expose this experimental credential-handling code over a public website.
