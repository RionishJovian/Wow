import * as T from "three";
import { ground, mesh, humanoid } from "../engine/Models";
export class ZoneBuilder {
  npc = humanoid(0x416b69);
  braziers: T.Group[] = [];
  constructor(public scene: T.Scene) {
    scene.background = new T.Color(0xa3bcaf);
    scene.fog = new T.FogExp2(0xa3bcaf, 0.014);
    scene.add(new T.HemisphereLight(0xd8eddb, 0x34432a, 2));
    const sun = new T.DirectionalLight(0xffdda3, 3.1);
    sun.position.set(-30, 55, -25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {
      left: -55,
      right: 55,
      top: 55,
      bottom: -55,
      far: 140,
    });
    sun.shadow.bias = -0.001;
    scene.add(sun);
    const geo = new T.PlaneGeometry(170, 170, 110, 110);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    const colors = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i);
      p.setY(i, ground(x, z));
      const path =
        Math.abs(x - Math.sin(z * 0.06) * 4) < 2.5 || Math.hypot(x, z) < 7;
      const c = new T.Color(path ? 0xa99463 : 0x5d7840);
      c.multiplyScalar(0.88 + 0.16 * Math.sin(x * 2 + z * 3));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new T.Mesh(
      geo,
      new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    );
    terrain.receiveShadow = true;
    scene.add(terrain);
    let seed = 184;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // Four instanced forest layers replace hundreds of individual draw calls.
    const trunks = new T.InstancedMesh(
      new T.CylinderGeometry(0.18, 0.4, 0.6, 5),
      new T.MeshStandardMaterial({ color: 0x655239, roughness: 1 }),
      210,
    );
    const crowns = [0x254b3a, 0x315d43, 0x426c46].map(
      (color) =>
        new T.InstancedMesh(
          new T.ConeGeometry(1, 1, 6),
          new T.MeshStandardMaterial({ color, roughness: 1 }),
          210,
        ),
    );
    const transform = new T.Object3D();
    let treeCount = 0;
    for (let i = 0; i < 210; i++) {
      const x = (random() - 0.5) * 150,
        z = (random() - 0.5) * 150;
      if (
        Math.abs(x) < 7 ||
        Math.hypot(x, z) < 13 ||
        Math.hypot(x - 24, z + 24) < 12
      )
        continue;
      const h = 4 + random() * 5,
        y = ground(x, z);
      transform.position.set(x, y + h * 0.3, z);
      transform.scale.set(1, h, 1);
      transform.updateMatrix();
      trunks.setMatrixAt(treeCount, transform.matrix);
      crowns.forEach((layer, j) => {
        const r = h * 0.28 * (1 - j * 0.18);
        transform.position.set(x, y + h * 0.5 + j * h * 0.19, z);
        transform.scale.set(r, h * 0.6, r);
        transform.updateMatrix();
        layer.setMatrixAt(treeCount, transform.matrix);
      });
      treeCount++;
    }
    for (const layer of [trunks, ...crowns]) {
      layer.count = treeCount;
      layer.castShadow = true;
      layer.receiveShadow = true;
      scene.add(layer);
    }
    const rocks = new T.InstancedMesh(
      new T.DodecahedronGeometry(1),
      new T.MeshStandardMaterial({ color: 0x7d8471, roughness: 1 }),
      95,
    );
    let rockCount = 0;
    for (let i = 0; i < 95; i++) {
      const x = (random() - 0.5) * 125,
        z = (random() - 0.5) * 125;
      if (Math.hypot(x, z) < 8) continue;
      const r = 0.3 + random() * 0.9;
      transform.position.set(x, ground(x, z), z);
      transform.scale.set(r, r * 0.6, r);
      transform.updateMatrix();
      rocks.setMatrixAt(rockCount++, transform.matrix);
    }
    rocks.count = rockCount;
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    scene.add(rocks);
    // Broken watchtower and an encircling camp of ancient stone.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (let j = 0; j < (i < 7 ? 3 : 1); j++) {
        const block = mesh(
          new T.BoxGeometry(1.8, 1.2, 1.2),
          j % 2 ? 0x8b8b73 : 0x9c9c83,
          24 + Math.sin(a) * 5,
          ground(24, -24) + 0.6 + j * 1.25,
          -24 + Math.cos(a) * 5,
        );
        block.rotation.y = a;
        scene.add(block);
      }
    }
    for (const [x, z] of [
      [-5, 2],
      [5, 2],
      [-3, -13],
      [4, -26],
      [20, -18],
      [28, -18],
    ]) {
      const b = new T.Group();
      b.add(
        mesh(new T.CylinderGeometry(0.35, 0.5, 1.2, 6), 0x555c50, 0, 0.6, 0),
      );
      b.add(mesh(new T.ConeGeometry(0.42, 0.7, 5), 0xffb44b, 0, 1.5, 0));
      const light = new T.PointLight(0xff9a39, 4, 9);
      light.position.y = 2;
      b.add(light);
      b.position.set(x, ground(x, z), z);
      scene.add(b);
      this.braziers.push(b);
    }
    // Instanced ground cover keeps the meadow detailed without thousands of draw calls.
    const grass = new T.InstancedMesh(
      new T.ConeGeometry(0.11, 0.5, 3),
      new T.MeshStandardMaterial({ color: 0x78964b, roughness: 1 }),
      1800,
    );
    const flowers = new T.InstancedMesh(
      new T.IcosahedronGeometry(0.085, 0),
      new T.MeshStandardMaterial({ color: 0xe9ce8b, roughness: 1 }),
      180,
    );
    const dummy = new T.Object3D();
    for (let i = 0; i < 1800; i++) {
      let x = (random() - 0.5) * 105,
        z = (random() - 0.5) * 105;
      if (Math.abs(x - Math.sin(z * 0.06) * 4) < 3) x += 7;
      dummy.position.set(x, ground(x, z) + 0.15, z);
      dummy.rotation.set(0, random() * 6.28, random() * 0.3);
      dummy.scale.setScalar(0.5 + random());
      dummy.updateMatrix();
      grass.setMatrixAt(i, dummy.matrix);
      if (i < 180) {
        dummy.position.y += 0.12;
        dummy.scale.setScalar(0.8 + random());
        dummy.updateMatrix();
        flowers.setMatrixAt(i, dummy.matrix);
      }
    }
    scene.add(grass, flowers);
    // Roadside sign and a canvas supply tent at the crossing.
    const sign = new T.Group();
    sign.add(
      mesh(new T.CylinderGeometry(0.09, 0.11, 2.5, 6), 0x645039, 0, 1.25, 0),
    );
    sign.add(mesh(new T.BoxGeometry(1.7, 0.35, 0.15), 0x80643f, 0.2, 2.1, 0));
    sign.add(mesh(new T.BoxGeometry(1.4, 0.3, 0.15), 0x80643f, -0.15, 1.65, 0));
    sign.position.set(-5, ground(-5, 7), 7);
    sign.rotation.y = 0.3;
    scene.add(sign);
    const tent = new T.Group();
    const canvas = mesh(new T.ConeGeometry(3, 3.5, 4), 0xb7ad82, 0, 1.75, 0);
    canvas.rotation.y = Math.PI / 4;
    canvas.scale.z = 1.3;
    tent.add(canvas);
    tent.add(mesh(new T.BoxGeometry(0.9, 1.8, 0.1), 0x393f30, 0, 0.9, 2.2));
    tent.add(
      mesh(new T.CylinderGeometry(0.06, 0.06, 4.6, 5), 0x66543b, 0, 2.3, 0),
    );
    const flag = mesh(new T.BoxGeometry(1, 0.7, 0.06), 0x557d88, 0.5, 4.15, 0);
    tent.add(flag);
    tent.position.set(-12, ground(-12, 2), 2);
    scene.add(tent);
    this.npc.position.set(-3, ground(-3, -3), -3);
    this.npc.rotation.y = Math.PI * 0.8;
    scene.add(this.npc);
  }
  update(time: number) {
    this.braziers.forEach((b, i) => {
      b.children[1].scale.setScalar(0.9 + Math.sin(time * 8 + i) * 0.12);
    });
  }
}
