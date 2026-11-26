import * as THREE from 'three';

// ============================================================
// 旅の冒険者 ― 妖怪迷宮
// ターン制・マス目移動の和風ローグライク(Three.js / ボクセル表現)
// 座標: タイル(x, y) → ワールド(x, 0, y)。y が増えるほど南(画面手前)
// ============================================================

const rnd = n => Math.floor(Math.random() * n);
const rr = (a, b) => a + rnd(b - a + 1);
const pick = a => a[rnd(a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
// 0:北 1:北東 2:東 3:南東 4:南 5:南西 6:西 7:北西
const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
const $ = id => document.getElementById(id);

const MAX_FLOOR = 10;
const INV_MAX = 12;
const MW = 48, MH = 36;
const idx = (x, y) => y * MW + x;
const inMap = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;

// ============================================================
// ボクセルモデル組み立て(箱をまとめて1つのジオメトリに)
// ============================================================
const voxMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _n3 = new THREE.Matrix3();

class Vox {
  constructor(u) { this.u = u; this.pos = []; this.nor = []; this.col = []; }
  // x, z: 中心 / y: 底面(ボクセル単位)
  add(x, y, z, w, h, d, color, r) {
    const u = this.u;
    _e.set(r?.rx || 0, r?.ry || 0, r?.rz || 0);
    _q.setFromEuler(_e);
    _m4.compose(_v.set(x * u, (y + h / 2) * u, z * u), _q, _s.set(w * u, h * u, d * u));
    _n3.getNormalMatrix(_m4);
    const p = unitBox.attributes.position, n = unitBox.attributes.normal;
    _c.set(color);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(_m4); this.pos.push(_v.x, _v.y, _v.z);
      const ny = n.getY(i);
      _v.fromBufferAttribute(n, i).applyMatrix3(_n3).normalize(); this.nor.push(_v.x, _v.y, _v.z);
      const k = ny > 0.5 ? 1.1 : ny < -0.5 ? 0.65 : 1;
      this.col.push(_c.r * k, _c.g * k, _c.b * k);
    }
    return this;
  }
  build(mat = voxMat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, mat);
  }
}

const shadowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
function withShadow(mesh, size = 0.8, scale = ACTOR_SCALE) {
  mesh.scale.setScalar(scale);
  const g = new THREE.Group();
  const sh = new THREE.Mesh(shadowGeo, shadowMat); sh.scale.set(size, 1, size); sh.position.y = 0.01;
  g.add(sh);
  const body = new THREE.Group(); body.add(mesh); g.add(body);
  g.userData.body = body;
  return g;
}

// ---------------- 主人公(デザイン画準拠) ----------------
const VARIANTS = [
  { name: '青', note: '標準', coat: '#2d3c86', trim: '#dfe4f2' },
  { name: '赤', coat: '#a6312b', trim: '#f0e0d4' },
  { name: '緑', coat: '#3f7036', trim: '#e6ecd8' },
  { name: '白', coat: '#dcd8cc', trim: '#6c78a8' },
  { name: '黒', coat: '#4a2c6c', trim: '#ddd4ec' },
];

function buildPlayerMesh(variant) {
  const V = new Vox(0.045);
  const C = {
    hair: '#1d1a27', hair2: '#2c2838', skin: '#f1c08c', red: '#c0362c', redD: '#8e2620',
    coat: variant.coat, trim: variant.trim, hakama: '#cdb68c', hakamaD: '#a8916a', leg: '#24222c', band: '#e8e2d4',
    geta: '#7a5232', pack: '#7b5530', packD: '#5e3f22', roll: '#dcc59c', rollD: '#b89f74', gourd: '#c9963f',
    sheath: '#2a2230', tsuba: '#c9a23a', hilt: '#3a2e4a', eye: '#141018', strap: '#8a5a2c',
  };
  // 足(下駄)・脚絆
  for (const s of [-1, 1]) {
    V.add(2 * s, 0, 0.6, 3, 1, 5, C.geta);
    V.add(2 * s, 1, 1.6, 3.1, 0.6, 1, '#1a1a1a');
    V.add(2 * s, 1, 0, 3, 4, 3, C.leg);
    V.add(2 * s, 2.4, 0, 3.2, 0.8, 3.2, C.band);
  }
  // 袴
  V.add(0, 5, 0, 9, 4, 6, C.hakama);
  V.add(-2.4, 4, 0, 4.4, 1.6, 6.4, C.hakama);
  V.add(2.4, 4, 0, 4.4, 1.6, 6.4, C.hakama);
  V.add(0, 4.2, 3.22, 0.5, 4.8, 0.1, C.hakamaD);
  // 帯
  V.add(0, 9, 0, 9.2, 1.6, 6.2, C.red);
  V.add(0, 8.7, 3.2, 2.2, 2, 0.7, '#d8b878');
  // 胴(羽織)
  V.add(0, 10.6, 0, 8.6, 5, 5.6, C.coat);
  V.add(0, 12.2, 2.85, 2.2, 3.4, 0.2, '#1c1c28');
  V.add(0.4, 12, 2.95, 1, 8.4, 0.35, C.strap, { rz: 0.75 }); // たすき掛けの紐
  // 袖(市松模様の縁)
  for (const s of [-1, 1]) {
    V.add(5.6 * s, 10.4, 0, 3.2, 5, 5.4, C.coat);
    V.add(5.6 * s, 10, 0, 3.4, 1.4, 5.6, C.trim);
    for (let k = -2; k <= 2; k += 2) V.add(5.6 * s, 10.7, k, 3.5, 0.7, 0.9, C.coat);
    V.add(5.6 * s, 8.9, 0.5, 2.6, 1.2, 2.6, C.leg);
    V.add(5.6 * s, 7.4, 0.5, 2.4, 1.8, 2.4, C.skin);
  }
  // 襟巻き(赤いマフラー)
  V.add(0, 15.2, 0, 9.6, 2.4, 6.8, C.red);
  V.add(-2.6, 9.6, -3.7, 2.6, 6, 1, C.red);
  V.add(-3.6, 7.6, -4.2, 2.4, 3, 1, C.redD, { rz: 0.25 });
  // 頭
  V.add(0, 17, 0, 8, 7, 7, C.skin);
  for (const s of [-1, 1]) {
    V.add(1.8 * s, 18.8, 3.52, 1.3, 2.2, 0.1, C.eye);
    V.add(1.9 * s, 21.4, 3.52, 2.2, 0.6, 0.1, C.hair, { rz: 0.28 * s });
  }
  V.add(0, 17.8, 3.52, 1.2, 0.4, 0.1, '#8a3b2a');
  // 髪
  V.add(0, 23, 0, 9, 2.5, 8, C.hair);
  V.add(0, 17.5, -3.5, 9, 6.5, 1.6, C.hair);
  for (const s of [-1, 1]) V.add(4.3 * s, 18.5, -0.5, 1, 5.5, 6, C.hair);
  V.add(-2.6, 21.8, 3.4, 3, 2, 1.2, C.hair);
  V.add(0.4, 21.2, 3.4, 2.4, 2.8, 1.2, C.hair);
  V.add(3, 22, 3.4, 2.4, 1.8, 1.2, C.hair);
  V.add(-3.2, 24.6, 1, 3, 2.6, 3, C.hair, { rz: 0.45 });
  V.add(0, 25, 0.5, 3.2, 3, 3, C.hair2);
  V.add(3.2, 24.6, -1, 3, 2.6, 3, C.hair, { rz: -0.45 });
  V.add(-1, 24.6, -2.5, 3, 2.6, 3, C.hair2, { rx: -0.3 });
  // 髷と赤い髪紐
  V.add(0, 22.6, -5, 3, 3, 3, C.hair);
  V.add(0, 22.4, -3.9, 3.4, 1.4, 1.4, C.red);
  V.add(-1, 19.8, -4.9, 1, 3.2, 0.6, C.red, { rz: 0.3 });
  V.add(1, 20.2, -4.9, 1, 2.6, 0.6, C.red, { rz: -0.3 });
  V.add(0, 24.4, -6.4, 3, 3, 3, C.hair2, { rx: -0.6 });
  V.add(-1.4, 25.4, -5.6, 2, 2.4, 2, C.hair, { rz: 0.5 });
  // 背負い袋と寝ござ
  V.add(0, 9, -4.4, 7, 7, 3, C.pack);
  V.add(0, 14, -4.5, 7.2, 1.8, 3.2, C.packD);
  V.add(0, 15.6, -4.4, 11.4, 3.4, 3.4, C.roll);
  for (const s of [-1, 1]) {
    V.add(5.75 * s, 15.8, -4.4, 0.2, 3, 3, C.rollD);
    V.add(5.86 * s, 16.8, -4.4, 0.1, 1, 1, '#8d7650');
    V.add(2.6 * s, 15.5, -4.4, 0.8, 3.6, 3.6, C.packD);
  }
  // 腰の瓢箪(右腰 = -x)
  V.add(-3.6, 5.6, 3, 2.4, 2.4, 2.4, C.gourd);
  V.add(-3.6, 8, 3, 1.6, 1.4, 1.6, C.gourd);
  V.add(-3.6, 9.4, 3, 0.8, 0.6, 0.8, '#6b4423');
  V.add(-3.6, 7.8, 3, 1.8, 0.4, 1.8, C.red);
  // 刀(左腰 = +x、柄が前上がり)
  const a = -0.38, dy = Math.sin(-a), dz = Math.cos(-a);
  const sc = { x: 5, y: 9.5, z: -1 };
  V.add(sc.x, sc.y - 0.6, sc.z, 1.2, 1.2, 13, C.sheath, { rx: a });
  const t = 6.8; V.add(sc.x, sc.y + dy * t - 1.1, sc.z + dz * t, 2.6, 2.2, 0.6, C.tsuba, { rx: a });
  const h = 9.6; V.add(sc.x, sc.y + dy * h - 0.65, sc.z + dz * h, 1.3, 1.3, 5, C.hilt, { rx: a });
  for (let k = 0; k < 3; k++) { const hh = 8 + k * 1.6; V.add(sc.x, sc.y + dy * hh - 0.75, sc.z + dz * hh, 1.4, 1.5, 0.5, '#cfc6b0', { rx: a }); }
  return V.build();
}

// ---------------- 妖怪たち ----------------
function buildOnibi() {
  const V = new Vox(0.05);
  V.add(0, 0, 0, 5.5, 5, 5.5, '#4aa0ff');
  V.add(0, 5, 0, 4, 3, 4, '#7cc4ff');
  V.add(0.5, 8, -0.3, 2.4, 2.4, 2.4, '#b8e4ff');
  V.add(-0.4, 10.2, -0.6, 1.2, 1.6, 1.2, '#e8f8ff');
  V.add(1.6, 6.4, 1, 1.2, 1.6, 1.2, '#9fd8ff');
  for (const s of [-1, 1]) V.add(1.2 * s, 2.2, 2.8, 1, 1.6, 0.2, '#0d2240');
  V.add(0, 1, 2.8, 1.6, 0.6, 0.2, '#0d2240');
  return V.build(glowMat);
}
function buildHitotsume() {
  const V = new Vox(0.045);
  for (const s of [-1, 1]) { V.add(1.6 * s, 0, 0.5, 2.4, 1, 3.6, '#7a5232'); V.add(1.6 * s, 1, 0, 2, 2, 2, '#f0c49a'); }
  V.add(0, 3, 0, 7, 6, 5, '#8c7da0');
  V.add(0, 5.5, 0, 7.2, 1, 5.2, '#d8c07a');
  for (const s of [-1, 1]) { V.add(4.2 * s, 5, 0, 2.4, 4, 4, '#8c7da0'); V.add(4.2 * s, 4, 0.8, 1.6, 1.4, 1.6, '#f0c49a'); }
  V.add(0, 9, 0, 8, 7.5, 7, '#f2c8a0');
  V.add(0, 12, 3.55, 3.8, 3.2, 0.2, '#ffffff');
  V.add(0, 12.4, 3.67, 1.6, 2, 0.1, '#111111');
  V.add(0, 15.6, 3.55, 3.6, 0.6, 0.2, '#6b4a3a');
  V.add(0, 9.6, 3.6, 1.8, 1.4, 0.8, '#e05a6a');
  V.add(0, 16.5, 0, 6, 0.5, 5, '#e6b48e');
  return V.build();
}
function buildKappa() {
  const V = new Vox(0.048);
  for (const s of [-1, 1]) { V.add(1.8 * s, 0, 0.6, 2.4, 1, 3, '#3e7a3a'); V.add(4.2 * s, 3, 0.5, 1.6, 4, 1.6, '#4f9a48'); }
  V.add(0, 1, 0, 7, 6, 5, '#4f9a48');
  V.add(0, 1.6, 2.55, 4.6, 4, 0.2, '#c7d58a');
  V.add(0, 1.4, -3, 7.4, 6, 1.8, '#6b5a2e');
  V.add(0, 3.4, -3.95, 4, 2, 0.2, '#8a7640');
  V.add(0, 7, 0, 7, 6, 6, '#5aa852');
  V.add(0, 8, 3.5, 3.6, 1.6, 1.8, '#e0b43c');
  for (const s of [-1, 1]) { V.add(1.8 * s, 10, 3.05, 1.4, 1.6, 0.2, '#ffffff'); V.add(1.8 * s, 10.3, 3.16, 0.7, 0.9, 0.1, '#111'); }
  V.add(0, 12.4, 0, 7.6, 1.6, 6.6, '#24361f');
  V.add(0, 13, 0, 5, 0.8, 4.4, '#d8e8e4');
  return V.build();
}
function buildKarakasa() {
  const V = new Vox(0.05);
  V.add(0, 0, 0.5, 2.6, 1, 4, '#7a5232');
  V.add(0, 1, 0, 1.6, 6, 1.6, '#e9c8a8');
  V.add(0, 7, 0, 12, 2, 12, '#a8302a');
  V.add(0, 9, 0, 9, 2.5, 9, '#c4423a');
  V.add(0, 11.5, 0, 6, 2.5, 6, '#a8302a');
  V.add(0, 14, 0, 3, 2, 3, '#d8c07a');
  V.add(0, 16, 0, 1, 2, 1, '#5a3a22');
  V.add(0, 8.9, 0, 12.3, 0.25, 0.8, '#ecd8a0');
  V.add(0, 8.9, 0, 0.8, 0.25, 12.3, '#ecd8a0');
  V.add(0, 9.4, 4.55, 3.2, 2.8, 0.2, '#ffffff');
  V.add(0, 9.8, 4.66, 1.4, 1.8, 0.1, '#111');
  V.add(0, 6.4, 6.2, 2, 0.6, 1.4, '#e05a6a');
  V.add(0, 4.6, 6.8, 2, 2.2, 0.5, '#e05a6a');
  return V.build();
}
function buildTengu() {
  const V = new Vox(0.048);
  for (const s of [-1, 1]) { V.add(1.8 * s, 0, 0.5, 2.4, 0.6, 4, '#3a2a1a'); V.add(1.8 * s, 0.6, 0.5, 0.8, 1, 3, '#3a2a1a'); }
  V.add(0, 1.6, 0, 7, 5, 5, '#e8e4d8');
  V.add(0, 6.5, 0, 8, 5, 5.4, '#2f6f6a');
  for (const s of [-1, 1]) {
    V.add(1.6 * s, 9, 2.75, 1.4, 1.4, 0.6, '#f4f0e4');
    V.add(5.8 * s, 5.5, -2.6, 3.2, 8.5, 1.2, '#1c1c24', { rz: 0.3 * s });
    V.add(5 * s, 6.5, 0.5, 2, 4.5, 2, '#2f6f6a'); V.add(5 * s, 5.4, 0.5, 1.8, 1.4, 1.8, '#c8423a');
  }
  V.add(-5, 6.4, 2, 0.4, 5.5, 3.4, '#4a7a3a');
  V.add(0, 11.5, 0, 7, 6.5, 6, '#c8423a');
  V.add(0, 13.2, 4.6, 1.6, 1.6, 4.6, '#d8524a');
  for (const s of [-1, 1]) { V.add(2 * s, 14.6, 3.05, 1.4, 0.8, 0.2, '#fff'); V.add(2 * s, 15.6, 3.05, 2.2, 0.6, 0.2, '#f0f0f0', { rz: -0.3 * s }); V.add(3.7 * s, 12, -1, 0.8, 5, 5, '#ececec'); }
  V.add(0, 10.2, 3.1, 5, 2.4, 0.4, '#f0f0f0');
  V.add(0, 11, -3.2, 7.4, 6, 0.8, '#ececec');
  V.add(0, 18, 0.8, 2.6, 1.8, 2.6, '#111');
  return V.build();
}
function buildOni(skin, u = 0.056) {
  const V = new Vox(u);
  for (const s of [-1, 1]) V.add(2 * s, 0, 0, 3, 5, 3.4, skin);
  V.add(0, 4, 0, 8.4, 4, 5.4, '#e2b23a');
  for (const k of [-2.6, 0, 2.6]) V.add(k, 4.6, 2.72, 0.8, 3, 0.2, '#222');
  V.add(0, 8, 0, 9, 6, 6, skin);
  for (const s of [-1, 1]) V.add(5.8 * s, 7.5, 0, 2.6, 6, 2.6, skin);
  V.add(-6.4, 3, 2.2, 2.2, 13, 2.2, '#5c5c68', { rx: 0.3 });
  for (let k = 0; k < 3; k++) V.add(-6.4, 9 + k * 2.2, 4.3 + k * 0.6, 2.8, 0.8, 2.8, '#888896', { rx: 0.3 });
  V.add(0, 14, 0, 8, 7, 7, skin);
  V.add(0, 20.4, -0.5, 9, 2, 7.6, '#1a1a1a');
  for (const s of [-1, 1]) {
    V.add(4.4 * s, 15, -1, 1, 6, 6, '#1a1a1a');
    V.add(2.2 * s, 21.4, 1, 1.4, 3.2, 1.4, '#efe2b0', { rz: -0.25 * s });
    V.add(1.8 * s, 17.4, 3.55, 1.8, 1.4, 0.2, '#ffe14a');
    V.add(1.8 * s, 17.6, 3.66, 0.8, 0.8, 0.1, '#111');
    V.add(1.9 * s, 18.9, 3.6, 2.4, 0.7, 0.2, '#1a1a1a', { rz: 0.35 * s });
    V.add(1.3 * s, 15.6, 3.7, 0.7, 1, 0.1, '#fff');
  }
  V.add(0, 15, 3.55, 4, 1.4, 0.2, '#5a1010');
  return V.build();
}

// ---------------- 道具・階段 ----------------
function buildItemMesh(def) {
  const V = new Vox(0.04);
  switch (def.model) {
    case 'onigiri': {
      const s = def.food > 60 ? 1.35 : 1;
      V.add(0, 0, 0, 6 * s, 2 * s, 3, '#f4f1e8'); V.add(0, 2 * s, 0, 4.4 * s, 2 * s, 3, '#f4f1e8'); V.add(0, 4 * s, 0, 2.4 * s, 1.6 * s, 3, '#f4f1e8');
      V.add(0, -0.01, 0, 3 * s, 2.6 * s, 3.2, '#1f2e22'); break;
    }
    case 'herb':
      V.add(0, 0, 0, 1, 4, 1, '#3a6a2a'); V.add(-1.5, 2, 0, 3, 1.4, 1.4, '#5aa84a', { rz: 0.5 }); V.add(1.5, 3, 0, 3, 1.4, 1.4, '#5aa84a', { rz: -0.5 }); V.add(0, 4, 0, 1.8, 2, 1.8, '#6ac85a'); break;
    case 'elixir':
      V.add(0, 0, 0, 3, 3.4, 3, '#7ab8e8'); V.add(0, 3.4, 0, 1.4, 1, 1.4, '#7ab8e8'); V.add(0, 4.4, 0, 1.6, 0.8, 1.6, '#a8804a'); V.add(0, 1, 1.55, 2, 1.4, 0.1, '#f4e8c8'); break;
    case 'gourd':
      V.add(0, 0, 0, 3.4, 3, 3.4, '#c9963f'); V.add(0, 3, 0, 2.2, 2, 2.2, '#c9963f'); V.add(0, 5, 0, 1, 0.8, 1, '#7a5232'); V.add(0, 2.8, 0, 2.8, 0.5, 2.8, '#c0362c'); break;
    case 'scroll':
      V.add(0, 0, 0, 6, 1.8, 1.8, '#efe2bc'); V.add(-3.1, -0.1, 0, 0.4, 2, 2, '#8a5a2c'); V.add(3.1, -0.1, 0, 0.4, 2, 2, '#8a5a2c'); V.add(0, -0.05, 0, 1, 1.9, 1.9, def.color); break;
    case 'shuriken':
      for (const ry of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) V.add(0, 0.5, 0, ry % (Math.PI / 2) ? 3.6 : 5.4, 0.4, 1.2, '#a4aab4', { ry });
      V.add(0, 0.45, 0, 1, 0.5, 1, '#555'); break;
    case 'sword':
      V.add(0, 0.5, 2.5, 1, 0.6, 9, def.color || '#cfd6de'); V.add(0, 0.2, -2.2, 2.6, 1.2, 0.5, '#c9a23a'); V.add(0, 0.4, -4.4, 1.1, 0.8, 3.8, '#3a2e4a'); break;
    case 'hat': {
      const c = def.color;
      V.add(0, 0, 0, 8, 1, 8, c); V.add(0, 1, 0, 5.6, 1, 5.6, c); V.add(0, 2, 0, 3.2, 1, 3.2, c); V.add(0, 3, 0, 1.2, 0.8, 1.2, '#3a2a1a');
      if (def.horns) { V.add(-2.6, 2, 0, 1, 3.4, 1, '#e0b84a', { rz: 0.5 }); V.add(2.6, 2, 0, 1, 3.4, 1, '#e0b84a', { rz: -0.5 }); }
      break;
    }
    case 'coins':
      V.add(-1, 0, 0, 2.6, 0.6, 2.6, '#e8c040'); V.add(-0.8, 0.6, 0.2, 2.6, 0.6, 2.6, '#f0cc50'); V.add(1.6, 0, 0.8, 2.6, 0.6, 2.6, '#e0b838'); V.add(-0.9, 1.2, 0, 2.6, 0.6, 2.6, '#e8c040'); break;
    case 'orb':
      V.add(0, 0, 0, 5, 1, 5, '#c9a23a'); V.add(0, 1, 0, 4, 4, 4, '#7ae0ff'); V.add(0, 1.6, 0, 4.6, 2.8, 2.8, '#7ae0ff'); V.add(0, 1.6, 0, 2.8, 2.8, 4.6, '#7ae0ff');
      return V.build(glowMat);
  }
  return V.build();
}
function buildStairs(theme) {
  const V = new Vox(0.05);
  const wood = theme.stairWood;
  V.add(0, -12, 0, 18, 1, 18, '#050408');
  V.add(0, -12, -8.5, 18, 12, 1, '#141016'); V.add(0, -12, 8.5, 18, 12, 1, '#141016');
  V.add(-8.5, -12, 0, 1, 12, 18, '#100c12'); V.add(8.5, -12, 0, 1, 12, 18, '#100c12');
  for (let k = 0; k < 4; k++) V.add(0, -2.5 - k * 2.6, 5.5 - k * 3.6, 15, 1, 3.6, k % 2 ? '#7a5a38' : wood);
  V.add(0, -1, 9.5, 20, 1, 1, '#4a3420'); V.add(0, -1, -9.5, 20, 1, 1, '#4a3420');
  V.add(-9.5, -1, 0, 1, 1, 20, '#4a3420'); V.add(9.5, -1, 0, 1, 1, 20, '#4a3420');
  return V.build();
}

// ============================================================
// データ
// ============================================================
const ITEMS = {
  onigiri: { name: 'おにぎり', icon: '🍙', kind: 'food', food: 50, model: 'onigiri', desc: '満腹度が 50% 回復する。' },
  bigOnigiri: { name: '大きなおにぎり', icon: '🍙', kind: 'food', food: 100, model: 'onigiri', desc: '満腹度が 100% 回復する。' },
  herb: { name: '薬草', icon: '🌿', kind: 'heal', heal: 30, model: 'herb', desc: 'HP を 30 回復する。' },
  elixir: { name: '霊薬', icon: '🧪', kind: 'heal', heal: 999, maxUp: 5, model: 'elixir', desc: 'HP が全回復し、最大HPが 5 増える。' },
  gourd: { name: '水筒', icon: '🫗', kind: 'gourd', heal: 18, model: 'gourd', desc: '一口飲むと HP 18 回復。中身がある限り何度でも。' },
  fireScroll: { name: '火遁の巻物', icon: '📜', kind: 'scroll', effect: 'fire', model: 'scroll', color: '#d8402c', desc: '見えている妖怪すべてに炎で 25 ダメージ。' },
  sleepScroll: { name: '金縛りの巻物', icon: '📜', kind: 'scroll', effect: 'sleep', model: 'scroll', color: '#6a5ac8', desc: '見えている妖怪すべてを 10 ターン動けなくする。' },
  mapScroll: { name: '千里眼の巻物', icon: '📜', kind: 'scroll', effect: 'map', model: 'scroll', color: '#3a9a5a', desc: 'この階の地形と階段・道具の位置がわかる。' },
  shuriken: { name: '手裏剣', icon: '✴️', kind: 'throw', dmg: 10, model: 'shuriken', desc: '向いている方向(近くに妖怪がいればそちら)へ投げる。10 ダメージ。' },
  tabigatana: { name: '旅の刀', icon: '🗡️', kind: 'weapon', atk: 2, model: 'sword', desc: '攻撃 +2。使い慣れた刀。' },
  wakizashi: { name: '脇差', icon: '🗡️', kind: 'weapon', atk: 4, model: 'sword', color: '#e0e6ee', desc: '攻撃 +4。' },
  uchigatana: { name: '打刀', icon: '🗡️', kind: 'weapon', atk: 7, model: 'sword', color: '#f0f4f8', desc: '攻撃 +7。' },
  meito: { name: '名刀「朧月」', icon: '🗡️', kind: 'weapon', atk: 11, model: 'sword', color: '#bfe6ff', desc: '攻撃 +11。月の光を宿す刃。' },
  tabigasa: { name: '旅笠', icon: '👒', kind: 'hat', def: 1, model: 'hat', color: '#d8b45a', desc: '防御 +1。' },
  tetsugasa: { name: '鉄笠', icon: '👒', kind: 'hat', def: 3, model: 'hat', color: '#8a8e98', desc: '防御 +3。' },
  jingasa: { name: '陣笠', icon: '👒', kind: 'hat', def: 5, model: 'hat', color: '#2a2228', desc: '防御 +5。' },
  onikabuto: { name: '鬼面の兜', icon: '⛑️', kind: 'hat', def: 8, model: 'hat', color: '#5a1e22', horns: true, desc: '防御 +8。' },
  coins: { name: '銭', icon: '🪙', kind: 'coins', model: 'coins' },
  orb: { name: '龍の宝玉', icon: '🔮', kind: 'treasure', model: 'orb', desc: '迷宮の最奥に眠る秘宝。' },
};
// [種類, 重み, 出現する最低階, 最高階]
const ITEM_TABLE = [
  ['onigiri', 14, 1, 10], ['bigOnigiri', 3, 3, 10], ['herb', 14, 1, 10], ['elixir', 3, 4, 10], ['gourd', 2, 2, 10],
  ['fireScroll', 6, 1, 10], ['sleepScroll', 5, 2, 10], ['mapScroll', 6, 1, 10], ['shuriken', 9, 1, 10],
  ['wakizashi', 4, 1, 5], ['uchigatana', 3, 4, 10], ['meito', 1, 7, 10],
  ['tetsugasa', 4, 2, 7], ['jingasa', 3, 5, 10], ['onikabuto', 1, 8, 10],
  ['coins', 16, 1, 10],
];

const ENEMIES = {
  onibi: { name: '鬼火', hp: 7, atk: 3, def: 0, exp: 3, floors: [1, 3], build: buildOnibi, float: 0.35, shadow: 0.5 },
  hitotsume: { name: '一つ目小僧', hp: 11, atk: 4, def: 1, exp: 5, floors: [1, 4], build: buildHitotsume },
  kappa: { name: '河童', hp: 17, atk: 6, def: 2, exp: 9, floors: [2, 6], build: buildKappa },
  karakasa: { name: '唐傘おばけ', hp: 20, atk: 8, def: 2, exp: 13, floors: [3, 7], build: buildKarakasa, hop: true },
  tengu: { name: '天狗', hp: 26, atk: 9, def: 3, exp: 22, floors: [5, 9], build: buildTengu, speed: 2 },
  akaoni: { name: '赤鬼', hp: 42, atk: 13, def: 5, exp: 38, floors: [6, 10], build: () => buildOni('#c8433a'), shadow: 1 },
  boss: { name: '鬼の大将', hp: 120, atk: 16, def: 7, exp: 200, floors: [99, 99], build: () => buildOni('#3f62b8', 0.075), shadow: 1.3, boss: true },
};

const THEMES = [
  { name: '竹林の洞', floorA: '#5d6b4a', floorB: '#56633f', corr: '#4a4536', wall: '#34502c', cap: '#5a7e3e', bg: '#0e120d', stairWood: '#8a6a44', light: 0xd8f0c0 },
  { name: '古寺の回廊', floorA: '#bba868', floorB: '#ae9b5c', corr: '#6e4e30', wall: '#d6cbb2', cap: '#4a3020', bg: '#120e0a', stairWood: '#8a6a44', light: 0xffe0b0 },
  { name: '鬼ヶ砦', floorA: '#4d4650', floorB: '#45404a', corr: '#38303a', wall: '#6a2c2a', cap: '#2a2026', bg: '#120809', stairWood: '#6a5040', light: 0xffb890 },
  { name: '奥の院', floorA: '#3e3754', floorB: '#37314c', corr: '#2c2640', wall: '#2a2340', cap: '#8a7032', bg: '#0a0812', stairWood: '#7a6a50', light: 0xc8c0ff },
];
const themeFor = f => f <= 3 ? THEMES[0] : f <= 6 ? THEMES[1] : f <= 9 ? THEMES[2] : THEMES[3];

// ============================================================
// three.js 基本
// ============================================================
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#14111a');
scene.fog = new THREE.Fog('#14111a', 18, 40);
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
const hemi = new THREE.HemisphereLight(0xfff4e0, 0x302838, 1.6); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 1.5); sun.position.set(-4, 10, 6); scene.add(sun); scene.add(sun.target);
const lantern = new THREE.PointLight(0xffc880, 6, 7, 1.4); scene.add(lantern);

let camDist = 14, camElev = 52 * Math.PI / 180;
const ACTOR_SCALE = 1.3;
const ZOOMS = [7, 10, 14];
const camTarget = new THREE.Vector3();
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
function desiredCamDist() {
  const tiles = ZOOMS[ui.zoom];
  const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
  const hf = Math.atan(Math.tan(vf) * camera.aspect);
  const dW = (tiles / 2) / Math.tan(hf);
  const dH = (tiles * 0.62) / Math.tan(vf);
  return Math.max(dW, dH) + 2;
}

// ============================================================
// 迷宮生成
// ============================================================
function genMap(floor) {
  const tiles = new Uint8Array(MW * MH); // 0:壁 1:部屋 2:通路
  const roomId = new Int16Array(MW * MH).fill(-1);
  const rooms = [], cells = [];
  const GX = 3, GY = 3, SW = 16, SH = 12;
  let dummies = 0;
  for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
    const sx = gx * SW, sy = gy * SH;
    if (dummies < 2 && Math.random() < 0.2) {
      dummies++;
      const px = rr(sx + 3, sx + SW - 4), py = rr(sy + 3, sy + SH - 4);
      tiles[idx(px, py)] = 2;
      cells.push({ x1: px, y1: py, x2: px, y2: py, dummy: true });
    } else {
      const w = rr(5, 11), h = rr(4, 8);
      const x1 = rr(sx + 2, sx + SW - 2 - w), y1 = rr(sy + 2, sy + SH - 2 - h);
      const r = { x1, y1, x2: x1 + w - 1, y2: y1 + h - 1, id: rooms.length };
      rooms.push(r); cells.push(r);
      for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) { tiles[idx(x, y)] = 1; roomId[idx(x, y)] = r.id; }
    }
  }
  // 隣接セル同士を全域木+αでつなぐ
  const edges = [];
  for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
    if (gx < GX - 1) edges.push([gy * GX + gx, gy * GX + gx + 1, 'h']);
    if (gy < GY - 1) edges.push([gy * GX + gx, (gy + 1) * GX + gx, 'v']);
  }
  edges.sort(() => Math.random() - 0.5);
  const par = cells.map((_, i) => i);
  const find = i => par[i] === i ? i : (par[i] = find(par[i]));
  const used = [];
  for (const e of edges) { const a = find(e[0]), b = find(e[1]); if (a !== b) { par[a] = b; used.push(e); } }
  const extra = edges.filter(e => !used.includes(e));
  for (let k = 0; k < 2 && extra.length; k++) used.push(extra.splice(rnd(extra.length), 1)[0]);
  const dig = (x, y) => { if (tiles[idx(x, y)] === 0) tiles[idx(x, y)] = 2; };
  for (const [ia, ib, o] of used) {
    const A = cells[ia], B = cells[ib];
    if (o === 'h') {
      const ya = rr(A.y1, A.y2), yb = rr(B.y1, B.y2);
      const ax = A.dummy ? A.x1 : A.x2 + 1, bx = B.dummy ? B.x1 : B.x1 - 1;
      const mx = bx - ax >= 2 ? rr(ax + 1, bx - 1) : rr(ax, bx);
      for (let x = ax; x <= mx; x++) dig(x, ya);
      for (let y = Math.min(ya, yb); y <= Math.max(ya, yb); y++) dig(mx, y);
      for (let x = mx; x <= bx; x++) dig(x, yb);
    } else {
      const xa = rr(A.x1, A.x2), xb = rr(B.x1, B.x2);
      const ay = A.dummy ? A.y1 : A.y2 + 1, by = B.dummy ? B.y1 : B.y1 - 1;
      const my = by - ay >= 2 ? rr(ay + 1, by - 1) : rr(ay, by);
      for (let y = ay; y <= my; y++) dig(xa, y);
      for (let x = Math.min(xa, xb); x <= Math.max(xa, xb); x++) dig(x, my);
      for (let y = my; y <= by; y++) dig(xb, y);
    }
  }
  return { tiles, roomId, rooms, explored: new Uint8Array(MW * MH), vis: new Uint8Array(MW * MH), stairs: null, floor };
}

// ============================================================
// ゲーム状態
// ============================================================
let G = null;
const ui = { mode: 'title', variant: 0, zoom: 0, invSel: 0, turnOnly: false, mapBig: false };
let level = null; // 現在階の描画オブジェクト

function newItem(type, n) {
  const d = ITEMS[type];
  const it = { type, n: n ?? 1 };
  if (type === 'shuriken') it.n = n ?? rr(3, 7);
  if (type === 'gourd') it.n = n ?? rr(2, 4);
  if (type === 'coins') it.n = n ?? rr(10, 30) * (1 + Math.floor((G?.floor ?? 1) / 3));
  return it;
}
function itemLabel(it) {
  const d = ITEMS[it.type];
  if (it.type === 'shuriken') return `${d.name} ×${it.n}`;
  if (it.type === 'gourd') return `${d.name} [残り${it.n}]`;
  return d.name;
}

function newGame() {
  G = {
    floor: 1, turn: 0, over: false,
    p: {
      x: 0, y: 0, hp: 30, maxHp: 30, lv: 1, exp: 0, baseAtk: 3, hunger: 100, gold: 0, regen: 0,
      face: 4, inv: [], weapon: null, hat: null, kills: 0,
    },
    enemies: [], items: [], map: null,
  };
  const p = G.p;
  const sword = newItem('tabigatana'), hat = newItem('tabigasa');
  p.inv.push(sword, hat, newItem('onigiri'), newItem('gourd', 3), newItem('herb'));
  p.weapon = sword; p.hat = hat;
  logClear();
  if (!playerObj) { playerObj = withShadow(buildPlayerMesh(VARIANTS[ui.variant]), 0.85); scene.add(playerObj); }
  enterFloor(1, true);
  log('名もなき冒険者は、妖怪迷宮へ足を踏み入れた。', 'sys');
}

const pAtk = () => G.p.baseAtk + G.p.lv - 1 + (G.p.weapon ? ITEMS[G.p.weapon.type].atk : 0);
const pDef = () => (G.p.hat ? ITEMS[G.p.hat.type].def : 0) + Math.floor((G.p.lv - 1) / 3);
const expNeed = lv => Math.floor(8 * Math.pow(lv, 1.75));

function isWalk(x, y) { return inMap(x, y) && G.map.tiles[idx(x, y)] !== 0; }
function enemyAt(x, y) { return G.enemies.find(e => e.alive && e.x === x && e.y === y); }
function itemAt(x, y) { return G.items.find(i => i.x === x && i.y === y); }
function canStep(x, y, dx, dy) {
  // 斜め移動は角をすり抜けられない
  if (!isWalk(x + dx, y + dy)) return false;
  if (dx && dy && (!isWalk(x + dx, y) || !isWalk(x, y + dy))) return false;
  return true;
}
function randomRoomTile(exclude = -1, tries = 200) {
  const M = G.map;
  for (let t = 0; t < tries; t++) {
    const r = pick(M.rooms);
    if (r.id === exclude && M.rooms.length > 1) continue;
    const x = rr(r.x1, r.x2), y = rr(r.y1, r.y2);
    if (M.stairs && M.stairs.x === x && M.stairs.y === y) continue;
    if (enemyAt(x, y) || itemAt(x, y) || (G.p.x === x && G.p.y === y)) continue;
    return { x, y, room: r.id };
  }
  return null;
}
function rollItemType(floor) {
  const list = ITEM_TABLE.filter(t => floor >= t[2] && floor <= t[3]);
  let total = list.reduce((s, t) => s + t[1], 0), r = Math.random() * total;
  for (const t of list) { if ((r -= t[1]) < 0) return t[0]; }
  return 'onigiri';
}
function rollEnemyType(floor) {
  const list = Object.entries(ENEMIES).filter(([, d]) => floor >= d.floors[0] && floor <= d.floors[1]);
  // 深い階ほど強い妖怪が出やすい
  const w = list.map(([, d]) => 1 + Math.max(0, floor - d.floors[0]) * 0.3 + (floor > d.floors[1] - 1 ? -0.3 : 0));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) if ((r -= w[i]) < 0) return list[i][0];
  return list[0][0];
}

function spawnEnemy(type, x, y, asleep) {
  const d = ENEMIES[type];
  const mesh = d.build();
  const obj = withShadow(mesh, d.shadow ?? 0.75);
  if (d.float) obj.userData.body.position.y = d.float;
  obj.position.set(x, 0, y);
  level.group.add(obj);
  const e = { type, d, x, y, hp: d.hp, maxHp: d.hp, alive: true, sleep: asleep ? 999 : 0, aware: false, lost: 0, target: null, obj, anim: newAnim(x, y), seen: false, acc: 0 };
  G.enemies.push(e);
  return e;
}
function placeItem(it, x, y) {
  const d = ITEMS[it.type];
  const obj = withShadow(buildItemMesh(d), 0.5, 1.5);
  if (d.model === 'sword') obj.userData.body.rotation.y = 0.7;
  obj.position.set(x, 0, y);
  obj.userData.spin = Math.random() * 6;
  level.group.add(obj);
  const fi = { it, x, y, obj };
  G.items.push(fi);
  return fi;
}
function removeFloorItem(fi) {
  G.items.splice(G.items.indexOf(fi), 1);
  level.group.remove(fi.obj);
  fi.obj.userData.body.children[0].geometry.dispose();
}

function enterFloor(floor, first) {
  G.floor = floor;
  // 前の階を片付け
  if (level) {
    scene.remove(level.group);
    level.group.traverse(o => { if (o.geometry && o.geometry !== shadowGeo) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
  }
  G.enemies = []; G.items = [];
  G.map = genMap(floor);
  const M = G.map, theme = themeFor(floor);
  level = { group: new THREE.Group(), theme };
  scene.add(level.group);
  scene.background.set(theme.bg); scene.fog.color.set(theme.bg);
  lantern.color.setHex(theme.light);

  // プレイヤー・階段
  const start = randomRoomTile();
  G.p.x = start.x; G.p.y = start.y;
  const st = randomRoomTile(M.rooms.length > 2 ? start.room : -1);
  M.stairs = floor < MAX_FLOOR ? { x: st.x, y: st.y } : null;

  buildLevelMeshes();

  // 道具
  const nItems = rr(5, 8) + (floor === MAX_FLOOR ? 3 : 0);
  for (let i = 0; i < nItems; i++) { const t = randomRoomTile(); if (t) placeItem(newItem(rollItemType(floor)), t.x, t.y); }
  // 妖怪
  const nEn = 4 + Math.floor(floor / 2);
  for (let i = 0; i < nEn; i++) { const t = randomRoomTile(start.room); if (t) spawnEnemy(rollEnemyType(floor), t.x, t.y, Math.random() < 0.35); }
  // 最下層: 宝玉と鬼の大将
  if (floor === MAX_FLOOR) {
    const far = M.rooms.filter(r => r.id !== start.room).sort((a, b) =>
      cheb((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, start.x, start.y) - cheb((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2, start.x, start.y))[0] || M.rooms[0];
    const ox = Math.floor((far.x1 + far.x2) / 2), oy = Math.floor((far.y1 + far.y2) / 2);
    const old = itemAt(ox, oy); if (old) removeFloorItem(old);
    const oe = enemyAt(ox, oy); if (oe) { oe.alive = false; level.group.remove(oe.obj); }
    placeItem(newItem('orb'), ox, oy);
    let bx = ox, by = oy + 1; if (!isWalk(bx, by)) by = oy - 1;
    const oe2 = enemyAt(bx, by); if (oe2) { oe2.alive = false; level.group.remove(oe2.obj); }
    spawnEnemy('boss', bx, by, true);
    G.enemies = G.enemies.filter(e => e.alive);
  }

  playerObj.position.set(G.p.x, 0, G.p.y);
  pAnim = newAnim(G.p.x, G.p.y);
  updateFov();
  refreshLevel();
  snapCamera();
  updateHud();
  showFloorBanner(floor, theme.name, first);
}

// ============================================================
// 階の描画(インスタンス化した床・壁)
// ============================================================
const floorGeo = new THREE.BoxGeometry(0.96, 0.2, 0.96).translate(0, -0.1, 0);
const wallGeo = new THREE.BoxGeometry(1, 0.72, 1).translate(0, 0.36, 0);
const capGeo = new THREE.BoxGeometry(1.02, 0.08, 1.02).translate(0, 0.76, 0);
const tileMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const _dummy = new THREE.Object3D();
const _col = new THREE.Color();

function buildLevelMeshes() {
  const M = G.map, theme = level.theme;
  const floors = [], walls = [];
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = idx(x, y);
    if (M.tiles[i]) { floors.push(i); continue; }
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (inMap(x + dx, y + dy) && M.tiles[idx(x + dx, y + dy)]) { near = true; break; }
    if (near) walls.push(i);
  }
  const mk = (geo, list) => { const m = new THREE.InstancedMesh(geo, tileMat, list.length); m.frustumCulled = false; level.group.add(m); return m; };
  level.floorList = floors; level.wallList = walls;
  level.floorMesh = mk(floorGeo, floors);
  level.wallMesh = mk(wallGeo, walls);
  level.capMesh = mk(capGeo, walls);
  const vary = (hex, amt) => { _col.set(hex); const k = 1 + (Math.random() - 0.5) * amt; return _col.clone().multiplyScalar(k); };
  level.floorBase = floors.map(i => {
    const x = i % MW, y = (i / MW) | 0;
    if (M.tiles[i] === 2) return vary(theme.corr, 0.12);
    return vary((x + y) % 2 ? theme.floorA : theme.floorB, 0.08);
  });
  level.wallBase = walls.map(() => vary(theme.wall, 0.16));
  level.capBase = walls.map(() => vary(theme.cap, 0.1));
  if (M.stairs) {
    level.stairs = buildStairs(theme);
    level.stairs.position.set(M.stairs.x, 0, M.stairs.y);
    level.group.add(level.stairs);
  }
}

function refreshLevel() {
  const M = G.map;
  const put = (mesh, list, base, dimK, isWall) => {
    for (let k = 0; k < list.length; k++) {
      const i = list[k], x = i % MW, y = (i / MW) | 0;
      let ex = M.explored[i], vi = M.vis[i];
      const hide = !ex || (!isWall && M.stairs && M.stairs.x === x && M.stairs.y === y);
      _dummy.position.set(x, 0, y);
      _dummy.scale.setScalar(hide ? 0.0001 : 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(k, _dummy.matrix);
      _col.copy(base[k]).multiplyScalar(vi ? 1 : dimK);
      mesh.setColorAt(k, _col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  put(level.floorMesh, level.floorList, level.floorBase, 0.38, false);
  put(level.wallMesh, level.wallList, level.wallBase, 0.38, true);
  put(level.capMesh, level.wallList, level.capBase, 0.38, true);
  if (level.stairs) level.stairs.visible = !!M.explored[idx(M.stairs.x, M.stairs.y)];
  for (const fi of G.items) fi.obj.visible = !!M.explored[idx(fi.x, fi.y)] || !!G.map.revealItems;
  for (const e of G.enemies) if (e.alive) e.obj.visible = !!M.vis[idx(e.x, e.y)];
}

// 視界: 部屋にいれば部屋全体、通路なら周囲1マス
function updateFov() {
  const M = G.map, p = G.p;
  M.vis.fill(0);
  const rid = M.roomId[idx(p.x, p.y)];
  const mark = (x, y) => { if (inMap(x, y)) { M.vis[idx(x, y)] = 1; M.explored[idx(x, y)] = 1; } };
  if (rid >= 0) {
    const r = M.rooms[rid];
    for (let y = r.y1 - 1; y <= r.y2 + 1; y++) for (let x = r.x1 - 1; x <= r.x2 + 1; x++) mark(x, y);
  }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mark(p.x + dx, p.y + dy);
  // 通路から部屋の入口に立ったら部屋も見える
  for (const [dx, dy] of DIRS) {
    const r2 = inMap(p.x + dx, p.y + dy) ? M.roomId[idx(p.x + dx, p.y + dy)] : -1;
    if (r2 >= 0 && rid < 0) { const r = M.rooms[r2]; for (let y = r.y1 - 1; y <= r.y2 + 1; y++) for (let x = r.x1 - 1; x <= r.x2 + 1; x++) mark(x, y); }
  }
}
const visible = (x, y) => !!G.map.vis[idx(x, y)];

// ============================================================
// アニメーション
// ============================================================
let playerObj = null, pAnim = null;
function newAnim(x, y) { return { vx: x, vz: y, fx: x, fz: y, tx: x, tz: y, t: 1, dur: 0.13, lunge: 0, ldx: 0, ldz: 0, blink: 0, face: 0, faceT: 0, die: 0 }; }
function animMove(a, x, y, dur = 0.13) { a.fx = a.vx; a.fz = a.vz; a.tx = x; a.tz = y; a.t = 0; a.dur = dur; }
function animLunge(a, dx, dy) { a.lunge = 1; a.ldx = dx; a.ldz = dy; }
function faceDir(a, dx, dy) { a.faceT = Math.atan2(dx, dy); }
function stepAnim(a, obj, dt, hop = 0.12) {
  if (a.t < 1) {
    a.t = Math.min(1, a.t + dt / a.dur);
    a.vx = a.fx + (a.tx - a.fx) * a.t; a.vz = a.fz + (a.tz - a.fz) * a.t;
  }
  let ox = 0, oz = 0;
  if (a.lunge > 0) {
    a.lunge = Math.max(0, a.lunge - dt / 0.2);
    const s = Math.sin((1 - a.lunge) * Math.PI) * 0.38;
    ox = a.ldx * s; oz = a.ldz * s;
  }
  obj.position.set(a.vx + ox, 0, a.vz + oz);
  obj.userData.body.position.y = (obj.userData.body.userData.baseY ?? 0) + (a.t < 1 ? Math.sin(a.t * Math.PI) * hop : 0);
  // 向き(最短回転)
  let d = a.faceT - a.face; d = Math.atan2(Math.sin(d), Math.cos(d));
  a.face += d * Math.min(1, dt * 18);
  obj.userData.body.rotation.y = a.face;
  if (a.blink > 0) { a.blink -= dt; obj.userData.body.visible = a.blink <= 0 || Math.floor(a.blink * 20) % 2 === 0; }
}
const busy = () => pAnim && (pAnim.t < 1 || pAnim.lunge > 0.5) || projectiles.length > 0;

// ポップアップ数字
const pops = [];
function popup(x, y, text, cls) {
  const el = document.createElement('div');
  el.className = 'pop ' + (cls || ''); el.textContent = text;
  document.body.appendChild(el);
  pops.push({ el, x, y, t: 0 });
}
const _pv = new THREE.Vector3();
function updatePops(dt) {
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]; p.t += dt;
    _pv.set(p.x, 1.3 + p.t * 0.8, p.y).project(camera);
    p.el.style.left = ((_pv.x + 1) / 2 * innerWidth) + 'px';
    p.el.style.top = ((1 - _pv.y) / 2 * innerHeight) + 'px';
    p.el.style.opacity = String(clamp(1.6 - p.t * 1.6, 0, 1));
    if (p.t > 1) { p.el.remove(); pops.splice(i, 1); }
  }
}

// 投げた手裏剣
const projectiles = [];
const shurikenMesh = () => buildItemMesh(ITEMS.shuriken);

// ============================================================
// 効果音(WebAudio の簡単な合成音)
// ============================================================
let actx = null;
function sfx(kind) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    const P = { hit: [220, 90, 'square', 0.08, 0.1], hurt: [140, 60, 'sawtooth', 0.12, 0.12], pick: [660, 990, 'triangle', 0.1, 0.08], lv: [520, 1040, 'triangle', 0.35, 0.1], step: [90, 70, 'sine', 0.04, 0.04], stairs: [330, 110, 'triangle', 0.4, 0.1], miss: [400, 300, 'sine', 0.06, 0.05], magic: [300, 900, 'sawtooth', 0.3, 0.07], throw: [800, 500, 'triangle', 0.08, 0.05] }[kind];
    if (!P) return;
    o.type = P[2]; o.frequency.setValueAtTime(P[0], t); o.frequency.exponentialRampToValueAtTime(P[1], t + P[3]);
    g.gain.setValueAtTime(P[4], t); g.gain.exponentialRampToValueAtTime(0.001, t + P[3]);
    o.start(t); o.stop(t + P[3] + 0.02);
  } catch (e) { /* 音が出なくても続行 */ }
}

// ============================================================
// メッセージ・顔グラフィック
// ============================================================
const logEl = $('log');
let logLines = [];
function logClear() { logLines = []; renderLog(); }
function log(msg, cls = '') {
  logLines.push({ msg, cls, t: performance.now() });
  if (logLines.length > 4) logLines.shift();
  renderLog();
}
function renderLog() {
  logEl.innerHTML = '';
  logLines.forEach((l, i) => {
    const d = document.createElement('div');
    d.textContent = l.msg; d.className = l.cls + (i < logLines.length - 2 ? ' old' : '');
    logEl.appendChild(d);
  });
}

// 表情: 0 通常 / 1 驚き / 2 笑顔 / 3 気合
const faceCtx = $('face').getContext('2d');
let faceExpr = 0, faceTimer = 0;
function setFace(e, dur = 1.0) { faceExpr = e; faceTimer = dur; drawFace(); }
function drawFace() {
  const c = faceCtx, P = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const H = '#1d1a27', SK = '#f1c08c', SKS = '#d99d68', K = '#141018', R = '#c0362c', W = '#ffffff';
  const coat = VARIANTS[ui.variant].coat;
  let e = faceExpr;
  if (e === 0 && G && G.p.hp <= G.p.maxHp * 0.3) e = 3;
  P(0, 0, 16, 16, '#2a2433');
  P(1, 1, 14, 10, H); P(2, 0, 3, 2, H); P(7, 0, 3, 1, H); P(11, 0, 3, 2, H);
  P(13, 1, 2, 2, R);
  P(3, 5, 10, 9, SK); P(2, 8, 1, 3, SK); P(13, 8, 1, 3, SK);
  P(4, 13, 8, 1, SKS);
  P(3, 4, 10, 2, H); P(3, 6, 2, 1, H); P(7, 6, 1, 1, H); P(11, 6, 2, 1, H);
  P(1, 14, 14, 2, coat); P(3, 14, 10, 2, R);
  if (e === 0) {
    P(4, 7, 3, 1, H); P(9, 7, 3, 1, H);
    P(5, 9, 2, 2, K); P(9, 9, 2, 2, K);
    P(7, 12, 2, 1, '#8a3b2a');
  } else if (e === 1) {
    P(4, 7, 3, 1, H); P(9, 7, 3, 1, H);
    P(5, 8, 2, 3, K); P(9, 8, 2, 3, K); P(5, 8, 1, 1, W); P(9, 8, 1, 1, W);
    P(7, 11, 2, 2, '#5a1a14'); P(7, 12, 2, 1, '#e0605a');
    P(14, 3, 1, 3, '#ffd94a'); P(14, 7, 1, 1, '#ffd94a'); P(12, 2, 1, 2, '#ffd94a');
  } else if (e === 2) {
    P(5, 9, 2, 1, K); P(4, 10, 1, 1, K); P(7, 10, 1, 1, K);
    P(9, 9, 2, 1, K); P(8, 10, 1, 1, K); P(11, 10, 1, 1, K);
    P(6, 11, 4, 2, '#5a1a14'); P(7, 12, 2, 1, '#e0605a');
    P(4, 11, 1, 1, '#e8907a'); P(11, 11, 1, 1, '#e8907a');
  } else {
    P(4, 7, 2, 1, K); P(6, 8, 1, 1, K); P(10, 7, 2, 1, K); P(9, 8, 1, 1, K);
    P(5, 9, 2, 2, K); P(9, 9, 2, 2, K);
    P(6, 11, 4, 2, K); P(6, 11, 4, 1, W); P(7, 12, 2, 1, '#ddd');
  }
}

// ============================================================
// HUD・ミニマップ
// ============================================================
const mapCv = $('map'), mapCtx = mapCv.getContext('2d');
mapCv.width = MW * 4; mapCv.height = MH * 4;
function updateHud() {
  const p = G.p;
  $('sFloor').textContent = `${G.floor}F`;
  $('sLv').textContent = `Lv ${p.lv}`;
  $('sHp').textContent = `HP ${p.hp}/${p.maxHp} ・ 攻${pAtk()} 防${pDef()}`;
  $('hpBar').firstElementChild.style.width = (p.hp / p.maxHp * 100) + '%';
  $('hpBar').classList.toggle('low', p.hp <= p.maxHp * 0.3);
  $('sSub').textContent = `満腹 ${Math.ceil(p.hunger)}% ・ ${p.gold}銭`;
  const onStairs = G.map.stairs && p.x === G.map.stairs.x && p.y === G.map.stairs.y;
  const feetItem = itemAt(p.x, p.y);
  const bf = $('bFeet');
  bf.firstChild.textContent = onStairs ? '降りる' : feetItem ? '拾う' : '足元';
  bf.classList.toggle('hot', !!(onStairs || feetItem));
  const hasShuriken = p.inv.some(i => i.type === 'shuriken');
  $('bThrow').style.opacity = hasShuriken ? 1 : 0.45;
  drawMap();
  drawFace();
}
function drawMap() {
  const M = G.map, c = mapCtx, s = 4;
  c.clearRect(0, 0, mapCv.width, mapCv.height);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = idx(x, y);
    if (!M.explored[i] || !M.tiles[i]) continue;
    c.fillStyle = M.tiles[i] === 1 ? 'rgba(120,150,210,.55)' : 'rgba(150,140,120,.55)';
    c.fillRect(x * s, y * s, s, s);
  }
  if (M.stairs && M.explored[idx(M.stairs.x, M.stairs.y)]) { c.fillStyle = '#7af0ff'; c.fillRect(M.stairs.x * s - 1, M.stairs.y * s - 1, s + 2, s + 2); }
  for (const fi of G.items) if (M.explored[idx(fi.x, fi.y)] || M.revealItems) { c.fillStyle = fi.it.type === 'orb' ? '#ff7af0' : '#f3d47a'; c.fillRect(fi.x * s + 1, fi.y * s + 1, s - 2, s - 2); }
  for (const e of G.enemies) if (e.alive && visible(e.x, e.y)) { c.fillStyle = '#ff5040'; c.fillRect(e.x * s, e.y * s, s, s); }
  c.fillStyle = '#ffffff'; c.fillRect(G.p.x * s - 1, G.p.y * s - 1, s + 2, s + 2);
}

// ============================================================
// ターン処理
// ============================================================
let interrupt = false;

function playerMove(dir) {
  if (G.over) return;
  const [dx, dy] = DIRS[dir];
  const p = G.p;
  faceDir(pAnim, dx, dy); p.face = dir;
  if (ui.turnOnly) return; // 向き変更のみ(ターンは消費しない)
  const e = enemyAt(p.x + dx, p.y + dy);
  if (e && cornerOk(p.x, p.y, dx, dy)) {
    attackEnemy(e, dx, dy);
    endTurn();
    return;
  }
  if (!canStep(p.x, p.y, dx, dy)) { interrupt = true; return; }
  p.x += dx; p.y += dy;
  animMove(pAnim, p.x, p.y);
  sfx('step');
  // 足元
  const fi = itemAt(p.x, p.y);
  if (fi) pickUp(fi);
  if (G.map.stairs && p.x === G.map.stairs.x && p.y === G.map.stairs.y) { log('階段がある。(足元ボタン/Enter で降りる)', 'sys'); interrupt = true; }
  endTurn();
}
const cornerOk = (x, y, dx, dy) => !(dx && dy) || (isWalk(x + dx, y) && isWalk(x, y + dy));

function attackEnemy(e, dx, dy) {
  animLunge(pAnim, dx, dy);
  setFace(3, 0.6);
  e.sleep = 0; e.aware = true;
  if (Math.random() < 0.06) { popup(e.x, e.y, 'ミス', 'miss'); log(`${e.d.name}にかわされた。`); sfx('miss'); return; }
  const dmg = Math.max(1, Math.round(pAtk() * 1.3 * (0.85 + Math.random() * 0.3) - e.d.def));
  damageEnemy(e, dmg, `${e.d.name}に ${dmg} のダメージ。`);
}
function damageEnemy(e, dmg, msg) {
  e.hp -= dmg; e.sleep = 0; e.aware = true;
  e.anim.blink = 0.3;
  popup(e.x, e.y, String(dmg), 'hurt');
  sfx('hit');
  if (msg) log(msg, 'dmg');
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.alive = false; e.anim.die = 0.001;
  G.p.kills++;
  log(`${e.d.name}をたおした。(経験 +${e.d.exp})`, 'good');
  gainExp(e.d.exp);
  if (e.d.boss) { log('鬼の大将を討ち取った！ 宝玉の守りが解けた。', 'item'); setFace(2, 2); }
  // ときどき銭や道具を落とす
  if (Math.random() < 0.22 && !itemAt(e.x, e.y) && !(G.map.stairs && G.map.stairs.x === e.x && G.map.stairs.y === e.y)) {
    placeItem(newItem(Math.random() < 0.5 ? 'coins' : rollItemType(G.floor)), e.x, e.y);
  }
}
function gainExp(n) {
  const p = G.p;
  p.exp += n;
  while (p.exp >= expNeed(p.lv)) {
    p.exp -= expNeed(p.lv); p.lv++;
    const up = rr(4, 6);
    p.maxHp += up; p.hp = Math.min(p.maxHp, p.hp + up + 5);
    log(`レベルが ${p.lv} に上がった！ (最大HP +${up})`, 'item');
    popup(p.x, p.y, 'LEVEL UP', 'lv');
    sfx('lv'); setFace(2, 1.6);
  }
}

function pickUp(fi, manual) {
  const p = G.p, d = ITEMS[fi.it.type];
  if (fi.it.type === 'coins') {
    p.gold += fi.it.n; log(`${fi.it.n}銭 を拾った。`, 'item'); removeFloorItem(fi); sfx('pick'); setFace(2, 0.8); interrupt = true; return;
  }
  if (fi.it.type === 'orb') {
    if (G.enemies.some(e => e.alive && e.d.boss)) { log('宝玉は鬼の大将の妖気に守られている……。', 'dmg'); setFace(1, 1); interrupt = true; return; }
    removeFloorItem(fi); sfx('lv'); setFace(2, 5);
    log('「龍の宝玉」を手に入れた！', 'item');
    gameClear(); return;
  }
  if (fi.it.type === 'shuriken') {
    const st = p.inv.find(i => i.type === 'shuriken');
    if (st) { st.n += fi.it.n; log(`${itemLabel(fi.it)} を拾った。`, 'item'); removeFloorItem(fi); sfx('pick'); interrupt = true; return; }
  }
  if (p.inv.length >= INV_MAX) { log(`${d.name}がある。だが旅袋がいっぱいだ。`, 'sys'); interrupt = true; return; }
  p.inv.push(fi.it);
  log(`${itemLabel(fi.it)} を拾った。`, 'item');
  removeFloorItem(fi); sfx('pick'); setFace(2, 0.8);
  interrupt = true;
}

function endTurn() {
  const p = G.p;
  G.turn++;
  // 満腹度
  const before = p.hunger;
  p.hunger = Math.max(0, p.hunger - 0.1);
  if (before > 20 && p.hunger <= 20) { log('お腹が空いてきた……。', 'sys'); setFace(1); }
  if (before > 0 && p.hunger <= 0) { log('お腹が空いて倒れそうだ！', 'dmg'); setFace(1); }
  if (p.hunger <= 0) { p.hp -= 1; if (p.hp <= 0) return die('空腹で倒れた'); }
  else if (p.hp < p.maxHp) {
    p.regen += p.maxHp / 140;
    while (p.regen >= 1 && p.hp < p.maxHp) { p.hp++; p.regen--; }
  }
  enemiesAct();
  if (G.over) return;
  // 妖怪の湧き
  if (G.turn % 45 === 0 && G.enemies.filter(e => e.alive).length < 6 + G.floor) {
    for (let t = 0; t < 30; t++) {
      const tile = randomRoomTile();
      if (tile && !visible(tile.x, tile.y)) { spawnEnemy(rollEnemyType(G.floor), tile.x, tile.y, false); break; }
    }
  }
  G.enemies = G.enemies.filter(e => e.alive || e.anim.die > 0);
  const prevVis = new Set(G.enemies.filter(e => e.alive && e.seen).map(e => e));
  updateFov();
  for (const e of G.enemies) {
    if (!e.alive) continue;
    const v = visible(e.x, e.y);
    if (v && !e.seen) { interrupt = true; if (!prevVis.has(e)) setFace(1, 0.9); }
    e.seen = v;
  }
  refreshLevel();
  updateHud();
}

// 経路: プレイヤーまでの距離マップ(BFS、8方向)
function distMap(tx, ty) {
  const D = new Int16Array(MW * MH).fill(-1);
  const q = [idx(tx, ty)]; D[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % MW, y = (i / MW) | 0;
    for (const [dx, dy] of DIRS) {
      if (!canStep(x, y, dx, dy)) continue;
      const j = idx(x + dx, y + dy);
      if (D[j] < 0) { D[j] = D[i] + 1; q.push(j); }
    }
  }
  return D;
}

function enemiesAct() {
  const p = G.p, M = G.map;
  const dP = distMap(p.x, p.y);
  const prid = M.roomId[idx(p.x, p.y)];
  for (const e of G.enemies) {
    if (!e.alive) continue;
    const steps = e.d.speed || 1;
    for (let s = 0; s < steps && e.alive && !G.over; s++) {
      if (e.sleep > 0) {
        if (e.sleep < 900) { e.sleep--; continue; }
        // 寝ている: 近くに来たら起きることがある
        const near = cheb(e.x, e.y, p.x, p.y) <= 4 && (M.roomId[idx(e.x, e.y)] === prid || cheb(e.x, e.y, p.x, p.y) <= 1);
        if (near && Math.random() < (e.d.boss ? 1 : 0.3)) { e.sleep = 0; e.aware = true; if (e.d.boss) { log('鬼の大将が目を覚ました！', 'dmg'); setFace(1, 1.2); } }
        continue;
      }
      // 気づき判定
      const erid = M.roomId[idx(e.x, e.y)];
      const sees = (erid >= 0 && erid === prid) || cheb(e.x, e.y, p.x, p.y) <= 2;
      if (sees) { e.aware = true; e.lost = 0; } else if (e.aware && ++e.lost > 12) e.aware = false;
      const dx = Math.sign(p.x - e.x), dy = Math.sign(p.y - e.y);
      // 攻撃
      if (cheb(e.x, e.y, p.x, p.y) === 1 && cornerOk(e.x, e.y, dx, dy)) {
        faceDir(e.anim, dx, dy); animLunge(e.anim, dx, dy);
        enemyAttack(e);
        continue;
      }
      // 移動
      let best = null;
      if (e.aware) {
        let bd = dP[idx(e.x, e.y)];
        if (bd < 0) bd = 999;
        for (const [ddx, ddy] of DIRS) {
          const nx = e.x + ddx, ny = e.y + ddy;
          if (!canStep(e.x, e.y, ddx, ddy) || enemyAt(nx, ny) || (nx === p.x && ny === p.y)) continue;
          const d = dP[idx(nx, ny)];
          if (d >= 0 && d < bd) { bd = d; best = [ddx, ddy]; }
        }
      } else {
        if (!e.target || (e.target.x === e.x && e.target.y === e.y) || Math.random() < 0.02) {
          const r = pick(M.rooms); e.target = { x: rr(r.x1, r.x2), y: rr(r.y1, r.y2) }; e.tD = distMap(e.target.x, e.target.y);
        }
        let bd = e.tD[idx(e.x, e.y)];
        const opts = [];
        for (const [ddx, ddy] of DIRS) {
          const nx = e.x + ddx, ny = e.y + ddy;
          if (!canStep(e.x, e.y, ddx, ddy) || enemyAt(nx, ny) || (nx === p.x && ny === p.y)) continue;
          const d = e.tD[idx(nx, ny)];
          if (d >= 0 && d < bd) opts.push([ddx, ddy]);
        }
        if (opts.length) best = pick(opts); else e.target = null;
      }
      if (best) {
        e.x += best[0]; e.y += best[1];
        faceDir(e.anim, best[0], best[1]);
        animMove(e.anim, e.x, e.y, steps > 1 ? 0.09 : 0.13);
      }
    }
  }
}
function enemyAttack(e) {
  const p = G.p;
  if (Math.random() < 0.13) { popup(p.x, p.y, 'ミス', 'miss'); log(`${e.d.name}の攻撃をかわした。`); return; }
  const dmg = Math.max(1, Math.round(e.d.atk * (0.85 + Math.random() * 0.3) - pDef()));
  p.hp -= dmg;
  pAnim.blink = 0.35;
  popup(p.x, p.y, String(dmg), 'hurt');
  log(`${e.d.name}の攻撃！ ${dmg} のダメージ。`, 'dmg');
  sfx('hurt'); setFace(1, 0.8);
  interrupt = true;
  if (p.hp <= 0) die(`${e.d.name}にやられた`);
}

function die(reason) {
  G.p.hp = 0; G.over = true;
  updateHud();
  setFace(1, 99);
  log('冒険者は力尽きた……。', 'dmg');
  saveBest(false);
  setTimeout(() => showResult(false, reason), 1100);
}
function gameClear() {
  G.over = true;
  saveBest(true);
  updateHud();
  setTimeout(() => showResult(true), 900);
}

// ---------------- 行動 ----------------
function actWait() {
  if (G.over) return;
  // 足踏みは回復が少し早い
  G.p.regen += G.p.maxHp / 300;
  endTurn();
}
function actFeet() {
  if (G.over) return;
  const p = G.p;
  if (G.map.stairs && p.x === G.map.stairs.x && p.y === G.map.stairs.y) return descend();
  const fi = itemAt(p.x, p.y);
  if (fi) { const n = G.items.length; pickUp(fi, true); if (G.items.length !== n || G.over) endTurn(); return; }
  log('足元には何もない。', 'sys');
}
function descend() {
  sfx('stairs');
  ui.mode = 'fade';
  const f = G.floor + 1;
  $('fadeT1').textContent = `${f}F`; $('fadeT2').textContent = themeFor(f).name;
  $('fade').classList.add('on');
  setTimeout(() => {
    enterFloor(f);
    log(`${f}F に降りた。`, 'sys');
    if (f === MAX_FLOOR) log('強い妖気を感じる……。この階のどこかに宝玉がある。', 'dmg');
    setTimeout(() => { $('fade').classList.remove('on'); ui.mode = 'play'; }, 650);
  }, 380);
}
function showFloorBanner(floor, name, first) {
  if (!first) return;
  $('fadeT1').textContent = `${floor}F`; $('fadeT2').textContent = name;
  $('fade').classList.add('on');
  setTimeout(() => $('fade').classList.remove('on'), 900);
}

function lineTarget() {
  // 近くの見えている妖怪が8方向の直線上にいればそちらを狙う
  const p = G.p;
  let best = null, bd = 99;
  for (const e of G.enemies) {
    if (!e.alive || !visible(e.x, e.y)) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) continue;
    const dir = DIRS.findIndex(d => d[0] === Math.sign(dx) && d[1] === Math.sign(dy));
    const n = Math.max(Math.abs(dx), Math.abs(dy));
    let ok = true;
    for (let k = 1; k < n; k++) { const x = p.x + DIRS[dir][0] * k, y = p.y + DIRS[dir][1] * k; if (!isWalk(x, y) || enemyAt(x, y)) { ok = false; break; } }
    if (ok && n < bd) { bd = n; best = dir; }
  }
  return best;
}
function actThrow(invIndex) {
  if (G.over) return;
  const p = G.p;
  const i = invIndex ?? p.inv.findIndex(it => it.type === 'shuriken');
  if (i < 0 || p.inv[i].type !== 'shuriken') { log('投げられる手裏剣がない。', 'sys'); return; }
  const auto = lineTarget();
  const dir = auto ?? p.face ?? 4;
  const [dx, dy] = DIRS[dir];
  faceDir(pAnim, dx, dy); p.face = dir;
  const it = p.inv[i];
  if (--it.n <= 0) { p.inv.splice(i, 1); if (p.weapon === it) p.weapon = null; }
  let x = p.x, y = p.y, hit = null;
  for (let k = 0; k < 10; k++) {
    const nx = x + dx, ny = y + dy;
    if (!isWalk(nx, ny) || !cornerOk(x, y, dx, dy)) break;
    x = nx; y = ny;
    const e = enemyAt(x, y); if (e) { hit = e; break; }
  }
  sfx('throw'); setFace(3, 0.6);
  const m = shurikenMesh(); m.position.set(p.x, 0.55, p.y); scene.add(m);
  projectiles.push({ m, fx: p.x, fz: p.y, tx: x, tz: y, t: 0, dur: Math.max(0.08, cheb(p.x, p.y, x, y) * 0.05) });
  if (hit) damageEnemy(hit, ITEMS.shuriken.dmg + Math.floor(G.floor / 2), `手裏剣が${hit.d.name}に命中！`);
  else log('手裏剣は何にも当たらなかった。');
  endTurn();
}

// 道具を使う
function useItem(i) {
  const p = G.p, it = p.inv[i], d = ITEMS[it.type];
  switch (d.kind) {
    case 'food': {
      p.hunger = Math.min(100, p.hunger + d.food);
      log(`${d.name}を食べた。お腹がふくれた。`, 'good'); setFace(2, 1); p.inv.splice(i, 1); break;
    }
    case 'heal': {
      const before = p.hp;
      if (d.maxUp) p.maxHp += d.maxUp;
      p.hp = Math.min(p.maxHp, p.hp + d.heal);
      popup(p.x, p.y, '+' + (p.hp - before), 'heal');
      log(`${d.name}を使った。HP が ${p.hp - before} 回復${d.maxUp ? '、最大HPが上がった' : ''}。`, 'good'); setFace(2, 1); sfx('pick');
      p.inv.splice(i, 1); break;
    }
    case 'gourd': {
      if (it.n <= 0) { log('水筒は空っぽだ。', 'sys'); return false; }
      it.n--;
      const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + d.heal);
      popup(p.x, p.y, '+' + (p.hp - before), 'heal');
      log(`水筒の水を飲んだ。HP が ${p.hp - before} 回復。(残り${it.n})`, 'good'); setFace(2, 1); sfx('pick');
      break;
    }
    case 'scroll': {
      p.inv.splice(i, 1);
      readScroll(d); break;
    }
    case 'weapon': case 'hat': {
      const slot = d.kind === 'weapon' ? 'weapon' : 'hat';
      if (p[slot] === it) { p[slot] = null; log(`${d.name}を外した。`); }
      else { p[slot] = it; log(`${d.name}を装備した。`, 'good'); setFace(3, 0.6); }
      break;
    }
    case 'throw': closeInv(); actThrow(i); return 'done';
    default: return false;
  }
  return true;
}
function readScroll(d) {
  sfx('magic');
  log(`${d.name}を読んだ。`, 'sys');
  const targets = G.enemies.filter(e => e.alive && visible(e.x, e.y));
  if (d.effect === 'fire') {
    setFace(3, 1);
    if (!targets.length) log('炎が舞ったが、誰もいなかった。');
    flash('#ff7040');
    for (const e of targets) damageEnemy(e, 25, `炎が${e.d.name}を包んだ！ 25 のダメージ。`);
  } else if (d.effect === 'sleep') {
    flash('#8a7aff');
    if (!targets.length) log('しかし、何も起こらなかった。');
    for (const e of targets) { e.sleep = 10; }
    if (targets.length) log('妖怪たちは金縛りにあった！', 'good');
  } else if (d.effect === 'map') {
    flash('#7affb0');
    const M = G.map;
    for (let i = 0; i < M.tiles.length; i++) if (M.tiles[i]) {
      const x = i % MW, y = (i / MW) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inMap(x + dx, y + dy)) M.explored[idx(x + dx, y + dy)] = 1;
    }
    M.revealItems = true;
    log('迷宮の姿が頭に浮かんだ。', 'good');
  }
}
function flash(col) {
  const f = $('fade');
  f.style.transition = 'none'; f.style.background = col; f.style.opacity = '0.45';
  requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = ''; setTimeout(() => { f.style.background = ''; f.style.transition = ''; }, 520); });
}
function dropItem(i) {
  const p = G.p, it = p.inv[i];
  const M = G.map;
  if (itemAt(p.x, p.y) || (M.stairs && M.stairs.x === p.x && M.stairs.y === p.y)) { log('ここには置けない。', 'sys'); return false; }
  if (p.weapon === it) p.weapon = null;
  if (p.hat === it) p.hat = null;
  p.inv.splice(i, 1);
  placeItem(it, p.x, p.y);
  log(`${itemLabel(it)} を足元に置いた。`);
  return true;
}

// ============================================================
// 道具UI
// ============================================================
function openInv() {
  if (G.over || ui.mode !== 'play') return;
  ui.mode = 'inv'; ui.invSel = clamp(ui.invSel, 0, Math.max(0, G.p.inv.length - 1));
  $('inv').classList.add('show');
  renderInv();
}
function closeInv() { $('inv').classList.remove('show'); if (ui.mode === 'inv') ui.mode = 'play'; }
function invActions(it) {
  const d = ITEMS[it.type], p = G.p;
  const acts = [];
  if (d.kind === 'food') acts.push(['食べる', 'use']);
  else if (d.kind === 'heal' || d.kind === 'gourd') acts.push(['飲む', 'use']);
  else if (d.kind === 'scroll') acts.push(['読む', 'use']);
  else if (d.kind === 'throw') acts.push(['投げる', 'use']);
  else if (d.kind === 'weapon' || d.kind === 'hat') acts.push([p.weapon === it || p.hat === it ? '外す' : '装備', 'use']);
  acts.push(['置く', 'drop']);
  return acts;
}
function renderInv() {
  const p = G.p, ul = $('invList');
  $('invCount').textContent = `${p.inv.length}/${INV_MAX}`;
  ul.innerHTML = '';
  if (!p.inv.length) { ul.innerHTML = '<li class="empty">何も持っていない</li>'; }
  p.inv.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = i === ui.invSel ? 'sel' : '';
    const eq = p.weapon === it || p.hat === it;
    li.innerHTML = `<span class="ic">${ITEMS[it.type].icon}</span><span>${itemLabel(it)}</span>${eq ? '<span class="eq">装</span>' : ''}`;
    li.onclick = () => { ui.invSel = i; renderInv(); };
    ul.appendChild(li);
  });
  const it = p.inv[ui.invSel];
  $('invDesc').textContent = it ? ITEMS[it.type].desc || '' : '';
  const box = $('invActs'); box.innerHTML = '';
  if (it) invActions(it).forEach(([label, a], k) => {
    const b = document.createElement('button'); b.textContent = label; if (k === 0) b.className = 'pri';
    b.onclick = () => doInvAction(a); box.appendChild(b);
  });
  const c = document.createElement('button'); c.textContent = '閉じる'; c.onclick = closeInv; box.appendChild(c);
}
function doInvAction(a) {
  const i = ui.invSel;
  if (!G.p.inv[i]) return;
  let r;
  if (a === 'use') r = useItem(i);
  else r = dropItem(i);
  if (r === 'done') return;
  closeInv();
  if (r) endTurn();
}

// ============================================================
// 結果画面・記録
// ============================================================
function loadBest() { try { return JSON.parse(localStorage.getItem('yokaiLabyrinthBest') || 'null'); } catch (e) { return null; } }
function saveBest(cleared) {
  try {
    const b = loadBest() || { floor: 0, cleared: 0 };
    b.floor = Math.max(b.floor, G.floor);
    if (cleared) b.cleared = (b.cleared || 0) + 1;
    localStorage.setItem('yokaiLabyrinthBest', JSON.stringify(b));
  } catch (e) { /* 保存できなくても続行 */ }
}
function showBest() {
  const b = loadBest();
  $('best').textContent = b ? `最高到達: ${b.floor}F${b.cleared ? ` ・ 踏破 ${b.cleared} 回` : ''}` : '';
}
function showResult(cleared, reason) {
  ui.mode = 'result';
  const p = G.p;
  $('resTitle').innerHTML = cleared ? '<span class="brush" style="font-size:22px">迷宮踏破</span>' : '<span class="brush" style="font-size:22px;background:#c9c0b0">旅の終わり</span>';
  $('resBody').innerHTML = cleared
    ? `名もなき冒険者は「龍の宝玉」を手に、迷宮をあとにした。<br>Lv ${p.lv} ・ 退治した妖怪 ${p.kills} ・ ${p.gold}銭<br>${G.turn} ターン`
    : `${G.floor}F で${reason}。<br>Lv ${p.lv} ・ 退治した妖怪 ${p.kills} ・ ${p.gold}銭<br>${G.turn} ターン`;
  $('result').classList.add('show');
}

// ============================================================
// タイトル
// ============================================================
let titleObj = null;
function buildSwatches() {
  const box = $('swatches'); box.innerHTML = '';
  VARIANTS.forEach((v, i) => {
    const b = document.createElement('button');
    b.className = i === ui.variant ? 'sel' : '';
    b.innerHTML = `<i style="background:${v.coat}"></i>${v.name}`;
    b.onclick = () => { ui.variant = i; buildSwatches(); setTitleModel(); };
    box.appendChild(b);
  });
}
function setTitleModel() {
  if (titleObj) { scene.remove(titleObj); titleObj.userData.body.children[0].geometry.dispose(); }
  titleObj = withShadow(buildPlayerMesh(VARIANTS[ui.variant]), 1.0, 1);
  titleObj.position.set(0, 0, 0);
  scene.add(titleObj);
}
function enterTitle() {
  ui.mode = 'title';
  $('title').classList.add('show');
  $('hud').style.display = 'none'; $('controls').style.display = 'none';
  logClear();
  if (level) { scene.remove(level.group); level = null; }
  if (playerObj) { scene.remove(playerObj); playerObj.userData.body.children[0].geometry.dispose(); playerObj = null; }
  scene.background.set('#1a1622'); scene.fog.color.set('#1a1622');
  lantern.color.setHex(0xffc880);
  buildSwatches(); setTitleModel(); showBest();
}
$('bStart').onclick = () => {
  sfx('step');
  if (titleObj) { scene.remove(titleObj); titleObj = null; }
  $('title').classList.remove('show');
  $('hud').style.display = ''; $('controls').style.display = '';
  ui.mode = 'play';
  newGame();
};
$('bAgain').onclick = () => { $('result').classList.remove('show'); enterTitle(); };

// ============================================================
// 入力
// ============================================================
function tryAction(fn) {
  if (ui.mode !== 'play' || !G || G.over || busy()) return false;
  fn(); return true;
}
const KEYDIR = {
  ArrowUp: 0, KeyW: 0, Numpad8: 0, KeyK: 0,
  ArrowRight: 2, KeyD: 2, Numpad6: 2, KeyL: 2,
  ArrowDown: 4, KeyS: 4, Numpad2: 4, KeyJ: 4,
  ArrowLeft: 6, KeyA: 6, Numpad4: 6, KeyH: 6,
  KeyE: 1, Numpad9: 1, PageUp: 1, KeyU: 1,
  KeyC: 3, Numpad3: 3, PageDown: 3, KeyN: 3,
  KeyZ: 5, Numpad1: 5, End: 5, KeyB: 5,
  KeyQ: 7, Numpad7: 7, Home: 7, KeyY: 7,
};
const held = new Set();
addEventListener('keydown', ev => {
  if (ui.mode === 'title') { if (ev.code === 'Enter' || ev.code === 'Space') $('bStart').click(); return; }
  if (ui.mode === 'result') { if (ev.code === 'Enter') $('bAgain').click(); return; }
  if (ui.mode === 'inv') {
    const n = G.p.inv.length;
    if (ev.code === 'Escape' || ev.code === 'KeyI' || ev.code === 'Tab') { closeInv(); ev.preventDefault(); }
    else if (ev.code === 'ArrowUp' || ev.code === 'KeyW') { ui.invSel = (ui.invSel - 1 + n) % Math.max(1, n); renderInv(); }
    else if (ev.code === 'ArrowDown' || ev.code === 'KeyS') { ui.invSel = (ui.invSel + 1) % Math.max(1, n); renderInv(); }
    else if (ev.code === 'Enter' || ev.code === 'Space') { if (n) doInvAction('use'); }
    else if (ev.code === 'KeyX' || ev.code === 'Backspace') { if (n) doInvAction('drop'); }
    ev.preventDefault();
    return;
  }
  if (ev.code === 'KeyM') { toggleMap(); return; }
  if (ev.code === 'KeyV') { cycleZoom(); return; }
  if (ui.mode !== 'play') return;
  if (ev.code in KEYDIR) {
    ev.preventDefault();
    held.add(ev.code);
    const dir = KEYDIR[ev.code];
    if (ev.shiftKey) { ui.turnOnly = true; playerMove(dir); ui.turnOnly = false; return; }
    tryAction(() => playerMove(dir));
    return;
  }
  if (ev.code === 'Space' || ev.code === 'Period' || ev.code === 'Numpad5') { ev.preventDefault(); tryAction(actWait); }
  else if (ev.code === 'KeyI' || ev.code === 'Tab') { ev.preventDefault(); openInv(); }
  else if (ev.code === 'Enter' || ev.code === 'KeyG') { ev.preventDefault(); tryAction(actFeet); }
  else if (ev.code === 'KeyT' || ev.code === 'KeyF') { tryAction(() => actThrow()); }
});
addEventListener('keyup', ev => held.delete(ev.code));

// 画面の十字ボタン(押しっぱなしで連続移動)
let padHold = null;
function padRepeat() {
  if (!padHold) return;
  if (interrupt) { interrupt = false; padHold.stopped = true; return; }
  if (!padHold.stopped && tryAction(padHold.fn)) { padHold.count++; }
  padHold.timer = setTimeout(padRepeat, padHold.count <= 1 ? 260 : 60);
}
function bindHold(btn, fn) {
  btn.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    btn.setPointerCapture?.(ev.pointerId);
    if (padHold) clearTimeout(padHold.timer);
    interrupt = false;
    padHold = { fn, count: 0, stopped: false };
    if (tryAction(fn)) padHold.count = 1;
    padHold.timer = setTimeout(padRepeat, 260);
    btn.classList.add('on');
  });
  const up = () => { if (padHold) { clearTimeout(padHold.timer); padHold = null; } btn.classList.remove('on'); };
  btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('lostpointercapture', up);
}
document.querySelectorAll('#pad button[data-d]').forEach(b => {
  const dir = +b.dataset.d;
  bindHold(b, () => playerMove(dir));
});
bindHold($('bWait'), actWait);
const tap = (el, fn) => el.addEventListener('pointerdown', ev => { ev.preventDefault(); fn(); });
tap($('bInv'), openInv);
tap($('bThrow'), () => tryAction(() => actThrow()));
tap($('bFeet'), () => tryAction(actFeet));
tap($('bView'), cycleZoom);
tap($('map'), toggleMap);
$('inv').addEventListener('pointerdown', ev => { if (ev.target === $('inv')) closeInv(); });
function toggleMap() { if (ui.mode === 'title') return; $('map').classList.toggle('big'); }
function cycleZoom() { ui.zoom = (ui.zoom + 1) % ZOOMS.length; }

// ============================================================
// カメラ・ループ
// ============================================================
function snapCamera() {
  camDist = desiredCamDist();
  camTarget.set(G.p.x, 0, G.p.y + portraitShift());
}
const portraitShift = () => camera.aspect < 1 ? 1.4 : 0.4;
function updateCamera(dt) {
  if (ui.mode === 'title' || !playerObj) {
    const d = camera.aspect < 1 ? 6.4 : 4.6;
    camera.position.set(Math.sin(0.25) * d, 1.5, Math.cos(0.25) * d);
    camera.lookAt(0, camera.aspect < 1 ? 0.75 : 0.62, 0);
    scene.fog.near = 30; scene.fog.far = 60;
    lantern.position.set(1.5, 2.5, 2.5);
    sun.position.set(-3, 6, 5); sun.target.position.set(0, 0, 0);
    return;
  }
  const k = 1 - Math.exp(-dt * 8);
  camDist += (desiredCamDist() - camDist) * k;
  const tx = playerObj.position.x, tz = playerObj.position.z + portraitShift();
  camTarget.x += (tx - camTarget.x) * k; camTarget.z += (tz - camTarget.z) * k;
  camera.position.set(camTarget.x, Math.sin(camElev) * camDist, camTarget.z + Math.cos(camElev) * camDist);
  scene.fog.near = camDist + 2; scene.fog.far = camDist + 16;
  camera.lookAt(camTarget);
  lantern.position.set(playerObj.position.x, 1.8, playerObj.position.z + 0.3);
  sun.position.set(camTarget.x - 4, 10, camTarget.z + 6); sun.target.position.copy(camTarget);
}

let last = performance.now(), time = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
  if (faceTimer > 0) { faceTimer -= dt; if (faceTimer <= 0) { faceExpr = 0; if (G) drawFace(); } }
  if (titleObj) { titleObj.userData.body.rotation.y += dt * 0.6; titleObj.userData.body.position.y = Math.sin(time * 2) * 0.02; }
  if (G && playerObj && ui.mode !== 'title') {
    stepAnim(pAnim, playerObj, dt);
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      const hop = e.d.hop ? 0.3 : e.d.float ? 0 : 0.1;
      e.obj.userData.body.userData.baseY = e.d.float ? e.d.float + Math.sin(time * 3 + e.x) * 0.06 : 0;
      stepAnim(e.anim, e.obj, dt, hop);
      if (e.d.float) e.obj.userData.body.children[0].scale.y = 1 + Math.sin(time * 9 + e.y) * 0.06;
      if (e.sleep > 0 && e.alive) e.obj.userData.body.rotation.z = Math.sin(time * 1.5) * 0.06;
      else e.obj.userData.body.rotation.z = 0;
      if (e.anim.die > 0) {
        e.anim.die += dt * 2.5;
        const s = Math.max(0.001, 1 - e.anim.die);
        e.obj.scale.set(s, s, s); e.obj.position.y = e.anim.die * 0.8;
        if (e.anim.die >= 1) { level.group.remove(e.obj); e.obj.userData.body.children[0].geometry.dispose(); e.anim.die = 0; G.enemies = G.enemies.filter(x => x !== e); }
      }
    }
    for (const fi of G.items) {
      fi.obj.userData.body.position.y = 0.06 + Math.sin(time * 2.4 + fi.obj.userData.spin) * 0.04;
      if (fi.it.type === 'orb') fi.obj.userData.body.rotation.y += dt;
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pr = projectiles[i];
      pr.t = Math.min(1, pr.t + dt / pr.dur);
      pr.m.position.set(pr.fx + (pr.tx - pr.fx) * pr.t, 0.55, pr.fz + (pr.tz - pr.fz) * pr.t);
      pr.m.rotation.y += dt * 30;
      if (pr.t >= 1) { scene.remove(pr.m); pr.m.geometry.dispose(); projectiles.splice(i, 1); }
    }
    if (level && level.stairs) level.stairs.visible = !!G.map.explored[idx(G.map.stairs.x, G.map.stairs.y)];
  }
  updateCamera(dt);
  updatePops(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

enterTitle();
requestAnimationFrame(loop);

// デバッグ用(コンソールから状態確認)
window.__yl = {
  get G() { return G; }, ui, descend: () => descend(), enterFloor: f => enterFloor(f),
  // 見た目確認用: 主人公の周りに妖怪と道具を並べる
  lineup() {
    const M = G.map, r = M.rooms.slice().sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1))[0];
    for (const e of G.enemies) { e.alive = false; level.group.remove(e.obj); }
    G.enemies = [];
    G.p.x = r.x1 + 1; G.p.y = r.y1 + 2; pAnim = newAnim(G.p.x, G.p.y);
    Object.keys(ENEMIES).forEach((t, k) => { const x = r.x1 + 1 + k, y = r.y1; if (isWalk(x, y)) spawnEnemy(t, x, y, true); });
    ['onigiri', 'herb', 'fireScroll', 'shuriken', 'uchigatana', 'jingasa', 'coins'].forEach((t, k) => { const x = r.x1 + 2 + k, y = r.y1 + 3; if (isWalk(x, y) && !itemAt(x, y)) placeItem(newItem(t), x, y); });
    updateFov(); refreshLevel(); updateHud();
  },
};
