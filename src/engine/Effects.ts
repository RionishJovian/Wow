import * as T from "three";
type Particle = {
  mesh: T.Mesh;
  life: number;
  max: number;
  velocity: T.Vector3;
};
export class Effects {
  particles: Particle[] = [];
  texts: { el: HTMLElement; pos: T.Vector3; life: number; max: number }[] = [];
  constructor(
    private scene: T.Scene,
    private camera: T.Camera,
    private overlay: HTMLElement,
  ) {}
  burst(position: T.Vector3, color: number, count = 18) {
    for (let i = 0; i < count; i++) {
      const m = new T.Mesh(
        new T.IcosahedronGeometry(0.07 + Math.random() * 0.07),
        new T.MeshBasicMaterial({ color, transparent: true }),
      );
      m.position.copy(position).y += 1;
      this.scene.add(m);
      this.particles.push({
        mesh: m,
        life: 1,
        max: 1,
        velocity: new T.Vector3(
          (Math.random() - 0.5) * 5,
          Math.random() * 5,
          (Math.random() - 0.5) * 5,
        ),
      });
    }
  }
  ring(position: T.Vector3, color: number) {
    const m = new T.Mesh(
      new T.RingGeometry(0.8, 1, 48),
      new T.MeshBasicMaterial({ color, transparent: true, side: T.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.copy(position).y += 0.12;
    this.scene.add(m);
    this.particles.push({
      mesh: m,
      life: 0.65,
      max: 0.65,
      velocity: new T.Vector3(),
    });
    m.userData.ring = true;
  }
  text(position: T.Vector3, label: string, color = "#ffe39c") {
    const el = document.createElement("div");
    el.className = "floating";
    el.textContent = label;
    el.style.color = color;
    this.overlay.append(el);
    this.texts.push({
      el,
      pos: position.clone().add(new T.Vector3(0, 2.6, 0)),
      life: 1.5,
      max: 1.5,
    });
  }
  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.mesh.userData.ring) p.mesh.scale.addScalar(dt * 8);
      else p.velocity.y -= dt * 5;
      (p.mesh.material as T.MeshBasicMaterial).opacity = Math.max(
        0,
        p.life / p.max,
      );
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as T.Material).dispose();
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.pos.y += dt * 0.8;
      const p = t.pos.clone().project(this.camera);
      t.el.style.left = `${(p.x * 0.5 + 0.5) * innerWidth}px`;
      t.el.style.top = `${(-p.y * 0.5 + 0.5) * innerHeight}px`;
      t.el.style.opacity = p.z > 1 ? "0" : `${Math.min(1, t.life * 2)}`;
      if (t.life <= 0) {
        t.el.remove();
        this.texts.splice(i, 1);
      }
    }
  }
  dispose() {
    this.texts.forEach((t) => t.el.remove());
  }
}
