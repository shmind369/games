import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

// ============================================================
// 中華風の女性キャラクターが、暗い空間(倉庫風の部屋)を歩く。スマホ縦画面・TPS(三人称)視点。
//  ・左半分をドラッグ: 移動(フローティング式の仮想スティック)。カメラの向きを基準に歩く
//  ・右半分をドラッグ: 視点(カメラ)の回転
//  ・PCでもテストできるよう、WASD/矢印キーで移動、マウスドラッグで視点
//  ・部屋の真ん中に柱があり、すり抜けない(円の当たり判定)。壁の外にも出られない
// ============================================================

// ---------- 設定 ----------
const ROOM_HALF = 7;           // 部屋は 14m x 14m (-7〜7)
const WALL_H = 6;
const PILLAR_R = 0.8;          // 柱の半径(当たり判定もこの大きさ)
const PLAYER_R = 0.3;          // キャラクターの当たり判定の半径
const WALK_SPEED = 1.5;        // 最大の歩く速さ (m/s)
const TURN_RATE = 10;          // キャラが進行方向を向く速さ
const CAM_DIST = 3.4, CAM_MIN_DIST = 1.0;
const CAM_PITCH_MIN = -0.05, CAM_PITCH_MAX = 1.0;
const LOOK_SENS_X = 0.0055, LOOK_SENS_Y = 0.0042;
const STICK_RADIUS = 60;       // スティックを最大に倒す距離(px)

// ---------- レンダラー・シーン ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030305);
scene.fog = new THREE.FogExp2(0x040407, 0.045);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 80);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 62 : 52; // 縦画面は広めに
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- 手作りのテクスチャ(画像ファイル不要) ----------
function makeCanvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const noise = (ctx, w, h, amount, base) => {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n * base[0]));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n * base[1]));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * base[2]));
  }
  ctx.putImageData(img, 0, 0);
};
// 床: 暗いコンクリート(ひび・しみ)
const floorTex = makeCanvasTexture(512, 512, (ctx, w, h) => {
  ctx.fillStyle = "#3a3a3d"; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; ctx.beginPath(); ctx.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 70, 10 + Math.random() * 40, Math.random() * 3, 0, 7); ctx.fill(); }
  ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) { ctx.beginPath(); let x = Math.random() * w, y = Math.random() * h; ctx.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.3) * 50; ctx.lineTo(x, y); } ctx.stroke(); }
  noise(ctx, w, h, 40, [1, 1, 1]);
}, 6, 6);
// 壁: 波板(コルゲート)の金属。縦の波と汚れ
const wallTex = makeCanvasTexture(512, 512, (ctx, w, h) => {
  for (let x = 0; x < w; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, "#4d4c47"); g.addColorStop(0.5, "#8b8982"); g.addColorStop(1, "#3b3a36");
    ctx.fillStyle = g; ctx.fillRect(x, 0, 16, h);
  }
  const dirt = ctx.createLinearGradient(0, 0, 0, h);
  dirt.addColorStop(0, "rgba(0,0,0,0.0)"); dirt.addColorStop(0.7, "rgba(20,15,10,0.25)"); dirt.addColorStop(1, "rgba(10,8,5,0.6)");
  ctx.fillStyle = dirt; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 25; i++) { ctx.fillStyle = `rgba(70,40,20,${Math.random() * 0.18})`; ctx.fillRect(Math.random() * w, Math.random() * h * 0.3, 2 + Math.random() * 6, 40 + Math.random() * 200); }
  noise(ctx, w, h, 30, [1, 1, 1]);
}, 5, 1.2);
// 柱: コンクリート + 横の帯(段差)
const pillarTex = makeCanvasTexture(256, 512, (ctx, w, h) => {
  ctx.fillStyle = "#6d6b66"; ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 128) { ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(0, y, w, 3); ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(0, y + 3, w, 3); }
  for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; ctx.fillRect(Math.random() * w, Math.random() * h, 4 + Math.random() * 30, 4 + Math.random() * 30); }
  noise(ctx, w, h, 45, [1, 1, 1]);
}, 3, 2);

// ---------- 部屋 ----------
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0.0 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.55, metalness: 0.5 });
for (const [x, z, ry] of [[0, -ROOM_HALF, 0], [0, ROOM_HALF, Math.PI], [-ROOM_HALF, 0, Math.PI / 2], [ROOM_HALF, 0, -Math.PI / 2]]) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, WALL_H), wallMat);
  w.position.set(x, WALL_H / 2, z); w.rotation.y = ry; w.receiveShadow = true; scene.add(w);
}
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2), new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 1 }));
ceiling.rotation.x = Math.PI / 2; ceiling.position.y = WALL_H; scene.add(ceiling);

// 柱(部屋の真ん中)。当たり判定は円(PILLAR_R)
const pillar = new THREE.Mesh(new THREE.CylinderGeometry(PILLAR_R, PILLAR_R, WALL_H, 32), new THREE.MeshStandardMaterial({ map: pillarTex, roughness: 0.85 }));
pillar.position.set(0, WALL_H / 2, 0); pillar.castShadow = true; pillar.receiveShadow = true; scene.add(pillar);
const pillarBase = new THREE.Mesh(new THREE.CylinderGeometry(PILLAR_R + 0.12, PILLAR_R + 0.18, 0.28, 32), new THREE.MeshStandardMaterial({ color: 0x55534e, roughness: 0.9 }));
pillarBase.position.set(0, 0.14, 0); pillarBase.castShadow = true; pillarBase.receiveShadow = true; scene.add(pillarBase);
// 注意帯(黄黒)を柱の下の方に巻く
const hazardTex = makeCanvasTexture(256, 32, (ctx, w, h) => { ctx.fillStyle = "#d9b100"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#111"; for (let x = -h; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 16, h); ctx.lineTo(x + 16 + h, 0); ctx.lineTo(x + h, 0); ctx.fill(); } }, 4, 1);
const hazard = new THREE.Mesh(new THREE.CylinderGeometry(PILLAR_R + 0.01, PILLAR_R + 0.01, 0.35, 32, 1, true), new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.7 }));
hazard.position.set(0, 1.0, 0); scene.add(hazard);

// 雰囲気を出す小道具: 木箱をいくつか(当たり判定なしの飾りは置かない。当たり判定ありの箱は円で近似)
const OBSTACLES = [{ x: 0, z: 0, r: PILLAR_R }]; // 当たり判定(円)の一覧
const crateMat = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.9 });
for (const [x, z, s, ry] of [[-5.2, -4.8, 1.2, 0.3], [-4.0, -5.6, 0.9, -0.2], [5.4, 4.6, 1.3, 0.5], [5.8, -4.2, 1.0, 0.1]]) {
  const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
  c.position.set(x, s / 2, z); c.rotation.y = ry; c.castShadow = true; c.receiveShadow = true; scene.add(c);
  OBSTACLES.push({ x, z, r: s * 0.62 }); // 箱を外接気味の円で近似
}

// ---------- ライト(暗い空間に、天井のランプと壁際の光) ----------
scene.add(new THREE.HemisphereLight(0x5a6580, 0x15110d, 0.55));
const key = new THREE.SpotLight(0xffe2b5, 90, 22, 0.75, 0.55, 1.4);
key.position.set(-3.2, 5.6, 3.0); key.target.position.set(0, 0, 0); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004; key.shadow.radius = 4;
scene.add(key, key.target);
const rim = new THREE.PointLight(0x6f8cff, 14, 12, 1.8); rim.position.set(4.5, 2.4, -3.5); scene.add(rim);
const lamp = new THREE.PointLight(0xffb060, 20, 9, 1.6); lamp.position.set(5.6, 3.2, 3.5); scene.add(lamp);
// 壁の光の面(右の壁を照らすスポット)
const wallSpot = new THREE.SpotLight(0xfff0d0, 55, 14, 0.5, 0.7, 1.5);
wallSpot.position.set(1.5, 5.4, 2.0); wallSpot.target.position.set(ROOM_HALF, 1.8, 1.0); scene.add(wallSpot, wallSpot.target);

// ---------- キャラクター(GLB)とモーション ----------
const character = new THREE.Group(); // 位置・向き(yaw)を持つ根
scene.add(character);
const bonesByName = {};
let walkClip = null, idlePose = null;
let walkDuration = 1, walkStride = 0.9;

const loader = new GLTFLoader();
const [gltf, walkJson] = await Promise.all([
  loader.loadAsync("./assets/china_rigged.glb"),
  fetch("./assets/walk.json").then((r) => r.json()),
]);
const model = gltf.scene;
model.traverse((o) => { if (o.isBone) bonesByName[o.name] = o; if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
character.add(model);

walkClip = walkJson;
walkDuration = walkJson.keyframes[walkJson.keyframes.length - 1].time || 1;
walkStride = walkJson.strideLengthPerCycle || 0.9;
// 立ち姿(アイドル): 歩きの中で両足がそろう「通過」の姿勢を使う(腕もだらりと自然)
const passKey = walkJson.keyframes.find((k) => k.frame === 7) || walkJson.keyframes[0];
idlePose = toQuats(passKey.pose);
const idleModelPos = passKey.modelPosition || [0, 0, 0];

function toQuats(pose) { const o = {}; for (const n of Object.keys(pose)) o[n] = new THREE.Quaternion(...pose[n]); return o; }
const _qa = new THREE.Quaternion();
// 歩きのクリップを時刻t(秒, ループ)でサンプル。{ pose: name→Quaternion, y: モデルの上下 }
function sampleWalk(t) {
  const keys = walkClip.keyframes, tt = ((t % walkDuration) + walkDuration) % walkDuration;
  let i = 0; while (i < keys.length - 2 && keys[i + 1].time <= tt) i++;
  const a = keys[i], b = keys[i + 1], span = b.time - a.time, f = span > 0 ? (tt - a.time) / span : 0;
  const pose = {};
  for (const n of Object.keys(a.pose)) { pose[n] = new THREE.Quaternion(...a.pose[n]).slerp(_qa.set(...b.pose[n]), f); }
  const ay = (a.modelPosition || [0, 0, 0])[1], by = (b.modelPosition || [0, 0, 0])[1];
  return { pose, y: ay + (by - ay) * f };
}

// ---------- 入力: 仮想スティック(左)・視点(右)・キーボード ----------
const input = { moveX: 0, moveY: 0, keys: new Set() }; // moveY: 前が+
const stick = { id: null, ox: 0, oy: 0 }, look = { id: null, x: 0, y: 0 };
const baseEl = document.getElementById("stickBase"), knobEl = document.getElementById("stickKnob"), hintEl = document.getElementById("hint");
baseEl.style.display = knobEl.style.display = "none";
let hintTimer = setTimeout(() => (hintEl.style.opacity = 0), 6000);
const camState = { yaw: 0, pitch: 0.28 }; // yaw: カメラが向いている方角(0 = +Z方向を見る)

function stickStart(e) {
  stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY;
  baseEl.style.left = knobEl.style.left = `${e.clientX}px`; baseEl.style.top = knobEl.style.top = `${e.clientY}px`;
  baseEl.style.display = knobEl.style.display = "block";
}
function stickMove(e) {
  let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
  const len = Math.hypot(dx, dy), m = Math.min(1, len / STICK_RADIUS);
  if (len > 0) { dx /= len; dy /= len; }
  input.moveX = dx * m; input.moveY = -dy * m; // 画面の上へ倒す = 前
  knobEl.style.left = `${stick.ox + dx * m * STICK_RADIUS}px`; knobEl.style.top = `${stick.oy + dy * m * STICK_RADIUS}px`;
}
function stickEnd() { stick.id = null; input.moveX = input.moveY = 0; baseEl.style.display = knobEl.style.display = "none"; }
canvas.addEventListener("pointerdown", (e) => {
  hintEl.style.opacity = 0; clearTimeout(hintTimer);
  if (e.pointerType === "mouse") { look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; canvas.setPointerCapture(e.pointerId); return; }
  if (e.clientX < window.innerWidth * 0.5) { if (stick.id === null) { stickStart(e); canvas.setPointerCapture(e.pointerId); } }
  else if (look.id === null) { look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; canvas.setPointerCapture(e.pointerId); }
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId === stick.id) stickMove(e);
  else if (e.pointerId === look.id) {
    camState.yaw += (e.clientX - look.x) * LOOK_SENS_X; // 指に合わせて景色が動く
    camState.pitch = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, camState.pitch - (e.clientY - look.y) * LOOK_SENS_Y));
    look.x = e.clientX; look.y = e.clientY;
  }
});
const endPointer = (e) => { if (e.pointerId === stick.id) stickEnd(); if (e.pointerId === look.id) look.id = null; };
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => input.keys.add(e.code));
window.addEventListener("keyup", (e) => input.keys.delete(e.code));

// ---------- 当たり判定 ----------
// 円(柱・箱)と、部屋の壁(四角)。動く前の位置から動いた位置へ、円の外へ押し出して滑らせる
function resolveCollisions(pos) {
  for (let iter = 0; iter < 3; iter++) {
    for (const o of OBSTACLES) {
      const dx = pos.x - o.x, dz = pos.z - o.z, d = Math.hypot(dx, dz), min = o.r + PLAYER_R;
      if (d < min) { const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0; pos.x = o.x + nx * min; pos.z = o.z + nz * min; }
    }
    const lim = ROOM_HALF - PLAYER_R;
    pos.x = Math.max(-lim, Math.min(lim, pos.x)); pos.z = Math.max(-lim, Math.min(lim, pos.z));
  }
}

// ---------- 毎フレーム ----------
const player = { pos: new THREE.Vector3(0, 0, 3.4), yaw: Math.PI, speed01: 0, phase: 0 }; // yaw: キャラが向いている方角(0=+Z)
const clock = new THREE.Clock();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camTarget = new THREE.Vector3();
let camDistNow = CAM_DIST;
camState.yaw = Math.PI; // 最初は部屋の奥(柱)へ向かって立つ
const tmp = new THREE.Vector3();

function readMove() {
  let mx = input.moveX, my = input.moveY;
  const k = input.keys;
  if (k.size) {
    const kx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const ky = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    if (kx || ky) { const l = Math.hypot(kx, ky); mx = kx / l; my = ky / l; }
  }
  return { mx, my };
}

function update(dt) {
  const { mx, my } = readMove();
  const mag = Math.min(1, Math.hypot(mx, my));
  // カメラの向き(yaw)を基準に、前(my)・右(mx)へ進む
  const fx = Math.sin(camState.yaw), fz = Math.cos(camState.yaw);
  const rx = -Math.cos(camState.yaw), rz = Math.sin(camState.yaw);
  let wishX = fx * my + rx * mx, wishZ = fz * my + rz * mx;
  const wl = Math.hypot(wishX, wishZ);
  if (wl > 1e-4) { wishX /= wl; wishZ /= wl; }
  const speed = mag > 0.08 ? WALK_SPEED * mag : 0;
  // 小刻みに動かして、壁や柱をすり抜けないようにする(1回の移動を最大0.1mに)
  const dist = speed * dt, steps = Math.max(1, Math.ceil(dist / 0.1));
  for (let i = 0; i < steps; i++) {
    player.pos.x += (wishX * dist) / steps; player.pos.z += (wishZ * dist) / steps;
    resolveCollisions(player.pos);
  }
  // 進行方向へ、なめらかに向く
  if (speed > 0) {
    const target = Math.atan2(wishX, wishZ);
    let d = target - player.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    player.yaw += d * Math.min(1, TURN_RATE * dt);
  }
  // 歩きの強さ(0〜1)をなめらかに。歩行アニメの速さは、足が滑らないよう移動速度に合わせる
  player.speed01 += ((speed > 0 ? Math.max(0.35, mag) : 0) - player.speed01) * Math.min(1, 10 * dt);
  player.phase += (speed / walkStride) * dt;

  // ポーズ: 立ち姿 ⇔ 歩き をブレンド
  const w = player.speed01;
  const walk = sampleWalk(player.phase * walkDuration);
  for (const name of Object.keys(idlePose)) {
    const b = bonesByName[name]; if (!b) continue;
    b.quaternion.copy(idlePose[name]).slerp(walk.pose[name] || idlePose[name], w);
  }
  const breathe = Math.sin(performance.now() / 900) * 0.006 * (1 - w); // 立っているときの小さな呼吸
  if (bonesByName.Chest) bonesByName.Chest.rotation.x += breathe;
  character.position.set(player.pos.x, idleModelPos[1] + (walk.y - idleModelPos[1]) * w, player.pos.z);
  character.rotation.y = player.yaw;

  updateCamera(dt);
}

// カメラ: キャラの背後(yaw/pitchで回転)。柱・壁にめり込まないよう、近づける
function updateCamera(dt) {
  camTarget.set(player.pos.x, 1.45, player.pos.z);
  const cp = Math.cos(camState.pitch), sp = Math.sin(camState.pitch);
  const hx = -Math.sin(camState.yaw), hz = -Math.cos(camState.yaw); // ターゲット→カメラの、水平方向の単位ベクトル
  let d = CAM_DIST;
  // 柱・箱(円): ターゲットからカメラへの水平の線が円を横切るなら、手前で止める(sは水平距離)
  for (const o of OBSTACLES) {
    const ox = camTarget.x - o.x, oz = camTarget.z - o.z, rr = o.r + 0.25;
    const b = ox * hx + oz * hz, c = ox * ox + oz * oz - rr * rr, disc = b * b - c;
    if (disc > 0 && c > 0) { const s0 = -b - Math.sqrt(disc); if (s0 > 0 && s0 < d * cp) d = Math.max(CAM_MIN_DIST, s0 / cp); }
  }
  // 壁: 部屋の外へ出ないように
  const lim = ROOM_HALF - 0.25;
  for (const [pos, h] of [[camTarget.x, hx], [camTarget.z, hz]]) {
    if (Math.abs(h) > 1e-4) { const s0 = ((h > 0 ? lim : -lim) - pos) / h; if (s0 > 0 && s0 < d * cp) d = Math.max(CAM_MIN_DIST, s0 / cp); }
  }
  camDistNow += (d - camDistNow) * Math.min(1, (d < camDistNow ? 20 : 4) * dt); // 近づくのは速く、離れるのはゆっくり
  camPos.set(camTarget.x + hx * cp * camDistNow, Math.max(0.35, camTarget.y + sp * camDistNow), camTarget.z + hz * cp * camDistNow);
  camera.position.copy(camPos);
  camLook.set(camTarget.x, camTarget.y - 0.1, camTarget.z);
  camera.lookAt(camLook);
}

function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
document.getElementById("loading").style.display = "none";
update(0.016); camDistNow = CAM_DIST;
requestAnimationFrame(frame);

// テスト用
window.__game = {
  player, camState, OBSTACLES, PILLAR_R, PLAYER_R, ROOM_HALF,
  setStick: (x, y) => { input.moveX = x; input.moveY = y; },
  setCam: (yaw, pitch) => { camState.yaw = yaw; if (pitch !== undefined) camState.pitch = pitch; },
  teleport: (x, z) => { player.pos.set(x, 0, z); },
  getState: () => ({ x: player.pos.x, z: player.pos.z, yaw: player.yaw, speed01: player.speed01, camYaw: camState.yaw, camDist: camDistNow }),
};
