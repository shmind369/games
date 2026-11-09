// 吊り下げ式サンドバッグの物理モデル(描画から独立。Node でもブラウザでも動く)
//
//   天井(固定剛体)
//     │  球面ジョイント A(天井アンカー)
//   チェーン(動的剛体・軽量の棒)
//     │  球面ジョイント B(スイベル)
//   サンドバッグ(動的剛体・円筒、上部の吊りベルトは剛体の一部)
//
// ジョイントは Rapier のインパルスジョイント(球面)。ソルバ反復を増やし、
// 時間刻みを小さく固定することで、連打しても接続点のずれを 1mm 未満に保つ。

export const CONFIG = {
  dt: 1 / 240,             // 物理の固定時間刻み [s]
  gravity: 9.81,

  ceilingY: 2.7,           // 天井アンカーの高さ [m](身長1.74mのボクサーに合わせ、バッグ 0.85〜1.85m)

  chainLength: 0.5,        // チェーン長 [m]
  chainRadius: 0.012,
  chainMass: 1.5,          // [kg]

  strapLength: 0.35,       // スイベル→バッグ上面(吊りベルト) [m]

  bagRadius: 0.18,         // 直径36cm
  bagHeight: 1.0,          // 長さ100cm
  bagMass: 30,             // [kg]

  // 減衰(空気抵抗+ジョイント摩擦の近似)
  bagLinearDamping: 0.12,
  bagAngularDamping: 0.35,
  chainLinearDamping: 0.1,
  chainAngularDamping: 0.6,

  solverIterations: 12,
};

export function createSim(RAPIER, cfg = CONFIG) {
  const world = new RAPIER.World({ x: 0, y: -cfg.gravity, z: 0 });
  world.timestep = cfg.dt;
  world.numSolverIterations = cfg.solverIterations;

  // 動的剛体同士・天井とは衝突させない(ジョイントで接続済み、かつ当たる相手もいない)
  // membership=0x0002, filter=0x0000
  const NO_COLLIDE = (0x0002 << 16) | 0x0000;

  // ---- 天井(固定) ----
  const ceiling = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, cfg.ceilingY, 0)
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 0.05, 1.5).setTranslation(0, 0.05, 0), ceiling);

  // ---- 床(固定。通常は届かないが念のため) ----
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.05, 10).setTranslation(0, -0.05, 0), floor);

  // ---- チェーン ----
  const chainCenterY = cfg.ceilingY - cfg.chainLength / 2;
  const chain = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, chainCenterY, 0)
      .setLinearDamping(cfg.chainLinearDamping)
      .setAngularDamping(cfg.chainAngularDamping)
      .setCanSleep(false) // 振れの途中で眠って止まるのを防ぐ。減衰だけで静止させる
  );
  world.createCollider(
    RAPIER.ColliderDesc.capsule(cfg.chainLength / 2, cfg.chainRadius)
      .setMass(cfg.chainMass)
      .setCollisionGroups(NO_COLLIDE),
    chain
  );

  // ---- サンドバッグ ----
  const swivelY = cfg.ceilingY - cfg.chainLength;
  const bagCenterY = swivelY - cfg.strapLength - cfg.bagHeight / 2;
  const bag = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, bagCenterY, 0)
      .setLinearDamping(cfg.bagLinearDamping)
      .setAngularDamping(cfg.bagAngularDamping)
      .setCanSleep(false) // 振れの途中で眠って止まるのを防ぐ。減衰だけで静止させる
  );
  // 円筒(Y軸)。質量を指定すると慣性モーメントは形状から自動計算される:
  //   Iy = m r^2 / 2,  Ix = Iz = m (3r^2 + h^2) / 12
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(cfg.bagHeight / 2, cfg.bagRadius)
      .setMass(cfg.bagMass)
      .setFriction(0.6)
      .setRestitution(0.0)
      .setCollisionGroups((0x0002 << 16) | 0x0001), // 床とだけ当たる
    bag
  );

  // ---- ジョイント(ローカル座標のアンカー) ----
  const jointA = {
    b1: ceiling, a1: { x: 0, y: 0, z: 0 },
    b2: chain,   a2: { x: 0, y: cfg.chainLength / 2, z: 0 },
  };
  const jointB = {
    b1: chain, a1: { x: 0, y: -cfg.chainLength / 2, z: 0 },
    b2: bag,   a2: { x: 0, y: cfg.bagHeight / 2 + cfg.strapLength, z: 0 },
  };
  for (const j of [jointA, jointB]) {
    const data = RAPIER.JointData.spherical(j.a1, j.a2);
    j.handle = world.createImpulseJoint(data, j.b1, j.b2, true);
    j.handle.setContactsEnabled(false);
  }

  // ---- 補助関数 ----
  function localToWorld(body, p) {
    const t = body.translation();
    const q = body.rotation();
    // q * p * q^-1
    const ix = q.w * p.x + q.y * p.z - q.z * p.y;
    const iy = q.w * p.y + q.z * p.x - q.x * p.z;
    const iz = q.w * p.z + q.x * p.y - q.y * p.x;
    const iw = -q.x * p.x - q.y * p.y - q.z * p.z;
    return {
      x: t.x + ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
      y: t.y + iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
      z: t.z + iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
    };
  }
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  /** 各ジョイントのアンカー点同士のずれ [m] */
  function jointErrors() {
    return [jointA, jointB].map((j) => dist(localToWorld(j.b1, j.a1), localToWorld(j.b2, j.a2)));
  }

  /** 力学的エネルギー(運動+位置)[J]。基準は静止時=0 */
  const restPE = cfg.bagMass * cfg.gravity * bagCenterY + cfg.chainMass * cfg.gravity * chainCenterY;
  function energy() {
    let e = -restPE;
    for (const [b, m, I] of [
      [bag, cfg.bagMass, bag.principalInertia()],
      [chain, cfg.chainMass, chain.principalInertia()],
    ]) {
      const v = b.linvel();
      const w = b.angvel();
      // 角速度をボディ座標に戻して主慣性で評価
      const q = b.rotation();
      const wl = rotateInv(q, w);
      e += 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z);
      e += 0.5 * (I.x * wl.x * wl.x + I.y * wl.y * wl.y + I.z * wl.z * wl.z);
      e += m * cfg.gravity * b.translation().y;
    }
    return e;
  }
  function rotateInv(q, v) {
    return rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
  }
  function rotate(q, v) {
    const ix = q.w * v.x + q.y * v.z - q.z * v.y;
    const iy = q.w * v.y + q.z * v.x - q.x * v.z;
    const iz = q.w * v.z + q.x * v.y - q.y * v.x;
    const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
    return {
      x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
      y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
      z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
    };
  }

  /**
   * 接触点に撃力を加える。
   * point: ワールド座標の接触点, impulse: ワールド座標の撃力ベクトル [N·s]
   * 接触点が重心から離れているほど、r × J のトルク(回転)が大きくなる。
   */
  function hit(point, impulse) {
    bag.applyImpulseAtPoint(impulse, point, true);
  }

  function step() {
    world.step();
  }

  function reset() {
    for (const [b, y] of [[chain, chainCenterY], [bag, bagCenterY]]) {
      b.setTranslation({ x: 0, y, z: 0 }, false);
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false);
      b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.setAngvel({ x: 0, y: 0, z: 0 }, false);
    }
    bag.wakeUp();
  }

  return {
    RAPIER, world, cfg, ceiling, chain, bag, jointA, jointB,
    swivelY, bagCenterY, chainCenterY,
    step, hit, reset, jointErrors, energy, localToWorld,
  };
}
