"""No Blizzard content: generated fixture files simulate extracted UI resources."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.install_local_ui_assets import LocalAssetsError, install_local_assets, inspect_resources
from scripts.verify_client_install import VerificationError, verify_installation
from scripts.install_wowser import SCRIPT_TAG
from scripts.prepare_wowser import UPSTREAM_COMMIT
import hashlib
import shutil


def make_artifact(tmp_path: Path) -> Path:
    """Self-contained pinned UI fixture; never depends on another test module."""
    folder = tmp_path / 'installed'
    (folder / 'assets').mkdir(parents=True)
    originals = {
        'index.html': ('<!DOCTYPE html><html><body><canvas></canvas>'
                       '<script type="module" src="/client/assets/wowser.js"></script>'
                       '</body></html>').encode(),
        'assets/wowser.js': b'console.log("synthetic MIT fixture");',
        'WOWSER_LICENSE.txt': b'MIT upstream fixture',
    }
    for name, data in originals.items():
        file = folder / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
    index = originals['index.html'].decode().replace('</body>', SCRIPT_TAG + '\n</body>')
    (folder / 'index.html').write_text(index)
    shutil.copyfile(Path(__file__).resolve().parents[1] / 'web/client_bridge.mjs',
                    folder / 'lab-bridge.mjs')
    (folder / 'lab-install.json').write_text(json.dumps({
        'provider': 'wowserhq/client', 'source_commit': UPSTREAM_COMMIT,
        'original_sha256': {name: hashlib.sha256(data).hexdigest()
                            for name, data in originals.items()},
        'source_file_count': len(originals),
        'gameplay_verified': False, 'assets_bundled': False,
    }))
    return folder


def fake_ui(root: Path) -> Path:
    folder = root / 'source'
    (folder / 'Interface' / 'GlueXML').mkdir(parents=True)
    for name in ('GlueFonts.xml', 'GlueFontStyles.xml'):
        (folder / 'Interface' / 'GlueXML' / name).write_text('<Ui />')
    (folder / 'Interface' / 'GlueXML' / 'UI.lua').write_text('x = 1')
    return folder


def test_install_and_verify_locally_supplied_extracted_resources(tmp_path):
    source = fake_ui(tmp_path)
    artifact = make_artifact(tmp_path)
    result = install_local_assets(source, artifact)
    assert result['installed_files'] == 3
    assert result['gameplay_verified'] is False
    assert (artifact / 'Interface/GlueXML/GlueFonts.xml').read_text() == '<Ui />'
    verified = verify_installation(artifact)
    assert verified['verified'] and verified['local_ui_files'] == 3
    assert verified['assets_bundled'] is False


def test_tampering_with_local_data_fails_integrity_check(tmp_path):
    artifact = make_artifact(tmp_path)
    install_local_assets(fake_ui(tmp_path), artifact)
    (artifact / 'Interface/GlueXML/UI.lua').write_text('malicious replacement')
    with pytest.raises(VerificationError, match='integrity'):
        verify_installation(artifact)


def test_replace_requires_force_and_removes_outdated_files(tmp_path):
    artifact = make_artifact(tmp_path)
    source = fake_ui(tmp_path)
    install_local_assets(source, artifact)
    with pytest.raises(LocalAssetsError, match='--force'):
        install_local_assets(source, artifact)
    (source / 'Interface/GlueXML/UI.lua').unlink()
    result = install_local_assets(source, artifact, force=True)
    assert result['installed_files'] == 2
    assert not (artifact / 'Interface/GlueXML/UI.lua').exists()
    assert verify_installation(artifact)['local_ui_files'] == 2


def test_bad_input_does_not_damage_existing_installation(tmp_path):
    artifact = make_artifact(tmp_path)
    source = fake_ui(tmp_path)
    (source / 'Interface/GlueXML/GlueFonts.xml').unlink()
    with pytest.raises(LocalAssetsError, match='Missing required'):
        install_local_assets(source, artifact)
    assert verify_installation(artifact)['verified']


def test_rejects_binaries_game_archives_and_symlinks(tmp_path):
    source = fake_ui(tmp_path)
    archive = source / 'Interface/GlueXML/bad.mpq'
    archive.write_bytes(b'fake')
    with pytest.raises(LocalAssetsError, match='Unsupported'):
        inspect_resources(source)
    archive.unlink()
    link = source / 'Interface/GlueXML/link.xml'
    link.symlink_to(source / 'Interface/GlueXML/GlueFonts.xml')
    with pytest.raises(LocalAssetsError, match='Symlinks'):
        inspect_resources(source)


def test_manifest_traversal_and_untracked_assets_are_rejected(tmp_path):
    artifact = make_artifact(tmp_path)
    install_local_assets(fake_ui(tmp_path), artifact)
    path = artifact / 'lab-local-assets.json'
    report = json.loads(path.read_text())
    report['sha256']['../secret.xml'] = 'f' * 64
    report['file_count'] += 1
    path.write_text(json.dumps(report))
    with pytest.raises(VerificationError, match='Unsafe local UI'):
        verify_installation(artifact)


def test_rejects_source_target_overlap(tmp_path):
    artifact = make_artifact(tmp_path)
    source = fake_ui(artifact)
    with pytest.raises(LocalAssetsError, match='overlap'):
        install_local_assets(source, artifact)
