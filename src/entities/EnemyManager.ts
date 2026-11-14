import * as T from "three";
import { ground, humanoid, mesh, animate } from "../engine/Models";
import { Player } from "./Player";
export type Enemy = {
  id: number;
  name: string;
  kind: number;
  model: T.Group;
  home: T.Vector3;
  hp: number;
  maxHp: number;
  level: number;
  dead: boolean;
  respawn: number;
  cooldown: number;
  cast: number;
  stun: number;
  root: number;
  debuff: number;
  looted: boolean;
  telegraph: T.Mesh;
};
export class EnemyManager {
  enemies: Enemy[] = [];
  onDeath: (e: Enemy) => void = () => {};
  onHit: (n: number) => void = () => {};
  constructor(private scene: T.Scene) {
    const spawns = [
      [0, -6, -12],
      [0, 8, -16],
      [0, -10, -20],
      [0, 11, -7],
      [1, -6, -29],
      [1, 9, -32],
      [1, 16, -24],
      [2, -13, -37],
      [2, 2, -42],
      [2, 17, -38],
      [3, 24, -24],
    ];
    spawns.forEach(([kind, x, z], id) => {
      const names = [
        "Forest Wolf",
        "Defias Outlaw",
        "Kobold Geomancer",
        "Captain Ashthorn",
      ];
      let model: T.Group;
      if (kind === 0) {
        model = new T.Group();
        model.add(
          mesh(new T.BoxGeometry(0.65, 0.65, 1.2), 0x878c80, 0, 0.65, 0),
        );
        model.add(
          mesh(new T.IcosahedronGeometry(0.35), 0xb6b4a0, 0, 0.95, 0.65),
        );
        for (const side of [-1, 1])
          for (const front of [-1, 1])
            model.add(
              mesh(
                new T.CylinderGeometry(0.09, 0.07, 0.5, 5),
                0x60695f,
                side * 0.23,
                0.25,
                front * 0.4,
              ),
            );
        for (const side of [-1, 1])
          model.add(
            mesh(
              new T.ConeGeometry(0.14, 0.3, 4),
              0x777f71,
              side * 0.2,
              1.25,
              0.55,
            ),
          );
      } else
        model = humanoid([0, 0x8e493b, 0x9d793e, 0x3f4c50][kind], kind === 2);
      if (kind === 3) model.scale.setScalar(1.5);
      model.position.set(x, ground(x, z), z);
      scene.add(model);
      const telegraph = new T.Mesh(
        new T.RingGeometry(0.2, kind === 3 ? 4 : 2.5, 48),
        new T.MeshBasicMaterial({
          color: 0xff5739,
          transparent: true,
          opacity: 0.35,
          side: T.DoubleSide,
          depthWrite: false,
        }),
      );
      telegraph.rotation.x = -Math.PI / 2;
      telegraph.visible = false;
      scene.add(telegraph);
      const maxHp = [72, 110, 90, 480][kind];
      this.enemies.push({
        id,
        name: names[kind],
        kind,
        model,
        home: model.position.clone(),
        hp: maxHp,
        maxHp,
        level: kind + 1,
        dead: false,
        respawn: 0,
        cooldown: 2,
        cast: 0,
        stun: 0,
        root: 0,
        debuff: 0,
        looted: false,
        telegraph,
      });
    });
  }
  damage(e: Enemy, n: number) {
    if (e.dead) return;
    e.hp = Math.max(0, e.hp - n);
    if (e.hp === 0) {
      e.dead = true;
      e.respawn = 35;
      e.model.rotation.z = Math.PI / 2;
      e.telegraph.visible = false;
      this.onDeath(e);
    }
  }
  update(dt: number, time: number, player: Player) {
    for (const e of this.enemies) {
      if (e.dead) {
        e.respawn -= dt;
        if (e.respawn <= 0) {
          e.model.scale.setScalar(e.kind === 3 ? 1.5 : 1);
          e.dead = false;
          e.looted = false;
          e.hp = e.maxHp;
          e.model.position.copy(e.home);
          e.model.rotation.z = 0;
        }
        continue;
      }
      e.stun = Math.max(0, e.stun - dt);
      e.root = Math.max(0, e.root - dt);
      e.debuff = Math.max(0, e.debuff - dt);
      const p = e.model.position;
      const delta = player.model.position.clone().sub(p);
      const distance = delta.length();
      const leash = p.distanceTo(e.home) > 23;
      const aggro = !player.dead && !leash && (distance < 12 || e.hp < e.maxHp);
      let moving = false;
      if (e.stun <= 0) {
        if (aggro) {
          e.model.rotation.y = Math.atan2(delta.x, delta.z);
          e.cooldown -= dt;
          if (e.cast > 0) {
            e.cast -= dt;
            if (e.cast <= 0) {
              if (distance < (e.kind === 2 ? 16 : e.kind === 3 ? 4.5 : 2.7)) {
                const n = [8, 11, 13, 23][e.kind];
                const dealt = Math.round(n * (e.debuff > 0 ? 0.7 : 1));
                player.damage(dealt);
                this.onHit(dealt);
              }
              e.cooldown = e.kind === 3 ? 3.5 : 2;
            }
          } else if (distance < (e.kind === 2 ? 13 : 2.3) && e.cooldown <= 0) {
            e.cast = e.kind >= 2 ? 1.5 : 0.5;
          } else if (distance > (e.kind === 2 ? 9 : 1.8) && e.root <= 0) {
            p.addScaledVector(
              delta.normalize(),
              dt * (e.kind === 0 ? 3.4 : 2.6),
            );
            moving = true;
          }
        } else {
          if (leash || e.hp < e.maxHp) {
            e.hp = Math.min(e.maxHp, e.hp + dt * 25);
          }
          const goal = e.home
            .clone()
            .add(
              new T.Vector3(
                Math.sin(time * 0.22 + e.id) * 2,
                0,
                Math.cos(time * 0.22 + e.id) * 2,
              ),
            );
          const d = goal.sub(p);
          if (d.length() > 1 && e.root <= 0) {
            e.model.rotation.y = Math.atan2(d.x, d.z);
            p.addScaledVector(d.normalize(), dt * 1.4);
            moving = true;
          }
          e.cast = 0;
        }
      }
      p.y = ground(p.x, p.z);
      e.telegraph.position.set(p.x, p.y + 0.06, p.z);
      e.telegraph.visible = e.cast > 0 && e.kind >= 2;
      e.telegraph.scale.setScalar(0.7 + Math.sin(time * 8) * 0.1);
      animate(e.model, time, moving, e.cast > 0 ? 0.5 : 0);
    }
  }
}
