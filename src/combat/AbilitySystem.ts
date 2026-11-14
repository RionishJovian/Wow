import * as T from "three";
import { Player } from "../entities/Player";
import { EnemyManager, type Enemy } from "../entities/EnemyManager";
import { Effects } from "../engine/Effects";
import { Audio } from "../systems/Audio";
import { GCD, canUse } from "./rules";
export type Ability = {
  name: string;
  icon: string;
  cost: number;
  cooldown: number;
  cast: number;
  description: string;
};
export const warrior: Ability[] = [
  {
    name: "Heroic Strike",
    icon: "⚔",
    cost: 15,
    cooldown: 2,
    cast: 0,
    description: "A powerful melee strike. 15 rage · 3m",
  },
  {
    name: "Mortal Strike",
    icon: "✦",
    cost: 25,
    cooldown: 6,
    cast: 0,
    description: "Heavy damage. Weakens enemy for 8s. 25 rage · 3m",
  },
  {
    name: "Charge",
    icon: "➶",
    cost: 0,
    cooldown: 10,
    cast: 0,
    description: "Rush to a target and stun it. 22m",
  },
  {
    name: "Whirlwind",
    icon: "✺",
    cost: 30,
    cooldown: 8,
    cast: 0,
    description: "Strike every enemy within 5m. 30 rage",
  },
  {
    name: "Battle Shout",
    icon: "⚑",
    cost: 10,
    cooldown: 20,
    cast: 0,
    description: "Increase attack power for 20s. 10 rage",
  },
  {
    name: "Victory Rush",
    icon: "✚",
    cost: 0,
    cooldown: 8,
    cast: 0,
    description: "After a kill, restore 45 health.",
  },
];
export const mage: Ability[] = [
  {
    name: "Fireball",
    icon: "☄",
    cost: 15,
    cooldown: 0,
    cast: 2,
    description: "Cast a fiery projectile. 2s cast · 28m",
  },
  {
    name: "Fire Blast",
    icon: "✹",
    cost: 20,
    cooldown: 7,
    cast: 0,
    description: "An instant, guaranteed critical hit. 25m",
  },
  {
    name: "Frost Nova",
    icon: "❄",
    cost: 20,
    cooldown: 12,
    cast: 0,
    description: "Damage and root nearby enemies for 5s.",
  },
  {
    name: "Pyroblast",
    icon: "♨",
    cost: 30,
    cooldown: 10,
    cast: 3.2,
    description: "A devastating fire projectile. 3.2s cast · 28m",
  },
  {
    name: "Blink",
    icon: "➳",
    cost: 15,
    cooldown: 10,
    cast: 0,
    description: "Teleport 20m in your facing direction.",
  },
  {
    name: "Arcane Barrier",
    icon: "⬡",
    cost: 20,
    cooldown: 18,
    cast: 0,
    description: "Absorb the next 65 damage.",
  },
];
export class AbilitySystem {
  target?: Enemy;
  gcd = 0;
  cooldowns = Array(6).fill(0) as number[];
  casting?: { index: number; remaining: number; total: number; target?: Enemy };
  projectiles: { mesh: T.Mesh; target: Enemy; damage: number }[] = [];
  notice: (s: string) => void = () => {};
  ring: T.Mesh;
  constructor(
    private scene: T.Scene,
    public player: Player,
    public enemies: EnemyManager,
    private fx: Effects,
    private audio: Audio,
  ) {
    this.ring = new T.Mesh(
      new T.RingGeometry(0.8, 1, 64),
      new T.MeshBasicMaterial({
        color: 0xffc65a,
        side: T.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    scene.add(this.ring);
  }
  get abilities() {
    return this.player.className === "Warrior" ? warrior : mage;
  }
  tab() {
    const near = this.enemies.enemies
      .filter(
        (e) =>
          !e.dead &&
          e.model.position.distanceTo(this.player.model.position) < 30,
      )
      .sort(
        (a, b) =>
          a.model.position.distanceTo(this.player.model.position) -
          b.model.position.distanceTo(this.player.model.position),
      );
    this.target = near[(near.indexOf(this.target!) + 1) % near.length];
  }
  use(index: number) {
    const p = this.player,
      a = this.abilities[index],
      target = this.target;
    const w = p.className === "Warrior";
    if (
      !canUse(p.dead, this.gcd, a.cost, p.resource) ||
      this.cooldowns[index] > 0 ||
      this.casting
    ) {
      this.notice(
        p.resource < a.cost
          ? "Not enough " + (w ? "rage" : "mana")
          : "Ability is not ready",
      );
      return;
    }
    const needs = w ? index < 3 : index === 0 || index === 1 || index === 3;
    if (needs && (!target || target.dead)) {
      this.notice("Select a living target · Tab");
      return;
    }
    if (
      needs &&
      target &&
      p.model.position.distanceTo(target.model.position) >
        (w ? (index === 2 ? 22 : 3.6) : 28)
    ) {
      this.notice("Target is out of range");
      return;
    }
    if (w && index === 5 && p.victory <= 0) {
      this.notice("Victory Rush requires a recent kill");
      return;
    }
    if (a.cast && p.moving) {
      this.notice("Stand still to cast");
      return;
    }
    if (needs && target) {
      const d = target.model.position.clone().sub(p.model.position);
      p.model.rotation.y = Math.atan2(d.x, d.z);
    }
    p.resource -= a.cost;
    this.gcd = GCD;
    this.cooldowns[index] = a.cooldown;
    p.attack = 1;
    if (a.cast) {
      this.casting = { index, remaining: a.cast, total: a.cast, target };
      this.notice(`Casting ${a.name}…`);
    } else this.execute(index, target);
  }
  hit(e: Enemy, n: number, crit = false) {
    const p = this.player;
    const damage = Math.round(
      (n + p.power + (p.buff > 0 ? 9 : 0)) * (crit ? 1.7 : 1),
    );
    this.enemies.damage(e, damage);
    this.fx.text(
      e.model.position,
      `${crit ? "Crit! " : ""}${damage}`,
      crit ? "#ffdf7a" : "#fff3cf",
    );
    this.fx.burst(
      e.model.position,
      p.className === "Warrior" ? 0xffd277 : 0xff7135,
      10,
    );
  }
  execute(index: number, target?: Enemy) {
    const p = this.player,
      pos = p.model.position;
    const w = p.className === "Warrior";
    this.audio.play(w ? "hit" : index === 2 ? "frost" : "fire");
    if (w) {
      if (index === 0 && target) this.hit(target, 24, Math.random() < 0.2);
      if (index === 1 && target) {
        this.hit(target, 43);
        target.debuff = 8;
      }
      if (index === 2 && target) {
        const d = pos.clone().sub(target.model.position).normalize();
        pos.copy(target.model.position).addScaledVector(d, 1.8);
        target.stun = 2;
        this.hit(target, 15);
        this.fx.ring(pos, 0xffc769);
      }
      if (index === 3) {
        this.enemies.enemies
          .filter((e) => !e.dead && e.model.position.distanceTo(pos) < 5)
          .forEach((e) => this.hit(e, 33));
        this.fx.ring(pos, 0xffdaa0);
      }
      if (index === 4) {
        p.buff = 20;
        this.fx.burst(pos, 0xffcf65);
        this.fx.text(pos, "Battle Shout!");
      }
      if (index === 5) {
        p.hp = Math.min(p.maxHp, p.hp + 45);
        p.victory = 0;
        this.fx.text(pos, "+45", "#9cf3a1");
        this.fx.burst(pos, 0x71ff9c);
      }
    } else {
      if ((index === 0 || index === 3) && target) {
        const m = new T.Mesh(
          new T.IcosahedronGeometry(index === 3 ? 0.45 : 0.22, 1),
          new T.MeshBasicMaterial({ color: 0xff7b25 }),
        );
        m.position.copy(pos).y += 1.3;
        this.scene.add(m);
        this.projectiles.push({
          mesh: m,
          target,
          damage: index === 3 ? 78 : 37,
        });
      }
      if (index === 1 && target) this.hit(target, 32, true);
      if (index === 2) {
        this.enemies.enemies
          .filter((e) => !e.dead && e.model.position.distanceTo(pos) < 7)
          .forEach((e) => {
            e.root = 5;
            this.hit(e, 14);
          });
        this.fx.ring(pos, 0x83e4ff);
      }
      if (index === 4) {
        this.fx.burst(pos, 0x98ceff);
        pos.add(
          new T.Vector3(
            Math.sin(p.model.rotation.y),
            0,
            Math.cos(p.model.rotation.y),
          ).multiplyScalar(20),
        );
        pos.x = T.MathUtils.clamp(pos.x, -73, 73);
        pos.z = T.MathUtils.clamp(pos.z, -73, 73);
        this.fx.burst(pos, 0x98ceff);
      }
      if (index === 5) {
        p.shield = 65;
        this.fx.ring(pos, 0xbca0ff);
        this.fx.text(pos, "Barrier · 65", "#c1b0ff");
      }
    }
  }
  update(dt: number) {
    this.gcd = Math.max(0, this.gcd - dt);
    this.cooldowns = this.cooldowns.map((n) => Math.max(0, n - dt));
    if (this.casting) {
      if (this.player.moving || this.player.dead || this.casting.target?.dead) {
        this.casting = undefined;
        this.notice("Cast interrupted");
      } else {
        this.casting.remaining -= dt;
        if (this.casting.remaining <= 0) {
          const c = this.casting;
          this.casting = undefined;
          this.execute(c.index, c.target);
        }
      }
    }
    this.ring.visible = !!this.target && !this.target.dead;
    if (this.target) {
      this.ring.position.copy(this.target.model.position).y += 0.08;
      this.ring.scale.setScalar(this.target.kind === 3 ? 1.6 : 1);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i],
        goal = p.target.model.position.clone().add(new T.Vector3(0, 1, 0));
      const d = goal.sub(p.mesh.position);
      if (d.length() < dt * 20 || p.target.dead) {
        if (!p.target.dead) this.hit(p.target, p.damage);
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as T.Material).dispose();
        this.projectiles.splice(i, 1);
      } else p.mesh.position.addScaledVector(d.normalize(), dt * 20);
    }
  }
}
