# Build 16 — mobile rendering budget + credential-free worldserver preflight

**The original offline demo is not World of Warcraft gameplay.** No Blizzard
assets, real avatar movement or network game session is available in that mode.

## Mobile browser rendering

`web/mobile_quality.mjs` limits the original demo's drawing buffer to 550,000
pixels and 1,280 pixels on its longest side. CSS presentation size does not
change: only the internal WebGL2 framebuffer changes. The controller samples
rendered frames, scales down after 12 sustained slow samples (~46+ ms), and
recovers cautiously after 100 sustained fast samples (~35 ms or less). Long
background-tab pauses are ignored; no localStorage or analytics are written.
The renderer skips GPU draw work while `document.hidden` and resumes with a
bounded delta. `world.stats.renderScale` and `renderPixels` expose diagnostics.

These are *adaptive heuristics*, not measured iOS/Android FPS improvements.
Physical phones and Safari/Chrome still need GPU and battery tests. Shader
fragment cost may remain high even at a smaller buffer.

## Worldserver preflight with no original client

AzerothCore's `WorldSocket::HandleSendAuthSession` sends an **unencrypted**
`SMSG_AUTH_CHALLENGE` (`0x1EC`) with a fixed 40-byte payload: `uint32(1)`,
4-byte random server seed, and 32 additional random bytes. `scripts.azerothcore_world_probe`
reads and validates that single message; it does **not** reply, authenticate,
read characters, or claim server identity. Format match is not proof that the
service is AzerothCore (a fake server could reproduce it).

Run only against an owned local worldserver, if independently provisioned:

```sh
python -m scripts.azerothcore_world_probe --host 127.0.0.1 --port 8085
```

The command rejects remote IPs and hostnames. It prints no server seed,
credentials, packet dumps, account identity or session keys. **No real
worldserver was available for this build**, so acceptance tests use isolated
fake servers and must not be described as live-world compatibility.

## Verification

```sh
node --test tests/mobile_quality.test.mjs
python -m pytest tests/test_world_probe.py -q
node --test tests/*.test.mjs
python -m pytest -q
```

The GitHub Actions WebGL2 smoke runs real Chromium with a software GPU to check
the **original demo**'s framebuffer budget, world movement, jump and beacon
pickup. It is not an Android/iOS performance benchmark.

## Still pending

- Actual AzerothCore `worldserver` on local 8085, requiring authorized world data.
- Successful real character enumeration using a disposable local account.
- iOS Safari and Android Chrome GPU / thermal / battery profiling.
- Real WoW build 12340 world terrain, assets, character login and movement.

Upstream references:
[AzerothCore WorldSocket](https://github.com/azerothcore/azerothcore-wotlk/blob/master/src/server/game/Server/WorldSocket.cpp),
[AzerothCore AuthCrypt](https://github.com/azerothcore/azerothcore-wotlk/blob/master/src/common/Cryptography/Authentication/AuthCrypt.cpp).
