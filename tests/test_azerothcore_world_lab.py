"""Keep real-worldserver CLI read-only and pinned to numeric loopback targets."""
import pytest
from scripts.azerothcore_auth_probe import ProbeError
from scripts.azerothcore_lab_login import LabSession
from scripts.azerothcore_realm_list import Realm
from scripts.azerothcore_world import WorldProtocolError
import scripts.azerothcore_world_lab as world_lab


def realm(*, locked=False, flags=0, client_build=12340, address='evil.example:8085'):
    return Realm(1, 'Owned Lab', address, 1, locked, flags, 0.0, 0, 1, client_build)


@pytest.mark.asyncio
async def test_lab_ignores_untrusted_realm_address(monkeypatch):
    calls = []
    async def login(*args, **kwargs):
        calls.append(('auth',kwargs['host'],kwargs['port']))
        return LabSession([realm()], bytes(range(40)))
    async def world(**kwargs):
        calls.append(('world',kwargs['host'],kwargs['port'],kwargs['realm_id']))
        return {'world_authenticated':True,'character_count':0,'gameplay_verified':False}
    monkeypatch.setattr(world_lab,'authenticate_lab_session',login)
    monkeypatch.setattr(world_lab,'enumerate_world_characters',world)
    result=await world_lab.run_lab(account='LABTEST',password='DISPOSABLE',realm_id=1)
    assert result['srp6_server_proof_verified']
    assert result['character_count']==0
    assert calls==[('auth','127.0.0.1',3724),('world','127.0.0.1',8085,1)]
    assert 'evil.example' not in str(calls)
    assert 'session_key' not in str(result)


@pytest.mark.parametrize('bad_realm',[
    realm(locked=True),realm(flags=0x02),realm(client_build=12341)])
@pytest.mark.asyncio
async def test_lab_fails_closed_on_bad_realm(monkeypatch,bad_realm):
    async def login(*_args,**_kwargs):return LabSession([bad_realm],bytes(range(40)))
    monkeypatch.setattr(world_lab,'authenticate_lab_session',login)
    with pytest.raises(WorldProtocolError):
        await world_lab.run_lab(account='LABTEST',password='DISPOSABLE',realm_id=1)


@pytest.mark.asyncio
async def test_lab_refuses_non_disposable_accounts_before_network(monkeypatch):
    async def login(*args,**kwargs):raise AssertionError('Network attempted')
    monkeypatch.setattr(world_lab,'authenticate_lab_session',login)
    with pytest.raises(ProbeError):
        await world_lab.run_lab(account='REALUSER',password='PASSPHRASE',realm_id=1)
    with pytest.raises(ProbeError):
        await world_lab.run_lab(account='LABTEST',password='PASSPHRASE',realm_id=1,
                               world_host='example.com')
