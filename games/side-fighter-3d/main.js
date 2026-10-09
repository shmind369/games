import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

// ============================================================
// Side Fighter 3D — 鉄拳のようなサイドビュー視点の3D格闘ゲーム(第1段階)
//  ・左: 中華娘(プレイヤー) / 右: USAボクサー(CPU) が向かい合って立つ
//  ・スマホ縦画面。画面の左右スワイプ(ドラッグ)で、プレイヤーが横(X軸)へ移動する
//  ・まだ攻撃・ダメージ・CPUの動きはない(CPUは構えのアイドルのみ)
// 座標: X軸が左右(右が+)。カメラは+Z側から、ステージを真横に見る。Y軸が上
// ============================================================

// ---------- 設定 ----------
const STAGE_HALF = 2.6;       // ステージの端 (-2.6〜+2.6 m)。カメラは2人の中間を追う
const MAX_GAP = 2.4;          // 2人がこれ以上離れない(両方が画面に映るように。鉄拳と同じ)
const BODY_GAP = 0.7;         // 2人の体が重ならない最小距離(m)
const WALK_SPEED = 1.7;       // 最大の移動速度 (m/s)
const BACK_SPEED_SCALE = 0.85; // 後ろへ下がるときは少し遅い
const SWIPE_DEADZONE_PX = 6;  // これ以下の動きは無視
const SWIPE_FULL_PX = 55;     // これだけ動かすと最大速度
const VISIBLE_WIDTH = 3.5;    // 画面に映すステージの幅(m)。縦画面でもこの幅が収まる距離にカメラを置く
const VFOV = 40;

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
const [chinaGltf, usaGltf, walkJson, idleJson] = await Promise.all([
  loader.loadAsync("./assets/china_rigged.glb"),
  loader.loadAsync("./assets/box_usa_rigged.glb"),
  fetch("./assets/walk.json").then((r) => r.json()),
  fetch("./assets/fightIdleUsa.json").then((r) => r.json()),
]);
function makeFighter(gltf, facing) {
  const root = new THREE.Group(); // 位置(X)と向き(yaw)
  const model = gltf.scene; root.add(model);
  const bones = {};
  model.traverse((o) => { if (o.isBone) { bones[o.name] = o; o.quaternion.identity(); } if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  root.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2; // モデルは+Zを向いている。+X(右)を向く=+90°
  scene.add(root);
  return { root, bones, facing };
}
const player = makeFighter(chinaGltf, +1); // 左で、右(CPU)を向く
const cpu = makeFighter(usaGltf, -1);      // 右で、左(プレイヤー)を向く
player.x = -0.8; cpu.x = 0.8;
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

// ---------- 入力: 画面の左右スワイプ(ドラッグ)で横移動 ----------
// 押した位置から横へ動かした量で、移動の向きと速さが決まる(離すと止まる)。縦の動きは無視
const input = { dir: 0, id: null, ox: 0 }; // dir: -1(左)〜+1(右)
const keys = new Set();
canvas.addEventListener("pointerdown", (e) => { if (input.id === null) { input.id = e.pointerId; input.ox = e.clientX; input.dir = 0; canvas.setPointerCapture(e.pointerId); document.getElementById("hint").style.opacity = 0; } });
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== input.id) return;
  const dx = e.clientX - input.ox, a = Math.abs(dx);
  input.dir = a < SWIPE_DEADZONE_PX ? 0 : Math.sign(dx) * Math.min(1, (a - SWIPE_DEADZONE_PX) / (SWIPE_FULL_PX - SWIPE_DEADZONE_PX));
});
const endPtr = (e) => { if (e.pointerId === input.id) { input.id = null; input.dir = 0; } };
canvas.addEventListener("pointerup", endPtr); canvas.addEventListener("pointercancel", endPtr);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => keys.add(e.code)); window.addEventListener("keyup", (e) => keys.delete(e.code));
const readDir = () => { const k = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0); return k || input.dir; };

// ---------- 毎フレーム ----------
const state = { phase: 0, w: 0, vx: 0 };
const clock = new THREE.Clock();
function update(dt, now) {
  // 移動(X軸のみ)。CPUとは BODY_GAP 以上離れる/ステージの端で止まる
  const dir = readDir();
  const forward = dir > 0; // プレイヤーは右(CPU)を向いているので、右へ=前進、左へ=後退
  const speed = Math.abs(dir) * WALK_SPEED * (dir < 0 ? BACK_SPEED_SCALE : 1);
  const dist = speed * dt, steps = Math.max(1, Math.ceil(dist / 0.05));
  for (let i = 0; i < steps; i++) {
    player.x += (Math.sign(dir) * dist) / steps;
    player.x = Math.max(-STAGE_HALF, Math.min(STAGE_HALF, player.x));
    if (player.x > cpu.x - BODY_GAP) player.x = cpu.x - BODY_GAP; // CPUに食い込まない
    if (player.x < cpu.x - MAX_GAP) player.x = cpu.x - MAX_GAP;   // 離れすぎない(画面から出ない)
  }
  // 実際に動けた速さ(壁・CPUに当たって止まっているときは歩きアニメも止める)
  const moved = (player.x - player.root.position.x) / Math.max(dt, 1e-4);
  state.vx += (moved - state.vx) * Math.min(1, 14 * dt);
  const walkAmt = Math.min(1, Math.abs(state.vx) / (WALK_SPEED * 0.6));
  state.w += (walkAmt - state.w) * Math.min(1, 12 * dt);
  // 歩きの再生: 前進は順再生、後退は逆再生(体の向きは変えずに後ろへ歩く)。足が滑らない速さ
  state.phase += (state.vx / walkStride) * dt;
  player.root.position.x = player.x;

  // プレイヤーのポーズ: 構え(アイドル) ⇔ 歩き
  const idleP = sampleClip(idleJson, idleDur, now / 1000), walkP = sampleClip(walkJson, walkDur, state.phase * walkDur);
  for (const n of Object.keys(idleP.pose)) {
    const b = player.bones[n]; if (!b) continue;
    b.quaternion.copy(idleP.pose[n]).slerp(walkP.pose[n] || idleP.pose[n], state.w);
  }
  player.root.position.y = idleP.y + ((walkP.y - idleP.y) * state.w);
  // CPU: 構えのアイドルのループ
  const cpuP = sampleClip(idleJson, idleDur, now / 1000 + 0.7);
  for (const n of Object.keys(cpuP.pose)) { const b = cpu.bones[n]; if (b) b.quaternion.copy(cpuP.pose[n]); }
  cpu.root.position.y = cpuP.y;
  cpu.root.position.x = cpu.x;
  // カメラは2人の中間を、なめらかに追う(ステージの外側は映さない)
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
  player, cpu, STAGE_HALF, BODY_GAP, MAX_GAP, camera,
  setDir: (d) => { input.dir = d; },
  teleport: (x) => { player.x = x; player.root.position.x = x; },
  getState: () => ({ px: player.x, cx: cpu.x, vx: state.vx, w: state.w, dir: readDir() }),
};
