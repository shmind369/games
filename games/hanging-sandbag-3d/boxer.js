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
  // ---- ダッキング中のパンチの狙い(ローブローにならないよう、上腕を上下に回して相手のボディの高さへ) ----
  duckRise: 0.45,        // ダッキング中のパンチで伸び上がる割合(沈みの深さを打つ間だけこの割合ぶん戻す)
  duckRiseIn: 0.07,      // 伸び上がりの立ち上がり [s(クリップ時間)]
  duckRiseOut: 0.12,     // 打ち終わりに沈みへ戻る時間
  aimExtFrom: 0.12,      // 肩から拳までの水平距離がこれより短い(構えの位置)うちは補正しない [m]
  aimExtTo: 0.30,        // ここまで伸びたら補正を全部かける [m]
  aimMax: 1.0,           // 補正の最大角 [rad]
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
  ringHalf: 2.72,        // リングのロープの内側で動ける範囲(中心から x / z それぞれ)[m]。ロープ際で止まる
  punchRate: 1.35,       // パンチのクリップの再生速度
  // ---- コンビネーション ----
  comboMax: 5,           // 1回のコンビネーションで打てる最大数
  comboRate: 1.15,       // 2発目以降の再生速度の倍率(つなぎを速く)
  comboFade: 0.10,       // 前のパンチから次のパンチへ切り替えるときの混ぜ合わせの時間 [s]
  // 次のパンチを出せるようになる時刻 [s](打ち出してから。拳が伸びきった直後で戻りを切り上げる)
  cancelAt: { jab: 0.20, straight: 0.28, hookL: 0.20, hookR: 0.20, upperL: 0.22, upperR: 0.22 },
  sameHandExtra: 0.08,   // 同じ手で続けるときは戻しの分だけ少し遅く [s]
  comboImpulse: 0.75,    // 2発目以降の撃力の倍率(つなぎのパンチは溜めが小さいぶん軽い。バッグが離れすぎず次も当たる)
  comboStep: 0.14,       // 2発目以降、1発ごとにバッグへ詰める距離 [m](打たれて離れていくバッグを追いかける)
  comboStepTime: 0.12,   // その詰める動きの時間 [s]
  blendIn: 0.05, blendOut: 0.14,
  gloveRadius: 0.09,     // グローブの当たり判定の半径 [m](ボクシンググローブの大きさ)
  bodyHitTop: 0.10,      // ボディに当たるのは拳が腹(Spine)からこの高さまで [m]
  gloveReach: 0.07,      // 手首(Hand ボーン)からグローブ中心までの長さ [m]
  capsuleRadius: 0.22, capsuleHalf: 0.55, // 体の当たり判定(バッグがぶつかる)
  bagGap: 0.06,          // 体とバッグの間に必ず空ける隙間 [m]
  punches: {
    jab: { url: './assets/leftJabInPlace1.json', hand: 'LeftHand', fore: 'LeftForearm', impulse: 16 },
    straight: { url: './assets/rightStraight.json', hand: 'RightHand', fore: 'RightForearm', impulse: 30 },
    // フック: クリップが無いので手続きで作る(HOOK を参照)
    hookL: { hook: 'L', hand: 'LeftHand', fore: 'LeftForearm', impulse: 26 },
    hookR: { hook: 'R', hand: 'RightHand', fore: 'RightForearm', impulse: 28 },
    // アッパー: 同じく手続きで作る(UPPERCUT を参照)
    upperL: { hook: 'L', motion: 'upper', hand: 'LeftHand', fore: 'LeftForearm', impulse: 24 },
    upperR: { hook: 'R', motion: 'upper', hand: 'RightHand', fore: 'RightForearm', impulse: 28 },
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
  // ダッキングは相手のパンチ(拳の高さ 約1.24m)の下へ頭を沈められる深さに(膝を深く、前傾は控えめに)
  duck: { label: 'ダッキング', knee: 1.4,
    bones: { Spine: [0.5, 0, 0], Chest: [0.36, 0, 0], Neck: [-0.4, 0, 0], Head: [-0.32, 0, 0] } },
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
  wind:   { upper: [0.80, -0.02, 0.58], fore: [0.35, 0.10, 0.94], spine: 0.18 },  // 肘を外へ引く
  strike: { upper: [0.30, 0.16, 0.95],  fore: [-0.78, 0.04, 0.63], spine: -0.6 },  // 拳が顔の前を横切る
  hipsTurn: -0.22,                 // 腰の回し(振り抜き時)
  stepIn: 0.33,                    // 体の踏み込み [m](構えの距離 0.78m からでも、回避からのカウンターでも届くように)
};
// ---- アッパーカット(手続きで作るパンチ) ----
//  膝を沈めて打つ側へ体を落とし、拳を腰の高さまで下げる → 脚で伸び上がりながら、肘を前へ出して拳を下から真上へ突き上げる。
//  方向の指定は HOOK と同じ(胸の座標系: +Z = 正面、+X = 本人の左。右は X を反転)
export const UPPERCUT = {
  dur: 0.44,
  tWind: 0.09,                     // 構え → 沈み込み(拳を下げる)
  tStrike: 0.18,                   // 沈み込み → 突き上げ(インパクト)
  tHold: 0.24,
  wind:   { upper: [0.30, -0.92, 0.10], fore: [0.05, -0.25, 0.97], spine: 0.16 },  // 肘を下へ、拳は腰の前
  strike: { upper: [-0.10, -0.06, 0.99], fore: [-0.16, 0.88, 0.44], spine: -0.36 }, // 肘を前へ、拳は顎の高さへ真上に
  knee: { wind: 0.36, strike: 0.04 },        // 膝: 沈んでから伸び上がる
  lean: { wind: 0.16, strike: -0.06 },       // 上体の前後(+ = 前傾)
  roll: { wind: -0.20, strike: 0.06 },       // 打つ側への体の傾き(左アッパーは左へ沈む)
  hipsTurn: -0.18,
  stepIn: 0.32,
};
// ---- 下半身(全身)のレイヤー: 腰の体重移動・回転と、足を床に付けたままの脚の IK ----
//  腰の移動はモデルの座標系 [m](+X = 本人の左、+Z = 前)、回転 [rad](yaw + = 本人の左へ回る)。オーソドックス(左足が前)
export const BODY = {
  spineKeep: 0.8,        // 腰を回した分のうち、上体で戻す割合(残りは上体ごと回る)
  rearStay: 0.65,        // 踏み込みのとき、後ろ足(右)をその場に残す割合(蹴り脚が伸びる)
  reactZ: 0.06,          // 被弾で腰が後ろへ押される量 [m]
  liftSpeed: 1.2,        // この速さ [m/s] 以上で踏み込むと前足を浮かせきる
  liftHeight: 0.05,      // 前足を浮かせる高さ [m]
  heelUp: 0.05,          // 後ろ足のかかとを上げる量 [m](足首の高さ)
  heelTilt: 0.55,        // そのときのつま先側への傾き [rad]
  punch: {
    // imp: 腰が乗りきる時刻 / hold: 保つ時間 [s(パンチの時間)]
    jab:      { imp: 0.15, hold: 0.04, x: 0.015, y: 0.0, z: 0.06, yaw: -0.14 },               // 左足へ少し乗って前へ
    straight: { imp: 0.22, hold: 0.06, x: 0.04,  y: -0.015, z: 0.11, yaw: 0.42, heel: 1 },                // 右の腰を前へ送り、後ろ足で蹴って前足へ乗る
    hookL:    { imp: 0.15, hold: 0.06, x: -0.02, y: -0.02, z: 0.07, yaw: -0.40, roll: -0.05 },  // 左足を軸に腰を右へ切る
    hookR:    { imp: 0.15, hold: 0.06, x: 0.05,  y: -0.02, z: 0.05, yaw: 0.42,  roll: 0.05, heel: 0.9 },   // 右の腰を回して前足へ
    upperL:   { imp: 0.18, hold: 0.06, x: 0.03,  y: 0.02,  z: 0.04, yaw: -0.30, roll: 0.06 },   // 沈みから伸び上がりつつ腰を切る
    upperR:   { imp: 0.18, hold: 0.06, x: 0.04,  y: 0.02,  z: 0.06, yaw: 0.34,  roll: -0.06, heel: 0.8 },
  },
  dodge: {
    slipL: { x: 0.10,  y: -0.03, z: 0.0 },    // 左の脚へ体重を移す
    slipR: { x: -0.10, y: -0.03, z: 0.0 },
    duck:  { x: 0.0,   y: -0.03, z: -0.07 },  // 腰を引いて沈む
    sway:  { x: -0.02, y: -0.03, z: -0.10 },  // 後ろ足へ体重を移す
  },
  legs: [
    { upper: 'LeftUpperLeg', lower: 'LeftLowerLeg', foot: 'LeftFoot', rear: false, target: new THREE.Vector3(), footQ: new THREE.Quaternion() },
    { upper: 'RightUpperLeg', lower: 'RightLowerLeg', foot: 'RightFoot', rear: true, target: new THREE.Vector3(), footQ: new THREE.Quaternion() },
  ],
};
const _bl = { q1: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion(), q4: new THREE.Quaternion(), q5: new THREE.Quaternion(), fwd: new THREE.Vector3() };
const _ik = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), t: new THREE.Vector3(), u: new THREE.Vector3(), v: new THREE.Vector3(), n: new THREE.Vector3(), q: new THREE.Quaternion(), pq: new THREE.Quaternion() };
/** ボーンをワールドの回転 R だけ回す(自分の付け根を中心に) */
function rotateBoneWorld(bone, R) {
  bone.parent.getWorldQuaternion(_ik.pq);
  const pinv = _ik.pq.clone().invert();
  bone.quaternion.premultiply(pinv.multiply(R).multiply(_ik.pq));
  bone.updateMatrixWorld(true);
}
/** 2関節 IK: 太もも(ul)・すね(ll)を回して、足首(ft)を target へ。膝の曲がる面は今の膝の向きを保つ */
function solveLegIK(ul, ll, ft, target) {
  ul.getWorldPosition(_ik.a); ll.getWorldPosition(_ik.b); ft.getWorldPosition(_ik.c);
  const la = _ik.a.distanceTo(_ik.b), lb = _ik.b.distanceTo(_ik.c);
  const d = Math.max(Math.abs(la - lb) + 1e-3, Math.min(la + lb - 1e-3, _ik.a.distanceTo(target)));
  // 膝の角度を合わせる
  _ik.u.subVectors(_ik.a, _ik.b).normalize(); _ik.v.subVectors(_ik.c, _ik.b).normalize();
  const cur = Math.acos(Math.max(-1, Math.min(1, _ik.u.dot(_ik.v))));
  const want = Math.acos(Math.max(-1, Math.min(1, (la * la + lb * lb - d * d) / (2 * la * lb))));
  _ik.n.crossVectors(_ik.u, _ik.v);
  if (_ik.n.lengthSq() > 1e-10 && Math.abs(want - cur) > 1e-5) {
    _ik.n.normalize();
    rotateBoneWorld(ll, _ik.q.setFromAxisAngle(_ik.n, want - cur));
  }
  // 脚全体を target の方向へ向ける
  ft.getWorldPosition(_ik.c);
  _ik.u.subVectors(_ik.c, _ik.a).normalize(); _ik.v.subVectors(target, _ik.a).normalize();
  rotateBoneWorld(ul, _ik.q.setFromUnitVectors(_ik.u, _ik.v));
}
const ARM_REST = { upper: new THREE.Vector3(0.03034, -0.21804, -0.0029).normalize(), fore: new THREE.Vector3(0.02944, -0.16743, 0.00415).normalize() };
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _qh2 = new THREE.Quaternion(), _qh3 = new THREE.Quaternion();

const UPPER = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'LeftShoulder', 'LeftUpperArm', 'LeftForearm', 'LeftHand',
  'RightShoulder', 'RightUpperArm', 'RightForearm', 'RightHand'];

const _aimFrom = new THREE.Vector3(), _aimTo = new THREE.Vector3(), _aimR = new THREE.Quaternion(), _aimPQ = new THREE.Quaternion(), _aimTmp = new THREE.Quaternion();
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
  /** url: モデル(19ボーンの共通骨格。自機 = boxer_rigged.glb、対戦相手 = box_usa_rigged.glb) */
  static async load(scene, url = './assets/boxer_rigged.glb') {
    const [gltf, idle, jab, straight] = await Promise.all([
      new GLTFLoader().loadAsync(url),
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
    this.punch = null;              // { kind, t(クリップ時間), rate, dur, hit, prevGlove }
    this.prevPunch = null;          // コンビネーションで切り上げた前のパンチ(短い間だけ重ねる)
    this.queue = [];                // 予約したパンチ
    this.combo = 0;                 // 今のコンビネーションで何発目か
    this.press = null;              // コンビネーション中の前への詰め
    this.pressMin = 0;              // 詰めるのはこの距離まで(0 なら制限なし。CPU は間合いを詰めすぎない)
    this.aimY = null;
    this._hipsIdleQ = new THREE.Quaternion(); // 下半身レイヤー用: アイドルの腰の向き
    this.reactK = 0;               // ダッキング中のパンチの狙いの高さ(ワールド y)。null なら補正しない
    this.avoidCenter = true;        // サンドバッグモード: バッグの真下(原点)には入らない
    this.keepDist = BOXER.capsuleRadius + 0.18 + BOXER.bagGap; // 相手(バッグ/対戦相手)との最小間隔
    this.react = null;              // 被弾のリアクション
    this.down = null;               // ダウン(KO)
    this.onEvent = null;            // 効果音などのための通知 (type, data): 'swing' / 'push' / 'land'
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
  /**
   * パンチの入力。打っている途中の入力は予約しておき、今のパンチが伸びきった直後に戻りを切り上げて次を打つ
   * (コンビネーション。左右交互ほど速くつながる)。1回のコンビネーションは comboMax 発まで
   */
  throwPunch(kind) {
    if (this.down) return;
    if (!this.punch) { this.combo = 0; this._startPunch(kind, null); return; }
    if (this.combo + this.queue.length >= BOXER.comboMax) return; // 5発に達したら、構えに戻るまで受け付けない
    this.queue.push(kind);
  }

  _handOf(kind) { return kind === 'jab' || kind === 'hookL' || kind === 'upperL' ? 'L' : 'R'; }

  _startPunch(kind, from) {
    this.combo = (this.combo || 0) + 1;
    const rate = this.combo > 1 ? BOXER.comboRate : 1;
    const base = BOXER.punches[kind].hook ? this._procOf(kind).dur : this.clips[kind].keyframes[this.clips[kind].keyframes.length - 1].time / BOXER.punchRate;
    // from: 切り上げた前のパンチ。少しの間、重みを下げながら重ねて、姿勢が飛ばないようにする
    this.prevPunch = from ? { ...from, fade: 0 } : null;
    this.punch = { kind, t: 0, rate, dur: base / rate, hit: false, prevGlove: null, combo: this.combo };
    if (this.combo > 1) this.press = { left: BOXER.comboStep, t: 0 }; // 打ちながら前へ詰める
    if (this.onEvent) this.onEvent('swing', kind);
  }

  /**
   * move: ワールドの移動入力 {x, z}(長さ0〜1) / bag: バッグの現在位置(THREE.Vector3)
   */
  update(dt, now, move, bag) {
    // ---- 移動: 反復横跳び(溜め → 蹴り出し → 着地 を繰り返す) ----
    const px0 = this.pos.x, pz0 = this.pos.y;
    if (this.down) { move = { x: 0, z: 0 }; this.hop = null; this.punch = null; this.queue.length = 0; }
    this._updateHop(dt, move);
    // コンビネーション中はバッグへ少しずつ詰める(すり足。下のバッグとの間隔の制限は守る)
    if (this.press) {
      const P = this.press; let step = Math.min(P.left, (P.speed || BOXER.comboStep / BOXER.comboStepTime) * dt);
      const dx = bag.x - this.pos.x, dz = bag.z - this.pos.y, dl = Math.hypot(dx, dz) || 1;
      if (this.pressMin && dl - step < this.pressMin) { step = Math.max(0, dl - this.pressMin); P.left = step; }
      this.pos.x += dx / dl * step; this.pos.y += dz / dl * step;
      P.left -= step;
      if (P.left <= 1e-4) this.press = null;
    }
    // バッグの吊り位置(原点)のまわりの範囲に収める
    const r = this.pos.length();
    if (this.avoidCenter && r < BOXER.minDist) this.pos.multiplyScalar(BOXER.minDist / Math.max(r, 1e-4)); // サンドバッグの真下には入らない
    if (r > BOXER.maxDist) this.pos.multiplyScalar(BOXER.maxDist / r);
    // リングのロープの内側に収める(ロープ際で止まる)
    this.pos.x = Math.max(-BOXER.ringHalf, Math.min(BOXER.ringHalf, this.pos.x));
    this.pos.y = Math.max(-BOXER.ringHalf, Math.min(BOXER.ringHalf, this.pos.y));
    // 揺れているバッグの今の位置にも踏み込まない(体でバッグを押してエネルギーを注ぎ込まないように)。
    // 逆にバッグが迫ってきたら、ボクサーのほうが押しのけられる
    const bx = this.pos.x - bag.x, bz = this.pos.y - bag.z, bd = Math.hypot(bx, bz);
    const keep = this.keepDist;
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

    // ---- パンチの進行(コンビネーション) ----
    if (this.prevPunch) {
      this.prevPunch.t += dt * this.prevPunch.rate;
      this.prevPunch.fade += dt;
      if (this.prevPunch.fade >= BOXER.comboFade) this.prevPunch = null;
    }
    if (this.punch) {
      const P = this.punch;
      P.t += dt * P.rate;
      const next = this.queue[0];
      if (next) {
        // 拳が伸びきったら戻りを切り上げて次へ(同じ手なら少し待つ)
        const at = BOXER.cancelAt[P.kind] + (this._handOf(next) === this._handOf(P.kind) ? BOXER.sameHandExtra : 0);
        if (P.t >= at || P.t >= P.dur * P.rate) { this.queue.shift(); this._startPunch(next, P); }
      } else if (P.t >= P.dur * P.rate) {
        this.punch = null; this.combo = 0; // 構えに戻った: コンビネーション終わり
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
    this.group.position.set(this.pos.x, 0, this.pos.y);
    this.group.rotation.y = this.yaw;
    this._dt = dt;
    this._pose(now, speed);

    // 被弾のリアクション・ダウンの進行
    if (this.react) { this.react.t += dt; if (this.react.t > 0.45) this.react = null; }
    if (this.down) this.down.t += dt;

    this.group.position.set(this.pos.x, 0, this.pos.y);
    this.group.rotation.y = this.yaw;
  }

  /** 被弾: 頭(または体)が打たれた向きへ弾かれる。part: 'head' | 'body', side: 'L'(左から)/'R'/'F'(正面) */
  takeHit(part, side, power = 1) {
    this.react = { t: 0, part, side, power: Math.min(1.4, power) };
  }

  /** ダウン(KO): 後ろへ倒れる */
  knockDown() {
    this.down = { t: 0 };
  }

  /** 手続きで作るパンチ(フック / アッパー)の動きの定義 */
  _procOf(kind) { return BOXER.punches[kind].motion === 'upper' ? UPPERCUT : HOOK; }

  /** フック・アッパーの姿勢を構えの上に重ねる。戻り値は体の前への踏み込み量 [m] */
  _hookPose(P, scale = 1) {
    const B = this.bones, side = BOXER.punches[P.kind].hook, sx = side === 'L' ? 1 : -1, H = this._procOf(P.kind), t = P.t;
    // 構えに対する重み(入り・抜け)と、振りかぶり→振り抜きの進み
    let w, k;
    if (t < H.tWind) { w = t / H.tWind; k = 0; }
    else if (t < H.tStrike) { w = 1; k = (t - H.tWind) / (H.tStrike - H.tWind); k = k * k * (3 - 2 * k); }
    else if (t < H.tHold) { w = 1; k = 1; }
    else { w = Math.max(0, 1 - (t - H.tHold) / (H.dur - H.tHold)); k = 1; }
    w = w * w * (3 - 2 * w) * scale;
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
    // アッパー: 膝の沈み → 伸び上がり、上体の前傾と打つ側への傾き
    const mix = (o) => (o.wind + (o.strike - o.wind) * k) * w;
    if (H.knee) this.procKnee += mix(H.knee);
    if (H.lean && B.Spine) B.Spine.quaternion.multiply(_qb.setFromEuler(_e.set(mix(H.lean), 0, mix(H.roll) * sx)));
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
        if (this.onEvent) this.onEvent('push');
      }
    } else if (H.phase === 'push') {
      const p = Math.min(1, H.t / BOXER.hopPush);
      const e = 1 - (1 - p) * (1 - p);                       // 蹴った瞬間がいちばん速く、着地へ向けて減速
      const dd = (e - H.done) * H.dist;
      H.done = e;
      this.pos.x += H.dirX * dd; this.pos.y += H.dirZ * dd;
      if (p >= 1) { H.phase = 'land'; H.t = 0; if (this.onEvent) this.onEvent('land'); }
    } else if (H.t >= BOXER.hopLand) {
      if (want) Object.assign(H, { phase: 'load', t: 0, loadDur: BOXER.hopChainLoad, dirX: move.x / m, dirZ: move.z / m, s: m });
      else this.hop = null;
    }
  }

  _pose(now, speed) {
    const B = this.bones;
    const idle = sampleClip(this.idle, now, true);
    for (const n in idle.pose) if (B[n]) B[n].quaternion.copy(idle.pose[n]);
    if (B.Hips) this._hipsIdleQ.copy(B.Hips.quaternion); // 足の置き場所を決める基準(パンチで腰を回しても足は動かさない)
    let y = idle.y, z = 0;
    this.procKnee = 0;
    this.reactK = 0;

    // ---- パンチ(上半身に重ねる)。コンビネーションの切り替え直後は、前のパンチを薄くしながら先に重ねる ----
    const applyPunch = (P, scale) => {
      if (BOXER.punches[P.kind].hook) { z += this._hookPose(P, scale); return; }
      const clip = this.clips[P.kind];
      const s = sampleClip(clip, P.t * BOXER.punchRate, false);
      const dur = P.dur * P.rate; // クリップ時間での長さ
      const w = Math.max(0, Math.min(1, P.t / BOXER.blendIn, (dur - P.t) / BOXER.blendOut)) * scale;
      for (const n of UPPER) if (B[n] && s.pose[n]) B[n].quaternion.slerp(s.pose[n], w);
      y += (s.y - idle.y) * w;
      z += s.z * w; // ストレートは体ごと前へ踏み込む
    };
    if (this.prevPunch) applyPunch(this.prevPunch, 1 - this.prevPunch.fade / BOXER.comboFade);
    if (this.punch) applyPunch(this.punch, 1);

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
    let knee = this.hopKnee + this.procKnee; // 跳びの溜め・着地の膝の曲げも同じ方法で(足の裏を床に付けたまま沈む)
    // ダッキング中にパンチを出すと、打つ間だけ少し伸び上がる(沈みきったままだと拳が脚の高さにしか届かない)
    let pw = 0;
    if (this.punch) { const P = this.punch, end = P.dur * P.rate; pw = Math.max(0, Math.min(1, P.t / BOXER.duckRiseIn, (end - P.t) / BOXER.duckRiseOut)); }
    if (this.prevPunch) pw = Math.max(pw, 1 - this.prevPunch.fade / BOXER.comboFade);
    this.duckEff = this.dodgeW.duck * (1 - BOXER.duckRise * pw);
    for (const k in DODGES) {
      const wd = k === 'duck' ? this.duckEff : this.dodgeW[k];
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
    // ---- 被弾のリアクション(頭・上体が打たれた向きへ弾かれ、すぐ戻る) ----
    if (this.react) {
      const R = this.react, k = Math.sin(Math.min(1, R.t / 0.07) * Math.PI / 2) * Math.exp(-Math.max(0, R.t - 0.07) * 9) * R.power;
      const head = R.part === 'head';
      const side = R.side === 'L' ? -1 : R.side === 'R' ? 1 : 0; // 左から打たれたら右へ(-Z ロール)
      if (B.Neck) B.Neck.quaternion.multiply(_qb.setFromEuler(_e.set(head ? -0.5 * k : 0.1 * k, side * 0.3 * k, side * 0.35 * k)));
      if (B.Head) B.Head.quaternion.multiply(_qb.setFromEuler(_e.set(head ? -0.3 * k : 0, side * 0.25 * k, 0)));
      if (B.Spine) B.Spine.quaternion.multiply(_qb.setFromEuler(_e.set(head ? -0.12 * k : 0.35 * k, 0, side * 0.12 * k)));
      this.reactK = k * (head ? 0.7 : 1); // 体ごと後ろへ(下半身のレイヤーで腰を引く)
    }
    this.model.position.y = y;
    this.model.position.z = z;
    // ---- ダウン: 後ろへ倒れて仰向けに ----
    if (this.down) {
      const t = Math.min(1, this.down.t / 0.7), e = t * t;
      this.model.rotation.x = -e * Math.PI / 2 * 0.97;
      this.model.position.y = y * (1 - t) + 0.12 * t;
    } else this.model.rotation.x = 0;
    this._bodyLayer(z);
    this._duckAim();
  }

  /** パンチの「乗り」の強さ 0〜1(インパクトまでに立ち上がり、少し保って、打ち終わりへ戻る) */
  _punchEnv(P) {
    const C = BODY.punch[P.kind], end = P.dur * P.rate, t = P.t;
    const ss = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    if (t < C.imp) return ss(t / C.imp);
    return 1 - ss((t - C.imp - C.hold) / Math.max(0.05, end - C.imp - C.hold));
  }

  /**
   * 下半身(全身)のレイヤー: 腰(Hips)を動かして体重移動・腰の回転を付け、脚は IK で足の裏を床に付けたまま曲げ伸ばしする。
   *  - パンチ: 打つ向きへ腰を回し、前へ体重を乗せて沈む(手打ちにしない)。踏み込みでは後ろ足を残して蹴り脚を伸ばす
   *  - 回避: スリップは避ける側の脚へ、スウェーは後ろ足へ、ダッキングは腰を引いて沈む
   *  - 被弾: 腰ごと後ろへ押される
   * stepZ: 今の体全体の踏み込み量 [m](model.position.z)
   */
  _bodyLayer(stepZ) {
    const B = this.bones, H = B.Hips;
    if (!H || this.down) return;
    if (!this._hipsBase) this._hipsBase = H.position.clone();
    H.position.copy(this._hipsBase);
    // ---- 腰の目標(モデルの座標系: +X = 本人の左、+Z = 前) ----
    let x = 0, y = 0, z = 0, yaw = 0, roll = 0, heel = 0;
    const addP = (P, s) => {
      const C = BODY.punch[P.kind]; if (!C || s <= 0) return;
      const e = this._punchEnv(P) * s;
      x += C.x * e; y += C.y * e; z += C.z * e; yaw += C.yaw * e; roll += (C.roll || 0) * e; heel += (C.heel || 0) * e;
    };
    if (this.prevPunch) addP(this.prevPunch, 1 - this.prevPunch.fade / BOXER.comboFade);
    if (this.punch) addP(this.punch, 1);
    for (const k in BODY.dodge) {
      const D = BODY.dodge[k], w = k === 'duck' ? (this.duckEff ?? this.dodgeW.duck) : this.dodgeW[k];
      if (w < 1e-3) continue;
      x += D.x * w; y += D.y * w; z += D.z * w; roll += (D.roll || 0) * w;
    }
    z -= BODY.reactZ * this.reactK; y -= 0.02 * this.reactK;
    // 踏み込みの速さ → 前足を少し浮かせて踏み出す(床を滑らせない)
    const dz = stepZ - (this._prevStepZ ?? stepZ); this._prevStepZ = stepZ;
    const liftT = Math.min(1, Math.abs(dz) / Math.max(1e-3, this._dt || 1 / 60) / BODY.liftSpeed);
    this.footLift = (this.footLift || 0) + (liftT - (this.footLift || 0)) * Math.min(1, (this._dt || 1 / 60) * 30);
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) + Math.abs(yaw) + Math.abs(roll) + Math.abs(stepZ) + this.footLift < 1e-4) return;

    // ---- 足の置き場所(腰を回す前の向きで決める。パンチの腰の回転では足は動かさない) ----
    const qFinal = _bl.q1.copy(H.quaternion);
    H.quaternion.copy(this._hipsIdleQ);
    this.group.updateMatrixWorld(true);
    const legs = BODY.legs;
    for (const L of legs) {
      const foot = B[L.foot]; if (!foot) continue;
      foot.getWorldPosition(L.target); foot.getWorldQuaternion(L.footQ);
      // 踏み込みでは後ろ足を残す(蹴り脚が伸びる)。届かない分は IK が伸ばしきりで止める
      if (L.rear && stepZ > 0) L.target.addScaledVector(_bl.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), -stepZ * BODY.rearStay);
      if (!L.rear) L.target.y += BODY.liftHeight * this.footLift;
      if (L.rear) L.target.y += BODY.heelUp * Math.min(1, heel); // 後ろ足のかかとを上げる(つま先で床を押す)
    }
    H.quaternion.copy(qFinal);
    // ---- 腰を動かす・回す(上体は回した分の一部を戻して、狙いが大きくずれないように) ----
    H.position.set(this._hipsBase.x + x, this._hipsBase.y + y, this._hipsBase.z + z);
    const qOff = _bl.q2.setFromEuler(_e.set(0, yaw, roll));
    H.quaternion.premultiply(qOff);
    if (B.Spine) {
      const back = _bl.q3.copy(qOff).invert();
      _bl.q4.identity().slerp(back, BODY.spineKeep);
      _bl.q5.copy(H.quaternion).invert().multiply(_bl.q4).multiply(H.quaternion);
      B.Spine.quaternion.premultiply(_bl.q5);
    }
    this.group.updateMatrixWorld(true);
    // ---- 脚の IK(2関節): 足を元の位置へ戻し、足の裏の向きも保つ ----
    for (const L of legs) {
      const ul = B[L.upper], ll = B[L.lower], ft = B[L.foot];
      if (!ul || !ll || !ft) continue;
      solveLegIK(ul, ll, ft, L.target);
      // 足の裏の向きは元のまま(後ろ足はかかとを上げた分だけつま先側へ倒す)
      _bl.q2.copy(L.footQ);
      if (L.rear && heel > 1e-3) _bl.q2.premultiply(_bl.q3.setFromAxisAngle(_bl.fwd.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), BODY.heelTilt * Math.min(1, heel)));
      ll.getWorldQuaternion(_bl.q1);
      ft.quaternion.copy(_bl.q1.invert().multiply(_bl.q2));
      ft.updateMatrixWorld(true);
    }
  }

  /**
   * ダッキング中のパンチは、沈んだ姿勢のままだと拳が相手の脚(ローブロー)に向かってしまう。
   * 打つ側の上腕だけを上下に回して、拳の通り道を狙いの高さ(相手のボディ)へ向け直す。
   * 拳が前へ伸びている分だけ効かせるので、構えの位置(顎の前)では腕の形は変わらない。
   */
  _duckAim() {
    const P = this.punch, dw = this.duckEff || 0;
    if (!P || this.aimY == null || dw < 0.02 || this.down) return;
    const left = this._handOf(P.kind) === 'L';
    const ua = this.bones[left ? 'LeftUpperArm' : 'RightUpperArm'], hand = this.bones[BOXER.punches[P.kind].hand];
    if (!ua || !hand || !ua.parent) return;
    this.group.updateMatrixWorld(true);
    ua.getWorldPosition(_v1);
    hand.getWorldPosition(_v2);
    const vx = _v2.x - _v1.x, vy = _v2.y - _v1.y, vz = _v2.z - _v1.z, h = Math.hypot(vx, vz);
    if (h < 1e-3) return;
    const ext = Math.max(0, Math.min(1, (h - BOXER.aimExtFrom) / (BOXER.aimExtTo - BOXER.aimExtFrom)));
    if (ext <= 0) return;
    const len = Math.hypot(h, vy);
    const cur = Math.atan2(vy, h);
    const want = Math.atan2(this.aimY - _v1.y, h);
    const delta = Math.max(-BOXER.aimMax, Math.min(BOXER.aimMax, want - cur)) * Math.min(1, dw) * ext;
    const el = cur + delta;
    _aimFrom.set(vx, vy, vz).divideScalar(len);
    _aimTo.set(vx / h * Math.cos(el), Math.sin(el), vz / h * Math.cos(el));
    _aimR.setFromUnitVectors(_aimFrom, _aimTo);
    // 新しい上腕のローカル回転 = 親のワールド回転⁻¹ · R · 親のワールド回転 · 今のローカル回転
    ua.parent.getWorldQuaternion(_aimPQ);
    _aimTmp.copy(_aimPQ).invert().multiply(_aimR).multiply(_aimPQ);
    ua.quaternion.premultiply(_aimTmp);
    ua.updateMatrixWorld(true);
  }

  /**
   * 相手の体へのパンチの当たり判定。グローブの通り道(前フレーム→今フレーム)を、相手の頭・胸・腹の球と照合する。
   * 相手が回避していれば、その分だけ頭が実際に動いているので当たらない。当たったら { part, point, dir, kind, damageMul }
   */
  checkBodyHit(dt, target) {
    const P = this.punch;
    if (!P || P.hit || !target || target.down) return null;
    const spec = BOXER.punches[P.kind];
    const hand = this.bones[spec.hand], fore = this.bones[spec.fore];
    if (!hand || !fore) return null;
    this.group.updateMatrixWorld(true);
    target.group.updateMatrixWorld(true);
    hand.getWorldPosition(this._glove);
    fore.getWorldPosition(this._fore);
    const dir = this._glove.clone().sub(this._fore).normalize();
    const glove = this._glove.clone().addScaledVector(dir, BOXER.gloveReach);
    const prev = P.prevGlove;
    P.prevGlove = glove.clone();
    if (!prev || P.t < 0.06) return null;
    const vel = glove.clone().sub(prev);
    if (vel.lengthSq() / Math.max(dt * dt, 1e-6) < 0.25) return null;
    const TB = target.bones, parts = [];
    const c = new THREE.Vector3();
    // 頭: あご(首の付け根)から頭頂までのカプセル。回避すると首ごと動くので外れる
    if (TB.Head && TB.Neck) {
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      TB.Neck.getWorldPosition(a); TB.Head.getWorldPosition(b); b.y += 0.12;
      parts.push({ part: 'head', a, b, r: 0.085 });
    }
    // 体(ボディ)は腹のまわりだけ。今のパンチ(ジャブ・ストレート・フック)は頭の高さを打つので、頭を外せば体にも当たらない
    if (TB.Spine) { TB.Spine.getWorldPosition(c); parts.push({ part: 'body', a: c.clone(), b: c.clone(), r: 0.15 }); }
    const closest = (pt, S) => { // 線分 a-b 上で pt に最も近い点
      const ab = S.b.clone().sub(S.a), l2 = ab.lengthSq();
      const t = l2 > 1e-9 ? Math.max(0, Math.min(1, pt.clone().sub(S.a).dot(ab) / l2)) : 0;
      return S.a.clone().addScaledVector(ab, t);
    };
    const n = Math.max(1, Math.ceil(prev.distanceTo(glove) / 0.02));
    for (let i = 1; i <= n; i++) {
      const pt = prev.clone().lerp(glove, i / n);
      for (const S of parts) {
        const q = closest(pt, S);
        // 体の球は腹の高さの拳だけ(頭の高さのパンチが胸の上をかすって「ボディ」にならないように)
        if (S.part === 'body' && pt.y > S.a.y + BOXER.bodyHitTop) continue;
        if (pt.distanceTo(q) <= S.r + BOXER.gloveRadius && vel.dot(q.clone().sub(pt)) > 0) {
          P.hit = true;
          return { part: S.part, point: pt, dir: vel.clone().normalize(), kind: P.kind, combo: P.combo };
        }
      }
    }
    return null;
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
    return { point, dir: d, normal, impulse: spec.impulse * (P.combo > 1 ? BOXER.comboImpulse : 1), kind: P.kind };
  }
}
