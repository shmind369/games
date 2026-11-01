import * as THREE from "three";

// ---------- チューニング値 ----------
const EYE_HEIGHT = 1.6;
const MOVE_SPEED = 3.2; // m/s
const LOOK_SENSITIVITY = 0.0032;
const PITCH_LIMIT = 1.15; // ラジアン(真上/真下付近までは向けるが、完全に反転はしない)
const LOOK_ZONE_START_FRACTION = 0.42; // 画面左からこの割合より右で始めたドラッグだけを視点操作として扱う(指示書「画面右側:視点操作用のタッチ領域」に対応)

const GRAB_REACH = 7.5; // 照準で掴める最大距離
const HOLD_DISTANCE_DEFAULT = 2.6;
const HOLD_DISTANCE_MIN = 1.1;
const HOLD_DISTANCE_MAX = 6.0;
const HOLD_HEIGHT_MIN = -1.4;
const HOLD_HEIGHT_MAX = 2.6;
const HOLD_LERP = 0.22; // 1フレームあたりにどれだけ目標位置へ近づけるか(値が大きいほどキビキビ、小さいほど遅れて追従する)
const HOLD_ROT_STEP = THREE.MathUtils.degToRad(15);
const HOLD_HEIGHT_STEP = 0.18;
const HOLD_DIST_STEP = 0.28;

const GLUE_RANGE = 0.85; // 保持中の構造物の各パーツから、他パーツの中心までこの距離以内なら接着可能とみなす

// ---------- シーン ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc7e8);
scene.fog = new THREE.Fog(0x8fc7e8, 24, 70);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 200);
camera.rotation.order = "YXZ";

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- ライト ----------
scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sun = new THREE.DirectionalLight(0xfff3d6, 0.95);
sun.position.set(12, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
scene.add(sun);

// ---------- 地面 ----------
const groundMat = new THREE.MeshStandardMaterial({ color: 0x5c8a4a, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(80, 40, 0x3a5c2e, 0x3a5c2e);
grid.material.opacity = 0.18;
grid.material.transparent = true;
scene.add(grid);

// ---------- 構造物グループ(接着でまとめて動かすための入れ物) ----------
// 1つのgroupは { id, root: THREE.Group, memberIds: Set<pieceId> } を持つ。
// パーツは常にどこかのgroupに所属し、未接着の間は「自分1つだけのgroup」に
// 入っている。接着するとgroupが統合され、以後はgroup.rootを掴んで動かせば
// 所属パーツ全体が一緒に動く
let groupIdCounter = 1;
const groups = new Map(); // id -> group

function createGroup(initialMesh) {
  const root = new THREE.Group();
  root.position.copy(initialMesh.position);
  root.rotation.copy(initialMesh.rotation);
  scene.add(root);
  // メッシュをgroup配下へ、ワールド変形を保ったまま付け替える
  reparentPreservingWorldTransform(initialMesh, root);

  const id = groupIdCounter++;
  const group = { id, root, memberIds: new Set() };
  groups.set(id, group);
  return id;
}

// オブジェクトを新しい親の子にしつつ、見た目のワールド変形(位置・回転・
// 拡大率)が変わらないようローカルTransformを再計算する
// (humanoid-gltf-exporterのGLBインポートで使った手法と同じ考え方)
function reparentPreservingWorldTransform(obj, newParent) {
  obj.updateMatrixWorld(true);
  const worldMatrix = obj.matrixWorld.clone();
  newParent.add(obj);
  newParent.updateMatrixWorld(true);
  const parentWorldInverse = new THREE.Matrix4().copy(newParent.matrixWorld).invert();
  const localMatrix = new THREE.Matrix4().multiplyMatrices(parentWorldInverse, worldMatrix);
  localMatrix.decompose(obj.position, obj.quaternion, obj.scale);
}

// ---------- 掴める物体(木の板・丸太) ----------
// 各パーツは { id, mesh, groupId } を持つ。見た目の形状が異なるだけで、
// 掴む・接着のロジックからは区別しない(将来パーツ種類を増やしても
// そのまま対応できるようにするため)
let pieceIdCounter = 1;
const pieces = new Map(); // id -> piece
const meshToPieceId = new Map();

function makeBoardGeometry() {
  return new THREE.BoxGeometry(1.5, 0.08, 0.42);
}
function makeLogGeometry() {
  const geo = new THREE.CylinderGeometry(0.17, 0.17, 1.7, 14);
  geo.rotateZ(Math.PI / 2); // 丸太を横向き(長さ方向がローカルX)にする
  return geo;
}

const boardMat = () => new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.85 });
const logMat = () => new THREE.MeshStandardMaterial({ color: 0x8a6239, roughness: 0.9 });

function createPiece(kind, geometry, material, position, rotationY) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.copy(position);
  mesh.rotation.y = rotationY;
  scene.add(mesh);

  const id = pieceIdCounter++;
  const groupId = createGroup(mesh);
  const piece = { id, kind, mesh, groupId, baseEmissive: material.emissive.clone() };
  pieces.set(id, piece);
  meshToPieceId.set(mesh, id);
  groups.get(groupId).memberIds.add(id);
  return piece;
}

// ---------- 初期フィールド: 木の板3枚・丸太2本 ----------
createPiece("board", makeBoardGeometry(), boardMat(), new THREE.Vector3(-1.4, 0.3, -3.2), 0.3);
createPiece("board", makeBoardGeometry(), boardMat(), new THREE.Vector3(1.8, 0.3, -2.4), -0.6);
createPiece("board", makeBoardGeometry(), boardMat(), new THREE.Vector3(0.2, 0.3, -5.0), 1.1);
createPiece("log", makeLogGeometry(), logMat(), new THREE.Vector3(-2.6, 0.3, -5.6), 0.0);
createPiece("log", makeLogGeometry(), logMat(), new THREE.Vector3(2.6, 0.3, -5.0), 0.9);

// ---------- 接着(ジョイント)の記録 ----------
// 「どのパーツとどのパーツが接着されているか」を、グループ統合とは別に
// 保持しておく。これにより、「解除」で特定の1パーツだけをグループから
// 切り離した後、残りのパーツ同士がまだ繋がっているかどうかを連結成分
// として正しく再計算できる(mesh-modeling-studioのスキニング用
// 連結成分検出と同じUnion-Find的な考え方)
let connectionIdCounter = 1;
const connections = new Map(); // id -> { id, a: pieceId, b: pieceId }

function connectionsOf(pieceId) {
  const result = [];
  for (const c of connections.values()) if (c.a === pieceId || c.b === pieceId) result.push(c);
  return result;
}

function glueGroups(heldGroupId, targetGroupId, heldPieceId, targetPieceId) {
  if (heldGroupId === targetGroupId) return; // 既に同じ構造物
  const heldGroup = groups.get(heldGroupId);
  const targetGroup = groups.get(targetGroupId);

  // targetGroup.rootを存続させ、heldGroupの全パーツをそちらへ付け替える
  for (const memberId of Array.from(heldGroup.memberIds)) {
    const mesh = pieces.get(memberId).mesh;
    reparentPreservingWorldTransform(mesh, targetGroup.root);
    targetGroup.memberIds.add(memberId);
    pieces.get(memberId).groupId = targetGroup.id;
  }
  scene.remove(heldGroup.root);
  groups.delete(heldGroupId);

  const cid = connectionIdCounter++;
  connections.set(cid, { id: cid, a: heldPieceId, b: targetPieceId });
}

// 指定したパーツを、現在所属している構造物から切り離す。そのパーツが
// 関わる接続をすべて削除したうえで、残ったパーツ同士の連結成分を
// 辺(connections)からBFSで求め直し、成分ごとに新しいgroupへ分配する
function detachPiece(pieceId) {
  const piece = pieces.get(pieceId);
  const oldGroup = groups.get(piece.groupId);
  const memberIds = Array.from(oldGroup.memberIds);
  if (memberIds.length <= 1) return; // 単独パーツは解除する接続がない

  for (const c of connectionsOf(pieceId)) connections.delete(c.id);

  scene.remove(oldGroup.root);
  groups.delete(oldGroup.id);

  const remaining = new Set(memberIds);
  const visited = new Set();
  const components = [];
  for (const start of remaining) {
    if (visited.has(start)) continue;
    const comp = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const cur = queue.shift();
      comp.push(cur);
      for (const c of connectionsOf(cur)) {
        const other = c.a === cur ? c.b : c.a;
        if (remaining.has(other) && !visited.has(other)) {
          visited.add(other);
          queue.push(other);
        }
      }
    }
    components.push(comp);
  }

  for (const comp of components) {
    const firstMesh = pieces.get(comp[0]).mesh;
    firstMesh.updateMatrixWorld(true);
    const newGroupId = createGroup(firstMesh);
    const newGroup = groups.get(newGroupId);
    newGroup.memberIds.add(comp[0]);
    pieces.get(comp[0]).groupId = newGroupId;
    for (let i = 1; i < comp.length; i++) {
      const mesh = pieces.get(comp[i]).mesh;
      reparentPreservingWorldTransform(mesh, newGroup.root);
      newGroup.memberIds.add(comp[i]);
      pieces.get(comp[i]).groupId = newGroupId;
    }
  }
}

// ---------- プレイヤー ----------
const player = { pos: new THREE.Vector3(0, EYE_HEIGHT, 3), yaw: 0, pitch: 0 };
camera.position.copy(player.pos);

// ---------- 移動用仮想スティック ----------
const joystickBase = document.getElementById("joystickBase");
const joystickKnob = document.getElementById("joystickKnob");
const joystickDir = { x: 0, y: 0 };
let joystickPointerId = null;

function updateJoystick(clientX, clientY) {
  const rect = joystickBase.getBoundingClientRect();
  const radius = rect.width / 2;
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  const dist = Math.hypot(dx, dy) || 1;
  const clamped = Math.min(dist, radius);
  const mag = clamped / radius;
  joystickKnob.style.transform = `translate(${(dx / dist) * clamped}px, ${(dy / dist) * clamped}px)`;
  joystickDir.x = (dx / dist) * mag;
  joystickDir.y = (dy / dist) * mag;
}
function resetJoystick() {
  joystickPointerId = null;
  joystickDir.x = 0;
  joystickDir.y = 0;
  joystickKnob.style.transform = "translate(0px, 0px)";
}
joystickBase.addEventListener("pointerdown", (e) => {
  joystickPointerId = e.pointerId;
  try { joystickBase.setPointerCapture(e.pointerId); } catch { /* 合成イベント等では失敗することがあるが無視して続行できる */ }
  updateJoystick(e.clientX, e.clientY);
});
joystickBase.addEventListener("pointermove", (e) => {
  if (e.pointerId !== joystickPointerId) return;
  updateJoystick(e.clientX, e.clientY);
});
joystickBase.addEventListener("pointerup", (e) => { if (e.pointerId === joystickPointerId) resetJoystick(); });
joystickBase.addEventListener("pointercancel", resetJoystick);

// ---------- 視点操作(画面右側のドラッグ) ----------
const lookLayer = document.getElementById("lookLayer");
let lookPointerId = null;
let lastLookX = 0, lastLookY = 0;

lookLayer.addEventListener("pointerdown", (e) => {
  if (e.clientX < window.innerWidth * LOOK_ZONE_START_FRACTION) return; // 指示書の「画面右側」ゾーンのみ視点操作の開始を受け付ける
  lookPointerId = e.pointerId;
  lastLookX = e.clientX;
  lastLookY = e.clientY;
  try { lookLayer.setPointerCapture(e.pointerId); } catch { /* 同上 */ }
});
lookLayer.addEventListener("pointermove", (e) => {
  if (e.pointerId !== lookPointerId) return;
  const dx = e.clientX - lastLookX;
  const dy = e.clientY - lastLookY;
  lastLookX = e.clientX;
  lastLookY = e.clientY;
  player.yaw -= dx * LOOK_SENSITIVITY;
  player.pitch = THREE.MathUtils.clamp(player.pitch - dy * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
});
lookLayer.addEventListener("pointerup", (e) => { if (e.pointerId === lookPointerId) lookPointerId = null; });
lookLayer.addEventListener("pointercancel", () => { lookPointerId = null; });

// ---------- 照準(レイキャスト)による対象判定 ----------
const aimRaycaster = new THREE.Raycaster();
const CENTER_NDC = new THREE.Vector2(0, 0);
let aimedPieceId = null;

function updateAim() {
  aimRaycaster.setFromCamera(CENTER_NDC, camera);
  aimRaycaster.far = GRAB_REACH;
  const meshes = Array.from(pieces.values()).map((p) => p.mesh);
  const hits = aimRaycaster.intersectObjects(meshes, false);
  const newAimed = hits.length > 0 ? meshToPieceId.get(hits[0].object) : null;
  if (newAimed !== aimedPieceId) {
    if (aimedPieceId != null) setPieceHighlight(aimedPieceId, null);
    aimedPieceId = newAimed;
    if (aimedPieceId != null) setPieceHighlight(aimedPieceId, "target");
  }
}

const HIGHLIGHT_COLORS = { target: 0xffd66e, glue: 0x78ffa0 };
function setPieceHighlight(pieceId, kind) {
  const piece = pieces.get(pieceId);
  if (!piece) return;
  if (kind) piece.mesh.material.emissive.setHex(HIGHLIGHT_COLORS[kind]);
  else piece.mesh.material.emissive.copy(piece.baseEmissive);
}

// ---------- 掴む・運ぶ・接着・解除 ----------
const reticleEl = document.getElementById("reticle");
const statusTextEl = document.getElementById("statusText");
const grabBtn = document.getElementById("grabBtn");
const glueBtn = document.getElementById("glueBtn");
const releaseBtn = document.getElementById("releaseBtn");
const auxActionsEl = document.getElementById("auxActions");

let held = null; // { groupId, pieceId, holdDistance, holdHeight }
let glueTargetGroupId = null;
let glueTargetPieceId = null;

function startGrab() {
  if (held || aimedPieceId == null) return;
  const piece = pieces.get(aimedPieceId);
  setPieceHighlight(aimedPieceId, null);
  held = { groupId: piece.groupId, pieceId: aimedPieceId, holdDistance: HOLD_DISTANCE_DEFAULT, holdHeight: 0 };
  aimedPieceId = null;
}

function releaseHeld() {
  held = null;
  if (glueTargetPieceId != null) setPieceHighlight(glueTargetPieceId, null);
  glueTargetGroupId = null;
  glueTargetPieceId = null;
}

function doGlue() {
  if (!held || glueTargetGroupId == null) return;
  glueGroups(held.groupId, glueTargetGroupId, held.pieceId, glueTargetPieceId);
  releaseHeld();
}

function doRelease() {
  if (held) {
    releaseHeld();
    return;
  }
  if (aimedPieceId != null && connectionsOf(aimedPieceId).length > 0) {
    detachPiece(aimedPieceId);
  }
}

grabBtn.addEventListener("click", startGrab);
glueBtn.addEventListener("click", doGlue);
releaseBtn.addEventListener("click", doRelease);

// ---------- 補助ボタン(精密操作): 上下・前後・回転 ----------
// タップで1段階、長押しで連続して段階を進める(どちらもシンプルな
// 離散ステップのみで、自由な連続値ドラッグは今回は実装しない)
function bindStepButton(el, fn) {
  let repeatTimer = null;
  const fire = () => { if (held) fn(); };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    fire();
    repeatTimer = setTimeout(function repeat() {
      fire();
      repeatTimer = setTimeout(repeat, 90);
    }, 350);
  });
  const stop = () => { clearTimeout(repeatTimer); repeatTimer = null; };
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  el.addEventListener("pointerleave", stop);
}
bindStepButton(document.getElementById("upBtn"), () => { held.holdHeight = Math.min(HOLD_HEIGHT_MAX, held.holdHeight + HOLD_HEIGHT_STEP); });
bindStepButton(document.getElementById("downBtn"), () => { held.holdHeight = Math.max(HOLD_HEIGHT_MIN, held.holdHeight - HOLD_HEIGHT_STEP); });
bindStepButton(document.getElementById("fwdBtn"), () => { held.holdDistance = Math.max(HOLD_DISTANCE_MIN, held.holdDistance - HOLD_DIST_STEP); });
bindStepButton(document.getElementById("backBtn"), () => { held.holdDistance = Math.min(HOLD_DISTANCE_MAX, held.holdDistance + HOLD_DIST_STEP); });
bindStepButton(document.getElementById("rotLeftBtn"), () => { groups.get(held.groupId).root.rotation.y += HOLD_ROT_STEP; });
bindStepButton(document.getElementById("rotRightBtn"), () => { groups.get(held.groupId).root.rotation.y -= HOLD_ROT_STEP; });

// ---------- 開始画面 ----------
const startOverlay = document.getElementById("startOverlay");
document.getElementById("startBtn").addEventListener("click", () => {
  startOverlay.classList.remove("show");
});

// ---------- メインループ ----------
const clock = new THREE.Clock();
const worldUp = new THREE.Vector3(0, 1, 0);

function updatePlayerMovement(delta) {
  const mag = Math.hypot(joystickDir.x, joystickDir.y);
  if (mag > 0.001) {
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(worldUp, player.yaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(worldUp, player.yaw);
    const dir = forward.multiplyScalar(-joystickDir.y).add(right.multiplyScalar(joystickDir.x));
    if (dir.lengthSq() > 1e-6) dir.normalize();
    player.pos.addScaledVector(dir, MOVE_SPEED * mag * delta);
  }
  player.pos.y = EYE_HEIGHT; // 地面を突き抜けない(今回は平坦な地面のみなので固定でよい)
  camera.position.copy(player.pos);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
}

function updateHeldObject() {
  if (!held) return;
  const group = groups.get(held.groupId);
  const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const target = camera.position.clone().addScaledVector(camForward, held.holdDistance);
  target.y = Math.max(0.22, target.y + held.holdHeight);
  group.root.position.lerp(target, HOLD_LERP);

  // 保持中の構造物の各パーツに最も近い、他の構造物のパーツを探し、
  // 一定距離以内なら接着対象として光らせる
  let bestDist = GLUE_RANGE;
  let bestOtherPieceId = null;
  let bestHeldPieceId = null;
  for (const memberId of group.memberIds) {
    const memberPos = pieces.get(memberId).mesh.getWorldPosition(new THREE.Vector3());
    for (const [otherId, otherPiece] of pieces) {
      if (otherPiece.groupId === held.groupId) continue;
      const d = memberPos.distanceTo(otherPiece.mesh.getWorldPosition(new THREE.Vector3()));
      if (d < bestDist) { bestDist = d; bestOtherPieceId = otherId; bestHeldPieceId = memberId; }
    }
  }
  const newTargetPieceId = bestOtherPieceId;
  if (newTargetPieceId !== glueTargetPieceId) {
    if (glueTargetPieceId != null) setPieceHighlight(glueTargetPieceId, null);
    glueTargetPieceId = newTargetPieceId;
    glueTargetGroupId = newTargetPieceId != null ? pieces.get(newTargetPieceId).groupId : null;
    held.pieceId = bestHeldPieceId != null ? bestHeldPieceId : held.pieceId;
    if (glueTargetPieceId != null) setPieceHighlight(glueTargetPieceId, "glue");
  }
}

function updateUI() {
  reticleEl.classList.remove("target", "glue", "held");
  if (held) {
    reticleEl.classList.add("held");
  } else if (aimedPieceId != null) {
    reticleEl.classList.add("target");
  }

  grabBtn.disabled = held != null || aimedPieceId == null;
  glueBtn.disabled = !held || glueTargetGroupId == null;
  releaseBtn.disabled = held == null && (aimedPieceId == null || connectionsOf(aimedPieceId).length === 0);
  auxActionsEl.classList.toggle("show", held != null);

  let status;
  if (held) {
    status = glueTargetGroupId != null ? "近くの木材に接着できます" : "つかんでいます。補助ボタンで位置調整";
  } else if (aimedPieceId != null) {
    status = connectionsOf(aimedPieceId).length > 0 ? "照準の木材: つかむ、または解除で分離" : "照準の木材をつかめます";
  } else {
    status = "照準を木材に合わせてください";
  }
  if (statusTextEl.textContent !== status) statusTextEl.textContent = status;
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  if (startOverlay.classList.contains("show")) {
    renderer.render(scene, camera);
    return;
  }
  updatePlayerMovement(delta);
  if (held) updateHeldObject();
  else updateAim();
  updateUI();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// ---------- テスト/デバッグ用フック ----------
window.__grab = {
  getPieces: () => Array.from(pieces.values()).map((p) => ({
    id: p.id, kind: p.kind, groupId: p.groupId,
    position: p.mesh.getWorldPosition(new THREE.Vector3()).toArray(),
  })),
  getGroups: () => Array.from(groups.values()).map((g) => ({ id: g.id, memberIds: Array.from(g.memberIds) })),
  getConnections: () => Array.from(connections.values()).map((c) => ({ ...c })),
  getAimedPieceId: () => aimedPieceId,
  getHeld: () => (held ? { ...held } : null),
  getGroupRotationY: (groupId) => groups.get(groupId)?.root.rotation.y ?? null,
  getGlueTargetPieceId: () => glueTargetPieceId,
  isGrabBtnDisabled: () => grabBtn.disabled,
  isGlueBtnDisabled: () => glueBtn.disabled,
  isReleaseBtnDisabled: () => releaseBtn.disabled,
  startGrab,
  doGlue,
  doRelease,
  detachPieceDirect: (pieceId) => detachPiece(pieceId),
  getPlayerPosition: () => player.pos.toArray(),
  getPlayerYawPitch: () => ({ yaw: player.yaw, pitch: player.pitch }),
  setPlayerYawPitch: (yaw, pitch) => { player.yaw = yaw; player.pitch = pitch; },
  setPlayerPosition: (x, y, z) => { player.pos.set(x, EYE_HEIGHT, z); },
  dismissStartOverlay: () => startOverlay.classList.remove("show"),
  setJoystickDir: (x, y) => { joystickDir.x = x; joystickDir.y = y; },
  getStatusText: () => statusTextEl.textContent,
  adjustHeld: (field, delta) => {
    if (!held) return;
    if (field === "height") held.holdHeight = THREE.MathUtils.clamp(held.holdHeight + delta, HOLD_HEIGHT_MIN, HOLD_HEIGHT_MAX);
    else if (field === "distance") held.holdDistance = THREE.MathUtils.clamp(held.holdDistance + delta, HOLD_DISTANCE_MIN, HOLD_DISTANCE_MAX);
    else if (field === "rotationY") groups.get(held.groupId).root.rotation.y += delta;
  },
  forceRenderFrame: () => {
    updatePlayerMovement(0);
    if (held) updateHeldObject();
    else updateAim();
    updateUI();
    renderer.render(scene, camera);
  },
};
