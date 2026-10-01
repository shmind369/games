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

function addPart(geometry, material, bone, offset = new THREE.Vector3()) {
  const p = worldPosOf(bone).add(offset);
  geometry.translate(p.x, p.y, p.z);
  bindToSingleBone(geometry, bone);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.bind(skeleton);
  root.add(mesh); // GLTFExporterはrootを起点に書き出すため、メッシュもrootの配下に置く
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
action.play();

// ---------- UI ----------
const playBtn = document.getElementById("playBtn");
let playing = true;
playBtn.addEventListener("click", () => {
  playing = !playing;
  playBtn.textContent = playing ? "アニメーション停止" : "アニメーション再生";
});

const exportBtn = document.getElementById("exportBtn");
const statusEl = document.getElementById("status");
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
      setTimeout(() => { statusEl.textContent = "ドラッグで視点回転・ピンチでズーム"; }, 2500);
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
