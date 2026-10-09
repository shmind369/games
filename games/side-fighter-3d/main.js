import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

// ============================================================
// Side Fighter 3D — 鉄拳のようなサイドビュー視点の3D格闘ゲーム(第1段階)
//  ・左: 中華娘(プレイヤー) / 右: USAボクサー(CPU) が向かい合って立つ
//  ・スマホ縦画面。画面の左右スワイプ(ドラッグ)で横(X軸)、上下スワイプで奥(上)・手前(下)(Z軸)へ移動する
//  ・画面の左半分をタップで攻撃。タップした高さで、上段(左ジャブ)・中段(右ストレート)・下段(右ローキック)を使い分ける
//  ・まだダメージ・CPUの動きはない(CPUは構えのアイドルのみ)
// 座標: X軸が左右(右が+)。カメラは+Z側から、ステージを真横に見る。Y軸が上
// ============================================================

// ---------- 設定 ----------
const RING_HALF = 3.4;        // リング(四角い台)の一辺の半分(m)。一辺 6.8m。中心はXZの原点
const RING_OUT_MARGIN = 0.1;  // 足元(体の中心)がリングの縁からこれだけ外へ出たら「リングアウト」
const WORLD_LIM = 9;        // 場外へ落ちる前に、これ以上は遠くへ行けない(安全装置)
const BODY_GAP = 0.7;         // 2人の体が重ならない最小距離(m)
const WALK_SPEED = 1.7;       // 最大の移動速度 (m/s)
const BACK_SPEED_SCALE = 0.85; // 後ろへ下がるときは少し遅い
const SWIPE_DEADZONE_PX = 6;  // これ以下の動きは無視
const SWIPE_FULL_PX = 55;     // これだけ動かすと最大速度
const VISIBLE_WIDTH_MIN = 3.5; // 画面に映す幅(m)の最小。2人が近いときの、寄った画面
const VISIBLE_WIDTH_MAX = 10;  // 同じく最大(離れたときに、ここまで引く)
const CAM_MARGIN = 2.4;        // 2人の間隔に足す余白(m)。映す幅 = 間隔 + 余白
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
let aspectNow = 0.46, camWidth = VISIBLE_WIDTH_MIN;
// 映したい幅(m)が、縦画面でも横画面でも収まる距離にカメラを置く(2人が離れるほど、遠く・広く映す)
function placeCamera(x, width = camWidth) {
  const t = Math.tan(THREE.MathUtils.degToRad(VFOV / 2));
  camDist = Math.max(width / 2 / (t * aspectNow), 1.7 / t);
  CAM_LOOK.x = x; camera.position.set(x, 1.45, camDist); camera.lookAt(CAM_LOOK);
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
  renderer.setSize(w, h);
  camera.aspect = aspect; camera.updateProjectionMatrix();
  aspectNow = aspect; placeCamera(CAM_LOOK.x);
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
// リング(円形の台): 上面は暗い石畳。縁の外は深い闇(落ちたらリングアウト)
const topTex = canvasTex(1024, 1024, (ctx, w, h) => {
  ctx.fillStyle = "#2c2d36"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 2;
  for (let x = 0; x <= w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  for (let i = 0; i < 500; i++) { ctx.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},255,${Math.random() * 0.04})`; ctx.fillRect(Math.random() * w, Math.random() * h, 6 + Math.random() * 30, 6 + Math.random() * 30); }
}, 1, 1);
const sideMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.55, metalness: 0.4 });
const platform = new THREE.Mesh(new THREE.BoxGeometry((RING_HALF + 0.12) * 2, 0.9, (RING_HALF + 0.12) * 2), [
  sideMat, sideMat,                                                                  // +X, -X 側面
  new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.75, metalness: 0.1 }),  // 上面
  new THREE.MeshStandardMaterial({ color: 0x111116 }),                               // 底
  sideMat, sideMat,                                                                  // +Z, -Z 側面
]);
platform.position.y = -0.45; platform.receiveShadow = true; scene.add(platform);
// 縁のライン(これより外へ出るとリングアウト)と、中央の線
const rimMat = new THREE.MeshBasicMaterial({ color: 0xffc860 });
for (const [w, h, x, z] of [[RING_HALF * 2 + 0.11, 0.11, 0, -RING_HALF], [RING_HALF * 2 + 0.11, 0.11, 0, RING_HALF], [0.11, RING_HALF * 2 + 0.11, -RING_HALF, 0], [0.11, RING_HALF * 2 + 0.11, RING_HALF, 0]]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), rimMat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); scene.add(m);
}
const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(0.05, RING_HALF * 2 - 0.2), new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.55 }));
centerLine.rotation.x = -Math.PI / 2; centerLine.position.y = 0.011; scene.add(centerLine);
// 下の闇の床(落ちたあとの地面)
const pit = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshStandardMaterial({ color: 0x141a30, emissive: 0x0a1230, roughness: 1 }));
pit.rotation.x = -Math.PI / 2; pit.position.set(0, -4, 0); scene.add(pit);
// 奥の壁: 暗い赤の布と金のライン(下まで届く)
const wallTex = canvasTex(512, 512, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#1a0f18"); g.addColorStop(0.55, "#3a1520"); g.addColorStop(1, "#1d1018");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,190,80,0.18)"; ctx.lineWidth = 2;
  for (let x = 0; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.fillStyle = "rgba(255,190,80,0.35)"; ctx.fillRect(0, h * 0.78, w, 4);
}, 8, 1);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }));
wall.position.set(0, 4, -5.2); wall.receiveShadow = true; scene.add(wall);
// 柱(装飾。当たり判定なし。リングの外側)
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3b2a2a, roughness: 0.8 });
for (const x of [-4.2, 4.2, -9, 9]) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 14, 20), pillarMat); p.position.set(x, 1, -4.4); p.castShadow = true; scene.add(p);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb860 })); lamp.position.set(x, 2.6, -4.0); scene.add(lamp);
  if (Math.abs(x) < 6) { const l = new THREE.PointLight(0xffa850, 9, 7, 1.8); l.position.set(x * 0.9, 2.6, -3.4); scene.add(l); }
}
// ライト
scene.add(new THREE.HemisphereLight(0x8090c8, 0x1a1418, 0.7));
const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
key.position.set(-2.5, 6, 5); key.target.position.set(0, 0.8, 0); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -4; key.shadow.camera.right = 4; key.shadow.camera.top = 4; key.shadow.camera.bottom = -2; key.shadow.camera.near = 1; key.shadow.camera.far = 16; key.shadow.bias = -0.0005;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x6f8cff, 0.9); rim.position.set(3, 3, -4); scene.add(rim);

// ---------- キャラクターとモーション ----------
const loader = new GLTFLoader();
const [chinaGltf, usaGltf, walkJson, idleJson, jabJson, kickJson, straightJson] = await Promise.all([
  loader.loadAsync("./assets/china_rigged.glb"),
  loader.loadAsync("./assets/box_usa_rigged.glb"),
  fetch("./assets/walk.json").then((r) => r.json()),
  fetch("./assets/fightIdleUsa.json").then((r) => r.json()),
  fetch("./assets/leftPunch1.json").then((r) => r.json()),
  fetch("./assets/rightLowKick.json").then((r) => r.json()),
  fetch("./assets/rightStraight.json").then((r) => r.json()),
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
  // 画面の左側をタップした高さで使い分ける: 上(頭より上) = 上段 / キャラの体のあたり = 中段 / 足元より下 = 下段
  high: { label: "上段 Left Jab", clip: jabJson, range: activeRange(jabJson) },            // 上段: 左ジャブ(頭の高さ)
  mid: { label: "中段 Right Straight", clip: straightJson, range: activeRange(straightJson) }, // 中段: 右ストレート(胸の高さ)
  low: { label: "下段 Right Low Kick", clip: kickJson, range: activeRange(kickJson) },      // 下段: 右ローキック(足元)
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
  if (attack || match.over) return false; // 攻撃中・試合終了後は受け付けない
  attack = { kind, startAt: now }; attackLog.push(ATTACKS[kind].label); console.log("[Player] " + ATTACKS[kind].label);
  return true;
}

// ---------- 攻撃の高さ(上段・中段・下段)を決める: タップした画面の高さを、プレイヤーの体の位置と比べる ----------
//  上段: キャラの頭より上(頭の上端から体の高さの20%より上) / 下段: 足元より下(足元から体の高さの10%より上は中段) / 中段: その間(体のあたり)
const _v = new THREE.Vector3();
function playerScreenY() { // プレイヤーの頭の上端・足元の、画面上のy(CSSピクセル)
  const H = canvas.clientHeight, at = (y) => { _v.set(player.root.position.x, y, player.root.position.z).project(camera); return (1 - _v.y) / 2 * H; };
  return { head: at(1.8), feet: at(0) };
}
function zoneBounds() { const { head, feet } = playerScreenY(), h = feet - head; return { up: head - 0.2 * h, low: feet - 0.1 * h, head, feet, h }; }
function zoneForY(y) { const b = zoneBounds(); return y < b.up ? "high" : y > b.low ? "low" : "mid"; }
// 画面の左側に、3つの高さの目印(うすい線と「上段/中段/下段」)を出す。タップしたゾーンは一瞬光る
const zonesEl = document.createElement("div");
zonesEl.style.cssText = "position:fixed;left:0;top:0;width:50%;height:100%;z-index:6;pointer-events:none;";
zonesEl.innerHTML = ["up", "low"].map((k) => `<div id="zl_${k}" style="position:absolute;left:0;right:0;height:0;border-top:1px dashed rgba(255,255,255,0.28)"></div>`).join("") +
  [["high", "上段"], ["mid", "中段"], ["low", "下段"]].map(([k, t]) => `<div id="zt_${k}" style="position:absolute;left:8px;font:700 13px system-ui,sans-serif;color:#fff;opacity:0.4;text-shadow:0 1px 3px #000;transition:opacity .2s,color .2s">${t}</div>`).join("");
document.body.appendChild(zonesEl);
const zoneEls = { up: zonesEl.querySelector("#zl_up"), low: zonesEl.querySelector("#zl_low"), high: zonesEl.querySelector("#zt_high"), mid: zonesEl.querySelector("#zt_mid"), lowT: zonesEl.querySelector("#zt_low") };
function updateZoneOverlay() {
  const b = zoneBounds(), H = canvas.clientHeight;
  zoneEls.up.style.top = `${b.up}px`; zoneEls.low.style.top = `${b.low}px`;
  zoneEls.high.style.top = `${Math.max(8, b.up / 2 - 8)}px`;
  zoneEls.mid.style.top = `${(b.up + b.low) / 2 - 8}px`;
  zoneEls.lowT.style.top = `${Math.min(H - 70, (b.low + H) / 2 - 8)}px`;
}
function flashZone(z) { const el = z === "low" ? zoneEls.lowT : zoneEls[z]; el.style.opacity = 1; el.style.color = "#ffd060"; setTimeout(() => { el.style.opacity = 0.4; el.style.color = "#fff"; }, 250); }

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
  // 左半分をタップ = 攻撃。タップした高さで、上段・中段・下段を使い分ける(右半分は今のところ何もしない)
  if (isTap && e.clientX < window.innerWidth / 2) { const z = zoneForY(e.clientY); if (startAttack(z, performance.now())) flashZone(z); }
  input.id = null; input.x = input.z = 0;
};
canvas.addEventListener("pointerup", endPtr); canvas.addEventListener("pointercancel", endPtr);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => { keys.add(e.code); if (e.code === "KeyJ") startAttack("high", performance.now()); if (e.code === "KeyK") startAttack("mid", performance.now()); if (e.code === "KeyL") startAttack("low", performance.now()); }); window.addEventListener("keyup", (e) => keys.delete(e.code));
const readDir = () => {
  const kx = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const kz = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
  return kx || kz ? { x: kx, z: kz } : { x: input.x, z: input.z };
};

// ---------- 毎フレーム ----------
const state = { phase: 0, w: 0, vx: 0, vz: 0, lastX: null, lastZ: null };
const clock = new THREE.Clock();
// ---------- リングアウト ----------
const match = { over: false, loser: null, fall: null };
const resultEl = document.createElement("div");
resultEl.style.cssText = "position:fixed;inset:0;z-index:8;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(0,0,0,0.35);font-family:system-ui,sans-serif;text-align:center;";
resultEl.innerHTML = '<div id="roTitle" style="font-weight:900;font-size:44px;letter-spacing:3px;color:#fff;-webkit-text-stroke:2px #000;paint-order:stroke fill;text-shadow:0 4px 10px rgba(0,0,0,0.6)">RING OUT!</div><div id="roResult" style="font-weight:900;font-size:34px;letter-spacing:2px;-webkit-text-stroke:2px #000;paint-order:stroke fill"></div><button id="roRetry" style="margin-top:10px;font:700 18px system-ui,sans-serif;padding:10px 28px;border-radius:24px;border:none;background:#fff;color:#222">もう一度</button>';
resultEl.querySelector("#roRetry").addEventListener("click", () => location.reload());
document.body.appendChild(resultEl);
function ringOut(who, now) {
  if (match.over) return;
  const f = who === "player" ? player : cpu, r = Math.hypot(f.x, f.z) || 1;
  match.over = true; match.loser = who;
  match.fall = { who, x: f.x, z: f.z, y: 0, vx: (f.x / r) * 1.4, vz: (f.z / r) * 1.4, vy: 1.2, tx: (Math.random() - 0.5) * 3, tz: 2.5 + Math.random() };
  attack = null; input.x = input.z = 0;
  console.log("[Match] RING OUT: " + who + " loses");
  resultEl.querySelector("#roResult").textContent = who === "player" ? "YOU LOSE" : "YOU WIN!";
  resultEl.querySelector("#roResult").style.color = who === "player" ? "#ff6a6a" : "#ffe14a";
  setTimeout(() => { resultEl.style.display = "flex"; }, 1400);
}
// 毎フレーム: 場外に出たらリングアウト。負けた側は縁から外へ放り出されて落ちる(重力+回転)
function updateRingOut(dt, now) {
  if (!match.over) {
    const out = (f) => Math.max(Math.abs(f.x), Math.abs(f.z)) > RING_HALF + RING_OUT_MARGIN; // 四角の縁(いちばん外へ出ている軸で判定)
    if (out(player)) ringOut("player", now);
    else if (out(cpu)) ringOut("cpu", now);
    return;
  }
  const F = match.fall, f = F.who === "player" ? player : cpu;
  if (F.y < -6) return; // 落ちきったら止める
  F.vy -= 14 * dt; F.y += F.vy * dt; F.x += F.vx * dt; F.z += F.vz * dt;
  f.x = F.x; f.z = F.z;
  f.root.position.set(F.x, F.y, F.z);
  f.root.rotation.x += F.tx * dt; f.root.rotation.z += F.tz * dt; // 倒れながら落ちる
}
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
function update(dt, now) {
  // CPUのほうを向く(向いている方向 f)。移動の前進/後退は、この向きが基準
  let fx = cpu.x - player.x, fz = cpu.z - player.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
  // 移動(X・Z軸)。攻撃中は移動できない
  const mv = attack || match.over ? { x: 0, z: 0 } : readDir();
  const mag = Math.min(1, Math.hypot(mv.x, mv.z));
  const back = mv.x * fx + mv.z * fz < -0.3 ? BACK_SPEED_SCALE : 1; // CPUから離れる向きは、少し遅い
  const dist = mag * WALK_SPEED * back * dt, steps = Math.max(1, Math.ceil(dist / 0.05));
  const ux = mag > 0 ? mv.x / Math.hypot(mv.x, mv.z) : 0, uz = mag > 0 ? mv.z / Math.hypot(mv.x, mv.z) : 0;
  for (let i = 0; i < steps; i++) {
    player.x += (ux * dist) / steps; player.z += (uz * dist) / steps;
    // CPUに食い込まない(円どうし)。リングの外へも出られる(出たらリングアウト)が、遠くへは行きすぎない
    let dx = player.x - cpu.x, dz = player.z - cpu.z, d = Math.hypot(dx, dz) || 1e-6;
    if (d < BODY_GAP) { player.x = cpu.x + (dx / d) * BODY_GAP; player.z = cpu.z + (dz / d) * BODY_GAP; }
    const pr = Math.hypot(player.x, player.z); if (pr > WORLD_LIM) { player.x *= WORLD_LIM / pr; player.z *= WORLD_LIM / pr; }
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
  if (!match.over) { player.root.rotation.y = player.yaw; cpu.root.rotation.y = cpu.yaw; }

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
  let rx = player.x + fx * step, rz = player.z + fz * step;
  { const dx = rx - cpu.x, dz = rz - cpu.z, d = Math.hypot(dx, dz) || 1e-6; if (d < 0.55) { rx = cpu.x + (dx / d) * 0.55; rz = cpu.z + (dz / d) * 0.55; } } // 踏み込みでも、CPUに食い込まない
  player.root.position.x = rx; player.root.position.z = rz;
  // CPU: 構えのアイドルのループ
  const cpuP = sampleClip(idleJson, idleDur, now / 1000 + 0.7);
  for (const n of Object.keys(cpuP.pose)) { const b = cpu.bones[n]; if (b) b.quaternion.copy(cpuP.pose[n]); }
  cpu.root.position.set(cpu.x, cpuP.y, cpu.z);
  // リングアウト: 判定 → 負けた側が場外へ落ちる
  updateRingOut(dt, now);
  // カメラ: 2人の中間(X)を追い、2人が離れるほど自然に引く(寄る/引くはなめらかに)
  const mid = (player.x + cpu.x) / 2, sep = Math.hypot(player.x - cpu.x, (player.z - cpu.z) * 0.5);
  const wantW = Math.max(VISIBLE_WIDTH_MIN, Math.min(VISIBLE_WIDTH_MAX, sep + CAM_MARGIN));
  camWidth += (wantW - camWidth) * Math.min(1, 3.5 * dt);
  placeCamera(CAM_LOOK.x + (Math.max(-RING_HALF, Math.min(RING_HALF, mid)) - CAM_LOOK.x) * Math.min(1, 6 * dt), camWidth);
}
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  update(dt, performance.now());
  updateZoneOverlay();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
document.getElementById("loading").style.display = "none";
update(0.016, performance.now());
requestAnimationFrame(frame);

// テスト用
window.__fight = {
  zoneForY, zoneBounds,
  startAttack: (k) => startAttack(k, performance.now()), attackLog, ATTACKS,
  player, cpu, RING_HALF, BODY_GAP, camera, ringOut: (w) => ringOut(w, performance.now()),
  setDir: (x, z = 0) => { input.x = x; input.z = z; },
  teleport: (x, z = 0) => { player.x = x; player.z = z; player.root.position.x = x; player.root.position.z = z; },
  getState: () => ({ attack: attack && attack.kind, px: player.x, pz: player.z, cx: cpu.x, cz: cpu.z, vx: state.vx, vz: state.vz, w: state.w, dir: readDir(), yaw: player.yaw, camWidth, camDist, camX: CAM_LOOK.x, over: match.over, loser: match.loser, fy: match.fall ? match.fall.y : 0 }),
};
