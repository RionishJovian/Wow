from pathlib import Path
import pytest

from scripts.install_wowser import ClientInstallError, install, validate_build


def fixture_build(tmp_path):
    source = tmp_path / "original-client-dist"
    source.mkdir()
    (source / "index.html").write_text(
        '<!doctype html><html><body><script type="module" '
        'src="/client/assets/app.js"></script></body></html>')
    (source / "assets").mkdir()
    (source / "assets/app.js").write_text('console.log("third party placeholder");')
    return source


def test_local_installer_injects_bridge_and_records_sources(tmp_path):
    source = fixture_build(tmp_path)
    dest = tmp_path / "installed"
    report = install(source, dest)
    assert report["source_file_count"] == 2
    assert not report["gameplay_verified"]
    assert (dest / "index.html").read_text().count('src="/client/lab-bridge.mjs"') == 1
    assert "wotlk-lab-client-v1" in (dest / "lab-bridge.mjs").read_text()
    assert "original_sha256" in (dest / "lab-install.json").read_text()
    with pytest.raises(ClientInstallError):
        install(source, dest)
    install(source, dest, force=True)


def test_installer_rejects_misconfigured_and_unsafe_builds(tmp_path):
    source = fixture_build(tmp_path)
    (source / "index.html").write_text('<html><script src="/assets/app.js"></script></body>')
    with pytest.raises(ClientInstallError, match="Root-relative"):
        validate_build(source)
    (source / "index.html").write_text('<html></body>')
    (source / "Data.mpq").write_bytes(b'not actual game data')
    with pytest.raises(ClientInstallError, match="Raw game asset"):
        validate_build(source)
    (source / "Data.mpq").unlink()
    (source / "assets" / "linked.js").symlink_to("app.js")
    with pytest.raises(ClientInstallError, match="Symlink"):
        validate_build(source)


def test_installer_rejects_overlapping_paths(tmp_path):
    source = fixture_build(tmp_path)
    with pytest.raises(ClientInstallError, match="overlap"):
        install(source, source / "nested")
