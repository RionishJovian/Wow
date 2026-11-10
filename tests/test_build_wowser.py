"""Build logic tests with MIT-owned *synthetic* UI fixtures, not Blizzard files."""
from pathlib import Path

import pytest

from scripts.build_wowser_client import UPSTREAM_UI, copy_upstream_ui
from scripts.prepare_wowser import WowserPreparationError


def test_copy_only_selected_upstream_authored_sample_files(tmp_path):
    work = tmp_path / 'src'
    ui = work / 'public' / 'Wowser'
    ui.mkdir(parents=True)
    for name in UPSTREAM_UI:
        (ui / name).write_text('<Ui/>')
    (ui / 'game-content.MPQ').write_bytes(b'not allowed')
    dist = tmp_path / 'dist'
    dist.mkdir()
    copy_upstream_ui(work, dist)
    assert sorted(p.name for p in (dist / 'Wowser').iterdir()) == sorted(UPSTREAM_UI)
    assert not (dist / 'Wowser/game-content.MPQ').exists()


def test_missing_upstream_file_fails_closed(tmp_path):
    work = tmp_path / 'src'
    (work / 'public/Wowser').mkdir(parents=True)
    with pytest.raises(WowserPreparationError, match='Expected small upstream-owned'):
        copy_upstream_ui(work, tmp_path / 'dist')
