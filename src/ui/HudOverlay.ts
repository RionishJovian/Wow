import * as T from "three";
import { Player } from "../entities/Player";
import { AbilitySystem } from "../combat/AbilitySystem";
import { EnemyManager } from "../entities/EnemyManager";
import { QuestAndLootSystem, quests } from "../systems/QuestAndLootSystem";
import { Audio } from "../systems/Audio";
import { ground } from "../engine/Models";
const rarity = ["#e4e1d6", "#75c77b", "#69aafa", "#c58af0"];
export class HudOverlay {
  root = document.createElement("div");
  floating = document.createElement("div");
  private map: HTMLCanvasElement;
  private mapBase: HTMLCanvasElement;
  bagOpen = false;
  questOpen = false;
  private abort = new AbortController();
  private log: string[] = [];
  private messageTimer = 0;
  mapDestination?: T.Vector2;
  constructor(
    public player: Player,
    public combat: AbilitySystem,
    public enemies: EnemyManager,
    public quests: QuestAndLootSystem,
    public audio: Audio,
  ) {
    this.root.id = "hud";
    document.body.append(this.root);
    this.floating.id = "floating-layer";
    document.body.append(this.floating);
    this.root.innerHTML = `<div class="top-vignette"></div><header class="brand"><span class="crest">✦</span><div>EMBERFALL<small>CHRONICLES OF THE REACH</small></div></header>
 <div class="zone-heading"><span class="eyebrow">THE EASTERN KINGDOMS</span><h1>The Verdant Reach</h1><span class="zone-sub"><i></i> Northwatch Crossing <b>·</b> Contested wilderness</span></div>
 <section class="unit player-unit"><div class="portrait">⚔<b id="level">1</b></div><div class="unit-body"><div class="unit-name">Aldren <span id="class-label">Human Warrior</span></div><div class="meter health"><i id="player-health"></i><span id="hp-text"></span></div><div class="meter resource"><i id="player-resource"></i><span id="resource-text"></span></div></div></section>
 <section class="unit target-unit" id="target-frame"><div class="portrait enemy-portrait" id="enemy-portrait"><svg class="dragon-frame" viewBox="0 0 100 100" aria-hidden="true"><defs><g id="dragon"><path d="M48 88C14 82 6 50 25 28L19 14 34 20 42 12 37 29 29 35 36 38 25 43C13 67 33 79 48 83"/><path d="M19 48 2 25 17 31 10 11 27 25M18 58 3 46 11 68 27 77"/></g></defs><use href="#dragon"/><use href="#dragon" transform="translate(100 0) scale(-1 1)"/></svg>♜<b id="enemy-level"></b></div><div class="unit-body"><div class="unit-name" id="target-name"></div><div class="meter health enemy-health"><i id="target-health"></i><span id="target-hp"></span></div><div class="enemy-intent" id="enemy-intent"></div></div></section>
 <aside class="map-panel"><div class="map-label"><span>⌖ &nbsp; NORTHWATCH</span><span id="coordinates">0, 5</span></div><div class="map-wrap"><canvas id="minimap" width="240" height="200" aria-label="Minimap: click to place a waypoint"></canvas><span class="north">N</span><span class="map-compass">✧</span></div><div class="map-footer"><span><i class="dot gold"></i> Quest</span><span><i class="dot red"></i> Hostile</span><button id="mute" aria-label="Toggle sound">♫ ON</button></div></aside>
 <aside class="quest-tracker"><div class="section-caption"><span>QUEST JOURNAL</span><span>◈</span></div><div id="quest-track"></div><div class="region-note">Recommended level <span>1–5</span></div></aside>
 <div id="notice" role="status"></div><div id="interaction"></div><div class="combat-feed"><div class="feed-heading">WORLD <span>COMBAT</span></div><div id="combat-log"></div></div>
 <div id="cast" class="cast"><span id="cast-name"></span><span id="cast-time"></span><i id="cast-fill"></i></div>
 <footer class="bottom-hud"><div class="bar-top"><span class="flourish">──────── ◈ ────────</span><span id="buffs"></span><span class="flourish">──────── ◈ ────────</span></div><div class="action-row"><span class="bar-ornament">❧</span><div id="actions"></div><span class="bar-ornament reverse">❧</span><button class="bag-button" id="bag-toggle" title="Inventory [B]">▣<kbd>B</kbd></button></div><div class="xp-track"><i id="xp-fill"></i><span id="xp-label"></span></div><div class="controls"><span><kbd>W A S D</kbd> Move</span><span><kbd>SPACE</kbd> Jump</span><span><kbd>RMB</kbd> Orbit</span><span><kbd>TAB</kbd> Target</span><span><kbd>1–6</kbd> Abilities</span><span><kbd>E</kbd> Interact</span><button id="class-switch">⇄ Switch class</button></div></footer>
 <div class="modal" id="bag-panel" hidden></div><div class="modal" id="quest-panel" hidden></div><div class="modal small-modal" id="loot-panel" hidden></div><div class="death-screen" id="death" hidden><span>YOUR JOURNEY IS NOT OVER</span><h2>Rise again, champion.</h2><button id="respawn">Return to Northwatch</button></div>
 <div class="class-picker" id="class-picker" hidden><div class="eyebrow">CHOOSE YOUR PATH</div><h2>A hero in the making.</h2><p>Two disciplines. One untold story.</p><div class="class-options"><button data-class="Warrior"><strong>⚔</strong><h3>Warrior</h3><span>STEEL & FURY</span><p>Close the distance.<br>Master the battlefield.</p></button><button data-class="Fire Mage"><strong>☄</strong><h3>Fire Mage</h3><span>FLAME & ARCANA</span><p>Keep your distance.<br>Set the world alight.</p></button></div></div>`;
    this.map = this.root.querySelector("#minimap")!;
    this.mapBase = document.createElement("canvas");
    this.mapBase.width = 240;
    this.mapBase.height = 200;
    this.paintMap();
    this.renderActions();
    this.renderPanels();
    this.addLog("Welcome to the Verdant Reach.");
    this.addLog("Warden Elara has a task for you.");
    const signal = this.abort.signal;
    this.root.addEventListener(
      "click",
      (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("button");
        if (!b) return;
        if (b.dataset.skill) this.combat.use(Number(b.dataset.skill));
        if (b.dataset.equip) this.quests.equip(Number(b.dataset.equip));
        if (b.dataset.class) {
          this.player.choose(b.dataset.class as "Warrior" | "Fire Mage");
          this.combat.cooldowns.fill(0);
          this.combat.casting = undefined;
          this.root.querySelector<HTMLElement>("#class-picker")!.hidden = true;
          this.renderActions();
          this.renderPanels();
        }
        if (b.id === "bag-toggle") this.toggleBag();
        if (b.id === "close-bag") {
          this.bagOpen = false;
          this.renderPanels();
        }
        if (b.id === "close-quest") {
          this.questOpen = false;
          this.renderPanels();
        }
        if (b.id === "quest-accept") {
          this.quests.interact();
          this.questOpen = false;
          this.renderPanels();
        }
        if (b.id === "loot-all") this.quests.takeLoot();
        if (b.id === "close-loot") {
          this.quests.loot = undefined;
          this.renderPanels();
        }
        if (b.id === "mute") {
          this.audio.muted = !this.audio.muted;
          b.textContent = this.audio.muted ? "♫ OFF" : "♫ ON";
        }
        if (b.id === "respawn") {
          this.player.respawn();
          this.enemies.enemies.forEach((e) => (e.cast = 0));
        }
        if (b.id === "class-switch")
          this.root.querySelector<HTMLElement>("#class-picker")!.hidden = false;
      },
      { signal },
    );
    this.map.addEventListener(
      "click",
      (e) => {
        const r = this.map.getBoundingClientRect();
        this.mapDestination = new T.Vector2(
          ((e.clientX - r.left) / r.width) * 100 - 50,
          ((e.clientY - r.top) / r.height) * 84 - 55,
        );
        this.notice("Waypoint marked on your map");
      },
      { signal },
    );
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.repeat) return;
        if (e.code === "KeyB" || e.code === "KeyC") this.toggleBag();
        if (e.code === "Escape") {
          this.bagOpen = false;
          this.questOpen = false;
          this.quests.loot = undefined;
          this.root.querySelector<HTMLElement>("#class-picker")!.hidden = true;
          this.renderPanels();
        }
        if (/^Digit[1-6]$/.test(e.code))
          this.combat.use(Number(e.code.slice(-1)) - 1);
        if (e.code === "Tab") this.combat.tab();
      },
      { signal },
    );
    quests.onChange = () => this.renderPanels();
    quests.notify = (s) => {
      this.notice(s);
      this.addLog(s);
    };
    combat.notice = (s) => this.notice(s);
  }
  renderActions() {
    this.root.querySelector("#actions")!.innerHTML = this.combat.abilities
      .map(
        (a, i) =>
          `<button class="ability skill-${i} ${this.player.className === "Fire Mage" ? "mage" : ""}" data-skill="${i}" aria-label="${a.name}"><kbd>${i + 1}</kbd><span class="skill-icon">${a.icon}</span><div class="cooldown-sweep"></div><span class="cooldown-time"></span><div class="tooltip"><strong>${a.name}</strong><p>${a.description}</p><small>${a.cooldown ? a.cooldown + "s cooldown" : "No cooldown"} · 1.5s GCD</small></div></button>`,
      )
      .join("");
  }
  toggleBag() {
    this.bagOpen = !this.bagOpen;
    this.renderPanels();
  }
  renderPanels() {
    const q = quests[this.quests.stage];
    const done = this.quests.finished;
    this.root.querySelector("#quest-track")!.innerHTML = done
      ? "<h3>✦ Guardian of Northwatch</h3><p>The Reach is safe. Your legend begins.</p>"
      : `<h3><span class="quest-diamond">${this.quests.ready ? "?" : "!"}</span> ${q.title}</h3><p>${!this.quests.accepted ? "Speak to Warden Elara at the crossing." : q.description}</p>${this.quests.accepted ? `<div class="objective ${this.quests.ready ? "complete" : ""}"><span>${this.quests.ready ? "✓" : "◇"} ${this.quests.ready ? "Return to Warden Elara" : "Enemies defeated"}</span><b>${this.quests.progress} / ${q.required}</b></div><div class="quest-progress"><i style="width:${(this.quests.progress / q.required) * 100}%"></i></div>` : '<div class="objective"><span>◇ A new adventure awaits</span><b>E</b></div>'}`;
    const bag = this.root.querySelector<HTMLElement>("#bag-panel")!;
    bag.hidden = !this.bagOpen;
    bag.innerHTML = `<div class="panel-header"><span>CHARACTER & SATCHEL</span><button id="close-bag">×</button></div><h2>Aldren <small>Level ${this.player.level} ${this.player.className}</small></h2><div class="stats"><span>⚔ Power <b>${this.player.power + 24}</b></span><span>⬡ Armor <b>${this.player.armor}</b></span><span>◈ Gold <b>${this.quests.gold}</b></span></div><div class="bag-items">${this.quests.items.length ? this.quests.items.map((item, i) => `<button class="item" data-equip="${i}" style="--rarity:${rarity[item.rarity]}"><span>${item.slot === "Weapon" ? "⚔" : "⬡"}</span><div><strong>${item.name}</strong><small>${item.slot} · ${item.power ? "+" + item.power + " power" : "+" + item.armor + " armor"}</small></div><b>${item.equipped ? "Equipped" : "Equip"}</b></button>`).join("") : '<div class="empty-bag">▣<p>Your satchel awaits its first treasure.</p><small>Defeat enemies. Click their sparkling remains.</small></div>'}</div><p class="panel-hint">Click an item to equip it. One item per slot.</p>`;
    const qp = this.root.querySelector<HTMLElement>("#quest-panel")!;
    qp.hidden = !this.questOpen;
    qp.innerHTML = `<div class="panel-header"><span>WARDEN ELARA</span><button id="close-quest">×</button></div><div class="quest-seal">${done ? "✦" : "!"}</div><h2>${done ? "A debt of gratitude" : q.title}</h2><p class="quest-story">${done ? "The road is quiet, the braziers burn bright. Northwatch will remember your name." : q.description + " The people of Northwatch are counting on you, traveler."}</p><div class="quest-reward">REWARDS <span>${done ? "Guardian of Northwatch" : q.xp + " XP · 25 gold · enchanted equipment"}</span></div>${!done ? `<button class="primary" id="quest-accept">${!this.quests.accepted ? "Accept quest" : this.quests.ready ? "Complete quest" : "Continue quest"}</button>` : ""}`;
    const lp = this.root.querySelector<HTMLElement>("#loot-panel")!;
    lp.hidden = !this.quests.loot;
    lp.innerHTML = `<div class="panel-header"><span>SPOILS OF BATTLE</span><button id="close-loot">×</button></div><h2>${this.quests.loot?.name ?? ""}</h2><p>A glint of treasure among the fallen.</p><button class="primary" id="loot-all">◈ Collect all loot</button>`;
  }
  openQuest() {
    this.questOpen = true;
    this.renderPanels();
  }
  notice(s: string) {
    this.root.querySelector("#notice")!.textContent = s;
    this.messageTimer = 3;
  }
  addLog(s: string) {
    this.log.unshift(s);
    this.log = this.log.slice(0, 4);
    this.root.querySelector("#combat-log")!.innerHTML = "";
    this.log.forEach((line, i) => {
      const el = document.createElement("p");
      el.textContent = line;
      el.style.opacity = `${1 - i * 0.2}`;
      this.root.querySelector("#combat-log")!.append(el);
    });
  }
  paintMap() {
    const ctx = this.mapBase.getContext("2d")!;
    for (let x = 0; x < 240; x += 2)
      for (let y = 0; y < 200; y += 2) {
        const wx = (x / 240) * 100 - 50,
          wz = (y / 200) * 84 - 55,
          h = ground(wx, wz);
        const path = Math.abs(wx - Math.sin(wz * 0.06) * 4) < 2.5;
        ctx.fillStyle = path ? "#b19b6b" : `hsl(92,22%,${30 + h * 4}%)`;
        ctx.fillRect(x, y, 2, 2);
      }
    ctx.fillStyle = "#626d55";
    ctx.beginPath();
    ctx.arc(
      ((24 + 50) / 100) * 240,
      ((-24 + 55) / 84) * 200,
      13,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.strokeStyle = "#b3ab83";
    ctx.lineWidth = 3;
    ctx.stroke();
    let seed = 33;
    for (let i = 0; i < 180; i++) {
      seed = (seed * 16807) % 2147483647;
      const x = (seed / 2147483647) * 240;
      seed = (seed * 16807) % 2147483647;
      const y = (seed / 2147483647) * 200;
      if (Math.abs(x - 120) < 17) continue;
      ctx.fillStyle = "#314d35";
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + 3, y + 3);
      ctx.lineTo(x - 3, y + 3);
      ctx.fill();
    }
  }
  update(dt: number) {
    const p = this.player,
      t = this.combat.target;
    this.messageTimer -= dt;
    this.root.querySelector<HTMLElement>("#notice")!.style.opacity =
      this.messageTimer > 0 ? "1" : "0";
    const set = (id: string, s: string) =>
      (this.root.querySelector(id)!.textContent = s);
    const width = (id: string, n: number) =>
      (this.root.querySelector<HTMLElement>(id)!.style.width =
        `${Math.max(0, n) * 100}%`);
    width("#player-health", p.hp / p.maxHp);
    width("#player-resource", p.resource / 100);
    set("#hp-text", `${Math.ceil(p.hp)} / ${p.maxHp}`);
    set(
      "#resource-text",
      `${Math.floor(p.resource)} / 100 ${p.className === "Warrior" ? "RAGE" : "MANA"}`,
    );
    set("#level", `${p.level}`);
    set("#class-label", `Human ${p.className}`);
    this.root.classList.toggle("mage-class", p.className === "Fire Mage");
    const frame = this.root.querySelector<HTMLElement>("#target-frame")!;
    frame.style.display = t ? "flex" : "none";
    frame.classList.toggle("elite", t?.kind === 3);
    if (t) {
      set("#target-name", `${t.kind === 3 ? "♜ " : ""}${t.name}`);
      set("#enemy-level", `${t.level}`);
      set(
        "#target-hp",
        t.dead ? "Defeated" : `${Math.ceil(t.hp)} / ${t.maxHp}`,
      );
      width("#target-health", t.hp / t.maxHp);
      set(
        "#enemy-intent",
        t.dead
          ? "Click remains to loot"
          : t.stun > 0
            ? "Stunned"
            : t.root > 0
              ? "Rooted"
              : t.cast > 0
                ? "⚠ " +
                  (t.kind === 2
                    ? "Stonebolt"
                    : t.kind === 3
                      ? "Crushing blow"
                      : "Attacking") +
                  "…"
                : t.debuff > 0
                  ? "Mortal wound"
                  : "Hostile · " +
                    (t.kind === 3 ? "Elite" : "Level " + t.level),
      );
    }
    const cast = this.root.querySelector<HTMLElement>("#cast")!;
    cast.style.display = this.combat.casting ? "block" : "none";
    if (this.combat.casting) {
      const c = this.combat.casting;
      set("#cast-name", this.combat.abilities[c.index].name);
      set("#cast-time", `${c.remaining.toFixed(1)}s`);
      width("#cast-fill", 1 - c.remaining / c.total);
    }
    this.root.querySelectorAll<HTMLElement>(".ability").forEach((el, i) => {
      const cd = this.combat.cooldowns[i],
        gcd = this.combat.gcd;
      const fraction = Math.max(
        cd / (this.combat.abilities[i].cooldown || 1),
        gcd / 1.5,
      );
      el.querySelector<HTMLElement>(".cooldown-sweep")!.style.background =
        `conic-gradient(#050b0dd9 ${fraction * 360}deg,transparent 0deg)`;
      el.querySelector(".cooldown-time")!.textContent =
        cd > 0 ? Math.ceil(cd).toString() : "";
      el.classList.toggle(
        "unavailable",
        p.resource < this.combat.abilities[i].cost,
      );
    });
    width("#xp-fill", p.xp / (p.level * 100));
    set("#xp-label", `LEVEL ${p.level}  ·  ${p.xp} / ${p.level * 100} XP`);
    set(
      "#buffs",
      p.shield > 0
        ? `⬡ Barrier ${Math.ceil(p.shield)}`
        : p.buff > 0
          ? `⚑ Battle Shout ${Math.ceil(p.buff)}s`
          : p.victory > 0
            ? "✚ Victory Rush ready"
            : "",
    );
    this.root.querySelector<HTMLElement>("#death")!.hidden = !p.dead;
    const ctx = this.map.getContext("2d")!;
    ctx.drawImage(this.mapBase, 0, 0);
    const dot = (x: number, z: number, r: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(((x + 50) / 100) * 240, ((z + 55) / 84) * 200, r, 0, Math.PI * 2);
      ctx.fill();
    };
    this.enemies.enemies.forEach((e) => {
      if (!e.dead)
        dot(
          e.model.position.x,
          e.model.position.z,
          e.kind === 3 ? 4 : 2.5,
          e.kind === 3 ? "#ffe29b" : "#e68269",
        );
      else if (!e.looted)
        dot(e.model.position.x, e.model.position.z, 2, "#ffe789");
    });
    dot(-3, -3, 4, "#ffdd74");
    if (this.mapDestination) {
      const d = this.mapDestination;
      dot(d.x, d.y, 5, "#b3dcff");
    }
    const pos = p.model.position;
    dot(pos.x, pos.z, 4, "#f5f0c5");
    ctx.save();
    ctx.translate(((pos.x + 50) / 100) * 240, ((pos.z + 55) / 84) * 200);
    ctx.rotate(-p.model.rotation.y);
    ctx.fillStyle = "#fff9d5";
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(-4, -3);
    ctx.lineTo(4, -3);
    ctx.fill();
    ctx.restore();
    set("#coordinates", `${Math.round(pos.x)}, ${Math.round(pos.z)}`);
  }
  dispose() {
    this.abort.abort();
    this.root.remove();
    this.floating.remove();
  }
}
