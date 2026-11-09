#!/usr/bin/env python3
"""Build pinned MIT-licensed Wowser UI code into the isolated local client host.

This script is opt-in, requires access to source and npm dependencies, and
never retrieves Blizzard assets. It DOES NOT make the game playable.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

if __package__:
    from .install_wowser import DEFAULT_DEST, install
    from .prepare_wowser import (
        UPSTREAM_COMMIT, UPSTREAM_URL, WowserPreparationError, prepare, verify_checkout,
    )
else:
    from install_wowser import DEFAULT_DEST, install
    from prepare_wowser import (
        UPSTREAM_COMMIT, UPSTREAM_URL, WowserPreparationError, prepare, verify_checkout,
    )


def run_checked(argv: list[str], *, cwd: Path, runner=subprocess.run) -> None:
    runner(argv, cwd=cwd, check=True)


def checkout_source(target: Path, *, runner=subprocess.run) -> None:
    """Fetch one explicitly pinned public upstream revision, never a floating branch."""
    target.mkdir(parents=True, exist_ok=False)
    run_checked(["git", "init", "-q"], cwd=target, runner=runner)
    run_checked(["git", "remote", "add", "origin", UPSTREAM_URL], cwd=target, runner=runner)
    run_checked(["git", "fetch", "--depth", "1", "origin", UPSTREAM_COMMIT],
                cwd=target, runner=runner)
    run_checked(["git", "checkout", "--detach", "FETCH_HEAD"], cwd=target, runner=runner)
    verify_checkout(target)


def build(*, source: Path | None = None, destination: Path = DEFAULT_DEST,
          force: bool = False, runner=subprocess.run) -> dict:
    """Build from a pinned local checkout or fetch one into a temporary worktree.

    A supplied local source tree is copied before instrumentation, leaving the
    user's clone untouched. No content is sent to external services by us.
    """
    if source is not None:
        source = source.resolve(strict=True)
        verify_checkout(source)
    with tempfile.TemporaryDirectory(prefix="wotlk-wowser-build-") as temp:
        temp_root = Path(temp)
        work = temp_root / "wowser"
        if source is None:
            checkout_source(work, runner=runner)
        else:
            def ignored(_dir: str, items: list[str]) -> set[str]:
                return set(items) & {"node_modules", "dist", ".cache"}
            shutil.copytree(source, work, symlinks=False, ignore=ignored)
        prepare(work)
        # Prevent third-party install lifecycle hooks. Building still runs
        # public upstream code, so do this only for trusted, reviewed sources.
        run_checked(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
                    cwd=work, runner=runner)
        run_checked(["npm", "run", "build", "--", "--base=/client/"],
                    cwd=work, runner=runner)
        dist = work / "dist"
        if not (dist / "index.html").is_file():
            raise WowserPreparationError("Upstream build did not produce dist/index.html")
        # Preserve the MIT license whenever an upstream build is packaged.
        shutil.copyfile(work / "LICENSE", dist / "WOWSER_LICENSE.txt")
        report = install(dist, destination, force=force)
        report["provider"] = "wowserhq/client"
        report["source_commit"] = UPSTREAM_COMMIT
        report["gameplay_verified"] = False
        report["assets_bundled"] = False
        (destination.resolve() / "lab-install.json").write_text(json.dumps(report, indent=2) + "\n")
        return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=None,
                        help="Optional local Git checkout at the pinned Wowser commit")
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    try:
        report = build(source=args.source, destination=args.dest, force=args.force)
    except (OSError, subprocess.CalledProcessError, WowserPreparationError, ValueError) as exc:
        parser.error(str(exc))
    print(f"Built pinned Wowser UI {report['source_commit'][:12]}; installed {report['source_file_count']} files")
    print("This is a browser UI integration, NOT a playable WoW 3.3.5a client.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
