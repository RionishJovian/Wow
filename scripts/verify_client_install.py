#!/usr/bin/env python3
"""Verify a pinned, asset-free Wowser UI installation before serving it.

Checks bundle integrity, not copyright ownership or WoW gameplay.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath

if __package__:
    from .install_wowser import DEFAULT_DEST, MAX_FILES, MAX_TOTAL_BYTES, SCRIPT_TAG
    from .prepare_wowser import UPSTREAM_COMMIT
else:
    from install_wowser import DEFAULT_DEST, MAX_FILES, MAX_TOTAL_BYTES, SCRIPT_TAG
    from prepare_wowser import UPSTREAM_COMMIT

BRIDGE_PATH = Path(__file__).resolve().parents[1] / "web" / "client_bridge.mjs"
MAX_MANIFEST_BYTES = 512_000
ALLOWED_EXTRA_FILES = frozenset({"lab-install.json", "lab-bridge.mjs"})
SCRIPT_LINE = SCRIPT_TAG + "\n"


class VerificationError(ValueError):
    """Missing, modified, or untrusted installed client files."""


def safe_name(name: str) -> bool:
    if not isinstance(name, str):
        return False
    path = PurePosixPath(name)
    return (bool(name) and not name.startswith("/") and "\\" not in name
            and path.as_posix() == name
            and all(part not in ("", ".", "..") for part in name.split("/")))


def verify_installation(directory: Path, *, expected_bridge: Path = BRIDGE_PATH) -> dict:
    directory = directory.resolve(strict=True)
    manifest = directory / "lab-install.json"
    if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size > MAX_MANIFEST_BYTES:
        raise VerificationError("Missing or oversized client manifest")
    try:
        report = json.loads(manifest.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise VerificationError("Invalid client manifest") from exc
    if not isinstance(report, dict) or report.get("provider") != "wowserhq/client":
        raise VerificationError("Not an approved pinned Wowser build")
    if report.get("source_commit") != UPSTREAM_COMMIT:
        raise VerificationError("Wrong upstream commit")
    if report.get("gameplay_verified") is not False or report.get("assets_bundled") is not False:
        raise VerificationError("Unsafe gameplay or game assets claim")
    hashes = report.get("original_sha256")
    if not isinstance(hashes, dict) or not hashes or len(hashes) > MAX_FILES:
        raise VerificationError("Missing checksums")
    if report.get("source_file_count") != len(hashes):
        raise VerificationError("Source file count mismatch")
    if not {"index.html", "WOWSER_LICENSE.txt"}.issubset(hashes):
        raise VerificationError("Missing index or MIT license")

    files = set()
    total_bytes = 0
    for path in directory.rglob("*"):
        if path.is_symlink():
            raise VerificationError("Symlinks not permitted")
        if not path.is_file():
            continue
        relative = path.relative_to(directory).as_posix()
        if not safe_name(relative):
            raise VerificationError("Invalid file path")
        files.add(relative)
        total_bytes += path.stat().st_size
        if len(files) > MAX_FILES + len(ALLOWED_EXTRA_FILES) or total_bytes > MAX_TOTAL_BYTES:
            raise VerificationError("Client installation exceeds limits")
    if any(not safe_name(name) for name in hashes):
        raise VerificationError("Unsafe manifest path")
    if files != set(hashes) | ALLOWED_EXTRA_FILES:
        raise VerificationError("Missing or unrecorded files")

    for name, expected in hashes.items():
        if not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
            raise VerificationError("Invalid checksum")
        contents = (directory / name).read_bytes()
        if name == "index.html":
            injection = SCRIPT_LINE.encode("utf-8")
            if contents.count(injection) != 1:
                raise VerificationError("Missing or duplicate bridge injection")
            contents = contents.replace(injection, b"", 1)
        if hashlib.sha256(contents).hexdigest() != expected:
            raise VerificationError("Client asset integrity mismatch: " + name)

    if (directory / "lab-bridge.mjs").read_bytes() != expected_bridge.read_bytes():
        raise VerificationError("Installed bridge differs from source")
    index = (directory / "index.html").read_text(encoding="utf-8")
    if not index.lower().startswith("<!doctype html>"):
        raise VerificationError("Expected HTML document")
    references = re.findall(r"""(?:src|href)\s*=\s*['"]([^'"]+)['"]""", index, re.I)
    for ref in references:
        if ref.startswith(("https:", "http:", "//", "data:", "javascript:")):
            raise VerificationError("External resource reference")
        if ref.startswith("/"):
            if not ref.startswith("/client/"):
                raise VerificationError("Resource escapes local client route")
            rel = ref[len("/client/"):].split("?", 1)[0]
            if not safe_name(rel) or rel not in files:
                raise VerificationError("Missing compiled client resource: " + rel)
    return {
        "verified": True,
        "checked_files": len(files),
        "source_commit": UPSTREAM_COMMIT,
        "gameplay_verified": False,
        "assets_bundled": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=DEFAULT_DEST)
    args = parser.parse_args()
    try:
        print(json.dumps(verify_installation(args.path), sort_keys=True))
    except (OSError, VerificationError) as exc:
        parser.exit(1, f"Client verification failed: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
