// 操作できるボクサー
//  - 構え(fightIdleUsa.json のアイドル)を保ったまま、ステップ(フットワーク)で空間を移動する。常にバッグの方を向く
//  - ステップは手続き的に付ける: 1歩ごとに小さく弾み、進む向きの側の足が先に出て、反対の足が引き寄せられる
//  - パンチ(ジャブ / ストレート)はクリップを上半身に重ねる。毎フレーム、グローブの実際の位置を
//    バッグの物理形状(円筒)と照合し、当たったらその接触点に、拳の進む向きの撃力を加える
import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

export const BOXER = {
  moveSpeed: 1.7,        // フットワークの最高速 [m/s]
  accel: 9,              // 速度の追従の速さ
  stepRate: 3.2,         // 最高速でのステップ数 [歩/秒]
  bob: 0.04,             // 1歩ごとの弾み [m]
  legSwing: 0.42,        // 前後へ踏み出す脚の振り [rad]
  sideSwing: 0.32,       // 横へ踏み出す脚の開き [rad]
  kneeBend: 0.45,        // 踏み出す脚の膝の曲げ [rad]
  idleBounce: 0.012,     // 止まっているときの小さな弾み [m]
  dodgeIn: 12,           // 回避姿勢へ入る速さ(補間)
  dodgeOut: 7,           // 回避姿勢から戻る速さ(補間。離すと自然にニュートラルへ)
  turnRate: 10,          // バッグへ向き直る速さ
  minDist: 0.5,          // バッグの吊り位置(真下)からの最小距離 [m]
  maxDist: 4.2,          // 最大距離 [m]
  punchRate: 1.35,       // パンチのクリップの再生速度
  blendIn: 0.05, blendOut: 0.14,
  gloveRadius: 0.09,     // グローブの当たり判定の半径 [m](ボクシンググローブの大きさ)
  gloveReach: 0.07,      // 手首(Hand ボーン)からグローブ中心までの長さ [m]
  capsuleRadius: 0.22, capsuleHalf: 0.55, // 体の当たり判定(バッグがぶつかる)
  bagGap: 0.06,          // 体とバッグの間に必ず空ける隙間 [m]
  punches: {
    jab: { url: './assets/leftJabInPlace1.json', hand: 'LeftHand', fore: 'LeftForearm', impulse: 16 },
    straight: { url: './assets/rightStraight.json', hand: 'RightHand', fore: 'RightForearm', impulse: 30 },
  },
};

// ---- 回避動作(それぞれ独立したポーズとして管理。重み 0〜1 で深さが変わる) ----
//  bones: そのボーンに足す回転 [x, y, z](rad、重み1のとき)。体はモデルの +Z が正面、+X が本人の左
//  knee : 膝を曲げて腰を落とす量(rad)。太もも前へ・すね後ろへ・足首で戻すので、足の裏は床に付いたまま(足は滑らない)
export const DODGES = {
  slipL: { label: 'ヘッドスリップ(左)', knee: 0.22,
    bones: { Spine: [0.04, 0.16, -0.24], Chest: [0, 0.1, -0.22], Neck: [0, 0, -0.1], Head: [0, 0, 0.14] } },
  slipR: { label: 'ヘッドスリップ(右)', knee: 0.22,
    bones: { Spine: [0.04, -0.16, 0.24], Chest: [0, -0.1, 0.22], Neck: [0, 0, 0.1], Head: [0, 0, -0.14] } },
  duck: { label: 'ダッキング', knee: 0.62,
    bones: { Spine: [0.3, 0, 0], Chest: [0.22, 0, 0], Neck: [-0.22, 0, 0], Head: [-0.18, 0, 0] } },
  sway: { label: 'スウェー', knee: 0.16,
    bones: { Spine: [-0.32, 0, 0], Chest: [-0.24, 0, 0], Neck: [0.22, 0, 0], Head: [0.18, 0, 0] } },
};
const THIGH = 0.39, SHIN = 0.32; // 脚の長さ(腰を落とす量の計算用)

const UPPER = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'LeftShoulder', 'LeftUpperArm', 'LeftForearm', 'LeftHand',
  'RightShoulder', 'RightUpperArm', 'RightForearm', 'RightHand'];

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _e = new THREE.Euler();
function sampleClip(clip, t, loop) {
  const keys = clip.keyframes, end = keys[keys.length - 1].time || 1;
  const tt = loop ? ((t % end) + end) % end : Math.max(0, Math.min(end, t));
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].time <= tt) i++;
  const A = keys[i], B = keys[i + 1], f = (tt - A.time) / ((B.time - A.time) || 1), pose = {};
  for (const n in A.pose) pose[n] = new THREE.Quaternion(...A.pose[n]).slerp(_qa.set(...B.pose[n]), f);
  const am = A.modelPosition || [0, 0, 0], bm = B.modelPosition || [0, 0, 0];
  return { pose, y: am[1] + (bm[1] - am[1]) * f, z: am[2] + (bm[2] - am[2]) * f };
}

export class Boxer {
  static async load(scene) {
    const [gltf, idle, jab, straight] = await Promise.all([
      new GLTFLoader().loadAsync('./assets/boxer_rigged.glb'),
      fetch('./assets/fightIdleUsa.json').then((r) => r.json()),
      fetch(BOXER.punches.jab.url).then((r) => r.json()),
      fetch(BOXER.punches.straight.url).then((r) => r.json()),
    ]);
    return new Boxer(scene, gltf, idle, { jab, straight });
  }

  constructor(scene, gltf, idle, clips) {
    this.model = gltf.scene;
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    this.group = new THREE.Group();
    this.group.add(this.model);
    scene.add(this.group);
    this.idle = idle;
    this.clips = clips;

    this.pos = new THREE.Vector2(-0.69, 0.37); // 床の上の位置 (x, z)
    this.vel = new THREE.Vector2();
    this.yaw = 0;
    this.stepPhase = 0;
    this.moveW = 0;                 // フットワークの強さ(0〜1、滑らかに)
    this.dodgeW = { slipL: 0, slipR: 0, duck: 0, sway: 0 };     // 今の回避の重み(補間後)
    this.dodgeTarget = { slipL: 0, slipR: 0, duck: 0, sway: 0 }; // 目標の重み
    this.punch = null;              // { kind, t, dur, hit, prevGlove }
    this.queued = null;
    this._glove = new THREE.Vector3();
    this._fore = new THREE.Vector3();
  }

  /** 回避の目標の重み(各 0〜1)を与える。与えなかったものは 0 へ戻る */
  setDodge(targets) {
    for (const k in this.dodgeTarget) this.dodgeTarget[k] = targets && targets[k] ? targets[k] : 0;
  }

  /** ワールドの方向 (x, z) を、ボクサー基準の (前, 左) に直す */
  toLocal(x, z) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return { fwd: x * s + z * c, left: x * c - z * s };
  }

  /** パンチの入力(出している途中なら1回だけ予約) */
  throwPunch(kind) {
    if (this.punch) { if (this.punch.t > this.punch.dur * 0.45) this.queued = kind; return; }
    const clip = this.clips[kind];
    this.punch = { kind, t: 0, dur: clip.keyframes[clip.keyframes.length - 1].time / BOXER.punchRate, hit: false, prevGlove: null };
  }

  /**
   * move: ワールドの移動入力 {x, z}(長さ0〜1) / bag: バッグの現在位置(THREE.Vector3)
   */
  update(dt, now, move, bag) {
    // ---- 移動(パンチ中は少し遅く) ----
    const slow = this.punch ? 0.35 : 1;
    const tx = move.x * BOXER.moveSpeed * slow, tz = move.z * BOXER.moveSpeed * slow;
    const k = 1 - Math.exp(-BOXER.accel * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.y += (tz - this.vel.y) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    // バッグの吊り位置(原点)のまわりの範囲に収める
    const r = this.pos.length();
    if (r < BOXER.minDist) this.pos.multiplyScalar(BOXER.minDist / Math.max(r, 1e-4));
    if (r > BOXER.maxDist) this.pos.multiplyScalar(BOXER.maxDist / r);
    // 揺れているバッグの今の位置にも踏み込まない(体でバッグを押してエネルギーを注ぎ込まないように)。
    // 逆にバッグが迫ってきたら、ボクサーのほうが押しのけられる
    const bx = this.pos.x - bag.x, bz = this.pos.y - bag.z, bd = Math.hypot(bx, bz);
    const keep = BOXER.capsuleRadius + 0.18 + BOXER.bagGap;
    if (bd < keep) {
      const nx = bd > 1e-4 ? bx / bd : 1, nz = bd > 1e-4 ? bz / bd : 0;
      this.pos.x = bag.x + nx * keep; this.pos.y = bag.z + nz * keep;
      const vn = this.vel.x * nx + this.vel.y * nz;
      if (vn < 0) { this.vel.x -= vn * nx; this.vel.y -= vn * nz; }
    }

    // ---- 常にバッグの方を向く ----
    const want = Math.atan2(bag.x - this.pos.x, bag.z - this.pos.y);
    let d = want - this.yaw;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.yaw += d * Math.min(1, BOXER.turnRate * dt);

    // ---- パンチの進行 ----
    if (this.punch) {
      this.punch.t += dt;
      if (this.punch.t >= this.punch.dur) {
        this.punch = null;
        if (this.queued) { const q = this.queued; this.queued = null; this.throwPunch(q); }
      }
    }

    // ---- 姿勢 ----
    const speed = this.vel.length();
    const sf = Math.min(1, speed / BOXER.moveSpeed);
    this.moveW += ((speed > 0.15 ? 1 : 0) - this.moveW) * Math.min(1, dt * 10);
    this.stepPhase += BOXER.stepRate * Math.max(sf, 0.35 * this.moveW) * dt;
    for (const k in this.dodgeW) {
      const tgt = this.dodgeTarget[k], cur = this.dodgeW[k];
      this.dodgeW[k] += (tgt - cur) * Math.min(1, (tgt > cur ? BOXER.dodgeIn : BOXER.dodgeOut) * dt);
    }
    this._pose(now, speed);

    this.group.position.set(this.pos.x, 0, this.pos.y);
    this.group.rotation.y = this.yaw;
  }

  _pose(now, speed) {
    const B = this.bones;
    const idle = sampleClip(this.idle, now, true);
    for (const n in idle.pose) if (B[n]) B[n].quaternion.copy(idle.pose[n]);
    let y = idle.y, z = 0;

    // ---- パンチ(上半身にクリップを重ねる) ----
    if (this.punch) {
      const P = this.punch, clip = this.clips[P.kind];
      const s = sampleClip(clip, P.t * BOXER.punchRate, false);
      const w = Math.min(1, P.t / BOXER.blendIn, (P.dur - P.t) / BOXER.blendOut);
      for (const n of UPPER) if (B[n] && s.pose[n]) B[n].quaternion.slerp(s.pose[n], w);
      y += (s.y - idle.y) * w;
      z += s.z * w; // ストレートは体ごと前へ踏み込む
    }

    // ---- ステップ(フットワーク) ----
    const w = this.moveW;
    if (w > 0.01) {
      // 進む向きを体の向き基準に(f: 前+ / s: 左+。モデルの左 = +X)
      const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      const spd = Math.max(speed, 1e-4);
      const f = (this.vel.x * sn + this.vel.y * c) / spd;
      const sd = (this.vel.x * c - this.vel.y * sn) / spd;
      const ph = this.stepPhase % 1;
      const half = ph < 0.5 ? 0 : 1, h = (ph % 0.5) * 2;   // 前半/後半、その中の進み 0..1
      const lift = Math.sin(Math.PI * h);
      // 先に出す足: 前へなら前足(左)、後ろへなら後ろ足(右)、横へならその側の足
      const leadLeft = Math.abs(sd) > Math.abs(f) ? sd > 0 : f >= 0;
      const movingLeft = half === 0 ? leadLeft : !leadLeft;  // 後半は反対の足を引き寄せる
      const legSide = movingLeft ? 1 : -1;
      const upper = B[movingLeft ? 'LeftUpperLeg' : 'RightUpperLeg'];
      const lower = B[movingLeft ? 'LeftLowerLeg' : 'RightLowerLeg'];
      // 前へ: X を負に回すと脚が前へ。横へ: 左脚は Z を正で外へ(右脚は負で外へ)
      const ax = -f * BOXER.legSwing * lift * w;
      const az = (sd * legSide > 0 ? 1 : 0.4) * sd * BOXER.sideSwing * lift * w;
      if (upper) upper.quaternion.multiply(_qb.setFromEuler(_e.set(ax, 0, az)));
      if (lower) lower.quaternion.multiply(_qb.setFromEuler(_e.set(BOXER.kneeBend * lift * w, 0, 0)));
      y += BOXER.bob * lift * w;
    }
    // ---- 回避動作(その場で。足元の位置は動かさない) ----
    let knee = 0;
    for (const k in DODGES) {
      const wd = this.dodgeW[k];
      if (wd < 1e-3) continue;
      const D = DODGES[k];
      for (const n in D.bones) {
        const [rx, ry, rz] = D.bones[n];
        if (B[n]) B[n].quaternion.multiply(_qb.setFromEuler(_e.set(rx * wd, ry * wd, rz * wd)));
      }
      knee += D.knee * wd;
    }
    if (knee > 1e-3) {
      // 太もも前へ a・すね後ろへ 2a・足首 a で、足の裏を床と平行に保ったまま腰を落とす
      for (const side of ['Left', 'Right']) {
        if (B[side + 'UpperLeg']) B[side + 'UpperLeg'].quaternion.multiply(_qb.setFromEuler(_e.set(-knee, 0, 0)));
        if (B[side + 'LowerLeg']) B[side + 'LowerLeg'].quaternion.multiply(_qb.setFromEuler(_e.set(2 * knee, 0, 0)));
        if (B[side + 'Foot']) B[side + 'Foot'].quaternion.multiply(_qb.setFromEuler(_e.set(-knee, 0, 0)));
      }
      y -= (THIGH + SHIN) * (1 - Math.cos(knee));
    }
    // 止まっているときも軽く弾む(リズム)
    y += BOXER.idleBounce * Math.abs(Math.sin(now * Math.PI * 1.6)) * (1 - w);
    this.model.position.y = y;
    this.model.position.z = z;
  }

  /**
   * パンチの当たり判定。グローブの位置をバッグの円筒と照合し、当たったら {point, dir, normal, impulse} を返す
   * bagT: バッグの位置 {x,y,z}, bagQ: 回転 {x,y,z,w}, R: 半径, H: 長さ
   */
  checkHit(dt, bagT, bagQ, R, H) {
    const P = this.punch;
    if (!P || P.hit) return null;
    const spec = BOXER.punches[P.kind];
    const hand = this.bones[spec.hand], fore = this.bones[spec.fore];
    if (!hand || !fore) return null;
    this.group.updateMatrixWorld(true);
    hand.getWorldPosition(this._glove);
    fore.getWorldPosition(this._fore);
    const dir = this._glove.clone().sub(this._fore).normalize();
    const glove = this._glove.clone().addScaledVector(dir, BOXER.gloveReach);
    const prev = P.prevGlove;
    P.prevGlove = glove.clone();
    if (!prev || P.t < 0.06) return null;
    const vel = glove.clone().sub(prev).divideScalar(Math.max(dt, 1e-3));
    if (vel.lengthSq() < 0.25) return null; // 拳が前へ動いていない(戻り中など)

    // バッグのローカル座標で、前フレームから今フレームまでのグローブの通り道をなぞって判定する
    // (速い拳やフレーム落ちでバッグをすり抜けないように)
    const q = new THREE.Quaternion(bagQ.x, bagQ.y, bagQ.z, bagQ.w), qi = q.clone().invert();
    const T = new THREE.Vector3(bagT.x, bagT.y, bagT.z);
    const a = prev.clone().sub(T).applyQuaternion(qi), b = glove.clone().sub(T).applyQuaternion(qi);
    const velL = b.clone().sub(a);
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.02));
    let local = null;
    for (let i = 1; i <= n; i++) {
      const c = a.clone().lerp(b, i / n);
      const rr = Math.hypot(c.x, c.z);
      if (rr <= R + BOXER.gloveRadius && Math.abs(c.y) <= H / 2 + BOXER.gloveRadius * 0.5 &&
          velL.x * c.x + velL.z * c.z < 0) { local = c; break; } // バッグの内側へ向かって触れた
    }
    if (!local) return null;
    const rad = Math.hypot(local.x, local.z);

    P.hit = true;
    // 接触点: 円筒の側面上、グローブに最も近い点
    const nx = rad > 1e-4 ? local.x / rad : 0, nz = rad > 1e-4 ? local.z / rad : 1;
    const contactL = new THREE.Vector3(nx * R, THREE.MathUtils.clamp(local.y, -H / 2, H / 2), nz * R);
    const point = contactL.applyQuaternion(q).add(new THREE.Vector3(bagT.x, bagT.y, bagT.z));
    const normal = new THREE.Vector3(nx, 0, nz).applyQuaternion(q).normalize();
    // 撃力の向き: 拳の進む向き(上下は控えめに)
    const d = vel.clone();
    d.y *= 0.4;
    d.normalize();
    return { point, dir: d, normal, impulse: spec.impulse, kind: P.kind };
  }
}
