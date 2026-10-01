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

// ---------- 4分割ビュー(TOP/FRONT/LEFT/FREE CAMERA) ----------
// 画面を2x2に分割し、同じシーンを4台のカメラで同時に描画する。
// FREE CAMERAは既存のPerspectiveCamera+OrbitControlsをそのまま使い、
// 挙動を変更していない。TOP/FRONT/LEFTは固定の正投影カメラ(パン・ズーム等の
// 操作は今回のスコープ外のため実装しない)
const VIEW_TARGET_Y = 1.0; // OrbitControlsのtargetと揃えた、キャラクターの中心あたりの高さ
const SIDE_HALF_HEIGHT = 1.15; // FRONT/LEFTでの縦方向(頭上〜足元)の表示範囲
const TOP_HALF_SIZE = 0.9; // TOPでの横方向(ワールドX/Z)の表示範囲

function makeOrthoCamera() {
  return new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
}

const topCamera = makeOrthoCamera();
topCamera.position.set(0, VIEW_TARGET_Y + 3, 0);
topCamera.up.set(0, 0, -1);
topCamera.lookAt(0, VIEW_TARGET_Y, 0);

const frontCamera = makeOrthoCamera();
frontCamera.position.set(0, VIEW_TARGET_Y, 3);
frontCamera.up.set(0, 1, 0);
frontCamera.lookAt(0, VIEW_TARGET_Y, 0);

const leftCamera = makeOrthoCamera();
leftCamera.position.set(-3, VIEW_TARGET_Y, 0);
leftCamera.up.set(0, 1, 0);
leftCamera.lookAt(0, VIEW_TARGET_Y, 0);

const camerasByKey = { top: topCamera, front: frontCamera, left: leftCamera, free: camera };
const viewCellEls = {};
for (const el of document.querySelectorAll(".viewCell")) viewCellEls[el.dataset.view] = el;

// 各ビューのCSSピクセル矩形(canvas基準、左上原点)。resize時に再計算する
const viewLayout = {};
function layoutViews() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const halfW = w / 2, halfH = h / 2;
  viewLayout.top = { x: 0, y: 0, w: halfW, h: halfH };
  viewLayout.front = { x: halfW, y: 0, w: w - halfW, h: halfH };
  viewLayout.left = { x: 0, y: halfH, w: halfW, h: h - halfH };
  viewLayout.free = { x: halfW, y: halfH, w: w - halfW, h: h - halfH };

  updateOrthoFrustum(topCamera, TOP_HALF_SIZE, viewLayout.top.w / viewLayout.top.h);
  updateOrthoFrustum(frontCamera, SIDE_HALF_HEIGHT, viewLayout.front.w / viewLayout.front.h);
  updateOrthoFrustum(leftCamera, SIDE_HALF_HEIGHT, viewLayout.left.w / viewLayout.left.h);

  camera.aspect = viewLayout.free.w / viewLayout.free.h;
  camera.updateProjectionMatrix();
}
function updateOrthoFrustum(cam, halfHeight, aspect) {
  const halfWidth = halfHeight * aspect;
  cam.left = -halfWidth;
  cam.right = halfWidth;
  cam.top = halfHeight;
  cam.bottom = -halfHeight;
  cam.updateProjectionMatrix();
}

// クライアント座標(clientX/clientY)から、どのビュー(象限)かを判定する
function viewAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  const halfW = rect.width / 2, halfH = rect.height / 2;
  if (y < halfH) return x < halfW ? "top" : "front";
  return x < halfW ? "left" : "free";
}

let activeView = null;
function setActiveView(key) {
  if (activeView === key) return;
  activeView = key;
  for (const k in viewCellEls) viewCellEls[k].classList.toggle("active", k === key);
}
setActiveView("free");

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

// ---------- 肘・膝の回転軸(ヒンジ軸)をボーンのローカル座標系から判定する ----------
// 「肘・膝は1軸のみ回転可能」とするため、どのローカル軸がその1軸に
// 当たるかを求める。固定で「X軸」と決め打ちするのではなく、実際の
// ボーン構造(左右の肩・腿の位置関係)から身体の左右(内外側)軸を求め、
// それを各関節ボーン自身のローカル座標系に変換して最も近い主軸に
// スナップする。肘・膝のような単純なヒンジ関節は、解剖学的に
// 身体の左右軸まわりにしか曲がらないため、この「身体の左右軸」が
// そのままヒンジ軸になる。
// (レストポーズの時点で1度だけ計算する。ポーズを変えた後も同じ軸を使う)
function computeSideAxisWorld() {
  const ls = new THREE.Vector3(), rs = new THREE.Vector3();
  const lh = new THREE.Vector3(), rh = new THREE.Vector3();
  leftShoulder.getWorldPosition(ls);
  rightShoulder.getWorldPosition(rs);
  leftUpperLeg.getWorldPosition(lh);
  rightUpperLeg.getWorldPosition(rh);
  const fromShoulders = ls.clone().sub(rs);
  const fromHips = lh.clone().sub(rh);
  return fromShoulders.add(fromHips).normalize();
}
const SIDE_AXIS_WORLD = computeSideAxisWorld();

function snapToNearestAxis(v) {
  const abs = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const maxIdx = abs.indexOf(Math.max(...abs));
  const out = new THREE.Vector3();
  const sign = Math.sign(v.getComponent(maxIdx)) || 1;
  out.setComponent(maxIdx, sign);
  const key = maxIdx === 0 ? "x" : maxIdx === 1 ? "y" : "z";
  return { axis: out, key };
}

function computeHingeAxisLocal(jointBone) {
  const worldQuatInverse = jointBone.getWorldQuaternion(new THREE.Quaternion()).invert();
  const localSide = SIDE_AXIS_WORLD.clone().applyQuaternion(worldQuatInverse).normalize();
  return snapToNearestAxis(localSide);
}

// 肘(前腕ボーン)・膝(すねボーン)のみ1軸(ヒンジ)関節として扱う。
// それ以外(肩・股関節・首など)は基本関節として3軸すべてを有効にする
const HINGE_BONES = [leftForearm, rightForearm, leftLowerLeg, rightLowerLeg];
const hingeAxisByBoneName = {};
for (const b of HINGE_BONES) hingeAxisByBoneName[b.name] = computeHingeAxisLocal(b);

// ---------- 選択中のボーンを操作する3軸回転ギズモ ----------
// 球体をドラッグして自由回転させる方式は廃止し、X/Y/Z軸ごとのリングを
// 個別にドラッグして、その軸だけを回転させる方式にした。リングは
// root(=GLTF書き出し対象)には含めず、scene直下に置くことで書き出し
// 結果に含まれないようにしている
const RING_RADIUS = 0.13;
const RING_TUBE = 0.011;
function makeRing(color) {
  return new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 8, 48),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 })
  );
}
const RING_COLOR = { x: 0xff5050, y: 0x55e06a, z: 0x4d9bff };
const ringX = makeRing(RING_COLOR.x);
const ringY = makeRing(RING_COLOR.y);
const ringZ = makeRing(RING_COLOR.z);
ringX.rotation.y = Math.PI / 2; // デフォルト(法線=ローカルZ)のトーラスを、法線がローカルXになるよう向ける
ringY.rotation.x = Math.PI / 2; // 法線がローカルYになるよう向ける
// ringZ はデフォルトのまま(法線=ローカルZ)
const gizmoDot = new THREE.Mesh(
  new THREE.SphereGeometry(0.018, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
);

const selectionGizmo = new THREE.Group();
selectionGizmo.add(ringX, ringY, ringZ, gizmoDot);
selectionGizmo.visible = false;
selectionGizmo.renderOrder = 999;
scene.add(selectionGizmo);

const ringMeshByAxisKey = { x: ringX, y: ringY, z: ringZ };
function ringLocalAxis(key) {
  return key === "x" ? new THREE.Vector3(1, 0, 0) : key === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
}

function updateGizmoTransform() {
  if (!selectedBone) {
    selectionGizmo.visible = false;
    return;
  }
  selectionGizmo.visible = true;
  selectedBone.getWorldPosition(selectionGizmo.position);
  selectedBone.getWorldQuaternion(selectionGizmo.quaternion);
}

// 選択したボーンが肘・膝(ヒンジ関節)かどうかで、表示する軸の本数を切り替える
function updateGizmoAxesForSelection() {
  const hinge = selectedBone ? hingeAxisByBoneName[selectedBone.name] : null;
  if (hinge) {
    ringX.visible = hinge.key === "x";
    ringY.visible = hinge.key === "y";
    ringZ.visible = hinge.key === "z";
  } else {
    ringX.visible = !!selectedBone;
    ringY.visible = !!selectedBone;
    ringZ.visible = !!selectedBone;
  }
}

// 現在のボーンで有効な(表示中の)リングの一覧(ヒットテスト対象)
function activeGizmoRings() {
  const list = [];
  if (ringX.visible) list.push({ key: "x", mesh: ringX, axisLocal: ringLocalAxis("x") });
  if (ringY.visible) list.push({ key: "y", mesh: ringY, axisLocal: ringLocalAxis("y") });
  if (ringZ.visible) list.push({ key: "z", mesh: ringZ, axisLocal: ringLocalAxis("z") });
  return list;
}

function setRingHighlight(mesh, on) {
  mesh.material.opacity = on ? 1 : 0.9;
  mesh.scale.setScalar(on ? 1.12 : 1);
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
  // ボーン選択中は、ギズモのリングをドラッグする操作を優先するため、
  // カメラのオービット(OrbitControls)は無効化しておく
  controls.enabled = !selectedBone;
  updateGizmoAxesForSelection();
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

// クライアント座標から、その象限のカメラを使ったNDC座標でraycasterをセットする
function setRaycasterFromClient(clientX, clientY, key) {
  const rect = canvas.getBoundingClientRect();
  const vp = viewLayout[key];
  const localX = (clientX - rect.left) - vp.x;
  const localY = (clientY - rect.top) - vp.y;
  pointerNDC.x = (localX / vp.w) * 2 - 1;
  pointerNDC.y = -(localY / vp.h) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camerasByKey[key]);
}

// タップされた位置がどのビュー(象限)かを判定し、そのビューのカメラで
// レイキャストする(4分割後は、どの象限をタップしたかによって使うべき
// カメラが異なるため)
function pickBoneAt(clientX, clientY) {
  setRaycasterFromClient(clientX, clientY, viewAt(clientX, clientY));
  const hits = raycaster.intersectObjects(boneHitProxies, false);
  return hits.length > 0 ? hits[0].object.userData.bone : null;
}

// ギズモのリング(選択中ボーンがある場合のみ)に対するヒットテスト
function pickGizmoRingAt(clientX, clientY) {
  if (!selectedBone) return null;
  setRaycasterFromClient(clientX, clientY, viewAt(clientX, clientY));
  const rings = activeGizmoRings();
  const hits = raycaster.intersectObjects(rings.map((r) => r.mesh), false);
  if (hits.length === 0) return null;
  return rings.find((r) => r.mesh === hits[0].object) || null;
}

// ワールド座標を、指定したビュー(カメラ)でのクライアント座標に変換する
function worldToClient(worldPos, key) {
  const cam = camerasByKey[key];
  const vp = viewLayout[key];
  const rect = canvas.getBoundingClientRect();
  const v = worldPos.clone().project(cam);
  return {
    x: rect.left + vp.x + (v.x * 0.5 + 0.5) * vp.w,
    y: rect.top + vp.y + (-v.y * 0.5 + 0.5) * vp.h,
  };
}

// center(ワールド座標)を画面に投影した点を中心とした、ポインタの角度(ラジアン)を求める。
// レイと回転平面との交差を使う方式だと、回転平面をちょうど真横から見ている
// カメラ(例: X軸ヒンジをTOP/FRONTビューから見た場合)でレイと平面が平行になり
// 交点が求まらない(リングが画面上で線状にしか見えない)問題があったため、
// どのカメラ角度でも必ず機能する「画面上の中心点まわりの角度」で測る方式にした
function screenAngleAround(center, clientX, clientY, key) {
  const c = worldToClient(center, key);
  return Math.atan2(clientY - c.y, clientX - c.x);
}

// キャプチャフェーズで先に実行し、(1)タップされたビューをアクティブビューにする、
// (2)FREE CAMERA以外の象限でのドラッグがOrbitControlsを動かさないようにする。
// OrbitControls自身のpointerdownハンドラより必ず先に実行されるよう、
// キャプチャフェーズ(true)で登録している
function onPointerDownGate(evt) {
  const key = viewAt(evt.clientX, evt.clientY);
  setActiveView(key);
  controls.enabled = key === "free" && !selectedBone;
}
canvas.addEventListener("pointerdown", onPointerDownGate, { capture: true });

const DRAG_THRESHOLD_PX = 6; // この移動量未満なら「タップ」、以上なら「ドラッグ」とみなす

let pointerDownInfo = null; // { x, y, hitBone } (タップ判定用)
let activeRingDrag = null; // { key, mesh, axisLocal, center, sign, startAngle, startQuat }

function beginRingDrag(evt, ringHit, key) {
  const center = new THREE.Vector3();
  selectedBone.getWorldPosition(center);
  const axisWorld = ringHit.axisLocal.clone().applyQuaternion(selectedBone.getWorldQuaternion(new THREE.Quaternion())).normalize();
  // 軸がカメラの手前側(視点側)を向いている場合、画面上で見える回転方向が
  // 逆になるため、角度の符号を反転してドラッグ方向と回転方向の体感を揃える
  const camForward = new THREE.Vector3();
  camerasByKey[key].getWorldDirection(camForward);
  const sign = axisWorld.dot(camForward) < 0 ? -1 : 1;
  const startAngle = screenAngleAround(center, evt.clientX, evt.clientY, key);
  return {
    key: ringHit.key,
    mesh: ringHit.mesh,
    axisLocal: ringHit.axisLocal.clone(),
    center, sign, startAngle,
    startQuat: selectedBone.quaternion.clone(),
  };
}

function onPointerDownPose(evt) {
  activeRingDrag = null;
  pointerDownInfo = { x: evt.clientX, y: evt.clientY, hitBone: null };

  if (selectedBone) {
    const ringHit = pickGizmoRingAt(evt.clientX, evt.clientY);
    if (ringHit) {
      const drag = beginRingDrag(evt, ringHit, viewAt(evt.clientX, evt.clientY));
      activeRingDrag = drag;
      setRingHighlight(drag.mesh, true);
      controls.enabled = false;
      return; // ギズモを掴んだ場合はタップ判定(ボーンの選択切替)は行わない
    }
  }
  pointerDownInfo.hitBone = pickBoneAt(evt.clientX, evt.clientY);
}

function onPointerMovePose(evt) {
  if (activeRingDrag) {
    const key = viewAt(evt.clientX, evt.clientY); // ドラッグ中に象限をまたいでも、その時点のビューで再投影する
    const currentAngle = screenAngleAround(activeRingDrag.center, evt.clientX, evt.clientY, key);
    const deltaAngle = (currentAngle - activeRingDrag.startAngle) * activeRingDrag.sign;
    const dq = new THREE.Quaternion().setFromAxisAngle(activeRingDrag.axisLocal, deltaAngle);
    selectedBone.quaternion.copy(activeRingDrag.startQuat).multiply(dq);
    return;
  }
  // (ギズモのリングを掴んでいない場合、ドラッグでのボーン回転は行わない。
  // 球体による自由回転操作は廃止したため、ここでは何もしない)
}

function onPointerUpPose(evt) {
  if (activeRingDrag) {
    setRingHighlight(activeRingDrag.mesh, false);
    activeRingDrag = null;
    pointerDownInfo = null;
    controls.enabled = !selectedBone;
    return;
  }
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
  if (activeRingDrag) setRingHighlight(activeRingDrag.mesh, false);
  activeRingDrag = null;
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

// ---------- タイムラインUI(30FPS基準のフレーム表示・目盛) ----------
// 内部的な時刻管理(currentTime, applyPoseAtTime, addKeyframeAt等)は秒単位の
// ままで変更していない。ここではUI表示・入力のみをフレーム単位に変換している
const FPS = 30;
const TOTAL_FRAMES = 60; // 2秒分
const frameOf = (timeSeconds) => Math.round(timeSeconds * FPS);
const timeOfFrame = (frame) => frame / FPS;

const frameReadoutEl = document.getElementById("frameReadout");
const timeReadoutEl = document.getElementById("timeReadout");
const timelineCanvas = document.getElementById("timelineCanvas");
const timelineCtx = timelineCanvas.getContext("2d");
const TIMELINE_MARGIN_X = 6;
const MAJOR_TICK_STEP = 5;

function timelineFrameToX(frame, cssW) {
  const usableW = cssW - TIMELINE_MARGIN_X * 2;
  return TIMELINE_MARGIN_X + (frame / TOTAL_FRAMES) * usableW;
}

function drawTimelineRuler() {
  const cssW = timelineCanvas.clientWidth;
  const cssH = timelineCanvas.clientHeight;
  if (cssW === 0 || cssH === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  timelineCanvas.width = Math.round(cssW * dpr);
  timelineCanvas.height = Math.round(cssH * dpr);
  timelineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  timelineCtx.clearRect(0, 0, cssW, cssH);

  // 目盛(1フレームごとの小目盛、MAJOR_TICK_STEPごとの大目盛+フレーム番号)
  timelineCtx.font = "9px system-ui, sans-serif";
  timelineCtx.textAlign = "center";
  timelineCtx.lineWidth = 1;
  for (let f = 0; f <= TOTAL_FRAMES; f++) {
    const x = timelineFrameToX(f, cssW);
    const isMajor = f % MAJOR_TICK_STEP === 0;
    timelineCtx.strokeStyle = isMajor ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.28)";
    const tickTop = isMajor ? cssH * 0.38 : cssH * 0.58;
    timelineCtx.beginPath();
    timelineCtx.moveTo(x, tickTop);
    timelineCtx.lineTo(x, cssH * 0.85);
    timelineCtx.stroke();
    if (isMajor) {
      timelineCtx.fillStyle = "rgba(255,255,255,0.75)";
      timelineCtx.fillText(String(f), x, cssH * 0.3);
    }
  }

  // キーフレームの位置を三角マーカーで表示
  timelineCtx.fillStyle = "#ffd24c";
  for (const kf of poseKeyframes) {
    const x = timelineFrameToX(frameOf(kf.time), cssW);
    timelineCtx.beginPath();
    timelineCtx.moveTo(x, cssH * 0.85);
    timelineCtx.lineTo(x - 4, cssH * 0.98);
    timelineCtx.lineTo(x + 4, cssH * 0.98);
    timelineCtx.closePath();
    timelineCtx.fill();
  }

  // 現在フレームを示す縦線
  const curX = timelineFrameToX(frameOf(currentTime), cssW);
  timelineCtx.strokeStyle = "#ff5c5c";
  timelineCtx.lineWidth = 2;
  timelineCtx.beginPath();
  timelineCtx.moveTo(curX, 1);
  timelineCtx.lineTo(curX, cssH - 1);
  timelineCtx.stroke();
}

function setCurrentTime(t) {
  currentTime = Math.max(0, Math.min(TOTAL_FRAMES / FPS, t));
  const frame = frameOf(currentTime);
  frameReadoutEl.textContent = `Frame: ${frame} / ${TOTAL_FRAMES}`;
  timeReadoutEl.textContent = `Time: ${currentTime.toFixed(3)}s`;
  drawTimelineRuler();
}

function frameFromClientX(clientX) {
  const rect = timelineCanvas.getBoundingClientRect();
  const usableW = rect.width - TIMELINE_MARGIN_X * 2;
  const x = clientX - rect.left - TIMELINE_MARGIN_X;
  const ratio = usableW > 0 ? x / usableW : 0;
  return Math.max(0, Math.min(TOTAL_FRAMES, Math.round(ratio * TOTAL_FRAMES)));
}

let timelineDragging = false;
function onTimelinePointerDown(evt) {
  timelineDragging = true;
  timelineCanvas.setPointerCapture(evt.pointerId);
  setCurrentTime(timeOfFrame(frameFromClientX(evt.clientX)));
  if (!posePlaying) applyPoseAtTime(currentTime);
}
function onTimelinePointerMove(evt) {
  if (!timelineDragging) return;
  setCurrentTime(timeOfFrame(frameFromClientX(evt.clientX)));
  if (!posePlaying) applyPoseAtTime(currentTime);
}
function onTimelinePointerUp() {
  timelineDragging = false;
}
timelineCanvas.addEventListener("pointerdown", onTimelinePointerDown);
timelineCanvas.addEventListener("pointermove", onTimelinePointerMove);
timelineCanvas.addEventListener("pointerup", onTimelinePointerUp);
timelineCanvas.addEventListener("pointercancel", () => { timelineDragging = false; });
window.addEventListener("resize", drawTimelineRuler);

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
  renderer.setSize(w, h);
  layoutViews();
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();
setCurrentTime(0); // 初期状態のフレーム表示・目盛を描画しておく

// ---------- レンダーループ(4分割ビューを同じシーンに対して順に描画) ----------
const VIEW_ORDER = ["top", "front", "left", "free"];
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

  const canvasH = canvas.clientHeight || window.innerHeight;
  renderer.setScissorTest(true);
  for (const key of VIEW_ORDER) {
    const rect = viewLayout[key];
    const glY = canvasH - (rect.y + rect.h); // Three.jsのビューポートは左下原点のため、Y座標を反転する
    renderer.setViewport(rect.x, glY, rect.w, rect.h);
    renderer.setScissor(rect.x, glY, rect.w, rect.h);
    renderer.render(scene, camerasByKey[key]);
  }
  renderer.setScissorTest(false);

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
  // 4分割ビュー・フレームタイムラインのテスト/デバッグ用
  FPS,
  TOTAL_FRAMES,
  frameOf,
  timeOfFrame,
  getActiveView: () => activeView,
  getViewportRect: (key) => ({ ...viewLayout[key] }),
  getCamera: (key) => camerasByKey[key],
  simulateTapAt: (clientX, clientY) => {
    setActiveView(viewAt(clientX, clientY));
    setSelectedBone(pickBoneAt(clientX, clientY));
  },
  // 3軸回転ギズモ・ヒンジ軸のテスト/デバッグ用
  getHingeAxis: (name) => (hingeAxisByBoneName[name] ? { key: hingeAxisByBoneName[name].key, axis: hingeAxisByBoneName[name].axis.toArray() } : null),
  isHingeBone: (name) => !!hingeAxisByBoneName[name],
  getActiveRingKeys: () => activeGizmoRings().map((r) => r.key),
  getSideAxisWorld: () => SIDE_AXIS_WORLD.toArray(),
  pickGizmoRingAt,
  getRingWorldPosition: (axisKey) => {
    const ring = ringMeshByAxisKey[axisKey];
    if (!ring || !ring.visible) return null;
    const center = new THREE.Vector3();
    selectedBone.getWorldPosition(center);
    const axisWorld = ringLocalAxis(axisKey).applyQuaternion(selectedBone.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const arbitrary = Math.abs(axisWorld.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const refA = new THREE.Vector3().crossVectors(arbitrary, axisWorld).normalize();
    return center.clone().addScaledVector(refA, RING_RADIUS).toArray();
  },
  isRingDragActive: () => !!activeRingDrag,
};
