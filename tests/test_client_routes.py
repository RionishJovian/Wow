import httpx
import pytest

from server.app import Config, create_app
from tests.test_gateway import free_port, running_server


@pytest.mark.asyncio
async def test_client_disabled_by_default():
    port = free_port()
    async with running_server(create_app(Config()), port):
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}") as client:
            result = await client.get('/api/client')
            assert result.status_code == 200
            assert result.json()['available'] is False
            assert result.json()['gameplay_verified'] is False
            assert (await client.get('/client/index.html')).status_code == 403


@pytest.mark.asyncio
async def test_client_enabled_still_loopback_only(tmp_path):
    folder = tmp_path / 'dist'
    folder.mkdir()
    (folder / 'index.html').write_text('<html><body>Local test client</body></html>')
    (folder / 'lab-bridge.mjs').write_text('console.log("bridge");')
    port = free_port()
    app = create_app(Config(client_enabled=True, client_dir=folder))
    async with running_server(app, port):
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}") as client:
            available = (await client.get('/api/client')).json()
            assert available['available'] is True
            assert available['gameplay_verified'] is False
            response = await client.get('/client/index.html')
            assert response.status_code == 200
            assert response.headers['X-Frame-Options'] == 'SAMEORIGIN'
            assert "frame-ancestors 'self'" in response.headers['Content-Security-Policy']
            assert 'Local test client' in response.text
            bad_host = await client.get('/client/index.html', headers={'Host': 'attacker.example'})
            assert bad_host.status_code == 403
            assert (await client.get('/client/../../server/app.py')).status_code != 200
