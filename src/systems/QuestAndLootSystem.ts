import * as T from "three";
import { Player } from "../entities/Player";
import { EnemyManager, type Enemy } from "../entities/EnemyManager";
import { Effects } from "../engine/Effects";
import { Audio } from "./Audio";
import { xpThreshold } from "../combat/rules";
export type Item = {
  name: string;
  rarity: number;
  slot: "Weapon" | "Armor";
  power: number;
  armor: number;
  equipped: boolean;
};
export const quests = [
  {
    title: "A howling in the pines",
    description:
      "Thin the wolves threatening Northwatch. Defeat 3 Forest Wolves.",
    kind: 0,
    required: 3,
    xp: 85,
  },
  {
    title: "Trouble on the old road",
    description: "Break the Defias occupation. Defeat 3 Defias Outlaws.",
    kind: 1,
    required: 3,
    xp: 120,
  },
  {
    title: "The captain of cinders",
    description: "Enter the ruined watchtower and defeat Captain Ashthorn.",
    kind: 3,
    required: 1,
    xp: 220,
  },
];
export class QuestAndLootSystem {
  stage = 0;
  accepted = false;
  progress = 0;
  finished = false;
  gold = 0;
  items: Item[] = [];
  loot?: Enemy;
  onChange: () => void = () => {};
  notify: (s: string) => void = () => {};
  constructor(
    public player: Player,
    private enemies: EnemyManager,
    private fx: Effects,
    private audio: Audio,
  ) {
    enemies.onDeath = (e) => {
      this.player.victory = 20;
      this.addXp(e.kind === 3 ? 90 : 25);
      if (this.accepted && quests[this.stage]?.kind === e.kind)
        this.progress = Math.min(
          quests[this.stage].required,
          this.progress + 1,
        );
      this.notify(`${e.name} defeated`);
      this.onChange();
    };
  }
  get ready() {
    return (
      this.accepted &&
      this.progress >= (quests[this.stage]?.required ?? Infinity)
    );
  }
  interact() {
    if (this.finished) {
      this.notify("Northwatch is safe. Well fought, champion.");
      return;
    }
    if (!this.accepted) {
      this.accepted = true;
      this.notify("Quest accepted: " + quests[this.stage].title);
    } else if (this.ready) {
      this.addXp(quests[this.stage].xp);
      this.gold += 25;
      this.items.push({
        name: ["Greenwarden Blade", "Outrider’s Vest", "Ashthorn’s Legacy"][
          this.stage
        ],
        rarity: this.stage + 1,
        slot: this.stage === 1 ? "Armor" : "Weapon",
        power: this.stage === 1 ? 0 : 12 + this.stage * 8,
        armor: this.stage === 1 ? 4 : 0,
        equipped: false,
      });
      this.stage++;
      this.accepted = false;
      this.progress = 0;
      if (this.stage === 3) this.finished = true;
      this.audio.play("loot");
      this.notify("Quest complete · reward added to bag");
    } else this.notify(quests[this.stage].description);
    this.onChange();
  }
  addXp(n: number) {
    const p = this.player;
    p.xp += n;
    this.fx.text(p.model.position, `+${n} XP`, "#d6b8ff");
    while (p.xp >= xpThreshold(p.level)) {
      p.xp -= xpThreshold(p.level);
      p.level++;
      p.maxHp += 25;
      p.hp = p.maxHp;
      p.power += 3;
      this.fx.burst(p.model.position, 0xffdc65, 65);
      this.fx.ring(p.model.position, 0xffdf7b);
      this.fx.text(p.model.position, "Ding! Level " + p.level);
      this.audio.play("level");
    }
  }
  openLoot(e: Enemy) {
    if (!e.dead || e.looted) return;
    if (e.model.position.distanceTo(this.player.model.position) > 5) {
      this.notify("Move closer to loot");
      return;
    }
    this.loot = e;
    this.onChange();
  }
  takeLoot() {
    if (!this.loot || this.loot.looted) return;
    const e = this.loot;
    const rarity =
      e.kind === 3 ? 3 : Math.random() < 0.22 ? 2 : Math.random() < 0.5 ? 1 : 0;
    this.items.push({
      name: [
        ["Worn Ironblade", "Mosswoven Tunic"][e.id % 2],
        "Verdant Guard",
        "Runed Emberstaff",
        "Crown of Cinders",
      ][rarity],
      rarity,
      slot: e.id % 2 ? "Armor" : "Weapon",
      power: e.id % 2 ? 0 : 5 + rarity * 6,
      armor: e.id % 2 ? 2 + rarity * 2 : 0,
      equipped: false,
    });
    this.gold += e.kind === 3 ? 40 : 5;
    e.looted = true;
    this.loot = undefined;
    this.audio.play("loot");
    this.notify("Loot collected · B to open your bag");
    this.onChange();
  }
  equip(index: number) {
    const item = this.items[index];
    if (!item) return;
    this.items
      .filter((i) => i.slot === item.slot)
      .forEach((i) => {
        if (i.equipped) {
          this.player.power -= i.power;
          this.player.armor -= i.armor;
          i.equipped = false;
        }
      });
    item.equipped = true;
    this.player.power += item.power;
    this.player.armor += item.armor;
    this.audio.play("loot");
    this.onChange();
  }
  update(time: number) {
    for (const e of this.enemies.enemies)
      if (e.dead && !e.looted)
        e.model.scale.setScalar(
          (e.kind === 3 ? 1.5 : 1) * (1 + Math.sin(time * 4) * 0.025),
        );
  }
}
