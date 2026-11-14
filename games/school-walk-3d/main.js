import * as THREE from 'three';

// ============================================================
// 間取りデータ(手描きの1階平面図の座標をそのままピクセル単位で記述)
// 1px = S メートル。方眼1マス ≒ 25px ≒ 1.1m
// ============================================================
const S = 0.045;
const OX = 1500, OY = 800;
const X = (px) => (px - OX) * S;
const Z = (py) => (py - OY) * S;

const WALL_H = 3.0;
const DOOR_H = 2.1;
const T = 0.16; // 壁の厚み(m)

// 部屋: r=[x0,y0,x1,y1](px), walls=壁を立てる辺, win=窓のある辺
const rooms = [
  { name: '1年1組', r: [1180, 180, 1380, 380], type: 'class', win: 'NEW' },
  { name: '1年2組', r: [1180, 380, 1310, 495], type: 'class', win: 'W' },
  { name: 'トイレ', r: [1180, 495, 1310, 565], type: 'toilet', win: 'W' },
  { name: '西口', r: [1180, 565, 1310, 630], type: 'hall' },
  { name: '理科準備室', r: [1200, 630, 1310, 715], type: 'store', win: 'W' },
  { name: '理科室2', r: [1200, 715, 1310, 805], type: 'lab', win: 'W' },
  { name: '理科室1', r: [1200, 805, 1310, 900], type: 'lab', win: 'W' },
  { name: '音楽室', r: [1200, 900, 1310, 1005], type: 'music', win: 'W' },
  { name: '西廊下', r: [1310, 380, 1380, 1005], type: 'corr', walls: 'EW', win: 'E' },
  { name: '北廊下', r: [1380, 560, 1880, 615], type: 'corr', walls: 'NSE', win: 'NS' },
  { name: '家庭科室', r: [1715, 615, 1800, 710], type: 'kitchen', win: 'W' },
  { name: '図工室', r: [1715, 710, 1800, 800], type: 'art', win: 'W' },
  { name: '図書室', r: [1715, 800, 1800, 900], type: 'lib', win: 'W' },
  { name: '給食室', r: [1715, 900, 1800, 1005], type: 'kitchen', win: 'W' },
  { name: '東廊下', r: [1800, 615, 1880, 845], type: 'corr', walls: 'E', win: 'E' },
  { name: '保健室', r: [1800, 845, 1880, 900], type: 'health' },
  { name: '東廊下', r: [1800, 900, 1880, 1005], type: 'corr', walls: 'E' },
  { name: '階段(北)', r: [1880, 615, 1950, 700], type: 'stair', walls: 'NES', win: 'E' },
  { name: '階段(南)', r: [1880, 900, 1960, 990], type: 'stair', walls: 'NES', win: 'E' },
  { name: '南廊下', r: [1105, 1005, 1890, 1070], type: 'corr', win: 'N' },
  { name: '昇降口', r: [1380, 1070, 1720, 1300], type: 'entrance', walls: 'S' },
  { name: '事務室', r: [1290, 1070, 1380, 1300], type: 'office2', win: 'WS' },
  { name: '職員室', r: [1720, 1070, 1890, 1380], type: 'office', win: 'ES' },
  { name: '倉庫', r: [1115, 1070, 1265, 1205], type: 'store', win: 'S' },
  { name: '体育館', r: [615, 1005, 1090, 1325], type: 'gym', h: 7, win: 'NESW' },
  { name: '更衣室', r: [500, 1200, 555, 1360], type: 'toilet', h: 2.6 },
  { name: '体育倉庫', r: [1300, 35, 1375, 110], type: 'store', h: 2.6 },
];

// 開口部: o='h' は水平な壁(y=c)上の x=a..a+w、'v' は垂直な壁(x=c)上の y=a..a+w
// kind: 'door'(上に垂れ壁あり) / 'open'(天井まで抜け)
const openings = [];
const D = (c, a, o, w, label, kind = 'door', dh = DOOR_H) => openings.push({ c, a, b: a + w, o, label, kind, dh });
D(380, 1325, 'h', 45, '1年1組');
D(1310, 415, 'v', 40, '1年2組');
D(1310, 515, 'v', 30, 'トイレ');
D(1180, 580, 'v', 40, null);
D(1310, 580, 'v', 40, '西口');
D(1310, 655, 'v', 35, '理科準備室');
D(1310, 740, 'v', 40, '理科室2');
D(1310, 830, 'v', 40, '理科室1');
D(1310, 930, 'v', 40, '音楽室');
D(1005, 1310, 'h', 70, null, 'open');
D(1005, 1800, 'h', 80, null, 'open');
D(1380, 560, 'v', 55, null, 'open');
D(615, 1800, 'h', 80, null, 'open');
D(1380, 790, 'v', 40, '中庭');
D(1005, 1530, 'h', 45, '中庭');
D(1800, 640, 'v', 40, '家庭科室');
D(1800, 735, 'v', 40, '図工室');
D(1800, 805, 'v', 35, '図書室');
D(1800, 940, 'v', 40, '給食室');
D(845, 1820, 'h', 40, '保健室');
D(900, 1820, 'h', 40, '保健室');
D(1880, 625, 'v', 70, null, 'open');
D(1880, 905, 'v', 80, null, 'open');
D(1105, 1018, 'v', 40, null);
D(1890, 1018, 'v', 40, null);
D(1070, 1385, 'h', 330, null, 'open');
D(1300, 1440, 'h', 220, null, 'door', 2.5);
D(1070, 1740, 'h', 40, '職員室');
D(1720, 1110, 'v', 40, '職員室');
D(1380, 1110, 'v', 35, '事務室');
D(1070, 1170, 'h', 40, '倉庫');
D(1090, 1045, 'v', 60, null, 'door', 2.6);
D(1005, 820, 'h', 70, null, 'door', 2.6);
D(1325, 820, 'h', 70, null, 'door', 2.6);
D(500, 1240, 'v', 30, null);
D(110, 1320, 'h', 35, null);

// 屋外エリア(現在地表示用)
const outdoorZones = [
  { name: '中庭', r: [1380, 615, 1715, 1005] },
  { name: 'プール', r: [195, 1005, 500, 1465] },
  { name: '校庭', r: [130, 65, 1170, 920] },
  { name: '花壇', r: [1390, 430, 1880, 560] },
  { name: '昇降口前', r: [1380, 1300, 1720, 1460] },
];

// ============================================================
// three.js 基本セットアップ
// ============================================================
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc8ea);
scene.fog = new THREE.Fog(0x9cc8ea, 40, 110);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 1.4));
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.3);
sun.position.set(-30, 50, 20);
scene.add(sun);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 75 : 60;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ============================================================
// テクスチャ(canvasで生成)
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
function noise(g, w, h, n, a, cols) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    g.globalAlpha = a * Math.random();
    g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  g.globalAlpha = 1;
}
const texWood = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c69c6d'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#bd925f' : '#cfa676'; g.fillRect(0, i * 32, w, 31);
    g.fillStyle = '#9c7347'; g.fillRect(0, i * 32 + 31, w, 1);
    const off = (i * 97) % 256; g.fillRect(off, i * 32, 1, 32);
  }
  noise(g, w, h, 600, 0.25, ['#8a6440', '#e0bb8c']);
});
const texTile = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#d9dcd2'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#c9ccc2'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  g.strokeStyle = '#b5b8ae'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, 127, 127); g.strokeRect(0.5, 0.5, 63, 63); g.strokeRect(64.5, 64.5, 63, 63);
  noise(g, w, h, 300, 0.15, ['#999', '#fff']);
});
const texDirt = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c8ac84'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 3000, 0.35, ['#a88b62', '#ddc59e', '#b89a70']);
});
const texGrass = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#6ea64a'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 4000, 0.4, ['#4d8a33', '#86bd5c', '#5f9940']);
});
const texAsphalt = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#8f8f8c'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 4000, 0.35, ['#6f6f6c', '#a9a9a5', '#7e7e7a']);
});
const texConcrete = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#cfcfca'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#aaa'; g.strokeRect(0.5, 0.5, 127, 127);
  noise(g, w, h, 800, 0.2, ['#999', '#eee']);
});
const texWater = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#3fa8d8'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2;
  for (let i = 0; i < 30; i++) { g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.quadraticCurveTo(x + 15, y - 6, x + 30, y); g.stroke(); }
});

// ============================================================
// ボックスをマテリアルごとにまとめてInstancedMeshにする
// ============================================================
const mats = {};
const M = (key, color, extra = {}) => (mats[key] = { mat: new THREE.MeshLambertMaterial({ color, ...extra }), list: [] });
M('wall', 0xf1ece0); M('wallLow', 0xd8cdb4); M('frame', 0x8c9aa3); M('ceil', 0xf6f6f2); M('roof', 0x9a9a95);
M('desk', 0xd8b483); M('deskLeg', 0x7d858c); M('chair', 0xb88d5d); M('board', 0x1f4f3a); M('boardFrame', 0x8a6a45);
M('lab', 0x2b2f33); M('labBody', 0xd9d4c4); M('piano', 0x111111); M('shelf', 0xa07a50); M('book1', 0xb83b3b); M('book2', 0x3b6bb8); M('book3', 0xd6b23a);
M('steel', 0xb8bfc4); M('bed', 0xffffff); M('bedFrame', 0x9fb7c6); M('stall', 0x9bc2d8); M('box', 0xbf9b6a);
M('locker', 0x9fb1bd); M('stage', 0x8c5f35); M('curtain', 0xa82222); M('hoop', 0xe86a1a); M('backboard', 0xf8f8f8);
M('stair', 0xc7c3b6); M('fence', 0x3f7a4a); M('pole', 0xd04a3a); M('poleY', 0x2f6fc0); M('trunk', 0x6b4a2b); M('leaf', 0x3f8f3a);
M('soil', 0x6b4a30); M('flower', 0xff6fa0); M('flower2', 0xffe14a); M('rim', 0xe8e8e2); M('goal', 0xffffff); M('sign', 0xffffff);
M('cage', 0x777777); M('door', 0xc9a978);

const colliders = []; // {x0,z0,x1,z1} メートル
function box(key, cx, cy, cz, w, h, d, solid = false) {
  mats[key].list.push([cx, cy, cz, w, h, d]);
  if (solid) colliders.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2, top: cy + h / 2 });
}
// 下端y0から高さh
const boxB = (key, cx, y0, cz, w, h, d, solid) => box(key, cx, y0 + h / 2, cz, w, h, d, solid);

const glassMat = new THREE.MeshLambertMaterial({ color: 0xbfe3f5, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
const glassGeoms = [];

// ============================================================
// 壁の生成
// ============================================================
// 水平/垂直の壁線を開口部で切り分けて立てる(座標はpx)
function buildWall(o, c, a, b, h, win) {
  const ops = openings.filter((op) => op.o === o && Math.abs(op.c - c) <= 4 && op.b > a && op.a < b).sort((p, q) => p.a - q.a);
  let cur = a;
  const segs = [];
  for (const op of ops) {
    if (op.a > cur) segs.push([cur, op.a, null]);
    segs.push([Math.max(op.a, cur), Math.min(op.b, b), op]);
    cur = Math.max(cur, op.b);
  }
  if (cur < b) segs.push([cur, b, null]);
  for (const [s0, s1, op] of segs) {
    if (s1 <= s0) continue;
    const L = (s1 - s0) * S;
    const mid = (s0 + s1) / 2;
    const place = (key, y0, hh, solid, len = L + (op ? 0 : T)) => {
      if (o === 'h') boxB(key, X(mid), y0, Z(c), len, hh, T, solid);
      else boxB(key, X(c), y0, Z(mid), T, hh, len, solid);
    };
    if (op) {
      if (op.kind === 'door' && h > op.dh) place('wall', op.dh, h - op.dh, false, L);
      if (op.kind === 'door') {
        // 戸枠
        const e0 = s0 * S, e1 = s1 * S;
        for (const e of [s0, s1]) {
          if (o === 'h') boxB('door', X(e), 0, Z(c), 0.06, op.dh, T + 0.04);
          else boxB('door', X(c), 0, Z(e), T + 0.04, op.dh, 0.06);
        }
        if (o === 'h') boxB('door', X(mid), op.dh - 0.06, Z(c), L, 0.06, T + 0.04);
        else boxB('door', X(c), op.dh - 0.06, Z(mid), T + 0.04, 0.06, L);
        void e0; void e1;
      }
      continue;
    }
    if (win && L > 1.4) {
      const wy0 = 0.9, wy1 = Math.min(2.3, h - 0.4);
      place('wallLow', 0, wy0, true);
      place('wall', wy1, h - wy1, false);
      // ガラスと窓枠
      const g = new THREE.PlaneGeometry(L, wy1 - wy0);
      if (o === 'v') g.rotateY(Math.PI / 2);
      g.translate(o === 'h' ? X(mid) : X(c), (wy0 + wy1) / 2, o === 'h' ? Z(c) : Z(mid));
      glassGeoms.push(g);
      const n = Math.max(1, Math.round(L / 1.8));
      for (let i = 0; i <= n; i++) {
        const p = s0 + ((s1 - s0) * i) / n;
        if (o === 'h') boxB('frame', X(p), wy0, Z(c), 0.07, wy1 - wy0, 0.1);
        else boxB('frame', X(c), wy0, Z(p), 0.1, wy1 - wy0, 0.07);
      }
      // 窓は通り抜けられないように当たり判定だけ全高に
      if (o === 'h') colliders.push({ x0: X(s0), z0: Z(c) - T / 2, x1: X(s1), z1: Z(c) + T / 2 });
      else colliders.push({ x0: X(c) - T / 2, z0: Z(s0), x1: X(c) + T / 2, z1: Z(s1) });
    } else {
      place('wall', 0, h, true);
    }
  }
}

// 床(テクスチャのリピートをサイズに合わせる)
function floorPlane(tex, x0, z0, x1, z1, y, tile) {
  const w = x1 - x0, d = z1 - z0;
  const g = new THREE.PlaneGeometry(w, d);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / tile), uv.getY(i) * (d / tile));
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
  scene.add(m);
  return m;
}

// ============================================================
// 部屋を組み立てる
// ============================================================
let gymTex = null;
for (const rm of rooms) {
  const [px0, py0, px1, py1] = rm.r;
  const h = rm.h || WALL_H;
  const walls = rm.walls ?? 'NESW';
  const win = rm.win || '';
  if (walls.includes('N')) buildWall('h', py0, px0, px1, h, win.includes('N'));
  if (walls.includes('S')) buildWall('h', py1, px0, px1, h, win.includes('S'));
  if (walls.includes('W')) buildWall('v', px0, py0, py1, h, win.includes('W'));
  if (walls.includes('E')) buildWall('v', px1, py0, py1, h, win.includes('E'));
  const x0 = X(px0), z0 = Z(py0), x1 = X(px1), z1 = Z(py1);
  // 床
  let tex = texWood, tile = 2;
  if (rm.type === 'corr' || rm.type === 'toilet' || rm.type === 'kitchen' || rm.type === 'health' || rm.type === 'hall') { tex = texTile; tile = 0.9; }
  if (rm.type === 'entrance' || rm.type === 'stair' || rm.type === 'store') { tex = texConcrete; tile = 1; }
  if (rm.type === 'gym') { tex = gymTex = makeGymTex(x1 - x0, z1 - z0); tile = 0; }
  if (tile) floorPlane(tex, x0, z0, x1, z1, 0.02, tile);
  else {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex })));
  }
  // 天井(外から見ると屋根)
  boxB('ceil', (x0 + x1) / 2, h, (z0 + z1) / 2, x1 - x0 + T, 0.05, z1 - z0 + T);
  boxB('roof', (x0 + x1) / 2, h + 0.05, (z0 + z1) / 2, x1 - x0 + T, 0.2, z1 - z0 + T);
  furnish(rm, x0, z0, x1, z1, h);
}

function makeGymTex(w, d) {
  const ppm = 40;
  return canvasTex(Math.round(w * ppm), Math.round(d * ppm), (g, cw, ch) => {
    g.fillStyle = '#d2a670'; g.fillRect(0, 0, cw, ch);
    for (let y = 0; y < ch; y += 8) { g.fillStyle = (y / 8) % 2 ? '#c99c66' : '#d8ad78'; g.fillRect(0, y, cw, 7); }
    noise(g, cw, ch, 3000, 0.2, ['#a57a48', '#e8c494']);
    // バスケットコート(舞台のある西側を避けて配置)
    const cx0 = 4 * ppm, cx1 = cw - 0.8 * ppm, cy0 = 1 * ppm, cy1 = ch - 1 * ppm;
    g.strokeStyle = '#ffffff'; g.lineWidth = 4;
    g.strokeRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
    const mx = (cx0 + cx1) / 2, my = ch / 2;
    g.beginPath(); g.moveTo(mx, cy0); g.lineTo(mx, cy1); g.stroke();
    g.beginPath(); g.arc(mx, my, 1.8 * ppm, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#e04848';
    for (const ex of [cx0, cx1]) {
      const dir = ex === cx0 ? 1 : -1;
      g.beginPath(); g.arc(ex, my, 5.5 * ppm, -Math.PI / 2, Math.PI / 2, dir < 0); g.stroke();
      g.strokeRect(dir > 0 ? ex : ex - 5 * ppm, my - 2 * ppm, 5 * ppm, 4 * ppm);
    }
    g.strokeStyle = '#2f7fd0'; g.strokeRect(1 * ppm, 0.5 * ppm, cw - 2 * ppm, ch - 1 * ppm);
  }, false);
}

// ============================================================
// 家具
// ============================================================
function deskSet(cx, cz, face = -1) { // face=-1 で北向き(黒板が北)
  boxB('desk', cx, 0.66, cz, 0.62, 0.04, 0.45, true);
  boxB('deskLeg', cx, 0.0, cz, 0.56, 0.66, 0.4);
  const chz = cz - face * 0.42;
  boxB('chair', cx, 0.38, chz, 0.38, 0.04, 0.36, true);
  boxB('deskLeg', cx, 0, chz, 0.32, 0.38, 0.3);
  boxB('chair', cx, 0.42, chz - face * 0.18, 0.38, 0.4, 0.04);
}
function bookshelf(cx, cz, w, d, h = 1.8) {
  boxB('shelf', cx, 0, cz, w, h, d, true);
  const along = w > d;
  const L = along ? w : d;
  for (let row = 0; row < 4; row++) {
    const y = 0.15 + row * (h / 4.2);
    let p = -L / 2 + 0.06;
    while (p < L / 2 - 0.1) {
      const bw = 0.04 + Math.random() * 0.05;
      const key = ['book1', 'book2', 'book3'][(Math.random() * 3) | 0];
      const bh = 0.2 + Math.random() * 0.1;
      if (along) boxB(key, cx + p, y, cz, bw, bh, d + 0.02);
      else boxB(key, cx, y, cz + p, d + 0.02, bh, bw);
      p += bw + 0.005;
    }
  }
}

function furnish(rm, x0, z0, x1, z1, h) {
  const W = x1 - x0, Dd = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  switch (rm.type) {
    case 'class': {
      const bw = Math.min(W - 1.5, 4.2);
      boxB('boardFrame', cx, 0.85, z0 + T / 2 + 0.02, bw + 0.12, 1.32, 0.04);
      boxB('board', cx, 0.91, z0 + T / 2 + 0.04, bw, 1.2, 0.04);
      boxB('desk', cx, 0, z0 + 1.4, 1.2, 0.75, 0.6, true); // 教卓
      boxB('boardFrame', cx, 0, z0 + 0.5, bw * 0.9, 0.18, 0.6, false); // 教壇
      const cols = Math.max(2, Math.floor((W - 1.4) / 1.05));
      const rows = Math.max(2, Math.floor((Dd - 3.0) / 1.15));
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const dx = cx + (i - (cols - 1) / 2) * 1.05;
        const dz = z0 + 2.6 + j * 1.15;
        deskSet(dx, dz);
      }
      // 後ろのロッカー
      boxB('shelf', cx, 0, z1 - 0.25, W - 0.6, 0.9, 0.4, true);
      // 掲示板
      boxB('box', cx, 1.3, z1 - T / 2 - 0.02, W * 0.6, 0.8, 0.03);
      break;
    }
    case 'lab': {
      const n = Math.max(1, Math.floor((W - 1) / 2.2));
      for (let i = 0; i < n; i++) {
        const tx = cx + (i - (n - 1) / 2) * 2.2;
        boxB('labBody', tx, 0, cz, 1.1, 0.8, 1.8, true);
        boxB('lab', tx, 0.8, cz, 1.2, 0.05, 1.9);
        boxB('steel', tx, 0.85, cz - 0.6, 0.3, 0.05, 0.3);
        boxB('steel', tx, 0.85, cz - 0.6, 0.04, 0.3, 0.04);
        for (const s of [-1, 1]) for (const k of [-0.5, 0.4]) boxB('chair', tx + s * 0.85, 0, cz + k, 0.3, 0.6, 0.3, true);
      }
      boxB('board', cx, 0.91, z0 + T / 2 + 0.04, Math.min(W - 1, 3), 1.1, 0.04);
      bookshelf(cx, z1 - 0.3, W - 1.2, 0.4, 1.6);
      break;
    }
    case 'music': {
      boxB('piano', x0 + 1.2, 0, z0 + 1.1, 1.5, 1.0, 1.0, true);
      boxB('piano', x0 + 1.2, 0, z0 + 1.6, 1.5, 0.75, 0.3);
      boxB('board', cx + 0.6, 0.91, z0 + T / 2 + 0.04, 2.4, 1.1, 0.04);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        const sx = cx + (i - 1) * 1.0, sz = z0 + 2.4 + j * 1.0;
        boxB('chair', sx, 0.42, sz, 0.4, 0.04, 0.38, true);
        boxB('deskLeg', sx, 0, sz, 0.34, 0.42, 0.32);
        boxB('chair', sx, 0.46, sz + 0.18, 0.4, 0.4, 0.04);
      }
      break;
    }
    case 'lib': {
      bookshelf(x0 + 0.3, cz, 0.4, Dd - 1.2);
      bookshelf(cx + 0.4, z0 + 0.3, W - 1.6, 0.4);
      bookshelf(cx + 0.4, z1 - 0.3, W - 1.6, 0.4);
      boxB('desk', cx + 0.2, 0, cz, 1.4, 0.7, 1.0, true);
      for (const s of [-1, 1]) boxB('chair', cx + 0.2 + s * 0.4, 0, cz + s * 0.8, 0.38, 0.45, 0.38, true);
      break;
    }
    case 'kitchen': {
      boxB('steel', x0 + 0.5, 0, cz, 0.7, 0.9, Dd - 1.0, true);
      boxB('steel', cx + 0.3, 0, cz, 1.0, 0.9, 1.6, true);
      boxB('labBody', cx + 0.3, 0.9, cz - 0.5, 0.4, 0.25, 0.4);
      break;
    }
    case 'art': {
      for (const dz of [-0.9, 0.9]) {
        boxB('desk', cx, 0, cz + dz, 1.6, 0.72, 0.9, true);
        for (const s of [-0.5, 0.5]) boxB('chair', cx + s, 0, cz + dz + (dz > 0 ? 0.65 : -0.65), 0.32, 0.45, 0.32, true);
      }
      boxB('shelf', x0 + 0.25, 0, cz, 0.4, 1.2, Dd - 1.4, true);
      break;
    }
    case 'health': {
      boxB('bedFrame', x0 + 0.6, 0, cz, 0.95, 0.45, 1.9, true);
      boxB('bed', x0 + 0.6, 0.45, cz, 0.9, 0.12, 1.85);
      boxB('bed', x0 + 0.6, 0.57, cz - 0.75, 0.6, 0.1, 0.3);
      boxB('steel', x1 - 0.35, 0, cz, 0.45, 1.6, 0.8, true);
      break;
    }
    case 'toilet': {
      const n = Math.floor((Dd - 0.4) / 1.0);
      for (let i = 0; i <= n; i++) boxB('stall', x0 + 0.75, 0, z0 + 0.2 + i * 1.0, 1.5, 1.9, 0.05, true);
      for (let i = 0; i < n; i++) boxB('rim', x0 + 0.35, 0, z0 + 0.7 + i * 1.0, 0.4, 0.4, 0.35, true);
      break;
    }
    case 'store': {
      boxB('shelf', x0 + 0.3, 0, cz, 0.45, 1.8, Dd - 0.8, true);
      for (let i = 0; i < 5; i++) boxB('box', x0 + 0.3, 0.2 + i * 0.35, cz + (Math.random() - 0.5) * (Dd - 1.5), 0.42, 0.28, 0.4);
      boxB('box', x1 - 0.6, 0, z0 + 0.6, 0.6, 0.5, 0.6, true);
      boxB('box', x1 - 0.6, 0.5, z0 + 0.6, 0.5, 0.4, 0.5);
      break;
    }
    case 'office': {
      for (const ix of [-1, 1]) for (let j = 0; j < 3; j++) {
        const ox = cx + ix * 1.9, oz = z0 + 3 + j * 3.6;
        boxB('steel', ox, 0, oz, 2.4, 0.72, 1.5, true);
        boxB('desk', ox, 0.72, oz, 2.4, 0.03, 1.5);
        for (const s of [-0.6, 0.6]) for (const t of [-1, 1]) boxB('piano', ox + s, 0, oz + t * 1.05, 0.45, 0.85, 0.45, true);
      }
      boxB('board', cx, 0.9, z0 + T / 2 + 0.04, 3.5, 1.2, 0.04);
      bookshelf(x1 - 0.3, cz, 0.4, Dd - 2.5);
      break;
    }
    case 'office2': {
      boxB('steel', x1 - 0.6, 0, cz, 0.5, 1.0, Dd - 2.4, true);
      boxB('desk', cx - 0.3, 0, cz - 1.2, 1.2, 0.72, 0.7, true);
      boxB('steel', x0 + 0.3, 0, cz + 1.5, 0.4, 1.8, 1.4, true);
      break;
    }
    case 'entrance': {
      // 下駄箱(図の6本)
      const lx = [1418, 1468, 1518, 1568, 1618, 1668];
      for (const p of lx) {
        boxB('locker', X(p), 0, Z(1157), 0.75, 1.75, Z(1225) - Z(1090), true);
        for (let r = 1; r < 6; r++) boxB('frame', X(p), r * 0.29, Z(1157), 0.78, 0.02, Z(1225) - Z(1090) + 0.02);
      }
      // すのこ
      boxB('door', cx, 0, Z(1265), W - 1.2, 0.06, 1.0);
      break;
    }
    case 'gym': {
      // 舞台(西側)
      const sx = x0 + 2.0;
      boxB('stage', sx, 0, cz, 4.0, 1.0, Dd - 2, true);
      boxB('curtain', x0 + 0.3, 1.0, cz, 0.2, 4.5, Dd - 2);
      boxB('wall', x0 + 2.2, 5.5, cz, 0.3, 1.5, Dd - 2);
      boxB('curtain', x0 + 3.9, 1.0, z0 + 1.6, 0.15, 4.5, 1.2);
      boxB('curtain', x0 + 3.9, 1.0, z1 - 1.6, 0.15, 4.5, 1.2);
      // バスケットゴール
      for (const [hx, dir] of [[x0 + 4.3, 1], [x1 - 0.5, -1]]) {
        boxB('backboard', hx, 2.75, cz, 0.05, 1.05, 1.8);
        boxB('hoop', hx + dir * 0.3, 3.05, cz, 0.45, 0.03, 0.45);
        if (dir < 0) boxB('deskLeg', hx + 0.25, 2.9, cz, 0.5, 0.08, 0.08);
      }
      break;
    }
    case 'stair': {
      // 奥(東)に向かって上る階段。2階は未実装なので踊り場でとおせんぼ
      const steps = 10, sd = (W - 0.6) / steps;
      for (let i = 0; i < steps; i++) boxB('stair', x0 + 0.9 + i * sd + sd / 2, 0, cz, sd, 0.18 * (i + 1), Dd - 0.3, true);
      boxB('steel', x0 + 0.85, 0, cz, 0.08, 1.0, Dd - 0.3);
      addLabel('2階は準備中', x0 + 0.6, 1.4, cz, -Math.PI / 2, 0.9, '#c03030');
      break;
    }
    case 'hall': {
      boxB('locker', cx, 0, z0 + 0.3, W - 1.6, 1.2, 0.35, true);
      break;
    }
  }
}

// ============================================================
// 文字の看板
// ============================================================
function labelTex(text, color = '#1d2b3a', bg = '#ffffff') {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = color; g.font = 'bold 34px "Hiragino Sans", "Noto Sans JP", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
  }, false);
}
function addLabel(text, x, y, z, rotY, w = 0.8, color) {
  // 裏返しの文字が見えないよう、片面ずつ背中合わせに2枚貼る
  const mat = new THREE.MeshBasicMaterial({ map: labelTex(text, color) });
  for (const r of [rotY, rotY + Math.PI]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), mat);
    m.position.set(x, y, z); m.rotation.y = r;
    scene.add(m);
  }
}
// 室名札: 戸の上に、壁から突き出す向きで両面
for (const op of openings) {
  if (!op.label) continue;
  const m = (op.a + op.b) / 2;
  if (op.o === 'v') {
    for (const s of [-1, 1]) addLabel(op.label, X(op.c) + s * 0.4, op.dh + 0.35, Z(op.a) - 0.1, s > 0 ? 0 : Math.PI, 0.72);
  } else {
    for (const s of [-1, 1]) addLabel(op.label, X(op.a) - 0.1, op.dh + 0.35, Z(op.c) + s * 0.4, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0.72);
  }
  void m;
}
addLabel('体育館', X(1090) + 0.1, 5.2, Z(1165), Math.PI / 2, 3);
addLabel('〇〇小学校', X(1550), 2.75, Z(1300) + 0.1, 0, 1.9);
addLabel('職員室', X(1890) + 0.1, 2.6, Z(1225), Math.PI / 2, 1.2);

// ============================================================
// 屋外
// ============================================================
floorPlane(texAsphalt, X(40), Z(-20), X(2060), Z(1540), 0, 4);
floorPlane(texDirt, X(130), Z(65), X(1170), Z(920), 0.01, 3);
floorPlane(texGrass, X(1380), Z(615), X(1715), Z(1005), 0.01, 3);
floorPlane(texConcrete, X(195), Z(1005), X(500), Z(1465), 0.01, 1.5);

// 校庭のトラック(白線)
{
  const cx = X(650), cz = Z(470), rx = 13, rz = 11;
  const pts = [];
  for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; pts.push(new THREE.Vector3(cx + Math.cos(a) * rx, 0.03, cz + Math.sin(a) * rz)); }
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff })));
  for (const s of [-1, 1]) for (const k of [0, 1]) {
    // サッカーゴール
    const gx = cx + s * 9, gz = cz;
    boxB('goal', gx, 0, gz - 1.5, 0.08, 1.8, 0.08, true);
    boxB('goal', gx, 0, gz + 1.5, 0.08, 1.8, 0.08, true);
    boxB('goal', gx, 1.8, gz, 0.08, 0.08, 3.08);
    boxB('goal', gx + s * 0.9, 0, gz, 0.04, 0.04, 3.0);
    void k;
  }
}

// 外周フェンス
function fence(px0, py0, px1, py1, gapH = []) {
  const h = 2.0;
  const seg = (o, c, a, b) => {
    const L = (b - a) * S, mid = (a + b) / 2;
    if (o === 'h') { boxB('fence', X(mid), 0, Z(c), L, h, 0.05, true); }
    else { boxB('fence', X(c), 0, Z(mid), 0.05, h, L, true); }
  };
  const cut = (o, c, a, b) => {
    const gs = gapH.filter((g) => g.o === o && g.c === c).sort((p, q) => p.a - q.a);
    let cur = a;
    for (const g of gs) { if (g.a > cur) seg(o, c, cur, g.a); cur = g.b; }
    if (cur < b) seg(o, c, cur, b);
  };
  cut('h', py0, px0, px1); cut('h', py1, px0, px1); cut('v', px0, py0, py1); cut('v', px1, py0, py1);
}
mats.fence.mat.transparent = true; mats.fence.mat.opacity = 0.55;
fence(60, 0, 2010, 1520);
fence(195, 1005, 500, 1465, [{ o: 'h', c: 1005, a: 300, b: 380 }, { o: 'v', c: 500, a: 1195, b: 1365 }]);

// プール
{
  const x0 = X(245), z0 = Z(1095), x1 = X(450), z1 = Z(1390);
  boxB('rim', (x0 + x1) / 2, 0, z0 - 0.15, x1 - x0 + 0.6, 0.25, 0.3, true);
  boxB('rim', (x0 + x1) / 2, 0, z1 + 0.15, x1 - x0 + 0.6, 0.25, 0.3, true);
  boxB('rim', x0 - 0.15, 0, (z0 + z1) / 2, 0.3, 0.25, z1 - z0, true);
  boxB('rim', x1 + 0.15, 0, (z0 + z1) / 2, 0.3, 0.25, z1 - z0, true);
  colliders.push({ x0, z0, x1, z1 });
  const water = floorPlane(texWater, x0, z0, x1, z1, 0.12, 3);
  water.material.transparent = true; water.material.opacity = 0.92;
  window.__water = water;
  // コースロープ
  const n = 6;
  for (let i = 1; i < n; i++) {
    const lx = x0 + ((x1 - x0) * i) / n;
    for (let z = z0 + 0.2; z < z1; z += 0.5) boxB(i % 2 ? 'hoop' : 'poleY', lx, 0.12, z, 0.1, 0.06, 0.25);
  }
  // 飛び込み台
  for (let i = 0; i < n; i++) boxB('rim', x0 + ((x1 - x0) * (i + 0.5)) / n, 0, z1 + 0.5, 0.5, 0.45, 0.5, true);
}

// 花壇と飼育小屋(図の上部の3つの四角)
for (const [a, b, c, d] of [[1400, 440, 1555, 545], [1580, 440, 1715, 545]]) {
  const x0 = X(a), z0 = Z(b), x1 = X(c), z1 = Z(d);
  boxB('rim', (x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, 0.35, z1 - z0, true);
  boxB('soil', (x0 + x1) / 2, 0.35, (z0 + z1) / 2, x1 - x0 - 0.3, 0.02, z1 - z0 - 0.3);
  for (let i = 0; i < 70; i++) {
    const fx = x0 + 0.3 + Math.random() * (x1 - x0 - 0.6), fz = z0 + 0.3 + Math.random() * (z1 - z0 - 0.6);
    boxB('leaf', fx, 0.35, fz, 0.04, 0.3, 0.04);
    boxB(Math.random() < 0.5 ? 'flower' : 'flower2', fx, 0.62, fz, 0.14, 0.1, 0.14);
  }
}
{
  const x0 = X(1760), z0 = Z(440), x1 = X(1875), z1 = Z(545);
  mats.cage.mat.transparent = true; mats.cage.mat.opacity = 0.5;
  boxB('cage', (x0 + x1) / 2, 0, z0, x1 - x0, 2.0, 0.04, true);
  boxB('cage', (x0 + x1) / 2, 0, z1, x1 - x0, 2.0, 0.04, true);
  boxB('cage', x0, 0, (z0 + z1) / 2, 0.04, 2.0, z1 - z0, true);
  boxB('cage', x1, 0, (z0 + z1) / 2, 0.04, 2.0, z1 - z0, true);
  boxB('roof', (x0 + x1) / 2, 2.0, (z0 + z1) / 2, x1 - x0 + 0.3, 0.1, z1 - z0 + 0.3);
  boxB('box', x0 + 1, 0, z0 + 1, 0.8, 0.6, 0.6);
  addLabel('飼育小屋', (x0 + x1) / 2, 1.6, z1 + 0.05, 0, 1.2);
}

// ---- 校庭の遊具(図の書き込み: たいや/さんかく/のぼりぼう/てつぼう/まるた/ジャングル) ----
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
const cylinders = {};
function cyl(key, ax, ay, az, bx, by, bz, r, solid = false) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
  const len = a.distanceTo(b);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r));
  (cylinders[key] ||= []).push(m);
  if (solid) colliders.push({ x0: Math.min(ax, bx) - r - 0.05, z0: Math.min(az, bz) - r - 0.05, x1: Math.max(ax, bx) + r + 0.05, z1: Math.max(az, bz) + r + 0.05 });
}
// たいや(半分埋まったタイヤの列)
{
  const tg = new THREE.TorusGeometry(0.42, 0.16, 8, 16);
  const tm = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const cols = [0xe04040, 0x40a0e0, 0xf0c030, 0x50b050];
  for (let i = 0; i < 10; i++) {
    const t = new THREE.Mesh(tg, i % 2 ? tm : new THREE.MeshLambertMaterial({ color: cols[i % 4] }));
    t.position.set(X(560) + i * 0.95, 0.15, Z(370));
    scene.add(t);
    colliders.push({ x0: t.position.x - 0.5, z0: t.position.z - 0.2, x1: t.position.x + 0.5, z1: t.position.z + 0.2 });
  }
}
// さんかく(三角ジャングルジム)
{
  const cx = X(250), cz = Z(430), r = 1.6, top = 3;
  const base = [0, 1, 2].map((i) => [cx + Math.cos(i * 2.094) * r, cz + Math.sin(i * 2.094) * r]);
  for (const [bx, bz] of base) cyl('poleY', bx, 0, bz, cx, top, cz, 0.04);
  for (let lv = 0; lv < 4; lv++) {
    const k = 1 - lv / 4, y = (top * lv) / 4 + 0.05;
    for (let i = 0; i < 3; i++) {
      const [ax, az] = base[i], [bx, bz] = base[(i + 1) % 3];
      cyl('poleY', cx + (ax - cx) * k, y, cz + (az - cz) * k, cx + (bx - cx) * k, y, cz + (bz - cz) * k, 0.03);
    }
  }
  colliders.push({ x0: cx - 1.2, z0: cz - 1.2, x1: cx + 1.2, z1: cz + 1.2 });
}
// のぼりぼう
{
  const x = X(240), z0 = Z(560);
  for (let i = 0; i < 5; i++) cyl('pole', x, 0, z0 + i * 0.6, x, 4, z0 + i * 0.6, 0.035, true);
  cyl('pole', x, 4, z0 - 0.3, x, 4, z0 + 2.7, 0.05);
}
// てつぼう(高さ違い3段)
{
  const x = X(240), z0 = Z(700);
  const hs = [0.9, 1.1, 1.3];
  for (let i = 0; i < 3; i++) {
    const za = z0 + i * 1.5, zb = za + 1.5;
    cyl('steel', x, 0, za, x, hs[i] + 0.05, za, 0.04, true);
    cyl('steel', x, 0, zb, x, hs[i] + 0.05, zb, 0.04, true);
    cyl('steel', x, hs[i], za, x, hs[i], zb, 0.018);
  }
}
// まるた(丸太わたり)
{
  const x = X(1080);
  for (let i = 0; i < 6; i++) cyl('trunk', x - 1.2, 0.25 + (i % 2) * 0.15, Z(560) + i * 0.7, x + 1.2, 0.25 + (i % 2) * 0.15, Z(560) + i * 0.7, 0.13, true);
}
// ジャングルジム(立方格子)
{
  const ox = X(1040), oz = Z(800), n = 4, s = 0.75;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    cyl('pole', ox + i * s, 0, oz + j * s, ox + i * s, n * s * 0.9, oz + j * s, 0.025);
    for (let k = 1; k <= n * 0.9; k++) {
      const y = k * s * 0.9;
      if (i < n) cyl(k % 2 ? 'poleY' : 'pole', ox + i * s, y, oz + j * s, ox + (i + 1) * s, y, oz + j * s, 0.02);
      if (j < n) cyl(k % 2 ? 'poleY' : 'pole', ox + i * s, y, oz + j * s, ox + i * s, y, oz + (j + 1) * s, 0.02);
    }
  }
  colliders.push({ x0: ox - 0.1, z0: oz - 0.1, x1: ox + n * s + 0.1, z1: oz + n * s + 0.1 });
}
// 木
function tree(px, py, s = 1) {
  const x = X(px), z = Z(py);
  cyl('trunk', x, 0, z, x, 2.2 * s, z, 0.18 * s, true);
  const sg = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6 * s, 1), mats.leaf.mat);
  sg.position.set(x, 3.0 * s, z);
  scene.add(sg);
}
tree(1545, 805, 1.1); // 中庭の丸(シンボルツリー)
{
  const cx = X(1545), cz = Z(805);
  for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; boxB('rim', cx + Math.cos(a) * 1.8, 0, cz + Math.sin(a) * 1.8, 0.4, 0.3, 0.4, true); }
  boxB('soil', cx, 0, cz, 3.2, 0.25, 3.2);
}
for (let i = 0; i < 12; i++) tree(160 + i * 85, 30, 1.2);
for (let i = 0; i < 6; i++) tree(90, 120 + i * 140, 1.2);
tree(580, 1450, 1.2); tree(1150, 1450, 1.2); tree(1990, 300, 1.2); tree(1990, 1200, 1.2);

// ============================================================
// InstancedMeshを生成
// ============================================================
const geoBox = new THREE.BoxGeometry(1, 1, 1);
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
for (const k in mats) {
  const { mat, list } = mats[k];
  if (!list.length) continue;
  const im = new THREE.InstancedMesh(geoBox, mat, list.length);
  list.forEach(([x, y, z, w, h, d], i) => { tmpP.set(x, y, z); tmpS.set(w, h, d); tmpM.compose(tmpP, tmpQ, tmpS); im.setMatrixAt(i, tmpM); });
  scene.add(im);
}
for (const k in cylinders) {
  const im = new THREE.InstancedMesh(cylGeo, mats[k].mat, cylinders[k].length);
  cylinders[k].forEach((m, i) => im.setMatrixAt(i, m));
  scene.add(im);
}
{
  // ガラスは1つのメッシュにまとめる
  let total = 0; for (const g of glassGeoms) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3); const idx = [];
  let off = 0;
  for (const g of glassGeoms) {
    pos.set(g.attributes.position.array, off * 3); nor.set(g.attributes.normal.array, off * 3);
    for (const v of g.index.array) idx.push(v + off);
    off += g.attributes.position.count;
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); gg.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); gg.setIndex(idx);
  const gm = new THREE.Mesh(gg, glassMat); gm.renderOrder = 2; scene.add(gm);
}

// ============================================================
// 操作(縦画面: 左下ドラッグ=移動スティック / それ以外=視点)
// ============================================================
const player = { x: X(1550), z: Z(1470), yaw: 0, pitch: 0, bob: 0 };
const R = 0.25, EYE = 1.4;
const stickEl = document.getElementById('stickBase'), nubEl = document.getElementById('nub');
const stick = { id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
const look = { id: null, lx: 0, ly: 0 };
const STICK_R = 50;
function homeStick() {
  stickEl.style.left = Math.min(110, innerWidth * 0.25) + 'px';
  stickEl.style.top = innerHeight - 140 + 'px';
}
homeStick(); addEventListener('resize', homeStick);
const mapEl = document.getElementById('map');

canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 合成イベント等 */ }
  const isStick = e.pointerType !== 'mouse' && e.clientX < innerWidth * 0.55 && e.clientY > innerHeight * 0.55;
  if (isStick && stick.id === null) {
    stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.dx = stick.dy = 0;
    stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px';
    stickEl.classList.add('on');
  } else if (look.id === null) {
    look.id = e.pointerId; look.lx = e.clientX; look.ly = e.clientY;
  }
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
  if (e.pointerId === stick.id) {
    stick.id = null; stick.dx = stick.dy = 0; nubEl.style.transform = ''; stickEl.classList.remove('on'); homeStick();
  }
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

// ============================================================
// 当たり判定
// ============================================================
function collide() {
  for (let it = 0; it < 3; it++) {
    for (const c of colliders) {
      if (c.top !== undefined && c.top < 0.12) continue;
      const nx = Math.max(c.x0, Math.min(player.x, c.x1));
      const nz = Math.max(c.z0, Math.min(player.z, c.z1));
      let dx = player.x - nx, dz = player.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        player.x += (dx / d) * (R - d); player.z += (dz / d) * (R - d);
      } else {
        // 中心が箱の中: 一番近い辺へ押し出す
        const pen = [player.x - c.x0, c.x1 - player.x, player.z - c.z0, c.z1 - player.z];
        const m = Math.min(...pen), i = pen.indexOf(m);
        if (i === 0) player.x = c.x0 - R; else if (i === 1) player.x = c.x1 + R; else if (i === 2) player.z = c.z0 - R; else player.z = c.z1 + R;
      }
    }
  }
}

// ============================================================
// 現在地 & ミニマップ
// ============================================================
const areaEl = document.getElementById('area');
function areaName() {
  const px = player.x / S + OX, py = player.z / S + OY;
  const inR = (r) => px >= r[0] && px <= r[2] && py >= r[1] && py <= r[3];
  for (const rm of rooms) if (inR(rm.r)) return rm.name;
  for (const z of outdoorZones) if (inR(z.r)) return z.name;
  return '学校の敷地';
}
const MW = 2000, MH = 1520, MOX = 40, MOY = 0;
const mctx = mapEl.getContext('2d');
mapEl.width = 420; mapEl.height = Math.round((420 * MH) / MW);
const mk = mapEl.width / MW;
const mapBase = document.createElement('canvas');
mapBase.width = mapEl.width; mapBase.height = mapEl.height;
{
  const g = mapBase.getContext('2d');
  const rr = (r, fill, stroke) => { const x = (r[0] - MOX) * mk, y = (r[1] - MOY) * mk, w = (r[2] - r[0]) * mk, h = (r[3] - r[1]) * mk; if (fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.strokeRect(x, y, w, h); } };
  rr([130, 65, 1170, 920], 'rgba(200,172,132,.8)');
  rr([1380, 615, 1715, 1005], 'rgba(110,166,74,.8)');
  rr([195, 1005, 500, 1465], 'rgba(207,207,202,.7)');
  rr([245, 1095, 450, 1390], 'rgba(63,168,216,.9)');
  for (const rm of rooms) rr(rm.r, rm.type === 'corr' ? 'rgba(235,235,225,.85)' : 'rgba(255,248,230,.9)', '#555');
  g.fillStyle = '#222'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const rm of rooms) if (rm.type !== 'corr' && rm.type !== 'stair') {
    const [a, b, c, d] = rm.r; const short = rm.name.replace('理科室', '理').replace('準備室', '準').replace('1年', '');
    g.save(); g.translate(((a + c) / 2 - MOX) * mk, ((b + d) / 2 - MOY) * mk); g.font = 'bold 11px sans-serif'; g.fillText(short, 0, 0); g.restore();
  }
  g.font = 'bold 16px sans-serif'; g.fillText('校庭', (650 - MOX) * mk, (490 - MOY) * mk);
}
function drawMap() {
  mctx.clearRect(0, 0, mapEl.width, mapEl.height);
  mctx.drawImage(mapBase, 0, 0);
  const px = (player.x / S + OX - MOX) * mk, py = (player.z / S + OY - MOY) * mk;
  mctx.save(); mctx.translate(px, py); mctx.rotate(-player.yaw);
  mctx.fillStyle = '#ff3b3b'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.moveTo(0, -11); mctx.lineTo(7, 7); mctx.lineTo(0, 3); mctx.lineTo(-7, 7); mctx.closePath(); mctx.fill(); mctx.stroke();
  mctx.restore();
}

// ============================================================
// ループ
// ============================================================
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
    const sp = (run ? 3.6 : 1.8) * mag / Math.max(mag, 1e-6) * Math.min(1, mag * 1.2);
    const l = Math.hypot(fx, sx);
    const f = fx / l, s = sx / l;
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    player.x += (-sin * f + cos * s) * sp * dt;
    player.z += (-cos * f - sin * s) * sp * dt;
    player.bob += sp * dt * 2.2;
    collide();
  }
  camera.position.set(player.x, EYE + Math.sin(player.bob * 2) * 0.025, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  if (window.__water) window.__water.material.map.offset.set(now * 0.00003, now * 0.00002);
  const a = areaName();
  if (a !== lastArea) { areaEl.textContent = a; lastArea = a; }
  drawMap();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__player = player;
