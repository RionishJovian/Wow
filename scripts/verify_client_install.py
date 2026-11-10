#!/usr/bin/env python3
"""Validate a Build 04+ locally installed Wowser UI before smoke testing.

The manifest records the original build files (before local bridge injection).
This checks payload integrity, not copyright ownership or WoW gameplay.
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

BRIDGE_PATH = Path(__file__).resolve().parents[1] / 'web' / 'client_bridge.mjs'
MAX_MANIFEST_BYTES = 512_000
LOCAL_MANIFEST = 'lab-local-assets.json'
MAX_LOCAL_FILES = 5_000
MAX_LOCAL_BYTES = 256 * 1024 * 1024
ALLOWED_LOCAL_SUFFIXES = frozenset({'.xml', '.lua', '.toc', '.png', '.jpg', '.jpeg', '.ttf', '.otf', '.xsd'})
ALLOWED_EXTRA_FILES = frozenset({'lab-install.json', 'lab-bridge.mjs'})
SCRIPT_LINE = SCRIPT_TAG + '\n'


class VerificationError(ValueError):
    """Client install is missing or has been modified."""


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def safe_name(name: str) -> bool:
    """Require canonical relative POSIX paths without dot segments or separators tricks."""
    path = PurePosixPath(name)
    return (bool(name) and not name.startswith('/') and '\\' not in name
            and path.as_posix() == name and
            all(part not in ('', '.', '..') for part in name.split('/')))


def verify_installation(directory: Path, *, expected_bridge: Path = BRIDGE_PATH) -> dict:
    directory = directory.resolve(strict=True)
    manifest = directory / 'lab-install.json'
    if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size > MAX_MANIFEST_BYTES:
        raise VerificationError('Client installation manifest missing or oversized')
    try:
        report = json.loads(manifest.read_text(encoding='utf-8'))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise VerificationError('Invalid client installation manifest') from exc
    if not isinstance(report, dict) or report.get('provider') != 'wowserhq/client':
        raise VerificationError('Expected pinned Wowser integration build')
    if report.get('source_commit') != UPSTREAM_COMMIT:
        raise VerificationError('Upstream commit does not match reviewed pin')
    if report.get('gameplay_verified') is not False or report.get('assets_bundled') is not False:
        raise VerificationError('Unexpected gameplay/assets claim')
    hashes = report.get('original_sha256')
    if not isinstance(hashes, dict) or not hashes or len(hashes) > MAX_FILES:
        raise VerificationError('Missing original file checksums')
    if report.get('source_file_count') != len(hashes):
        raise VerificationError('Source file count mismatch')
    if 'index.html' not in hashes or 'WOWSER_LICENSE.txt' not in hashes:
        raise VerificationError('Client index and upstream license required')
    # An optional, private, locally installed interface overlay must be separately
    # checksum-verified. These are never part of the GitHub build artifact.
    local_hashes: dict[str, str] = {}
    local_manifest = directory / LOCAL_MANIFEST
    if local_manifest.exists():
        if local_manifest.is_symlink() or local_manifest.stat().st_size > MAX_MANIFEST_BYTES:
            raise VerificationError('Unsafe local UI manifest')
        try:
            local_data = json.loads(local_manifest.read_text(encoding='utf-8'))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise VerificationError('Invalid local UI manifest') from exc
        if not isinstance(local_data, dict) or local_data.get('schema') != 1 or local_data.get('gameplay_verified') is not False:
            raise VerificationError('Invalid local UI manifest version/status')
        local_hashes = local_data.get('sha256')
        if not isinstance(local_hashes, dict) or not local_hashes or len(local_hashes) > MAX_LOCAL_FILES:
            raise VerificationError('Invalid local UI file manifest')
        if local_data.get('file_count') != len(local_hashes):
            raise VerificationError('Local UI file count mismatch')
        local_total = 0
        for name, digest in local_hashes.items():
            if (not isinstance(name, str) or not safe_name(name) or
                    not name.startswith('Interface/') or
                    Path(name).suffix.lower() not in ALLOWED_LOCAL_SUFFIXES):
                raise VerificationError('Unsafe local UI resource path')
            if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest):
                raise VerificationError('Invalid local UI checksum')
            file = directory / name
            if file.is_symlink() or not file.is_file():
                raise VerificationError('Local UI file missing or symlinked')
            actual = file.read_bytes()
            local_total += len(actual)
            if len(actual) > 24 * 1024 * 1024 or sha256(actual) != digest:
                raise VerificationError('Local UI resource failed integrity verification')
        if local_total > MAX_LOCAL_BYTES or local_data.get('total_bytes') != local_total:
            raise VerificationError('Local UI resources exceed limit or recorded size')
    # Do not follow symlinks when enumerating or hashing any installed files.
    all_files: set[str] = set()
    total = 0
    for item in directory.rglob('*'):
        if item.is_symlink():
            raise VerificationError('Symlink in client installation')
        if not item.is_file():
            continue
        name = item.relative_to(directory).as_posix()
        if not safe_name(name):
            raise VerificationError('Invalid installed path')
        total += item.stat().st_size
        all_files.add(name)
        if len(all_files) > MAX_FILES + len(ALLOWED_EXTRA_FILES) + MAX_LOCAL_FILES + 1 or total > MAX_TOTAL_BYTES + MAX_LOCAL_BYTES:
            raise VerificationError('Client installation exceeds safe limits')
    for name in hashes:
        if not isinstance(name, str) or not safe_name(name):
            raise VerificationError('Unsafe path in hash manifest')
    expected = set(hashes) | ALLOWED_EXTRA_FILES | set(local_hashes)
    if local_hashes:
        expected.add(LOCAL_MANIFEST)
    if all_files != expected:
        raise VerificationError('Missing or unrecorded client installation file')
    for name, expected_hash in hashes.items():
        if not isinstance(name, str) or not safe_name(name):
            raise VerificationError('Unsafe path in hash manifest')
        if not isinstance(expected_hash, str) or not re.fullmatch('[a-f0-9]{64}', expected_hash):
            raise VerificationError('Invalid file checksum')
        data = (directory / name).read_bytes()
        if name == 'index.html':
            if data.count(SCRIPT_LINE.encode('utf-8')) != 1:
                raise VerificationError('Missing or duplicate bridge injection')
            data = data.replace(SCRIPT_LINE.encode('utf-8'), b'', 1)
        if sha256(data) != expected_hash:
            raise VerificationError(f'Client asset integrity mismatch: {name}')
    if (directory / 'lab-bridge.mjs').read_bytes() != expected_bridge.read_bytes():
        raise VerificationError('Installed bridge differs from pinned application bridge')
    index = (directory / 'index.html').read_text(encoding='utf-8')
    if not index.startswith('<!DOCTYPE html>') and not index.lower().startswith('<!doctype html>'):
        raise VerificationError('Expected HTML document')
    # Every root-relative JS/CSS resource in the HTML must be under /client/
    # and exist in the package. No remote or root-asset references are permitted.
    refs = re.findall(r'(?:src|href)\s*=\s*[\'\"]([^\'\"]+)[\'\"]', index, re.I)
    for ref in refs:
        if ref.startswith(('https:', 'http:', '//', 'data:', 'javascript:')):
            raise VerificationError('External or inline URL in installed client HTML')
        if ref.startswith('/'):
            if not ref.startswith('/client/'):
                raise VerificationError('Resource escapes local client route')
            rel = ref[len('/client/'):].split('?', 1)[0]
            if not safe_name(rel) or rel not in all_files:
                raise VerificationError(f'Unresolved client resource: {rel}')
    return {
        'verified': True,
        'provider': 'wowserhq/client',
        'source_commit': UPSTREAM_COMMIT,
        'checked_files': len(all_files),
        'local_ui_files': len(local_hashes),
        'gameplay_verified': False,
        'assets_bundled': False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--path', type=Path, default=DEFAULT_DEST)
    args = parser.parse_args()
    try:
        print(json.dumps(verify_installation(args.path), sort_keys=True))
    except (VerificationError, OSError) as exc:
        parser.exit(1, f'Client install verification failed: {exc}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
