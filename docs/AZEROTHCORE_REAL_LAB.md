# Build 11 — isolated real AzerothCore authentication acceptance

**Not a playable World of Warcraft client. No Blizzard game assets.**

This lab starts only the MySQL database, AzerothCore database importer and
AzerothCore **authserver** using the service names and official images documented
by [acore-docker](https://github.com/azerothcore/acore-docker). No worldserver,
game client or copyrighted asset download is requested by this Compose stack.
Database import may fetch source database updates; review the upstream images
before using them. Images use the moving `master` tag until a validated digest is
recorded. CI is the first actual-server acceptance gate.

## Security boundaries

- The auth port binds to **127.0.0.1:3724**, not to the public network.
- MySQL is reachable **only inside Docker**, with an ephemeral lab-only password.
- This is for a disposable isolated development environment; never point at
  an existing database or live AzerothCore installation.
- The account is randomly generated and nonprivileged, then deleted after the test.
  Its password, salt, verifier and session key never appear in test reports.
- Docker images and this custom SRP6 client are **not security-audited**.

## Run locally on a machine with Docker Compose

On macOS/Linux, from the cloned `Wow` repository:

```sh
# Choose a unique database password for this disposable lab only.
export WOTLK_LAB_DB_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
# Validate configuration without starting containers.
docker compose -f lab/azerothcore-auth.compose.yml config --quiet
# Start the authentication server and its database/dependency importer.
docker compose -f lab/azerothcore-auth.compose.yml up -d ac-authserver
# Create a one-time account, prove SRP6 login, request realm list, delete account.
python3 -m scripts.azerothcore_real_lab
# Stop the lab (keeps the database for inspection).
docker compose -f lab/azerothcore-auth.compose.yml down
unset WOTLK_LAB_DB_PASSWORD
```

`docker compose down --volumes` **irreversibly deletes lab database contents**.
Do not use that command on a directory or Docker project containing valuable
volumes. The GitHub Actions workflow deletes its own throwaway CI volumes.

The acceptance report exposes only booleans and realm count. A nonzero exit
means the gate failed. It does not prove that a full client, worldserver, or
mobile browser works. The official images may evolve; if the importer changes,
check the upstream release and update the lab after review.

## CI acceptance checklist

- [ ] Official AzerothCore authserver boots and listens on loopback in GitHub Actions.
- [ ] Generated test account is accepted by the **real** authserver.
- [ ] Server M2 SRP6 proof verifies and a realm list is parsed.
- [ ] Disposable account is deleted.
- [ ] A real worldserver connects (separate milestone).
- [ ] A browser client lists characters and renders the game world (separate milestone).

The workflow `azerothcore-live-auth.yml` runs on integration changes and can
also be dispatched manually. Do not mark these checks complete until the
**actual CI log** confirms them. An empty or offline realm list may still mean
successful auth, but not a usable game realm.
