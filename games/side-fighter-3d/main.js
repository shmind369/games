import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

// ============================================================
// Side Fighter 3D — 鉄拳のようなサイドビュー視点の3D格闘ゲーム(第1段階)
//  ・左: 中華娘(プレイヤー) / 右: USAボクサー(CPU) が向かい合って立つ
//  ・スマホ縦画面。画面の左右スワイプ(ドラッグ)で横(X軸)、上下スワイプで奥(上)・手前(下)(Z軸)へ移動する
//  ・画面のタップで攻撃: 画面の左半分をタップ=左ジャブ(踏み込み)、右半分をタップ=右ローキック
//  ・まだダメージ・CPUの動きはない(CPUは構えのアイドルのみ)
// 座標: X軸が左右(右が+)。カメラは+Z側から、ステージを真横に見る。Y軸が上
// ============================================================

// ---------- 設定 ----------
const STAGE_Z = 1.0;          // 奥行き(Z軸)の移動範囲 (-1.0〜+1.0 m。+Zが手前)
const STAGE_HALF = 2.6;       // ステージの端 (-2.6〜+2.6 m)。カメラは2人の中間を追う
const MAX_GAP = 2.4;          // 2人がこれ以上離れない(両方が画面に映るように。鉄拳と同じ)
const BODY_GAP = 0.7;         // 2人の体が重ならない最小距離(m)
const WALK_SPEED = 1.7;       // 最大の移動速度 (m/s)
const BACK_SPEED_SCALE = 0.85; // 後ろへ下がるときは少し遅い
const SWIPE_DEADZONE_PX = 6;  // これ以下の動きは無視
const SWIPE_FULL_PX = 55;     // これだけ動かすと最大速度
const VISIBLE_WIDTH = 3.5;    // 画面に映すステージの幅(m)。縦画面でもこの幅が収まる距離にカメラを置く
const VFOV = 40;
const ATTACK_SPEED = 1.3;     // 攻撃モーションの再生速度(1.0=ファイルのまま。大きいほどキビキビ)
const ATTACK_BLEND_IN_MS = 60, ATTACK_BLEND_OUT_MS = 150; // 構えとの、なじませ
const TAP_MAX_MOVE_PX = 12, TAP_MAX_MS = 320;            // これ以内の動き・時間で離したら「タップ」

// ---------- レンダラー・シーン・カメラ ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VFOV, 1, 0.1, 100);
const CAM_LOOK = new THREE.Vector3(0, 0.85, 0);
let camDist = 8;
// カメラ: 真横から。x は2人の中間を追う
function placeCamera(x) { CAM_LOOK.x = x; camera.position.set(x, 1.45, camDist); camera.lookAt(CAM_LOOK); }
function resize() {
  const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
  renderer.setSize(w, h);
  camera.aspect = aspect; camera.updateProjectionMatrix();
  // 幅 VISIBLE_WIDTH が収まる距離(縦画面では遠く、横画面では高さ3.4mが収まる距離)
  const t = Math.tan(THREE.MathUtils.degToRad(VFOV / 2));
  const dist = Math.max(VISIBLE_WIDTH / 2 / (t * aspect), 1.7 / t);
  camDist = dist; placeCamera(CAM_LOOK.x);
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- ステージ(簡易): 夜のアリーナ風。床・奥の壁・柱とライト ----------
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
scene.background = new THREE.Color(0x0b0d18);
scene.fog = new THREE.Fog(0x0b0d18, 14, 40);
// 床: 暗い石畳 + 中央の円と線(格闘ステージ風)
const floorTex = canvasTex(1024, 512, (ctx, w, h) => {
  ctx.fillStyle = "#2c2d36"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 2;
  for (let x = 0; x <= w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},255,${Math.random() * 0.04})`; ctx.fillRect(Math.random() * w, Math.random() * h, 6 + Math.random() * 30, 6 + Math.random() * 30); }
}, 10, 6);
// 中央の円と線(格闘ステージの目印)
const ringTex = canvasTex(512, 512, (ctx, w, h) => { ctx.strokeStyle = "rgba(255,200,90,0.8)"; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(w / 2, h / 2, 240, 0, 7); ctx.stroke(); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(w / 2, h / 2 - 240); ctx.lineTo(w / 2, h / 2 + 240); ctx.stroke(); });
const ring = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), new THREE.MeshBasicMaterial({ map: ringTex, transparent: true }));
ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.012, 0); scene.add(ring);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 22), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.75, metalness: 0.1 }));
floor.rotation.x = -Math.PI / 2; floor.position.z = 4.0; floor.receiveShadow = true; scene.add(floor);
// 奥の壁: 暗い赤の布と金のライン
const wallTex = canvasTex(512, 512, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#1a0f18"); g.addColorStop(0.55, "#3a1520"); g.addColorStop(1, "#1d1018");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,190,80,0.18)"; ctx.lineWidth = 2;
  for (let x = 0; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.fillStyle = "rgba(255,190,80,0.35)"; ctx.fillRect(0, h * 0.78, w, 4);
}, 6, 1);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }));
wall.position.set(0, 7, -4.2); wall.receiveShadow = true; scene.add(wall);
// 柱(装飾。当たり判定なし。ステージの外側)
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3b2a2a, roughness: 0.8 });
for (const x of [-3.6, 3.6, -8, 8]) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 8, 20), pillarMat); p.position.set(x, 4, -3.6); p.castShadow = true; scene.add(p);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb860 })); lamp.position.set(x, 2.6, -3.2); scene.add(lamp);
  if (Math.abs(x) < 5) { const l = new THREE.PointLight(0xffa850, 9, 7, 1.8); l.position.set(x * 0.9, 2.6, -2.6); scene.add(l); }
}
// ステージの端のマーク(移動できる範囲)
for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 2.2), new THREE.MeshBasicMaterial({ color: 0xffc860 })); m.position.set(sx * (STAGE_HALF + 0.35), 0.011, -0.2); scene.add(m); }
// ライト
scene.add(new THREE.HemisphereLight(0x8090c8, 0x1a1418, 0.7));
const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
key.position.set(-2.5, 6, 5); key.target.position.set(0, 0.8, 0); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -4; key.shadow.camera.right = 4; key.shadow.camera.top = 4; key.shadow.camera.bottom = -2; key.shadow.camera.near = 1; key.shadow.camera.far = 16; key.shadow.bias = -0.0005;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x6f8cff, 0.9); rim.position.set(3, 3, -4); scene.add(rim);

// ---------- キャラクターとモーション ----------
const loader = new GLTFLoader();
const [chinaGltf, usaGltf, walkJson, idleJson, jabJson, kickJson] = await Promise.all([
  loader.loadAsync("./assets/china_rigged.glb"),
  loader.loadAsync("./assets/box_usa_rigged.glb"),
  fetch("./assets/walk.json").then((r) => r.json()),
  fetch("./assets/fightIdleUsa.json").then((r) => r.json()),
  fetch("./assets/leftPunch1.json").then((r) => r.json()),
  fetch("./assets/rightLowKick.json").then((r) => r.json()),
]);
function makeFighter(gltf, facing) {
  const root = new THREE.Group(); // 位置(X)と向き(yaw)
  const model = gltf.scene; root.add(model);
  const bones = {};
  model.traverse((o) => { if (o.isBone) { bones[o.name] = o; o.quaternion.identity(); } if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const yaw = facing > 0 ? Math.PI / 2 : -Math.PI / 2; // モデルは+Zを向いている。+X(右)を向く=+90°
  root.rotation.y = yaw;
  scene.add(root);
  return { root, bones, facing, yaw, z: 0 };
}
const player = makeFighter(chinaGltf, +1); // 左で、右(CPU)を向く
const cpu = makeFighter(usaGltf, -1);      // 右で、左(プレイヤー)を向く
player.x = -0.8; cpu.x = 0.8; player.z = 0; cpu.z = 0;
player.root.position.set(player.x, 0, 0); cpu.root.position.set(cpu.x, 0, 0);

const walkDur = walkJson.keyframes[walkJson.keyframes.length - 1].time || 1, walkStride = walkJson.strideLengthPerCycle || 0.9;
const idleDur = idleJson.keyframes[idleJson.keyframes.length - 1].time || 2;
function toQ(arr) { return new THREE.Quaternion(arr[0], arr[1], arr[2], arr[3]); }
const _q = new THREE.Quaternion();
// クリップ(keyframes: time, pose{bone:[x,y,z,w]}, modelPosition)をループでサンプルする
function sampleClip(clip, dur, t) {
  const keys = clip.keyframes, tt = ((t % dur) + dur) % dur;
  let i = 0; while (i < keys.length - 2 && keys[i + 1].time <= tt) i++;
  const a = keys[i], b = keys[i + 1], span = b.time - a.time, f = span > 0 ? (tt - a.time) / span : 0;
  const pose = {};
  for (const n of Object.keys(a.pose)) pose[n] = toQ(a.pose[n]).slerp(_q.set(...b.pose[n]), f);
  const ay = (a.modelPosition || [0, 0, 0])[1], by = (b.modelPosition || [0, 0, 0])[1];
  return { pose, y: ay + (by - ay) * f };
}

// ---------- 攻撃モーション ----------
// 動きのあるキーだけを使う(最後の「構えに戻って止まっている」部分は切り捨てる)
function activeRange(clip) {
  const keys = clip.keyframes, same = (a, b) => Object.keys(a).every((n) => b[n] && a[n].every((v, i) => Math.abs(v - b[n][i]) < 1e-3));
  let end = keys.length - 1; while (end - 1 > 0 && same(keys[end - 1].pose, keys[keys.length - 1].pose)) end--;
  return { start: keys[0].time, end: keys[end].time };
}
const ATTACKS = {
  jab: { label: "Left Jab", clip: jabJson, range: activeRange(jabJson) },
  kick: { label: "Right Low Kick", clip: kickJson, range: activeRange(kickJson) },
};
for (const a of Object.values(ATTACKS)) a.durMs = ((a.range.end - a.range.start) * 1000) / ATTACK_SPEED;
// クリップを時刻t(秒, ループしない)でサンプル。modelPosition(前進・沈み込み)も返す
function sampleOnce(clip, t) {
  const keys = clip.keyframes; t = Math.max(keys[0].time, Math.min(keys[keys.length - 1].time, t));
  let i = 0; while (i < keys.length - 2 && keys[i + 1].time <= t) i++;
  const a = keys[i], b = keys[i + 1], span = b.time - a.time, f = span > 0 ? (t - a.time) / span : 0;
  const pose = {};
  for (const n of Object.keys(a.pose)) pose[n] = toQ(a.pose[n]).slerp(_q.set(...b.pose[n]), f);
  const am = a.modelPosition || [0, 0, 0], bm = b.modelPosition || [0, 0, 0];
  return { pose, mp: [0, 1, 2].map((k) => am[k] + (bm[k] - am[k]) * f) };
}
let attack = null; // { kind, startAt }
const attackLog = [];
function startAttack(kind, now) {
  if (attack) return false; // 攻撃中は受け付けない
  attack = { kind, startAt: now }; attackLog.push(ATTACKS[kind].label); console.log("[Player] " + ATTACKS[kind].label);
  return true;
}

// ---------- 入力: 画面の左右スワイプ(ドラッグ)で横移動 ----------
// 押した位置から横へ動かした量で、移動の向きと速さが決まる(離すと止まる)。縦の動きは無視
const input = { x: 0, z: 0, id: null, ox: 0, oy: 0, t0: 0, maxMove: 0 }; // x: -1(左)〜+1(右)、z: -1(奥)〜+1(手前)
const keys = new Set();
const axis = (d, dead, full) => { const a = Math.abs(d); return a < dead ? 0 : Math.sign(d) * Math.min(1, (a - dead) / (full - dead)); };
canvas.addEventListener("pointerdown", (e) => { if (input.id === null) { input.id = e.pointerId; input.ox = e.clientX; input.oy = e.clientY; input.t0 = performance.now(); input.maxMove = 0; input.x = input.z = 0; canvas.setPointerCapture(e.pointerId); document.getElementById("hint").style.opacity = 0; } });
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== input.id) return;
  const dx = e.clientX - input.ox, dy = e.clientY - input.oy;
  input.maxMove = Math.max(input.maxMove, Math.hypot(dx, dy));
  input.x = axis(dx, SWIPE_DEADZONE_PX, SWIPE_FULL_PX);
  input.z = axis(dy, SWIPE_DEADZONE_PX, SWIPE_FULL_PX); // 上へ=奥、下へ=手前
});
const endPtr = (e) => {
  if (e.pointerId !== input.id) return;
  // ほとんど動かさず、すぐ離した = タップ → 攻撃(画面の左半分=左ジャブ、右半分=右ローキック)
  const isTap = e.type === "pointerup" && input.maxMove <= TAP_MAX_MOVE_PX && performance.now() - input.t0 <= TAP_MAX_MS;
  if (isTap) startAttack(e.clientX < window.innerWidth / 2 ? "jab" : "kick", performance.now());
  input.id = null; input.x = input.z = 0;
};
canvas.addEventListener("pointerup", endPtr); canvas.addEventListener("pointercancel", endPtr);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => { keys.add(e.code); if (e.code === "KeyJ") startAttack("jab", performance.now()); if (e.code === "KeyK") startAttack("kick", performance.now()); }); window.addEventListener("keyup", (e) => keys.delete(e.code));
const readDir = () => {
  const kx = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const kz = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
  return kx || kz ? { x: kx, z: kz } : { x: input.x, z: input.z };
};

// ---------- 毎フレーム ----------
const state = { phase: 0, w: 0, vx: 0, vz: 0, lastX: null, lastZ: null };
const clock = new THREE.Clock();
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
function update(dt, now) {
  // CPUのほうを向く(向いている方向 f)。移動の前進/後退は、この向きが基準
  let fx = cpu.x - player.x, fz = cpu.z - player.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
  // 移動(X・Z軸)。攻撃中は移動できない
  const mv = attack ? { x: 0, z: 0 } : readDir();
  const mag = Math.min(1, Math.hypot(mv.x, mv.z));
  const back = mv.x * fx + mv.z * fz < -0.3 ? BACK_SPEED_SCALE : 1; // CPUから離れる向きは、少し遅い
  const dist = mag * WALK_SPEED * back * dt, steps = Math.max(1, Math.ceil(dist / 0.05));
  const ux = mag > 0 ? mv.x / Math.hypot(mv.x, mv.z) : 0, uz = mag > 0 ? mv.z / Math.hypot(mv.x, mv.z) : 0;
  for (let i = 0; i < steps; i++) {
    player.x += (ux * dist) / steps; player.z += (uz * dist) / steps;
    player.x = Math.max(-STAGE_HALF, Math.min(STAGE_HALF, player.x)); player.z = Math.max(-STAGE_Z, Math.min(STAGE_Z, player.z));
    // CPUに食い込まない(円どうし) / 離れすぎない(画面から出ない)
    let dx = player.x - cpu.x, dz = player.z - cpu.z, d = Math.hypot(dx, dz) || 1e-6;
    if (d < BODY_GAP) { player.x = cpu.x + (dx / d) * BODY_GAP; player.z = cpu.z + (dz / d) * BODY_GAP; }
    else if (d > MAX_GAP) { player.x = cpu.x + (dx / d) * MAX_GAP; player.z = cpu.z + (dz / d) * MAX_GAP; }
    player.z = Math.max(-STAGE_Z, Math.min(STAGE_Z, player.z));
  }
  // 実際に動けた速さ(壁・CPUに当たって止まっているときは歩きアニメも止める)
  const mx = (player.x - (state.lastX ?? player.x)) / Math.max(dt, 1e-4), mz = (player.z - (state.lastZ ?? player.z)) / Math.max(dt, 1e-4);
  state.lastX = player.x; state.lastZ = player.z;
  state.vx += (mx - state.vx) * Math.min(1, 14 * dt); state.vz += (mz - state.vz) * Math.min(1, 14 * dt);
  const along = state.vx * fx + state.vz * fz, lateral = Math.abs(state.vx * fz - state.vz * fx), spd = Math.hypot(state.vx, state.vz);
  const walkAmt = Math.min(1, spd / (WALK_SPEED * 0.6));
  state.w += (walkAmt - state.w) * Math.min(1, 12 * dt);
  // 歩きの再生: CPUへ近づく=順再生、離れる=逆再生、横(奥・手前)へのステップは順再生。足が滑らない速さ
  state.phase += ((Math.abs(along) >= lateral ? along : lateral) / walkStride) * dt;
  // 体の向き: お互いを向く(なめらかに)
  player.yaw += angleDiff(player.yaw, Math.atan2(fx, fz)) * Math.min(1, 12 * dt);
  cpu.yaw += angleDiff(cpu.yaw, Math.atan2(-fx, -fz)) * Math.min(1, 12 * dt);
  player.root.rotation.y = player.yaw; cpu.root.rotation.y = cpu.yaw;

  // プレイヤーのポーズ: 構え(アイドル) ⇔ 歩き
  const idleP = sampleClip(idleJson, idleDur, now / 1000), walkP = sampleClip(walkJson, walkDur, state.phase * walkDur);
  for (const n of Object.keys(idleP.pose)) {
    const b = player.bones[n]; if (!b) continue;
    b.quaternion.copy(idleP.pose[n]).slerp(walkP.pose[n] || idleP.pose[n], state.w);
  }
  player.root.position.y = idleP.y + ((walkP.y - idleP.y) * state.w);
  // 攻撃: 構えの上にクリップを重ねる(頭と終わりでなじませる)。踏み込み(modelPosition)は、向いている方向へ
  let step = 0;
  if (attack) {
    const A = ATTACKS[attack.kind], el = now - attack.startAt;
    if (el >= A.durMs) { attack = null; }
    else {
      const w = Math.max(0, Math.min(1, Math.min(el / ATTACK_BLEND_IN_MS, (A.durMs - el) / ATTACK_BLEND_OUT_MS)));
      const c = sampleOnce(A.clip, A.range.start + (el * ATTACK_SPEED) / 1000);
      for (const n of Object.keys(c.pose)) { const b = player.bones[n]; if (b) b.quaternion.copy(idleP.pose[n] || c.pose[n]).slerp(c.pose[n], w); }
      step = c.mp[2] * w; // モデルの前方(+Z) = CPUのいる方向
      player.root.position.y = idleP.y + (c.mp[1] - idleP.y) * w;
    }
  }
  let rx = Math.max(-STAGE_HALF, Math.min(STAGE_HALF, player.x + fx * step)), rz = Math.max(-STAGE_Z, Math.min(STAGE_Z, player.z + fz * step));
  { const dx = rx - cpu.x, dz = rz - cpu.z, d = Math.hypot(dx, dz) || 1e-6; if (d < 0.55) { rx = cpu.x + (dx / d) * 0.55; rz = cpu.z + (dz / d) * 0.55; } } // 踏み込みでも、CPUに食い込まない
  player.root.position.x = rx; player.root.position.z = rz;
  // CPU: 構えのアイドルのループ
  const cpuP = sampleClip(idleJson, idleDur, now / 1000 + 0.7);
  for (const n of Object.keys(cpuP.pose)) { const b = cpu.bones[n]; if (b) b.quaternion.copy(cpuP.pose[n]); }
  cpu.root.position.set(cpu.x, cpuP.y, cpu.z);
  // カメラは2人の中間(X)を、なめらかに追う(ステージの外側は映さない)
  const mid = (player.x + cpu.x) / 2, lim = STAGE_HALF - 0.4;
  placeCamera(CAM_LOOK.x + (Math.max(-lim, Math.min(lim, mid)) - CAM_LOOK.x) * Math.min(1, 6 * dt));
}
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  update(dt, performance.now());
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
document.getElementById("loading").style.display = "none";
update(0.016, performance.now());
requestAnimationFrame(frame);

// テスト用
window.__fight = {
  startAttack: (k) => startAttack(k, performance.now()), attackLog, ATTACKS,
  player, cpu, STAGE_HALF, BODY_GAP, MAX_GAP, camera,
  setDir: (x, z = 0) => { input.x = x; input.z = z; },
  teleport: (x, z = 0) => { player.x = x; player.z = z; player.root.position.x = x; player.root.position.z = z; },
  getState: () => ({ attack: attack && attack.kind, px: player.x, pz: player.z, cx: cpu.x, cz: cpu.z, vx: state.vx, vz: state.vz, w: state.w, dir: readDir(), yaw: player.yaw }),
};
