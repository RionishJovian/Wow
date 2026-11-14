import * as T from "three";
import { ground, humanoid, animate, disposeObject } from "../engine/Models";
export type HeroClass = "Warrior" | "Fire Mage";
export class Player {
  model: T.Group;
  className: HeroClass = "Warrior";
  hp = 140;
  maxHp = 140;
  resource = 100;
  level = 1;
  xp = 0;
  power = 0;
  armor = 0;
  shield = 0;
  buff = 0;
  victory = 0;
  velocityY = 0;
  moving = false;
  attack = 0;
  dead = false;
  constructor(private scene: T.Scene) {
    this.model = humanoid(0x536e79);
    scene.add(this.model);
    this.model.position.set(0, ground(0, 5), 5);
  }
  choose(c: HeroClass) {
    const position = this.model.position.clone();
    this.scene.remove(this.model);
    disposeObject(this.model);
    this.className = c;
    this.model = humanoid(
      c === "Warrior" ? 0x536e79 : 0x8b453e,
      c === "Fire Mage",
    );
    this.model.position.copy(position);
    this.scene.add(this.model);
    this.resource = 100;
  }
  update(dt: number, keys: Set<string>, yaw: number, time: number) {
    if (this.dead) {
      this.moving = false;
      return;
    }
    const x = Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
      z = Number(keys.has("KeyS")) - Number(keys.has("KeyW"));
    const direction = new T.Vector3(x, 0, z).applyAxisAngle(
      new T.Vector3(0, 1, 0),
      yaw,
    );
    this.moving = direction.lengthSq() > 0;
    if (this.moving) {
      direction.normalize();
      this.model.position.addScaledVector(direction, dt * 6.3);
      const angle = Math.atan2(direction.x, direction.z);
      this.model.rotation.y +=
        Math.atan2(
          Math.sin(angle - this.model.rotation.y),
          Math.cos(angle - this.model.rotation.y),
        ) * Math.min(1, dt * 12);
    }
    const pos = this.model.position;
    pos.x = T.MathUtils.clamp(pos.x, -73, 73);
    pos.z = T.MathUtils.clamp(pos.z, -73, 73);
    const floor = ground(pos.x, pos.z);
    if (keys.has("Space") && pos.y <= floor + 0.03) this.velocityY = 7;
    this.velocityY -= 20 * dt;
    pos.y = Math.max(floor, pos.y + this.velocityY * dt);
    if (pos.y === floor) this.velocityY = 0;
    this.resource = Math.min(
      100,
      this.resource + dt * (this.className === "Fire Mage" ? 6 : 4),
    );
    this.shield = Math.max(0, this.shield);
    this.buff = Math.max(0, this.buff - dt);
    this.victory = Math.max(0, this.victory - dt);
    this.attack = Math.max(0, this.attack - dt * 3);
    animate(this.model, time, this.moving, this.attack);
  }
  damage(n: number) {
    const absorbed = Math.min(this.shield, n);
    this.shield -= absorbed;
    this.hp = Math.max(0, this.hp - Math.max(0, n - absorbed - this.armor));
    if (this.hp <= 0) this.dead = true;
  }
  respawn() {
    this.hp = this.maxHp;
    this.resource = 100;
    this.dead = false;
    this.model.position.set(0, ground(0, 5), 5);
  }
}
