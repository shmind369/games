import * as THREE from "three";
import { OrbitControls } from "./vendor/controls/OrbitControls.js";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";
import { GLTFExporter } from "./vendor/exporters/GLTFExporter.js";

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
//
// さらに、Tripoで生成したGLBモデル(ボーンなし)を編集可能な頂点/辺/面
// データとして取り込みたいという依頼を受け、GLBインポート機能を追加した。
// 取り込んだ頂点・三角形は、通常のタップ操作で作った頂点・辺・面と完全に
// 同じデータとして扱われ、その場で移動・削除・リギング(将来のPhase 2/3)
// の対象にできる。
//
// 続けて、ローポリゲームモデルに簡易な色を付けたいという依頼を受け、
// 各面(Face)が単純なHexカラー文字列を保持できる面カラー機能を追加した。
// テクスチャペイント・PBR・UV編集などは範囲外で、「面を選択→COLORボタン→
// パレットから色を選ぶ→その面がその色になる」という最小限の操作のみ。
// ============================================================

// ---------- データモデル(Three.jsに依存しない、純粋なデータ) ----------
let nextId = 1;
function genId() { return nextId++; }

let vertices = []; // [{ id, x, y, z }]
let edges = [];    // [{ id, a, b }] (a, bは頂点id)
let faces = [];    // [{ id, verts: [a, b, c], color }] (三角形のみ。colorは未設定ならnull)

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
  const f = { id: genId(), verts: [a, b, c], color: null };
  faces.push(f);
  return f;
}

function deleteFace(id) {
  faces = faces.filter((f) => f.id !== id);
}

// 面の色を設定する(将来のGLTF/GLB書き出しを見据え、Faceが直接色を
// 持つ単純な構造にしている。未設定(null)の面はデフォルトの表示色になる。
// 同じ色を持つ面をまとめて1つのMaterialにする、という将来の拡張は
// このデータ構造のままで対応できる)
function setFaceColor(id, color) {
  const f = faces.find((ff) => ff.id === id);
  if (f) f.color = color;
}

// ---------- データモデル: joints(RIGGINGモードの関節=ボーン) ----------
// BlenderのArmatureと同じ「ボーン=親子を結ぶ1本の線」という考え方を採用し、
// 頂点/辺/面とは独立したデータとして持つ(メッシュへの自動ウェイト付けは
// 今回のスコープ外のため、関節は今のところどの頂点とも結びついていない)。
// 1つのjointは「自分の位置」と「親joint」を持つだけで、画面に見える
// 「ボーン」は常に「親の位置→自分の位置」を結ぶ線として描画される
// (親を持たない=Root)。これはhumanoid-gltf-exporter等、他プロジェクトの
// `bone(name, x, y, z)`の考え方と同じだが、このプロジェクト用に独立して
// 実装している。
let joints = []; // [{id, name, parentId, x, y, z, rotationLimit: "free"|"hinge", side: "left"|"right"|"center", mirrorId}]

function addJoint(name, x, y, z, parentId, side) {
  const j = { id: genId(), name, parentId: parentId ?? null, x, y, z, rotationLimit: "free", side: side || "center", mirrorId: null };
  joints.push(j);
  return j;
}
function isDescendantJoint(ancestorId, nodeId) {
  let cur = joints.find((j) => j.id === nodeId);
  while (cur && cur.parentId != null) {
    if (cur.parentId === ancestorId) return true;
    cur = joints.find((j) => j.id === cur.parentId);
  }
  return false;
}
// 親を変更する(ボーン生成時の「2点目を1点目の子にする」にも、後からの
// 付け替えにも同じ関数を使う)。自分の子孫を親にしようとする操作は、
// 循環参照(無限ループ)になるため拒否する
function reparentJoint(jointId, newParentId) {
  if (jointId === newParentId) return false;
  if (newParentId != null && isDescendantJoint(jointId, newParentId)) return false;
  const j = joints.find((jj) => jj.id === jointId);
  if (!j) return false;
  j.parentId = newParentId;
  return true;
}
// 頂点削除と同じ考え方で、削除したjointの子孫(=そこから先のボーン)も
// 連鎖的に削除する(親を失ったボーンが宙に浮いて残ることを防ぐ)
function deleteJointCascade(id) {
  const toDelete = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of joints) {
      if (j.parentId != null && toDelete.has(j.parentId) && !toDelete.has(j.id)) { toDelete.add(j.id); changed = true; }
    }
  }
  joints = joints.filter((j) => !toDelete.has(j.id));
  for (const j of joints) if (j.mirrorId != null && toDelete.has(j.mirrorId)) j.mirrorId = null;
}

// ---------- 左右対称(SYMMETRY) ----------
let symmetryEnabled = false;
// X座標の符号で左右を判定する(このリポジトリの他プロジェクト(例:
// humanoid-gltf-exporter)と同じく、X>0側を"left"としている)
function sideOfX(x) {
  const EPS = 0.02;
  if (x > EPS) return "left";
  if (x < -EPS) return "right";
  return "center";
}
function mirrorBoneName(name) {
  if (/right/i.test(name)) return name.replace(/Right/g, "Left").replace(/right/g, "left");
  if (/left/i.test(name)) return name.replace(/Left/g, "Right").replace(/left/g, "right");
  if (name.includes("右")) return name.replace(/右/g, "左");
  if (name.includes("左")) return name.replace(/左/g, "右");
  return `${name}_mirror`;
}
// ミラー側の親を解決する: 親が中心(center、mirrorIdなし)ならそのまま同じ親を
// 共有し(例: 背骨の同じChestに左右の腕がそれぞれ繋がる)、親自身が左右の
// どちらかで既にミラー済みなら、そのミラー先を親にする
function resolveMirrorParentId(parentId) {
  if (parentId == null) return null;
  const p = joints.find((j) => j.id === parentId);
  if (!p) return null;
  return p.mirrorId != null ? p.mirrorId : p.id;
}
function createJointWithSymmetry(name, x, y, z, parentId) {
  const side = sideOfX(x);
  const j = addJoint(name, x, y, z, parentId, side);
  if (symmetryEnabled && side !== "center") {
    const mirrorParentId = resolveMirrorParentId(parentId);
    const mj = addJoint(mirrorBoneName(name), -x, y, z, mirrorParentId, side === "left" ? "right" : "left");
    j.mirrorId = mj.id;
    mj.mirrorId = j.id;
  }
  return j;
}

// ---------- Undo(スナップショット方式) ----------
// このプロトタイプの規模(頂点・辺・面とも数十〜数百程度を想定)では、
// 変更の都度 vertices/edges/faces の全体を複製して積むだけの単純な方式で
// 十分なパフォーマンスが出るため、個別の差分管理はせずシンプルに実装する
const UNDO_LIMIT = 50;
let undoStack = [];

// モデル全体の拡大縮小倍率(1 = 読み込み/作成時点の原寸)。頂点座標自体に
// スケールを直接焼き込む方式のため、この値はカメラズームとは完全に別の
// 「今のモデルが原寸の何倍か」を示すUI表示用の値で、Undoの対象にもなる
let modelScale = 1;

function cloneState() {
  return {
    vertices: vertices.map((v) => ({ ...v })),
    edges: edges.map((e) => ({ ...e })),
    faces: faces.map((f) => ({ id: f.id, verts: f.verts.slice(), color: f.color ?? null })),
    modelScale,
    joints: joints.map((j) => ({ ...j })),
  };
}
function restoreState(snap) {
  vertices = snap.vertices.map((v) => ({ ...v }));
  edges = snap.edges.map((e) => ({ ...e }));
  faces = snap.faces.map((f) => ({ id: f.id, verts: f.verts.slice(), color: f.color ?? null }));
  modelScale = snap.modelScale ?? 1;
  joints = (snap.joints || []).map((j) => ({ ...j }));
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
  selectedJointId = null;
  if (testPoseActive) buildPoseBones(); // 構造が変わった可能性があるので作り直す(ポーズは単位回転にリセットされる)
  rebuildScene();
  rebuildRigVisual();
  updateUndoBtnState();
  updateDeleteBtnState();
  updateColorBtnState();
  updateStatus();
  return true;
}

// ---------- モデル全体の拡大縮小(カメラズームとは別物) ----------
// ビューのズーム(viewTransform)はカメラの画角を変えるだけで、モデルの
// 頂点座標(=将来GLB/glTFへ書き出す実際のジオメトリ)は一切変化しない。
// それとは別に、ここではモデルの頂点座標そのものをスケーリングする。
// モデル全体のバウンディングボックスの中心を基準に、X/Y/Zへ常に同じ
// 倍率をかけることで、中心位置と縦横比(形状)を保ったまま拡大縮小する。
// 頂点の「相対的な位置関係」は単純な線形スケールなのでそのまま保たれ、
// 当たり判定・ドラッグ編集・GLB書き出しなど他の機能は頂点座標を
// そのまま参照しているだけなので、変更なしでそのまま正しく動作する。
const MODEL_SCALE_STEP = 1.2;

function scaleModel(factor) {
  if (vertices.length === 0) return;
  const box = computeVerticesBounds(vertices.map((v) => v.id));
  const center = box.getCenter(new THREE.Vector3());
  for (const v of vertices) {
    v.x = center.x + (v.x - center.x) * factor;
    v.y = center.y + (v.y - center.y) * factor;
    v.z = center.z + (v.z - center.z) * factor;
  }
  modelScale *= factor;
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
// 頂点はGLBインポートで数百〜千個規模になり得るため、1頂点1Meshではなく
// 単一のTHREE.Points(1回の描画呼び出しで済む)で描画する。選択中/選択
// 途中の頂点は色と点サイズの両方を変えて見分けやすくする。
const DEFAULT_FACE_COLOR = 0x6fae6f; // 色が未設定の面のデフォルト表示色(描画・GLB書き出し共通)
const VERTEX_POINT_SIZE = 9;
const vertexPointsMaterial = new THREE.PointsMaterial({
  size: VERTEX_POINT_SIZE,
  sizeAttenuation: false, // ズーム・距離に関わらず常に一定のピクセルサイズで表示する
  vertexColors: true,
  depthTest: false,
});
let vertexPoints = null;
const vertexGroup = new THREE.Group();
scene.add(vertexGroup);
let edgeLines = null;
const edgeGroup = new THREE.Group();
scene.add(edgeGroup);
let faceMesh = null;

function rebuildScene() {
  if (vertexPoints) { vertexPoints.geometry.dispose(); vertexGroup.remove(vertexPoints); vertexPoints = null; }
  if (vertices.length > 0) {
    const positions = [];
    const colors = [];
    const selectColor = new THREE.Color(0xffd24c);
    const normalColor = new THREE.Color(0x4c8dff);
    for (const v of vertices) {
      const isHighlighted = pendingVerts.includes(v.id) || v.id === selectedVertexId;
      const p = skinnedVertexPosition(v);
      positions.push(p.x, p.y, p.z);
      const c = isHighlighted ? selectColor : normalColor;
      colors.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    vertexPoints = new THREE.Points(geo, vertexPointsMaterial);
    vertexPoints.renderOrder = 999;
    vertexGroup.add(vertexPoints);
  }

  if (edgeLines) { edgeLines.geometry.dispose(); edgeLines.material.dispose(); edgeGroup.remove(edgeLines); edgeLines = null; }
  if (edges.length > 0) {
    const positions = [];
    const colors = [];
    for (const e of edges) {
      const va = vertices.find((v) => v.id === e.a);
      const vb = vertices.find((v) => v.id === e.b);
      if (!va || !vb) continue;
      const pa = skinnedVertexPosition(va);
      const pb = skinnedVertexPosition(vb);
      positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
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
      // 選択中は既存の選択ハイライト(黄)を優先して見せ、選択を解除すると
      // 実際に設定した色(未設定ならデフォルトの緑)が見える
      const c = isSelected ? new THREE.Color(0xffd24c) : new THREE.Color(f.color || DEFAULT_FACE_COLOR);
      for (const vid of f.verts) {
        const v = vertices.find((vv) => vv.id === vid);
        if (!v) continue;
        const p = skinnedVertexPosition(v);
        positions.push(p.x, p.y, p.z);
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

  // RIGGINGモード中は頂点/辺の編集用マーカーを消す(面=モデル本体の表示は
  // 維持する)。関節/ボーンの描画は別のrebuildRigVisual()が担当する
  vertexGroup.visible = appMode === "model";
  edgeGroup.visible = appMode === "model";

  updateStats();
  updateObjectInfo();
}

// ============================================================
// RIGGINGモード(手動ボーン配置)
//
// 「完成したモデルをAIが自動的に骨格を推測する」のではなく、ユーザーが
// 関節位置をタップで指定し、アプリがその2点を結ぶボーンを生成する
//半自動方式。実機での自動ウェイト計算・自動リギングは行わず、まずは
// 「骨格を作る→階層を確認する→動かして確認する」という基本操作に
// 絞って実装している。
//
// 設計のポイント: このアプリのjointは、BlenderのArmatureやこの
// リポジトリの他プロジェクト(humanoid-gltf-exporter等)の`THREE.Bone`と
// 同じく「1つの位置+親への参照」として持たせている。画面上の
// 「ボーン」は常に「親jointの位置 → 自分の位置」を結ぶ1本の線として
// 描画され、ユーザーが明示的に始点・終点の2頂点ペアを保持する必要は
// ない(肩をタップ→肘をタップ、は「肘jointを肩jointの子として作る」
// という1回の操作にそのまま対応する)。
// ============================================================

// ---------- RIGGINGモードの描画(常にモデルより手前に表示するX-Ray) ----------
// 頂点(vertexPointsMaterial)と同じ`depthTest: false`+高い`renderOrder`の
// 組み合わせで、モデルの内部・背面にある関節/ボーンも常に見えるようにする
// (このプロジェクトが3Dカーソル・頂点描画で既に使っている手法を踏襲)
const JOINT_POINT_SIZE = 13;
const jointPointsMaterial = new THREE.PointsMaterial({
  size: JOINT_POINT_SIZE,
  sizeAttenuation: false,
  vertexColors: true,
  depthTest: false,
});
let jointPoints = null;
const jointGroup = new THREE.Group();
scene.add(jointGroup);
let boneLines = null;
const boneLineGroup = new THREE.Group();
scene.add(boneLineGroup);

// TEST POSE中は回転後の見た目の位置、それ以外はレストポーズの座標を返す
function jointDisplayPosition(j) {
  if (testPoseActive && poseBones) {
    const b = poseBones.get(j.id);
    if (b) return b.getWorldPosition(new THREE.Vector3());
  }
  return new THREE.Vector3(j.x, j.y, j.z);
}

function rebuildRigVisual() {
  if (jointPoints) { jointPoints.geometry.dispose(); jointGroup.remove(jointPoints); jointPoints = null; }
  if (boneLines) { boneLines.geometry.dispose(); boneLines.material.dispose(); boneLineGroup.remove(boneLines); boneLines = null; }

  const visible = appMode === "rigging";
  jointGroup.visible = visible;
  boneLineGroup.visible = visible;
  updateStats();
  if (!visible || joints.length === 0) return;

  const activeSelectedId = testPoseActive ? poseSelectedJointId : selectedJointId;
  const positions = [];
  const colors = [];
  const selectColor = new THREE.Color(0xff5fd1);
  const hingeColor = new THREE.Color(0xffb84c);
  const freeColor = new THREE.Color(0x4cd6ff);
  const displayPosById = new Map();
  for (const j of joints) {
    const p = jointDisplayPosition(j);
    displayPosById.set(j.id, p);
    positions.push(p.x, p.y, p.z);
    const isSelected = j.id === activeSelectedId;
    const c = isSelected ? selectColor : (j.rotationLimit === "hinge" ? hingeColor : freeColor);
    colors.push(c.r, c.g, c.b);
  }
  const jGeo = new THREE.BufferGeometry();
  jGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  jGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  jointPoints = new THREE.Points(jGeo, jointPointsMaterial);
  jointPoints.renderOrder = 1001;
  jointGroup.add(jointPoints);

  const linePositions = [];
  const lineColors = [];
  const boneColor = new THREE.Color(0xd9d9e0);
  for (const j of joints) {
    if (j.parentId == null) continue;
    const pp = displayPosById.get(j.parentId);
    const cp = displayPosById.get(j.id);
    if (!pp || !cp) continue;
    linePositions.push(pp.x, pp.y, pp.z, cp.x, cp.y, cp.z);
    lineColors.push(boneColor.r, boneColor.g, boneColor.b, boneColor.r, boneColor.g, boneColor.b);
  }
  if (linePositions.length > 0) {
    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    lGeo.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
    const lMat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false });
    boneLines = new THREE.LineSegments(lGeo, lMat);
    boneLines.renderOrder = 1000;
    boneLineGroup.add(boneLines);
  }
}

// ---------- Phase 3: メッシュのボーン追従(Rigid Skinning) ----------
// 「完成したモデルをAIが自動解析する」のではなく、これまでと同じ
// 半自動路線で、1頂点が属する「かたまり(連結成分)」ごとに、最も近い
// ボーンへ100%の重みで丸ごと結びつける。頂点/辺/面は元々どの面がどの
// ボックスに属するかという情報を持っていないが、面(`faces`)が共有する
// 頂点をたどって連結成分を求めれば、頂点を1つも共有しない独立した
// ボックス(今回の箱人間のような構成)は自然と1ボックス=1かたまりに
// 分かれる。将来、1頂点が複数ボーンにまたがる重み付きスキニングへ
// 拡張することを見据え、データ構造自体は最初から「頂点ID→(ボーンID・
// 重み)の配列」という複数エントリを持てる形にしてある(今回は常に
// 1エントリ・重み1.0のみを入れる)。
let meshBindings = null; // Map<vertexId, Array<{ boneId, weight }>>
let boneRestMatrixWorld = null; // Map<jointId, THREE.Matrix4>(TEST POSE開始時点の基準姿勢)

function closestPointOnSegment3D(p, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const lenSq = ab.lengthSq();
  let t = lenSq > 1e-9 ? new THREE.Vector3().subVectors(p, a).dot(ab) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return a.clone().add(ab.multiplyScalar(t));
}

// 面(三角形)が共有する頂点をUnion-Findでたどり、「互いに頂点を共有する
// 頂点の集合」ごとにグループ化する。面を持たない孤立した頂点は1頂点=
// 1グループになる
function buildVertexAdjacencyComponents() {
  const parent = new Map();
  function find(x) {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const v of vertices) parent.set(v.id, v.id);
  for (const f of faces) {
    const [a, b, c] = f.verts;
    union(a, b);
    union(b, c);
  }
  const groups = new Map();
  for (const v of vertices) {
    const r = find(v.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(v.id);
  }
  return Array.from(groups.values());
}

// 各ボーンを「親jointの位置→自分の位置を結ぶ線分」(親が無いRootは
// 自分の位置だけの点)として扱い、各かたまりの重心に最も近いボーンへ、
// そのかたまり全体を割り当てる
function computeMeshBindings() {
  meshBindings = new Map();
  if (joints.length === 0 || vertices.length === 0) return;
  const boneSegments = joints.map((j) => {
    const parent = j.parentId != null ? joints.find((jj) => jj.id === j.parentId) : null;
    const a = parent ? new THREE.Vector3(parent.x, parent.y, parent.z) : new THREE.Vector3(j.x, j.y, j.z);
    const b = new THREE.Vector3(j.x, j.y, j.z);
    return { jointId: j.id, a, b };
  });
  const components = buildVertexAdjacencyComponents();
  for (const comp of components) {
    const centroid = new THREE.Vector3();
    for (const vid of comp) {
      const v = vertices.find((vv) => vv.id === vid);
      if (v) centroid.add(new THREE.Vector3(v.x, v.y, v.z));
    }
    centroid.divideScalar(comp.length);
    let bestJointId = null;
    let bestDist = Infinity;
    for (const seg of boneSegments) {
      const d = centroid.distanceTo(closestPointOnSegment3D(centroid, seg.a, seg.b));
      if (d < bestDist) { bestDist = d; bestJointId = seg.jointId; }
    }
    if (bestJointId == null) continue;
    for (const vid of comp) meshBindings.set(vid, [{ boneId: bestJointId, weight: 1 }]);
  }
}

// TEST POSE中はボーンのワールド行列の変化分(現在/レスト)を頂点へ
// そのまま適用する標準的なリニアブレンドスキニングの式(今回はボーン
// 1本・重み1.0のみ)。TEST POSEでない、またはバインド未計算の場合は
// レスト座標をそのまま返すため、MODELモード・RIGGING(EDIT中)の見た目は
// 一切変化しない
function skinnedVertexPosition(v) {
  if (!testPoseActive || !poseBones || !meshBindings || !boneRestMatrixWorld) return new THREE.Vector3(v.x, v.y, v.z);
  const binding = meshBindings.get(v.id);
  if (!binding || binding.length === 0) return new THREE.Vector3(v.x, v.y, v.z);
  const result = new THREE.Vector3();
  let totalWeight = 0;
  for (const { boneId, weight } of binding) {
    const bone = poseBones.get(boneId);
    const restMatrix = boneRestMatrixWorld.get(boneId);
    if (!bone || !restMatrix) continue;
    const delta = bone.matrixWorld.clone().multiply(new THREE.Matrix4().copy(restMatrix).invert());
    result.addScaledVector(new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(delta), weight);
    totalWeight += weight;
  }
  if (totalWeight <= 0) return new THREE.Vector3(v.x, v.y, v.z);
  return result.divideScalar(totalWeight);
}

// ---------- RIGGINGモードのタップ操作(関節の配置・選択・接続) ----------
function findNearestJoint(clientX, clientY, key) {
  let nearest = null, nearestDist = Infinity;
  for (const j of joints) {
    const s = worldToScreenInView(jointDisplayPosition(j), key);
    const dist = Math.hypot(s.x - clientX, s.y - clientY);
    if (dist <= VERTEX_HIT_PX && dist < nearestDist) { nearest = j; nearestDist = dist; }
  }
  return nearest;
}

function promptJointName() {
  const suggestion = joints.length === 0 ? "Root" : `Joint${nextId}`;
  let input = null;
  try { input = window.prompt("関節(ボーン)の名前を入力してください", suggestion); } catch (e) { input = null; }
  const name = (input || "").trim();
  return name || suggestion;
}

// 既存のjointをタップしたときの共通処理。選択中のjointが無ければ単に選択、
// 既に選択中のjointがあれば「そのjointの子として、今タップしたjointを
// つなぎ直す」(=ボーンの接続・付け替え)、同じjointを再度タップしたら
// 選択解除、という3パターンを1つにまとめている
function handleJointTapOnExisting(hitJoint) {
  if (selectedJointId === hitJoint.id) {
    selectedJointId = null;
  } else if (selectedJointId != null) {
    pushUndoSnapshot();
    if (!reparentJoint(hitJoint.id, selectedJointId)) { undoStack.pop(); updateUndoBtnState(); }
    selectedJointId = hitJoint.id;
  } else {
    selectedJointId = hitJoint.id;
  }
}

function handleRigEditTapAction(clientX, clientY, key) {
  const hit = findNearestJoint(clientX, clientY, key);
  if (hit) { handleJointTapOnExisting(hit); return; }
  const raw = key === "free" ? pointOnFreeViewCursorPlane(clientX, clientY) : pointOnViewPlane(clientX, clientY, key);
  if (!raw) return;
  const p = snapPoint(raw);
  const name = promptJointName();
  pushUndoSnapshot();
  const j = createJointWithSymmetry(name, p.x, p.y, p.z, selectedJointId);
  selectedJointId = j.id; // 続けてタップすれば、今作った関節からチェーンを伸ばせる
  setCursor(p.x, p.y, p.z);
}

// ---------- TEST POSE(関節の階層が正しく動くかを確認する簡易モード) ----------
// 実際のスキニング(頂点への重み付け)はまだ実装しないため、ここでは
// joints自体(関節点とそれを結ぶ線)をFK(Forward Kinematics)で動かして
// 「親を回転すると子も正しく追従するか」を確認できればよい、という
// 割り切った実装にしている。各jointにつき1つの`THREE.Bone`を作り、
// 親子関係をそのままThree.jsのBone階層として構築することで、
// 行列計算(ワールド座標の算出)をThree.js本体にまかせている。
let testPoseActive = false;
let poseBones = null; // Map<jointId, THREE.Bone>
let poseRootGroup = null; // Boneを実際にシーングラフへ置くための入れ物(レンダリングはしない)
let poseSelectedJointId = null;
let poseDragLast = null; // { x, y } (TEST POSE中のドラッグ回転の基準点)

function buildPoseBones() {
  const byId = new Map();
  for (const j of joints) {
    const b = new THREE.Bone();
    b.name = j.name;
    byId.set(j.id, b);
  }
  const group = new THREE.Group();
  for (const j of joints) {
    const b = byId.get(j.id);
    if (j.parentId != null && byId.has(j.parentId)) {
      const pj = joints.find((jj) => jj.id === j.parentId);
      b.position.set(j.x - pj.x, j.y - pj.y, j.z - pj.z);
      byId.get(j.parentId).add(b);
    } else {
      b.position.set(j.x, j.y, j.z);
      group.add(b);
    }
  }
  group.updateMatrixWorld(true);
  poseBones = byId;
  poseRootGroup = group;
  // スキニングの基準となる「レスト姿勢でのワールド行列」をここで確定する
  // (この直後はまだ全ボーンが単位回転のため、ここが正しいレスト値になる)
  boneRestMatrixWorld = new Map();
  for (const [id, b] of byId) boneRestMatrixWorld.set(id, b.matrixWorld.clone());
}
function setTestPoseActive(v) {
  testPoseActive = v;
  testPoseBtn.classList.toggle("active", v);
  resetPoseBtn.disabled = !v;
  poseSelectedJointId = null;
  poseDragLast = null;
  if (v) {
    buildPoseBones();
    computeMeshBindings(); // 毎回TEST POSEに入るたびに作り直すため、その時点のボーン構成と常に一致する
  } else {
    poseBones = null;
    poseRootGroup = null;
    boneRestMatrixWorld = null;
  }
  rebuildRigVisual();
  rebuildScene(); // メッシュの表示をレスト/スキニング後の姿勢に合わせて更新する
  updateStatus();
}
function resetPose() {
  if (!poseBones) return;
  for (const b of poseBones.values()) b.quaternion.identity();
  poseRootGroup.updateMatrixWorld(true);
  rebuildRigVisual();
  rebuildScene();
}

// 肘・膝のような1軸(ヒンジ)関節は、常にワールドX軸(このリポジトリの
// 他プロジェクトと同じ「左右軸」の慣例)まわりにのみ曲げる。肩・股関節
// などの多軸(free)関節は、ドラッグ中のビュー(TOP/FRONT/LEFT)の奥行き軸
// まわりに回転させることで、「どの軸で曲げたいか」をビューの切り替えで
// 選べるようにしている(専用の3軸ギズモは今回のスコープ外)
const HINGE_AXIS_WORLD = new THREE.Vector3(1, 0, 0);
function viewDepthAxis(key) {
  if (key === "top") return new THREE.Vector3(0, 1, 0);
  if (key === "front") return new THREE.Vector3(0, 0, 1);
  if (key === "left") return new THREE.Vector3(1, 0, 0);
  return null; // FREEビューはオービット操作と競合するため、TEST POSEのドラッグ回転は対象外(タップでの選択のみ)
}
function handleRigPoseTap(clientX, clientY, key) {
  const hit = findNearestJoint(clientX, clientY, key);
  if (hit) poseSelectedJointId = hit.id; // 空振りタップでは選択状態を維持する
}
function applyPoseDrag(dx, key) {
  if (!poseBones || poseSelectedJointId == null) return;
  const joint = joints.find((j) => j.id === poseSelectedJointId);
  const bone = poseBones.get(poseSelectedJointId);
  if (!joint || !bone) return;
  const SENS = 0.012;
  const axis = joint.rotationLimit === "hinge" ? HINGE_AXIS_WORLD : viewDepthAxis(key);
  if (!axis) return;
  bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dx * SENS));
  poseRootGroup.updateMatrixWorld(true);
  rebuildRigVisual();
  rebuildScene();
}

// ---------- RIGGINGモードのリグ情報書き出し(JSON) ----------
// 指示書の要件(ボーン名・ID・親ID・始点/終点座標・回転制限・左右情報・
// Root情報)をすべて含める。「始点/終点」は、このアプリの内部データ
// (joint1点+親への参照)から、親jointの位置を始点・自分の位置を終点として
// 導出している。GLTF/GLBのSkeletonとして書き出す機能は将来の拡張とし、
// 今回はまずJSONとして保存できることを優先する
function exportRigJSON() {
  const data = {
    joints: joints.map((j) => {
      const parent = j.parentId != null ? joints.find((jj) => jj.id === j.parentId) : null;
      return {
        id: j.id,
        name: j.name,
        parentId: j.parentId,
        isRoot: j.parentId == null,
        side: j.side,
        rotationLimit: j.rotationLimit,
        start: parent ? { x: parent.x, y: parent.y, z: parent.z } : { x: j.x, y: j.y, z: j.z },
        end: { x: j.x, y: j.y, z: j.z },
        mirrorId: j.mirrorId,
      };
    }),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rig.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- アプリ全体のモード(MODEL/RIGGING) ----------
let appMode = "model"; // "model" | "rigging"
let selectedJointId = null; // RIGGINGモード(EDIT中)で選択中/チェーンの親として使う関節
let jointDragState = null; // { jointId, key, beforeSnapshot, startX, startY, startZ } (TOP/FRONT/LEFTでの関節ドラッグのみ)

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

const appModeModelBtn = document.getElementById("appModeModelBtn");
const appModeRiggingBtn = document.getElementById("appModeRiggingBtn");
const modeRowEl = document.getElementById("modeRow");
const rigRowEl = document.getElementById("rigRow");
const scaleRowEl = document.getElementById("scaleRow");
const symmetryBtn = document.getElementById("symmetryBtn");
const testPoseBtn = document.getElementById("testPoseBtn");
const resetPoseBtn = document.getElementById("resetPoseBtn");
const jointHingeToggleBtn = document.getElementById("jointHingeToggleBtn");
const rigExportBtn = document.getElementById("rigExportBtn");
const modeVertexBtn = document.getElementById("modeVertexBtn");
const modeEdgeBtn = document.getElementById("modeEdgeBtn");
const modeFaceBtn = document.getElementById("modeFaceBtn");
const deleteBtn = document.getElementById("deleteBtn");
const undoBtn = document.getElementById("undoBtn");
const gridBtn = document.getElementById("gridBtn");
const magnetBtn = document.getElementById("magnetBtn");
const importBtn = document.getElementById("importBtn");
const importFileInput = document.getElementById("importFileInput");
const exportBtn = document.getElementById("exportBtn");
const colorBtn = document.getElementById("colorBtn");
const colorPaletteOverlay = document.getElementById("colorPaletteOverlay");
const colorPickerInput = document.getElementById("colorPickerInput");
const colorPaletteCloseBtn = document.getElementById("colorPaletteCloseBtn");
const scaleUpBtn = document.getElementById("scaleUpBtn");
const scaleDownBtn = document.getElementById("scaleDownBtn");
const objectInfoEl = document.getElementById("objectInfo");
const objSizeXEl = document.getElementById("objSizeX");
const objSizeYEl = document.getElementById("objSizeY");
const objSizeZEl = document.getElementById("objSizeZ");
const objScaleEl = document.getElementById("objScale");
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
  updateColorBtnState();
  updateStatus();
}
modeVertexBtn.addEventListener("click", () => setMode("vertex"));
modeEdgeBtn.addEventListener("click", () => setMode("edge"));
modeFaceBtn.addEventListener("click", () => setMode("face"));
gridBtn.addEventListener("click", () => setGridVisible(!gridVisible));
magnetBtn.addEventListener("click", () => setMagnetEnabled(!magnetEnabled));

// appMode(MODEL/RIGGING)の切り替え。頂点/辺/面の編集状態とRIGGINGの選択
// 状態は互いに無関係なデータなので、切り替え時にそれぞれの選択だけを
// リセットし、データ自体(vertices/edges/faces/joints)は一切変更しない
function setAppMode(newAppMode) {
  appMode = newAppMode;
  appModeModelBtn.classList.toggle("active", appMode === "model");
  appModeRiggingBtn.classList.toggle("active", appMode === "rigging");
  modeRowEl.style.display = appMode === "model" ? "" : "none";
  scaleRowEl.style.display = appMode === "model" ? "" : "none";
  colorBtn.style.display = appMode === "model" ? "" : "none";
  rigRowEl.style.display = appMode === "rigging" ? "" : "none";
  if (appMode !== "rigging" && testPoseActive) setTestPoseActive(false);
  selectedVertexId = null;
  selectedEdgeId = null;
  selectedFaceId = null;
  pendingVerts = [];
  selectedJointId = null;
  rebuildScene();
  rebuildRigVisual();
  updateDeleteBtnState();
  updateColorBtnState();
  updateStatus();
}
appModeModelBtn.addEventListener("click", () => setAppMode("model"));
appModeRiggingBtn.addEventListener("click", () => setAppMode("rigging"));
symmetryBtn.addEventListener("click", () => {
  symmetryEnabled = !symmetryEnabled;
  symmetryBtn.classList.toggle("active", symmetryEnabled);
});
testPoseBtn.addEventListener("click", () => setTestPoseActive(!testPoseActive));
resetPoseBtn.addEventListener("click", () => resetPose());
jointHingeToggleBtn.addEventListener("click", () => {
  if (selectedJointId == null) return;
  const j = joints.find((jj) => jj.id === selectedJointId);
  if (!j) return;
  pushUndoSnapshot();
  j.rotationLimit = j.rotationLimit === "hinge" ? "free" : "hinge";
  rebuildRigVisual();
  updateStatus();
});
rigExportBtn.addEventListener("click", () => {
  if (joints.length === 0) { statusEl.textContent = "書き出せる関節がありません"; return; }
  exportRigJSON();
  statusEl.textContent = "rig.jsonを書き出しました";
});

function updateDeleteBtnState() {
  if (appMode === "rigging") {
    deleteBtn.disabled = testPoseActive || selectedJointId == null;
    return;
  }
  const enabled =
    (mode === "vertex" && selectedVertexId != null) ||
    (mode === "edge" && selectedEdgeId != null) ||
    (mode === "face" && selectedFaceId != null);
  deleteBtn.disabled = !enabled;
}
function updateColorBtnState() {
  const enabled = appMode === "model" && mode === "face" && selectedFaceId != null;
  colorBtn.disabled = !enabled;
  if (!enabled) closeColorPalette(); // 選択が外れたら、開いていたパレットも閉じる
}
function updateJointHingeBtnState() {
  if (appMode !== "rigging" || testPoseActive || selectedJointId == null) {
    jointHingeToggleBtn.disabled = true;
    jointHingeToggleBtn.textContent = "回転: FREE";
    return;
  }
  const j = joints.find((jj) => jj.id === selectedJointId);
  jointHingeToggleBtn.disabled = !j;
  jointHingeToggleBtn.textContent = j && j.rotationLimit === "hinge" ? "回転: HINGE" : "回転: FREE";
}
function updateUndoBtnState() {
  undoBtn.disabled = undoStack.length === 0;
}
function updateStats() {
  statsEl.textContent = appMode === "rigging"
    ? `関節: ${joints.length}`
    : `頂点: ${vertices.length}  辺: ${edges.length}  面: ${faces.length}`;
}

// 1ワールド単位 = 1m という前提で、見やすい単位(m/cm/mm)に自動変換する
function formatLength(meters) {
  const abs = Math.abs(meters);
  if (abs === 0) return "0.00 m";
  if (abs >= 1) return `${meters.toFixed(2)} m`;
  if (abs >= 0.01) return `${(meters * 100).toFixed(1)} cm`;
  return `${(meters * 1000).toFixed(1)} mm`;
}

// 現在のモデル全体のバウンディングボックス実寸(X/Y/Z)と、モデル
// スケール倍率を画面に表示する。カメラのズーム倍率とは無関係に、
// 頂点座標そのものから計算した「実際のオブジェクトサイズ」を示す
function updateObjectInfo() {
  scaleUpBtn.disabled = vertices.length === 0;
  scaleDownBtn.disabled = vertices.length === 0;
  if (vertices.length === 0) {
    objectInfoEl.style.display = "none";
    return;
  }
  objectInfoEl.style.display = "";
  const box = computeVerticesBounds(vertices.map((v) => v.id));
  const size = box.getSize(new THREE.Vector3());
  objSizeXEl.textContent = formatLength(size.x);
  objSizeYEl.textContent = formatLength(size.y);
  objSizeZEl.textContent = formatLength(size.z);
  objScaleEl.textContent = modelScale.toFixed(2);
}

scaleUpBtn.addEventListener("click", () => {
  if (vertices.length === 0) return;
  pushUndoSnapshot();
  scaleModel(MODEL_SCALE_STEP);
  rebuildScene();
});
scaleDownBtn.addEventListener("click", () => {
  if (vertices.length === 0) return;
  pushUndoSnapshot();
  scaleModel(1 / MODEL_SCALE_STEP);
  rebuildScene();
});
function updateStatus() {
  updateJointHingeBtnState();
  if (appMode === "rigging") {
    if (testPoseActive) {
      statusEl.textContent = poseSelectedJointId != null
        ? "TEST POSE: TOP/FRONT/LEFTビューでドラッグして回転(FREEビューはタップでの選択のみ)"
        : "TEST POSE: 関節をタップして選択してください";
    } else if (selectedJointId != null) {
      const j = joints.find((jj) => jj.id === selectedJointId);
      statusEl.textContent = `「${j ? j.name : ""}」を選択中: 別の関節をタップで接続・空いた場所をタップで次のボーンを追加・ドラッグで位置調整`;
    } else {
      statusEl.textContent = "RIGGINGモード: 関節位置をタップして配置(最初の関節がRootになります)";
    }
    return;
  }
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
  if (appMode === "rigging") {
    if (selectedJointId != null) {
      pushUndoSnapshot();
      deleteJointCascade(selectedJointId);
      selectedJointId = null;
    }
    rebuildRigVisual();
    updateDeleteBtnState();
    updateStatus();
    return;
  }
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
  updateColorBtnState();
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

// ---------- GLBインポート(編集可能な頂点/辺/面としての取り込み) ----------
// Tripo等の外部サービスで生成したGLBモデル(ボーンなし)を、手でタップして
// 作るのと完全に同じ頂点/辺/面データとして取り込む。GLTFLoader自体は
// Three.js本家の第三者ライブラリ(他プロジェクトと同じrevision)をそのまま
// コピーしたものであり、取り込み後のロジック(頂点の溶接・辺の生成・
// ビューのフィット)はこのプロジェクト用に新規実装している。
const IMPORT_WELD_EPSILON = 1e-4; // ほぼ同じ座標の頂点は同一頂点として溶接する

// GLTFのインデックス付き頂点バッファは、法線/UVが異なるだけで同じ位置に
// 複数の頂点エントリを持つことが多い。座標を量子化したキーで同一頂点を
// 束ねることで、隣接する三角形が正しく頂点を共有する「編集可能な」
// トポロジーに変換する(そうしないと、頂点を動かしても隣の面が追従しない)。
// テクスチャを持たない単純な単色マテリアルの場合は、その色をそのまま
// face.colorへ引き継ぐ(このアプリ自身が書き出したGLBを再インポートした
// 際に、面カラーが正しく復元されるようにするため。テクスチャ付きの
// マテリアルは、UV/テクスチャ自体を保持しない既存方針のまま対象外とする)
//
// vertexIdByKeyは1回のGLBインポート全体(複数Meshにまたがる場合も)で
// 共有する。面カラー機能のエクスポートは、色ごとに別々のMesh(=別々の
// 頂点バッファ)として書き出すため、色の境界をまたぐ頂点はMesh単位で
// 溶接すると重複してしまう。ファイル全体で共有した溶接マップを使うことで、
// 色違いの面同士が接する境界の頂点も正しく1つの編集可能な頂点にまとまる。
function importGeometryAsEditableMesh(geometry, matrixWorld, material, vertexIdByKey) {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr) return { addedFaces: 0 };
  const flatColorHex = material && !material.map && material.color
    ? `#${material.color.getHexString()}`
    : null;

  const indexAttr = geometry.getIndex();
  const localToModelId = new Array(posAttr.count).fill(-1);
  const tmp = new THREE.Vector3();

  function weldedVertexId(localIndex) {
    if (localToModelId[localIndex] !== -1) return localToModelId[localIndex];
    tmp.fromBufferAttribute(posAttr, localIndex).applyMatrix4(matrixWorld);
    const key = [tmp.x, tmp.y, tmp.z].map((n) => Math.round(n / IMPORT_WELD_EPSILON)).join(",");
    let id = vertexIdByKey.get(key);
    if (id == null) {
      id = addVertex(tmp.x, tmp.y, tmp.z).id;
      vertexIdByKey.set(key, id);
    }
    localToModelId[localIndex] = id;
    return id;
  }

  const triCount = Math.floor((indexAttr ? indexAttr.count : posAttr.count) / 3);
  let addedFaces = 0;
  for (let i = 0; i < triCount; i++) {
    const i0 = indexAttr ? indexAttr.getX(i * 3) : i * 3;
    const i1 = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;
    const a = weldedVertexId(i0), b = weldedVertexId(i1), c = weldedVertexId(i2);
    if (a === b || b === c || a === c) continue; // 溶接の結果つぶれた退化三角形は読み飛ばす
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
    const f = addFace(a, b, c);
    if (f) {
      if (flatColorHex) f.color = flatColorHex;
      addedFaces++;
    }
  }
  return { addedFaces };
}

function computeVerticesBounds(ids) {
  const box = new THREE.Box3();
  for (const id of ids) {
    const v = vertices.find((vv) => vv.id === id);
    if (v) box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
  }
  return box;
}

// インポートしたモデル全体が最初から各ビューに収まるよう、ズーム・パンと
// FREEビューのオービット距離を自動調整する(手作業でズーム/パンし直す
// 手間を省く)
function fitViewsToBounds(box) {
  if (box.isEmpty()) return;
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  // 各ビューの矩形は正方形とは限らない(スマートフォンでは特に縦長/横長に
  // なりやすい)。横方向に必要な半幅・縦方向に必要な半高さをそれぞれ
  // 独立に求め、矩形のアスペクト比で正しく割り戻してから大きい方を
  // 採用する(片方の軸だけで決めると、もう片方の軸がはみ出すことがある)
  function fitZoom(key, halfWidthWorld, halfHeightWorld) {
    const rect = viewLayout[key];
    const aspect = rect && rect.h > 0 ? rect.w / rect.h : 1;
    const neededHalfH = Math.max(halfHeightWorld, aspect > 0 ? halfWidthWorld / aspect : halfWidthWorld, 0.25);
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, VIEW_SIZE / (neededHalfH * 1.3)));
  }

  viewTransform.top.zoom = fitZoom("top", size.x / 2, size.z / 2);
  viewTransform.top.panX = center.x;
  viewTransform.top.panZ = center.z;

  viewTransform.front.zoom = fitZoom("front", size.x / 2, size.y / 2);
  viewTransform.front.panX = center.x;
  viewTransform.front.panY = center.y;

  viewTransform.left.zoom = fitZoom("left", size.z / 2, size.y / 2);
  viewTransform.left.panY = center.y;
  viewTransform.left.panZ = center.z;

  for (const key of ["top", "front", "left"]) updateOrthoCameraTransform(key);

  const maxExtent = Math.max(size.x, size.y, size.z, 0.5);
  controls.target.copy(center);
  const dir = freeCamera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0.7, 1);
  dir.normalize().multiplyScalar(maxExtent * 2.2);
  freeCamera.position.copy(center).add(dir);
  controls.update();

  setCursor(center.x, center.y, center.z);
}

function importGLTFArrayBuffer(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(arrayBuffer, "", (gltf) => {
      pushUndoSnapshot();
      const beforeVertexCount = vertices.length;
      let addedFaces = 0;
      const vertexIdByKey = new Map(); // ファイル全体(複数Meshにまたがる場合も)で溶接マップを共有する
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((obj) => {
        if (obj.isMesh && obj.geometry) {
          addedFaces += importGeometryAsEditableMesh(obj.geometry, obj.matrixWorld, obj.material, vertexIdByKey).addedFaces;
        }
      });
      const box = computeVerticesBounds(vertices.map((v) => v.id));
      fitViewsToBounds(box);
      rebuildScene();
      updateDeleteBtnState();
      updateStatus();
      resolve({ addedVertices: vertices.length - beforeVertexCount, addedFaces });
    }, (err) => reject(err));
  });
}

importBtn.addEventListener("click", () => importFileInput.click());
importFileInput.addEventListener("change", async () => {
  const file = importFileInput.files && importFileInput.files[0];
  importFileInput.value = ""; // 同じファイルを連続で選び直せるようにリセットしておく
  if (!file) return;
  statusEl.textContent = `「${file.name}」を読み込み中...`;
  try {
    const buf = await file.arrayBuffer();
    const result = await importGLTFArrayBuffer(buf);
    statusEl.textContent = `インポート完了: 頂点+${result.addedVertices} 面+${result.addedFaces}`;
  } catch (err) {
    console.error("GLB import failed:", err);
    statusEl.textContent = "GLBの読み込みに失敗しました";
  }
});

// ---------- GLBエクスポート(編集結果をゲームへ持ち出す) ----------
// 将来のGLTF/GLB出力を見据えたFace.colorの設計を、実際に書き出せる形に
// する。同じ色を持つ面をまとめて1つのMesh(=1つのMaterial)にすることで、
// 「面カラー機能」のFace→Material→GLTF/GLBという拡張方針をそのまま
// 実現している。GLTFExporter自体はThree.js本家(他プロジェクトの
// humanoid-gltf-exporterと同じr160)の第三者ライブラリをそのまま
// コピーしたもの。
function buildExportScene() {
  const groups = new Map(); // 色のHex文字列 -> { positions: [], indices: [], nextLocalIndex }
  function groupFor(colorHex) {
    let g = groups.get(colorHex);
    if (!g) {
      g = { positions: [], indices: [], vertexIdToLocal: new Map() };
      groups.set(colorHex, g);
    }
    return g;
  }
  for (const f of faces) {
    const colorHex = f.color || `#${DEFAULT_FACE_COLOR.toString(16).padStart(6, "0")}`;
    const g = groupFor(colorHex);
    for (const vid of f.verts) {
      if (!g.vertexIdToLocal.has(vid)) {
        const v = vertices.find((vv) => vv.id === vid);
        g.vertexIdToLocal.set(vid, g.positions.length / 3);
        g.positions.push(v.x, v.y, v.z);
      }
      g.indices.push(g.vertexIdToLocal.get(vid));
    }
  }

  const scene = new THREE.Scene();
  for (const [colorHex, g] of groups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(g.positions, 3));
    geo.setIndex(g.indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 1, metalness: 0 });
    scene.add(new THREE.Mesh(geo, mat));
  }
  return scene;
}

function exportGLB() {
  return new Promise((resolve, reject) => {
    if (faces.length === 0) { reject(new Error("書き出せる面がありません")); return; }
    const scene = buildExportScene();
    const exporter = new GLTFExporter();
    exporter.parse(scene, (result) => resolve(result), (err) => reject(err), { binary: true });
  });
}

exportBtn.addEventListener("click", async () => {
  statusEl.textContent = "GLBを書き出し中...";
  try {
    const arrayBuffer = await exportGLB();
    const blob = new Blob([arrayBuffer], { type: "model/gltf-binary" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mesh-modeling-studio-export.glb";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusEl.textContent = "GLBを書き出しました";
  } catch (err) {
    console.error("GLB export failed:", err);
    statusEl.textContent = "GLBの書き出しに失敗しました(面が1つもありません)";
  }
});

// ---------- 面カラー(簡易カラーリング) ----------
// テクスチャペイントやPBRマテリアルではなく、「面を選択→COLOR→色を選択→
// その面がその色になる」という最小限の機能。選択中は既存の選択ハイライト
// (黄)が優先表示されるため、パレットから色を選ぶと内部的には即座に
// face.colorへ反映されるが、見た目の変化は選択を解除した時に確認できる
// (選択状態がどの面かを常に分かりやすくするため、選択ハイライトを
// 色で上書きしない方針。既存の選択表示の仕組みをそのまま使っている)。
function openColorPalette() {
  if (colorBtn.disabled) return;
  colorPaletteOverlay.classList.remove("hidden");
}
function closeColorPalette() {
  colorPaletteOverlay.classList.add("hidden");
}
function isColorPaletteOpen() {
  return !colorPaletteOverlay.classList.contains("hidden");
}
function applyColorToSelectedFace(color) {
  if (mode !== "face" || selectedFaceId == null) return;
  pushUndoSnapshot();
  setFaceColor(selectedFaceId, color);
  rebuildScene();
  closeColorPalette();
  updateStatus();
}

colorBtn.addEventListener("click", () => {
  if (isColorPaletteOpen()) closeColorPalette();
  else openColorPalette();
});
colorPaletteOverlay.addEventListener("click", (evt) => {
  if (evt.target === colorPaletteOverlay) closeColorPalette(); // 背景タップで閉じる
});
colorPaletteCloseBtn.addEventListener("click", closeColorPalette);
for (const swatch of document.querySelectorAll(".swatchBtn")) {
  swatch.addEventListener("click", () => applyColorToSelectedFace(swatch.dataset.color));
}
// 自由な色はドラッグ中(input)には適用せず、確定(change)時に1回だけ
// Undoスナップショットを積む
colorPickerInput.addEventListener("change", () => applyColorToSelectedFace(colorPickerInput.value));

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
  if (appMode === "rigging") {
    if (!testPoseActive) {
      let hit = findNearestJoint(evt.clientX, evt.clientY, key);
      if (!hit && selectedJointId != null) {
        // 既に選択中の関節は、多少タップ位置がずれていても掴めるようにする(頂点と同じ考え方)
        const sj = joints.find((j) => j.id === selectedJointId);
        if (sj) {
          const s = worldToScreenInView(jointDisplayPosition(sj), key);
          if (Math.hypot(s.x - evt.clientX, s.y - evt.clientY) <= VERTEX_GRAB_PX) hit = sj;
        }
      }
      if (hit) {
        jointDragState = { jointId: hit.id, key, beforeSnapshot: cloneState(), startX: hit.x, startY: hit.y, startZ: hit.z };
      }
    } else {
      // TEST POSE: 既に選択中の関節があれば、この後のドラッグを回転として扱う基準点を記録する
      poseDragLast = { x: evt.clientX, y: evt.clientY };
    }
    return;
  }
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
  if (appMode === "rigging") {
    if (!testPoseActive && jointDragState) {
      const raw = pointOnViewPlane(evt.clientX, evt.clientY, jointDragState.key);
      if (raw) {
        const p = snapPoint(raw);
        const j = joints.find((jj) => jj.id === jointDragState.jointId);
        if (j) {
          if (jointDragState.key === "top") { j.x = p.x; j.z = p.z; }
          else if (jointDragState.key === "front") { j.x = p.x; j.y = p.y; }
          else if (jointDragState.key === "left") { j.y = p.y; j.z = p.z; }
          setCursor(j.x, j.y, j.z);
          rebuildRigVisual();
        }
      }
    } else if (testPoseActive && poseSelectedJointId != null && poseDragLast) {
      const dx = evt.clientX - poseDragLast.x;
      if (dx !== 0) {
        applyPoseDrag(dx, singlePointerInfo.key);
        poseDragLast = { x: evt.clientX, y: evt.clientY };
      }
    }
    return;
  }
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
      jointDragState = null;
      poseDragLast = null;
    }
    return;
  }

  if (!wasTracked || !singlePointerInfo) return;
  const dx = evt.clientX - singlePointerInfo.x, dy = evt.clientY - singlePointerInfo.y;
  const dt = performance.now() - singlePointerInfo.t;
  const isTap = Math.hypot(dx, dy) < DRAG_THRESHOLD_PX && dt < TAP_MAX_MS;
  const key = singlePointerInfo.key;

  if (key === "free") {
    if (isTap) {
      if (appMode === "rigging") {
        if (testPoseActive) handleRigPoseTap(evt.clientX, evt.clientY, "free");
        else handleRigEditTapAction(evt.clientX, evt.clientY, "free");
      } else {
        handleTapAction(evt.clientX, evt.clientY, "free");
      }
    }
  } else if (appMode === "rigging") {
    if (!testPoseActive && jointDragState) {
      const j = joints.find((jj) => jj.id === jointDragState.jointId);
      const moved = j && (j.x !== jointDragState.startX || j.y !== jointDragState.startY || j.z !== jointDragState.startZ);
      if (moved) {
        undoStack.push(jointDragState.beforeSnapshot);
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        updateUndoBtnState();
      } else if (isTap && j) {
        handleJointTapOnExisting(j);
      }
      jointDragState = null;
    } else if (isTap) {
      if (testPoseActive) handleRigPoseTap(evt.clientX, evt.clientY, key);
      else handleRigEditTapAction(evt.clientX, evt.clientY, key);
    }
    poseDragLast = null;
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
  rebuildRigVisual();
  updateDeleteBtnState();
  updateColorBtnState();
  updateStatus();
}
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", (evt) => {
  activePointers.delete(evt.pointerId);
  if (gesture && Array.from(activePointers.values()).filter((p) => p.view === gesture.view).length < 2) gesture = null;
  dragState = null;
  jointDragState = null;
  poseDragLast = null;
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
updateObjectInfo();
setGridVisible(true);
setMagnetEnabled(false);
rebuildRigVisual();

// ---------- テスト/デバッグ用に主要オブジェクトを公開 ----------
window.__scene = { scene, camerasByKey, renderer, topGrid, frontGrid, leftGrid };
window.__model = {
  getVertices: () => vertices.map((v) => ({ ...v })),
  getEdges: () => edges.map((e) => ({ ...e })),
  getFaces: () => faces.map((f) => ({ id: f.id, verts: f.verts.slice(), color: f.color ?? null })),
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
  importGLTFArrayBuffer,
  isColorBtnDisabled: () => colorBtn.disabled,
  isColorPaletteOpen,
  openColorPalette,
  closeColorPalette,
  pickColor: (color) => applyColorToSelectedFace(color),
  getPaletteSwatchColors: () => Array.from(document.querySelectorAll(".swatchBtn")).map((b) => b.dataset.color),
  setFaceColorDirect: (id, color) => { pushUndoSnapshot(); setFaceColor(id, color); rebuildScene(); },
  // 複数の面の色を1回のUndoでまとめて設定する(colorByFaceIdは { faceId: hex } 形式)。
  // 外部スクリプトから大量の面を一括着色する用途を想定
  setFaceColorsDirect: (colorByFaceId) => {
    pushUndoSnapshot();
    for (const [idStr, color] of Object.entries(colorByFaceId)) setFaceColor(Number(idStr), color);
    rebuildScene();
  },
  // モデル全体を一律倍率で拡大縮小する(頂点座標を直接書き換える)。
  // オブジェクト全体の拡大縮小UIは今回未実装だが、インポートしたモデルを
  // ゲームで使える大きさに揃える用途のため、データレベルの操作として用意した
  scaleAllVerticesDirect: (factor) => {
    pushUndoSnapshot();
    for (const v of vertices) { v.x *= factor; v.y *= factor; v.z *= factor; }
    rebuildScene();
  },
  getBoundsY: () => {
    if (vertices.length === 0) return { minY: 0, maxY: 0 };
    let minY = Infinity, maxY = -Infinity;
    for (const v of vertices) { minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
    return { minY, maxY };
  },
  exportGLB,
  fitViewsToCurrentBounds: () => fitViewsToBounds(computeVerticesBounds(vertices.map((v) => v.id))),
  scaleUp: () => scaleUpBtn.click(),
  scaleDown: () => scaleDownBtn.click(),
  isScaleUpBtnDisabled: () => scaleUpBtn.disabled,
  isScaleDownBtnDisabled: () => scaleDownBtn.disabled,
  getModelScale: () => modelScale,
  getObjectSize: () => {
    if (vertices.length === 0) return null;
    const box = computeVerticesBounds(vertices.map((v) => v.id));
    const size = box.getSize(new THREE.Vector3());
    return { x: size.x, y: size.y, z: size.z };
  },
  getObjectCenter: () => {
    if (vertices.length === 0) return null;
    const box = computeVerticesBounds(vertices.map((v) => v.id));
    return box.getCenter(new THREE.Vector3()).toArray();
  },
  formatLength,
  isObjectInfoVisible: () => objectInfoEl.style.display !== "none",
  getObjectInfoText: () => ({
    x: objSizeXEl.textContent, y: objSizeYEl.textContent, z: objSizeZEl.textContent, scale: objScaleEl.textContent,
  }),
};

// ---------- RIGGINGモードのテスト/デバッグ用フック ----------
window.__rig = {
  getAppMode: () => appMode,
  setAppMode,
  getJoints: () => joints.map((j) => ({ ...j })),
  getSelectedJointId: () => selectedJointId,
  isSymmetryEnabled: () => symmetryEnabled,
  setSymmetryEnabled: (v) => { symmetryEnabled = v; symmetryBtn.classList.toggle("active", v); },
  toggleSymmetry: () => symmetryBtn.click(),
  // タップ操作を介さない決定論的な経路(自動テスト用)
  addJointDirect: (name, x, y, z, parentId) => {
    pushUndoSnapshot();
    const j = createJointWithSymmetry(name, x, y, z, parentId ?? null);
    selectedJointId = j.id;
    rebuildRigVisual();
    updateDeleteBtnState();
    updateStatus();
    return j.id;
  },
  selectJoint: (id) => { selectedJointId = id; rebuildRigVisual(); updateDeleteBtnState(); updateStatus(); },
  reparentJointDirect: (jointId, newParentId) => {
    pushUndoSnapshot();
    const ok = reparentJoint(jointId, newParentId);
    if (!ok) { undoStack.pop(); updateUndoBtnState(); }
    rebuildRigVisual();
    return ok;
  },
  moveJointDirect: (id, x, y, z) => {
    pushUndoSnapshot();
    const j = joints.find((jj) => jj.id === id);
    if (j) { j.x = x; j.y = y; j.z = z; }
    rebuildRigVisual();
    return !!j;
  },
  deleteJoint: () => deleteBtn.click(),
  isDeleteBtnDisabled: () => deleteBtn.disabled,
  undo: () => undoBtn.click(),
  getUndoStackSize: () => undoStack.length,
  // タップ経路のテスト用(実際のpointerup経路と同じ関数を呼ぶ)
  simulateTap: (clientX, clientY, key) => {
    if (testPoseActive) handleRigPoseTap(clientX, clientY, key);
    else handleRigEditTapAction(clientX, clientY, key);
    rebuildRigVisual();
    updateStatus();
  },
  findNearestJointAt: (clientX, clientY, key) => {
    const j = findNearestJoint(clientX, clientY, key);
    return j ? j.id : null;
  },
  getJointScreenPosition: (id, key) => {
    const j = joints.find((jj) => jj.id === id);
    if (!j) return null;
    return worldToScreenInView(jointDisplayPosition(j), key);
  },
  // TEST POSEのテスト/デバッグ用
  isTestPoseActive: () => testPoseActive,
  setTestPoseActive,
  toggleTestPose: () => testPoseBtn.click(),
  selectPoseJoint: (id) => { poseSelectedJointId = id; rebuildRigVisual(); },
  getPoseSelectedJointId: () => poseSelectedJointId,
  rotateSelectedPoseJointBy: (dx, key) => applyPoseDrag(dx, key),
  resetPose: () => resetPoseBtn.click(),
  isResetPoseBtnDisabled: () => resetPoseBtn.disabled,
  getJointWorldPosition: (id) => {
    const j = joints.find((jj) => jj.id === id);
    if (!j) return null;
    return jointDisplayPosition(j).toArray();
  },
  getHingeAxisWorld: () => HINGE_AXIS_WORLD.toArray(),
  isHingeJoint: (id) => {
    const j = joints.find((jj) => jj.id === id);
    return j ? j.rotationLimit === "hinge" : null;
  },
  toggleJointHinge: () => jointHingeToggleBtn.click(),
  isJointHingeToggleBtnDisabled: () => jointHingeToggleBtn.disabled,
  exportRigJSON,
  isRigExportBtnDisabled: () => rigExportBtn.disabled,
  // Phase 3(メッシュスキニング)のテスト/デバッグ用
  getMeshBindings: () => {
    if (!meshBindings) return null;
    return Array.from(meshBindings.entries()).map(([vertexId, binding]) => ({ vertexId, binding: binding.map((b) => ({ ...b })) }));
  },
  computeMeshBindingsNow: () => { computeMeshBindings(); return window.__rig.getMeshBindings(); },
  getSkinnedVertexPosition: (vertexId) => {
    const v = vertices.find((vv) => vv.id === vertexId);
    if (!v) return null;
    return skinnedVertexPosition(v).toArray();
  },
};
