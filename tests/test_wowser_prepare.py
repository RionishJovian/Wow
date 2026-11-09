"""Network-free verification of the pinned upstream patch and local build pipeline."""
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts import build_wowser_client as build_module
from scripts import prepare_wowser as prep


UPSTREAM_ENTRY = """import Client from './Client';
import EventType from './ui/scripting/EventType';
const canvas = document.querySelector('canvas')!;
const client = new Client(canvas, { api });
(async () => {
  await client.ui.load('Wowser\\\\Wowser.toc');
  const updateAndRender = () => {
    client.screen.render();
  };
})();
"""


def create_fake_upstream(tmp_path: Path) -> Path:
    upstream = tmp_path / "upstream"
    (upstream / "src").mkdir(parents=True)
    (upstream / "src" / "index.ts").write_text(UPSTREAM_ENTRY)
    (upstream / "package.json").write_text('{"name":"wowser-test"}')
    (upstream / "LICENSE").write_text('MIT LICENSE TEST')
    return upstream


def test_instrumentation_applies_only_to_expected_real_entry_anchors():
    patched = prep.instrument_entrypoint(UPSTREAM_ENTRY)
    assert "setLabStage('client-created')" in patched
    assert "setLabStage('loading-ui')" in patched
    assert "setLabStage('ui-loader-returned')" in patched
    assert "setLabStage('first-render-call')" in patched
    assert "setLabStage('resource-load-failed')" in patched
    assert "setLabStage('render-failed')" in patched
    assert "await client.ui.load('Wowser\\\\Wowser.toc');" in patched
    assert "client.screen.render();" in patched
    with pytest.raises(prep.WowserPreparationError, match="missing or ambiguous"):
        prep.instrument_entrypoint(UPSTREAM_ENTRY.replace("client.screen.render();", "some_other_api();"))
    with pytest.raises(prep.WowserPreparationError, match="missing or ambiguous"):
        prep.instrument_entrypoint(UPSTREAM_ENTRY.replace("import Client from './Client';", ""))


def test_prepare_verifies_pin_and_keeps_sources_pristine_on_error(monkeypatch, tmp_path):
    upstream = create_fake_upstream(tmp_path)
    monkeypatch.setattr(prep, "verify_checkout", lambda path, runner=None: prep.UPSTREAM_COMMIT)
    prep.prepare(upstream)
    assert (upstream / "src/wotlk-lab-stage.ts").is_file()
    assert "setLabStage('client-created')" in (upstream / "src/index.ts").read_text()
    with pytest.raises(prep.WowserPreparationError, match="pristine"):
        prep.prepare(upstream)


def test_verify_checkout_fails_closed_on_unpinned_code(tmp_path):
    root = create_fake_upstream(tmp_path)
    def fake_git(argv, **kwargs):
        assert argv[0] == 'git'
        return SimpleNamespace(stdout='0' * 40)
    with pytest.raises(prep.WowserPreparationError, match="Unexpected upstream commit"):
        prep.verify_checkout(root, runner=fake_git)
    (root / 'LICENSE').unlink()
    with pytest.raises(prep.WowserPreparationError, match="license missing"):
        prep.verify_checkout(root, runner=fake_git)


def test_offline_build_uses_pinned_source_and_preserves_original(monkeypatch, tmp_path):
    upstream = create_fake_upstream(tmp_path)
    # The real CLI requires the pinned commit. Test the build mechanics offline.
    monkeypatch.setattr(prep, "verify_checkout", lambda *_a, **_k: prep.UPSTREAM_COMMIT)
    monkeypatch.setattr(build_module, "verify_checkout", lambda *_a, **_k: prep.UPSTREAM_COMMIT)
    calls = []
    def fake_npm(argv, **kwargs):
        calls.append(argv)
        if argv[:3] == ['npm', 'run', 'build']:
            dist = kwargs['cwd'] / 'dist'
            dist.mkdir()
            (dist / 'index.html').write_text('<!doctype html><body><script src="/client/assets/main.js"></script></body>')
            (dist / 'assets').mkdir()
            (dist / 'assets' / 'main.js').write_text('console.log("compiled upstream test placeholder")')
    destination = tmp_path / 'installed'
    report = build_module.build(source=upstream, destination=destination, runner=fake_npm)
    assert report['provider'] == 'wowserhq/client'
    assert report['source_commit'] == prep.UPSTREAM_COMMIT
    assert report['gameplay_verified'] is False
    assert report['assets_bundled'] is False
    assert (destination / 'WOWSER_LICENSE.txt').read_text() == 'MIT LICENSE TEST'
    assert (destination / 'lab-bridge.mjs').exists()
    assert (destination / 'lab-install.json').exists()
    assert "setLabStage(" not in (upstream / 'src/index.ts').read_text()
    assert not (upstream / 'src/wotlk-lab-stage.ts').exists()
    assert calls == [
        ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
        ['npm', 'run', 'build', '--', '--base=/client/'],
    ]
    with pytest.raises(ValueError, match='already exists'):
        build_module.build(source=upstream, destination=destination, runner=fake_npm)
