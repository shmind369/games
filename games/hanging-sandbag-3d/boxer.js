// 操作できるボクサー
//  - 構え(fightIdleUsa.json のアイドル)を保ったまま、反復横跳びのようなステップで移動する。常にバッグの方を向く
//    1回の跳び = 溜め(膝を曲げて沈む。足元は動かない)→ 蹴り出し(地面を蹴って一気に跳ぶ)→ 着地(膝で受け止める)。
//    スティックを倒している間はこれを繰り返す。体が動くのは蹴り出しの間だけなので、足が床を滑らない
//  - パンチ(ジャブ / ストレート)はクリップを上半身に重ねる。毎フレーム、グローブの実際の位置を
//    バッグの物理形状(円筒)と照合し、当たったらその接触点に、拳の進む向きの撃力を加える
import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

export const BOXER = {
  // ---- 反復横跳びステップ ----
  hopLoad: 0.10,         // 溜め(沈み込み)の時間 [s]
  hopChainLoad: 0.05,    // 連続で跳ぶときの溜め(着地で沈んでいるので短く)[s]
  hopPush: 0.15,         // 蹴り出して移動する時間 [s]
  hopLand: 0.10,         // 着地して受け止める時間 [s]
  hopDistMin: 0.22,      // 1回の跳びの距離(スティック 65% のとき)[m]
  hopDistMax: 0.55,      // 1回の跳びの距離(スティック 100% のとき)[m]
  hopHeight: 0.06,       // 跳んだときの浮き [m]
  loadKnee: 0.48,        // 溜めの膝の曲げ [rad]
  landKnee: 0.36,        // 着地の膝の曲げ [rad]
  hopLean: 0.16,         // 蹴り出しで進む向きへ体を傾ける量 [rad]
  legSwing: 0.42,        // 前後に跳ぶときの脚の振り [rad]
  sideSwing: 0.36,       // 横に跳ぶときの脚の開き [rad]
  poseRate: 32,          // 膝・傾きを目標へ寄せる速さ(段差なく切り替える)
  idleBounce: 0.012,     // 止まっているときの小さな弾み [m]
  dodgeIn: 30,           // 回避姿勢へ入る速さ(補間。大きいほど速く反応)
  dodgeOut: 18,          // 回避姿勢から戻る速さ(補間。離すと自然にニュートラルへ)
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
    // フック: クリップが無いので手続きで作る(HOOK を参照)
    hookL: { hook: 'L', hand: 'LeftHand', fore: 'LeftForearm', impulse: 26 },
    hookR: { hook: 'R', hand: 'RightHand', fore: 'RightForearm', impulse: 28 },
  },
};

// ---- 回避動作(それぞれ独立したポーズとして管理。重み 0〜1 で深さが変わる) ----
//  bones: そのボーンに足す回転 [x, y, z](rad、重み1のとき)。体はモデルの +Z が正面、+X が本人の左
//  knee : 膝を曲げて腰を落とす量(rad)。太もも前へ・すね後ろへ・足首で戻すので、足の裏は床に付いたまま(足は滑らない)
export const DODGES = {
  // ver2: 傾き量を約2倍に(膝は深くなりすぎないよう約1.4倍)
  slipL: { label: 'ヘッドスリップ(左)', knee: 0.3,
    bones: { Spine: [0.08, 0.32, -0.48], Chest: [0, 0.2, -0.44], Neck: [0, 0, -0.2], Head: [0, 0, 0.28] } },
  slipR: { label: 'ヘッドスリップ(右)', knee: 0.3,
    bones: { Spine: [0.08, -0.32, 0.48], Chest: [0, -0.2, 0.44], Neck: [0, 0, 0.2], Head: [0, 0, -0.28] } },
  duck: { label: 'ダッキング', knee: 0.9,
    bones: { Spine: [0.6, 0, 0], Chest: [0.44, 0, 0], Neck: [-0.44, 0, 0], Head: [-0.36, 0, 0] } },
  sway: { label: 'スウェー', knee: 0.22,
    bones: { Spine: [-0.64, 0, 0], Chest: [-0.48, 0, 0], Neck: [0.44, 0, 0], Head: [0.36, 0, 0] } },
};
const THIGH = 0.39, SHIN = 0.32; // 脚の長さ(腰を落とす量の計算用)

// ---- フック(手続きで作るパンチ) ----
//  肘を肩の高さまで横へ張り、外から内へ水平に振り抜く。腰と上体を打つ側の反対へ回して体ごと打つ。
//  方向は胸(Chest)の座標系で指定: +Z = 正面、+X = 本人の左(右フックは X を反転)
export const HOOK = {
  dur: 0.42,                       // 全体の長さ [s]
  tWind: 0.06,                     // 構え → 振りかぶり
  tStrike: 0.15,                   // 振りかぶり → 振り抜き(インパクト)
  tHold: 0.21,                     // 振り抜いた形で一瞬止める
  wind:   { upper: [0.80, -0.15, 0.58], fore: [0.35, 0.05, 0.94], spine: 0.18 },  // 肘を外へ引く
  strike: { upper: [0.30, 0.0, 0.95],  fore: [-0.78, 0.0, 0.63], spine: -0.6 },  // 拳が顔の前を横切る
  hipsTurn: -0.22,                 // 腰の回し(振り抜き時)
  stepIn: 0.33,                    // 体の踏み込み [m](構えの距離 0.78m からでも、回避からのカウンターでも届くように)
};
const ARM_REST = { upper: new THREE.Vector3(0.03034, -0.21804, -0.0029).normalize(), fore: new THREE.Vector3(0.02944, -0.16743, 0.00415).normalize() };
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _qh2 = new THREE.Quaternion(), _qh3 = new THREE.Quaternion();

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
    this.moveW = 0;                 // 跳んでいる度合い(0〜1、滑らかに)
    this.hop = null;                // { phase: 'load'|'push'|'land', t, dirX, dirZ, s, fromX, fromZ, dist }
    this.hopKnee = 0;               // 跳びによる膝の曲げ(平滑化)
    this.hopLeanV = 0;              // 跳びによる体の傾き(平滑化)
    this.hopLegs = 0;               // 跳びによる脚の開き(平滑化)
    this.hopY = 0;                  // 跳びによる浮き
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
    const dur = BOXER.punches[kind].hook ? HOOK.dur : this.clips[kind].keyframes[this.clips[kind].keyframes.length - 1].time / BOXER.punchRate;
    this.punch = { kind, t: 0, dur, hit: false, prevGlove: null };
  }

  /**
   * move: ワールドの移動入力 {x, z}(長さ0〜1) / bag: バッグの現在位置(THREE.Vector3)
   */
  update(dt, now, move, bag) {
    // ---- 移動: 反復横跳び(溜め → 蹴り出し → 着地 を繰り返す) ----
    const px0 = this.pos.x, pz0 = this.pos.y;
    this._updateHop(dt, move);
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
    }
    this.vel.set((this.pos.x - px0) / Math.max(dt, 1e-4), (this.pos.y - pz0) / Math.max(dt, 1e-4));

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
    this.moveW += ((this.hop ? 1 : 0) - this.moveW) * Math.min(1, dt * 10);
    // 跳びの段階ごとの膝・傾き・脚の開きの目標へ、滑らかに寄せる(段差なし)
    const H = this.hop, kr = Math.min(1, BOXER.poseRate * dt);
    let kneeT = 0, leanT = 0, legsT = 0;
    this.hopY = 0;
    if (H) {
      if (H.phase === 'load') { kneeT = BOXER.loadKnee * (0.75 + 0.25 * H.s); leanT = -0.04; }
      else if (H.phase === 'push') {
        const p = Math.min(1, H.t / BOXER.hopPush);
        kneeT = p < 0.35 ? 0 : 0.1;            // 一気に脚を伸ばして蹴る
        leanT = BOXER.hopLean;
        legsT = Math.sin(Math.PI * p);
        this.hopY = BOXER.hopHeight * (0.6 + 0.4 * H.s) * Math.sin(Math.PI * p);
      } else { kneeT = H.t < BOXER.hopLand * 0.5 ? BOXER.landKnee : 0.15; leanT = 0.05; }
    }
    this.hopKnee += (kneeT - this.hopKnee) * kr;
    this.hopLeanV += (leanT - this.hopLeanV) * kr;
    this.hopLegs += (legsT - this.hopLegs) * kr;
    for (const k in this.dodgeW) {
      const tgt = this.dodgeTarget[k], cur = this.dodgeW[k];
      this.dodgeW[k] += (tgt - cur) * Math.min(1, (tgt > cur ? BOXER.dodgeIn : BOXER.dodgeOut) * dt);
    }
    this._pose(now, speed);

    this.group.position.set(this.pos.x, 0, this.pos.y);
    this.group.rotation.y = this.yaw;
  }

  /** フックの姿勢を構えの上に重ねる。戻り値は体の前への踏み込み量 [m] */
  _hookPose(P) {
    const B = this.bones, side = BOXER.punches[P.kind].hook, sx = side === 'L' ? 1 : -1, H = HOOK, t = P.t;
    // 構えに対する重み(入り・抜け)と、振りかぶり→振り抜きの進み
    let w, k;
    if (t < H.tWind) { w = t / H.tWind; k = 0; }
    else if (t < H.tStrike) { w = 1; k = (t - H.tWind) / (H.tStrike - H.tWind); k = k * k * (3 - 2 * k); }
    else if (t < H.tHold) { w = 1; k = 1; }
    else { w = Math.max(0, 1 - (t - H.tHold) / (H.dur - H.tHold)); k = 1; }
    w = w * w * (3 - 2 * w);
    const pre = side === 'L' ? 'Left' : 'Right';
    const sh = B[pre + 'Shoulder'], ua = B[pre + 'UpperArm'], fa = B[pre + 'Forearm'];
    if (sh && ua && fa) {
      const dir = (key) => {
        const a = H.wind[key], b = H.strike[key];
        _v1.set(a[0] * sx, a[1], a[2]).normalize();
        _v2.set(b[0] * sx, b[1], b[2]).normalize();
        // 外から内へ水平に回り込むよう、振りかぶりの方向を振り抜きの方向へ k の割合だけ回す
        const q = new THREE.Quaternion().setFromUnitVectors(_v1, _v2).slerp(_qh3.identity(), 1 - k);
        return _v1.clone().applyQuaternion(q).normalize();
      };
      // 上腕: 胸の座標系の方向 → 肩のローカルへ
      const shInv = _qh2.copy(sh.quaternion).invert();
      const du = dir('upper').applyQuaternion(shInv);
      const restU = ARM_REST.upper.clone(); restU.x *= sx;
      const qU = new THREE.Quaternion().setFromUnitVectors(restU, du);
      // 前腕: 胸の座標系の方向 → 上腕のローカルへ
      const df = dir('fore').applyQuaternion(_qh2.copy(sh.quaternion).multiply(qU).invert());
      const restF = ARM_REST.fore.clone(); restF.x *= sx;
      const qF = new THREE.Quaternion().setFromUnitVectors(restF, df);
      ua.quaternion.slerp(qU, w);
      fa.quaternion.slerp(qF, w);
    }
    // 上体と腰を回して体ごと打つ(左フックは右回り = Y を負へ)
    const spin = (H.wind.spine + (H.strike.spine - H.wind.spine) * k) * sx * w;
    if (B.Spine) B.Spine.quaternion.multiply(_qb.setFromEuler(_e.set(0, spin * 0.55, 0)));
    if (B.Chest) B.Chest.quaternion.multiply(_qb.setFromEuler(_e.set(0, spin * 0.45, 0)));
    if (B.Hips) B.Hips.quaternion.multiply(_qb.setFromEuler(_e.set(0, H.hipsTurn * k * sx * w, 0)));
    return H.stepIn * k * w;
  }

  /** 跳びの状態を進める。体が動くのは蹴り出し(push)の間だけ */
  _updateHop(dt, move) {
    const m = Math.min(1, Math.hypot(move.x, move.z));
    const want = m > 0.05;
    let H = this.hop;
    if (!H) {
      if (!want) return;
      H = this.hop = { phase: 'load', t: 0, loadDur: BOXER.hopLoad, dirX: move.x / m, dirZ: move.z / m, s: m };
    }
    H.t += dt;
    if (H.phase === 'load') {
      if (!want) { this.hop = null; return; }               // 溜め中に離した: 跳ばずにその場へ
      H.dirX = move.x / m; H.dirZ = move.z / m; H.s = m;     // 蹴る直前まで向きを受け付ける
      if (H.t >= H.loadDur) {
        const sp = (H.s - 0.6) / 0.4;                        // スティック 60〜100% → 0..1
        H.dist = BOXER.hopDistMin + (BOXER.hopDistMax - BOXER.hopDistMin) * Math.max(0, Math.min(1, sp));
        if (this.punch) H.dist *= 0.5;                      // パンチ中は小さく
        H.phase = 'push'; H.t = 0; H.fromX = this.pos.x; H.fromZ = this.pos.y; H.done = 0;
      }
    } else if (H.phase === 'push') {
      const p = Math.min(1, H.t / BOXER.hopPush);
      const e = 1 - (1 - p) * (1 - p);                       // 蹴った瞬間がいちばん速く、着地へ向けて減速
      const dd = (e - H.done) * H.dist;
      H.done = e;
      this.pos.x += H.dirX * dd; this.pos.y += H.dirZ * dd;
      if (p >= 1) { H.phase = 'land'; H.t = 0; }
    } else if (H.t >= BOXER.hopLand) {
      if (want) Object.assign(H, { phase: 'load', t: 0, loadDur: BOXER.hopChainLoad, dirX: move.x / m, dirZ: move.z / m, s: m });
      else this.hop = null;
    }
  }

  _pose(now, speed) {
    const B = this.bones;
    const idle = sampleClip(this.idle, now, true);
    for (const n in idle.pose) if (B[n]) B[n].quaternion.copy(idle.pose[n]);
    let y = idle.y, z = 0;

    // ---- パンチ(上半身にクリップを重ねる) ----
    if (this.punch && BOXER.punches[this.punch.kind].hook) {
      z += this._hookPose(this.punch);
    } else if (this.punch) {
      const P = this.punch, clip = this.clips[P.kind];
      const s = sampleClip(clip, P.t * BOXER.punchRate, false);
      const w = Math.min(1, P.t / BOXER.blendIn, (P.dur - P.t) / BOXER.blendOut);
      for (const n of UPPER) if (B[n] && s.pose[n]) B[n].quaternion.slerp(s.pose[n], w);
      y += (s.y - idle.y) * w;
      z += s.z * w; // ストレートは体ごと前へ踏み込む
    }

    // ---- 反復横跳び(蹴り出しで進む向きへ体を傾け、脚を開いて跳ぶ) ----
    const w = this.moveW;
    const H = this.hop;
    if (H && H.dirX !== undefined) {
      // 跳ぶ向きを体の向き基準に(f: 前+ / sd: 左+。モデルの左 = +X)
      const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      const f = H.dirX * sn + H.dirZ * c, sd = H.dirX * c - H.dirZ * sn;
      const lean = this.hopLeanV, q = this.hopLegs;
      if (B.Spine) B.Spine.quaternion.multiply(_qb.setFromEuler(_e.set(f * lean, 0, -sd * lean)));
      if (q > 1e-3) {
        // 進む側の脚が先へ伸び、反対の脚が地面を蹴って後ろへ残る
        const leadLeft = Math.abs(sd) > Math.abs(f) ? sd > 0 : f >= 0;
        const lead = B[leadLeft ? 'LeftUpperLeg' : 'RightUpperLeg'], trail = B[leadLeft ? 'RightUpperLeg' : 'LeftUpperLeg'];
        if (lead) lead.quaternion.multiply(_qb.setFromEuler(_e.set(-f * BOXER.legSwing * q, 0, sd * BOXER.sideSwing * q)));
        if (trail) trail.quaternion.multiply(_qb.setFromEuler(_e.set(f * 0.6 * BOXER.legSwing * q, 0, -sd * 0.6 * BOXER.sideSwing * q)));
      }
    }
    y += this.hopY;
    // ---- 回避動作(その場で。足元の位置は動かさない) ----
    let knee = this.hopKnee; // 跳びの溜め・着地の膝の曲げも同じ方法で(足の裏を床に付けたまま沈む)
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
