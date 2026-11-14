"""Optional browser integration check: pip install playwright; use system Chromium.
Run the Vite server first. No game backend or original-client assets are used.
"""
import json
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(
        executable_path=os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'),
        headless=True,
        args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
    )
    page = browser.new_page(viewport={'width':1100, 'height':740})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(os.environ.get('EMBERFALL_URL', 'http://127.0.0.1:5173'), wait_until='networkidle')
    page.wait_for_function('!!window.emberfall')
    assert page.locator('.ability').count() == 6
    initial = page.evaluate('emberfall.player.model.position.z')
    page.keyboard.down('w')
    page.wait_for_function(f'emberfall.player.model.position.z < {initial - .5}', timeout=15000)
    page.keyboard.up('w')
    assert page.evaluate('emberfall.player.model.position.z') < initial - .3
    page.keyboard.press('Tab')
    assert page.evaluate('!!emberfall.combat.target')
    page.keyboard.press('b')
    assert page.locator('#bag-panel').is_visible()
    page.keyboard.press('Escape')
    page.locator('#minimap').click(position={'x':70, 'y':70})
    assert page.evaluate('!!emberfall.hud.mapDestination')
    # Accept a quest through the same UI as a player near the warden.
    page.evaluate('emberfall.player.model.position.copy(emberfall.zone.npc.position)')
    page.keyboard.press('e')
    page.locator('#quest-accept').click()
    assert page.evaluate('emberfall.quests.accepted')
    print('PASS: controls and quest acceptance', flush=True)
    # Exercise damage, real cooldown rejection, charge/stun and kill rewards.
    result = page.evaluate('''() => {
      const g=emberfall, e=g.enemies.enemies[0];g.player.hp=140;
      g.player.model.position.copy(e.model.position).z+=2;g.combat.target=e;
      g.combat.use(0);const hp=e.hp;g.combat.use(1);
      const blocked=e.hp===hp;g.combat.gcd=0;g.combat.use(2);
      const stunned=e.stun===2;g.combat.gcd=0;g.combat.use(1);
      return {blocked,stunned,killed:e.dead,xp:g.player.xp,progress:g.quests.progress};
    }''')
    assert result['blocked'] and result['stunned'] and result['killed']
    assert result['xp'] > 0 and result['progress'] == 1
    page.evaluate('emberfall.quests.openLoot(emberfall.enemies.enemies[0])')
    page.locator('#loot-all').click()
    page.keyboard.press('b')
    page.locator('[data-equip="0"]').click()
    assert page.evaluate('emberfall.quests.items[0].equipped')
    page.keyboard.press('Escape')
    # Finish the three quest stages using damage events, then turn in via UI.
    for stage in range(3):
        page.evaluate('''() => {
          const g=emberfall, kind=[0,1,3][g.quests.stage];
          g.enemies.enemies.filter(e=>e.kind===kind&&!e.dead).forEach(e=>g.enemies.damage(e,9999));
          g.player.model.position.copy(g.zone.npc.position);
        }''')
        page.keyboard.press('e')
        page.locator('#quest-accept').click()
        if stage < 2:
            page.keyboard.press('e')
            page.locator('#quest-accept').click()
    assert page.evaluate('emberfall.quests.finished && emberfall.player.level >= 3')
    print('PASS: combat, loot, equipment and quest chain', flush=True)
    # Mage cast interruption and projectile completion run on the live game loop.
    page.locator('#class-switch').click()
    page.locator('[data-class="Fire Mage"]').click()
    page.evaluate('''() => {const g=emberfall;g.player.respawn();g.player.resource=100;
      const e=g.enemies.enemies.find(e=>e.kind===2);g.combat.target=e;
      g.player.model.position.copy(e.model.position).z+=18;
      g.combat.gcd=0;g.combat.use(0);}''')
    assert page.evaluate('!!emberfall.combat.casting')
    page.keyboard.down('d')
    page.wait_for_function('!emberfall.combat.casting', timeout=15000)
    page.keyboard.up('d')
    assert page.evaluate('!emberfall.combat.casting')
    before = page.evaluate('emberfall.combat.target.hp')
    page.wait_for_function('!emberfall.player.moving')
    page.evaluate('emberfall.combat.gcd=0;emberfall.combat.use(0)')
    page.wait_for_function(f'emberfall.combat.target.hp < {before}', timeout=45000)
    page.evaluate('emberfall.player.hp=1;emberfall.player.damage(999)')
    page.wait_for_function('!document.querySelector("#death").hidden')
    page.locator('#respawn').click()
    assert page.evaluate('!emberfall.player.dead && emberfall.player.hp===emberfall.player.maxHp')
    extra = page.evaluate("""() => {
      const g=emberfall,p=g.player,e=g.enemies.enemies.find(e=>e.kind===2);
      p.model.position.copy(e.model.position).z+=2;e.hp=e.maxHp;e.dead=false;
      const reset=()=>{g.combat.gcd=0;g.combat.cooldowns.fill(0);p.resource=100;};
      reset();g.combat.use(2);const root=e.root>0;
      reset();g.combat.use(5);const barrier=p.shield===65;p.damage(20);const absorbed=p.shield===45;
      reset();const pos=p.model.position.clone();g.combat.use(4);const blink=p.model.position.distanceTo(pos)>19;
      p.model.position.copy(e.model.position).z+=15;g.combat.target=e;reset();g.combat.use(3);
      const pyro=!!g.combat.casting,hpBeforePyro=e.hp;g.combat.update(3.3);const projectile=g.combat.projectiles.length>0||e.hp<hpBeforePyro;g.combat.update(2);
      p.choose('Warrior');e.dead=false;e.hp=e.maxHp;p.model.position.copy(e.model.position).z+=2;reset();g.combat.use(4);const buff=p.buff===20;
      reset();const hp=e.hp;g.combat.use(3);const cleave=e.hp<hp;
      reset();p.hp=40;p.victory=20;g.combat.use(5);const heal=p.hp===85;
      return {root,barrier,absorbed,blink,pyro,projectile,buff,cleave,heal};
    }""")
    assert all(extra.values()), extra
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(300)
    assert page.locator('.ability').count() == 6
    assert not errors, errors
    print(json.dumps({'browser':'Chromium', 'checks':['boot','movement','target','inventory','minimap','GCD','charge','kill','loot','equip','three quests','level up','class switch','cast interruption','fireball','death','respawn','mobile resize'], 'additional_abilities':extra, 'errors':errors}))
    browser.close()
