#!/usr/bin/env python3
"""Read-only, local WotLK archive preflight; NO copies, uploads, or executable runs.

This is a candidate-data detector, NOT a certificate that an installation
is build 12340 or can authenticate/render gameplay in a browser. The MPQ
magic/header checks are deliberately shallow and do not extract Blizzard data.
"""
from __future__ import annotations

import argparse
import json
import re
import stat
import struct
from pathlib import Path

# Core WotLK-era archive names. Common-2 and patches are expected in many
# installations but do not independently identify the build number.
CORE_ARCHIVES = ('common.MPQ', 'expansion.MPQ', 'lichking.MPQ')
SUPPLEMENTAL_ARCHIVES = ('common-2.MPQ', 'patch.MPQ', 'patch-2.MPQ', 'patch-3.MPQ')
LOCALE_PATTERN = re.compile(r'^[a-z]{2}[A-Z]{2}$')
MAX_HEADER_BYTES = 1024


class PreflightError(ValueError):
    """Unsafe or unreadable candidate installation."""


def child_with_case(parent: Path, name: str) -> Path | None:
    """Only direct children; reject ambiguous casefolded duplicates."""
    matches = [p for p in parent.iterdir() if p.name.casefold() == name.casefold()]
    if len(matches) > 1:
        raise PreflightError('Ambiguous archive names on this filesystem')
    return matches[0] if matches else None


def validate_mpq_header(path: Path) -> tuple[bool, str, int]:
    """Check only MPQ header consistency, never decode archive contents.

    Header offset 0 and 512 are both used by MPQ containers. A valid MPQ
    header alone does not demonstrate intact resources or Blizzard provenance.
    """
    if path.is_symlink():
        return False, 'symlink_rejected', 0
    try:
        info = path.stat()
        if not stat.S_ISREG(info.st_mode):
            return False, 'not_regular_file', 0
        if info.st_size < 32:
            return False, 'too_small', info.st_size
        with path.open('rb') as handle:
            sample = handle.read(MAX_HEADER_BYTES)
    except OSError:
        return False, 'unreadable', 0
    for offset in (0, 512):
        if sample[offset:offset + 4] != b'MPQ\x1a':
            continue
        if len(sample) < offset + 32:
            return False, 'short_header', info.st_size
        header_size, archive_size = struct.unpack_from('<II', sample, offset + 4)
        format_version, block_shift = struct.unpack_from('<HH', sample, offset + 12)
        if not (32 <= header_size <= 4096):
            return False, 'invalid_header_size', info.st_size
        if archive_size < header_size or archive_size > info.st_size - offset:
            return False, 'invalid_archive_length', info.st_size
        if format_version not in (0, 1) or block_shift > 16:
            return False, 'unsupported_mpq_header', info.st_size
        return True, 'header_consistent', info.st_size
    return False, 'mpq_signature_missing', info.st_size


def _archive_entry(data: Path, name: str) -> dict:
    item = child_with_case(data, name)
    if item is None:
        return {'name': name, 'present': False, 'header_consistent': False, 'reason': 'missing'}
    valid, reason, size = validate_mpq_header(item)
    return {'name': name, 'present': True, 'header_consistent': valid,
            'reason': reason, 'size_bytes': size}


def inspect_installation(root: Path) -> dict:
    """Inspect a user-owned directory without returning any absolute paths."""
    if root.is_symlink():
        raise PreflightError('Symlinked installation roots are not accepted')
    try:
        if not root.is_dir():
            raise PreflightError('Installation root does not exist or is not a directory')
        data = root if root.name.casefold() == 'data' else child_with_case(root, 'Data')
        if data is None or not data.is_dir() or data.is_symlink():
            raise PreflightError('Expected a local Data/ directory')
        archives = [_archive_entry(data, name) for name in CORE_ARCHIVES]
        supplements = [_archive_entry(data, name) for name in SUPPLEMENTAL_ARCHIVES]
        # Locale folder casing is meaningful inside the name (enUS, etc).
        locale_candidates = [p for p in data.iterdir()
                             if LOCALE_PATTERN.fullmatch(p.name) and p.is_dir() and not p.is_symlink()]
        if len(locale_candidates) > 16:
            raise PreflightError('Unexpected number of locale directories')
        locales = []
        for folder in sorted(locale_candidates, key=lambda x: x.name):
            item = _archive_entry(folder, f'locale-{folder.name}.MPQ')
            locales.append({'locale': folder.name, 'locale_archive': item})
    except (OSError, PermissionError) as exc:
        raise PreflightError('Cannot read local installation directory') from exc
    core_ready = all(a['header_consistent'] for a in archives)
    locale_ready = any(l['locale_archive']['header_consistent'] for l in locales)
    return {
        'schema': 1,
        'kind': 'local_wotlk_data_preflight',
        'core_archives': archives,
        'supplemental_archives': supplements,
        'locales': locales,
        'core_archive_headers_consistent': core_ready,
        'locale_archive_header_present': locale_ready,
        'wotlk_data_candidate': core_ready and locale_ready,
        'exact_build_target': '3.3.5a (12340)',
        'exact_build_verified': False,
        'asset_contents_verified': False,
        'browser_client_verified': False,
        'gameplay_verified': False,
        'note': ('Only archive names and MPQ header consistency checked. '
                 'No archive contents were extracted; build 12340 and gameplay cannot be certified.'),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('installation', type=Path,
                        help='Path to YOUR local WotLK installation or its Data directory')
    args = parser.parse_args()
    try:
        result = inspect_installation(args.installation)
    except PreflightError as exc:
        parser.exit(2, f'Local validation unavailable: {exc}\n')
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0 if result['wotlk_data_candidate'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
