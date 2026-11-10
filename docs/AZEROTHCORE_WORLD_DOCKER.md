# Build 21 — optional, private AzerothCore worldserver (3.3.5a)

**Implementation only — real worldserver acceptance is PENDING.** The official
`acore/ac-wotlk-worldserver` image is configured as an optional Compose overlay
on the existing Build 11 authserver/database/importer. This repository does
**not** download, extract, copy or publish Blizzard-derived content. Official
AzerothCore information: https://www.azerothcore.org/wiki/install-with-docker
and https://github.com/azerothcore/acore-docker/blob/master/docker-compose.yml

## Preconditions

- Docker Compose on a private macOS/Linux machine you control; do not use
  existing production Docker projects, databases, VPS or networks.
- You have independently obtained **permission** to use compatible, extracted
  game-derived server data. Public GitHub downloads alone do not confer rights.
- The data are stored in a **private absolute directory outside this Git repo**.
  Its root contains `dbc/*.dbc`, `maps/*.map` (mandatory) and preferably
  `vmaps/*.vmtree` / `.vmtile`, `mmaps/*.mmap` / `.mmtile`.
- Build 12340 compatibility must be verified against an actual server; a
  directory-layout check cannot prove content version, provenance or rights.

## Start ONLY in your private lab

```sh
# From the Wow repository root, on a host with Docker Desktop/Engine.
export WOTLK_LAB_DATA_DIR='/absolute/private/path/to/extracted-data'
export WOTLK_LAB_DB_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
python3 -m scripts.azerothcore_world_data_preflight

# Inspect the resolved Compose configuration locally. It contains credentials;
# NEVER paste its complete output into tickets, public logs or chat.
docker compose --project-name wotlk-world-lab-21 \
  -f lab/azerothcore-auth.compose.yml \
  -f lab/azerothcore-world.compose.yml config --quiet

# This is opt-in: only here are images pulled and containers started.
docker compose --project-name wotlk-world-lab-21 \
  -f lab/azerothcore-auth.compose.yml \
  -f lab/azerothcore-world.compose.yml up -d ac-authserver ac-worldserver

# Verify SRP6, realm, encrypted world handshake and read-only CHAR_ENUM,
# using an auto-generated disposable LAB account, deleted on completion.
python3 -m scripts.azerothcore_real_world_lab --realm-id 1

# Stop ONLY this isolated project. Keeps its lab DB to allow inspection.
docker compose --project-name wotlk-world-lab-21 \
  -f lab/azerothcore-auth.compose.yml \
  -f lab/azerothcore-world.compose.yml down
unset WOTLK_LAB_DB_PASSWORD WOTLK_LAB_DATA_DIR
```

The account is generated with random username/password/salt/verifier; it is
never printed and the password is not accepted as CLI input. The acceptance
command attempts account deletion even after unsuccessful auth. An interrupted
process can leave disposable lab records: inspect that isolated database
manually. **Do not use this with a real account or production database.**

The server data directory is bound **read-only**. MySQL is internal to Docker;
only `127.0.0.1:3724` and `127.0.0.1:8085` are published. No SOAP, admin UI
or WotLK client assets are published. The project name is explicit and distinct
from Build 11's auth-only lab. Docker Desktop must be able to access the
private host directory; ensure file permissions allow the container to read.

If worldserver cannot start, examine its logs **locally** with
`docker compose ... logs ac-worldserver` and redact credentials/paths before
sharing. AzerothCore server-image `master` tags can change without notice;
review compatible image digests before relying on reproducibility.

**Important:** A disposable account usually has **zero characters**. A valid
`SMSG_CHAR_ENUM` with zero characters proves read-only enumeration worked,
not that an existing character was recovered. Build 20's
`python3 -m scripts.azerothcore_world_acceptance --account LAB... --realm-id 1 --require-character`
is available for an independently created, authorized disposable character.
No character creation or destructive operations are automated by Build 21.

## Test matrix

| Gate | State |
| --- | --- |
| Static Compose isolation and read-only bind | Added; CI config validation |
| Private data layout check | Local metadata-only tests |
| Disposable account lifecycle | Offline simulation tests |
| Auth+world handshake and character enumeration | Implementation ready, actual server test pending |
| Nonempty real character list | Pending authorized test character |
| WoW character login, player movement, 3D assets | Not implemented |

Never run `docker compose down --volumes` on a project with valuable data.
A permanent volume delete is **not** part of Build 21. The GitHub Actions
configuration test **does not pull server images or fetch game-derived data**.
