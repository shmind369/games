import * as THREE from 'three';
import RAPIER from './vendor/rapier3d-compat.es.js';
import { CONFIG, createSim } from './physics.js';
import { Boxer, BOXER, DODGES } from './boxer.js';
import { StickModes, STICK_ZONES } from './stickModes.js';
import { Sfx } from './sound.js';
import { buildArena } from './arena.js';
import { OpponentAI } from './ai.js';

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
scene.background = new THREE.Color(0x07090d); // 暗い会場
scene.fog = new THREE.Fog(0x07090d, 10, 28);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50);

scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x15120f, 0.45));
// 主光源(真上寄りのリングの照明)。影はリング全体を覆う
const key = new THREE.DirectionalLight(0xfff6e8, 1.45);
key.position.set(1.5, 7, 2.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -4.2; key.shadow.camera.right = 4.2;
key.shadow.camera.top = 4.2; key.shadow.camera.bottom = -4.2;
key.shadow.camera.near = 1; key.shadow.camera.far = 14;
scene.add(key);

// 会場: ボクシングリング(arena.js)。サンドバッグはリング中央の照明トラスの梁から吊る
const arena = buildArena(scene, cfg.ceilingY);
// 自機を隠しているロープ・ポスト・パッドを半透明にするための、自機の点(頭・胴・手足)
const OCC_BONES = ['Head', 'Neck', 'Chest', 'Hips', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'LeftLowerLeg', 'RightLowerLeg'];
const occPts = OCC_BONES.map(() => new THREE.Vector3());
const occHeadTop = new THREE.Vector3();

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

// 効果音(sound.js)。iOS は最初のタッチまで音を出せないので、最初の操作で有効にする
const sfx = new Sfx();
// iOS は「指を離した / タップ / キー」の中でしか音を有効にできないので、それらのイベントで毎回呼ぶ(止められても次の操作で戻る)
for (const ev of ['touchend', 'pointerup', 'click', 'keydown', 'pointerdown']) window.addEventListener(ev, () => sfx.unlock(), { capture: true, passive: true });

// ボクサー(assets/boxer_rigged.glb)。構えたままステップで動き、パンチでバッグを叩ける(boxer.js)
let boxer = null;
// ============================================================
//  モード: タイトル / サンドバッグ / 対戦
// ============================================================
let gameMode = 'title';          // 'title' | 'sandbag' | 'versus'
const vs = { opp: null, ai: new OpponentAI(), hpP: 100, hpO: 100, state: 'fight', koT: 0, loading: null };
const DAMAGE = { jab: 6, straight: 10, hookL: 9, hookR: 9, upperL: 9, upperR: 11 }; // 頭は ×1.3
const HEAD_MUL = 1.3;
const OPP_URL = './assets/box_usa_rigged.glb';
const oppFocus = new THREE.Vector3(), playerFocus = new THREE.Vector3();
const BAG_AIM_Y = 1.15, BODY_AIM_UP = 0.08, _aimV = new THREE.Vector3();
/** 相手のボディ(腹)の高さ。ダッキング中のパンチはここを狙う */
function bodyAimY(b) {
  const sp = b.bones && b.bones.Spine;
  if (!sp) return 1.05;
  b.group.updateMatrixWorld(true);
  return sp.getWorldPosition(_aimV).y + BODY_AIM_UP;
}
/** 操作を受け付けるか(タイトル中・KO後は受け付けない) */
function canAct() {
  if (gameMode === 'title') return false;
  if (gameMode === 'versus' && vs.state !== 'fight') return false;
  return true;
}
const titleEl = document.getElementById('titleScreen'), resultEl = document.getElementById('resultScreen');
const vsHud = document.getElementById('vsHud'), hpPEl = document.getElementById('hpP'), hpOEl = document.getElementById('hpO');
function showHp() {
  hpPEl.style.width = Math.max(0, vs.hpP) + '%';
  hpOEl.style.width = Math.max(0, vs.hpO) + '%';
}
function flashHp(el) { el.parentElement.classList.remove('hit'); void el.offsetWidth; el.parentElement.classList.add('hit'); }
async function startMode(mode) {
  gameMode = mode;
  titleEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  document.body.dataset.mode = mode;
  const versus = mode === 'versus';
  bagGroup.visible = chainGroup.visible = !versus;          // 対戦ではサンドバッグを出さない(物理も止める)
  vsHud.classList.toggle('hidden', !versus);
  if (boxer) {
    boxer.avoidCenter = !versus;
    boxer.keepDist = versus ? 0.5 : BOXER.capsuleRadius + 0.18 + BOXER.bagGap;
    boxer.down = null; boxer.react = null; boxer.punch = null; boxer.queue.length = 0; boxer.hop = null;
    boxer.pos.set(versus ? 0 : -0.69, versus ? 0.85 : 0.37);
  }
  if (versus) {
    if (!vs.opp) {
      vs.loading = vs.loading || Boxer.load(scene, OPP_URL);
      vs.opp = await vs.loading;
    }
    const o = vs.opp;
    o.group.visible = true;
    o.avoidCenter = false; o.keepDist = 0.5;
    o.down = null; o.react = null; o.punch = null; o.queue.length = 0; o.hop = null;
    o.pos.set(0, -0.85); o.yaw = 0;
    vs.ai = new OpponentAI();
    vs.hpP = 100; vs.hpO = 100; vs.state = 'fight'; vs.koT = 0;
    showHp();
  } else {
    if (vs.opp) vs.opp.group.visible = false;
    sim.reset();
    prevState = readState(); currState = readState();
  }
}
function toTitle() {
  gameMode = 'title';
  document.body.dataset.mode = 'title';
  resultEl.classList.add('hidden');
  titleEl.classList.remove('hidden');
}
document.getElementById('btnVersus').addEventListener('click', () => { sfx.unlock(); startMode('versus'); });
document.getElementById('btnSandbag').addEventListener('click', () => { sfx.unlock(); startMode('sandbag'); });
document.getElementById('titleBtn').addEventListener('click', (e) => { e.stopPropagation(); toTitle(); });
document.getElementById('btnRematch').addEventListener('click', () => startMode('versus'));
document.getElementById('btnResultTitle').addEventListener('click', () => toTitle());
// URL で直接始める(?mode=versus / ?mode=sandbag)。打撃テスト(?test)はサンドバッグ
{
  const q = new URLSearchParams(location.search);
  if (q.has('test') || q.get('mode') === 'sandbag') setTimeout(() => startMode('sandbag'), 0);
  else if (q.get('mode') === 'versus') setTimeout(() => startMode('versus'), 0);
}

/** 対戦: パンチが当たったときの処理(attacker → defender) */
function landPunch(hit, attacker, defender, defenderIsOpp) {
  const dmg = DAMAGE[hit.kind] * (hit.part === 'head' ? HEAD_MUL : 1) * (hit.combo > 1 ? 0.85 : 1);
  const side = hit.kind === 'hookL' ? 'R' : hit.kind === 'hookR' ? 'L' : 'F';
  defender.takeHit(hit.part, side, dmg / 10);
  spawnHitFx(hit.point, hit.dir, dmg * 3, hit.dir.clone().negate());
  sfx.hit(dmg * 2.6, hit.kind !== 'jab');
  if (defenderIsOpp) { vs.hpO -= dmg; vs.ai.onHit(); flashHp(hpOEl); } else { vs.hpP -= dmg; flashHp(hpPEl); }
  showHp();
  if (vs.hpO <= 0 || vs.hpP <= 0) {
    defender.knockDown();
    vs.state = 'ko'; vs.koAt = performance.now();
  }
}

Boxer.load(scene).then((bx) => {
  boxer = bx;
  bx.onEvent = (type, data) => {
    if (type === 'swing') sfx.swing(data);
    else if (type === 'push' || type === 'land') sfx.step(type);
  };
  sim.addBoxerBody(BOXER.capsuleRadius, BOXER.capsuleHalf, bx.pos.x, bx.pos.y);
  if (gameMode !== 'title') startMode(gameMode); // 自機の読み込み前にモードが選ばれていたら、位置などを合わせ直す
}).catch((e) => console.error('ボクサーの読み込みに失敗しました', e));

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
const TARGET_Y_TEST = target.y;  // 打撃テスト: 吊り下げ全体が収まる高さを注視
const TARGET_Y_BOXER = 1.0;
// ボクサー操作のカメラ(自機とバッグの全身が映る横寄りの構図)
const CAM_SIDE_ANGLE = 1.0;    // 自機の真後ろから右手側へ回す角度 [rad](約57°。背中が少し見える)
const CAM_PITCH = 0.12;        // 少し見下ろす
const CAM_MARGIN = 0.75;       // 横の余白 [m]
const CAM_HEIGHT_HALF = 1.25;  // 縦に収める高さの半分 [m](床〜バッグ上端)
const CAM_MIN_DIST = 3.0;      // ボクサー操作: 低めを注視して、足元までプレイ領域(操作領域より上)に収める
function applyCamera() {
  target.y = document.body.classList.contains('boxerMode') ? TARGET_Y_BOXER : TARGET_Y_TEST;
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
let lastUserOrbit = -1e9; // 最後に手で視点を回した時刻(ボクサー操作中の自動追従を少し止める)
const FOLLOW_PAUSE_MS = 2500;

const CTRL_BAND_H = 236; // ボクサー操作中の下部の操作領域の高さ [px](index.html の #ctrlBand と合わせる)。その上をプレイ領域にする
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  camera.aspect = w / h;
  // 縦長画面ではバッグ全体が入るよう少し引く
  camera.fov = w < h ? 62 : 50;
  // 下部の操作パネルに隠れないよう、パネルを除いた領域の中央にバッグが来るよう描画範囲をずらす
  const panel = document.getElementById('panel');
  const covered = document.body.classList.contains('boxerMode') ? CTRL_BAND_H
    : panel ? Math.max(0, h - panel.getBoundingClientRect().top) : 0;
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
  sfx.hit(strength, strength >= 28);
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
// ---- 操作モード: ボクサー操作 / 打撃テスト(従来のパネル) ----
const modeBtn = document.getElementById('modeBtn');
function setBoxerMode(on) {
  document.body.classList.toggle('boxerMode', on);
  modeBtn.textContent = on ? '打撃テストへ' : 'ボクサー操作へ';
  resize();
}
modeBtn.addEventListener('click', () => setBoxerMode(!document.body.classList.contains('boxerMode')));
// 上部のナビゲーション(モード切替ボタン)はボクサー操作中は出さない。打撃テストのパネルは URL に ?test を付けると開ける
if (new URLSearchParams(location.search).has('test')) setBoxerMode(false);

// ---- ボクサーの操作: スティック(左下)・JAB / STRAIGHT(右下)・キーボード ----
const bStick = document.getElementById('bStick'), bNub = document.getElementById('bNub');
const stickIn = { id: null, cx: 0, cy: 0, x: 0, y: 0 };
const STICK_R = 70; // スティックの可動半径 [px](CSS の #bStick 168px と合わせる。以前の 58px の1.2倍)
bStick.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (stickIn.id !== null) return;
  try { bStick.setPointerCapture(e.pointerId); } catch (_) { /* 合成イベント等 */ }
  const r = bStick.getBoundingClientRect();
  Object.assign(stickIn, { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
  moveStick(e);
});
function moveStick(e) {
  if (e.pointerId !== stickIn.id) return;
  let dx = e.clientX - stickIn.cx, dy = e.clientY - stickIn.cy;
  const l = Math.hypot(dx, dy);
  if (l > STICK_R) { dx *= STICK_R / l; dy *= STICK_R / l; }
  // デッドゾーンなどはかけずに生の倒し量を渡す(待機/回避/移動の判定は StickModes が行う)
  stickIn.x = dx / STICK_R; stickIn.y = -dy / STICK_R;
  bNub.style.transform = `translate(${dx}px, ${dy}px)`;
}
bStick.addEventListener('pointermove', moveStick);
const endStick = (e) => {
  if (e.pointerId !== stickIn.id) return;
  Object.assign(stickIn, { id: null, x: 0, y: 0 });
  bNub.style.transform = '';
};
bStick.addEventListener('pointerup', endStick);
bStick.addEventListener('pointercancel', endStick);
// ---- 攻撃は 6 つのボタンのみ(移動パッドは移動と回避だけ)----
const PUNCH_BUTTONS = [['ljabBtn', 'jab'], ['rjabBtn', 'straight'], ['lhookBtn', 'hookL'], ['rhookBtn', 'hookR'], ['lupBtn', 'upperL'], ['rupBtn', 'upperR']];
const PUNCH_KEYS = { KeyJ: 'jab', KeyZ: 'jab', KeyK: 'straight', KeyX: 'straight', KeyU: 'hookL', KeyI: 'hookR', KeyN: 'upperL', KeyM: 'upperR' };
for (const [id, kind] of PUNCH_BUTTONS) {
  const el = document.getElementById(id);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (boxer && canAct()) boxer.throwPunch(kind); });
}
const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (!e.repeat && boxer && canAct()) {
    if (PUNCH_KEYS[e.code]) boxer.throwPunch(PUNCH_KEYS[e.code]);
  }
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});
window.addEventListener('blur', () => keys.clear());
// ---- スティックの倒し量で 待機 / 回避 / 移動 を切り替える(stickModes.js) ----
const stickModes = new StickModes();
let stickState = { mode: 'neutral', depth: 0, speed: 0, big: false };
/** スティック/キーの向き(上 = カメラの向いている方向)をワールドの (x, z) に */
function camToWorld(x, y) {
  const fx = -Math.sin(orbit.yaw), fz = -Math.cos(orbit.yaw), rx = Math.cos(orbit.yaw), rz = -Math.sin(orbit.yaw);
  return { x: fx * y + rx * x, z: fz * y + rz * x };
}
/**
 * 毎フレームの操作: { move: ワールドの移動入力, dodgeDir: 回避の向き(ワールド)か null, depth: 回避の深さ 0..1 }
 *  スティック: 0〜12% 待機 / 12〜82% 回避(強さで深さが連続的に変わる) / 82%〜 移動(強さで速さが変わる)
 *  PC: WASD = 移動(従来どおり) / 矢印キー = 大きな回避
 */
function boxerControl(frameDt) {
  const touching = stickIn.id !== null;
  stickState = stickModes.update(touching, stickIn.x, stickIn.y, frameDt);
  let move = { x: 0, z: 0 }, dodgeDir = null, depth = 0;
  if (stickState.mode === 'move') {
    const w = camToWorld(stickState.dirX, stickState.dirY);
    move = { x: w.x * stickState.speed, z: w.z * stickState.speed };
  } else if (stickState.mode === 'dodge') {
    dodgeDir = { x: stickState.dirX, y: stickState.dirY }; // 回避はスティックの向きそのまま(カメラの向きに関係なく)
    depth = stickState.depth;
  }
  if (!touching) {
    let x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let y = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const l = Math.hypot(x, y);
    if (l > 0) { const w = camToWorld(x / l, y / l); move = { x: w.x, z: w.z }; }
    const ax = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    const ay = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
    if (ax || ay) { const l = Math.hypot(ax, ay); dodgeDir = { x: ax / l, y: ay / l }; depth = 1; }
  }
  return { move, dodgeDir, depth };
}
// 回避の向き → 各回避の重み。方向はすべて「相手(バッグ)基準」:
//   上(相手へ向かう)= ダッキング / 下(相手から離れる)= スウェー / 左 = ヘッドスリップ左 / 右 = ヘッドスリップ右
//   (ボクサー操作中はカメラが背中側にあるので、画面の上下 = 相手へ向かう/離れる)
//   斜めは隣どうしを cos² で混ぜる(向きを回しても姿勢が急に変わらない)
const DODGE_ANGLES = { duck: 0, slipL: Math.PI / 2, sway: Math.PI, slipR: -Math.PI / 2 };
function dodgeWeights(dir, depth) {
  // スティックの上 = 相手へ向かう(ダッキング) / 下 = 離れる(スウェー) / 左右 = 本人の左右(スリップ)。
  // カメラが横からでも割り当ては変わらない
  const th = Math.atan2(-dir.x, dir.y), out = {};
  for (const k in DODGE_ANGLES) { const c = Math.max(0, Math.cos(th - DODGE_ANGLES[k])); out[k] = c * c * depth; }
  return out;
}
const bStickEl = document.getElementById('bStick'), bModeEl = document.getElementById('bMode');
let prevStickMode = 'neutral'; // 回避に入った瞬間だけ風切り音を鳴らすため
// 音のオン/オフ(操作領域の右上。設定は端末に保存)
const sndBtn = document.getElementById('sndBtn');
const showSnd = () => {
  sndBtn.textContent = sfx.muted ? '🔇 消音中' : '🔊 音あり';
  sndBtn.classList.toggle('off', sfx.muted);
  sndBtn.setAttribute('aria-label', sfx.muted ? '音を出す' : '音を消す');
};
// 切り替えは click(iOS で音を有効にできるイベント)で行う
sndBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
sndBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); sfx.unlock(); sfx.setMuted(!sfx.muted); showSnd(); if (!sfx.muted) setTimeout(() => sfx.hit(18), 60); });
showSnd();
function showStickMode(dw) {
  bStickEl.dataset.mode = stickState.mode;
  let txt = '待機';
  if (stickState.mode === 'move') txt = `移動 ${Math.round(stickState.speed * 100)}%`;
  else if (dw) {
    let best = null;
    for (const k in dw) if (!best || dw[k] > dw[best]) best = k;
    txt = `${stickState.big ? '大きな' : '小さな'}回避: ${DODGES[best].label}`;
  }
  if (boxer && boxer.punch && boxer.combo >= 2) txt = `コンビネーション ${boxer.combo} 発目` + (boxer.combo >= BOXER.comboMax ? '(最大)' : '');
  if (bModeEl.textContent !== txt) bModeEl.textContent = txt;
}

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
    lastUserOrbit = performance.now();
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

  if (boxer) sim.setBoxerPos(boxer.pos.x, boxer.pos.y); // 体(キネマティック)を今の位置へ
  if (gameMode === 'versus') accumulator = 0;           // 対戦ではサンドバッグの物理を止める
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
  // ボクサー操作中: 自機とバッグの全身が常に映るよう、自機の右斜め後ろ(横寄り)から2人の中間を見る。
  // 自機がどこにいても同じ構図(自機が左・バッグが右)。距離は2人の間隔と画面の幅から決める。手で視点を回すと少し止まる
  const boxerCam = boxer && document.body.classList.contains('boxerMode');
  if (boxerCam && performance.now() - lastUserOrbit > FOLLOW_PAUSE_MS && !viewAnimating) {
    const bx = boxer.pos;
    // 相手: サンドバッグは吊り位置(原点)で考える(揺れで画面が揺れないように)。対戦では対戦相手の位置
    const fx = gameMode === 'versus' && vs.opp ? vs.opp.pos.x : 0, fz = gameMode === 'versus' && vs.opp ? vs.opp.pos.y : 0;
    const behind = Math.atan2(bx.x - fx, bx.y - fz);        // 相手→自機の向き(= 自機の真後ろ)
    // 自機の右手側(モデルの -X)へ回した方を選ぶ
    const rx = -Math.cos(boxer.yaw), rz = Math.sin(boxer.yaw);
    const a1 = behind + CAM_SIDE_ANGLE, a2 = behind - CAM_SIDE_ANGLE;
    const want = Math.sin(a1) * rx + Math.cos(a1) * rz >= Math.sin(a2) * rx + Math.cos(a2) * rz ? a1 : a2;
    // 2人が画面の横幅に収まる距離
    const sep = Math.hypot(bx.x - fx, bx.y - fz);
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const lateral = sep * Math.sin(CAM_SIDE_ANGLE) / 2 + CAM_MARGIN;  // 画面上での2人の横の広がり(半分)+余白
    const dist = Math.max(CAM_MIN_DIST, lateral / Math.tan(hHalf), CAM_HEIGHT_HALF / Math.tan(vHalf));
    const k = Math.min(1, real * 3);
    let d = want - orbit.yaw;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    orbit.yaw += d * k;
    orbit.pitch += (CAM_PITCH - orbit.pitch) * k;
    orbit.dist += (dist - orbit.dist) * k;
    Object.assign(orbitGoal, orbit);
  }
  if (boxerCam) {
    // 注視点 = 自機と相手(バッグ/対戦相手)の中間
    const fx = gameMode === 'versus' && vs.opp ? vs.opp.pos.x : 0, fz = gameMode === 'versus' && vs.opp ? vs.opp.pos.y : 0;
    target.x += ((boxer.pos.x + fx) / 2 - target.x) * Math.min(1, real * 4);
    target.z += ((boxer.pos.y + fz) / 2 - target.z) * Math.min(1, real * 4);
  } else { target.x = 0; target.z = 0; }
  applyCamera();
  updateFx(real);
  if (boxer) {
    const ctl = canAct() ? boxerControl(real) : { move: { x: 0, z: 0 }, dodgeDir: null, depth: 0 };
    const dw = ctl.dodgeDir ? dodgeWeights(ctl.dodgeDir, ctl.depth) : null;
    boxer.setDodge(dw);
    showStickMode(dw);
    if (stickState.mode === 'dodge' && ctl.depth > 0 && prevStickMode !== 'dodgeOn') { sfx.dodge(); prevStickMode = 'dodgeOn'; }
    else if (!(stickState.mode === 'dodge' && ctl.depth > 0)) prevStickMode = stickState.mode;
    const versus = gameMode === 'versus' && vs.opp;
    if (versus) oppFocus.set(vs.opp.pos.x, 0, vs.opp.pos.y);
    // ダッキング中のパンチの狙いの高さ: 対戦では相手の腹(Spine の少し上)、サンドバッグでは袋の中ほど
    boxer.aimY = versus ? bodyAimY(vs.opp) : BAG_AIM_Y;
    boxer.update(real * timeScale, now / 1000, ctl.move, versus ? oppFocus : bagGroup.position);
    if (versus) {
      // ---- 対戦相手(AI)----
      const o = vs.opp;
      playerFocus.set(boxer.pos.x, 0, boxer.pos.y);
      const aiMove = vs.state === 'fight' ? vs.ai.update(real * timeScale, o, boxer) : { x: 0, z: 0 };
      o.aimY = bodyAimY(boxer);
      o.update(real * timeScale, now / 1000 + 0.37, aiMove, playerFocus);
      // ---- パンチの当たり判定(両方向。回避で頭が動いていれば当たらない)----
      if (vs.state === 'fight') {
        const h1 = boxer.checkBodyHit(real * timeScale, o);
        if (h1) landPunch(h1, boxer, o, true);
        const h2 = vs.state === 'fight' ? o.checkBodyHit(real * timeScale, boxer) : null;
        if (h2) landPunch(h2, o, boxer, false);
      } else if (vs.state === 'ko') {
        if (performance.now() - vs.koAt > 1600) { // 倒れてから 1.6 秒(実時間)で結果を出す
          vs.state = 'result';
          const win = vs.hpO <= 0;
          document.getElementById('resultTitle').textContent = win ? 'K.O.  YOU WIN!' : 'K.O.  YOU LOSE';
          resultEl.classList.toggle('lose', !win);
          resultEl.classList.remove('hidden');
        }
      }
    }
    // パンチの当たり判定: グローブがバッグに触れたら、接触点に拳の向きの撃力
    const hit = versus ? null : boxer.checkHit(real * timeScale, sim.bag.translation(), sim.bag.rotation(), cfg.bagRadius, cfg.bagHeight);
    if (hit) {
      sim.hit({ x: hit.point.x, y: hit.point.y, z: hit.point.z },
        { x: hit.dir.x * hit.impulse, y: hit.dir.y * hit.impulse, z: hit.dir.z * hit.impulse });
      spawnHitFx(hit.point, hit.dir, hit.impulse, hit.normal);
      sfx.hit(hit.impulse, hit.kind !== 'jab');
      stats.hits++;
    }
  }
  // カメラと自機の間に入ってきたリングのロープ・ポスト・パッドを、滑らかに半透明にする(当たり判定は変えない)
  if (boxer) {
    camera.updateMatrixWorld();
    boxer.group.updateMatrixWorld(true);
    const pts = [];
    OCC_BONES.forEach((n, i) => { const b = boxer.bones[n]; if (b) { b.getWorldPosition(occPts[i]); pts.push(occPts[i]); } });
    if (boxer.bones.Head) { occHeadTop.copy(occPts[0]); occHeadTop.y += 0.14; pts.push(occHeadTop); }
    arena.fader.update(camera, pts, real, window.innerWidth, window.innerHeight);
  }
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
window.__sandbag = { sim, presetStrike, stats, camera, sfx, arena, vs, startMode, get boxer() { return boxer; }, get mode() { return gameMode; } };
