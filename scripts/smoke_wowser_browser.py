#!/usr/bin/env python3
"""Smoke-test the *compiled* Wowser UI in headless Chromium, without WoW assets.

Checks JavaScript execution and a terminal UI instrumentation stage only.
It MUST NOT be interpreted as a game login, character movement or world render.
Requires: pip install playwright && python -m playwright install chromium
"""
from __future__ import annotations

import argparse
import json
import sys
from urllib.parse import urlsplit

TERMINAL_STAGES = frozenset({
    'ui-loader-returned', 'resource-load-failed', 'first-render-call', 'render-failed',
})
PASS_STAGES = frozenset({'ui-loader-returned', 'first-render-call'})


def summarize(stage: str | None, js_bundle_loaded: bool, webgl2: bool,
              script_errors: int, *, missing_glue_xml: bool = False) -> dict:
    """Separate a clean UI render from the EXPECTED missing-data failure.

    Asset-free CI can verify that the real compiled client tried to fetch its
    required game UI without conflating this with successful initialization.
    """
    clean = stage in PASS_STAGES and js_bundle_loaded and webgl2 and script_errors == 0
    expected_missing = (stage == 'resource-load-failed' and js_bundle_loaded
                        and webgl2 and missing_glue_xml)
    return {
        'smoke_passed': clean,
        'assetless_probe_passed': expected_missing,
        'missing_required_glue_xml': missing_glue_xml,
        'ui_stage': stage if stage in TERMINAL_STAGES else 'not-initialized',
        'compiled_script_loaded': js_bundle_loaded,
        'webgl2_available': webgl2,
        'uncaught_script_errors': script_errors,
        'gameplay_verified': False,
        'realm_connected': False,
        'assets_bundled': False,
    }


def run(url: str) -> dict:
    parsed = urlsplit(url)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost'):
        raise ValueError('Smoke tests only allow local HTTP development origin')
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

    errors: list[str] = []
    loaded_scripts: list[str] = []
    missing_glue: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=[
            '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
            '--use-angle=swiftshader', '--no-sandbox',
        ])
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 720})
            page.on('pageerror', lambda _error: errors.append('Uncaught script error'))
            def on_response(response):
                url_path = response.url.split('?', 1)[0].replace('\\', '/').lower()
                if response.ok and '/client/assets/' in url_path and url_path.endswith('.js'):
                    loaded_scripts.append('Compiled script loaded')
                if response.status == 404 and ('/interfa' in url_path or 'gluexml' in url_path):
                    # Path is never sent to logs; only the fact that local
                    # interface resources were missing is reported.
                    missing_glue.append('Missing local UI')
            page.on('response', on_response)
            page.goto(url, wait_until='domcontentloaded', timeout=15_000)
            try:
                page.wait_for_function("""() => [
                  'ui-loader-returned', 'resource-load-failed',
                  'first-render-call', 'render-failed',
                ].includes(document.documentElement.getAttribute('data-wotlk-lab-stage'))""",
                                       timeout=20_000)
            except PlaywrightTimeout:
                pass
            stage = page.evaluate("document.documentElement.getAttribute('data-wotlk-lab-stage')")
            # Inspect an already-initialized context; do not interpret GPU availability
            # as evidence of actual WoW game graphics.
            webgl2 = bool(page.evaluate("""() => {
              const canvas = document.querySelector('canvas');
              return canvas && !!canvas.getContext('webgl2');
            }"""))
            return summarize(stage, bool(loaded_scripts), webgl2, len(errors),
                             missing_glue_xml=bool(missing_glue))
        finally:
            browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8765/client/index.html?embedded=1')
    args = parser.parse_args()
    try:
        result = run(args.url)
    except (ValueError, ImportError, OSError) as exc:
        parser.exit(1, f'Browser smoke unavailable: {type(exc).__name__}\n')
    print(json.dumps(result, sort_keys=True))
    if result['smoke_passed']:
        return 0
    if result['assetless_probe_passed']:
        print('Expected missing local game UI; upstream code executed but startup is NOT clean.',
              file=sys.stderr)
        return 0
    print('Compiled Wowser UI did not reach the expected startup or missing-data stage.',
          file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
