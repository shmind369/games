import * as THREE from "three";

// 参照画像の構図(頭が地平線のすぐ下、キャラクターが画面下半分を占める、
// 見下ろし気味のカメラ)を再現するためのカメラパラメータ。
// キャラクターは原点に立ち、背中をカメラ側(+Z)に向けている(-Z方向を向く)。
const CAMERA_FOV_DEG = 42;
const CAMERA_HEIGHT = 1.85;
const CAMERA_DISTANCE = 3.0;
const LOOK_AT_HEIGHT = 1.5;

function computeCameraPose() {
  return {
    position: new THREE.Vector3(0, CAMERA_HEIGHT, CAMERA_DISTANCE),
    lookAt: new THREE.Vector3(0, LOOK_AT_HEIGHT, 0),
  };
}

// ---------- Renderer / scene / camera ----------
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = false; // 参照画像はソフトな「接地シャドウ」風で、動的シャドウマップは使わない

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, window.innerWidth / window.innerHeight, 0.1, 200);
const pose = computeCameraPose();
camera.position.copy(pose.position);
camera.lookAt(pose.lookAt);

// ---------- 空(グラデーション) ----------
const SKY_TOP = "#4f78c9";
const SKY_HORIZON = "#d7e7f2";
function makeSkyTexture() {
  const cvs = document.createElement("canvas");
  cvs.width = 2;
  cvs.height = 256;
  const ctx = cvs.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, cvs.height);
  grad.addColorStop(0, SKY_TOP);
  grad.addColorStop(1, SKY_HORIZON);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cvs.width, cvs.height);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = makeSkyTexture();
scene.fog = new THREE.Fog(new THREE.Color(SKY_HORIZON).getHex(), 10, 34);

// ---------- 地面(単色 + 3Dラインによるグリッド) ----------
// キャンバステクスチャのリピートによるグリッド表現は、大きな単一平面上で
// 意図通りにタイリングされなかったため、確実に動作するTHREE.GridHelper
// (実際の3D線分ジオメトリ)を採用している
const GROUND_BASE = 0xc7d4e4;
const GROUND_LINE = 0x6f84a3;

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(240, 240),
  new THREE.MeshBasicMaterial({ color: GROUND_BASE })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const GRID_SIZE = 240;
const GRID_DIVISIONS = 30; // 240/30 = 1マス8ユニット(=約8m相当)
const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, GROUND_LINE, GROUND_LINE);
grid.position.y = 0.003;
scene.add(grid);

// ---------- ライト(キャラクターの陰影付け用) ----------
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
keyLight.position.set(-2.2, 4.5, 3.2);
scene.add(keyLight);
const skyFill = new THREE.HemisphereLight(0x9fb8e6, 0x8a91a0, 0.6);
scene.add(skyFill);

// ---------- キャラクター(プリミティブ形状で構築、背面から見た構図) ----------
const skinMat = new THREE.MeshStandardMaterial({ color: 0x93a1b5, roughness: 0.55, metalness: 0.05 });
const shortsMat = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.6 });

const player = new THREE.Group();

function segmentMesh(pA, pB, radius, material) {
  const dir = new THREE.Vector3().subVectors(pB, pA);
  const length = dir.length();
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 4, 10), material);
  const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return mesh;
}

const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.215, 0.46, 4, 12), skinMat);
torso.position.set(0, 1.28, 0);
player.add(torso);

const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, 0.12, 10), skinMat);
neck.position.set(0, 1.605, 0);
player.add(neck);

const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), skinMat);
head.scale.set(0.92, 1.18, 1.0);
head.position.set(0, 1.755, 0.005);
player.add(head);

const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.1, 4, 12), skinMat);
hips.position.set(0, 0.92, 0);
player.add(hips);

const shorts = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.21, 0.3, 16), shortsMat);
shorts.position.set(0, 0.9, 0);
player.add(shorts);

function makeLeg(sign) {
  const leg = new THREE.Group();
  const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.34, 4, 10), skinMat);
  thigh.position.set(0, 0.62, 0);
  leg.add(thigh);
  const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.34, 4, 10), skinMat);
  calf.position.set(0, 0.24, 0.01);
  leg.add(calf);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.24), skinMat);
  foot.position.set(0, 0.035, 0.06);
  leg.add(foot);
  leg.position.set(sign * 0.13, 0, 0);
  return leg;
}
player.add(makeLeg(-1));
player.add(makeLeg(1));

// 腕: 背面視点でガードを構える(肘が体側から突き出し、拳は胸の前に隠れる)ポーズ。
// 肩→肘→拳を3点の座標で指定し、区間ごとにカプセルを生成する
function makeArm(sign) {
  const arm = new THREE.Group();
  const shoulder = new THREE.Vector3(sign * 0.26, 1.46, 0);
  const elbow = new THREE.Vector3(sign * 0.3, 1.14, 0.12);
  const fist = new THREE.Vector3(sign * 0.13, 1.5, 0.29);

  arm.add(new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 12), skinMat).translateX(shoulder.x).translateY(shoulder.y).translateZ(shoulder.z));
  arm.add(segmentMesh(shoulder, elbow, 0.075, skinMat));
  arm.add(segmentMesh(elbow, fist, 0.065, skinMat));
  const fistMesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), skinMat);
  fistMesh.position.copy(fist);
  arm.add(fistMesh);
  return arm;
}
player.add(makeArm(-1));
player.add(makeArm(1));

player.rotation.y = Math.PI; // 背中をカメラ(+Z)に向ける
scene.add(player);

// ---------- 接地シャドウ(ソフトな円形のフェイクシャドウ) ----------
function makeShadowTexture() {
  const size = 128;
  const cvs = document.createElement("canvas");
  cvs.width = size;
  cvs.height = size;
  const ctx = cvs.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(20,26,40,0.42)");
  grad.addColorStop(0.7, "rgba(20,26,40,0.22)");
  grad.addColorStop(1, "rgba(20,26,40,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cvs);
}
const shadowBlob = new THREE.Mesh(
  new THREE.PlaneGeometry(0.85, 1.1),
  new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false })
);
shadowBlob.rotation.x = -Math.PI / 2;
shadowBlob.position.set(0.05, 0.015, 0.18);
scene.add(shadowBlob);

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

// ---------- レンダーループ(現時点ではキャラクターは静止したまま) ----------
function render() {
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// テスト/デバッグ用に主要オブジェクトを公開
window.__scene = { scene, camera, player, ground, grid };
