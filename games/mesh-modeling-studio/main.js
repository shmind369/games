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

// 床面の目安になるグリッド(データモデルとは無関係な、見た目専用の補助線)
const grid = new THREE.GridHelper(6, 12, 0x555c6b, 0x33373f);
scene.add(grid);

// ---------- 4分割ビュー用のカメラ ----------
// TOP: X/Z平面(Y軸方向から見下ろす) / FRONT: X/Y平面(Z軸方向から見る) /
// LEFT: Z/Y平面(X軸方向から見る) / FREE: 自由視点(確認用。編集はここでは行わない)
const VIEW_SIZE = 3; // 正投影カメラがカバーするワールド空間の半径の目安

function makeOrthoCamera() {
  return new THREE.OrthographicCamera(-VIEW_SIZE, VIEW_SIZE, VIEW_SIZE, -VIEW_SIZE, 0.01, 100);
}

const topCamera = makeOrthoCamera();
topCamera.position.set(0, 10, 0);
topCamera.up.set(0, 0, -1);
topCamera.lookAt(0, 0, 0);

const frontCamera = makeOrthoCamera();
frontCamera.position.set(0, 0, 10);
frontCamera.up.set(0, 1, 0);
frontCamera.lookAt(0, 0, 0);

const leftCamera = makeOrthoCamera();
leftCamera.position.set(-10, 0, 0);
leftCamera.up.set(0, 1, 0);
leftCamera.lookAt(0, 0, 0);

const freeCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
freeCamera.position.set(3.2, 2.6, 4.2);
freeCamera.lookAt(0, 0, 0);

const camerasByKey = { top: topCamera, front: frontCamera, left: leftCamera, free: freeCamera };

const controls = new OrbitControls(freeCamera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.target.set(0, 0, 0);

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
    const rect = viewLayout[key];
    if (rect.w === 0 || rect.h === 0) continue;
    const aspect = rect.w / rect.h;
    const cam = camerasByKey[key];
    cam.left = -VIEW_SIZE * aspect;
    cam.right = VIEW_SIZE * aspect;
    cam.top = VIEW_SIZE;
    cam.bottom = -VIEW_SIZE;
    cam.updateProjectionMatrix();
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
// 同じ考え方だが、このプロジェクト用に独立して実装している)
const PLANE_NORMAL_BY_VIEW = {
  top: new THREE.Vector3(0, 1, 0),
  front: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(1, 0, 0),
};
function pointOnViewPlane(clientX, clientY, key) {
  const normal = PLANE_NORMAL_BY_VIEW[key];
  if (!normal) return null; // FREEビューでは編集を行わないため対象外
  setRaycasterFromClient(clientX, clientY, key);
  const plane = new THREE.Plane(normal, 0);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  if (key === "top") hit.y = 0;
  else if (key === "front") hit.z = 0;
  else if (key === "left") hit.x = 0;
  return hit;
}

// ---------- 当たり判定(頂点・辺・面。いずれもスクリーン座標距離ベース) ----------
// 見た目のマーカーより十分広いタップ許容範囲を確保する(指での操作を想定)
const VERTEX_HIT_PX = 22;
const EDGE_HIT_PX = 14;
const DRAG_THRESHOLD_PX = 6;

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
let mode = "vertex"; // "vertex" | "edge" | "face"
let selectedVertexId = null;
let pendingVerts = []; // 辺/面モードで、作成途中に選んでいる頂点id
let selectedEdgeId = null;
let selectedFaceId = null;
let dragState = null; // { vertexId, key, beforeSnapshot }
let pointerDownInfo = null; // { x, y, key }
let activeView = "free";

const modeVertexBtn = document.getElementById("modeVertexBtn");
const modeEdgeBtn = document.getElementById("modeEdgeBtn");
const modeFaceBtn = document.getElementById("modeFaceBtn");
const deleteBtn = document.getElementById("deleteBtn");
const undoBtn = document.getElementById("undoBtn");
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
    statusEl.textContent = selectedVertexId != null
      ? "頂点を選択中(ドラッグで移動・🗑で削除)"
      : "頂点モード: 空いている場所をタップして頂点を追加";
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

// ---------- 入力(タップ・ドラッグ) ----------
function setActiveView(key) {
  activeView = key;
  for (const cell of document.querySelectorAll(".viewCell")) {
    cell.classList.toggle("active", cell.dataset.view === key);
  }
}

function onPointerDownGate(evt) {
  const key = viewAt(evt.clientX, evt.clientY);
  setActiveView(key);
  // FREEビュー以外をドラッグしている間はOrbitControlsが反応しないようにする
  controls.enabled = key === "free";
}
canvas.addEventListener("pointerdown", onPointerDownGate, { capture: true });

function onPointerDown(evt) {
  const key = viewAt(evt.clientX, evt.clientY);
  if (key === "free") return; // FREEビューは確認用。ここでは編集しない
  pointerDownInfo = { x: evt.clientX, y: evt.clientY, key };
  if (mode === "vertex") {
    const hit = findNearestVertex(evt.clientX, evt.clientY, key);
    if (hit) {
      dragState = { vertexId: hit.id, key, beforeSnapshot: cloneState(), startX: hit.x, startY: hit.y, startZ: hit.z };
    }
  }
}
function onPointerMove(evt) {
  if (!pointerDownInfo) return;
  if (mode === "vertex" && dragState) {
    const p = pointOnViewPlane(evt.clientX, evt.clientY, dragState.key);
    if (p) {
      const v = vertices.find((vv) => vv.id === dragState.vertexId);
      if (v) {
        if (dragState.key === "top") { v.x = p.x; v.z = p.z; }
        else if (dragState.key === "front") { v.x = p.x; v.y = p.y; }
        else if (dragState.key === "left") { v.y = p.y; v.z = p.z; }
        rebuildScene();
      }
    }
  }
}
function onPointerUp(evt) {
  if (!pointerDownInfo) return;
  const dx = evt.clientX - pointerDownInfo.x, dy = evt.clientY - pointerDownInfo.y;
  const isTap = Math.hypot(dx, dy) < DRAG_THRESHOLD_PX;
  const key = pointerDownInfo.key;

  if (mode === "vertex") {
    if (dragState) {
      const v = vertices.find((vv) => vv.id === dragState.vertexId);
      const moved = v && (v.x !== dragState.startX || v.y !== dragState.startY || v.z !== dragState.startZ);
      if (moved) {
        undoStack.push(dragState.beforeSnapshot);
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        updateUndoBtnState();
      } else if (isTap) {
        selectedVertexId = selectedVertexId === dragState.vertexId ? null : dragState.vertexId;
      }
      dragState = null;
    } else if (isTap) {
      const p = pointOnViewPlane(evt.clientX, evt.clientY, key);
      if (p) {
        pushUndoSnapshot();
        addVertex(p.x, p.y, p.z);
      }
    }
  } else if (isTap && mode === "edge") {
    const hitV = findNearestVertex(evt.clientX, evt.clientY, key);
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
      const hitE = findNearestEdge(evt.clientX, evt.clientY, key);
      selectedEdgeId = hitE ? hitE.id : null;
    }
  } else if (isTap && mode === "face") {
    const hitV = findNearestVertex(evt.clientX, evt.clientY, key);
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
      const hitF = findFaceAt(evt.clientX, evt.clientY, key);
      selectedFaceId = hitF ? hitF.id : null;
    }
  }

  pointerDownInfo = null;
  rebuildScene();
  updateDeleteBtnState();
  updateStatus();
}
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", () => { dragState = null; pointerDownInfo = null; });

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

// ---------- テスト/デバッグ用に主要オブジェクトを公開 ----------
window.__scene = { scene, camerasByKey, renderer, grid };
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
  // 直接データを操作してテストしたい場合用(タップ操作を介さない決定論的な経路)
  addVertexDirect: (x, y, z) => { pushUndoSnapshot(); const v = addVertex(x, y, z); rebuildScene(); updateStats(); return v.id; },
  addEdgeDirect: (a, b) => { pushUndoSnapshot(); const e = addEdge(a, b); rebuildScene(); updateStats(); return e ? e.id : null; },
  addFaceDirect: (a, b, c) => { pushUndoSnapshot(); const f = addFace(a, b, c); rebuildScene(); updateStats(); return f ? f.id : null; },
};
