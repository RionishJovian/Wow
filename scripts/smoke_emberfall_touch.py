"""Mobile multi-touch regression. Start Vite, then run with Python Playwright."""
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'), headless=True, args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(os.environ.get('EMBERFALL_URL', 'http://127.0.0.1:5173'), wait_until='networkidle')
    page.wait_for_function('!!window.emberfall')
    assert page.locator('.touch-controls').is_visible()
    client = page.context.new_cdp_session(page)
    def point(selector, identity):
        rect = page.locator(selector).bounding_box()
        return {'x':rect['x']+rect['width']/2,'y':rect['y']+rect['height']/2,'id':identity}
    def touch(kind, points):
        client.send('Input.dispatchTouchEvent', {'type':kind,'touchPoints':points})
    stick = point('.touch-stick', 1)
    initial = page.evaluate('emberfall.player.model.position.z')
    touch('touchStart', [stick])
    stick['y'] -= 34
    touch('touchMove', [stick])
    page.wait_for_function(f'emberfall.player.model.position.z < {initial-.3}', timeout=15000)
    look = point('.touch-look', 2)
    touch('touchStart', [stick, look])
    yaw = page.evaluate('emberfall.controls.yaw')
    look['x'] += 20
    touch('touchMove', [stick, look])
    page.wait_for_function(f'emberfall.controls.yaw !== {yaw}', timeout=15000)
    assert page.evaluate('emberfall.touch.keys.has("KeyW")')
    touch('touchCancel', [])
    assert page.evaluate('emberfall.touch.keys.size===0')
    # Releasing a touch must not release a simultaneously held keyboard key.
    page.keyboard.down('w')
    stick = point('.touch-stick', 3)
    touch('touchStart', [stick])
    stick['x'] += 30
    touch('touchMove', [stick])
    touch('touchEnd', [])
    assert page.evaluate('emberfall.controls.keys.has("KeyW") && emberfall.touch.keys.size===0')
    page.keyboard.up('w')
    jump = point('[data-action="jump"]', 4)
    touch('touchStart', [jump])
    page.wait_for_function('emberfall.player.velocityY>0', timeout=15000)
    touch('touchEnd', [])
    assert page.evaluate('!emberfall.touch.keys.has("Space")')
    page.locator('[data-action="target"]').tap()
    assert page.evaluate('!!emberfall.combat.target')
    distance = page.evaluate('emberfall.controls.distance')
    page.locator('[data-action="in"]').tap()
    assert page.evaluate('emberfall.controls.distance') < distance
    page.evaluate('emberfall.player.model.position.copy(emberfall.zone.npc.position)')
    page.locator('[data-action="interact"]').tap()
    assert page.locator('#quest-panel').is_visible()
    page.locator('#close-quest').tap()
    stick = point('.touch-stick', 5)
    touch('touchStart', [stick])
    stick['y'] -= 30
    touch('touchMove', [stick])
    page.evaluate('window.dispatchEvent(new Event("blur"))')
    assert page.evaluate('emberfall.touch.keys.size===0')
    touch('touchEnd', [])
    assert not errors, errors
    print('PASS: mobile movement, simultaneous orbit, cancellation, keyboard mixing, jump, target, zoom, interaction, blur; no page errors')
    browser.close()
