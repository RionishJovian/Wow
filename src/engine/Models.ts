import * as T from "three";
export const ground = (x: number, z: number) =>
  Math.sin(x * 0.075) * 1.5 +
  Math.cos(z * 0.09) * 1.1 +
  Math.sin((x + z) * 0.12) * 0.45;
export function mesh(g: T.BufferGeometry, c: number, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(
    g,
    new T.MeshStandardMaterial({ color: c, roughness: 0.85 }),
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
export function humanoid(color: number, mage = false) {
  const root = new T.Group();
  const body = mesh(
    new T.CylinderGeometry(0.34, 0.25, 0.73, 6),
    color,
    0,
    1.05,
    0,
  );
  root.add(body);
  root.add(mesh(new T.SphereGeometry(0.23, 8, 6), 0xdcb38a, 0, 1.66, 0));
  root.add(
    mesh(
      new T.ConeGeometry(mage ? 0.29 : 0.27, mage ? 0.6 : 0.24, 6),
      mage ? 0x783c32 : 0x778886,
      0,
      mage ? 2 : 1.88,
      0,
    ),
  );
  for (const side of [-1, 1])
    root.add(
      mesh(
        new T.SphereGeometry(0.035, 5, 4),
        0x29362d,
        side * 0.09,
        1.7,
        0.205,
      ),
    );
  const cloak = mesh(
    new T.ConeGeometry(0.34, 0.8, 5, 1, true),
    mage ? 0x743a38 : 0x374e58,
    0,
    0.98,
    -0.16,
  );
  cloak.rotation.x = -0.15;
  root.add(cloak);
  const limbs: T.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new T.Group();
    arm.position.set(side * 0.44, 1.35, 0);
    arm.add(
      mesh(new T.CylinderGeometry(0.12, 0.1, 0.66, 5), color, 0, -0.25, 0),
    );
    root.add(arm);
    limbs.push(arm);
    const leg = new T.Group();
    leg.position.set(side * 0.16, 0.76, 0);
    leg.add(
      mesh(new T.CylinderGeometry(0.12, 0.14, 0.7, 5), 0x343a36, 0, -0.32, 0),
    );
    root.add(leg);
    limbs.push(leg);
    root.add(
      mesh(
        new T.IcosahedronGeometry(0.23, 0),
        mage ? 0x9e673a : 0xc4b47d,
        side * 0.44,
        1.4,
        0,
      ),
    );
  }
  const weapon = mesh(
    new T.BoxGeometry(0.1, mage ? 1.5 : 0.95, 0.12),
    mage ? 0x775132 : 0xd0d6c3,
    0.57,
    0.95,
    0.2,
  );
  const weaponArm = limbs[2];
  weapon.position.sub(weaponArm.position);
  weaponArm.add(weapon);
  if (mage)
    weaponArm.add(
      mesh(new T.OctahedronGeometry(0.2), 0xff8b37, 0.13, 0.43, 0.2),
    );
  else
    weaponArm.add(
      mesh(new T.BoxGeometry(0.35, 0.08, 0.13), 0xd7ac57, 0.13, -0.65, 0.2),
    );
  root.userData.limbs = limbs;
  return root;
}
export function animate(
  model: T.Group,
  time: number,
  moving: boolean,
  attack = 0,
) {
  const limbs = model.userData.limbs as T.Group[] | undefined;
  limbs?.forEach(
    (l, i) =>
      (l.rotation.x = moving
        ? Math.sin(time * 9 + (i < 2 ? 0 : Math.PI) + (i % 2) * Math.PI) * 0.65
        : Math.sin(time * 2 + i) * 0.025),
  );
  if (limbs && attack > 0)
    limbs[2].rotation.x = -Math.sin(attack * Math.PI) * 2;
}
export function disposeObject(object: T.Object3D) {
  object.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

export const disposeScene = disposeObject;
