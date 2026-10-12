import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

// 肩越しカメラ(リベレーションズ風)のスマホ縦画面プロトタイプ。中華娘モデル(china_rigged.glb)を使う。
// 操作: 画面下センターのスティック = 移動 / スティックの中央をタップ = 照準の切替 / 中央を長押し(押しっぱなし)しながら倒す = 照準をグリグリ動かす / 右側スワイプ = カメラ / 右下 = 攻撃・回避
// 調整: 右上の ⚙ で、カメラの距離・高さ・下向き角・肩のオフセット・FOV・スワイプ感度・追従の速さを実機でその場で変えられる(値は保存される)

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const RAD = Math.PI / 180;

// ---------- 読み込み失敗は、原因を画面に出す ----------
function showLoadError(what, err) {
  console.error(what, err);
  const el = $("loading"); el.classList.add("err");
  el.innerHTML = `<div>読み込みに失敗しました</div><pre>${what}\n${String((err && (err.stack || err.message)) || err)}</pre><button onclick="location.reload()">再読み込み</button>`;
}

// ---------- 調整できる値(カメラ) ----------
//  dist = カメラの後ろへの距離(m) / elev = 自機の頭(ピボット)から見たカメラの仰角(度。高さ = ピボット + dist×sin) / pitchBias = 視線の下向き角を elev よりさらに下へ傾ける量(度)
//  → 下向き角(視線) = elev + pitchBias / shoulder = 右肩のほうへずらす量(m) / fov = 画角 / swipeX・swipeY = スワイプ感度 / follow = 移動中にカメラが自機の向きへ追従する速さ
//  aim* = 照準中の値(距離を縮め、肩寄りにして、画角をしぼる)
const DEFAULTS = { dist: 2.4, elev: 9, pitchBias: 7, shoulder: 0.30, fov: 62, swipeX: 0.0055, swipeY: 0.2, follow: 6, aimDist: 1.8, aimShoulder: 0.34, aimFov: 52 };
const SLIDERS = [
  ["dist", "カメラ距離 (m)", 1.2, 4.0, 0.05], ["elev", "カメラの仰角 → 高さ (度)", -5, 40, 0.5], ["pitchBias", "視線の下向き 上乗せ (度)", -5, 15, 0.5],
  ["shoulder", "右肩オフセット (m)", 0, 1.0, 0.05], ["fov", "画角 FOV (度)", 35, 75, 1], ["swipeX", "スワイプ感度 横", 0.002, 0.012, 0.0005],
  ["swipeY", "スワイプ感度 縦 (度/px)", 0.08, 0.5, 0.01], ["follow", "カメラが自機の背中へ回り込む速さ", 0, 12, 0.5], ["aimDist", "照準時の距離 (m)", 0.8, 3, 0.05], ["aimShoulder", "照準時の肩 (m)", 0, 1.0, 0.05], ["aimFov", "照準時のFOV", 30, 70, 1],
];
const S = { ...DEFAULTS };
try { Object.assign(S, JSON.parse(localStorage.getItem("shouldercam-v1") || "{}")); } catch (_) {}
const saveSettings = () => { try { localStorage.setItem("shouldercam-v1", JSON.stringify(S)); } catch (_) {} };

// ---------- レンダラー・シーン ----------
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090c); scene.fog = new THREE.FogExp2(0x07090c, 0.034);
const camera = new THREE.PerspectiveCamera(S.fov, 1, 0.08, 120);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize); if (window.visualViewport) window.visualViewport.addEventListener("resize", resize); resize();

// ---------- テストステージ: 薄暗い倉庫 + 狭い通路 ----------
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const rnd = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
const floorTex = canvasTex(512, 512, (g, w, h) => { // コンクリートのタイル(2m角)。足元と進行方向がわかるよう、目地と黄色の線を入れる
  g.fillStyle = "#3a3d42"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { const v = 40 + rnd() * 40; g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 6, 2 + rnd() * 6); }
  g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 4; g.strokeRect(0, 0, w, h);
  g.strokeStyle = "rgba(255,200,60,.22)"; g.lineWidth = 3; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
}, 15, 15);
const wallTex = canvasTex(512, 256, (g, w, h) => { // 錆びた金属パネル
  g.fillStyle = "#4a4640"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1600; i++) { const v = 55 + rnd() * 45; g.fillStyle = `rgba(${v + 14},${v},${v - 12},0.3)`; g.fillRect(rnd() * w, rnd() * h, 3 + rnd() * 18, 2 + rnd() * 4); }
  g.strokeStyle = "rgba(0,0,0,.6)"; g.lineWidth = 3; for (let x = 0; x <= w; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } g.beginPath(); g.moveTo(0, h * 0.5); g.lineTo(w, h * 0.5); g.stroke();
  g.fillStyle = "rgba(255,190,60,.55)"; g.fillRect(0, h - 28, w, 10);
}, 1, 1);
const crateTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#6b4c2a"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { const v = 70 + rnd() * 50; g.fillStyle = `rgba(${v + 30},${v},${v - 30},0.25)`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 20, 1 + rnd() * 3); }
  g.strokeStyle = "#2c1d0e"; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10); g.beginPath(); g.moveTo(5, 5); g.lineTo(w - 5, h - 5); g.moveTo(w - 5, 5); g.lineTo(5, h - 5); g.stroke();
});
const FLOOR_SIZE = 32, WALL_H = 3.4;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE), new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 1 }));
ceil.rotation.x = Math.PI / 2; ceil.position.y = WALL_H; scene.add(ceil);
const boxes = []; // 当たり判定(カメラ・自機): { x0, x1, z0, z1, h, solid }
function addBox(cx, cz, w, d, h, mat, collide = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(cx, h / 2, cz); scene.add(m);
  boxes.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, h, collide });
  return m;
}
const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, metalness: 0.2 });
const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.9 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x5c6670, roughness: 0.5, metalness: 0.6 });
const barrelMat = new THREE.MeshStandardMaterial({ color: 0x7a2a22, roughness: 0.6, metalness: 0.4 });
function wall(cx, cz, w, d) { const m = addBox(cx, cz, w, d, WALL_H, wallMat); const big = Math.max(w, d); m.geometry.dispose(); m.geometry = new THREE.BoxGeometry(w, WALL_H, d); // 壁のテクスチャを、長さに合わせて繰り返す
  const t = wallTex.clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, big / 4), 1); m.material = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0.2 }); }
// 外壁
wall(0, -16, 32, 0.5); wall(0, 16, 32, 0.5); wall(-16, 0, 0.5, 32); wall(16, 0, 0.5, 32);
// 狭い通路(幅1.4m・東側): 南の入口 → 北へ → 東の部屋へ折れる
wall(7.6, -3, 0.4, 26); wall(9.4, 1.5, 0.4, 17); wall(12.5, -9.8, 6, 0.4); wall(12.5, -6, 6, 0.4);
// 倉庫の棚(長い箱)と柱
for (const z of [-9, -4, 1]) { addBox(-8, z, 9, 0.8, 2.4, metalMat); }
for (const [x, z] of [[-14, -12], [-3, -13], [2, 4], [-4, 9], [4, -6]]) addBox(x, z, 0.7, 0.7, WALL_H, metalMat);
// 木箱の山
for (const [x, z, s] of [[-2, -1, 1.2], [-2.1, 0.2, 1.2], [-1.9, -1.1, 1.0], [3, 10, 1.4], [-12, 8, 1.2], [-12, 9.3, 1.2], [-10.8, 8.4, 1.0], [4.5, -3, 1.1], [-5, 12.5, 1.0]]) addBox(x, z, s, s, s * 0.95, crateMat);
// ドラム缶
for (const [x, z] of [[1.5, 12.5], [2.4, 12.8], [-14, 3], [-13.2, 3.4], [14, 12], [13, 13.2]]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.95, 14), barrelMat); m.position.set(x, 0.475, z); scene.add(m); boxes.push({ x0: x - 0.34, x1: x + 0.34, z0: z - 0.34, z1: z + 0.34, h: 0.95, collide: true }); }
// 照明: 暗めの全体 + 暖色のランプ
scene.add(new THREE.HemisphereLight(0x8aa0b8, 0x1a1c20, 0.7));
for (const [x, z, c] of [[0, 10, 0xffb060], [-8, -6, 0xffa850], [-8, 4, 0xffb866], [12.5, -8, 0xff9a4a], [8.5, 8, 0xffb060], [0, -10, 0x9fc4ff]]) {
  const l = new THREE.PointLight(c, 16, 13, 1.6); l.position.set(x, 2.8, z); scene.add(l);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: c })); bulb.position.copy(l.position); scene.add(bulb);
}

// ---------- 中華娘モデル(GLB)とモーション ----------
let character = null, model = null; const bones = {};
let walkJson = null, IDLE = null, IDLE_Y = 0, walkDur = 1, walkStride = 0.9;
const toQ = (pose) => { const o = {}; for (const n of Object.keys(pose)) o[n] = new THREE.Quaternion(...pose[n]); return o; };
async function loadAll() {
  let buf, wj;
  try {
    const [r1, r2] = await Promise.all([fetch("./assets/china_rigged.glb"), fetch("./assets/walk.json")]);
    if (!r1.ok) throw new Error(`china_rigged.glb: HTTP ${r1.status}`); if (!r2.ok) throw new Error(`walk.json: HTTP ${r2.status}`);
    buf = await r1.arrayBuffer(); wj = await r2.json();
  } catch (e) { showLoadError("ファイルの取得に失敗 (assets/china_rigged.glb, assets/walk.json)", e); throw e; }
  let gltf;
  try { gltf = await new GLTFLoader().parseAsync(buf, "./assets/"); } catch (e) { showLoadError("中華娘モデル(GLB)の解析に失敗", e); throw e; }
  model = gltf.scene; character = new THREE.Group(); character.add(model); scene.add(character);
  model.traverse((o) => { if (o.isBone) bones[o.name] = o; if (o.isMesh) { o.frustumCulled = false; } });
  const need = ["Hips", "Spine", "Head", "LeftUpperArm", "RightUpperArm", "LeftUpperLeg", "RightUpperLeg"];
  const miss = need.filter((n) => !bones[n]); if (miss.length) { const e = new Error("必要なボーンが見つかりません: " + miss.join(", ")); showLoadError("リグの確認に失敗", e); throw e; }
  walkJson = wj; walkDur = wj.keyframes[wj.keyframes.length - 1].time || 1; walkStride = wj.strideLengthPerCycle || 0.9;
  const pass = wj.keyframes.find((k) => k.frame === 7) || wj.keyframes[0]; IDLE = toQ(pass.pose); IDLE_Y = (pass.modelPosition || [0, 0, 0])[1];
}
await loadAll();
const _qa = new THREE.Quaternion();
function sampleWalk(t) {
  const keys = walkJson.keyframes, tt = ((t % walkDur) + walkDur) % walkDur; let i = 0; while (i < keys.length - 2 && keys[i + 1].time <= tt) i++;
  const a = keys[i], b = keys[i + 1], span = b.time - a.time, f = span > 0 ? (tt - a.time) / span : 0, pose = {};
  for (const n of Object.keys(a.pose)) pose[n] = new THREE.Quaternion(...a.pose[n]).slerp(_qa.set(...b.pose[n]), f);
  const ay = (a.modelPosition || [0, 0, 0])[1], by = (b.modelPosition || [0, 0, 0])[1]; return { pose, y: ay + (by - ay) * f };
}
// 構え(照準)の腕の形: 右腕を前へまっすぐ伸ばし、左手を添える(角度は度。XYZオイラー)
const AIM_EULER = { RightUpperArm: [-84, 8, -6], RightForearm: [-8, 0, 0], LeftUpperArm: [-70, -20, 22], LeftForearm: [-62, 0, 0], Spine: [0, -10, 0], Chest: [0, -8, 0], Neck: [0, 12, 0] };
const AIM_Q = {}; { const e = new THREE.Euler(); for (const [n, d] of Object.entries(AIM_EULER)) AIM_Q[n] = new THREE.Quaternion().setFromEuler(e.set(d[0] * RAD, d[1] * RAD, d[2] * RAD)); }
const _lq = new THREE.Quaternion(), _le = new THREE.Euler();
function poseCharacter(cycles, amp, aimW, lean, crouch, kick, twist = 0) {
  const w = sampleWalk(cycles * walkDur);
  for (const n of Object.keys(w.pose)) {
    const b = bones[n]; if (!b) continue;
    b.quaternion.copy(IDLE[n] || w.pose[n]).slerp(w.pose[n], amp);
    if (aimW > 0 && AIM_Q[n]) b.quaternion.slerp(AIM_Q[n], aimW);
  }
  if (twist !== 0) { // クイックターン: 上半身と頭が、向く先へ先に回る(体はあとから追いつく)
    const tw = clamp(twist, -1.4, 1.4);
    if (bones.Spine) bones.Spine.quaternion.premultiply(_lq.setFromEuler(_le.set(0, tw * 0.3, 0)));
    if (bones.Chest) bones.Chest.quaternion.premultiply(_lq.setFromEuler(_le.set(0, tw * 0.25, 0)));
    if (bones.Head) bones.Head.quaternion.premultiply(_lq.setFromEuler(_le.set(0, tw * 0.3, 0)));
  }
  if (lean !== 0 || kick !== 0) { // 走るときの前傾 / 射撃の反動
    if (bones.Spine) bones.Spine.quaternion.premultiply(_lq.setFromEuler(_le.set(lean * 0.6, 0, 0)));
    if (bones.Chest) bones.Chest.quaternion.premultiply(_lq.setFromEuler(_le.set(lean * 0.4 - kick * 0.12, 0, 0)));
    if (kick > 0 && bones.RightUpperArm) bones.RightUpperArm.quaternion.premultiply(_lq.setFromEuler(_le.set(kick * 0.18, 0, 0)));
  }
  model.position.y = IDLE_Y + (w.y - IDLE_Y) * amp - crouch;
}
// 足元の丸い影(目印)
const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
blob.rotation.x = -Math.PI / 2; blob.position.y = 0.012; scene.add(blob);

// ---------- 状態 ----------
const player = { x: 0, z: 12, r: 0.32 };
let heading = Math.PI; // 自機の向き(前 = (sin h, cos h))。最初は北(-Z)を向く
let yaw = Math.PI, pitchElev = S.elev; // カメラの向き(狙いの yaw)と、仰角(スワイプで変える)
let yawView = yaw;                     // 実際に画面に使う yaw(スワイプのガタつきをならす)
let aim = false, aimT = 0, aimPressAt = 0;
let speed = 0, cycles = 0, ampE = 0, leanE = 0, lastSwipeAt = -1e9;
const input = { mx: 0, my: 0, mag: 0 }; // スティック(mx: 右+、my: 下+)
const keys = new Set();
let prevMoveMag = 0, quickTurnUntil = 0, turnRemain = 0;
let ctrlYaw = yaw; // スティックの「上」の基準になる向き。スティックを倒している間は、押しはじめの向きで固定(カメラが自機の向きへ回っても、同じ方向へ歩き続ける)。離している間・構え中は、カメラの向きに同期
const QUICK_TURN_MS = 220, QUICK_TURN_RATE = 46, TURN_RATE = 20; // クイックターン: 倒しはじめの時間(ms) / その間の旋回の速さ(大きいほど一瞬) / ふだんの旋回の速さ
let dodge = null, dodgeReadyAt = 0, kickT = 0, fireReadyAt = 0, camT = 1, recoil = 0;
const WALK_MAX = 2.0, RUN_MAX = 4.2, AIM_SPEED = 1.5, DODGE_DIST = 3.0, DODGE_MS = 380;

// ---------- 当たり判定 ----------
function resolveCircle(p) {
  for (let it = 0; it < 3; it++) {
    let hit = false;
    for (const b of boxes) {
      if (!b.collide) continue;
      const nx = clamp(p.x, b.x0, b.x1), nz = clamp(p.z, b.z0, b.z1); let dx = p.x - nx, dz = p.z - nz; const d = Math.hypot(dx, dz);
      if (d < p.r) { if (d < 1e-6) { const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2; if (Math.abs(p.x - cx) / (b.x1 - b.x0) > Math.abs(p.z - cz) / (b.z1 - b.z0)) p.x += (p.x > cx ? 1 : -1) * p.r; else p.z += (p.z > cz ? 1 : -1) * p.r; } else { const push = p.r - d; p.x += (dx / d) * push; p.z += (dz / d) * push; } hit = true; }
    }
    if (!hit) break;
  }
}
// 線分(orig → orig+dir×maxT)と箱(縦はy 0〜h、横は margin だけふくらませる)の最初の交点までの距離(なければ maxT)
function rayBoxes(ox, oy, oz, dx, dy, dz, maxT, margin) {
  let best = maxT;
  for (const b of boxes) {
    let t0 = 0, t1 = best; const mn = [b.x0 - margin, -margin, b.z0 - margin], mx = [b.x1 + margin, b.h + margin * 0.3, b.z1 + margin], o = [ox, oy, oz], d = [dx, dy, dz];
    let ok = true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) { ok = false; break; } }
      else { let a = (mn[i] - o[i]) / d[i], c = (mx[i] - o[i]) / d[i]; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) { ok = false; break; } }
    }
    if (ok && t0 < best) best = t0;
  }
  return best;
}

// ---------- 入力 ----------
// 左下スティック(固定)。タッチ・マウスどちらも pointer events
//  ・倒す(すぐに中央から出る) = 移動
//  ・中央をタップ(押してすぐ離す・倒さない) = 照準のオン/オフ
//  ・中央を長押し(AIM_PRESS_MS以上、倒さずに押さえる) → 照準オン → そのまま倒す = 照準をグリグリ動かす(スティックの向きへ、倒した量に比例して視点が動く。移動はしない)。離すと照準は入ったまま
const stickEl = $("stick"), nubEl = $("nub"); let stickId = null; const SR = 52;
const AIM_PRESS_MS = 250, STICK_CENTER_PX = 14, AIM_YAW_RATE = 2.6, AIM_PITCH_RATE = 70; // 中央とみなす半径(px) / 照準操作の最大速さ(ラジアン/秒, 度/秒)
const stk = { mode: "none", t0: 0, timer: 0 }; // mode: none | pending(中央を押さえている) | move | press(長押し済み) | aimadjust
const aimIn = { x: 0, y: 0 };
function stickMove(e) {
  const r = stickEl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = e.clientX - cx, dy = e.clientY - cy; const L = Math.hypot(dx, dy), k = L > SR ? SR / L : 1;
  nubEl.style.transform = `translate(${dx * k}px,${dy * k}px)`;
  const vx = (dx * k) / SR, vy = (dy * k) / SR, mag = Math.min(1, L / SR);
  if (stk.mode === "pending" && L > STICK_CENTER_PX) { stk.mode = "move"; clearTimeout(stk.timer); } // 長押し前に倒した = 普通の移動
  if (stk.mode === "press" && L > STICK_CENTER_PX) { stk.mode = "aimadjust"; stickEl.classList.add("press"); }
  if (stk.mode === "aimadjust") {
    if (L <= STICK_CENTER_PX * 0.6) { aimIn.x = aimIn.y = 0; } else { aimIn.x = vx; aimIn.y = vy; }
    input.mx = input.my = input.mag = 0; stickEl.classList.remove("run"); return;
  }
  if (stk.mode === "move") { input.mx = vx; input.my = vy; input.mag = mag; stickEl.classList.toggle("run", mag >= 0.9); }
}
stickEl.addEventListener("pointerdown", (e) => {
  if (stickId !== null) return; stickId = e.pointerId; try { stickEl.setPointerCapture(e.pointerId); } catch (_) {}
  $("msg").style.opacity = 0; e.preventDefault();
  stk.mode = "pending"; stk.t0 = performance.now(); aimIn.x = aimIn.y = 0;
  stk.timer = setTimeout(() => { if (stk.mode === "pending") { stk.mode = "press"; setAim(true); stickEl.classList.add("press"); if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} } } }, AIM_PRESS_MS); // 中央を押さえたまま 0.25秒 = 「押し込んだ」
  stickMove(e);
});
stickEl.addEventListener("pointermove", (e) => { if (e.pointerId === stickId) stickMove(e); });
const stickEnd = (e) => {
  if (e.pointerId !== stickId) return; stickId = null; clearTimeout(stk.timer);
  if (stk.mode === "pending" && e.type === "pointerup") setAim(!aim); // 中央をすぐ離した = タップ → 照準の切り替え
  stk.mode = "none"; input.mx = input.my = input.mag = 0; aimIn.x = aimIn.y = 0; nubEl.style.transform = ""; stickEl.classList.remove("run", "press");
};
for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) stickEl.addEventListener(t, stickEnd);
// スワイプ = カメラ(スティック・ボタン以外の場所で始めた指。マウスはドラッグでカメラ)
let lookId = null, lookX = 0, lookY = 0;
canvas.addEventListener("pointerdown", (e) => {
  if (lookId !== null) return;
  lookId = e.pointerId; lookX = e.clientX; lookY = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} $("msg").style.opacity = 0;
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== lookId) return;
  const dx = e.clientX - lookX, dy = e.clientY - lookY; lookX = e.clientX; lookY = e.clientY;
  lookBy(dx, dy);
});
for (const t of ["pointerup", "pointercancel"]) canvas.addEventListener(t, (e) => { if (e.pointerId === lookId) lookId = null; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
// 照準中は、画角がせまいぶん感度を少し下げる
function lookBy(dx, dy) {
  const k = lerp(1, 0.6, aimT);
  yaw -= dx * S.swipeX * k; ctrlYaw -= dx * S.swipeX * k;    // 右へスワイプ → 右を向く(スティックの基準も、同じだけ回す)
  pitchElev = clamp(pitchElev + dy * S.swipeY * k, -6, 48);   // 上へスワイプ → 上を向く(カメラが下がる)、下へ → 見下ろす
  lastSwipeAt = performance.now();
}
window.addEventListener("keydown", (e) => { keys.add(e.code); if (e.code === "Space") { e.preventDefault(); fire(); } if (e.code === "KeyE") startDodge(); if (e.code === "ShiftLeft") setAim(true); });
window.addEventListener("keyup", (e) => { keys.delete(e.code); if (e.code === "ShiftLeft") setAim(false); });
// アクションボタン
function setAim(v) { aim = v; $("stick").classList.toggle("aim", aim); }
$("bAtk").addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); $("bAtk").classList.add("on"); fire(); });
$("bDodge").addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); $("bDodge").classList.add("on"); startDodge(); });
for (const id of ["bAtk", "bDodge"]) for (const t of ["pointerup", "pointercancel", "pointerleave"]) $(id).addEventListener(t, () => $(id).classList.remove("on"));

// ---------- 攻撃(試作: 視線の先へ弾を飛ばして、当たった位置に火花) と 回避(ダッシュ) ----------
const tracers = [];
function fire() {
  const now = performance.now(); if (now < fireReadyAt || dodge) return; fireReadyAt = now + 160;
  // 狙う向き: 照準中はカメラの視線の先 / 照準していないときは自機の正面(水平)
  const e = pitchElev * RAD, p = (pitchElev + S.pitchBias) * RAD;
  let ox = camera.position.x, oy = camera.position.y, oz = camera.position.z, dx, dy, dz;
  if (aim) { dx = Math.sin(yawView) * Math.cos(p); dy = -Math.sin(p); dz = Math.cos(yawView) * Math.cos(p); }
  else { ox = player.x; oy = 1.3; oz = player.z; dx = Math.sin(heading); dy = 0; dz = Math.cos(heading); }
  const t = Math.min(40, rayBoxes(ox, oy, oz, dx, dy, dz, 40, 0));
  const hit = new THREE.Vector3(ox + dx * t, Math.max(0.05, oy + dy * t), oz + dz * t);
  const mz = new THREE.Vector3(player.x + Math.sin(heading) * 0.55 - Math.cos(heading) * 0.22, 1.28, player.z + Math.cos(heading) * 0.55 + Math.sin(heading) * 0.22); // 右手のあたり
  const geo = new THREE.BufferGeometry().setFromPoints([mz, hit]); const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 1 }));
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true })); spark.position.copy(hit);
  scene.add(line, spark); tracers.push({ line, spark, life: 0.12, max: 0.12 });
  kickT = 1; recoil = 1.6; $("flash").style.opacity = 0.18; setTimeout(() => { $("flash").style.opacity = 0; }, 45);
}
function startDodge() {
  const now = performance.now(); if (dodge || now < dodgeReadyAt) return;
  let dx = Math.sin(heading), dz = Math.cos(heading); // スティックを倒していれば、その向き(カメラ基準)。なければ自機の正面
  const mv = moveVector(); if (mv.mag > 0.15) { dx = mv.x / mv.mag; dz = mv.z / mv.mag; }
  dodge = { t0: now, dx, dz, p: 0 }; heading = Math.atan2(dx, dz);
}
// スティック/キーボード → ワールドの移動ベクトル(カメラの向き yaw 基準: 上 = カメラの前、右 = カメラの右)
function moveVector() {
  let mx = input.mx, my = input.my, mag = input.mag;
  if (!mag) { const kx = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0), ky = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0); mx = kx; my = ky; mag = Math.min(1, Math.hypot(kx, ky)); if (mag) { mx /= Math.hypot(kx, ky); my /= Math.hypot(kx, ky); } }
  if (mag < 0.12) return { x: 0, z: 0, mag: 0, fwd: 0, str: 0 };
  const fwd = -my, str = mx, fx = Math.sin(ctrlYaw), fz = Math.cos(ctrlYaw), rx = -Math.cos(ctrlYaw), rz = Math.sin(ctrlYaw);
  const L = Math.hypot(fwd, str) || 1;
  return { x: (fx * fwd + rx * str) / L * mag, z: (fz * fwd + rz * str) / L * mag, mag, fwd: fwd / L, str: str / L };
}

// ---------- 毎フレーム ----------
const clock = new THREE.Clock(); const hudEl = $("hud");
function update(dt, now) {
  // 照準をグリグリ(中央を押さえて倒している間): スティックの向き・倒した量で、視点(向き・上下)を動かす。倒し具合の少ないところは細かく動く
  if (stk.mode === "aimadjust" && (aimIn.x || aimIn.y)) {
    const cv = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.6), k = lerp(1, 0.6, aimT);
    yaw -= cv(aimIn.x) * AIM_YAW_RATE * k * dt; ctrlYaw = yaw;
    pitchElev = clamp(pitchElev + cv(aimIn.y) * AIM_PITCH_RATE * k * dt, -6, 48); lastSwipeAt = now;
  }
  // 照準の切り替えをなめらかに
  aimT += ((aim ? 1 : 0) - aimT) * Math.min(1, dt * 9);
  // 移動
  const mv = moveVector(); let target = 0;
  if (mv.mag === 0 || aim || dodge) ctrlYaw = yaw; // 離している間・構え中は、基準をカメラに合わせる
  if (dodge) {
    const el = now - dodge.t0, u = clamp(el / DODGE_MS, 0, 1), p = 1 - (1 - u) * (1 - u), inc = DODGE_DIST * (p - dodge.p); dodge.p = p;
    const steps = Math.max(1, Math.ceil(Math.abs(inc) / 0.08)); for (let i = 0; i < steps; i++) { player.x += (dodge.dx * inc) / steps; player.z += (dodge.dz * inc) / steps; resolveCircle(player); }
    speed = DODGE_DIST / (DODGE_MS / 1000) * (1 - u); turnRemain = 0; if (u >= 1) { dodge = null; dodgeReadyAt = now + 600; }
  } else {
    const running = mv.mag >= 0.7 && !aim;
    target = mv.mag === 0 ? 0 : aim ? AIM_SPEED * (mv.mag) : mv.mag < 0.7 ? WALK_MAX * (mv.mag / 0.7) : lerp(WALK_MAX, RUN_MAX, smooth((mv.mag - 0.7) / 0.3));
    speed += (target - speed) * Math.min(1, dt * (target > speed ? 10 : 14));
    if (speed > 0.02 && mv.mag > 0) { const dirx = mv.x / mv.mag, dirz = mv.z / mv.mag, inc = speed * dt, steps = Math.max(1, Math.ceil(inc / 0.08)); for (let i = 0; i < steps; i++) { player.x += (dirx * inc) / steps; player.z += (dirz * inc) / steps; resolveCircle(player); } }
    else if (mv.mag === 0) speed *= 0.6;
    // 向き: 移動方向へ自然に旋回。照準中は、カメラの正面を向く
    // 構えていないとき: スティックを倒した向きへ、素早く(クイックターン)向きを変える。倒しはじめの QUICK_TURN_MS は、ほぼ一瞬(約0.1秒で180°)。そのあとも、向きを変えるときは速い
    // 構えているときは、カメラの正面を向く(これまで通り)
    if (mv.mag > 0 && prevMoveMag === 0 && !aim) quickTurnUntil = now + QUICK_TURN_MS;
    const want = aim ? yaw : mv.mag > 0 ? Math.atan2(mv.x, mv.z) : heading;
    const rate = aim ? 14 : now < quickTurnUntil ? QUICK_TURN_RATE : TURN_RATE;
    turnRemain = angDiff(want, heading);
    heading += turnRemain * Math.min(1, dt * rate);
    prevMoveMag = mv.mag;
    // カメラの自動追従: 構えていないとき、歩いている間(クイックターン含む)は、カメラが常に自機の背中を映すように、自機の向きへ回り込む。
    // 倒しはじめ(クイックターン中)は速く、そのあとは S.follow の速さ。直前にスワイプしていたら(0.6秒)、その操作を優先する
    if (!aim && mv.mag > 0 && now - lastSwipeAt > 600 && S.follow > 0) yaw += angDiff(heading, yaw) * Math.min(1, dt * (now < quickTurnUntil ? S.follow * 1.8 : S.follow));
  }
  // 自機の見た目
  character.position.set(player.x, 0, player.z); character.rotation.y = heading; blob.position.set(player.x, 0.012, player.z);
  cycles += (speed * dt) / walkStride * (dodge ? 0.8 : 1);
  ampE += ((clamp(speed / 1.2, 0, 1)) - ampE) * Math.min(1, dt * 10);
  const runK = clamp((speed - WALK_MAX) / (RUN_MAX - WALK_MAX), 0, 1); leanE += ((dodge ? 0.55 : runK * 0.35) - leanE) * Math.min(1, dt * 8);
  const crouch = dodge ? 0.16 * Math.sin(Math.PI * clamp((now - dodge.t0) / DODGE_MS, 0, 1)) : 0;
  kickT = Math.max(0, kickT - dt * 7);
  poseCharacter(cycles, ampE, aimT, leanE, crouch, kickT, aim ? 0 : turnRemain);
  // 弾の線を消す
  for (let i = tracers.length - 1; i >= 0; i--) { const tr = tracers[i]; tr.life -= dt; if (tr.life <= 0) { scene.remove(tr.line, tr.spark); tr.line.geometry.dispose(); tr.line.material.dispose(); tr.spark.geometry.dispose(); tr.spark.material.dispose(); tracers.splice(i, 1); } else { tr.line.material.opacity = tr.life / tr.max; tr.spark.material.opacity = tr.life / tr.max; tr.spark.scale.setScalar(1 + (1 - tr.life / tr.max) * 2); } }
  recoil = Math.max(0, recoil - dt * 9);
  updateCamera(dt);
  hudEl.textContent = `距離 ${camInfo.dist.toFixed(2)}m  高さ ${camera.position.y.toFixed(2)}m  下向き ${camInfo.pitch.toFixed(1)}°  FOV ${camera.fov.toFixed(0)}\n速さ ${speed.toFixed(1)}m/s${aim ? "  [照準]" : ""}${dodge ? "  [回避]" : ""}${camInfo.blocked ? "  [壁よけ]" : ""}`;
}
// ---------- カメラ(肩越し) ----------
const camInfo = { dist: 0, pitch: 0, blocked: false };
const crossEl = $("cross");
let eEff = S.elev; // 実際に使う仰角(壁よけで、カメラを上へ持ち上げたぶんを含む)
function updateCamera(dt) {
  yawView += angDiff(yaw, yawView) * Math.min(1, dt * 22);        // スワイプのガタつきをならす(遅れは約0.05秒)
  const dist = lerp(S.dist, S.aimDist, aimT), shoulder = lerp(S.shoulder, S.aimShoulder, aimT), fov = lerp(S.fov, S.aimFov, aimT);
  const fx = Math.sin(yawView), fz = Math.cos(yawView), rx = -Math.cos(yawView), rz = Math.sin(yawView);
  const px = player.x, py = 1.45, pz = player.z; // ピボット(自機の頭のあたり)
  const place = (ed) => { // 仰角 ed のときの、カメラの理想位置と、ピボットからの線が壁・箱にぶつかる位置
    const e = ed * RAD, x = px - fx * Math.cos(e) * dist + rx * shoulder, y = Math.min(WALL_H - 0.25, py + Math.sin(e) * dist), z = pz - fz * Math.cos(e) * dist + rz * shoulder;
    const dx = x - px, dy = y - py, dz = z - pz, len = Math.hypot(dx, dy, dz);
    return { dx, dy, dz, len, hit: rayBoxes(px, py, pz, dx / len, dy / len, dz / len, len, 0.22) };
  };
  // 壁よけ: 後ろが壁・箱でふさがれているときは、まず「カメラを上へ持ち上げて(見下ろして)よける」。どうしてもだめなら手前で止める
  let best = place(pitchElev), eT = pitchElev;
  if (best.hit < best.len - 0.02) for (let ed = pitchElev + 6; ed <= 64; ed += 6) { const c = place(ed); if (c.hit > best.hit) { best = c; eT = ed; } if (c.hit >= c.len - 0.02) break; }
  eEff += (eT - eEff) * Math.min(1, dt * (eT > eEff ? 10 : 2.5));
  const cur = place(eEff), hitT = Math.max(0.4, cur.hit) / cur.len;
  camInfo.blocked = cur.hit < cur.len - 0.02 || eEff > pitchElev + 1;
  camT = hitT < camT ? hitT : camT + (hitT - camT) * Math.min(1, dt * 2.5); camT = Math.min(camT, 1);
  camera.position.set(px + cur.dx * camT, py + cur.dy * camT, pz + cur.dz * camT);
  const pitch = clamp(eEff + S.pitchBias, -20, 78) - recoil;     // 視線の下向き角(度)
  const p = pitch * RAD;
  camera.lookAt(camera.position.x + fx * Math.cos(p), camera.position.y - Math.sin(p), camera.position.z + fz * Math.cos(p));
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camInfo.dist = cur.len * camT; camInfo.pitch = pitch;
  crossEl.style.opacity = aimT;
}
function frame() {
  const dt = Math.min(0.05, clock.getDelta()), now = performance.now();
  update(dt, now);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- 調整パネル(⚙) ----------
{
  const tune = $("tune"); let html = '<h3>カメラ調整（実機でその場で確認）</h3>';
  for (const [k, label, mn, mxv, st] of SLIDERS) html += `<label>${label}<b id="v_${k}">${S[k]}</b><input type="range" id="s_${k}" min="${mn}" max="${mxv}" step="${st}" value="${S[k]}"></label>`;
  html += '<button id="tReset">初期値に戻す</button> <button id="tCopy">値をコピー</button><div id="tOut" style="margin-top:6px;color:#9fb;word-break:break-all"></div>';
  tune.innerHTML = html;
  for (const [k] of SLIDERS) { const s = $("s_" + k); s.addEventListener("input", () => { S[k] = Number(s.value); $("v_" + k).textContent = S[k]; saveSettings(); if (k === "elev") pitchElev = S.elev; }); }
  $("tReset").addEventListener("click", () => { Object.assign(S, DEFAULTS); pitchElev = S.elev; saveSettings(); for (const [k] of SLIDERS) { $("s_" + k).value = S[k]; $("v_" + k).textContent = S[k]; } });
  $("tCopy").addEventListener("click", () => { const txt = JSON.stringify(S); $("tOut").textContent = txt; try { navigator.clipboard.writeText(txt); } catch (_) {} });
  $("gear").addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); tune.classList.toggle("show"); });
  tune.addEventListener("pointerdown", (e) => e.stopPropagation());
}
pitchElev = S.elev;
camera.fov = S.fov; camera.updateProjectionMatrix();
camera.position.set(player.x, 1.8, player.z + 2.3);
$("loading").style.display = "none";
setTimeout(() => { $("msg").style.opacity = 0; }, 8000);
requestAnimationFrame(frame);
window.__tps = { S, stk, aimIn, get ctrlYaw() { return ctrlYaw; }, get turnRemain() { return turnRemain; }, player, get heading() { return heading; }, get yaw() { return yaw; }, get pitchElev() { return pitchElev; }, get speed() { return speed; }, get aim() { return aim; }, camera, camInfo, boxes, setYaw: (v) => { yaw = v; yawView = v; }, setPos: (x, z) => { player.x = x; player.z = z; }, setHeading: (v) => { heading = v; }, lookBy, fire, startDodge, setAim, get dodging() { return !!dodge; }, input };
