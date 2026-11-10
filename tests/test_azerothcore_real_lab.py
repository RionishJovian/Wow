"""Asset-free real-server lab preparation and security tests (no Docker required)."""
import hashlib
import secrets
import subprocess

import pytest

from scripts.azerothcore_auth_probe import ProbeError
from scripts.azerothcore_real_lab import (
    compose_database_sql, registration_sql, registration_values, removal_sql,
    verify_disposable_login,
)
from scripts.azerothcore_srp6 import GENERATOR, MODULUS


def test_account_verifier_matches_azerothcore_registration_spec():
    salt = bytes(range(32))
    original_salt, verifier = registration_values('labuser', 'test-only', salt)
    first = hashlib.sha1(b'LABUSER:TEST-ONLY').digest()
    x = int.from_bytes(hashlib.sha1(salt + first).digest(), 'little')
    expected = pow(GENERATOR, x, MODULUS).to_bytes(32, 'little')
    assert original_salt == salt
    assert verifier == expected
    assert len(verifier) == 32


@pytest.mark.parametrize('invalid', [b'', b'not32', bytes(31), bytes(33), 'x' * 32, None])
def test_bad_registration_salt_rejected(invalid):
    with pytest.raises(ProbeError):
        registration_values('LABUSER', 'PASSWORD', invalid)


def test_generated_sql_is_one_safe_account_insert_and_removal():
    salt, verifier = registration_values('LABUSER', 'ABC123', bytes(range(32)))
    sql = registration_sql('LABUSER', salt, verifier)
    assert sql.startswith('INSERT INTO account (username, salt, verifier, expansion, reg_mail, email, joindate)')
    assert "'LABUSER'" in sql and "X'" + salt.hex() in sql
    assert "X'" + verifier.hex() in sql
    assert 'ABC123' not in sql
    assert sql.count(';') == 1
    assert removal_sql('LAB0123456789') == "DELETE FROM account WHERE username = 'LAB0123456789';\n"
    for unsafe in ['ADMIN', 'LAB', 'LAB-UNSAFE', 'LAB\'; DROP TABLE account;--']:
        with pytest.raises(ProbeError):
            removal_sql(unsafe)


def test_db_compose_exec_never_exposes_password_or_sql_in_argv():
    recorded = []

    def fake_run(argv, **kwargs):
        recorded.append((argv, kwargs))
        return subprocess.CompletedProcess(argv, 0)

    compose_database_sql('SELECT 1;', runner=fake_run)
    args, opts = recorded[0]
    assert args[:2] == ['docker', 'compose']
    assert args[-4:] == ['ac-database', 'sh', '-c',
                         'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root acore_auth']
    assert 'SELECT 1;' not in ' '.join(args)
    assert opts['input'] == 'SELECT 1;'
    assert opts['capture_output'] is True
    assert opts['check'] is True


@pytest.mark.asyncio
async def test_disposable_account_created_logged_in_and_removed(monkeypatch):
    sql = []

    async def successful_auth(account, password, *, port, timeout):
        assert account.startswith('LAB') and len(account) == 15
        assert len(password) == 32
        assert port == 3724 and timeout == 5
        return {'srp6_server_proof_verified': True, 'realm_list_decoded': True,
                'realms': [{'name': 'Offline lab'}], 'gameplay_verified': False}

    monkeypatch.setattr('scripts.azerothcore_real_lab.authenticate_and_list_realms', successful_auth)
    report = await verify_disposable_login(sql_writer=sql.append)
    assert report['real_authserver_login_verified'] is True
    assert report['realm_count'] == 1
    assert report['gameplay_verified'] is False
    assert len(sql) == 2
    assert sql[0].startswith('INSERT INTO account')
    assert sql[1].startswith('DELETE FROM account')


@pytest.mark.asyncio
async def test_disposable_account_cleanup_after_invalid_server_proof(monkeypatch):
    sql = []

    async def broken_auth(*args, **kwargs):
        raise ProbeError('Server proof not verified')

    monkeypatch.setattr('scripts.azerothcore_real_lab.authenticate_and_list_realms', broken_auth)
    with pytest.raises(ProbeError):
        await verify_disposable_login(sql_writer=sql.append)
    assert len(sql) == 2
    assert sql[1].startswith('DELETE FROM account')


@pytest.mark.asyncio
async def test_never_claims_real_auth_without_proof(monkeypatch):
    sql = []

    async def no_proof(*args, **kwargs):
        return {'srp6_server_proof_verified': False, 'realm_list_decoded': True, 'realms': []}

    monkeypatch.setattr('scripts.azerothcore_real_lab.authenticate_and_list_realms', no_proof)
    with pytest.raises(ProbeError):
        await verify_disposable_login(sql_writer=sql.append)
    assert len(sql) == 2
