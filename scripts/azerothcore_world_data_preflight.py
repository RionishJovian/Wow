"""Metadata-only gate for privately provided AzerothCore 3.3.5a server data.

Does not download, copy, hash, upload, parse, or print game-derived files. It
checks the minimum directory layout; it cannot verify provenance or rights.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {"dbc": ".dbc", "maps": ".map"}
RECOMMENDED = {"vmaps": (".vmtree", ".vmtile"), "mmaps": (".mmap", ".mmtile")}


class DataPreflightError(ValueError):
    """Invalid or unavailable private server-data layout."""


def _has_example(path: Path, suffixes: tuple[str, ...]) -> bool:
    # A bounded metadata scan (not an attempt to validate copyrighted data).
    try:
        with os.scandir(path) as it:
            for index, item in enumerate(it):
                if index >= 16384:
                    break
                if item.is_file(follow_symlinks=False) and item.name.lower().endswith(suffixes):
                    return True
    except OSError as exc:
        raise DataPreflightError("Cannot inspect the private data folder") from exc
    return False


def inspect_data_dir(path: str | os.PathLike[str], *, repo_root: Path = REPO_ROOT) -> dict:
    """Return only layout booleans; NEVER return game file names or local paths."""
    if not isinstance(path, (str, os.PathLike)) or not str(path).strip():
        raise DataPreflightError("Supply WOTLK_LAB_DATA_DIR with a private absolute path")
    root = Path(path).expanduser()
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise DataPreflightError("Private data root must be an existing, nonsymlink absolute directory")
    if root.resolve().is_relative_to(repo_root.resolve()):
        raise DataPreflightError("Keep game-derived files outside the Git repository")
    availability = {}
    for name, suffix in REQUIRED.items():
        directory = root / name
        availability[name] = (directory.is_dir() and not directory.is_symlink()
                              and _has_example(directory, (suffix,)))
    recommended = {}
    for name, suffixes in RECOMMENDED.items():
        directory = root / name
        recommended[name] = (directory.is_dir() and not directory.is_symlink()
                             and _has_example(directory, suffixes))
    return {
        "data_layout_ready": all(availability.values()),
        "required": availability,
        "recommended": recommended,
        "data_content_verified": False,
        "rights_verified": False,
        "real_worldserver_tested": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', default=os.environ.get('WOTLK_LAB_DATA_DIR', ''),
                        help='Private extracted AzerothCore data root (never printed)')
    args = parser.parse_args(argv)
    try:
        result = inspect_data_dir(args.data_dir)
    except DataPreflightError:
        print(json.dumps({'data_layout_ready': False, 'error': 'invalid-private-data-layout'}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0 if result['data_layout_ready'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
