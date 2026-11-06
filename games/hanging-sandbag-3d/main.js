import * as THREE from 'three';
import RAPIER from './vendor/rapier3d-compat.es.js';
import { CONFIG, createSim } from './physics.js';

await RAPIER.init();
const sim = createSim(RAPIER, CONFIG);
const cfg = sim.cfg;

// ============================================================
//  描画セットアップ
// ============================================================
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2027);
scene.fog = new THREE.Fog(0x1b2027, 8, 18);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50);

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3128, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(2.5, 5, 3.5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -3; key.shadow.camera.right = 3;
key.shadow.camera.top = 4; key.shadow.camera.bottom = -2;
key.shadow.camera.near = 0.5; key.shadow.camera.far = 12;
scene.add(key);

// 床
{
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(10, 20, 0x5b6370, 0x474d57);
  grid.position.y = 0.002;
  scene.add(grid);
  // 方向の目印(正面 +Z 側 / 側面 +X 側)
  const mk = (txt, x, z, rotY) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = 'bold 40px system-ui'; g.textAlign = 'center';
    g.fillText(txt, 128, 46);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = rotY; m.position.set(x, 0.005, z);
    scene.add(m);
  };
  mk('正面 FRONT', 0, 1.3, 0);
  mk('側面 SIDE', 1.3, 0, Math.PI / 2);
}

// 天井(固定剛体)
{
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.1, 3),
    new THREE.MeshStandardMaterial({ color: 0x4a515c, roughness: 0.9, emissive: 0x262b33 })
  );
  slab.position.set(0, cfg.ceilingY + 0.05, 0);
  slab.receiveShadow = true;
  scene.add(slab);
  const bracket = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.04, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.7, roughness: 0.35 })
  );
  bracket.position.set(0, cfg.ceilingY - 0.0, 0);
  scene.add(bracket);
  const eye = new THREE.Mesh(
    new THREE.TorusGeometry(0.025, 0.007, 8, 16),
    bracket.material
  );
  eye.position.set(0, cfg.ceilingY - 0.03, 0);
  scene.add(eye);
}

const metal = new THREE.MeshStandardMaterial({ color: 0xb8c0c9, metalness: 0.85, roughness: 0.3 });

// チェーン(物理ボディ chain の描画。輪を連ねた見た目)
const chainGroup = new THREE.Group();
{
  const n = 9;
  const linkLen = cfg.chainLength / n;
  const linkGeo = new THREE.TorusGeometry(linkLen * 0.42, 0.006, 6, 12);
  linkGeo.scale(0.6, 1, 1);
  for (let i = 0; i < n; i++) {
    const link = new THREE.Mesh(linkGeo, metal);
    link.position.y = cfg.chainLength / 2 - linkLen * (i + 0.5);
    link.rotation.y = i % 2 ? Math.PI / 2 : 0;
    link.castShadow = true;
    chainGroup.add(link);
  }
}
scene.add(chainGroup);

// サンドバッグ(物理ボディ bag の描画)
const bagGroup = new THREE.Group();
let bagMesh;
{
  // 回転が目で分かるよう、縦帯と横帯の入ったテクスチャ
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#8c2a22'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) { // 革のムラ
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 6, 2 + Math.random() * 6);
  }
  g.fillStyle = '#1d1d1f';
  g.fillRect(0, 40, 512, 26); g.fillRect(0, 446, 512, 26);
  g.fillStyle = '#e9e2cf';
  g.fillRect(0, 230, 512, 52);           // 中央の白帯
  g.fillRect(0, 0, 18, 512);             // 縦の白線(正面マーカー)
  g.fillStyle = '#1d1d1f';
  g.font = 'bold 40px system-ui'; g.textAlign = 'center';
  g.fillText('HEAVY BAG 30kg', 256, 270);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const side = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65 });
  const cap = new THREE.MeshStandardMaterial({ color: 0x241c1a, roughness: 0.8 });
  bagMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(cfg.bagRadius, cfg.bagRadius, cfg.bagHeight, 48, 1),
    [side, cap, cap]
  );
  bagMesh.castShadow = true;
  bagMesh.receiveShadow = true;
  bagGroup.add(bagMesh);

  // 上部の金具リング
  const ring = new THREE.Mesh(new THREE.TorusGeometry(cfg.bagRadius * 0.92, 0.012, 8, 40), metal);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = cfg.bagHeight / 2 + 0.01;
  bagGroup.add(ring);

  // 吊りベルト 4本(バッグ上面の縁 → スイベル)。剛体バッグの一部として追従
  const top = cfg.bagHeight / 2;
  const swivel = new THREE.Vector3(0, top + cfg.strapLength, 0);
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.6, metalness: 0.3 });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const p = new THREE.Vector3(Math.cos(a) * cfg.bagRadius * 0.9, top, Math.sin(a) * cfg.bagRadius * 0.9);
    const d = swivel.clone().sub(p);
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, d.length(), 6), strapMat);
    strap.position.copy(p).addScaledVector(d, 0.5);
    strap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    strap.castShadow = true;
    bagGroup.add(strap);
  }
  // スイベル金具
  const sw = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), metal);
  sw.position.copy(swivel);
  bagGroup.add(sw);
}
scene.add(bagGroup);

// 衝撃の可視化(矢印+波紋)
const fx = [];
function spawnHitFx(point, dir, strength, normal) {
  const len = 0.25 + strength / 100 * 0.5;
  const from = point.clone().addScaledVector(dir, -len);
  const arrow = new THREE.ArrowHelper(dir, from, len, 0xffd166, 0.08, 0.05);
  scene.add(arrow);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.02, 0.035, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, side: THREE.DoubleSide, depthTest: false })
  );
  ring.position.copy(point).addScaledVector(normal, 0.003);
  ring.lookAt(point.clone().add(normal));
  scene.add(ring);
  fx.push({ arrow, ring, t: 0 });
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    const k = f.t / 0.6;
    f.ring.scale.setScalar(1 + k * 4);
    f.ring.material.opacity = Math.max(0, 1 - k);
    f.arrow.visible = k < 0.6;
    if (k >= 1) {
      scene.remove(f.arrow); scene.remove(f.ring);
      f.ring.geometry.dispose(); f.ring.material.dispose(); f.arrow.dispose?.();
      fx.splice(i, 1);
    }
  }
}

// ============================================================
//  カメラ(手動オービット)
// ============================================================
// 天井〜バッグ下端の吊り下げ全体が収まるよう、その中点を注視する
const target = new THREE.Vector3(0, (cfg.ceilingY + sim.bagCenterY - cfg.bagHeight / 2) / 2, 0);
const orbit = { yaw: 0.35, pitch: 0.02, dist: 4.2 };
const orbitGoal = { ...orbit };
function applyCamera() {
  const cp = Math.cos(orbit.pitch);
  camera.position.set(
    target.x + Math.sin(orbit.yaw) * cp * orbit.dist,
    target.y + Math.sin(orbit.pitch) * orbit.dist,
    target.z + Math.cos(orbit.yaw) * cp * orbit.dist
  );
  camera.lookAt(target);
}
function setView(yaw) {
  orbitGoal.yaw = yaw; orbitGoal.pitch = 0.02;
  // 近い方向へ回す
  while (orbitGoal.yaw - orbit.yaw > Math.PI) orbitGoal.yaw -= Math.PI * 2;
  while (orbitGoal.yaw - orbit.yaw < -Math.PI) orbitGoal.yaw += Math.PI * 2;
  viewAnimating = true;
}
let viewAnimating = false;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  camera.aspect = w / h;
  // 縦長画面ではバッグ全体が入るよう少し引く
  camera.fov = w < h ? 62 : 50;
  // 下部の操作パネルに隠れないよう、パネルを除いた領域の中央にバッグが来るよう描画範囲をずらす
  const panel = document.getElementById('panel');
  const covered = panel ? Math.max(0, h - panel.getBoundingClientRect().top) : 0;
  const shift = Math.min(covered * 0.5, h * 0.3);
  camera.setViewOffset(w, h, 0, shift, w, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ============================================================
//  UI パラメータ
// ============================================================
const ui = {
  strength: document.getElementById('strength'),
  strengthVal: document.getElementById('strengthVal'),
  mode: document.getElementById('dirMode'),
  lift: document.getElementById('lift'),
  liftVal: document.getElementById('liftVal'),
  slow: document.getElementById('slow'),
};
const updateLabels = () => {
  ui.strengthVal.textContent = ui.strength.value;
  ui.liftVal.textContent = (ui.lift.value > 0 ? '+' : '') + ui.lift.value + '°';
};
ui.strength.addEventListener('input', updateLabels);
ui.lift.addEventListener('input', updateLabels);
updateLabels();

// ============================================================
//  衝撃の適用
// ============================================================
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** 物理ボディの最新姿勢で、バッグローカル座標→ワールド座標 */
function bagLocalToWorldPhysics(local) {
  const t = sim.bag.translation(), r = sim.bag.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  return local.clone().applyQuaternion(_q).add(_v.set(t.x, t.y, t.z));
}

/**
 * point(ワールド), dir(撃力の向き・単位), strength [N·s]
 * 上下角(lift)は dir を水平軸まわりに傾けて反映する。
 */
function strike(point, dir, normal, strength) {
  const d = dir.clone();
  const liftDeg = Number(ui.lift.value);
  if (liftDeg !== 0) {
    const axis = new THREE.Vector3(0, 1, 0).cross(d);
    if (axis.lengthSq() > 1e-6) d.applyAxisAngle(axis.normalize(), -THREE.MathUtils.degToRad(liftDeg));
  }
  d.normalize();
  sim.hit({ x: point.x, y: point.y, z: point.z }, { x: d.x * strength, y: d.y * strength, z: d.z * strength });
  spawnHitFx(point, d, strength, normal);
  stats.hits++;
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function tapAt(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(bagMesh, false);
  if (!hits.length) return false;
  const h = hits[0];
  // 描画は補間姿勢なので、ローカル座標に戻してから物理の現在姿勢で接触点を求める
  const local = bagGroup.worldToLocal(h.point.clone());
  const point = bagLocalToWorldPhysics(local);
  const nLocal = h.face.normal.clone(); // bagMesh はグループ原点・無回転
  const r = sim.bag.rotation();
  const normal = nLocal.applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).normalize();

  let dir;
  const mode = ui.mode.value;
  if (mode === 'normal') {
    dir = normal.clone().negate();           // 面に垂直に押し込む
  } else if (mode === 'flat') {
    dir = raycaster.ray.direction.clone(); dir.y = 0; // 視線の水平成分
    if (dir.lengthSq() < 1e-6) dir = normal.clone().negate();
  } else {
    dir = raycaster.ray.direction.clone();    // 視線方向そのまま
  }
  strike(point, dir.normalize(), normal, Number(ui.strength.value));
  return true;
}

/**
 * プリセット衝撃: バッグのローカル座標系ではなくワールドの方向から、
 * 円筒表面の指定位置を叩く。
 *   from: 'front'(+Z 側から -Z へ) / 'side'(+X 側から -X へ)
 *   offset: 横方向のずれ [m](回転テスト用), height: 中心からの高さ [m]
 */
function presetStrike(from, offset, height) {
  const t = sim.bag.translation(), r = sim.bag.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
  const dir = from === 'front' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(-1, 0, 0);
  const lateral = from === 'front' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
  const c = new THREE.Vector3(t.x, t.y, t.z).addScaledVector(up, height);
  // 軸に垂直な平面内で、dir の逆向きの表面点(横オフセット付き)
  const back = dir.clone().negate();
  back.addScaledVector(up, -back.dot(up)).normalize();
  const lat = lateral.clone().addScaledVector(up, -lateral.dot(up)).normalize();
  const R = cfg.bagRadius;
  const o = THREE.MathUtils.clamp(offset, -R * 0.95, R * 0.95);
  const depth = Math.sqrt(R * R - o * o);
  const point = c.clone().addScaledVector(back, depth).addScaledVector(lat, o);
  const normal = point.clone().sub(c).normalize();
  strike(point, dir, normal, Number(ui.strength.value));
}

document.querySelectorAll('[data-preset]').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const [from, off, h] = b.dataset.preset.split(',');
    presetStrike(from, Number(off), Number(h));
  });
});
document.querySelectorAll('[data-view]').forEach((b) => {
  b.addEventListener('click', () => setView(Number(b.dataset.view) * Math.PI / 180));
});
document.getElementById('resetBtn').addEventListener('click', () => {
  sim.reset();
  stats.maxErr = 0; stats.hits = 0; trail.length = 0;
  prevState = readState(); currState = readState();
});
document.getElementById('panelToggle').addEventListener('click', () => {
  document.getElementById('panel').classList.toggle('collapsed');
  resize();
});

// ============================================================
//  ポインタ操作: タップ=打撃 / ドラッグ=視点回転 / ピンチ・ホイール=ズーム
// ============================================================
const pointers = new Map();
let gesture = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    gesture = { type: 'maybeTap', x0: e.clientX, y0: e.clientY, t0: performance.now(), lx: e.clientX, ly: e.clientY };
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), dist0: orbit.dist };
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) return;
  if (gesture.type === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    orbit.dist = orbitGoal.dist = THREE.MathUtils.clamp(gesture.dist0 * gesture.d0 / Math.max(d, 1), 1.4, 8);
    return;
  }
  if (gesture.type === 'maybeTap' && Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) > 8) {
    gesture.type = 'orbit';
  }
  if (gesture.type === 'orbit') {
    viewAnimating = false;
    orbit.yaw -= (e.clientX - gesture.lx) * 0.008;
    orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + (e.clientY - gesture.ly) * 0.006, -0.5, 1.2);
    Object.assign(orbitGoal, orbit);
  }
  gesture.lx = e.clientX; gesture.ly = e.clientY;
});
const endPointer = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (gesture && gesture.type === 'maybeTap' && e.type === 'pointerup' && performance.now() - gesture.t0 < 600) {
    tapAt(e.clientX, e.clientY);
  }
  if (pointers.size === 0) gesture = null;
  else if (gesture && gesture.type === 'pinch') gesture = { type: 'orbit-wait' };
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.dist = orbitGoal.dist = THREE.MathUtils.clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 1.4, 8);
}, { passive: false });

// ============================================================
//  固定時間刻みの物理ループ + 描画補間
// ============================================================
function readState() {
  const s = {};
  for (const [name, b] of [['bag', sim.bag], ['chain', sim.chain]]) {
    const t = b.translation(), r = b.rotation();
    s[name] = { p: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(r.x, r.y, r.z, r.w) };
  }
  return s;
}
let prevState = readState();
let currState = readState();
let accumulator = 0;
let lastTime = performance.now();
const MAX_STEPS_PER_FRAME = 16; // タブ復帰時などの「死のスパイラル」防止

const stats = { maxErr: 0, hits: 0 };
const trail = []; // バッグ下端の軌跡 (x,z)

const hud = {
  err: document.getElementById('hudErr'),
  maxErr: document.getElementById('hudMaxErr'),
  energy: document.getElementById('hudEnergy'),
  angle: document.getElementById('hudAngle'),
  yaw: document.getElementById('hudYaw'),
  state: document.getElementById('hudState'),
  hits: document.getElementById('hudHits'),
};
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');

function frame(now) {
  requestAnimationFrame(frame);
  let real = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  const timeScale = ui.slow.checked ? 0.25 : 1;
  accumulator += real * timeScale;

  let steps = 0;
  while (accumulator >= cfg.dt && steps < MAX_STEPS_PER_FRAME) {
    prevState = currState;
    sim.step();
    currState = readState();
    accumulator -= cfg.dt;
    steps++;
    const e = sim.jointErrors();
    stats.maxErr = Math.max(stats.maxErr, e[0], e[1]);
  }
  if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
  const alpha = accumulator / cfg.dt;

  // 物理結果(前ステップと現ステップの間を補間)をそのまま描画へ反映
  bagGroup.position.lerpVectors(prevState.bag.p, currState.bag.p, alpha);
  bagGroup.quaternion.slerpQuaternions(prevState.bag.q, currState.bag.q, alpha);
  chainGroup.position.lerpVectors(prevState.chain.p, currState.chain.p, alpha);
  chainGroup.quaternion.slerpQuaternions(prevState.chain.q, currState.chain.q, alpha);

  // カメラ
  if (viewAnimating) {
    const k = 1 - Math.exp(-real * 6);
    orbit.yaw += (orbitGoal.yaw - orbit.yaw) * k;
    orbit.pitch += (orbitGoal.pitch - orbit.pitch) * k;
    if (Math.abs(orbitGoal.yaw - orbit.yaw) < 1e-3) viewAnimating = false;
  }
  applyCamera();
  updateFx(real);
  renderer.render(scene, camera);

  updateHud();
}

let hudTimer = 0;
function updateHud() {
  // 軌跡(毎フレーム記録)
  const b = currState.bag;
  const bottom = new THREE.Vector3(0, -cfg.bagHeight / 2, 0).applyQuaternion(b.q).add(b.p);
  trail.push(bottom.x, bottom.z);
  if (trail.length > 2 * 600) trail.splice(0, 2);

  if (++hudTimer % 4) return;
  const e = sim.jointErrors();
  hud.err.textContent = (Math.max(e[0], e[1]) * 1000).toFixed(3) + ' mm';
  hud.maxErr.textContent = (stats.maxErr * 1000).toFixed(3) + ' mm';
  const en = Math.max(0, sim.energy());
  hud.energy.textContent = en.toFixed(2) + ' J';
  // 振れ角: 天井アンカー → バッグ下端 と鉛直のなす角
  const v = bottom.clone().sub(new THREE.Vector3(0, cfg.ceilingY, 0));
  const ang = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(-v.y / v.length(), -1, 1)));
  hud.angle.textContent = ang.toFixed(1) + '°';
  const w = sim.bag.angvel();
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(b.q);
  hud.yaw.textContent = (w.x * axis.x + w.y * axis.y + w.z * axis.z).toFixed(2) + ' rad/s';
  const still = en < 0.02;
  hud.state.textContent = still ? '静止' : '揺れ中';
  hud.state.className = still ? 'ok' : 'busy';
  hud.hits.textContent = stats.hits;
  drawMinimap();
}

function drawMinimap() {
  const W = mini.width, H = mini.height;
  const s = W / 1.6; // 1.6m 四方を表示
  mctx.clearRect(0, 0, W, H);
  mctx.fillStyle = 'rgba(10,14,20,0.7)';
  mctx.fillRect(0, 0, W, H);
  mctx.strokeStyle = 'rgba(255,255,255,0.15)';
  mctx.beginPath();
  mctx.moveTo(W / 2, 0); mctx.lineTo(W / 2, H);
  mctx.moveTo(0, H / 2); mctx.lineTo(W, H / 2);
  mctx.stroke();
  mctx.fillStyle = 'rgba(255,255,255,0.45)';
  mctx.font = `${10 * (W / 120)}px system-ui`;
  mctx.textAlign = 'center';
  mctx.fillText('正面', W / 2, H - 4);
  mctx.textAlign = 'right';
  mctx.fillText('側面', W - 3, H / 2 - 4);
  const n = trail.length / 2;
  for (let i = 1; i < n; i++) {
    const a = i / n;
    mctx.strokeStyle = `rgba(255,209,102,${a * 0.9})`;
    mctx.beginPath();
    mctx.moveTo(W / 2 + trail[2 * i - 2] * s, H / 2 + trail[2 * i - 1] * s);
    mctx.lineTo(W / 2 + trail[2 * i] * s, H / 2 + trail[2 * i + 1] * s);
    mctx.stroke();
  }
  if (n) {
    mctx.fillStyle = '#ffd166';
    mctx.beginPath();
    mctx.arc(W / 2 + trail[2 * n - 2] * s, H / 2 + trail[2 * n - 1] * s, 3 * (W / 120), 0, Math.PI * 2);
    mctx.fill();
  }
}

document.getElementById('loading').remove();
requestAnimationFrame((t) => { lastTime = t; frame(t); });

// 検証用(コンソールから確認できるように)
window.__sandbag = { sim, presetStrike, stats };
