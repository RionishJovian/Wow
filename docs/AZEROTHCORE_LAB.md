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
