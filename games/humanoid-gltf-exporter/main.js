import * as THREE from "three";
import { OrbitControls } from "./vendor/controls/OrbitControls.js";
import { GLTFExporter } from "./vendor/exporters/GLTFExporter.js";

// ---------- Renderer / scene / camera ----------
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d22);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.3, 3.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;
controls.minDistance = 1.2;
controls.maxDistance = 6;
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(2, 4, 3);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x88aaff, 0.3);
rimLight.position.set(-3, 2, -2);
scene.add(rimLight);

const grid = new THREE.GridHelper(10, 20, 0x3a4150, 0x2a2f3a);
scene.add(grid);

// ---------- 簡易ヒューマノイド・スケルトン ----------
// 各ボーンのローカル位置(親からのオフセット)。参照スケールは
// third-person-boxer-3d と概ね揃えている(身長約1.85)
function bone(name, x, y, z) {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  return b;
}

// プロポーション調整(第2段): 頭を少し拡大、首を細く伸ばして肩への
// つながりを自然にし、肩幅をさらに拡張、腕を少し伸ばして人体比率に
// 近づけた(ボーンの名前・階層・本数は変更していない)
const hips = bone("Hips", 0, 0.92, 0);
const spine = bone("Spine", 0, 0.13, 0);
const chest = bone("Chest", 0, 0.17, 0);
const neck = bone("Neck", 0, 0.19, 0);
const head = bone("Head", 0, 0.15, 0);

const leftShoulder = bone("LeftShoulder", 0.195, 0.13, 0);
const leftUpperArm = bone("LeftUpperArm", 0.07, 0, 0);
const leftForearm = bone("LeftForearm", 0, -0.29, 0);
const leftHand = bone("LeftHand", 0, -0.27, 0);

const rightShoulder = bone("RightShoulder", -0.195, 0.13, 0);
const rightUpperArm = bone("RightUpperArm", -0.07, 0, 0);
const rightForearm = bone("RightForearm", 0, -0.29, 0);
const rightHand = bone("RightHand", 0, -0.27, 0);

const leftUpperLeg = bone("LeftUpperLeg", 0.10, -0.02, 0);
const leftLowerLeg = bone("LeftLowerLeg", 0, -0.43, 0);
const leftFoot = bone("LeftFoot", 0, -0.43, 0.045);

const rightUpperLeg = bone("RightUpperLeg", -0.10, -0.02, 0);
const rightLowerLeg = bone("RightLowerLeg", 0, -0.43, 0);
const rightFoot = bone("RightFoot", 0, -0.43, 0.045);

hips.add(spine, leftUpperLeg, rightUpperLeg);
spine.add(chest);
chest.add(neck, leftShoulder, rightShoulder);
neck.add(head);
leftShoulder.add(leftUpperArm);
leftUpperArm.add(leftForearm);
leftForearm.add(leftHand);
rightShoulder.add(rightUpperArm);
rightUpperArm.add(rightForearm);
rightForearm.add(rightHand);
leftUpperLeg.add(leftLowerLeg);
leftLowerLeg.add(leftFoot);
rightUpperLeg.add(rightLowerLeg);
rightLowerLeg.add(rightFoot);

const root = new THREE.Group();
root.name = "Humanoid";
root.add(hips);
scene.add(root);
root.updateMatrixWorld(true); // レストポーズのワールド行列を確定させる(バインド行列の計算に必要)

const allBones = [
  hips, spine, chest, neck, head,
  leftShoulder, leftUpperArm, leftForearm, leftHand,
  rightShoulder, rightUpperArm, rightForearm, rightHand,
  leftUpperLeg, leftLowerLeg, leftFoot,
  rightUpperLeg, rightLowerLeg, rightFoot,
];
const skeleton = new THREE.Skeleton(allBones);
const boneIndex = (b) => allBones.indexOf(b);

// ---------- 各部位メッシュをSkinnedMeshとして構築 ----------
// ジオメトリの頂点はワールド座標(レストポーズでの実際の位置)で直接配置し、
// 各頂点を単一のボーンへ100%の重みで結びつける(見た目は剛体パーツの
// 集まりだが、データとしては正式なスキニング済みメッシュ・アニメーションとして
// 書き出せる)
const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.6 });
const clothMat = new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.7 });
const shoeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });

function bindToSingleBone(geometry, bone) {
  const count = geometry.attributes.position.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  const idx = boneIndex(bone);
  for (let i = 0; i < count; i++) {
    skinIndices[i * 4] = idx;
    skinWeights[i * 4] = 1;
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  return geometry;
}

function worldPosOf(b) {
  const v = new THREE.Vector3();
  b.getWorldPosition(v);
  return v;
}

const allMeshes = []; // タップ選択のレイキャスト対象(ポーズエディタ用)
function addPart(geometry, material, bone, offset = new THREE.Vector3()) {
  const p = worldPosOf(bone).add(offset);
  geometry.translate(p.x, p.y, p.z);
  bindToSingleBone(geometry, bone);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.bind(skeleton);
  mesh.userData.bone = bone; // タップ時に「どのボーンに属するメッシュか」を即座に判定するため
  root.add(mesh); // GLTFExporterはrootを起点に書き出すため、メッシュもrootの配下に置く
  allMeshes.push(mesh);
  return mesh;
}

// 胴体: 円柱(上下で半径を変える)で「胸部から腰にかけて細くなる」
// 逆台形型のシルエットにする(上端=胸・肩側を太く、下端=ウエスト側を細く)
addPart(new THREE.CylinderGeometry(0.16, 0.115, 0.3, 12), skinMat, chest, new THREE.Vector3(0, -0.08, 0));
// 骨盤: ウエストから骨盤にかけて下側がやや広がる自然な形にする
addPart(new THREE.CylinderGeometry(0.115, 0.14, 0.18, 12), skinMat, hips, new THREE.Vector3(0, -0.02, 0));
// 頭を一回り大きくし、首は細く伸ばして頭から肩へ自然につながるようにする
addPart(new THREE.SphereGeometry(0.108, 20, 16), skinMat, head, new THREE.Vector3(0, 0.07, 0));
addPart(new THREE.CylinderGeometry(0.046, 0.057, 0.21, 10), skinMat, neck, new THREE.Vector3(0, 0, 0));

for (const [shoulder, upperArm, forearm, hand] of [
  [leftShoulder, leftUpperArm, leftForearm, leftHand],
  [rightShoulder, rightUpperArm, rightForearm, rightHand],
]) {
  // 肩関節が分かるように肩の位置に球を置く
  addPart(new THREE.SphereGeometry(0.062, 14, 12), skinMat, shoulder);
  addPart(new THREE.CapsuleGeometry(0.052, 0.186, 4, 8), skinMat, upperArm, new THREE.Vector3(0, -0.145, 0));
  // 肘関節が分かるように、前腕ボーンの位置(=肘の位置)に小さな球を置く
  addPart(new THREE.SphereGeometry(0.04, 12, 10), skinMat, forearm);
  addPart(new THREE.CapsuleGeometry(0.044, 0.182, 4, 8), skinMat, forearm, new THREE.Vector3(0, -0.135, 0));
  addPart(new THREE.SphereGeometry(0.046, 12, 10), skinMat, hand, new THREE.Vector3(0, -0.02, 0));
}

// 脚は腕より太く、腿からふくらはぎにかけて自然に先細りさせる
for (const [upperLeg, lowerLeg, foot] of [
  [leftUpperLeg, leftLowerLeg, leftFoot],
  [rightUpperLeg, rightLowerLeg, rightFoot],
]) {
  // 股関節が分かるように、腿ボーンの位置(=股関節の位置)に小さな球を置く
  addPart(new THREE.SphereGeometry(0.052, 12, 10), skinMat, upperLeg);
  addPart(new THREE.CapsuleGeometry(0.095, 0.28, 4, 10), clothMat, upperLeg, new THREE.Vector3(0, -0.14, 0));
  // 膝関節が分かるように、すねボーンの位置(=膝の位置)に小さな球を置く
  addPart(new THREE.SphereGeometry(0.05, 12, 10), skinMat, lowerLeg);
  addPart(new THREE.CapsuleGeometry(0.072, 0.28, 4, 10), skinMat, lowerLeg, new THREE.Vector3(0, -0.14, 0));
  addPart(new THREE.BoxGeometry(0.085, 0.055, 0.19), shoeMat, foot, new THREE.Vector3(0, -0.015, 0.045));
}

// ---------- 簡易アニメーション(右手を上げて振る「お辞儀&手振り」) ----------
function q(x, y, z) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
}

const times = [0, 0.4, 0.8, 1.2, 1.6, 2.0];

const spineTrack = new THREE.QuaternionKeyframeTrack(
  "Spine.quaternion",
  times,
  [
    ...q(0, 0, 0).toArray(),
    ...q(0.25, 0, 0).toArray(),
    ...q(0.25, 0, 0).toArray(),
    ...q(0, 0, 0).toArray(),
    ...q(0, 0, 0).toArray(),
    ...q(0, 0, 0).toArray(),
  ]
);

const rightShoulderTrack = new THREE.QuaternionKeyframeTrack(
  "RightShoulder.quaternion",
  times,
  [
    ...q(0, 0, 0).toArray(),
    ...q(0, 0, -1.4).toArray(),
    ...q(0, 0, -1.4).toArray(),
    ...q(0, 0, -1.4).toArray(),
    ...q(0, 0, -1.4).toArray(),
    ...q(0, 0, 0).toArray(),
  ]
);

const rightForearmTrack = new THREE.QuaternionKeyframeTrack(
  "RightForearm.quaternion",
  [0, 0.4, 0.7, 1.0, 1.3, 1.6, 2.0],
  [
    ...q(0, 0, 0).toArray(),
    ...q(-1.2, 0, 0).toArray(),
    ...q(-1.2, 0, -0.4).toArray(),
    ...q(-1.2, 0, 0.4).toArray(),
    ...q(-1.2, 0, -0.4).toArray(),
    ...q(-1.2, 0, 0).toArray(),
    ...q(0, 0, 0).toArray(),
  ]
);

const clip = new THREE.AnimationClip("Greeting", 2.0, [spineTrack, rightShoulderTrack, rightForearmTrack]);

const mixer = new THREE.AnimationMixer(root);
const action = mixer.clipAction(clip);
action.setLoop(THREE.LoopRepeat);
// 新しいポーズエディタ(FKでのボーン操作)と競合しないよう、プレビューの
// お辞儀アニメーションはデフォルトでは再生しない(ボタンで手動再生できる)
action.play();

// ---------- ポーズエディタ(FKによるボーン選択・回転・キーフレーム記録) ----------
const boneNameToBone = Object.fromEntries(allBones.map((b) => [b.name, b]));

let selectedBone = null;

// 選択中のボーンを示すギズモ(ワイヤーフレーム球+軸)。root(=GLTF書き出し対象)
// には含めず、scene直下に置くことで書き出し結果に含まれないようにしている
const selectionGizmo = new THREE.Group();
const gizmoSphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0xffe066, wireframe: true, depthTest: false })
);
const gizmoAxes = new THREE.AxesHelper(0.16);
gizmoAxes.material.depthTest = false;
selectionGizmo.add(gizmoSphere, gizmoAxes);
selectionGizmo.visible = false;
selectionGizmo.renderOrder = 999;
scene.add(selectionGizmo);

function updateGizmoTransform() {
  if (!selectedBone) {
    selectionGizmo.visible = false;
    return;
  }
  selectionGizmo.visible = true;
  selectedBone.getWorldPosition(selectionGizmo.position);
  selectedBone.getWorldQuaternion(selectionGizmo.quaternion);
}

const boneSelectEl = document.getElementById("boneSelect");
for (const b of allBones) {
  const opt = document.createElement("option");
  opt.value = b.name;
  opt.textContent = b.name;
  boneSelectEl.appendChild(opt);
}
const selectedBoneLabelEl = document.getElementById("selectedBoneLabel");

function setSelectedBone(b) {
  selectedBone = b;
  boneSelectEl.value = b ? b.name : "";
  selectedBoneLabelEl.textContent = b ? b.name : "なし";
  // ボーン選択中は、ドラッグ操作を常にボーン回転として扱うため、
  // カメラのオービット(OrbitControls)は無効化しておく
  controls.enabled = !selectedBone;
  updateGizmoTransform(); // 次の描画フレームを待たず、選択直後にギズモの表示状態を反映する
}

boneSelectEl.addEventListener("change", () => {
  setSelectedBone(boneNameToBone[boneSelectEl.value] || null);
});

// ---------- タップでボーン選択・ドラッグでボーンを回転(FK) ----------
// 注意: Three.jsのSkinnedMeshの標準レイキャストは、ポーズ変更後の変形済み
// 形状ではなく「レストポーズ時点のジオメトリ」に対して判定されてしまうため、
// ポーズを変えた後にタップ判定がずれてしまう。これを避けるため、各ボーンの
// 子として追従する非表示の当たり判定用プロキシ球を用意し、そちらを
// レイキャスト対象にする(ボーンの現在のワールド変形に正しく追従する)
const PROXY_RADIUS = 0.075;
const boneHitProxies = [];
for (const b of allBones) {
  const proxy = new THREE.Mesh(new THREE.SphereGeometry(PROXY_RADIUS, 8, 6));
  proxy.visible = false;
  proxy.userData.bone = b;
  b.add(proxy);
  boneHitProxies.push(proxy);
}

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

function pickBoneAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(boneHitProxies, false);
  return hits.length > 0 ? hits[0].object.userData.bone : null;
}

const DRAG_THRESHOLD_PX = 6; // この移動量未満なら「タップ」、以上なら「ドラッグ」とみなす
const ROTATE_SENSITIVITY = 0.012; // ドラッグ1pxあたりの回転量(ラジアン)

let pointerDownInfo = null; // { x, y, hitBone, startQuat }

function onPointerDownPose(evt) {
  pointerDownInfo = {
    x: evt.clientX,
    y: evt.clientY,
    hitBone: pickBoneAt(evt.clientX, evt.clientY),
    startQuat: selectedBone ? selectedBone.quaternion.clone() : null,
  };
  if (selectedBone) controls.enabled = false;
}

function onPointerMovePose(evt) {
  if (!pointerDownInfo || !selectedBone || !pointerDownInfo.startQuat) return;
  const dx = evt.clientX - pointerDownInfo.x;
  const dy = evt.clientY - pointerDownInfo.y;
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
  // 横方向のドラッグ→ローカルY軸回転、縦方向のドラッグ→ローカルX軸回転。
  // 開始時点の回転(startQuat)に対して毎回計算し直すため、累積誤差が出ない
  const deltaY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * ROTATE_SENSITIVITY);
  const deltaX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * ROTATE_SENSITIVITY);
  selectedBone.quaternion.copy(pointerDownInfo.startQuat).multiply(deltaY).multiply(deltaX);
}

function onPointerUpPose(evt) {
  if (!pointerDownInfo) return;
  const dx = evt.clientX - pointerDownInfo.x;
  const dy = evt.clientY - pointerDownInfo.y;
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
    // タップ: ヒットしたボーンを選択(ヒットしなければ選択解除)
    setSelectedBone(pointerDownInfo.hitBone);
  }
  pointerDownInfo = null;
  controls.enabled = !selectedBone;
}

canvas.addEventListener("pointerdown", onPointerDownPose);
canvas.addEventListener("pointermove", onPointerMovePose);
canvas.addEventListener("pointerup", onPointerUpPose);
canvas.addEventListener("pointercancel", () => {
  pointerDownInfo = null;
  controls.enabled = !selectedBone;
});

// ---------- タイムライン・キーフレーム ----------
// キーフレームは「その時刻での全ボーンの回転のスナップショット」として保存する。
// 2つのキーフレーム間は球面線形補間(slerp)でつなぎ、ポーズをなめらかに再現する
let currentTime = 0;
let poseKeyframes = []; // [{ time, pose: { [boneName]: [x,y,z,w] } }] (time昇順)
let posePlaying = false;

function snapshotPose() {
  const pose = {};
  for (const b of allBones) pose[b.name] = b.quaternion.toArray();
  return pose;
}

function applyPoseObject(pose) {
  for (const b of allBones) {
    const q = pose[b.name];
    if (q) b.quaternion.set(q[0], q[1], q[2], q[3]);
  }
}

function addKeyframeAt(time) {
  const pose = snapshotPose();
  const existingIdx = poseKeyframes.findIndex((k) => Math.abs(k.time - time) < 1e-6);
  if (existingIdx >= 0) poseKeyframes[existingIdx] = { time, pose };
  else {
    poseKeyframes.push({ time, pose });
    poseKeyframes.sort((a, b) => a.time - b.time);
  }
}

function applyPoseAtTime(time) {
  if (poseKeyframes.length === 0) return;
  const first = poseKeyframes[0];
  const last = poseKeyframes[poseKeyframes.length - 1];
  if (time <= first.time) { applyPoseObject(first.pose); return; }
  if (time >= last.time) { applyPoseObject(last.pose); return; }
  let k0 = first, k1 = last;
  for (let i = 0; i < poseKeyframes.length - 1; i++) {
    if (poseKeyframes[i].time <= time && time <= poseKeyframes[i + 1].time) {
      k0 = poseKeyframes[i];
      k1 = poseKeyframes[i + 1];
      break;
    }
  }
  const span = k1.time - k0.time;
  const alpha = span > 1e-9 ? (time - k0.time) / span : 0;
  for (const b of allBones) {
    const q0 = k0.pose[b.name], q1 = k1.pose[b.name];
    if (!q0 || !q1) continue;
    const a = new THREE.Quaternion(q0[0], q0[1], q0[2], q0[3]);
    const c = new THREE.Quaternion(q1[0], q1[1], q1[2], q1[3]);
    a.slerp(c, alpha);
    b.quaternion.copy(a);
  }
}

const timelineEl = document.getElementById("timeline");
const timeLabelEl = document.getElementById("timeLabel");
function setCurrentTime(t) {
  currentTime = t;
  timelineEl.value = String(t);
  timeLabelEl.textContent = t.toFixed(2) + "s";
}
timelineEl.addEventListener("input", () => {
  setCurrentTime(parseFloat(timelineEl.value));
  if (!posePlaying) applyPoseAtTime(currentTime);
});

const keyframeBtn = document.getElementById("keyframeBtn");
const posePlayBtn = document.getElementById("posePlayBtn");
const statusEl = document.getElementById("status");

// ---------- UI ----------
const playBtn = document.getElementById("playBtn");
let playing = false;
playBtn.addEventListener("click", () => {
  playing = !playing;
  playBtn.textContent = playing ? "お辞儀アニメーション停止" : "お辞儀アニメーション再生";
});

keyframeBtn.addEventListener("click", () => {
  addKeyframeAt(currentTime);
  statusEl.textContent = `${currentTime.toFixed(2)}s にキーフレームを保存しました(全${poseKeyframes.length}個)`;
  setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 2000);
});

posePlayBtn.addEventListener("click", () => {
  posePlaying = !posePlaying;
  posePlayBtn.textContent = posePlaying ? "ポーズ停止" : "ポーズ再生";
});

const exportBtn = document.getElementById("exportBtn");
exportBtn.addEventListener("click", () => {
  const exporter = new GLTFExporter();
  exporter.parse(
    root,
    (result) => {
      const blob = new Blob([result], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "humanoid.glb";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      statusEl.textContent = "humanoid.glb を書き出しました";
      setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 2500);
    },
    (err) => {
      console.error(err);
      statusEl.textContent = "書き出しに失敗しました";
    },
    { binary: true, animations: [clip] }
  );
});

// ---------- リサイズ ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- レンダーループ ----------
const clock = new THREE.Clock();
function render() {
  const dt = clock.getDelta();
  if (playing) mixer.update(dt);

  if (posePlaying && poseKeyframes.length > 0) {
    const first = poseKeyframes[0].time;
    const last = poseKeyframes[poseKeyframes.length - 1].time;
    let t = currentTime + dt;
    if (t > last) t = first; // 最後のキーフレームまで来たら最初へループ
    setCurrentTime(t);
    applyPoseAtTime(currentTime);
  }

  updateGizmoTransform();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// テスト/デバッグ用に主要オブジェクトを公開
window.__scene = { scene, camera, root, skeleton, allBones, mixer, clip, action };
window.__exportGLTF = () => new Promise((resolve, reject) => {
  const exporter = new GLTFExporter();
  exporter.parse(root, resolve, reject, { binary: true, animations: [clip] });
});

// ---------- ポーズエディタのテスト/デバッグ用フック ----------
window.__fk = {
  boneNameToBone,
  pickBoneAt,
  selectBoneByName: (name) => setSelectedBone(name ? boneNameToBone[name] || null : null),
  getSelectedBoneName: () => (selectedBone ? selectedBone.name : null),
  // ポインタ操作を介さずボーンを直接回転させる(決定論的なテスト用)
  rotateSelectedBoneBy: (axis, radians) => {
    if (!selectedBone) return;
    const ax = axis === "x" ? new THREE.Vector3(1, 0, 0) : axis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    selectedBone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax, radians));
  },
  getBoneQuaternion: (name) => (boneNameToBone[name] ? boneNameToBone[name].quaternion.toArray() : null),
  getBoneWorldPosition: (name) => {
    const b = boneNameToBone[name];
    if (!b) return null;
    const v = new THREE.Vector3();
    b.getWorldPosition(v);
    return v.toArray();
  },
  setCurrentTime: (t) => { setCurrentTime(t); if (!posePlaying) applyPoseAtTime(t); },
  getCurrentTime: () => currentTime,
  addKeyframeAt,
  getKeyframes: () => poseKeyframes.map((k) => ({ time: k.time, pose: k.pose })),
  clearKeyframes: () => { poseKeyframes = []; },
  setPosePlaying: (v) => { posePlaying = v; posePlayBtn.textContent = posePlaying ? "ポーズ停止" : "ポーズ再生"; },
  isPosePlaying: () => posePlaying,
  applyPoseAtTime,
  isGizmoVisible: () => selectionGizmo.visible,
};
