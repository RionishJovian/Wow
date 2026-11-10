"""Browser smoke for the original asset-free exploration demo (not World of Warcraft).

Requires playwright + a WebGL2-capable Chromium. No server, account or game data.
The test never contacts non-loopback addresses, and prints only stage and FPS.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


@contextlib.contextmanager
def serve_web():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(WEB)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_address[1]}/world_smoke.html'
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def run(*, screenshot: Path | None = None) -> dict:
    from playwright.sync_api import sync_playwright
    failures = []
    with serve_web() as url, sync_playwright() as pw:
        launch_args = ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
                       '--use-gl=angle', '--use-angle=swiftshader']
        options = {'headless': True, 'args': launch_args}
        if os.environ.get('WOTLK_CHROMIUM_EXECUTABLE'):
            options['executable_path'] = os.environ['WOTLK_CHROMIUM_EXECUTABLE']
        browser = pw.chromium.launch(**options)
        try:
            page = browser.new_page(viewport={'width': 800, 'height': 520})
            page.on('pageerror', lambda _exc: failures.append('Uncaught browser error'))
            page.goto(url, wait_until='load', timeout=20_000)
            page.wait_for_function("window.worldState === 'running' || ['unsupported','error','lost'].includes(window.worldState)", timeout=20_000)
            stage = page.evaluate('window.worldState')
            if stage != 'running' or failures:
                return {'browser_render_passed': False, 'stage': stage,
                        'reason': 'WebGL2 unavailable or rendering failed', 'gameplay_verified': False}
            page.evaluate("window.world.onInput({type:'move',x:0,y:1})")
            page.wait_for_function('window.world.stats.traveled > 0.15', timeout=5_000)
            page.evaluate("window.world.onInput({type:'move',x:0,y:0})")
            page.evaluate("window.world.onInput({type:'action',index:1,down:true})")
            page.wait_for_function('window.world.stats.height > 0', timeout=3_000)
            # Verify interaction in the real rendering loop, not only in unit tests.
            page.evaluate("window.world.onInput({type:'move',x:0,y:1})")
            page.wait_for_function('window.world.stats.z > 5.8', timeout=20_000)
            page.evaluate("window.world.onInput({type:'move',x:0,y:0})")
            page.evaluate("window.world.onInput({type:'action',index:3,down:true})")
            page.wait_for_function('window.world.stats.beaconsCollected === 1', timeout=4_000)
            page.wait_for_timeout(300)
            if screenshot:
                page.screenshot(path=str(screenshot), full_page=True)
            state = page.evaluate('window.world.stats')
            return {'browser_render_passed': not failures and 0 < state['renderPixels'] <= 550_000, 'stage': stage,
                    'movement_verified': state['traveled'] > .15,
                    'jump_input_verified': True,
                    'beacon_collect_verified': state['beaconsCollected'] == 1,
                    'quality_budget_verified': 0 < state['renderPixels'] <= 550_000,
                    'render_pixels': state['renderPixels'], 'render_scale': state['renderScale'],
                    'avatar': state['avatar'], 'gameplay_verified': False,
                    'game_server_connected': False}
        finally:
            browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--screenshot', type=Path)
    args = parser.parse_args()
    try:
        report = run(screenshot=args.screenshot)
    except Exception as exc:
        # Don't print URLs, secrets, or full browser tracebacks.
        report = {'browser_render_passed': False, 'error_type': type(exc).__name__,
                  'gameplay_verified': False}
    print(json.dumps(report, sort_keys=True))
    return 0 if report['browser_render_passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
