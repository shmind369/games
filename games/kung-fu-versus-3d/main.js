import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

// ============================================================
// Kung-Fu Versus 3D — 体力ゲージ制・奥行き移動ありのサイドビュー3D格闘ゲーム
//  ・プレイヤー: 中華娘(左) / CPU: USAボクサー(右)。2ラウンド先取、1ラウンド60秒
//  ・カメラは常に2人を結ぶ線の真横から映す(横移動で回り込むと、カメラも回る)
//  ・攻撃には 上段/中段/下段 がある
//      立ちガード(スティック←) … 上段・中段を防ぐ / 下段は当たる
//      しゃがみ(スティック↓長押し) … 上段をかわし、下段を防ぐ / 中段は当たる
//  ・座標: Yが上。キャラのモデルは+Zを向いている
// ============================================================

// ---------- 設定 ----------
const ROUND_TIME = 60;          // 1ラウンドの秒数
const WINS_NEEDED = 2;          // 何ラウンド先取で勝ちか
const MAX_HP = 100;
const ARENA_R = 4.6;            // 動ける範囲(円形の半径, m)
const BODY_GAP = 0.62;          // 2人の体が重ならない最小距離(m)
const WALK_F = 1.8, WALK_B = 1.25, WALK_SIDE = 1.7; // 前進 / 後退(ガードしながら) / 横移動 の速さ(m/s)
const SS_TAP_MS = 170;          // ↓をこれより短く離すと「手前への横ステップ」、長いと「しゃがみ」
const SS_DIST = 0.85, SS_MS = 260; // 横ステップの距離・時間
const VFOV = 38;

// ---------- レンダラー・シーン・カメラ ----------
const view = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VFOV, 1, 0.1, 120);
let aspect = 1;
function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false);
  aspect = w / Math.max(1, h); camera.aspect = aspect; camera.updateProjectionMatrix();
  layoutPad();
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);

// ---------- ステージ: 夕暮れの寺院の中庭(どの向きから見ても背景があるよう、ぐるりと囲む) ----------
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
scene.background = new THREE.Color(0x2a1a2e);
scene.fog = new THREE.Fog(0x3a2233, 16, 60);
// 床: 円形の石畳
const floorTex = canvasTex(1024, 1024, (ctx, w, h) => {
  ctx.fillStyle = "#6d5f55"; ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 64) for (let x = (y / 64) % 2 ? -32 : 0; x < w; x += 64) {
    const v = 90 + Math.random() * 30; ctx.fillStyle = `rgb(${v + 10},${v},${v - 8})`; ctx.fillRect(x + 2, y + 2, 60, 60);
  }
  for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 18, 0, 7); ctx.fill(); }
}, 6, 6);
const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
// 闘技場の円(動ける範囲の目印)
const ringLine = new THREE.Mesh(new THREE.RingGeometry(ARENA_R + 0.25, ARENA_R + 0.38, 96), new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.7 }));
ringLine.rotation.x = -Math.PI / 2; ringLine.position.y = 0.01; scene.add(ringLine);
const inner = new THREE.Mesh(new THREE.CircleGeometry(1.0, 48), new THREE.MeshBasicMaterial({ color: 0xc23a2a, transparent: true, opacity: 0.35 }));
inner.rotation.x = -Math.PI / 2; inner.position.y = 0.008; scene.add(inner);
// 遠景: 夕焼けの空と山並み(円筒の内側に貼る)
const skyTex = canvasTex(2048, 512, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#1c1430"); g.addColorStop(0.45, "#7a3a4a"); g.addColorStop(0.7, "#e08a50"); g.addColorStop(1, "#f0b060");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  for (const [col, base, amp] of [["#4a2a3a", 0.62, 0.16], ["#2c1a26", 0.74, 0.12]]) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 16) ctx.lineTo(x, h * (base - amp * (0.5 + 0.5 * Math.sin(x * 0.006 + base * 9) * Math.cos(x * 0.0023))));
    ctx.lineTo(w, h); ctx.fill();
  }
}, 1, 1);
skyTex.wrapT = THREE.ClampToEdgeWrapping;
const sky = new THREE.Mesh(new THREE.CylinderGeometry(50, 50, 40, 64, 1, true), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
sky.position.y = 12; scene.add(sky);
// 中庭を囲む赤い柱と灯籠(装飾。当たり判定なし)
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9a2a20, roughness: 0.6 });
const beamMat = new THREE.MeshStandardMaterial({ color: 0x3a2018, roughness: 0.8 });
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2, R = 8.5;
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.2, 14), pillarMat); p.position.set(Math.cos(a) * R, 2.1, Math.sin(a) * R); p.castShadow = true; scene.add(p);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffc070 })); lamp.position.set(Math.cos(a + 0.2) * (R - 0.4), 2.6, Math.sin(a + 0.2) * (R - 0.4)); scene.add(lamp);
}
const roofRing = new THREE.Mesh(new THREE.TorusGeometry(8.5, 0.25, 8, 64), beamMat); roofRing.rotation.x = Math.PI / 2; roofRing.position.y = 4.25; scene.add(roofRing);
// ライト
scene.add(new THREE.HemisphereLight(0xffd8b0, 0x302028, 0.9));
const keyL = new THREE.DirectionalLight(0xffe2c0, 2.3);
keyL.position.set(4, 8, 3); keyL.castShadow = true; keyL.shadow.mapSize.set(1024, 1024);
Object.assign(keyL.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 25 }); keyL.shadow.bias = -0.0005;
scene.add(keyL, keyL.target);
const rimL = new THREE.DirectionalLight(0x8090ff, 0.8); rimL.position.set(-4, 3, -5); scene.add(rimL);

// ---------- モデルとモーションの読み込み ----------
const loader = new GLTFLoader();
const J = (n) => fetch(`./assets/${n}.json`).then((r) => r.json());
const [chinaGltf, usaGltf, idleJ, stepFJ, stepSJ, jabJ, straightJ, lowKickJ, highKickJ, cpuJabJ, cpuBodyJ, cpuHookJ] = await Promise.all([
  loader.loadAsync("./assets/china_rigged.glb"), loader.loadAsync("./assets/box_usa_rigged.glb"),
  J("fightIdleUsa"), J("stepForward"), J("stepSide"), J("leftPunch1"), J("rightStraight"), J("rightLowKick"), J("rightHighKick"),
  J("cpuJab"), J("cpuBodyStraight"), J("cpuLowHook"),
]);

// ---------- クリップの再生(keyframes: time, pose{bone:[x,y,z,w]}, modelPosition) ----------
const _q = new THREE.Quaternion();
const toQ = (a) => new THREE.Quaternion(a[0], a[1], a[2], a[3]);
const clipDur = (c) => c.keyframes[c.keyframes.length - 1].time;
function sample(clip, t, loop) {
  const keys = clip.keyframes, dur = clipDur(clip);
  t = loop ? ((t % dur) + dur) % dur : Math.max(0, Math.min(dur, t));
  let i = 0; while (i < keys.length - 2 && keys[i + 1].time <= t) i++;
  const a = keys[i], b = keys[i + 1] || a, span = b.time - a.time, f = span > 0 ? (t - a.time) / span : 0;
  const pose = {};
  for (const n of Object.keys(a.pose)) pose[n] = toQ(a.pose[n]).slerp(_q.set(...b.pose[n]), f);
  const am = a.modelPosition || [0, 0, 0], bm = b.modelPosition || am;
  return { pose, mp: new THREE.Vector3(am[0] + (bm[0] - am[0]) * f, am[1] + (bm[1] - am[1]) * f, am[2] + (bm[2] - am[2]) * f) };
}
// 動きのある範囲(最後の「構えに戻って止まっている」キーは切り捨てる)
function activeEnd(clip) {
  const keys = clip.keyframes, last = keys[keys.length - 1].pose;
  const same = (p) => Object.keys(p).every((n) => last[n] && p[n].every((v, i) => Math.abs(v - last[n][i]) < 1e-3));
  let end = keys.length - 1; while (end - 1 > 0 && same(keys[end - 1].pose)) end--;
  return keys[end].time;
}

// ---------- 技の表 ----------
//  level: high/mid/low(上段/中段/下段) / dmg: ダメージ / hit: 技の長さの何割〜何割で当たる / limb: [当てる部位, 向きを決める骨, 半径]
//  kb: ノックバック(m) / stun: 当たったときの相手の硬直(ms) / cancel: ここから次の技へつなげる(割合) / speed: 再生速度
//  CPUの技: windupMs(予備動作)・tell(予備動作の姿勢)・lunge(飛び込む区間。距離は予備動作の始めに決まる)
const MOVES = {
  lp: { label: "ジャブ", clip: jabJ, end: 0.75, speed: 1.45, level: "high", dmg: 6, hit: [0.36, 0.7], limb: ["LeftHand", "LeftForearm", 0.15], kb: 0.18, stun: 380, cancel: 0.55 },
  rp: { label: "ストレート", clip: straightJ, speed: 1.2, level: "mid", dmg: 10, hit: [0.3, 0.7], limb: ["RightHand", "RightForearm", 0.16], kb: 0.32, stun: 440, cancel: 0.62 },
  lk: { label: "ローキック", clip: lowKickJ, end: 0.92, speed: 1.3, level: "low", dmg: 9, hit: [0.3, 0.62], limb: ["RightFoot", null, 0.2], kb: 0.25, stun: 460, cancel: 0.7 },
  rk: { label: "ハイキック", clip: highKickJ, speed: 1.25, level: "high", dmg: 17, hit: [0.3, 0.55], limb: ["RightFoot", null, 0.24], kb: 0.7, stun: 650, cancel: 0.8 },
  cpuHigh: { label: "飛び込みジャブ", clip: cpuJabJ, speed: 1.35, level: "high", dmg: 8, hit: [0.28, 0.7], limb: ["LeftHand", "LeftForearm", 0.15], kb: 0.35, stun: 420, windupMs: 380, lunge: [0.04, 0.42],
    tell: { y: 0.02, bones: { Spine: [-0.2, 0, 0], Head: [-0.1, 0, 0], LeftUpperArm: [-0.35, 0, 0.15], RightUpperLeg: [0.2, 0, 0] } } },
  cpuMid: { label: "ボディストレート", clip: cpuBodyJ, speed: 1.3, level: "mid", dmg: 11, hit: [0.4, 0.8], limb: ["RightHand", "RightForearm", 0.17], kb: 0.45, stun: 480, windupMs: 450, lunge: [0.0, 0.5],
    tell: { y: 0.16, bones: { Spine: [0.4, 0, 0], Chest: [0.15, 0, 0], Head: [-0.25, 0, 0], LeftUpperLeg: [-0.35, 0, 0], RightUpperLeg: [-0.35, 0, 0], LeftLowerLeg: [0.65, 0, 0], RightLowerLeg: [0.65, 0, 0], RightUpperArm: [-0.3, 0, -0.2] } } },
  cpuLow: { label: "足払いフック", clip: cpuHookJ, speed: 1.2, level: "low", dmg: 9, hit: [0.28, 0.62], limb: ["RightHand", "RightForearm", 0.3], kb: 0.35, stun: 480, windupMs: 500, lunge: [0.0, 0.45],
    tell: { y: 0.3, bones: { Spine: [0.5, 0.2, 0], Chest: [0, 0.35, 0], LeftUpperLeg: [-0.55, 0, 0], RightUpperLeg: [-0.55, 0, 0], LeftLowerLeg: [1.0, 0, 0], RightLowerLeg: [1.0, 0, 0], RightUpperArm: [-0.2, 0, 1.0] } } },
};
for (const m of Object.values(MOVES)) { m.endT = m.end ?? activeEnd(m.clip); m.durMs = (m.endT * 1000) / m.speed; }
const COMBO_MAX = 4;

// 当たる側の体(球)。しゃがむと頭・胸が下がるので、上段は自然に当たらなくなる
const HURT = [{ bone: "Head", r: 0.17 }, { bone: "Chest", r: 0.25 }, { bone: "Hips", r: 0.23 }, { bone: "LeftUpperLeg", r: 0.16 }, { bone: "RightUpperLeg", r: 0.16 }, { bone: "LeftLowerLeg", r: 0.15 }, { bone: "RightLowerLeg", r: 0.15 }];
// 被弾したときの体の反応(上段=のけぞる / 中段=くの字 / 下段=膝が崩れる)
const REACT = {
  high: { in: 60, hold: 80, out: 300, drop: 0.02, bones: { Head: [-0.75, 0, 0], Neck: [-0.5, 0, 0], Spine: [-0.35, 0, 0], Chest: [-0.2, 0, 0], LeftUpperArm: [-0.4, 0, 0.3], RightUpperArm: [-0.4, 0, -0.3] } },
  mid: { in: 60, hold: 90, out: 320, drop: 0.05, bones: { Spine: [0.55, 0, 0], Chest: [0.35, 0, 0], Head: [0.35, 0, 0], Neck: [0.2, 0, 0], Hips: [0.15, 0, 0] } },
  low: { in: 60, hold: 90, out: 340, drop: 0.16, bones: { LeftUpperLeg: [-0.5, 0, 0], RightUpperLeg: [-0.5, 0, 0], LeftLowerLeg: [0.9, 0, 0], RightLowerLeg: [0.9, 0, 0], Spine: [0.25, 0, 0], Head: [0.2, 0, 0] } },
};
// しゃがみ・ガードの姿勢(構えに重ねる回転, ラジアン)
const CROUCH = { drop: 0.3, bones: { LeftUpperLeg: [-1.05, 0, 0], RightUpperLeg: [-1.05, 0, 0], LeftLowerLeg: [1.75, 0, 0], RightLowerLeg: [1.75, 0, 0], LeftFoot: [-0.6, 0, 0], RightFoot: [-0.6, 0, 0], Spine: [0.35, 0, 0], Head: [-0.3, 0, 0] } };
const GUARD = { bones: { Spine: [-0.08, 0, 0], LeftUpperArm: [-0.35, 0, 0.1], RightUpperArm: [-0.35, 0, -0.1], LeftForearm: [-0.35, 0, 0], RightForearm: [-0.35, 0, 0], Head: [0.15, 0, 0] } };

// ---------- キャラクター ----------
function makeFighter(gltf, name) {
  const root = new THREE.Group(), tilt = new THREE.Group(), model = gltf.scene;
  root.add(tilt); tilt.add(model); scene.add(root);
  const bones = {}, mats = [];
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.emissive && !mats.includes(m)) mats.push(m); }
  });
  return { name, root, tilt, model, bones, mats, x: 0, z: 0, yaw: 0, hp: MAX_HP, wins: 0,
    act: null, stunUntil: 0, react: null, kb: 0, kbDir: [0, 0], guard: null, crouch: 0, crouchWant: 0, ss: null, flashUntil: 0, flashCol: [1, 1, 1], ko: null,
    loco: { vx: 0, vz: 0, w: 0, pf: 0, ps: 0, lastX: null, lastZ: null }, idleOfs: Math.random() * 2 };
}
const P = makeFighter(chinaGltf, "player"), C = makeFighter(usaGltf, "cpu");
P.opp = C; C.opp = P;

// ---------- 姿勢の組み立て ----------
const LEG_BONES = ["LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "RightUpperLeg", "RightLowerLeg", "RightFoot"];
const STRIDE_F = 0.8, STRIDE_S = 0.6;
const mirrorName = (n) => (n.startsWith("Left") ? "Right" + n.slice(4) : n.startsWith("Right") ? "Left" + n.slice(5) : n);
function mirrorPose(pose) { const o = {}; for (const n of Object.keys(pose)) { const q = pose[n]; o[mirrorName(n)] = new THREE.Quaternion(q.x, -q.y, -q.z, q.w); } return o; }
const _eQ = new THREE.Quaternion(), _eE = new THREE.Euler();
function overlay(pose, bonesDef, k) { // 構えなどの上に、回転を重ねる
  if (k <= 0) return;
  for (const n of Object.keys(bonesDef)) if (pose[n]) { const [x, y, z] = bonesDef[n]; pose[n].premultiply(_eQ.setFromEuler(_eE.set(x * k, y * k, z * k))); }
}
const smooth01 = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
function reactAmount(r) {
  if (!r) return 0;
  const R = REACT[r.level], e = T - r.at;
  if (e < 0 || e >= R.in + R.hold + R.out) return 0;
  if (e < R.in) return 1 - (1 - e / R.in) ** 3;
  if (e < R.in + R.hold) return 1;
  return 1 - smooth01((e - R.in - R.hold) / R.out);
}
// 1フレーム分の姿勢を決めてボーンへ書き込む
function poseFighter(f, dt) {
  const o = f.opp; let fx = o.x - f.x, fz = o.z - f.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
  // 構え(アイドル)
  const idle = sample(idleJ, T / 1000 + f.idleOfs, true);
  const pose = idle.pose, mp = idle.mp.clone();
  // フットワーク: 脚だけステップに差し替える(動いた距離に合わせて再生するので、足が滑らない)
  const L = f.loco;
  const mx = (f.x - (L.lastX ?? f.x)) / Math.max(dt, 1e-4), mz = (f.z - (L.lastZ ?? f.z)) / Math.max(dt, 1e-4); L.lastX = f.x; L.lastZ = f.z;
  L.vx += (mx - L.vx) * Math.min(1, 12 * dt); L.vz += (mz - L.vz) * Math.min(1, 12 * dt);
  const along = L.vx * fx + L.vz * fz, lat = L.vx * -fz + L.vz * fx, spd = Math.hypot(L.vx, L.vz);
  const gate = !f.act && f.crouch < 0.5 && !f.ko ? 1 : 0;
  L.w += ((gate ? Math.min(1, spd / 0.9) : 0) - L.w) * Math.min(1, 12 * dt);
  L.pf += (along / STRIDE_F) * dt; L.ps += (Math.abs(lat) / STRIDE_S) * dt;
  if (L.w > 0.01) {
    const F = sample(stepFJ, L.pf * clipDur(stepFJ), true), S = sample(stepSJ, L.ps * clipDur(stepSJ), true);
    const ws = Math.abs(lat) / (Math.abs(along) + Math.abs(lat) + 1e-4), Sp = lat < 0 ? mirrorPose(S.pose) : S.pose;
    for (const n of LEG_BONES) if (pose[n]) pose[n].slerp(F.pose[n].clone().slerp(Sp[n], ws), L.w);
    mp.y += ((F.mp.y + (S.mp.y - F.mp.y) * ws) + 0.056) * L.w;
  }
  // ガード・しゃがみ
  f.crouch += (f.crouchWant - f.crouch) * Math.min(1, 18 * dt);
  overlay(pose, CROUCH.bones, f.crouch); mp.y -= CROUCH.drop * f.crouch;
  f.guardVis = (f.guardVis || 0) + ((f.guard === "stand" ? 1 : 0) - (f.guardVis || 0)) * Math.min(1, 20 * dt);
  overlay(pose, GUARD.bones, f.guardVis);
  // 技
  const a = f.act;
  if (a) {
    const A = MOVES[a.id];
    if (a.phase === "windup") { // CPUの予備動作(技の種類が姿勢で分かる)
      const k = smooth01((T - a.t0) / (A.windupMs * 0.8));
      overlay(pose, A.tell.bones, k); mp.y -= A.tell.y * k;
    } else {
      const el = T - a.t0, c = sample(A.clip, (el * A.speed) / 1000, false);
      const bi = a.from ? 90 : 60, w = Math.max(0, Math.min(1, el / bi, (A.durMs - el) / 150));
      for (const n of Object.keys(c.pose)) if (pose[n]) {
        const base = a.from && a.from[n] ? a.from[n] : pose[n];
        pose[n] = base.clone().slerp(c.pose[n], w);
      }
      mp.lerp(c.mp, w);
      a.last = pose;
    }
  }
  // 被弾の反応
  const rk = f.ko ? 1 : reactAmount(f.react);
  if (rk > 0) { const R = REACT[f.ko ? "high" : f.react.level]; overlay(pose, R.bones, rk); mp.y -= R.drop * rk; }
  for (const n of Object.keys(pose)) { const b = f.bones[n]; if (b) b.quaternion.copy(pose[n]); }
  f.model.position.copy(mp);
  // ヒットの瞬間に光る
  const fl2 = T < f.flashUntil ? 0.4 : 0;
  for (const m of f.mats) m.emissive.setRGB(fl2 * f.flashCol[0], fl2 * f.flashCol[1], fl2 * f.flashCol[2]);
}

// ---------- 技の開始と進行 ----------
const free = (f) => !f.act && !f.ko && T >= f.stunUntil && !f.ss && round.phase === "fight";
function startMove(f, id) {
  const A = MOVES[id];
  f.act = { id, t0: T, phase: A.windupMs ? "windup" : "active", hit: false, combo: 1, queued: null, from: null, lunged: 0, lungeDist: 0, dir: [0, 0] };
  f.guard = null; f.crouchWant = 0;
  if (A.lunge) { // 飛び込みの向きと距離は、予備動作の始めに決める(予備動作を見てから動けば、かわせる)
    const ex = f.opp.x - f.x, ez = f.opp.z - f.z, d = Math.hypot(ex, ez) || 1e-6;
    f.act.dir = [ex / d, ez / d]; f.act.lungeDist = Math.max(0.3, Math.min(1.5, d - 0.6));
  }
  log.push(`${f.name}:${A.label}`);
  if (f === P) cpuReactToAttack(A);
}
function playerAttack(id) {
  if (round.phase !== "fight" || P.ko) return;
  const a = P.act;
  if (a && a.phase === "active" && !a.queued && a.combo < COMBO_MAX) { a.queued = id; return; } // 技の途中で押す = 次の技を先行入力(コンボ)
  if (free(P)) startMove(P, id);
}
function updateMove(f, dt) {
  const a = f.act; if (!a) return;
  const A = MOVES[a.id];
  if (a.phase === "windup") { if (T - a.t0 >= A.windupMs) { a.phase = "active"; a.t0 = T; } return; }
  const el = T - a.t0, frac = el / A.durMs;
  // コンボ: つなげられる時点まで来ていて、次の技が入力されていれば、戻りをとばして次の技へ
  if (a.queued && frac >= (A.cancel ?? 0.7)) {
    const prev = a, id = a.queued;
    startMove(f, id);
    f.act.combo = prev.combo + 1; f.act.from = prev.last ? Object.fromEntries(Object.entries(prev.last).map(([n, q]) => [n, q.clone()])) : null;
    return;
  }
  if (A.lunge) {
    const [l0, l1] = A.lunge, want = a.lungeDist * smooth01((frac - l0) / (l1 - l0));
    const inc = Math.max(0, Math.min(want - a.lunged, Math.hypot(f.opp.x - f.x, f.opp.z - f.z) - 0.55));
    a.lunged += inc; f.x += a.dir[0] * inc; f.z += a.dir[1] * inc;
  }
  if (el >= A.durMs) f.act = null;
}

// ---------- 当たり判定 ----------
const _w1 = new THREE.Vector3(), _w2 = new THREE.Vector3(), _w3 = new THREE.Vector3();
function checkHit(f) {
  const a = f.act, d = f.opp;
  if (!a || a.phase !== "active" || a.hit || d.ko) return;
  const A = MOVES[a.id], frac = (T - a.t0) / A.durMs;
  if (frac < A.hit[0] || frac > A.hit[1]) return;
  const [bn, fore, r] = A.limb, b = f.bones[bn]; if (!b) return;
  b.getWorldPosition(_w1);
  if (fore && f.bones[fore]) { f.bones[fore].getWorldPosition(_w2); _w1.add(_w3.copy(_w1).sub(_w2).normalize().multiplyScalar(0.1)); } // 拳は手首より少し先
  let best = null;
  for (const h of HURT) { const hb = d.bones[h.bone]; if (!hb) continue; hb.getWorldPosition(_w3); const dist = _w1.distanceTo(_w3); if (dist <= r + h.r && (!best || dist < best)) best = dist; }
  if (best === null) return;
  // しゃがんでいる相手に上段は当たらない(頭の上を通る)
  if (A.level === "high" && d.crouch > 0.5) return;
  a.hit = true;
  const ex = d.x - f.x, ez = d.z - f.z, l = Math.hypot(ex, ez) || 1;
  const blocked = (d.guard === "stand" && (A.level === "high" || A.level === "mid")) || (d.crouch > 0.5 && A.level === "low");
  if (blocked) {
    d.stunUntil = Math.max(d.stunUntil, T + 200); d.kb += A.kb * 0.6; d.kbDir = [ex / l, ez / l];
    d.flashUntil = T + 90; d.flashCol = [0.3, 0.6, 1];
    spark(_w1, 0x7ac8ff, 0.5); popText(d, "GUARD", "#9fd0ff");
    log.push(`${d.name}:guard ${A.label}`);
    return;
  }
  const counter = d.act && (d.act.phase === "windup" || d.act.phase === "active"); // 相手の技の出始めを潰した = カウンター(ダメージ1.3倍)
  const dmg = Math.round(A.dmg * (counter ? 1.3 : 1) * (a.combo > 1 ? 0.85 : 1));
  d.hp = Math.max(0, d.hp - dmg);
  d.act = null; d.ss = null; d.guard = null; d.crouchWant = 0;
  d.react = { level: A.level, at: T }; d.stunUntil = T + A.stun; d.flashUntil = T + 110; d.flashCol = [1, 1, 1];
  d.kb += A.kb * (a.combo > 1 ? 0.5 : 1); d.kbDir = [ex / l, ez / l];
  spark(_w1, counter ? 0xff5a3a : 0xffd060, counter ? 0.95 : 0.7);
  if (counter) popText(d, "COUNTER", "#ff7a5a");
  if (f === P) { comboHits = a.combo === 1 ? 1 : comboHits + 1; showCombo(); }
  log.push(`${f.name}:HIT ${A.label} ${dmg}${counter ? " counter" : ""} -> ${d.name} hp${d.hp}`);
  updateHud();
  if (d.hp <= 0) knockOut(d);
}

// ---------- エフェクト(火花・文字) ----------
const sparkTex = canvasTex(128, 128, (ctx, w, h) => {
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,.8)"); g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 5;
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14); ctx.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); ctx.stroke(); }
});
const sparks = [];
function spark(pos, color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
  s.position.copy(pos); s.scale.setScalar(size * 0.4); s.renderOrder = 10; scene.add(s); sparks.push({ s, t0: T, size });
}
function updateSparks() {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const k = (T - sparks[i].t0) / 220, s = sparks[i].s;
    if (k >= 1) { scene.remove(s); s.material.dispose(); sparks.splice(i, 1); continue; }
    s.scale.setScalar(sparks[i].size * (0.4 + k * 0.9)); s.material.opacity = 1 - k; s.material.rotation = k * 0.8;
  }
}
const popEls = [];
function popText(f, text, color) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `position:fixed;z-index:6;pointer-events:none;font:900 18px system-ui,sans-serif;letter-spacing:.08em;color:${color};text-shadow:0 2px 4px #000;transform:translate(-50%,-50%);transition:opacity .5s,margin .5s;`;
  document.body.appendChild(el); popEls.push({ el, f, t0: T });
}
function updatePops() {
  const r = renderer.domElement.getBoundingClientRect();
  for (let i = popEls.length - 1; i >= 0; i--) {
    const p = popEls[i], k = (T - p.t0) / 700;
    if (k >= 1) { p.el.remove(); popEls.splice(i, 1); continue; }
    _w1.set(p.f.x, 2.0 + k * 0.3, p.f.z).project(camera);
    p.el.style.left = r.left + ((_w1.x + 1) / 2) * r.width + "px"; p.el.style.top = r.top + ((1 - _w1.y) / 2) * r.height + "px"; p.el.style.opacity = 1 - k * k;
  }
}
let comboHits = 0;
const comboEl = document.getElementById("combo");
function showCombo() {
  if (comboHits < 2) return;
  comboEl.innerHTML = `${comboHits}<small>HIT COMBO</small>`; comboEl.style.left = "12px"; comboEl.style.opacity = 1;
  clearTimeout(showCombo.t); showCombo.t = setTimeout(() => { comboEl.style.opacity = 0; }, 1000);
}

// ---------- CPUのAI ----------
//  idle(様子見) → approach(間合いへ) → 技(予備動作 → 飛び込み) → recover(隙) → idle / retreat / sidestep
//  プレイヤーが技を出すと、一定の確率でガード(上段・中段なら立ち、下段ならしゃがみ。たまに読み違える)や横ステップでかわす
const ai = { mode: "idle", until: 800, range: 1.7, retreat: 0, auto: true, guardRate: 0.35, sideRate: 0.12 };
if (new URLSearchParams(location.search).get("ai") === "0") ai.auto = false; // ?ai=0 でCPUが何もしない(練習・確認用)
const rand = (a, b) => a + Math.random() * (b - a);
function cpuPick() { const r = Math.random(); return r < 0.4 ? "cpuHigh" : r < 0.75 ? "cpuMid" : "cpuLow"; }
function cpuReactToAttack(A) {
  if (!ai.auto || C.act || C.ko || T < C.stunUntil || C.ss) return;
  if (Math.hypot(P.x - C.x, P.z - C.z) > 2.4) return;
  const r = Math.random();
  if (r < ai.guardRate) {
    const right = Math.random() < 0.75, low = A.level === "low";
    const crouch = right ? low : !low;
    C.guardUntil = T + A.durMs + 150;
    if (crouch) { C.crouchWant = 1; C.guard = null; } else { C.guard = "stand"; C.crouchWant = 0; }
  } else if (r < ai.guardRate + ai.sideRate) startSidestep(C, Math.random() < 0.5 ? 1 : -1);
}
function moveFighter(f, dx, dz) { f.x += dx; f.z += dz; }
function updateAI(dt) {
  if (!ai.auto || round.phase !== "fight" || C.ko) { C.guard = null; C.crouchWant = 0; return; }
  if (C.guardUntil && T > C.guardUntil) { C.guard = null; C.crouchWant = 0; C.guardUntil = 0; }
  if (C.act || T < C.stunUntil || C.ss || C.guardUntil) return;
  const ex = P.x - C.x, ez = P.z - C.z, d = Math.hypot(ex, ez) || 1e-6, ux = ex / d, uz = ez / d;
  switch (ai.mode) {
    case "idle":
      if (T >= ai.until) ai.mode = d > ai.range + 0.2 ? "approach" : "attack";
      break;
    case "approach":
      moveFighter(C, ux * WALK_F * 1.05 * dt, uz * WALK_F * 1.05 * dt);
      if (d <= ai.range) ai.mode = "attack";
      break;
    case "attack":
      ai.range = rand(1.4, 1.9); startMove(C, cpuPick()); ai.mode = "recover"; ai.until = -1;
      break;
    case "recover": // 技が終わったら、少し隙を作る
      if (ai.until < 0) ai.until = T + rand(350, 750);
      else if (T >= ai.until) {
        const r = Math.random();
        if (r < 0.3) { ai.mode = "retreat"; ai.retreat = rand(0.5, 1.0); }
        else if (r < 0.45) { startSidestep(C, Math.random() < 0.5 ? 1 : -1); ai.mode = "idle"; ai.until = T + rand(200, 500); }
        else { ai.mode = "idle"; ai.until = T + rand(250, 800); }
      }
      break;
    case "retreat":
      moveFighter(C, -ux * WALK_B * dt, -uz * WALK_B * dt); ai.retreat -= WALK_B * dt; C.guard = "stand";
      if (ai.retreat <= 0) { C.guard = null; ai.mode = "idle"; ai.until = T + rand(200, 600); }
      break;
  }
}

// ---------- 横ステップ(相手の周りを回り込む) ----------
// side: +1 = 画面の奥へ / -1 = 手前へ(カメラから見て)。相手との距離を保ったまま弧を描いて動く
function startSidestep(f, side) {
  if (f.act || f.ko || T < f.stunUntil || f.ss) return;
  f.ss = { t0: T, side, done: 0 }; f.guard = null; f.crouchWant = 0;
}
function lateralDir(f) { // カメラの向き(画面の奥) = 2人の軸に垂直な向き
  return [camDir.x, camDir.z];
}
function updateSidestep(f) {
  const s = f.ss; if (!s) return;
  const u = smooth01((T - s.t0) / SS_MS), want = SS_DIST * u, step = want - s.done; s.done = want;
  const [lx, lz] = lateralDir(f);
  sideMove(f, lx * step * s.side, lz * step * s.side);
  if (u >= 1) f.ss = null;
}
// 横へ動く: 相手との距離を保つ(弧を描く)ので、回り込める
function sideMove(f, dx, dz) {
  const o = f.opp, d0 = Math.hypot(f.x - o.x, f.z - o.z);
  f.x += dx; f.z += dz;
  const d1 = Math.hypot(f.x - o.x, f.z - o.z) || 1e-6;
  f.x = o.x + ((f.x - o.x) / d1) * d0; f.z = o.z + ((f.z - o.z) / d1) * d0;
}

// ---------- 入力(バーチャルスティック + 4ボタン / キーボード) ----------
const stick = { x: 0, y: 0, id: null };
const keys = new Set();
const padEl = document.getElementById("pad"), stickZone = document.getElementById("stickZone"), stickBase = document.getElementById("stickBase"), stickKnob = document.getElementById("stickKnob");
let stickR = 50;
function layoutPad() {
  const r = stickZone.getBoundingClientRect(), S = Math.max(90, Math.min(170, r.width * 0.8, r.height * 0.8));
  stickZone.style.setProperty("--S", S + "px"); stickR = S / 2;
}
function stickUpdate(e) {
  const r = stickBase.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const L = Math.hypot(dx, dy), k = L > stickR ? stickR / L : 1;
  stickKnob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
  const m = Math.min(1, L / stickR), dead = 0.25;
  stick.x = L > 0 && m > dead ? (dx / L) * m : 0; stick.y = L > 0 && m > dead ? (dy / L) * m : 0;
}
function stickRelease() { stick.id = null; stick.x = stick.y = 0; stickKnob.style.transform = ""; }
stickZone.addEventListener("pointerdown", (e) => { if (stick.id !== null) return; stick.id = e.pointerId; try { stickZone.setPointerCapture(e.pointerId); } catch (_) {} stickUpdate(e); e.preventDefault(); });
stickZone.addEventListener("pointermove", (e) => { if (e.pointerId === stick.id) stickUpdate(e); });
for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) stickZone.addEventListener(t, (e) => { if (e.pointerId === stick.id) stickRelease(); });
for (const btn of document.querySelectorAll("#btns button")) {
  btn.addEventListener("pointerdown", (e) => { e.preventDefault(); btn.classList.add("on"); playerAttack(btn.dataset.a); });
  for (const t of ["pointerup", "pointercancel", "pointerleave"]) btn.addEventListener(t, () => btn.classList.remove("on"));
}
const KEY_ATK = { KeyU: "lp", KeyI: "rp", KeyJ: "lk", KeyK: "rk" };
window.addEventListener("keydown", (e) => { if (e.repeat) return; keys.add(e.code); if (KEY_ATK[e.code]) playerAttack(KEY_ATK[e.code]); });
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("contextmenu", (e) => e.preventDefault());
function readStick() {
  const kx = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const ky = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
  return kx || ky ? { x: kx, y: ky } : { x: stick.x, y: stick.y };
}
// ↓の短押し/長押しの判定
const down = { since: 0, held: false };
function updatePlayerControl(dt) {
  const s = readStick();
  let fx = C.x - P.x, fz = C.z - P.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
  const isDown = s.y > 0.55 && Math.abs(s.y) > Math.abs(s.x) * 0.8, isUp = s.y < -0.55 && Math.abs(s.y) > Math.abs(s.x) * 0.8;
  // ↓: 長押し = しゃがみ / 短く離す = 手前への横ステップ
  if (isDown && !down.held) { down.held = true; down.since = T; }
  if (!isDown && down.held) { down.held = false; if (T - down.since < SS_TAP_MS && free(P)) startSidestep(P, -1); }
  const canAct = free(P);
  P.crouchWant = canAct && isDown && T - down.since >= SS_TAP_MS ? 1 : 0;
  P.guard = null;
  if (!canAct || P.crouchWant) return;
  if (isUp) { // ↑: 奥へ横移動(押している間ずっと)
    const [lx, lz] = lateralDir(P);
    sideMove(P, lx * WALK_SIDE * dt, lz * WALK_SIDE * dt);
    return;
  }
  // ←→: 画面の右 = 相手の方(前進) / 左 = 後退しながら立ちガード
  if (s.x > 0.3) moveFighter(P, fx * WALK_F * Math.min(1, s.x) * dt, fz * WALK_F * Math.min(1, s.x) * dt);
  else if (s.x < -0.3) { P.guard = "stand"; moveFighter(P, -fx * WALK_B * Math.min(1, -s.x) * dt, -fz * WALK_B * Math.min(1, -s.x) * dt); }
}

// ---------- 位置の後処理(ノックバック・体の重なり・闘技場の端) ----------
function physics(dt) {
  for (const f of [P, C]) {
    if (f.kb > 1e-4) { const step = f.kb * Math.min(1, 12 * dt); f.x += f.kbDir[0] * step; f.z += f.kbDir[1] * step; f.kb -= step; }
  }
  const ex = C.x - P.x, ez = C.z - P.z, d = Math.hypot(ex, ez) || 1e-6;
  if (d < BODY_GAP && !P.ko && !C.ko) { const push = (BODY_GAP - d) / 2; P.x -= (ex / d) * push; P.z -= (ez / d) * push; C.x += (ex / d) * push; C.z += (ez / d) * push; }
  for (const f of [P, C]) { const r = Math.hypot(f.x, f.z); if (r > ARENA_R) { f.x *= ARENA_R / r; f.z *= ARENA_R / r; } }
}
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
function faceEachOther(dt, snap) {
  for (const f of [P, C]) {
    if (f.ko) continue;
    const o = f.opp; let want = Math.atan2(o.x - f.x, o.z - f.z);
    if (f.act && f.act.dir && MOVES[f.act.id].lunge) want = Math.atan2(f.act.dir[0], f.act.dir[1]); // 飛び込み中は向きを固定(横へよけられる)
    f.yaw = snap ? want : f.yaw + angleDiff(f.yaw, want) * Math.min(1, 14 * dt);
    f.root.rotation.y = f.yaw;
  }
}

// ---------- カメラ: 2人を結ぶ線の真横(プレイヤーが左に映る側)から ----------
const camDir = new THREE.Vector3(0, 0, -1); // カメラの向き(水平)。画面の奥
let camAng = Math.PI, camW = 3.5;
const camMid = new THREE.Vector3();
function updateCamera(dt, snap) {
  let ax = C.x - P.x, az = C.z - P.z; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
  // 画面の右 = プレイヤー→CPU になる向き: 視線 d = (az, 0, -ax)
  const want = Math.atan2(az, -ax);
  camAng = snap ? want : camAng + angleDiff(camAng, want) * Math.min(1, 5 * dt);
  camDir.set(Math.sin(camAng), 0, Math.cos(camAng));
  const mx = (P.x + C.x) / 2, mz = (P.z + C.z) / 2;
  if (snap) camMid.set(mx, 0, mz); else camMid.lerp(_w2.set(mx, 0, mz), Math.min(1, 6 * dt));
  const wantW = Math.max(2.7, Math.min(7, al + 1.7));
  camW = snap ? wantW : camW + (wantW - camW) * Math.min(1, 3 * dt);
  const t = Math.tan(THREE.MathUtils.degToRad(VFOV / 2)), dist = Math.max(camW / 2 / (t * aspect), 1.25 / t);
  camera.position.set(camMid.x - camDir.x * dist, 1.3, camMid.z - camDir.z * dist);
  camera.lookAt(camMid.x, 0.95, camMid.z);
}

// ---------- ラウンドの進行 ----------
const round = { n: 1, phase: "intro", t0: 0, time: ROUND_TIME, winner: null, slowUntil: 0 };
const msgText = document.getElementById("msgText"), msgSub = document.getElementById("msgSub"), retryBtn = document.getElementById("retry");
function say(text, sub = "", ms = 0) {
  msgText.textContent = text; msgSub.textContent = sub; msgText.classList.toggle("show", !!text);
  clearTimeout(say.t); if (ms) say.t = setTimeout(() => { msgText.classList.remove("show"); msgSub.textContent = ""; }, ms);
}
function resetRound() {
  for (const [f, x] of [[P, -1.1], [C, 1.1]]) {
    Object.assign(f, { x, z: 0, hp: MAX_HP, act: null, stunUntil: 0, react: null, kb: 0, guard: null, crouch: 0, crouchWant: 0, ss: null, ko: null, guardUntil: 0 });
    f.tilt.rotation.set(0, 0, 0); f.tilt.position.set(0, 0, 0); f.loco.lastX = null; f.loco.lastZ = null; f.loco.w = 0;
  }
  ai.mode = "idle"; ai.until = T + 900;
  round.phase = "intro"; round.t0 = T; round.time = ROUND_TIME; round.winner = null;
  faceEachOther(0, true); updateCamera(0, true); updateHud();
  say(`ROUND ${round.n}`, "", 0);
}
function knockOut(f) {
  if (round.phase !== "fight") return;
  f.ko = { t0: T }; f.act = null; f.guard = null; f.crouchWant = 0;
  round.phase = "ko"; round.t0 = T; round.slowUntil = T + 900; round.winner = f.opp;
  say("K.O.", "", 0); log.push(`KO ${f.name}`);
}
function timeUp() {
  round.phase = "ko"; round.t0 = T;
  round.winner = P.hp > C.hp ? P : C.hp > P.hp ? C : null;
  say("TIME UP", round.winner ? "" : "DRAW", 0);
}
function updateRound(dt) {
  const el = T - round.t0;
  if (round.phase === "intro") {
    if (el > 1100 && msgText.textContent !== "FIGHT!") say("FIGHT!", "", 700);
    if (el > 1500) { round.phase = "fight"; round.t0 = T; }
  } else if (round.phase === "fight") {
    round.time = Math.max(0, round.time - dt);
    if (round.time <= 0) timeUp();
  } else if (round.phase === "ko") {
    if (el > 1800 && !round.counted) {
      round.counted = true;
      if (round.winner) round.winner.wins++;
      updateHud();
      const w = round.winner;
      say(w ? (w === P ? "YOU WIN" : "YOU LOSE") : "DRAW", w ? `ROUND ${round.n}` : "", 0);
    }
    if (el > 3400) {
      round.counted = false;
      if (P.wins >= WINS_NEEDED || C.wins >= WINS_NEEDED || round.n >= 5) {
        round.phase = "over";
        const win = P.wins > C.wins;
        say(win ? "VICTORY!" : P.wins === C.wins ? "DRAW" : "DEFEAT", `${P.wins} - ${C.wins}`, 0);
        msgText.style.color = win ? "#ffe14a" : "#ff6a6a";
        retryBtn.style.display = "block";
      } else { round.n++; resetRound(); }
    }
  }
}
retryBtn.addEventListener("click", () => {
  retryBtn.style.display = "none"; msgText.style.color = "";
  P.wins = C.wins = 0; round.n = 1; resetRound();
});
// KOされた側: 後ろへ倒れる
function updateKO() {
  for (const f of [P, C]) {
    if (!f.ko) continue;
    const k = Math.min(1, (T - f.ko.t0) / 650);
    f.tilt.rotation.x = -(k * k) * Math.PI * 0.47;
    f.tilt.position.z = -0.35 * k; f.tilt.position.y = 0.05 * Math.sin(k * Math.PI);
  }
}

// ---------- HUD ----------
const hpP = document.getElementById("hpP"), hpC = document.getElementById("hpC"), timerEl = document.getElementById("timer");
function updateHud() {
  for (const [el, f] of [[hpP, P], [hpC, C]]) {
    const pct = (f.hp / MAX_HP) * 100 + "%";
    el.querySelector("i").style.width = pct; el.querySelector("b").style.width = pct; el.classList.toggle("low", f.hp <= 30);
  }
  for (const [id, f] of [["winsP", P], ["winsC", C]]) document.getElementById(id).innerHTML = Array.from({ length: WINS_NEEDED }, (_, i) => `<span class="${i < f.wins ? "on" : ""}"></span>`).join("");
}

// ---------- 毎フレーム ----------
let T = 0; // ゲーム内の時刻(ms)。KOのスローモーションのため、実時間とは別に進める
const log = [];
const clock = new THREE.Clock();
function step(rdt) {
  const dt = rdt * (T < round.slowUntil ? 0.3 : 1);
  T += dt * 1000;
  updateRound(dt);
  if (round.phase === "fight") { updatePlayerControl(dt); updateAI(dt); }
  else { P.guard = C.guard = null; P.crouchWant = C.crouchWant = 0; }
  for (const f of [P, C]) { updateMove(f, dt); updateSidestep(f); }
  physics(dt);
  faceEachOther(dt, false);
  updateCamera(dt, false);
  for (const f of [P, C]) { f.root.position.set(f.x, 0, f.z); poseFighter(f, dt); }
  updateKO();
  scene.updateMatrixWorld(true);
  checkHit(P); checkHit(C);
  updateSparks(); updatePops();
  const sec = Math.ceil(round.time); if (timerEl.textContent !== String(sec)) timerEl.textContent = sec;
  timerEl.classList.toggle("hurry", round.time <= 10 && round.phase === "fight");
}
function frame() {
  step(Math.min(0.05, clock.getDelta()));
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
resize();
resetRound();
document.getElementById("loading").style.display = "none";
requestAnimationFrame(frame);

// テスト・デバッグ用
window.__kf = {
  P, C, ai, round, log, MOVES, stick, camDir,
  get T() { return T; },
  attack: (id) => playerAttack(id),
  cpuMove: (id) => startMove(C, id),
  setStick: (x, y) => { stick.x = x; stick.y = y; },
  skipIntro: () => { round.phase = "fight"; round.t0 = T; say(""); },
  place: (px, pz, cx, cz) => { P.x = px; P.z = pz; C.x = cx; C.z = cz; faceEachOther(0, true); updateCamera(0, true); },
  step: (ms, n = 1) => { for (let i = 0; i < n; i++) step(ms / 1000); renderer.render(scene, camera); },
};
