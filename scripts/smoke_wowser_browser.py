#!/usr/bin/env python3
"""Smoke-test the actual compiled Wowser UI in headless Chromium without game assets.

Passing this test means the UI JavaScript initialized, NOT that WoW gameplay works.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from urllib.parse import urlsplit

TERMINAL_STAGES = frozenset({
    "ui-loader-returned", "resource-load-failed", "first-render-call", "render-failed",
})
PASS_STAGES = frozenset({"ui-loader-returned", "resource-load-failed", "first-render-call"})


def summarize(stage: str | None, js_loaded: bool, webgl2: bool, errors: int) -> dict:
    return {
        "smoke_passed": stage in PASS_STAGES and js_loaded and webgl2 and errors == 0,
        "ui_stage": stage if stage in TERMINAL_STAGES else "not-initialized",
        "compiled_script_loaded": js_loaded,
        "webgl2_available": webgl2,
        "uncaught_script_errors": errors,
        "gameplay_verified": False,
        "realm_connected": False,
        "assets_bundled": False,
    }


def run(url: str) -> dict:
    parsed = urlsplit(url)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost"):
        raise ValueError("Smoke test only accepts local development HTTP")
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

    script_errors: list[str] = []
    loaded_scripts: list[str] = []
    with sync_playwright() as playwright:
        launch_options = {
            "headless": True,
            "args": [
                "--enable-webgl", "--ignore-gpu-blocklist",
                "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox",
            ],
        }
        # Optional local-system Chromium fallback. CI uses Playwright's managed browser.
        system_chromium = os.environ.get("WOTLK_CHROMIUM_EXECUTABLE")
        if system_chromium:
            launch_options["executable_path"] = system_chromium
        browser = playwright.chromium.launch(**launch_options)
        try:
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            page.on("pageerror", lambda _error: script_errors.append("Uncaught error"))
            page.on("response", lambda response: loaded_scripts.append(response.url)
                    if response.ok and "/client/assets/" in response.url
                    and response.url.split("?", 1)[0].endswith(".js") else None)
            page.goto(url, wait_until="domcontentloaded", timeout=15_000)
            try:
                page.wait_for_function("""() => [
                  'ui-loader-returned', 'resource-load-failed',
                  'first-render-call', 'render-failed',
                ].includes(document.documentElement.getAttribute('data-wotlk-lab-stage'))""",
                                       timeout=20_000)
            except PlaywrightTimeout:
                pass
            stage = page.evaluate(
                "document.documentElement.getAttribute('data-wotlk-lab-stage')"
            )
            gl = bool(page.evaluate("""() => {
              const canvas = document.querySelector('canvas');
              return canvas && !!canvas.getContext('webgl2');
            }"""))
            return summarize(stage, bool(loaded_scripts), gl, len(script_errors))
        finally:
            browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8765/client/index.html?embedded=1")
    args = parser.parse_args()
    try:
        result = run(args.url)
    except (ValueError, ImportError, OSError) as exc:
        parser.exit(1, f"Browser smoke unavailable: {type(exc).__name__}\n")
    print(json.dumps(result, sort_keys=True))
    if not result["smoke_passed"]:
        print("Wowser UI failed startup smoke check; NOT gameplay-ready.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
