import * as T from "three";
import { ZoneBuilder } from "../world/ZoneBuilder";
import { Player } from "../entities/Player";
import { EnemyManager } from "../entities/EnemyManager";
import { AbilitySystem } from "../combat/AbilitySystem";
import { QuestAndLootSystem } from "../systems/QuestAndLootSystem";
import { CameraControls } from "./CameraControls";
import { Effects } from "./Effects";
import { Audio } from "../systems/Audio";
import { HudOverlay } from "../ui/HudOverlay";
import { TouchControls } from "../ui/TouchControls";
import { disposeScene } from "./Models";
export class GameEngine {
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 200);
  renderer: T.WebGLRenderer;
  zone: ZoneBuilder;
  player: Player;
  enemies: EnemyManager;
  combat: AbilitySystem;
  quests: QuestAndLootSystem;
  controls: CameraControls;
  touch: TouchControls;
  fx: Effects;
  audio = new Audio();
  hud: HudOverlay;
  private last = 0;
  private accumulator = 0;
  private elapsed = 0;
  private frame = 0;
  private abort = new AbortController();
  private ray = new T.Raycaster();
  private pointer = new T.Vector2();
  private labels: {
    element: HTMLElement;
    object: T.Object3D;
    offset: number;
    kind: string;
  }[] = [];
  private nextHeal = 0;
  constructor(container: HTMLElement) {
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    container.append(this.renderer.domElement);
    this.zone = new ZoneBuilder(this.scene);
    this.player = new Player(this.scene);
    this.enemies = new EnemyManager(this.scene);
    const floating = document.createElement("div");
    floating.id = "world-effects";
    document.body.append(floating);
    this.fx = new Effects(this.scene, this.camera, floating);
    this.combat = new AbilitySystem(
      this.scene,
      this.player,
      this.enemies,
      this.fx,
      this.audio,
    );
    this.quests = new QuestAndLootSystem(
      this.player,
      this.enemies,
      this.fx,
      this.audio,
    );
    this.hud = new HudOverlay(
      this.player,
      this.combat,
      this.enemies,
      this.quests,
      this.audio,
    );
    this.controls = new CameraControls(this.camera, this.renderer.domElement);
    this.touch = new TouchControls(this.controls, this.combat, () =>
      this.interact(),
    );
    this.camera.position.set(0, 10, 18);
    this.enemies.onHit = (n) => {
      this.fx.text(this.player.model.position, `−${n}`, "#ff8f7f");
      this.audio.play("hit");
    };
    this.label(
      this.zone.npc,
      '<span class="npc-mark">!</span><strong>Warden Elara</strong><small>Keeper of Northwatch</small>',
      2.8,
      "npc",
    );
    this.enemies.enemies.forEach((e) =>
      this.label(
        e.model,
        `<strong>${e.kind === 3 ? "♜ " : ""}${e.name}</strong><span class="world-health"><i></i></span>`,
        e.kind === 3 ? 3.8 : 2.3,
        `enemy-${e.id}`,
      ),
    );
    const signal = this.abort.signal;
    window.addEventListener("resize", () => this.resize(), { signal });
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code === "KeyE" && !e.repeat) this.interact();
      },
      { signal },
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        this.last = 0;
        this.accumulator = 0;
      },
      { signal },
    );
    this.renderer.domElement.addEventListener(
      "click",
      (e) => {
        this.pointer.set(
          (e.clientX / innerWidth) * 2 - 1,
          (-e.clientY / innerHeight) * 2 + 1,
        );
        this.ray.setFromCamera(this.pointer, this.camera);
        const objects = [
          this.zone.npc,
          ...this.enemies.enemies.map((e) => e.model),
        ];
        const hits = this.ray.intersectObjects(objects, true);
        if (!hits.length) return;
        let object: T.Object3D = hits[0].object;
        while (object.parent && object.parent !== this.scene)
          object = object.parent;
        if (object === this.zone.npc) {
          if (this.player.model.position.distanceTo(object.position) < 6)
            this.hud.openQuest();
          else this.hud.notice("Move closer to Warden Elara");
        } else {
          const enemy = this.enemies.enemies.find((e) => e.model === object);
          if (enemy) {
            this.combat.target = enemy;
            if (enemy.dead) this.quests.openLoot(enemy);
          }
        }
      },
      { signal },
    );
    this.frame = requestAnimationFrame((t) => this.loop(t));
  }
  private label(
    object: T.Object3D,
    html: string,
    offset: number,
    kind: string,
  ) {
    const element = document.createElement("div");
    element.className =
      "world-label " + (kind === "npc" ? "friendly" : "hostile");
    element.innerHTML = html;
    document.body.append(element);
    this.labels.push({ element, object, offset, kind });
  }
  private interact() {
    if (this.player.dead) return;
    if (this.player.model.position.distanceTo(this.zone.npc.position) < 6) {
      this.hud.openQuest();
      return;
    }
    const corpse = this.enemies.enemies.find(
      (e) =>
        e.dead &&
        !e.looted &&
        e.model.position.distanceTo(this.player.model.position) < 5,
    );
    if (corpse) this.quests.openLoot(corpse);
    else this.hud.notice("Move near a quest giver or fallen enemy");
  }
  private resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  }
  private loop(now: number) {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.08) : 1 / 60;
    this.last = now;
    this.elapsed += dt;
    this.accumulator += dt;
    this.player.update(
      dt,
      new Set([...this.controls.keys, ...this.touch.keys]),
      this.controls.yaw,
      this.elapsed,
    );
    while (this.accumulator >= 1 / 60) {
      this.enemies.update(1 / 60, this.elapsed, this.player);
      this.combat.update(1 / 60);
      this.accumulator -= 1 / 60;
    }
    this.controls.update(this.player.model.position, dt);
    this.zone.update(this.elapsed);
    this.quests.update(this.elapsed);
    this.fx.update(dt);
    this.hud.update(dt);
    const near =
      this.player.model.position.distanceTo(this.zone.npc.position) < 6;
    document.querySelector("#interaction")!.textContent = near
      ? "E  ·  Speak to Warden Elara"
      : "";
    if (near && !this.player.dead) {
      this.nextHeal += dt;
      if (this.nextHeal > 1) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 8);
        this.nextHeal = 0;
      }
    }
    this.labels.forEach((l) => {
      const enemy = l.kind.startsWith("enemy-")
        ? this.enemies.enemies[Number(l.kind.slice(6))]
        : undefined;
      const distance = this.player.model.position.distanceTo(l.object.position);
      const p = l.object.position.clone();
      p.y += l.offset;
      p.project(this.camera);
      l.element.style.display =
        p.z > 1 || distance > 35 || enemy?.looted ? "none" : "block";
      l.element.style.left = `${(p.x * 0.5 + 0.5) * innerWidth}px`;
      l.element.style.top = `${(-p.y * 0.5 + 0.5) * innerHeight}px`;
      if (enemy) {
        const bar = l.element.querySelector<HTMLElement>("i");
        if (bar) bar.style.width = `${(enemy.hp / enemy.maxHp) * 100}%`;
        l.element.classList.toggle("corpse", enemy.dead);
        if (
          enemy.dead &&
          !enemy.looted &&
          Math.sin(this.elapsed * 3 + enemy.id) > 0.96
        )
          this.fx.burst(enemy.model.position, 0xffd96d, 2);
      } else {
        l.element.querySelector(".npc-mark")!.textContent = this.quests.finished
          ? "✦"
          : this.quests.ready
            ? "?"
            : "!";
      }
    });
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame((t) => this.loop(t));
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    this.controls.dispose();
    this.touch.dispose();
    this.hud.dispose();
    this.fx.dispose();
    this.audio.dispose();
    this.labels.forEach((l) => l.element.remove());
    document.querySelector("#world-effects")?.remove();
    disposeScene(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
