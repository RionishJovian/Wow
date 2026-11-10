"""Read-only WotLK preflight fixtures; no proprietary files."""
from pathlib import Path
import json
import struct

import pytest

from scripts.preflight_wotlk_install import (
    PreflightError, child_with_case, inspect_installation, validate_mpq_header,
)


def make_archive(path: Path, *, good=True, header_offset=0, version=0):
    path.parent.mkdir(parents=True, exist_ok=True)
    archive = bytearray(header_offset + 96)
    if good:
        archive[header_offset:header_offset+4] = b'MPQ\x1a'
        struct.pack_into('<II', archive, header_offset+4, 32, 96)
        struct.pack_into('<HH', archive, header_offset+12, version, 3)
    path.write_bytes(archive)


def make_candidate(tmp_path: Path) -> Path:
    root = tmp_path / 'World of Warcraft'
    for name in ('common.MPQ', 'expansion.MPQ', 'lichking.MPQ'):
        make_archive(root / 'Data' / name)
    make_archive(root / 'Data' / 'enUS' / 'locale-enUS.MPQ')
    return root


def test_candidate_only_never_proves_build_or_gameplay(tmp_path):
    root = make_candidate(tmp_path)
    data = inspect_installation(root)
    assert data['wotlk_data_candidate'] is True
    assert data['core_archive_headers_consistent'] is True
    assert data['locale_archive_header_present'] is True
    assert data['exact_build_verified'] is False
    assert data['browser_client_verified'] is False
    assert data['gameplay_verified'] is False
    assert str(root) not in json.dumps(data)
    assert inspect_installation(root / 'Data')['wotlk_data_candidate'] is True


def test_unknown_build_cannot_be_inferred_from_mpq_header(tmp_path):
    root = make_candidate(tmp_path)
    (root / 'Wow.exe').write_bytes(b'untrusted arbitrary binary')
    result = inspect_installation(root)
    assert result['exact_build_verified'] is False


def test_missing_or_corrupt_core_archive_fails_candidate(tmp_path):
    root = make_candidate(tmp_path)
    (root / 'Data' / 'lichking.MPQ').unlink()
    assert inspect_installation(root)['wotlk_data_candidate'] is False
    make_archive(root / 'Data' / 'lichking.MPQ', good=False)
    assert inspect_installation(root)['core_archives'][2]['reason'] == 'mpq_signature_missing'
    assert inspect_installation(root)['wotlk_data_candidate'] is False


def test_missing_or_corrupt_locale_fails_candidate(tmp_path):
    root = make_candidate(tmp_path)
    locale = root / 'Data' / 'enUS' / 'locale-enUS.MPQ'
    make_archive(locale, good=False)
    assert inspect_installation(root)['wotlk_data_candidate'] is False


def test_reject_symlinks_as_archives_and_data_root(tmp_path):
    root = make_candidate(tmp_path)
    archive = root / 'Data' / 'common.MPQ'
    archive.unlink()
    archive.symlink_to(root / 'Data' / 'expansion.MPQ')
    result = inspect_installation(root)
    assert result['core_archives'][0]['reason'] == 'symlink_rejected'
    assert result['wotlk_data_candidate'] is False
    alias = tmp_path / 'alias'
    alias.symlink_to(root)
    with pytest.raises(PreflightError, match='Symlinked'):
        inspect_installation(alias)


def test_detects_offset_512_mpq_header_and_rejects_invalid_sizes(tmp_path):
    f = tmp_path / 'data.MPQ'
    make_archive(f, header_offset=512)
    assert validate_mpq_header(f)[0] is True
    contents = bytearray(f.read_bytes())
    struct.pack_into('<I', contents, 512 + 8, 100_000_000)
    f.write_bytes(contents)
    assert validate_mpq_header(f)[1] == 'invalid_archive_length'


def test_inspection_limits_io_to_header_only(tmp_path, monkeypatch):
    root = make_candidate(tmp_path)
    # Trapping open(..., 'rb') would be needlessly intrusive; consistency of
    # this function's MAX_HEADER_BYTES read is separately source-reviewed.
    assert inspect_installation(root)['schema'] == 1


def test_duplicate_case_insensitive_archives_rejected(tmp_path):
    root = make_candidate(tmp_path)
    (root / 'Data' / 'COMMON.MPQ').write_bytes((root / 'Data' / 'common.MPQ').read_bytes())
    with pytest.raises(PreflightError, match='Ambiguous'):
        inspect_installation(root)


def test_nonexistent_or_non_game_directory(tmp_path):
    with pytest.raises(PreflightError, match='does not exist'):
        inspect_installation(tmp_path / 'missing')
    with pytest.raises(PreflightError, match='Data'):
        inspect_installation(tmp_path)
