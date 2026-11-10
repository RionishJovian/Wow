#!/usr/bin/env python3
"""Pin and instrument Wowser's open-source browser UI for local integration.

No Blizzard content, credentials or realm traffic are retrieved by this helper.
Instrumentation reports observable *UI stages*, never game-play readiness.
"""
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

# Explicit reproducible upstream target. Re-review changes before updating this SHA.
UPSTREAM_URL = "https://github.com/wowserhq/client.git"
UPSTREAM_COMMIT = "cce0ddd2648603706b6d4b20bf036160056aec8d"
STAGE_EVENT = "wotlk-lab:upstream-stage"
STAGE_FILE = """/**
 * Local instrumentation only. These states do NOT attest to game-world rendering,
 * authentication, or gameplay. This file is injected at build-time into Wowser.
 */
export type LabStage =
  | 'client-created'
  | 'loading-ui'
  | 'ui-loader-returned'
  | 'resource-load-failed'
  | 'first-render-call'
  | 'render-failed';

export function setLabStage(stage: LabStage): void {
  document.documentElement.setAttribute('data-wotlk-lab-stage', stage);
  window.dispatchEvent(new Event('wotlk-lab:upstream-stage'));
}
"""


class WowserPreparationError(ValueError):
    """Upstream checkout or expected instrumentation points unavailable."""


def checked_replace(contents: str, anchor: str, replacement: str) -> str:
    if contents.count(anchor) != 1:
        raise WowserPreparationError(f"Upstream source anchor missing or ambiguous: {anchor[:60]!r}")
    return contents.replace(anchor, replacement, 1)


def instrument_entrypoint(source: str) -> str:
    """Make a minimal, auditable instrumentation overlay against the PINNED entrypoint.

    The upstream implementation is not replaced by a synthetic game runtime.
    """
    source = checked_replace(
        source,
        "import Client from './Client';",
        "import Client from './Client';\nimport { setLabStage } from './wotlk-lab-stage';",
    )
    source = checked_replace(
        source,
        "const client = new Client(canvas, { api });",
        "const client = new Client(canvas, { api });\nsetLabStage('client-created');",
    )
    source = checked_replace(
        source,
        "  await client.ui.load('Wowser\\\\Wowser.toc');",
        "  setLabStage('loading-ui');\n"
        "  try {\n"
        "    await client.ui.load('Wowser\\\\Wowser.toc');\n"
        "    // Loader returned: this is NOT proof of complete UI assets or gameplay.\n"
        "    setLabStage('ui-loader-returned');\n"
        "  } catch {\n"
        "    // Never forward paths, stack traces, credentials or asset contents.\n"
        "    setLabStage('resource-load-failed');\n"
        "    return;\n"
        "  }",
    )
    source = checked_replace(
        source,
        "    client.screen.render();",
        "    try {\n"
        "      client.screen.render();\n"
        "      setLabStage('first-render-call');\n"
        "    } catch {\n"
        "      setLabStage('render-failed');\n"
        "      return;\n"
        "    }",
    )
    return source


def verify_checkout(source: Path, *, runner=subprocess.run) -> str:
    if not (source / "package.json").is_file():
        raise WowserPreparationError("Expected Wowser source root with package.json")
    if not (source / "LICENSE").is_file():
        raise WowserPreparationError("Upstream license missing; cannot prepare build")
    try:
        result = runner(
            ["git", "-C", str(source), "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise WowserPreparationError("Cannot verify upstream Git revision") from exc
    commit = result.stdout.strip().lower()
    if commit != UPSTREAM_COMMIT:
        raise WowserPreparationError(
            f"Unexpected upstream commit {commit[:12]}; expected {UPSTREAM_COMMIT[:12]}"
        )
    return commit


def prepare(source: Path, *, runner=subprocess.run) -> None:
    """Validate all anchors before modifying the upstream worktree."""
    source = source.resolve(strict=True)
    verify_checkout(source, runner=runner)
    entry = source / "src" / "index.ts"
    output = source / "src" / "wotlk-lab-stage.ts"
    fetch = source / "src" / "utils" / "fetch.ts"
    resource_adapter = source / "src" / "wotlk-lab-resource.ts"
    adapter_source = Path(__file__).resolve().parents[1] / "web" / "local_client_resource.mjs"
    if not entry.is_file() or not fetch.is_file() or output.exists() or resource_adapter.exists():
        raise WowserPreparationError("Expected pristine upstream index.ts and utils/fetch.ts")
    original = entry.read_text(encoding="utf-8")
    patched = instrument_entrypoint(original)
    original_fetch = fetch.read_text(encoding="utf-8")
    patched_fetch = checked_replace(
        original_fetch, "type ResponseBodyType = 'text'",
        "import { localClientResource } from '../wotlk-lab-resource';\n"
        "type ResponseBodyType = 'text'",
    )
    patched_fetch = checked_replace(
        patched_fetch, 'const response = await fetch(path);',
        'const response = await fetch(localClientResource(path));',
    )
    # Validate all mandatory original anchors before writing anything.
    # The source package is already copied to a temporary build directory.
    output.write_text(STAGE_FILE, encoding="utf-8")
    # Keep JS and TS adapters logically identical; add explicit TS types so
    # the pinned upstream strict compiler can typecheck the injected module.
    adapter = adapter_source.read_text(encoding="utf-8")
    adapter = checked_replace(adapter, "export function localClientResource(input) {",
                              "export function localClientResource(input: string): string {")
    adapter = checked_replace(adapter, "  const segments = [];",
                              "  const segments: string[] = [];")
    resource_adapter.write_text(adapter, encoding="utf-8")
    entry.write_text(patched, encoding="utf-8")
    fetch.write_text(patched_fetch, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Local checkout pinned to the documented Wowser commit")
    args = parser.parse_args()
    try:
        prepare(args.source)
    except (OSError, WowserPreparationError) as exc:
        parser.error(str(exc))
    print("Installed original UI-stage instrumentation into pinned Wowser source.")
    print("This is not evidence of WoW character login or world rendering.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
