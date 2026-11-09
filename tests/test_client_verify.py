"""Offline tests for the pinned Wowser UI installation verifier."""
import hashlib
import json
import shutil
from pathlib import Path

import pytest

from scripts.install_wowser import SCRIPT_TAG
from scripts.prepare_wowser import UPSTREAM_COMMIT
from scripts.verify_client_install import VerificationError, verify_installation


def fixture_install(tmp_path: Path) -> Path:
    directory = tmp_path / "wowser"
    (directory / "assets").mkdir(parents=True)
    original_index = ('<!DOCTYPE html><html><body><canvas></canvas>'
                      '<script type="module" src="/client/assets/client.js"></script>'
                      '</body></html>')
    originals = {
        "index.html": original_index.encode(),
        "assets/client.js": b'console.log("client");',
        "WOWSER_LICENSE.txt": b"MIT original client",
    }
    for name, contents in originals.items():
        destination = directory / name
        destination.parent.mkdir(exist_ok=True, parents=True)
        destination.write_bytes(contents)
    (directory / "index.html").write_text(
        original_index.replace("</body>", SCRIPT_TAG + "\n</body>")
    )
    shutil.copyfile(Path(__file__).resolve().parents[1] / "web/client_bridge.mjs",
                    directory / "lab-bridge.mjs")
    (directory / "lab-install.json").write_text(json.dumps({
        "provider": "wowserhq/client",
        "source_commit": UPSTREAM_COMMIT,
        "original_sha256": {
            name: hashlib.sha256(contents).hexdigest()
            for name, contents in originals.items()
        },
        "source_file_count": 3,
        "gameplay_verified": False,
        "assets_bundled": False,
    }))
    return directory


def test_valid_assetless_ui_is_verified_without_claiming_gameplay(tmp_path):
    result = verify_installation(fixture_install(tmp_path))
    assert result["verified"]
    assert result["checked_files"] == 5
    assert result["gameplay_verified"] is False
    assert result["assets_bundled"] is False


@pytest.mark.parametrize("tampering", [
    "javascript", "manifest", "extra", "missing", "bridge", "path",
    "unknown-commit", "claimed-gameplay", "foreign-resource",
])
def test_modified_or_unsafe_build_is_rejected(tmp_path, tampering):
    root = fixture_install(tmp_path)
    report_path = root / "lab-install.json"
    report = json.loads(report_path.read_text())
    if tampering == "javascript":
        (root / "assets/client.js").write_text("modified")
    elif tampering == "manifest":
        report["original_sha256"]["index.html"] = "nope"
    elif tampering == "extra":
        (root / "unexpected.js").write_text("extra")
    elif tampering == "missing":
        (root / "assets/client.js").unlink()
    elif tampering == "bridge":
        (root / "lab-bridge.mjs").write_text("changed")
    elif tampering == "path":
        report["original_sha256"]["../private"] = "a" * 64
    elif tampering == "unknown-commit":
        report["source_commit"] = "0" * 40
    elif tampering == "claimed-gameplay":
        report["gameplay_verified"] = True
    elif tampering == "foreign-resource":
        (root / "index.html").write_text(
            (root / "index.html").read_text().replace(
                "/client/assets/client.js", "https://untrusted.example/client.js"
            )
        )
    report_path.write_text(json.dumps(report))
    with pytest.raises(VerificationError):
        verify_installation(root)


def test_reject_symlink_to_external_files(tmp_path):
    root = fixture_install(tmp_path)
    (root / "leak.txt").symlink_to(root / "assets/client.js")
    with pytest.raises(VerificationError, match="Symlink"):
        verify_installation(root)
