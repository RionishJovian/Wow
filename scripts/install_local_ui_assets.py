#!/usr/bin/env python3
"""Stage *locally supplied* extracted 3.3.5a UI resources; never downloads game data.

The files remain under the gitignored local client directory, accessible only
through the development server's loopback-only /client route. Original MPQ/BLP
archives, binaries, and entire game installations are intentionally rejected.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

if __package__:
    from .install_wowser import DEFAULT_DEST
    from .verify_client_install import verify_installation, safe_name
else:
    from install_wowser import DEFAULT_DEST
    from verify_client_install import verify_installation, safe_name

# This is an interface-resource adapter, NOT an MPQ archive extractor.
LOCAL_MANIFEST = 'lab-local-assets.json'
MAX_LOCAL_FILES = 5_000
MAX_LOCAL_BYTES = 256 * 1024 * 1024
ALLOWED_SUFFIXES = frozenset({'.xml', '.lua', '.toc', '.png', '.jpg', '.jpeg', '.ttf', '.otf', '.xsd'})
REQUIRED_UI = frozenset({
    'Interface/GlueXML/GlueFonts.xml',
    'Interface/GlueXML/GlueFontStyles.xml',
})


class LocalAssetsError(ValueError):
    """Requested local UI overlay is incomplete or unsafe."""


def inspect_resources(source: Path) -> tuple[list[tuple[Path, str]], int]:
    """Permit only pre-extracted, converted UI files; no MPQ/BLP/binary input."""
    source = source.resolve(strict=True)
    interface = source / 'Interface'
    if not interface.is_dir() or interface.is_symlink():
        raise LocalAssetsError('Source must contain an Interface directory')
    files: list[tuple[Path, str]] = []
    total = 0
    for file in sorted(interface.rglob('*')):
        if file.is_symlink():
            raise LocalAssetsError('Symlinks are not allowed in UI resources')
        if not file.is_file():
            continue
        name = file.relative_to(source).as_posix()
        if not safe_name(name) or not name.startswith('Interface/'):
            raise LocalAssetsError('Invalid UI resource path')
        if file.suffix.lower() not in ALLOWED_SUFFIXES:
            raise LocalAssetsError(f'Unsupported extracted interface file type: {file.suffix.lower()}')
        size = file.stat().st_size
        if size > 24 * 1024 * 1024:
            raise LocalAssetsError('Single UI resource exceeds local safety limit')
        total += size
        files.append((file, name))
        if len(files) > MAX_LOCAL_FILES or total > MAX_LOCAL_BYTES:
            raise LocalAssetsError('Extracted interface data exceeds local safety limits')
    missing = REQUIRED_UI - {name for _, name in files}
    if missing:
        raise LocalAssetsError('Missing required GlueXML files: ' + ', '.join(sorted(missing)))
    return files, total


def install_local_assets(source: Path, destination: Path = DEFAULT_DEST,
                         *, force: bool = False) -> dict:
    source = source.resolve(strict=True)
    destination = destination.resolve(strict=True)
    if source == destination or source in destination.parents or destination in source.parents:
        raise LocalAssetsError('Input and client installation must not overlap')
    verify_installation(destination)
    if (destination / LOCAL_MANIFEST).exists() and not force:
        raise LocalAssetsError('A local UI overlay exists; --force is needed to replace it')
    files, total = inspect_resources(source)
    stage = Path(tempfile.mkdtemp(prefix='.wotlk-ui-stage-', dir=destination.parent))
    backup = None
    try:
        # Preserve pinned upstream files and bridge without modifying the original
        # installation until the new package passes the full integrity check.
        shutil.copytree(destination, stage, dirs_exist_ok=True, symlinks=False)
        # Remove previous tracked UI data if replacing an existing overlay.
        if (stage / LOCAL_MANIFEST).exists():
            old = json.loads((stage / LOCAL_MANIFEST).read_text(encoding='utf-8'))
            for name in old['sha256']:
                (stage / name).unlink()
            (stage / LOCAL_MANIFEST).unlink()
        checksums = {}
        for file, name in files:
            target = stage / name
            if target.exists():
                raise LocalAssetsError('Local data would overwrite an upstream client file')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, target)
            checksums[name] = hashlib.sha256(target.read_bytes()).hexdigest()
        report = {'schema': 1, 'sha256': checksums, 'file_count': len(files),
                  'total_bytes': total, 'gameplay_verified': False}
        (stage / LOCAL_MANIFEST).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        verify_installation(stage)
        backup = Path(tempfile.mkdtemp(prefix='.wotlk-ui-backup-', dir=destination.parent))
        backup.rmdir()
        os.replace(destination, backup)
        try:
            os.replace(stage, destination)
        except OSError:
            os.replace(backup, destination)
            raise
        shutil.rmtree(backup)
        backup = None
        return {'installed_files': len(files), 'total_bytes': total,
                'required_glue_xml_present': True, 'gameplay_verified': False}
    finally:
        if stage.exists():
            shutil.rmtree(stage)
        # Do not remove a backup when replacement failed; preserve recoverability.


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('extracted_root', type=Path,
                        help='Local directory containing Interface/ from a legitimately obtained game installation')
    parser.add_argument('--dest', type=Path, default=DEFAULT_DEST)
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    try:
        report = install_local_assets(args.extracted_root, args.dest, force=args.force)
    except (OSError, LocalAssetsError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(report, sort_keys=True))
    print('Local interface resources installed; WoW login or gameplay NOT verified.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
