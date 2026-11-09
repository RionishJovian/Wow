#!/usr/bin/env python3
"""Install a separately built, user-authorized browser client for local-only testing.

No Blizzard assets, third-party repositories or compiled clients are downloaded
by this script. The installation target is gitignored and not publishable.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DEST = ROOT / ".local-wowser-client"
MAX_FILES = 2000
MAX_TOTAL_BYTES = 500 * 1024 * 1024
SCRIPT_TAG = '<script type="module" src="/client/lab-bridge.mjs"></script>'


class ClientInstallError(ValueError):
    """Invalid or potentially unsafe external client build."""


def validate_build(source: Path) -> tuple[list[Path], str]:
    source = source.resolve(strict=True)
    index_file = source / "index.html"
    if not index_file.is_file() or index_file.is_symlink():
        raise ClientInstallError("Missing index.html in the supplied build")
    index = index_file.read_text(encoding="utf-8")
    if '</body>' not in index.lower():
        raise ClientInstallError("Expected an HTML document with </body>")
    # Existing Vite bundles normally need `vite build --base=/client/`.
    if re.search(r'(?:src|href)=["\']/(?!client/|favicon\b|$)[^"\']+', index):
        raise ClientInstallError("Root-relative assets detected: rebuild upstream with --base=/client/")
    files: list[Path] = []
    total = 0
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise ClientInstallError(f"Symlink rejected: {path.relative_to(source)}")
        if not path.is_file():
            continue
        if path.suffix.lower() in {".mpq", ".dbc", ".adt", ".wdt", ".wmo", ".m2", ".blp"}:
            raise ClientInstallError("Raw game asset files are outside this integration's scope")
        total += path.stat().st_size
        files.append(path)
        if len(files) > MAX_FILES or total > MAX_TOTAL_BYTES:
            raise ClientInstallError("Client build exceeds local safety limits")
    return files, index


def install(source: Path, destination: Path, *, force: bool = False) -> dict:
    """Copy only into an explicit local directory; refuse destination collisions by default."""
    source = source.resolve(strict=True)
    destination = destination.resolve(strict=False)
    if destination == source or source in destination.parents or destination in source.parents:
        raise ClientInstallError("Source and destination may not overlap")
    if destination.exists() and not force:
        raise ClientInstallError("Destination already exists; pass --force to replace it")
    files, index = validate_build(source)
    bridge = ROOT / "web/client_bridge.mjs"
    if not bridge.is_file():
        raise ClientInstallError("Missing local bridge source")
    # Build the new install in a separate temporary folder before replacing.
    import tempfile
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="wotlk-client-", dir=destination.parent))
    try:
        hashes = {}
        for original in files:
            rel = original.relative_to(source)
            target = stage / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
            hashes[rel.as_posix()] = hashlib.sha256(target.read_bytes()).hexdigest()
        lower = index.lower()
        insert_at = lower.rfind('</body>')
        injected = index[:insert_at] + SCRIPT_TAG + '\n' + index[insert_at:]
        (stage / "index.html").write_text(injected, encoding="utf-8")
        shutil.copyfile(bridge, stage / "lab-bridge.mjs")
        report = {
            "provider": "external-browser-client",
            "source_file_count": len(files),
            "original_sha256": hashes,
            "bridge": "wotlk-lab-client-v1",
            "gameplay_verified": False,
        }
        (stage / "lab-install.json").write_text(json.dumps(report, indent=2) + "\n")
        if destination.exists():
            shutil.rmtree(destination)
        stage.rename(destination)
        return report
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build_dir", type=Path, help="Upstream client dist/ (with index.html)")
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    parser.add_argument("--force", action="store_true", help="Replace an existing local install")
    args = parser.parse_args()
    try:
        report = install(args.build_dir, args.dest, force=args.force)
    except (ClientInstallError, OSError) as exc:
        parser.error(str(exc))
    print(f"Installed {report['source_file_count']} client files into {args.dest}")
    print("This confirms only an installed UI build; WoW gameplay is NOT verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
