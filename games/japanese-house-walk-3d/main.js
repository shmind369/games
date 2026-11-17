import * as THREE from 'three';

// ============================================================
// 間取り(設計図の寸法mmをメートルで記述)
// 座標: x = 西→東、z = 北→南。2階の床を y=0 とする
// ============================================================
const CEIL = 2.4;      // 天井高
const UCHI = 1.78;     // 内法(鴨居の下端)
const GROUND = -2.95;  // 地面(1階分下)
const EYE = 1.5;

// 部屋
const rooms = [
  { name: '押入', r: [0, 0, 0.81, 1.72], type: 'closet' },
  { name: '押入', r: [0, 1.72, 0.81, 2.53], type: 'closet' },
  { name: '和室 4.5畳', r: [0.81, 0, 3.63, 2.53], type: 'tatami', layout: 'j45' },
  { name: '和室 6.0帖', r: [0, 2.53, 3.63, 5.17], type: 'tatami', layout: 'j6' },
  { name: '廊下', r: [3.63, 0, 4.45, 5.17], type: 'hall' },
  { name: '階段', r: [4.45, 0, 7.78, 0.88], type: 'stair' },
  { name: '廊下', r: [4.45, 0.88, 7.78, 1.61], type: 'hall' },
  { name: 'トイレ', r: [7.78, 0, 8.565, 1.61], type: 'toilet' },
  { name: '和室 7.0畳', r: [4.45, 1.61, 8.105, 5.17], type: 'tatami', layout: 'j7' },
];
const BAL_N = [3.63, -2.795, 4.9, 0];      // 北のバルコニー(グレーチング床)
const BAL_S = [3.85, 5.17, 8.05, 6.95];    // 南のバルコニー

// 外壁(out: 外側の向き)と内壁
const extWalls = [
  { o: 'h', c: 0, a: 0, b: 8.565, out: -1 },
  { o: 'v', c: 0, a: 0, b: 5.17, out: -1 },
  { o: 'h', c: 5.17, a: 0, b: 8.105, out: 1 },
  { o: 'v', c: 8.105, a: 1.61, b: 5.17, out: 1 },
  { o: 'h', c: 1.61, a: 8.105, b: 8.565, out: 1 },
  { o: 'v', c: 8.565, a: 0, b: 1.61, out: 1 },
];
const intWalls = [
  { o: 'v', c: 0.81, a: 0, b: 2.53 },
  { o: 'h', c: 1.72, a: 0, b: 0.81 },
  { o: 'h', c: 2.53, a: 0, b: 3.63 },
  { o: 'v', c: 3.63, a: 0, b: 5.17 },
  { o: 'v', c: 4.45, a: 1.61, b: 5.17 },
  { o: 'h', c: 1.61, a: 4.45, b: 8.105 },
  { o: 'v', c: 7.78, a: 0, b: 1.61 },
];

// 開口部: kind = fusuma(襖) / closet(押入の襖) / door(開き戸) / window(窓) / sweep(掃き出し窓)
// s: 部屋側(障子や開き戸が来る側)の法線方向
const openings = [];
const op = (o, c, a, b, kind, y0, y1, s = 1, opt = {}) => openings.push({ o, c, a, b, kind, y0, y1, s, ...opt });
op('v', 0.81, 0.15, 1.57, 'closet', 0, UCHI, 1);
op('h', 2.53, 0.06, 0.75, 'closet', 0, UCHI, 1);
op('v', 3.63, 1.25, 2.45, 'fusuma', 0, UCHI);
op('v', 3.63, 3.95, 5.05, 'fusuma', 0, UCHI);
op('v', 4.45, 2.05, 3.75, 'fusuma', 0, UCHI);
op('h', 0, 3.70, 4.35, 'door', 0, 1.95, 1);
op('v', 7.78, 0.92, 1.56, 'door', 0, 1.9, -1);
op('h', 5.17, 5.35, 7.15, 'sweep', 0, UCHI, -1);
op('h', 0, 1.9, 3.1, 'window', 0.85, UCHI, 1, { shoji: true });
op('h', 0, 4.95, 7.6, 'window', 0.3, UCHI, 1);
op('v', 0, 3.35, 4.25, 'window', 0.85, UCHI, 1, { shoji: true });
op('h', 5.17, 1.3, 3.0, 'window', 0.85, UCHI, -1, { shoji: true });
op('v', 8.105, 4.0, 4.75, 'window', 0.85, UCHI, -1, { shoji: true });
op('v', 8.565, 0.5, 1.1, 'window', 1.2, 1.7, -1, { frosted: true });

// 階段(廊下側が上、東へ下りる)
const ST = { x0: 4.45, x1: 7.78, z0: 0, z1: 0.88, n: 14 };
ST.run = (ST.x1 - ST.x0) / ST.n; ST.rise = -GROUND / ST.n;

// ============================================================
// three.js
// ============================================================
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9d2ef);
scene.fog = new THREE.Fog(0xa9d2ef, 30, 90);
const camera = new THREE.PerspectiveCamera(75, 1, 0.03, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0xc8b89a, 1.3));
scene.add(new THREE.AmbientLight(0xfff6e8, 0.75));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.2);
sun.position.set(10, 25, 18);
scene.add(sun);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = innerWidth < innerHeight ? 78 : 62;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ============================================================
// テクスチャ
// ============================================================
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function noise(g, w, h, n, a, cols, s = 3) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    g.globalAlpha = a * Math.random();
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * s, 1 + Math.random() * s);
  }
  g.globalAlpha = 1;
}
const texPlaster = canvasTex(256, 256, (g, w, h) => { // 聚楽壁
  g.fillStyle = '#d9c7a3'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 6000, 0.5, ['#c4ae86', '#e8dabb', '#b89f74', '#a08860'], 2);
});
const texFloor = canvasTex(256, 256, (g, w, h) => { // 廊下のフローリング
  for (let i = 0; i < 8; i++) {
    g.fillStyle = ['#b98a55', '#c29361', '#ae7f4b', '#c99c69'][i % 4]; g.fillRect(i * 32, 0, 32, h);
    g.fillStyle = 'rgba(80,50,20,.5)'; g.fillRect(i * 32 + 31, 0, 1, h);
    g.fillRect(i * 32, ((i * 83) % 256), 32, 1);
    for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(90,55,25,.15)'; g.fillRect(i * 32 + 3 + Math.random() * 26, 0, 1, h); }
  }
});
const texCeil = canvasTex(256, 256, (g, w, h) => { // 杉板の天井
  for (let i = 0; i < 6; i++) {
    const x = (i * w) / 6;
    g.fillStyle = ['#d8b88a', '#cfae7e', '#ddbf93'][i % 3]; g.fillRect(x, 0, w / 6, h);
    g.strokeStyle = 'rgba(140,95,55,.25)'; g.lineWidth = 1.5;
    for (let k = 0; k < 5; k++) {
      g.beginPath(); const cx = x + 8 + Math.random() * (w / 6 - 16);
      for (let y = 0; y <= h; y += 8) g.lineTo(cx + Math.sin(y * 0.04 + k) * 4, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(70,45,20,.55)'; g.fillRect(x, 0, 1.5, h);
  }
});
const texSiding = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#e4ddcf'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) { g.fillStyle = 'rgba(120,110,95,.45)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(0, y + 2, w, 1); }
  noise(g, w, h, 1500, 0.15, ['#999', '#fff']);
});
const texFusuma = canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = '#efe7d2'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 900, 0.25, ['#d6c9a6', '#fffaf0']);
  // 下の方に淡い山の柄
  g.fillStyle = 'rgba(150,170,160,.35)';
  g.beginPath(); g.moveTo(0, 200); g.quadraticCurveTo(40, 150, 70, 190); g.quadraticCurveTo(100, 160, 128, 185); g.lineTo(128, 256); g.lineTo(0, 256); g.fill();
  g.strokeStyle = '#3a2a1a'; g.lineWidth = 7; g.strokeRect(3.5, 3.5, w - 7, h - 7);
  g.fillStyle = '#5b4a35'; g.beginPath(); g.ellipse(w - 22, h * 0.5, 6, 9, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b2118'; g.beginPath(); g.ellipse(w - 22, h * 0.5, 3.5, 6, 0, 0, Math.PI * 2); g.fill();
}, false);
const texShoji = canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = '#f7f4ea'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 500, 0.15, ['#e8e0c8']);
  g.fillStyle = '#c8a878';
  for (let i = 0; i <= 3; i++) g.fillRect((i * (w - 6)) / 3, 0, 6, h);
  for (let j = 0; j <= 6; j++) g.fillRect(0, (j * (h - 6)) / 6, w, 6);
}, false);
const texRoof = canvasTex(128, 128, (g, w, h) => { // 瓦
  g.fillStyle = '#4a5058'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) {
    g.fillStyle = '#5c636c'; g.fillRect(0, y, w, 6);
    for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + ((y / 32) % 2) * 16, y, 2, 32); }
  }
  noise(g, w, h, 400, 0.2, ['#222', '#777']);
});
const texGrating = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#4c4f52'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#a7aaa8';
  for (let i = 0; i < 16; i++) g.fillRect(i * 8, 0, 5, h);
  for (let j = 0; j < 4; j++) g.fillRect(0, j * 32, w, 3);
});
const texGrass = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#6f9e4c'; g.fillRect(0, 0, w, h); noise(g, w, h, 5000, 0.4, ['#557f36', '#88b862', '#5e8f40']); });
const texConc = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#c4c2bc'; g.fillRect(0, 0, w, h); g.strokeStyle = '#9d9b95'; g.strokeRect(0.5, 0.5, 127, 127); noise(g, w, h, 800, 0.2, ['#888', '#eee']); });
const texAsphalt = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#6c6c6a'; g.fillRect(0, 0, w, h); noise(g, w, h, 4000, 0.35, ['#555', '#888']); });
const texBlock = canvasTex(128, 64, (g, w, h) => {
  g.fillStyle = '#b9b6ae'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#8e8b84'; g.fillRect(0, 31, w, 2); g.fillRect(0, 0, w, 1); g.fillRect(63, 0, 2, 32); g.fillRect(0, 32, 1, 32); g.fillRect(127, 32, 1, 32);
  noise(g, w, h, 500, 0.2, ['#777', '#ddd']);
});

// 畳: 部屋ごとの敷き方(半畳=1マス)。[x, y, w, h] / board=板の間
const TATAMI = {
  j45: { u: [3, 3], mats: [[0, 0, 2, 1], [2, 0, 1, 2], [1, 2, 2, 1], [0, 1, 1, 2], [1, 1, 1, 1]] },
  j6: { u: [4, 3], mats: [[0, 0, 1, 2], [1, 0, 2, 1], [3, 0, 1, 2], [1, 1, 2, 1], [0, 2, 2, 1], [2, 2, 2, 1]] },
  j7: { u: [4, 4], mats: [[0, 0, 2, 1], [2, 0, 2, 1], [0, 1, 1, 2], [1, 1, 2, 1], [1, 2, 2, 1], [3, 1, 1, 2], [0, 3, 2, 1]], board: [[2, 3, 2, 1]] },
};
function tatamiTex(layout, W, D) {
  const L = TATAMI[layout];
  const ppm = 110;
  const cw = Math.round(W * ppm), ch = Math.round(D * ppm);
  return canvasTex(cw, ch, (g) => {
    const ux = cw / L.u[0], uy = ch / L.u[1];
    for (const [mx, my, mw, mh] of L.board || []) {
      const x = mx * ux, y = my * uy, w = mw * ux, h = mh * uy;
      for (let i = 0; i < 5; i++) { g.fillStyle = ['#8a5a32', '#93633a', '#7f532d'][i % 3]; g.fillRect(x, y + (i * h) / 5, w, h / 5); g.fillStyle = 'rgba(40,20,5,.5)'; g.fillRect(x, y + (i * h) / 5, w, 1); }
    }
    for (const [mx, my, mw, mh] of L.mats) {
      const x = mx * ux, y = my * uy, w = mw * ux, h = mh * uy;
      const horiz = w >= h; // 長辺の向き
      const hue = 0.9 + Math.random() * 0.1;
      g.fillStyle = `rgb(${Math.round(196 * hue)},${Math.round(190 * hue)},${Math.round(122 * hue)})`;
      g.fillRect(x, y, w, h);
      // 畳目(短辺に平行な細い線)
      g.fillStyle = 'rgba(120,115,60,.28)';
      if (horiz) for (let k = 0; k < w; k += 3) g.fillRect(x + k, y, 1, h);
      else for (let k = 0; k < h; k += 3) g.fillRect(x, y + k, w, 1);
      // 畳縁(長辺側)
      g.fillStyle = '#2d3a2a';
      const b = 4;
      if (horiz) { g.fillRect(x, y, w, b); g.fillRect(x, y + h - b, w, b); }
      else { g.fillRect(x, y, b, h); g.fillRect(x + w - b, y, b, h); }
      g.strokeStyle = 'rgba(60,55,30,.6)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }, false);
}

// ============================================================
// ボックスをマテリアルごとにInstancedMeshへ
// ============================================================
const mats = {};
const M = (key, color, extra = {}) => (mats[key] = { mat: new THREE.MeshLambertMaterial({ color, ...extra }), list: [] });
M('plaster', 0xffffff, { map: texPlaster }); M('siding', 0xffffff, { map: texSiding });
M('pillar', 0xc9a06a); M('nageshi', 0xbf955f); M('dark', 0x3a2a1c); M('alu', 0xb9bcbe); M('aluDark', 0x6b6e70);
M('fusuma', 0xffffff, { map: texFusuma }); M('shoji', 0xffffff, { map: texShoji, emissive: 0x3a3830 });
M('door', 0xd9c3a0); M('ceilW', 0xffffff, { map: texCeil }); M('ceilWhite', 0xf3f1ea);
M('step', 0xb68650); M('futon1', 0xf0ece0); M('futon2', 0xd88a8a); M('futon3', 0x7d9cc4); M('case', 0xe8e8e8);
M('zabuton', 0x8a2e36); M('table', 0x5e3a1e); M('tansu', 0x7a4a26); M('metal', 0x2a2a2a); M('tv', 0x111111);
M('lampShade', 0xfff8e6, { emissive: 0xbfa880 }); M('toilet', 0xfafafa); M('toiletFloor', 0xe8e2d4);
M('rail', 0x9a9c9c); M('grating', 0xffffff, { map: texGrating }); M('balFloor', 0x9fa3a3); M('eave', 0x4d4f52);
M('block', 0xffffff, { map: texBlock }); M('glassDark', 0x3b4a58); M('trunk', 0x6b4a2b); M('leaf', 0x3f8a3a);
M('pot', 0xb5653a); M('plant', 0x4f9a3e); M('nhouse', 0xd8d2c4); M('nhouse2', 0xc9d4d8); M('nhouse3', 0xe6dccb);
M('cloth1', 0x6fa8dc); M('cloth2', 0xffffff); M('cloth3', 0xe9b949);

const colliders = []; // {x0,z0,x1,z1,y0,y1}
function box(key, cx, cy, cz, w, h, d, solid = false) {
  mats[key].list.push([cx, cy, cz, w, h, d]);
  if (solid) colliders.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2, y0: cy - h / 2, y1: cy + h / 2 });
}
const boxB = (key, cx, y0, cz, w, h, d, solid) => box(key, cx, y0 + h / 2, cz, w, h, d, solid);
const addCol = (x0, z0, x1, z1, y0 = -9, y1 = 9) => colliders.push({ x0, z0, x1, z1, y0, y1 });

const glass = []; // [geometry, frosted]

// ============================================================
// 壁
// ============================================================
// 壁の線を開口部で切り分ける。off=法線方向へのずらし、ext=線の両端の延長
function wallLine(w, { y0 = 0, y1 = CEIL, key = 'plaster', th = 0.1, off = 0, ext = 0.05, collide = true } = {}) {
  const { o, c, a, b } = w;
  const ops = openings.filter((p) => p.o === o && Math.abs(p.c - c) < 0.01 && p.b > a + 1e-3 && p.a < b - 1e-3).sort((p, q) => p.a - q.a);
  const segs = [];
  let cur = a;
  for (const p of ops) { if (p.a > cur) segs.push([cur, p.a, null]); segs.push([p.a, p.b, p]); cur = p.b; }
  if (cur < b) segs.push([cur, b, null]);
  const cc = c + off;
  const piece = (s0, s1, ya, yb, solid) => {
    if (yb - ya < 0.005 || s1 - s0 < 0.005) return;
    const mid = (s0 + s1) / 2, L = s1 - s0;
    if (o === 'h') boxB(key, mid, ya, cc, L, yb - ya, th, solid);
    else boxB(key, cc, ya, mid, th, yb - ya, L, solid);
  };
  for (const [s0, s1, p] of segs) {
    const e0 = s0 === a ? s0 - ext : s0, e1 = s1 === b ? s1 + ext : s1;
    if (!p) { piece(e0, e1, y0, y1, collide); continue; }
    piece(s0, s1, y0, Math.max(y0, p.y0), false);
    piece(s0, s1, Math.min(y1, p.y1), y1, false);
    if (collide && p.y0 > 0.3) {
      if (o === 'h') addCol(s0, cc - th / 2, s1, cc + th / 2, -9, 9);
      else addCol(cc - th / 2, s0, cc + th / 2, s1, -9, 9);
    }
  }
}
for (const w of extWalls) {
  wallLine(w, { off: -w.out * 0.03, th: 0.1 });
  wallLine(w, { key: 'siding', y0: GROUND, y1: 2.55, th: 0.06, off: w.out * 0.07, ext: 0.13, collide: false });
}
for (const w of intWalls) wallLine(w);

// 柱: 壁の端と、襖・戸の両脇
const pillarPts = new Set();
const addPillar = (x, z) => { const k = x.toFixed(2) + ',' + z.toFixed(2); if (pillarPts.has(k)) return; pillarPts.add(k); boxB('pillar', x, 0, z, 0.105, CEIL, 0.105); };
for (const w of [...extWalls, ...intWalls]) {
  const off = w.out ? -w.out * 0.03 : 0;
  for (const p of [w.a, w.b]) w.o === 'h' ? addPillar(p, w.c + off) : addPillar(w.c + off, p);
}
for (const p of openings) if (p.kind !== 'window') for (const e of [p.a, p.b]) p.o === 'h' ? addPillar(e, p.c) : addPillar(p.c, e);

// 開口部の建具
function along(p, t) { return p.o === 'h' ? [t, p.c] : [p.c, t]; }
function panel(key, p, t0, t1, ya, yb, nOff, th = 0.03) {
  const L = t1 - t0, m = (t0 + t1) / 2;
  if (p.o === 'h') boxB(key, m, ya, p.c + nOff, L, yb - ya, th);
  else boxB(key, p.c + nOff, ya, m, th, yb - ya, L);
}
for (const p of openings) {
  const w = p.b - p.a, half = p.a + w / 2;
  // 鴨居・敷居
  if (p.kind !== 'door') {
    panel('nageshi', p, p.a, p.b, p.y1 - 0.04, p.y1, 0, 0.11);
    if (p.y0 < 0.1) panel('nageshi', p, p.a, p.b, 0, 0.015, 0, 0.11);
    else panel('nageshi', p, p.a, p.b, p.y0 - 0.03, p.y0, p.s * 0.03, 0.17);
  }
  if (p.kind === 'fusuma' || p.kind === 'closet') {
    // 襖2枚を片側に寄せて開けた状態
    panel('fusuma', p, p.a, half + 0.02, p.y0, p.y1 - 0.04, -0.02);
    panel('fusuma', p, p.a + 0.01, half + 0.03, p.y0, p.y1 - 0.04, 0.02);
    const [x0, z0] = along(p, p.a), [x1, z1] = along(p, half);
    addCol(Math.min(x0, x1) - 0.05, Math.min(z0, z1) - 0.05, Math.max(x0, x1) + 0.05, Math.max(z0, z1) + 0.05);
  } else if (p.kind === 'door') {
    // 開き戸(90度開いた状態)
    panel('door', p, p.a - 0.02, p.b + 0.02, p.y1, p.y1 + 0.05, 0, 0.12);
    for (const e of [p.a, p.b]) panel('door', p, e - 0.02, e + 0.02, 0, p.y1, 0, 0.12);
    const [hx, hz] = along(p, p.a + 0.03);
    if (p.o === 'h') boxB('door', hx, 0, hz + (p.s * w) / 2, 0.035, p.y1 - 0.02, w - 0.04, true);
    else boxB('door', hx + (p.s * w) / 2, 0, hz, w - 0.04, p.y1 - 0.02, 0.035, true);
  } else {
    // 窓 / 掃き出し窓: アルミサッシ+ガラス(+障子)
    const sweep = p.kind === 'sweep';
    const g0 = p.a, g1 = sweep ? half + 0.03 : p.b;
    const addGlass = (t0, t1, nOff) => {
      const L = t1 - t0, m = (t0 + t1) / 2, H = p.y1 - p.y0;
      const g = new THREE.PlaneGeometry(L, H);
      if (p.o === 'v') g.rotateY(Math.PI / 2);
      if (p.o === 'h') g.translate(m, p.y0 + H / 2, p.c + nOff); else g.translate(p.c + nOff, p.y0 + H / 2, m);
      glass.push([g, !!p.frosted]);
      panel('alu', p, t0, t1, p.y0, p.y0 + 0.035, nOff, 0.04);
      panel('alu', p, t0, t1, p.y1 - 0.035, p.y1, nOff, 0.04);
      panel('alu', p, t0, t0 + 0.035, p.y0, p.y1, nOff, 0.04);
      panel('alu', p, t1 - 0.035, t1, p.y0, p.y1, nOff, 0.04);
    };
    if (sweep) { addGlass(g0, g1, -p.s * 0.06); addGlass(g0 + 0.02, g1 + 0.02, -p.s * 0.02); }
    else { addGlass(p.a, half + 0.02, -p.s * 0.06); addGlass(half - 0.02, p.b, -p.s * 0.02); }
    if (p.shoji || sweep) {
      // 障子は片側に寄せて半分開けておく
      panel('shoji', p, p.a, half + 0.02, p.y0, p.y1 - 0.04, p.s * 0.05, 0.025);
      panel('shoji', p, p.a + 0.01, half + 0.03, p.y0, p.y1 - 0.04, p.s * 0.08, 0.025);
    }
    if (sweep) {
      const [x0, z0] = along(p, p.a), [x1, z1] = along(p, half + 0.03);
      addCol(Math.min(x0, x1) - 0.12, Math.min(z0, z1) - 0.12, Math.max(x0, x1) + 0.12, Math.max(z0, z1) + 0.12);
    }
  }
}

// ============================================================
// 床・天井・部屋ごとの造作
// ============================================================
function plane(mat, x0, z0, x1, z1, y, tile = 0, down = false) {
  const w = x1 - x0, d = z1 - z0;
  const g = new THREE.PlaneGeometry(w, d);
  if (tile) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile); }
  g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const m = new THREE.Mesh(g, mat);
  scene.add(m);
  return m;
}
const lam = (o) => new THREE.MeshLambertMaterial(o);
const matFloor = lam({ map: texFloor }), matCeil = lam({ map: texCeil }), matCeilWhite = lam({ color: 0xf3f1ea });

for (const rm of rooms) {
  const [x0, z0, x1, z1] = rm.r;
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (rm.type === 'tatami') plane(lam({ map: tatamiTex(rm.layout, W, D) }), x0, z0, x1, z1, 0.0);
  else if (rm.type === 'hall' || rm.type === 'closet') plane(matFloor, x0, z0, x1, z1, 0.0, 1.6);
  else if (rm.type === 'toilet') plane(lam({ color: 0xe8e2d4 }), x0, z0, x1, z1, 0.0);
  plane(rm.type === 'tatami' ? matCeil : matCeilWhite, x0, z0, x1, z1, CEIL, rm.type === 'tatami' ? 1.8 : 0, true);

  if (rm.type === 'tatami') {
    // 長押と回り縁
    for (const [y, h, t] of [[1.8, 0.08, 0.04], [CEIL - 0.04, 0.04, 0.035]]) {
      boxB('nageshi', cx, y, z0 + 0.05 + t / 2, W - 0.1, h, t); boxB('nageshi', cx, y, z1 - 0.05 - t / 2, W - 0.1, h, t);
      boxB('nageshi', x0 + 0.05 + t / 2, y, cz, t, h, D - 0.1); boxB('nageshi', x1 - 0.05 - t / 2, y, cz, t, h, D - 0.1);
    }
    // 和風ペンダント照明
    boxB('metal', cx, 2.18, cz, 0.01, CEIL - 2.18, 0.01);
    boxB('lampShade', cx, 1.97, cz, 0.46, 0.2, 0.46);
    boxB('dark', cx, 2.16, cz, 0.5, 0.025, 0.5);
    boxB('dark', cx, 1.95, cz, 0.5, 0.025, 0.5);
    const lt = new THREE.PointLight(0xffe7c0, 0.9, 6, 1.5); lt.position.set(cx, 1.85, cz); scene.add(lt);
  }
  if (rm.type === 'closet') {
    // 押入: 中段+布団+衣装ケース。中には入れない
    boxB('nageshi', cx, 0.76, cz, W - 0.1, 0.04, D - 0.1);
    const fh = [0.12, 0.1, 0.12, 0.1];
    let y = 0.8;
    for (let i = 0; i < 4; i++) { boxB(['futon1', 'futon2', 'futon1', 'futon3'][i], cx - 0.02, y, cz, W - 0.2, fh[i], Math.min(D - 0.2, 1.0)); y += fh[i]; }
    for (let i = 0; i < Math.floor((D - 0.1) / 0.45); i++) boxB('case', cx - 0.05, 0, z0 + 0.28 + i * 0.45, W - 0.25, 0.3, 0.4);
    addCol(x0, z0, x1, z1);
  }
  if (rm.type === 'toilet') {
    const tx = cx + 0.02;
    boxB('toilet', tx, 0, z0 + 0.45, 0.36, 0.38, 0.5, true);
    boxB('toilet', tx, 0.38, z0 + 0.48, 0.4, 0.04, 0.48);
    boxB('toilet', tx, 0.4, z0 + 0.13, 0.44, 0.45, 0.2, true);
    boxB('alu', x0 + 0.08, 0.7, z0 + 0.7, 0.08, 0.1, 0.12);
    boxB('ceilWhite', tx, 1.6, z0 + 0.1, 0.6, 0.5, 0.18);
  }
}

// 家具
{
  // 6畳: 座卓と座布団
  const cx = 1.8, cz = 3.85;
  boxB('table', cx, 0.3, cz, 1.2, 0.035, 0.75, true);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) boxB('table', cx + sx * 0.52, 0, cz + sz * 0.3, 0.06, 0.3, 0.06);
  for (const [dx, dz] of [[-0.9, 0], [0.9, 0], [0, -0.7], [0, 0.7]]) boxB('zabuton', cx + dx, 0, cz + dz, 0.55, 0.07, 0.58);
  // 4.5畳: 文机と座布団
  boxB('table', 2.5, 0.3, 0.45, 0.9, 0.03, 0.45, true);
  for (const sx of [-1, 1]) boxB('table', 2.5 + sx * 0.42, 0, 0.45, 0.04, 0.3, 0.42);
  boxB('zabuton', 2.5, 0, 1.0, 0.55, 0.07, 0.58);
  // 7畳: 和箪笥、テレビ台、床の間風の板の間に花瓶
  boxB('tansu', 5.2, 0, 1.92, 1.0, 1.25, 0.45, true);
  for (let i = 0; i < 5; i++) { boxB('dark', 5.2, 0.1 + i * 0.24, 2.15, 0.96, 0.01, 0.01); boxB('metal', 5.2, 0.2 + i * 0.24, 2.155, 0.14, 0.03, 0.01); }
  boxB('table', 7.75, 0, 3.0, 0.45, 0.4, 1.2, true);
  boxB('tv', 7.8, 0.4, 3.0, 0.08, 0.6, 1.0);
  boxB('pot', 7.2, 0.0, 4.75, 0.2, 0.3, 0.2);
  boxB('plant', 7.2, 0.3, 4.75, 0.06, 0.4, 0.06);
  boxB('zabuton', 6.3, 0, 3.0, 0.55, 0.07, 0.58);
}

// ============================================================
// 階段
// ============================================================
for (let i = 0; i < ST.n; i++) {
  const top = -(i + 1) * ST.rise;
  boxB('step', ST.x0 + (i + 0.5) * ST.run, GROUND, (ST.z0 + ST.z1) / 2, ST.run, top - GROUND, ST.z1 - ST.z0);
}
// 吹き抜け部分の壁(床下)
boxB('plaster', (ST.x0 + ST.x1) / 2, GROUND, ST.z0 + 0.02, ST.x1 - ST.x0, -GROUND, 0.04);
boxB('plaster', (ST.x0 + ST.x1) / 2, GROUND, ST.z1 + 0.02, ST.x1 - ST.x0, -GROUND, 0.04);
boxB('plaster', ST.x1 - 0.02, GROUND, (ST.z0 + ST.z1) / 2, 0.04, -GROUND, ST.z1 - ST.z0);
boxB('nageshi', (ST.x0 + ST.x1) / 2, 0, ST.z1, ST.x1 - ST.x0, 0.03, 0.1);
// 手すり(踊り場側)と壁の手すり
for (let x = ST.x0 + 0.05; x <= ST.x1; x += 0.12) boxB('pillar', x, 0, ST.z1, 0.025, 0.85, 0.025);
boxB('pillar', (ST.x0 + ST.x1) / 2, 0.85, ST.z1, ST.x1 - ST.x0, 0.05, 0.06);
addCol(ST.x0, ST.z1 - 0.04, ST.x1, ST.z1 + 0.06);
{
  const g = new THREE.CylinderGeometry(0.02, 0.02, Math.hypot(ST.x1 - ST.x0, -GROUND), 8);
  const m = new THREE.Mesh(g, mats.pillar.mat);
  m.position.set((ST.x0 + ST.x1) / 2, GROUND / 2 + 0.8, ST.z0 + 0.06);
  m.rotation.z = Math.PI / 2 - Math.atan2(-GROUND, ST.x1 - ST.x0);
  scene.add(m);
}
plane(matFloor, ST.x0, ST.z0, ST.x1, ST.z1, GROUND + 0.001, 1.6);
// 吹き抜けの当たり判定(高さに関係なく効く)
addCol(ST.x0, -0.12, ST.x1, 0.02);
addCol(ST.x1 - 0.03, ST.z0, ST.x1 + 0.12, ST.z1);
{
  const sg = canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c03030'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#c03030'; g.font = 'bold 36px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('1階は準備中', w / 2, h / 2 + 2);
  }, false);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.28), new THREE.MeshBasicMaterial({ map: sg }));
  m.position.set(ST.x1 - 0.05, GROUND + 1.45, (ST.z0 + ST.z1) / 2); m.rotation.y = -Math.PI / 2; scene.add(m);
}
function floorHeight(x, z) {
  if (x > ST.x0 && x < ST.x1 + 0.3 && z > ST.z0 && z < ST.z1) return Math.max(GROUND, (-(x - ST.x0) / ST.run) * ST.rise);
  return 0;
}

// ============================================================
// バルコニー
// ============================================================
{
  const [x0, z0, x1, z1] = BAL_N;
  plane(lam({ map: texGrating }), x0, z0, x1, z1, 0.0, 0.5);
  const sk = { key: 'siding', th: 0.12, collide: true, ext: 0.06 };
  wallLine({ o: 'v', c: x0, a: z0, b: z1 }, { ...sk, y0: GROUND, y1: 1.1 });
  wallLine({ o: 'v', c: x1, a: z0, b: z1 }, { ...sk, y0: GROUND, y1: 1.1 });
  wallLine({ o: 'h', c: z0, a: x0, b: x1 }, { ...sk, y0: GROUND, y1: 1.1 });
  for (const w of [[x0, z0, x0, z1], [x1, z0, x1, z1], [x0, z0, x1, z0]]) {
    const [a, b, c, d] = w; boxB('alu', (a + c) / 2, 1.1, (b + d) / 2, Math.abs(c - a) + 0.14, 0.04, Math.abs(d - b) + 0.14);
  }
  boxB('siding', (x0 + x1) / 2, GROUND, (z0 + z1) / 2, x1 - x0, -GROUND - 0.02, z1 - z0);
  // 物干し
  for (const z of [z0 + 0.4, z1 - 0.4]) boxB('alu', x0 + 0.15, 0, z, 0.05, 1.6, 0.05, true);
  boxB('alu', x0 + 0.15, 1.6, (z0 + z1) / 2, 0.04, 0.04, z1 - z0 - 0.6);
  boxB('pot', x1 - 0.3, 0, z0 + 0.4, 0.3, 0.28, 0.3, true); boxB('plant', x1 - 0.3, 0.28, z0 + 0.4, 0.35, 0.3, 0.35);
}
{
  const [x0, z0, x1, z1] = BAL_S;
  boxB('balFloor', (x0 + x1) / 2, -0.18, (z0 + z1) / 2, x1 - x0, 0.18, z1 - z0);
  for (const [px, pz] of [[x0, z1], [x1, z1]]) boxB('aluDark', px, GROUND, pz, 0.1, -GROUND - 0.18, 0.1);
  const rail = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 0.11);
    for (let i = 0; i <= n; i++) { const t = i / n; boxB('rail', ax + (bx - ax) * t, 0, az + (bz - az) * t, 0.02, 1.1, 0.02); }
    boxB('rail', (ax + bx) / 2, 1.1, (az + bz) / 2, Math.abs(bx - ax) + 0.05, 0.05, Math.abs(bz - az) + 0.05);
    addCol(Math.min(ax, bx) - 0.04, Math.min(az, bz) - 0.04, Math.max(ax, bx) + 0.04, Math.max(az, bz) + 0.04);
  };
  rail(x0, z1, x1, z1); rail(x0, z0, x0, z1); rail(x1, z0, x1, z1);
  // 物干し竿と洗濯物
  for (const x of [x0 + 0.4, x1 - 0.4]) boxB('alu', x, 0, z1 - 0.35, 0.05, 1.7, 0.05, true);
  boxB('alu', (x0 + x1) / 2, 1.7, z1 - 0.35, x1 - x0 - 0.8, 0.035, 0.035);
  const cl = ['cloth1', 'cloth2', 'cloth3', 'cloth2', 'cloth1'];
  for (let i = 0; i < 5; i++) boxB(cl[i], x0 + 1.0 + i * 0.55, 1.05, z1 - 0.35, 0.4, 0.62, 0.015);
}

// ============================================================
// 外観: 1階部分・屋根・敷地
// ============================================================
// 1階(下の階)のかたまり
// (中の階段から見下ろしても塞がらないよう、箱ではなく4面の壁で作る)
{
  const W = 8.565, Dp = 5.17, H = -GROUND - 0.25;
  boxB('siding', W / 2, GROUND, -0.06, W + 0.2, H, 0.08); boxB('siding', W / 2, GROUND, Dp + 0.06, W + 0.2, H, 0.08);
  boxB('siding', -0.06, GROUND, Dp / 2, 0.08, H, Dp + 0.2); boxB('siding', W + 0.06, GROUND, Dp / 2, 0.08, H, Dp + 0.2);
  // 1階と2階の間の帯(胴差し)
  boxB('eave', W / 2, -0.3, -0.12, W + 0.36, 0.12, 0.12); boxB('eave', W / 2, -0.3, Dp + 0.12, W + 0.36, 0.12, 0.12);
  boxB('eave', -0.12, -0.3, Dp / 2, 0.12, 0.12, Dp + 0.36); boxB('eave', W + 0.12, -0.3, Dp / 2, 0.12, 0.12, Dp + 0.36);
}
// 1階の窓(外観用)
for (const [x, z, w, o] of [[1.6, 5.29, 1.6, 'h'], [6.5, 5.29, 1.8, 'h'], [-0.12, 1.5, 1.2, 'v'], [8.68, 3.5, 1.2, 'v']]) {
  if (o === 'h') { boxB('glassDark', x, GROUND + 0.9, z, w, 1.1, 0.04); boxB('alu', x, GROUND + 0.86, z + 0.02, w + 0.06, 0.04, 0.06); }
  else { boxB('glassDark', x, GROUND + 0.9, z, 0.04, 1.1, w); boxB('alu', x - 0.02, GROUND + 0.86, z, 0.06, 0.04, w + 0.06); }
}
boxB('dark', 4.05, GROUND, 5.29, 1.0, 2.0, 0.05); // 玄関戸
// 寄棟屋根
{
  const ev = 0.6, yb = 2.5, rx0 = -ev, rz0 = -ev, rx1 = 8.565 + ev, rz1 = 5.17 + ev;
  const d = (rz1 - rz0) / 2, H = d * 0.45, zm = (rz0 + rz1) / 2, yt = yb + H;
  const P = (x, y, z) => [x, y, z];
  const A = P(rx0, yb, rz0), B = P(rx1, yb, rz0), C = P(rx1, yb, rz1), Dd = P(rx0, yb, rz1), E = P(rx0 + d, yt, zm), F = P(rx1 - d, yt, zm);
  const tris = [[Dd, C, F], [Dd, F, E], [B, A, E], [B, E, F], [A, Dd, E], [C, B, F]];
  const pos = [], uv = [];
  for (const t of tris) for (const v of t) { pos.push(...v); uv.push(v[0] / 1.2, (v[2] + v[1]) / 1.2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, lam({ map: texRoof, side: THREE.DoubleSide })));
  plane(lam({ color: 0xe9e4da }), rx0, rz0, rx1, rz1, yb - 0.01, 0, true); // 軒裏
  boxB('siding', 8.565 / 2, 2.4, 5.17 / 2, 8.565, 0.1, 5.17);
}
// 敷地
plane(lam({ map: texGrass }), -40, -40, 50, 50, GROUND - 0.01, 3);
plane(lam({ map: texConc }), -1.5, -4, 10.5, 9, GROUND, 1.2);
plane(lam({ map: texAsphalt }), -40, 12, 50, 18, GROUND + 0.005, 4);
{
  const bw = (ax, az, bx, bz) => boxB('block', (ax + bx) / 2, GROUND, (az + bz) / 2, Math.abs(bx - ax) + 0.12, 1.2, Math.abs(bz - az) + 0.12);
  bw(-4, -6, 13, -6); bw(-4, -6, -4, 11.5); bw(13, -6, 13, 11.5); bw(-4, 11.5, 2.5, 11.5); bw(5.5, 11.5, 13, 11.5);
  // 庭木
  const tree = (x, z, s) => {
    boxB('trunk', x, GROUND, z, 0.18 * s, 1.8 * s, 0.18 * s);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0 * s, 1), mats.leaf.mat); m.position.set(x, GROUND + 2.2 * s, z); scene.add(m);
  };
  tree(-2.6, 8.5, 1.3); tree(11.5, 9, 1.1); tree(11.5, -4.5, 1.5); tree(-2.5, -4.5, 1.2);
  // 近所の家
  const house = (x, z, w, d, h, key) => {
    boxB(key, x, GROUND, z, w, h, d);
    const g = new THREE.CylinderGeometry(0.01, (w / 2) * 1.15, h * 0.35, 4, 1);
    g.rotateY(Math.PI / 4); g.scale(1, 1, d / w);
    const r = new THREE.Mesh(g, lam({ map: texRoof })); r.position.set(x, GROUND + h + h * 0.175, z); scene.add(r);
    for (let i = 0; i < 3; i++) boxB('glassDark', x - w / 3 + (i * w) / 3, GROUND + h * 0.6, z + d / 2 + 0.02, 1.0, 0.9, 0.04);
  };
  house(-12, 1, 8, 7, 5.6, 'nhouse'); house(22, 2, 9, 8, 5.8, 'nhouse2'); house(4, -16, 10, 7, 5.5, 'nhouse3');
  house(-9, 24, 8, 7, 5.6, 'nhouse2'); house(6, 24, 9, 7, 5.8, 'nhouse'); house(21, 24, 8, 7, 5.4, 'nhouse3');
  for (let x = -38; x < 50; x += 6) { boxB('aluDark', x, GROUND, 12.3, 0.25, 7, 0.25); }
}

// ============================================================
// メッシュ化
// ============================================================
const geoBox = new THREE.BoxGeometry(1, 1, 1);
{
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (const k in mats) {
    const { mat, list } = mats[k];
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(geoBox, mat, list.length);
    list.forEach(([x, y, z, w, h, d], i) => { p.set(x, y, z); s.set(w, h, d); m4.compose(p, q, s); im.setMatrixAt(i, m4); });
    scene.add(im);
  }
  const gm = lam({ color: 0xcfe8f5, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const fm = lam({ color: 0xf2f4f4, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  for (const [g, frosted] of glass) { const m = new THREE.Mesh(g, frosted ? fm : gm); m.renderOrder = 2; scene.add(m); }
}

// ============================================================
// 操作(学校と同じ: 左下ドラッグ=移動 / それ以外=視点)
// ============================================================
const player = { x: 4.04, z: 4.7, y: 0, yaw: 0, pitch: -0.05, bob: 0 };
const R = 0.2;
const stickEl = document.getElementById('stickBase'), nubEl = document.getElementById('nub');
const stick = { id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
const look = { id: null, lx: 0, ly: 0 };
const STICK_R = 50;
function homeStick() { stickEl.style.left = Math.min(110, innerWidth * 0.25) + 'px'; stickEl.style.top = innerHeight - 140 + 'px'; }
homeStick(); addEventListener('resize', homeStick);
const mapEl = document.getElementById('map');
canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 合成イベント等 */ }
  const isStick = e.pointerType !== 'mouse' && e.clientX < innerWidth * 0.55 && e.clientY > innerHeight * 0.55;
  if (isStick && stick.id === null) {
    stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.dx = stick.dy = 0;
    stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px'; stickEl.classList.add('on');
  } else if (look.id === null) { look.id = e.pointerId; look.lx = e.clientX; look.ly = e.clientY; }
  hideHelp();
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === stick.id) {
    let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
    const l = Math.hypot(dx, dy);
    if (l > STICK_R) { dx *= STICK_R / l; dy *= STICK_R / l; }
    stick.dx = dx / STICK_R; stick.dy = dy / STICK_R;
    nubEl.style.transform = `translate(${dx}px,${dy}px)`;
  } else if (e.pointerId === look.id) {
    const k = e.pointerType === 'mouse' ? 0.004 : 0.006;
    player.yaw -= (e.clientX - look.lx) * k;
    player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch - (e.clientY - look.ly) * k));
    look.lx = e.clientX; look.ly = e.clientY;
  }
});
function endPtr(e) {
  if (e.pointerId === stick.id) { stick.id = null; stick.dx = stick.dy = 0; nubEl.style.transform = ''; stickEl.classList.remove('on'); homeStick(); }
  if (e.pointerId === look.id) look.id = null;
}
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; hideHelp(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
let helpHidden = false;
function hideHelp() { if (helpHidden) return; helpHidden = true; setTimeout(() => (document.getElementById('help').style.opacity = 0), 4000); }
mapEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); mapEl.classList.toggle('big'); });

function collide() {
  const fy = player.y;
  for (let it = 0; it < 3; it++) {
    for (const c of colliders) {
      if (fy + 1.4 < c.y0 || fy + 0.15 > c.y1) continue; // 高さが合わないもの(床下の家具など)は無視
      const nx = Math.max(c.x0, Math.min(player.x, c.x1)), nz = Math.max(c.z0, Math.min(player.z, c.z1));
      const dx = player.x - nx, dz = player.z - nz, d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); player.x += (dx / d) * (R - d); player.z += (dz / d) * (R - d); }
      else {
        const pen = [player.x - c.x0, c.x1 - player.x, player.z - c.z0, c.z1 - player.z];
        const i = pen.indexOf(Math.min(...pen));
        if (i === 0) player.x = c.x0 - R; else if (i === 1) player.x = c.x1 + R; else if (i === 2) player.z = c.z0 - R; else player.z = c.z1 + R;
      }
    }
  }
}

// 現在地・ミニマップ
const areaEl = document.getElementById('area');
const inR = (r) => player.x >= r[0] && player.x <= r[2] && player.z >= r[1] && player.z <= r[3];
function areaName() {
  for (const rm of rooms) if (inR(rm.r)) return rm.name;
  if (inR(BAL_N)) return 'バルコニー(北)';
  if (inR(BAL_S)) return 'バルコニー(南)';
  return '2階';
}
const MX0 = -0.5, MZ0 = -3.1, MX1 = 9.1, MZ1 = 7.3;
const mctx = mapEl.getContext('2d');
mapEl.width = 420; mapEl.height = Math.round((420 * (MZ1 - MZ0)) / (MX1 - MX0));
const mk = mapEl.width / (MX1 - MX0);
const mapBase = document.createElement('canvas');
mapBase.width = mapEl.width; mapBase.height = mapEl.height;
{
  const g = mapBase.getContext('2d');
  const rr = (r, fill) => { g.fillStyle = fill; g.fillRect((r[0] - MX0) * mk, (r[1] - MZ0) * mk, (r[2] - r[0]) * mk, (r[3] - r[1]) * mk); g.strokeStyle = '#333'; g.lineWidth = 2; g.strokeRect((r[0] - MX0) * mk, (r[1] - MZ0) * mk, (r[2] - r[0]) * mk, (r[3] - r[1]) * mk); };
  rr(BAL_N, 'rgba(200,200,190,.85)'); rr(BAL_S, 'rgba(200,200,190,.6)');
  const col = { tatami: 'rgba(150,215,120,.92)', closet: 'rgba(210,205,190,.92)', hall: 'rgba(230,195,140,.92)', stair: 'rgba(255,255,255,.92)', toilet: 'rgba(190,225,240,.92)' };
  for (const rm of rooms) rr(rm.r, col[rm.type]);
  g.fillStyle = '#123'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 22px sans-serif';
  for (const rm of rooms) if (rm.type === 'tatami') { const [a, b, c, d] = rm.r; g.fillText(rm.name.replace('和室 ', ''), ((a + c) / 2 - MX0) * mk, ((b + d) / 2 - MZ0) * mk); }
  g.font = 'bold 15px sans-serif';
  g.fillText('押入', (0.4 - MX0) * mk, (0.86 - MZ0) * mk);
  g.fillText('階段', (6.1 - MX0) * mk, (0.44 - MZ0) * mk);
  g.fillText('WC', (8.17 - MX0) * mk, (0.8 - MZ0) * mk);
}
function drawMap() {
  mctx.clearRect(0, 0, mapEl.width, mapEl.height);
  mctx.drawImage(mapBase, 0, 0);
  mctx.save(); mctx.translate((player.x - MX0) * mk, (player.z - MZ0) * mk); mctx.rotate(-player.yaw);
  mctx.fillStyle = '#ff3b3b'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.moveTo(0, -13); mctx.lineTo(8, 8); mctx.lineTo(0, 3); mctx.lineTo(-8, 8); mctx.closePath(); mctx.fill(); mctx.stroke();
  mctx.restore();
}

// ループ
let last = performance.now(), lastArea = '';
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let fx = -stick.dy, sx = stick.dx;
  if (keys.KeyW || keys.ArrowUp) fx += 1;
  if (keys.KeyS || keys.ArrowDown) fx -= 1;
  if (keys.KeyD) sx += 1;
  if (keys.KeyA) sx -= 1;
  if (keys.ArrowLeft) player.yaw += 2 * dt;
  if (keys.ArrowRight) player.yaw -= 2 * dt;
  const mag = Math.min(1, Math.hypot(fx, sx));
  if (mag > 0.08) {
    const run = keys.ShiftLeft || mag > 0.92;
    const sp = (run ? 2.6 : 1.3) * Math.min(1, mag * 1.2);
    const l = Math.hypot(fx, sx), f = fx / l, s = sx / l;
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    player.x += (-sin * f + cos * s) * sp * dt;
    player.z += (-cos * f - sin * s) * sp * dt;
    player.bob += sp * dt * 2.4;
    collide();
  }
  const target = floorHeight(player.x, player.z);
  player.y += (target - player.y) * Math.min(1, dt * 12);
  camera.position.set(player.x, player.y + EYE + Math.sin(player.bob * 2) * 0.02, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  const a = areaName();
  if (a !== lastArea) { areaEl.textContent = a; lastArea = a; }
  drawMap();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__player = player;
