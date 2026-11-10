"""Build21: metadata-only private data gate and isolated real-world acceptance wiring.

All server interactions in these tests are mocks. This is NOT real-worldserver
compatibility evidence; only the operator's opt-in local run can establish it.
"""
from pathlib import Path
from types import SimpleNamespace
import json
import re

import pytest

from scripts.azerothcore_world_data_preflight import inspect_data_dir, DataPreflightError, main as preflight_cli
import scripts.azerothcore_real_world_lab as world


def _layout(tmp_path):
    root = tmp_path / 'private-extracted-data'
    root.mkdir()
    (root / 'dbc').mkdir()
    (root / 'maps').mkdir()
    (root / 'dbc' / 'Spell.dbc').write_bytes(b'NOT REAL GAME DATA')
    (root / 'maps' / '0004331.map').write_bytes(b'NOT REAL GAME DATA')
    return root


def test_preflight_reports_only_metadata_without_leaking_paths(tmp_path):
    root = _layout(tmp_path)
    report = inspect_data_dir(root, repo_root=tmp_path / 'not-the-repo')
    assert report['data_layout_ready']
    assert report['required'] == {'dbc': True, 'maps': True}
    assert report['recommended'] == {'vmaps': False, 'mmaps': False}
    assert report['rights_verified'] is False
    assert report['data_content_verified'] is False
    assert str(root) not in json.dumps(report)
    assert 'Spell.dbc' not in json.dumps(report)


def test_missing_required_data_fails_even_with_optional_directories(tmp_path):
    root = _layout(tmp_path)
    (root / 'maps' / '0004331.map').unlink()
    (root / 'vmaps').mkdir()
    (root / 'vmaps' / '000.vmtree').touch()
    assert inspect_data_dir(root, repo_root=tmp_path / 'repo')['data_layout_ready'] is False


def test_symlinks_relative_paths_and_repository_data_are_rejected(tmp_path):
    root = _layout(tmp_path)
    link = tmp_path / 'linked-data'
    link.symlink_to(root, target_is_directory=True)
    for invalid in ('relative-dir', link, root):
        with pytest.raises(DataPreflightError):
            inspect_data_dir(invalid, repo_root=root)
    (root / 'dbc').rename(root / 'real-dbc')
    (root / 'dbc').symlink_to(root / 'real-dbc', target_is_directory=True)
    assert inspect_data_dir(root, repo_root=tmp_path / 'unrelated')['data_layout_ready'] is False


def test_preflight_cli_does_not_echo_private_path(monkeypatch, capsys, tmp_path):
    root = tmp_path / 'private-data'
    root.mkdir()
    code = preflight_cli(['--data-dir', str(root)])
    output = capsys.readouterr().out
    assert code == 1
    assert str(root) not in output
    assert json.loads(output)['data_layout_ready'] is False


def test_world_compose_separate_project_and_fixed_local_port():
    overlay = (Path(__file__).resolve().parents[1] / 'lab' /
               'azerothcore-world.compose.yml').read_text()
    assert 'acore/ac-wotlk-worldserver:' in overlay
    assert '127.0.0.1:${WOTLK_LAB_WORLD_PORT:-8085}:8085' in overlay
    assert 'read_only: true' in overlay
    assert 'WOTLK_LAB_DATA_DIR:?' in overlay
    assert 'ac-client-data' not in overlay
    assert 'privileged: true' not in overlay
    assert world.world_compose_args()[:5] == ['docker', 'compose', '--project-name', 'wotlk-world-lab-21','-f']


def test_world_sql_helper_never_puts_sql_in_process_argv():
    calls = []
    def run(argv, **kwargs):
        calls.append((argv, kwargs))
    world.compose_world_sql('SELECT 1;\n', runner=run)
    args, kwargs = calls[0]
    assert '-T' in args and 'ac-database' in args
    assert 'SELECT 1;' not in ' '.join(args)
    assert kwargs['input'] == 'SELECT 1;\n'
    assert kwargs['capture_output'] and kwargs['check']


@pytest.mark.asyncio
async def test_fake_two_service_acceptance_registers_then_cleans_up(monkeypatch):
    events = []
    async def preflight(**kwargs):
        events.append(('preflight', kwargs['world_port']))
        return True
    async def accept(**kwargs):
        events.append(('accept', kwargs['realm_id']))
        assert kwargs['account'].startswith('LAB')
        assert re.fullmatch(r'LAB[A-F0-9]{12}', kwargs['account'])
        assert kwargs['preflight_verified'] is True
        assert kwargs['world_port'] == 8085
        return SimpleNamespace(world_challenge_format_valid=True,
            srp6_server_proof_verified=True, advertised_realm_matched=True,
            world_auth_response_ok=True, character_list_received=True,
            character_count=0, nonempty_character_list=False)
    def sql_writer(sql):
        events.append(('SQL', 'INSERT' if sql.startswith('INSERT') else 'DELETE'))
    monkeypatch.setattr(world, 'preflight_world', preflight)
    monkeypatch.setattr(world, 'run_acceptance', accept)
    report = await world.verify_disposable_world(sql_writer=sql_writer)
    assert events == [('preflight', 8085), ('SQL','INSERT'), ('accept',1), ('SQL','DELETE')]
    assert report['real_worldserver_interop_passed']
    assert report['character_list_received'] and report['character_count'] == 0
    assert report['gameplay_verified'] is False and report['server_identity_verified'] is False
    assert 'LAB' not in json.dumps(report)


@pytest.mark.asyncio
async def test_preflight_failure_never_inserts_or_authenticates(monkeypatch):
    async def blocked(**_): return False
    monkeypatch.setattr(world,'preflight_world', blocked)
    with pytest.raises(world.WorldProtocolError):
        await world.verify_disposable_world(sql_writer=lambda _: pytest.fail('Should not create account'))


@pytest.mark.asyncio
async def test_failed_world_auth_attempts_cleanup_even_after_partial_registration(monkeypatch):
    async def ready(**_): return True
    async def refused(**_): raise world.WorldProtocolError('Bad world auth')
    events = []
    monkeypatch.setattr(world,'preflight_world',ready)
    monkeypatch.setattr(world,'run_acceptance',refused)
    with pytest.raises(world.WorldProtocolError):
        await world.verify_disposable_world(sql_writer=lambda sql:events.append(sql.split()[0]))
    assert events == ['INSERT', 'DELETE']


@pytest.mark.asyncio
async def test_partial_sql_failure_still_attempts_cleanup(monkeypatch):
    async def ready(**_): return True
    monkeypatch.setattr(world,'preflight_world',ready)
    events=[]
    def writer(sql):
        events.append(sql.split()[0])
        if sql.startswith('INSERT'):
            raise OSError('Database unresponsive')
    with pytest.raises(OSError):
        await world.verify_disposable_world(sql_writer=writer)
    assert events == ['INSERT','DELETE']


@pytest.mark.asyncio
async def test_invalid_port_or_realm_fails_before_world_connection(monkeypatch):
    async def surprise(**_): pytest.fail('Should not contact server')
    monkeypatch.setattr(world,'preflight_world',surprise)
    for kwargs in ({'realm_id':0}, {'realm_id':True}, {'world_port':70000}):
        with pytest.raises(world.ProbeError):
            await world.verify_disposable_world(sql_writer=lambda _:pytest.fail('No SQL'),**kwargs)
