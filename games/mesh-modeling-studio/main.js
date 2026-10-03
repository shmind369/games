import * as THREE from "three";
import { OrbitControls } from "./vendor/controls/OrbitControls.js";

// ============================================================
// Mesh Modeling Studio — Phase 1(モデリングの基本構造)
//
// 人型専用ではない汎用の3Dモデリングツールの試作。
// データは Vertex(頂点) / Edge(辺) / Face(面) の3要素で管理し、
// 「頂点を作る→辺を作る→面を作る」という順序で3Dモデルを組み立てる。
// 既存のhumanoid-gltf-exporter等、他プロジェクトのコードは一切
// 参照・流用していない(完全に独立したプロジェクト)。
//
// 実機でのスマートフォン操作テストを受け、以下を追加している。
// - 頂点の選択→ドラッグ移動(全ビュー同期)
// - TOP/FRONT/LEFTそれぞれ独立したピンチズーム・2本指パン
// - FREEビューでの直接モデリング(タップのみ。ドラッグは既存の
//   オービット操作のために空けておく)
// - グリッド表示・グリッドへのスナップ(マグネット)
// ============================================================

// ---------- データモデル(Three.jsに依存しない、純粋なデータ) ----------
let nextId = 1;
function genId() { return nextId++; }

let vertices = []; // [{ id, x, y, z }]
let edges = [];    // [{ id, a, b }] (a, bは頂点id)
let faces = [];    // [{ id, verts: [a, b, c] }] (三角形のみ。頂点idの配列)

function addVertex(x, y, z) {
  const v = { id: genId(), x, y, z };
  vertices.push(v);
  return v;
}

// 頂点を削除すると、その頂点を参照している辺・面も連鎖的に削除する
// (存在しない頂点を指す辺・面が残ってしまうのを防ぐため)
function deleteVertex(id) {
  vertices = vertices.filter((v) => v.id !== id);
  edges = edges.filter((e) => e.a !== id && e.b !== id);
  faces = faces.filter((f) => !f.verts.includes(id));
}

function addEdge(a, b) {
  if (a === b) return null;
  const exists = edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  if (exists) return null; // 同じ2頂点を結ぶ辺の重複作成を防ぐ
  const e = { id: genId(), a, b };
  edges.push(e);
  return e;
}

function deleteEdge(id) {
  edges = edges.filter((e) => e.id !== id);
}

function addFace(a, b, c) {
  const key = [a, b, c].slice().sort((x, y) => x - y).join(",");
  const exists = faces.some((f) => f.verts.slice().sort((x, y) => x - y).join(",") === key);
  if (exists) return null; // 同じ3頂点の組み合わせの面の重複作成を防ぐ
  const f = { id: genId(), verts: [a, b, c] };
  faces.push(f);
  return f;
}

function deleteFace(id) {
  faces = faces.filter((f) => f.id !== id);
}

// ---------- Undo(スナップショット方式) ----------
// このプロトタイプの規模(頂点・辺・面とも数十〜数百程度を想定)では、
// 変更の都度 vertices/edges/faces の全体を複製して積むだけの単純な方式で
// 十分なパフォーマンスが出るため、個別の差分管理はせずシンプルに実装する
const UNDO_LIMIT = 50;
let undoStack = [];

function cloneState() {
  return {
    vertices: vertices.map((v) => ({ ...v })),
    edges: edges.map((e) => ({ ...e })),
    faces: faces.map((f) => ({ id: f.id, verts: f.verts.slice() })),
  };
}
function restoreState(snap) {
  vertices = snap.vertices.map((v) => ({ ...v }));
  edges = snap.edges.map((e) => ({ ...e }));
  faces = snap.faces.map((f) => ({ id: f.id, verts: f.verts.slice() }));
}
function pushUndoSnapshot() {
  undoStack.push(cloneState());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  updateUndoBtnState();
}
function performUndo() {
  if (undoStack.length === 0) return false;
  const snap = undoStack.pop();
  restoreState(snap);
  selectedVertexId = null;
  selectedEdgeId = null;
  selectedFaceId = null;
  pendingVerts = [];
  rebuildScene();
  updateUndoBtnState();
  updateDeleteBtnState();
  updateStatus();
  return true;
}

// ---------- Renderer / Scene ----------
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d22);

scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);

// ---------- グリッド(3D空間上の実座標系に対応した3枚の平面) ----------
// TOP編集面(Y=0)用にXZ平面、FRONT編集面(Z=0)用にXY平面、LEFT編集面(X=0)用に
// ZY平面の3枚を用意する。GridHelperは標準でXZ平面(Y=0)に配置されるため、
// 残り2枚はX軸・Z軸周りに90度回転させて作る。3枚とも実体のある3D
// オブジェクトなので、FREEビューではどの角度から見ても立体的な
// 「360度グリッド」として、直交ビューではそれぞれの基準面に対応した
// 2D格子として正しく見える。
const GRID_SIZE = 6;
const GRID_DIVISIONS = 12;
const SNAP_UNIT = GRID_SIZE / GRID_DIVISIONS; // グリッドの格子間隔とスナップ単位を一致させる(最重要要件)

function makeGrid() { return new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, 0x555c6b, 0x33373f); }
const topGrid = makeGrid(); // XZ平面(Y=0) そのまま
scene.add(topGrid);
const frontGrid = makeGrid();
frontGrid.rotation.x = Math.PI / 2; // XZ平面 → XY平面(Z=0)
scene.add(frontGrid);
const leftGrid = makeGrid();
leftGrid.rotation.z = Math.PI / 2; // XZ平面 → ZY平面(X=0)
scene.add(leftGrid);

let gridVisible = true;
function setGridVisible(v) {
  gridVisible = v;
  topGrid.visible = v;
  frontGrid.visible = v;
  leftGrid.visible = v;
  gridBtn.classList.toggle("active", v);
}

// ---------- マグネット(グリッドスナップ) ----------
let magnetEnabled = false;
function snapPoint(p) {
  if (!magnetEnabled) return p;
  return {
    x: Math.round(p.x / SNAP_UNIT) * SNAP_UNIT,
    y: Math.round(p.y / SNAP_UNIT) * SNAP_UNIT,
    z: Math.round(p.z / SNAP_UNIT) * SNAP_UNIT,
  };
}
function setMagnetEnabled(v) {
  magnetEnabled = v;
  magnetBtn.classList.toggle("active", v);
}

// ---------- 3Dカーソル ----------
// FREEビューでのタップは2D画面上の1点しか与えないため、奥行き(厳密には
// 3軸のうちタップだけでは決まらない1軸)を決める基準が必要になる。
// 「最後に作成・選択・移動した頂点の位置」を3Dカーソルとして保持し、
// FREEビューでの新規頂点追加はこのカーソルのY座標を通る水平面との
// 交点として配置する。TOP/FRONT/LEFTでの操作と矛盾しないよう、
// どのビューで頂点を触ってもカーソルは追従して更新される。
const cursorGeometry = new THREE.OctahedronGeometry(0.07, 0);
const cursorMaterial = new THREE.MeshBasicMaterial({ color: 0xff5fd1, depthTest: false, transparent: true, opacity: 0.9 });
const cursorMesh = new THREE.Mesh(cursorGeometry, cursorMaterial);
cursorMesh.renderOrder = 1000;
scene.add(cursorMesh);
let cursor = { x: 0, y: 0, z: 0 };
function setCursor(x, y, z) {
  cursor = { x, y, z };
  cursorMesh.position.set(x, y, z);
}

// ---------- 4分割ビュー用のカメラ ----------
// TOP: X/Z平面(Y軸方向から見下ろす) / FRONT: X/Y平面(Z軸方向から見る) /
// LEFT: Z/Y平面(X軸方向から見る) / FREE: 自由視点
const VIEW_SIZE = 3; // ズーム1倍のときに正投影カメラがカバーするワールド空間の半径の目安
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;

function makeOrthoCamera() {
  return new THREE.OrthographicCamera(-VIEW_SIZE, VIEW_SIZE, VIEW_SIZE, -VIEW_SIZE, 0.01, 100);
}

const topCamera = makeOrthoCamera();
topCamera.up.set(0, 0, -1);

const frontCamera = makeOrthoCamera();
frontCamera.up.set(0, 1, 0);

const leftCamera = makeOrthoCamera();
leftCamera.up.set(0, 1, 0);

const freeCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
freeCamera.position.set(3.2, 2.6, 4.2);
freeCamera.lookAt(0, 0, 0);

const camerasByKey = { top: topCamera, front: frontCamera, left: leftCamera, free: freeCamera };

const controls = new OrbitControls(freeCamera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.target.set(0, 0, 0);

// 各直交ビューが独立して持つズーム・パン状態(ビューごとに編集する
// 2軸分のパンのみ保持する。もう1軸は常に0で、そのビューの基準面
// そのものは動かない)
const viewTransform = {
  top: { zoom: 1, panX: 0, panZ: 0 },
  front: { zoom: 1, panX: 0, panY: 0 },
  left: { zoom: 1, panY: 0, panZ: 0 },
};

function updateOrthoCameraTransform(key) {
  const t = viewTransform[key];
  const rect = viewLayout[key];
  if (!rect || rect.w === 0 || rect.h === 0) return;
  const aspect = rect.w / rect.h;
  const halfH = VIEW_SIZE / t.zoom;
  const halfW = halfH * aspect;
  const cam = camerasByKey[key];
  cam.left = -halfW;
  cam.right = halfW;
  cam.top = halfH;
  cam.bottom = -halfH;
  if (key === "top") {
    cam.position.set(t.panX, 10, t.panZ);
    cam.lookAt(t.panX, 0, t.panZ);
  } else if (key === "front") {
    cam.position.set(t.panX, t.panY, 10);
    cam.lookAt(t.panX, t.panY, 0);
  } else if (key === "left") {
    cam.position.set(-10, t.panY, t.panZ);
    cam.lookAt(0, t.panY, t.panZ);
  }
  cam.updateProjectionMatrix();
}

// ---------- 4分割ビューのレイアウト計算(ピクセル矩形) ----------
const viewportArea = document.getElementById("game").parentElement;
let viewLayout = { top: {}, front: {}, left: {}, free: {} };

function layoutViews() {
  const w = viewportArea.clientWidth, h = viewportArea.clientHeight;
  const halfW = w / 2, halfH = h / 2;
  viewLayout = {
    top: { x: 0, y: 0, w: halfW, h: halfH },
    front: { x: halfW, y: 0, w: w - halfW, h: halfH },
    left: { x: 0, y: halfH, w: halfW, h: h - halfH },
    free: { x: halfW, y: halfH, w: w - halfW, h: h - halfH },
  };
  for (const key of ["top", "front", "left"]) {
    updateOrthoCameraTransform(key);
  }
  if (viewLayout.free.h > 0) {
    freeCamera.aspect = viewLayout.free.w / viewLayout.free.h;
    freeCamera.updateProjectionMatrix();
  }
  renderer.setSize(w, h);
}

function resize() {
  layoutViews();
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- タップ位置がどのビューに属するか ----------
function viewAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  for (const key of Object.keys(viewLayout)) {
    const r = viewLayout[key];
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return key;
  }
  return "free";
}

// ワールド座標を、指定したビュー(カメラ)でのクライアント座標に変換する
function worldToScreenInView(pos, key) {
  const cam = camerasByKey[key];
  const rect = viewLayout[key];
  const canvasRect = canvas.getBoundingClientRect();
  const v = pos.clone().project(cam);
  return {
    x: canvasRect.left + rect.x + (v.x * 0.5 + 0.5) * rect.w,
    y: canvasRect.top + rect.y + (-v.y * 0.5 + 0.5) * rect.h,
  };
}

const raycaster = new THREE.Raycaster();
function setRaycasterFromClient(clientX, clientY, key) {
  const cam = camerasByKey[key];
  const rect = viewLayout[key];
  const canvasRect = canvas.getBoundingClientRect();
  const localX = clientX - canvasRect.left - rect.x;
  const localY = clientY - canvasRect.top - rect.y;
  const ndcX = (localX / rect.w) * 2 - 1;
  const ndcY = -(localY / rect.h) * 2 + 1;
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, cam);
}

// 各直交ビューには、奥行き方向の軸をちょうど0に固定した平面との交点として
// タップ位置を3D座標に変換する(humanoid-gltf-exporterの3Dカーソル配置と
// 同じ考え方だが、このプロジェクト用に独立して実装している)。パン・ズーム
// はカメラの位置/画角を変えるだけなので、この平面自体は動かさなくてよい。
const PLANE_NORMAL_BY_VIEW = {
  top: new THREE.Vector3(0, 1, 0),
  front: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(1, 0, 0),
};
function pointOnViewPlane(clientX, clientY, key) {
  const normal = PLANE_NORMAL_BY_VIEW[key];
  if (!normal) return null; // FREEビューはここでは対象外(pointOnFreeViewCursorPlaneを使う)
  setRaycasterFromClient(clientX, clientY, key);
  const plane = new THREE.Plane(normal, 0);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  if (key === "top") hit.y = 0;
  else if (key === "front") hit.z = 0;
  else if (key === "left") hit.x = 0;
  return hit;
}

// FREEビュー用: 2D画面上のタップだけでは奥行きが決まらないため、
// 3Dカーソルの高さ(Y)を通る水平面との交点として配置する
function pointOnFreeViewCursorPlane(clientX, clientY) {
  setRaycasterFromClient(clientX, clientY, "free");
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -cursor.y);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  hit.y = cursor.y;
  return hit;
}

// ---------- 当たり判定(頂点・辺・面。いずれもスクリーン座標距離ベース) ----------
// 見た目のマーカーより十分広いタップ許容範囲を確保する(指での操作を想定)
const VERTEX_HIT_PX = 24;
const VERTEX_GRAB_PX = 38; // 既に選択中の頂点を再度つかむ場合は、さらに広い許容範囲にする
const EDGE_HIT_PX = 16;
const DRAG_THRESHOLD_PX = 8;
const TAP_MAX_MS = 500;

function findNearestVertex(clientX, clientY, key) {
  let nearest = null, nearestDist = Infinity;
  for (const v of vertices) {
    const s = worldToScreenInView(new THREE.Vector3(v.x, v.y, v.z), key);
    const dist = Math.hypot(s.x - clientX, s.y - clientY);
    if (dist <= VERTEX_HIT_PX && dist < nearestDist) { nearest = v; nearestDist = dist; }
  }
  return nearest;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 1e-9 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t, cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function findNearestEdge(clientX, clientY, key) {
  let nearest = null, nearestDist = Infinity;
  for (const e of edges) {
    const va = vertices.find((v) => v.id === e.a);
    const vb = vertices.find((v) => v.id === e.b);
    if (!va || !vb) continue;
    const sa = worldToScreenInView(new THREE.Vector3(va.x, va.y, va.z), key);
    const sb = worldToScreenInView(new THREE.Vector3(vb.x, vb.y, vb.z), key);
    const dist = distToSegment(clientX, clientY, sa.x, sa.y, sb.x, sb.y);
    if (dist <= EDGE_HIT_PX && dist < nearestDist) { nearest = e; nearestDist = dist; }
  }
  return nearest;
}

function triSign(px, py, ax, ay, bx, by) { return (px - bx) * (ay - by) - (ax - bx) * (py - by); }
function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = triSign(px, py, ax, ay, bx, by);
  const d2 = triSign(px, py, bx, by, cx, cy);
  const d3 = triSign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
function findFaceAt(clientX, clientY, key) {
  for (const f of faces) {
    const pts = f.verts.map((id) => {
      const v = vertices.find((vv) => vv.id === id);
      return worldToScreenInView(new THREE.Vector3(v.x, v.y, v.z), key);
    });
    if (pts.some((p) => !p)) continue;
    if (pointInTriangle(clientX, clientY, pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y)) return f;
  }
  return null;
}

// ---------- シーン描画(データモデルが変化するたびに再構築する) ----------
const vertexGeometry = new THREE.SphereGeometry(0.05, 10, 8);
const vertexGroup = new THREE.Group();
scene.add(vertexGroup);
let edgeLines = null;
const edgeGroup = new THREE.Group();
scene.add(edgeGroup);
let faceMesh = null;

function rebuildScene() {
  vertexGroup.clear();
  for (const v of vertices) {
    const isPending = pendingVerts.includes(v.id);
    const isSelected = v.id === selectedVertexId;
    const color = isSelected || isPending ? 0xffd24c : 0x4c8dff;
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const mesh = new THREE.Mesh(vertexGeometry, mat);
    mesh.position.set(v.x, v.y, v.z);
    mesh.renderOrder = 999;
    if (isSelected || isPending) mesh.scale.setScalar(1.6); // 選択中/選択途中は少し大きく表示して触りやすくする
    vertexGroup.add(mesh);
  }

  if (edgeLines) { edgeLines.geometry.dispose(); edgeLines.material.dispose(); edgeGroup.remove(edgeLines); edgeLines = null; }
  if (edges.length > 0) {
    const positions = [];
    const colors = [];
    for (const e of edges) {
      const va = vertices.find((v) => v.id === e.a);
      const vb = vertices.find((v) => v.id === e.b);
      if (!va || !vb) continue;
      positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
      const isSelected = e.id === selectedEdgeId;
      const c = isSelected ? new THREE.Color(0xff8a3d) : new THREE.Color(0x8fa3c8);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false });
    edgeLines = new THREE.LineSegments(geo, mat);
    edgeLines.renderOrder = 998;
    edgeGroup.add(edgeLines);
  }

  if (faceMesh) { faceMesh.geometry.dispose(); faceMesh.material.dispose(); scene.remove(faceMesh); faceMesh = null; }
  if (faces.length > 0) {
    const positions = [];
    const colors = [];
    for (const f of faces) {
      const isSelected = f.id === selectedFaceId;
      const c = isSelected ? new THREE.Color(0xffd24c) : new THREE.Color(0x6fae6f);
      for (const vid of f.verts) {
        const v = vertices.find((vv) => vv.id === vid);
        if (!v) continue;
        positions.push(v.x, v.y, v.z);
        colors.push(c.r, c.g, c.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });
    faceMesh = new THREE.Mesh(geo, mat);
    scene.add(faceMesh);
  }

  updateStats();
}

// ---------- モード(頂点/辺/面)・選択状態 ----------
let mode = "vertex"; // "vertex" | "edge" | "face"。ビューを切り替えても維持する
let selectedVertexId = null;
let pendingVerts = []; // 辺/面モードで、作成途中に選んでいる頂点id(ビューをまたいで選択してよい)
let selectedEdgeId = null;
let selectedFaceId = null;
let dragState = null; // { vertexId, key, beforeSnapshot, startX, startY, startZ } (TOP/FRONT/LEFTでの頂点ドラッグのみ)
let activeView = "free";

// 複数ポインター(マルチタッチ)の追跡。2本指がそろったビューで
// ピンチズーム・2本指パンのジェスチャーを開始する
const activePointers = new Map(); // pointerId -> { x, y, view }
let gesture = null; // { view, lastDist, lastMid }
let singlePointerInfo = null; // { x, y, t, key } (1本指のタップ/ドラッグ用)

const modeVertexBtn = document.getElementById("modeVertexBtn");
const modeEdgeBtn = document.getElementById("modeEdgeBtn");
const modeFaceBtn = document.getElementById("modeFaceBtn");
const deleteBtn = document.getElementById("deleteBtn");
const undoBtn = document.getElementById("undoBtn");
const gridBtn = document.getElementById("gridBtn");
const magnetBtn = document.getElementById("magnetBtn");
const statsEl = document.getElementById("stats");
const statusEl = document.getElementById("status");

function setMode(newMode) {
  mode = newMode;
  pendingVerts = [];
  selectedVertexId = null;
  selectedEdgeId = null;
  selectedFaceId = null;
  modeVertexBtn.classList.toggle("active", mode === "vertex");
  modeEdgeBtn.classList.toggle("active", mode === "edge");
  modeFaceBtn.classList.toggle("active", mode === "face");
  rebuildScene();
  updateDeleteBtnState();
  updateStatus();
}
modeVertexBtn.addEventListener("click", () => setMode("vertex"));
modeEdgeBtn.addEventListener("click", () => setMode("edge"));
modeFaceBtn.addEventListener("click", () => setMode("face"));
gridBtn.addEventListener("click", () => setGridVisible(!gridVisible));
magnetBtn.addEventListener("click", () => setMagnetEnabled(!magnetEnabled));

function updateDeleteBtnState() {
  const enabled =
    (mode === "vertex" && selectedVertexId != null) ||
    (mode === "edge" && selectedEdgeId != null) ||
    (mode === "face" && selectedFaceId != null);
  deleteBtn.disabled = !enabled;
}
function updateUndoBtnState() {
  undoBtn.disabled = undoStack.length === 0;
}
function updateStats() {
  statsEl.textContent = `頂点: ${vertices.length}  辺: ${edges.length}  面: ${faces.length}`;
}
function updateStatus() {
  if (mode === "vertex") {
    if (selectedVertexId != null) {
      statusEl.textContent = "頂点を選択中(ドラッグで移動・🗑で削除)";
    } else if (activeView === "free") {
      statusEl.textContent = `頂点モード(FREE): タップで3Dカーソルの高さ(Y=${cursor.y.toFixed(2)})に頂点を追加`;
    } else {
      statusEl.textContent = "頂点モード: 空いている場所をタップして頂点を追加";
    }
  } else if (mode === "edge") {
    statusEl.textContent = pendingVerts.length === 1
      ? "もう1つ頂点をタップして辺を作成"
      : (selectedEdgeId != null ? "辺を選択中(🗑で削除)" : "辺モード: 2つの頂点をタップして辺を作成");
  } else {
    statusEl.textContent = pendingVerts.length > 0
      ? `あと${3 - pendingVerts.length}つ頂点をタップして面を作成`
      : (selectedFaceId != null ? "面を選択中(🗑で削除)" : "面モード: 3つの頂点をタップして面を作成");
  }
}

deleteBtn.addEventListener("click", () => {
  if (mode === "vertex" && selectedVertexId != null) {
    pushUndoSnapshot();
    deleteVertex(selectedVertexId);
    selectedVertexId = null;
  } else if (mode === "edge" && selectedEdgeId != null) {
    pushUndoSnapshot();
    deleteEdge(selectedEdgeId);
    selectedEdgeId = null;
  } else if (mode === "face" && selectedFaceId != null) {
    pushUndoSnapshot();
    deleteFace(selectedFaceId);
    selectedFaceId = null;
  }
  rebuildScene();
  updateDeleteBtnState();
  updateStatus();
});
undoBtn.addEventListener("click", () => { performUndo(); });

// ---------- タップ/選択の共通処理(TOP/FRONT/LEFT/FREEのすべてで使う) ----------
// 頂点モードでの「既存頂点がない場所をタップ」=新規頂点追加、辺/面モードでの
// 頂点選択の蓄積・既存の辺/面の選択は、直交ビューとFREEビューとで完全に
// 同じロジックで扱える(当たり判定がどのカメラのkeyに対しても汎用的に
// 書かれているため)。FREEビューでの新規頂点の奥行きだけ、3Dカーソルの
// 高さを通る平面を使う点が異なる。
function handleTapAction(clientX, clientY, key) {
  if (mode === "vertex") {
    const hitV = findNearestVertex(clientX, clientY, key);
    if (hitV) {
      selectedVertexId = selectedVertexId === hitV.id ? null : hitV.id;
      if (selectedVertexId != null) setCursor(hitV.x, hitV.y, hitV.z);
      return;
    }
    const raw = key === "free" ? pointOnFreeViewCursorPlane(clientX, clientY) : pointOnViewPlane(clientX, clientY, key);
    if (!raw) return;
    const p = snapPoint(raw);
    pushUndoSnapshot();
    const v = addVertex(p.x, p.y, p.z);
    setCursor(v.x, v.y, v.z);
  } else if (mode === "edge") {
    const hitV = findNearestVertex(clientX, clientY, key);
    if (hitV) {
      if (pendingVerts.includes(hitV.id)) {
        pendingVerts = pendingVerts.filter((id) => id !== hitV.id);
      } else {
        pendingVerts.push(hitV.id);
        if (pendingVerts.length === 2) {
          pushUndoSnapshot();
          addEdge(pendingVerts[0], pendingVerts[1]);
          pendingVerts = [];
        }
      }
    } else {
      const hitE = findNearestEdge(clientX, clientY, key);
      selectedEdgeId = hitE ? hitE.id : null;
    }
  } else if (mode === "face") {
    const hitV = findNearestVertex(clientX, clientY, key);
    if (hitV) {
      if (pendingVerts.includes(hitV.id)) {
        pendingVerts = pendingVerts.filter((id) => id !== hitV.id);
      } else {
        pendingVerts.push(hitV.id);
        if (pendingVerts.length === 3) {
          pushUndoSnapshot();
          addFace(pendingVerts[0], pendingVerts[1], pendingVerts[2]);
          pendingVerts = [];
        }
      }
    } else {
      const hitF = findFaceAt(clientX, clientY, key);
      selectedFaceId = hitF ? hitF.id : null;
    }
  }
}

// ---------- ピンチズーム・2本指パン(TOP/FRONT/LEFTそれぞれ独立) ----------
function dist2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function mid2(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

// 「ピンチ中心の下にある3D空間上の点が、指の動きに合わせて画面上の
// 同じ位置に留まり続ける」ように、ズームとパンを1つの処理として適用する。
// これによりピンチズーム(中心を軸にした拡大縮小)と2本指ドラッグ(平行移動)
// の両方が、同じコードで自然に扱える。
function applyPinchPan(key, oldDist, newDist, oldMid, newMid) {
  const t = viewTransform[key];
  const zoomFactor = oldDist > 1e-3 ? newDist / oldDist : 1;
  const before = pointOnViewPlane(oldMid.x, oldMid.y, key);
  t.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.zoom * zoomFactor));
  updateOrthoCameraTransform(key);
  const after = pointOnViewPlane(newMid.x, newMid.y, key);
  if (before && after) {
    if (key === "top") { t.panX += before.x - after.x; t.panZ += before.z - after.z; }
    else if (key === "front") { t.panX += before.x - after.x; t.panY += before.y - after.y; }
    else if (key === "left") { t.panY += before.y - after.y; t.panZ += before.z - after.z; }
    updateOrthoCameraTransform(key);
  }
}

// ---------- 入力(ポインターイベント) ----------
function setActiveView(key) {
  activeView = key;
  for (const cell of document.querySelectorAll(".viewCell")) {
    cell.classList.toggle("active", cell.dataset.view === key);
  }
  updateStatus();
}

// 新しいジェスチャー列の最初の指が触れた瞬間だけビュー判定・オービット
// 有効/無効を切り替える(2本目以降の指が別のビューに触れても、進行中の
// ジェスチャーの対象ビューは変えない)
function onPointerDownGate(evt) {
  if (activePointers.size === 0) {
    const key = viewAt(evt.clientX, evt.clientY);
    setActiveView(key);
    controls.enabled = key === "free";
  }
}
canvas.addEventListener("pointerdown", onPointerDownGate, { capture: true });

function onPointerDown(evt) {
  try { canvas.setPointerCapture(evt.pointerId); } catch (e) { /* 一部環境では失敗することがあるが無視してよい */ }
  const key = viewAt(evt.clientX, evt.clientY);
  activePointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY, view: key });

  if (activePointers.size === 2 && !gesture) {
    const pts = Array.from(activePointers.values());
    if (pts[0].view === pts[1].view && pts[0].view !== "free") {
      // 2本指そろってTOP/FRONT/LEFTのいずれかに入った → ピンチ/パン開始。
      // 進行中だった1本指の操作(頂点ドラッグなど)は打ち切る
      dragState = null;
      singlePointerInfo = null;
      gesture = { view: pts[0].view, lastDist: dist2(pts[0], pts[1]), lastMid: mid2(pts[0], pts[1]) };
    }
    return;
  }
  if (activePointers.size > 2 || gesture) return; // 3本目以降の指は無視する

  if (key === "free") {
    // FREEビューの1本指ドラッグは既存のオービット操作のために空けておき、
    // タップ(ごく小さい移動量・短時間)のときだけモデリング操作を行う
    singlePointerInfo = { x: evt.clientX, y: evt.clientY, t: performance.now(), key };
    return;
  }

  singlePointerInfo = { x: evt.clientX, y: evt.clientY, t: performance.now(), key };
  if (mode === "vertex") {
    let hit = findNearestVertex(evt.clientX, evt.clientY, key);
    if (!hit && selectedVertexId != null) {
      // 既に選択中の頂点は、多少タップ位置がずれていても掴めるようにする
      const sv = vertices.find((v) => v.id === selectedVertexId);
      if (sv) {
        const s = worldToScreenInView(new THREE.Vector3(sv.x, sv.y, sv.z), key);
        if (Math.hypot(s.x - evt.clientX, s.y - evt.clientY) <= VERTEX_GRAB_PX) hit = sv;
      }
    }
    if (hit) {
      dragState = { vertexId: hit.id, key, beforeSnapshot: cloneState(), startX: hit.x, startY: hit.y, startZ: hit.z };
    }
  }
}
canvas.addEventListener("pointerdown", onPointerDown);

function onPointerMove(evt) {
  if (activePointers.has(evt.pointerId)) {
    const prev = activePointers.get(evt.pointerId);
    activePointers.set(evt.pointerId, { ...prev, x: evt.clientX, y: evt.clientY });
  }

  if (gesture) {
    const entries = Array.from(activePointers.values()).filter((p) => p.view === gesture.view);
    if (entries.length < 2) return;
    const [a, b] = entries;
    const newDist = dist2(a, b);
    const newMid = mid2(a, b);
    applyPinchPan(gesture.view, gesture.lastDist, newDist, gesture.lastMid, newMid);
    gesture.lastDist = newDist;
    gesture.lastMid = newMid;
    return;
  }

  if (!singlePointerInfo || singlePointerInfo.key === "free") return;
  if (mode === "vertex" && dragState) {
    const raw = pointOnViewPlane(evt.clientX, evt.clientY, dragState.key);
    if (raw) {
      const p = snapPoint(raw);
      const v = vertices.find((vv) => vv.id === dragState.vertexId);
      if (v) {
        if (dragState.key === "top") { v.x = p.x; v.z = p.z; }
        else if (dragState.key === "front") { v.x = p.x; v.y = p.y; }
        else if (dragState.key === "left") { v.y = p.y; v.z = p.z; }
        setCursor(v.x, v.y, v.z);
        rebuildScene();
      }
    }
  }
}
canvas.addEventListener("pointermove", onPointerMove);

function onPointerUp(evt) {
  const wasTracked = activePointers.has(evt.pointerId);
  activePointers.delete(evt.pointerId);
  try { canvas.releasePointerCapture(evt.pointerId); } catch (e) { /* 無視してよい */ }

  if (gesture) {
    const remaining = Array.from(activePointers.values()).filter((p) => p.view === gesture.view);
    if (remaining.length < 2) {
      gesture = null;
      // ピンチ/パン終了直後に残った指で誤って頂点操作が始まらないよう、
      // 新しい指down(0本から始まる一連の操作)が来るまで待つ
      singlePointerInfo = null;
      dragState = null;
    }
    return;
  }

  if (!wasTracked || !singlePointerInfo) return;
  const dx = evt.clientX - singlePointerInfo.x, dy = evt.clientY - singlePointerInfo.y;
  const dt = performance.now() - singlePointerInfo.t;
  const isTap = Math.hypot(dx, dy) < DRAG_THRESHOLD_PX && dt < TAP_MAX_MS;
  const key = singlePointerInfo.key;

  if (key === "free") {
    if (isTap) handleTapAction(evt.clientX, evt.clientY, "free");
  } else if (mode === "vertex" && dragState) {
    const v = vertices.find((vv) => vv.id === dragState.vertexId);
    const moved = v && (v.x !== dragState.startX || v.y !== dragState.startY || v.z !== dragState.startZ);
    if (moved) {
      undoStack.push(dragState.beforeSnapshot);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      updateUndoBtnState();
    } else if (isTap) {
      selectedVertexId = selectedVertexId === dragState.vertexId ? null : dragState.vertexId;
      if (selectedVertexId != null) {
        const sv = vertices.find((vv) => vv.id === selectedVertexId);
        if (sv) setCursor(sv.x, sv.y, sv.z);
      }
    }
    dragState = null;
  } else if (isTap) {
    handleTapAction(evt.clientX, evt.clientY, key);
  }

  singlePointerInfo = null;
  rebuildScene();
  updateDeleteBtnState();
  updateStatus();
}
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", (evt) => {
  activePointers.delete(evt.pointerId);
  if (gesture && Array.from(activePointers.values()).filter((p) => p.view === gesture.view).length < 2) gesture = null;
  dragState = null;
  singlePointerInfo = null;
});

// ---------- レンダーループ(4分割ビューを同じシーンに対して順に描画) ----------
const VIEW_ORDER = ["top", "front", "left", "free"];
function render() {
  controls.update();
  const canvasH = canvas.clientHeight || window.innerHeight;
  renderer.setScissorTest(true);
  for (const key of VIEW_ORDER) {
    const rect = viewLayout[key];
    if (!rect || rect.w === 0 || rect.h === 0) continue;
    const glY = canvasH - (rect.y + rect.h);
    renderer.setViewport(rect.x, glY, rect.w, rect.h);
    renderer.setScissor(rect.x, glY, rect.w, rect.h);
    renderer.render(scene, camerasByKey[key]);
  }
  renderer.setScissorTest(false);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

updateStats();
updateStatus();
updateUndoBtnState();
updateDeleteBtnState();
setGridVisible(true);
setMagnetEnabled(false);

// ---------- テスト/デバッグ用に主要オブジェクトを公開 ----------
window.__scene = { scene, camerasByKey, renderer, topGrid, frontGrid, leftGrid };
window.__model = {
  getVertices: () => vertices.map((v) => ({ ...v })),
  getEdges: () => edges.map((e) => ({ ...e })),
  getFaces: () => faces.map((f) => ({ id: f.id, verts: f.verts.slice() })),
  getMode: () => mode,
  setMode,
  getSelectedVertexId: () => selectedVertexId,
  getPendingVerts: () => pendingVerts.slice(),
  getSelectedEdgeId: () => selectedEdgeId,
  getSelectedFaceId: () => selectedFaceId,
  getUndoStackSize: () => undoStack.length,
  undo: () => undoBtn.click(),
  isUndoBtnDisabled: () => undoBtn.disabled,
  deleteSelected: () => deleteBtn.click(),
  isDeleteBtnDisabled: () => deleteBtn.disabled,
  getViewportRect: (key) => ({ ...viewLayout[key] }),
  getActiveView: () => activeView,
  viewAt,
  worldToScreenInView: (x, y, z, key) => worldToScreenInView(new THREE.Vector3(x, y, z), key),
  pointOnViewPlane: (clientX, clientY, key) => {
    const p = pointOnViewPlane(clientX, clientY, key);
    return p ? p.toArray() : null;
  },
  pointOnFreeViewCursorPlane: (clientX, clientY) => {
    const p = pointOnFreeViewCursorPlane(clientX, clientY);
    return p ? p.toArray() : null;
  },
  getViewTransform: (key) => ({ ...viewTransform[key] }),
  isGridVisible: () => gridVisible,
  setGridVisible,
  toggleGrid: () => gridBtn.click(),
  isMagnetEnabled: () => magnetEnabled,
  setMagnetEnabled,
  toggleMagnet: () => magnetBtn.click(),
  getCursor: () => ({ ...cursor }),
  snapPoint: (x, y, z) => snapPoint({ x, y, z }),
  getSnapUnit: () => SNAP_UNIT,
  // 直接データを操作してテストしたい場合用(タップ操作を介さない決定論的な経路)
  addVertexDirect: (x, y, z) => { pushUndoSnapshot(); const v = addVertex(x, y, z); rebuildScene(); updateStats(); return v.id; },
  addEdgeDirect: (a, b) => { pushUndoSnapshot(); const e = addEdge(a, b); rebuildScene(); updateStats(); return e ? e.id : null; },
  addFaceDirect: (a, b, c) => { pushUndoSnapshot(); const f = addFace(a, b, c); rebuildScene(); updateStats(); return f ? f.id : null; },
};
