import * as THREE from "three";
import { OrbitControls } from "./vendor/controls/OrbitControls.js";
import { GLTFExporter } from "./vendor/exporters/GLTFExporter.js";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

// ---------- モバイルでのテキスト選択/コンテキストメニュー抑制 ----------
// スマートフォンのSafari/Chromeでタイムラインや3Dビューをドラッグしている
// 最中に、ブラウザ標準のテキスト選択(「コピー」「Googleで検索」等の
// メニュー)や長押し・右クリックのコンテキストメニューが表示されてしまう
// 問題を防ぐ。CSS側のuser-select:noneだけでは、ブラウザによっては
// 長押しのコールアウトやcontextmenuイベントが別途発火することがあるため、
// JS側でも明示的に抑制している。input/textarea(実際に文字入力する要素。
// 今回はアニメーション名の#animNameInputのみ)は対象から除外し、通常の
// テキスト選択・コピー・右クリックは維持する
function isTextEntryElement(el) {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}
document.addEventListener("selectstart", (evt) => {
  if (!isTextEntryElement(evt.target)) evt.preventDefault();
});
document.addEventListener("contextmenu", (evt) => {
  if (!isTextEntryElement(evt.target)) evt.preventDefault();
});
document.addEventListener("dragstart", (evt) => {
  if (!isTextEntryElement(evt.target)) evt.preventDefault();
});

// ---------- Renderer / scene / camera ----------
const canvas = document.getElementById("game");
const viewportArea = document.getElementById("viewportArea"); // 3Dビュー専用領域(タイムラインとは完全に分離されたDOM領域)
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
// GLBインポートで読み込んだモデルの大きさに合わせて後から再計算する
// (applyViewFraming参照)ため、const ではなく let にしている。初期値は
// ボクサーモデル用に手調整した元の値のまま
let VIEW_TARGET_Y = 1.0; // OrbitControlsのtargetと揃えた、キャラクターの中心あたりの高さ
let SIDE_HALF_HEIGHT = 1.15; // FRONT/LEFTでの縦方向(頭上〜足元)の表示範囲
let TOP_HALF_SIZE = 0.9; // TOPでの横方向(ワールドX/Z)の表示範囲

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

// 各ビューのカメラが、どのギズモ軸レイヤーを描画するかを設定する。
// TOP/FRONT/LEFTはそれぞれ正面から見やすい1軸のみ、FREE CAMERAは3軸とも有効にする
// (レイヤー定数(LAYER_RING_X等)はこの後のギズモ設定箇所で定義されるが、
// 数値自体は1/2/3で固定なのでここで先に有効化しておいて問題ない)
topCamera.layers.enable(2); // LAYER_RING_Y
frontCamera.layers.enable(3); // LAYER_RING_Z
leftCamera.layers.enable(1); // LAYER_RING_X
camera.layers.enable(1);
camera.layers.enable(2);
camera.layers.enable(3);

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

// GLBインポートで読み込むモデルは、ボクサーモデルと身長・プロポーションが
// 異なる場合があるため、4ビューの基準の高さ(VIEW_TARGET_Y)・表示範囲
// (SIDE_HALF_HEIGHT/TOP_HALF_SIZE)をモデルに合わせて作り直せるようにする。
// ボーン操作・ギズモ・キーフレーム等、他のロジックは一切変更しない
// (カメラ・ビューの見た目だけを調整する)
function applyViewFraming(targetY, sideHalfHeight, topHalfSize) {
  VIEW_TARGET_Y = targetY;
  SIDE_HALF_HEIGHT = sideHalfHeight;
  TOP_HALF_SIZE = topHalfSize;

  topCamera.position.set(0, VIEW_TARGET_Y + 3, 0);
  topCamera.lookAt(0, VIEW_TARGET_Y, 0);
  frontCamera.position.set(0, VIEW_TARGET_Y, 3);
  frontCamera.lookAt(0, VIEW_TARGET_Y, 0);
  leftCamera.position.set(-3, VIEW_TARGET_Y, 0);
  leftCamera.lookAt(0, VIEW_TARGET_Y, 0);

  controls.target.set(0, VIEW_TARGET_Y, 0);
  const freeDistance = Math.max(sideHalfHeight, topHalfSize) * 1.8 + 1.0;
  camera.position.set(0, VIEW_TARGET_Y + sideHalfHeight * 0.15, freeDistance);
  controls.update();

  layoutViews();
}

// 読み込んだモデル(root配下のメッシュ全体)のバウンディングボックスから、
// 4ビューがちょうど収まる表示範囲を計算する(mesh-modeling-studioの
// fitViewsToBoundsと考え方は同じだが、このプロジェクト用に独立して実装)
function fitViewToCurrentModel() {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const halfHeight = Math.max(size.y, size.x, size.z) / 2 * 1.3 + 0.1;
  applyViewFraming(center.y, halfHeight, halfHeight);
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

// ボーンの位置(回転の中心=関節)は、ボクサーモデル(Tripo製のTポーズ
// メッシュ)の断面を実測して求めた実際の肩・肘・手首・股関節・膝・足首・
// 腰・首の位置に合わせている(tools/tpose_rig.py が出力する値を
// 親からのオフセットに直したもの)。以前は手作りの値のままで、メッシュの
// 実際の関節とずれていたため、膝や肘を曲げるとパーツが関節から離れた
// 位置で振り回され、メッシュが千切れたように見えていた。ボーンの名前・
// 階層・本数は変更していない。
// GLBインポート機能の追加により、「読み込んだモデルに差し替え」→
// 「🥊でボクサーに戻す」を何度でも行えるようにするため、以前は
// モジュール最上位で1回だけ実行していたボーン構築を関数化した
// (ルートボーンを1つ返すだけで、rootへの追加はしない)
function buildBoxerBoneHierarchy() {
  const hips = bone("Hips", 0, 0.92, 0);
  const spine = bone("Spine", 0, 0.08, 0);
  const chest = bone("Chest", 0, 0.15, 0);
  const neck = bone("Neck", 0, 0.18, -0.05);
  const head = bone("Head", 0, 0.05, 0.05);

  const leftShoulder = bone("LeftShoulder", 0.09, 0.137, -0.038);
  const leftUpperArm = bone("LeftUpperArm", 0.13, 0, 0);
  const leftForearm = bone("LeftForearm", 0.0303, -0.2181, -0.0029);
  const leftHand = bone("LeftHand", 0.0295, -0.1674, 0.0041);

  const rightShoulder = bone("RightShoulder", -0.09, 0.137, -0.038);
  const rightUpperArm = bone("RightUpperArm", -0.13, 0, 0);
  const rightForearm = bone("RightForearm", -0.0303, -0.2181, -0.0029);
  const rightHand = bone("RightHand", -0.0295, -0.1674, 0.0041);

  const leftUpperLeg = bone("LeftUpperLeg", 0.0992, -0.08, -0.0009);
  const leftLowerLeg = bone("LeftLowerLeg", 0.0435, -0.39, -0.0459);
  const leftFoot = bone("LeftFoot", 0.0266, -0.32, 0.015);

  const rightUpperLeg = bone("RightUpperLeg", -0.0992, -0.08, -0.0009);
  const rightLowerLeg = bone("RightLowerLeg", -0.0435, -0.39, -0.0459);
  const rightFoot = bone("RightFoot", -0.0266, -0.32, 0.015);

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

  return hips;
}

const root = new THREE.Group();
root.name = "Humanoid";

// ---------- モデル全体のトランスフォーム(Root) ----------
// 「ポーズ」(各ボーンの回転)と「モデル全体の位置」を別々のデータとして
// 扱うため、GLTF書き出し対象のroot(ボーン階層・メッシュ一式)を、さらに
// 1段上の空のグループ(modelTransform)の子として配置する。モデル全体の
// 移動(MOVEモード)はこのmodelTransformのpositionだけを変更し、root
// 自身やその配下のボーンの回転には一切触れない。GLTFExporterは常に
// root自身を起点に書き出すため、modelTransformの移動はGLB書き出し結果
// (常にワールド原点基準のモデル)に一切影響しない
const modelTransform = new THREE.Group();
modelTransform.name = "ModelTransform";
modelTransform.add(root);
scene.add(modelTransform);

// GLBインポート機能の追加により、root配下のボーン・メッシュは
// ボクサーモデル固定ではなく「現在読み込んでいるモデル」によって入れ替わる
// ため、const ではなく let にしている(それぞれ rebuildSkeletonAndUI /
// loadBoxerModel / loadModelFromGLTFScene が更新する)
let allBones = [];
let skeleton = null;
let boneNameToBone = {};
let allMeshes = []; // タップ選択のレイキャスト対象(ポーズエディタ用。現状は後方互換のため保持)

// ---------- 各部位メッシュをSkinnedMeshとして構築 ----------
// ジオメトリの頂点はワールド座標(レストポーズでの実際の位置)で直接配置し、
// 各頂点を単一のボーンへ100%の重みで結びつける(見た目は剛体パーツの
// 集まりだが、データとしては正式なスキニング済みメッシュ・アニメーションとして
// 書き出せる)。ボーン一覧(skel.bones)を引数で受け取るようにし、
// 読み込むたびに作り直される現在のスケルトンに対して正しいインデックスで
// 結びつけられるようにしている
function bindToSingleBone(geometry, bone, skel) {
  const count = geometry.attributes.position.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  const idx = skel.bones.indexOf(bone);
  for (let i = 0; i < count; i++) {
    skinIndices[i * 4] = idx;
    skinWeights[i * 4] = 1;
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  return geometry;
}

// ---------- ボクサーキャラクターの各部位メッシュ(ボーンごとに分離済み) ----------
// 以前はプリミティブ形状(カプセル・球・円柱)を各ボーンに割り当てていたが、
// 「複雑な自動ウェイト計算・スキニングに依存せず、ローポリのゲーム
// キャラクターを簡単かつ安定して動かせるようにしてほしい(身体パーツを
// 独立したメッシュとして扱い、各パーツを対応するボーンに直接追従させる)」
// という依頼を受け、Tripo製ボクサーモデル(third-person-boxer-3dで使用した
// ものと同じ.glb)を一度だけオフラインで処理し、ボーンと同じ名前の17個の
// メッシュ片(assets/boxer_parts.json、頂点座標はこのスケルトンのレスト
// ポーズに合わせて事前に配置・回転済み)として書き出したものを読み込む。
// 1頂点=1ボーンの100%ウェイトで結びつける点は、以前のプリミティブ版と
// 完全に同じ仕組みであり、ポーズエディタ・ギズモ・キーフレーム・Undo・
// glTF書き出しは一切変更していない(それらはすべてボーン側だけを操作
// しており、メッシュの形状やパーツ分割の詳細には関知しないため)。詳細な
// 経緯・セグメンテーション手法は後述「ボクサーモデルのパーツ分割リギング」
// を参照。
function addWorldPart(geometry, material, bone, skel) {
  // boxer_parts.jsonの頂点座標はすでにこのスケルトンのレストポーズに
  // おける実際のワールド座標で焼き込み済みのため、以前のプリミティブ版
  // (原点中心のジオメトリをボーン位置へ平行移動していた)とは異なり、
  // 平行移動は行わない
  bindToSingleBone(geometry, bone, skel);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.bind(skel);
  mesh.userData.bone = bone;
  root.add(mesh);
  allMeshes.push(mesh);
  return mesh;
}

const boxerTexture = new THREE.TextureLoader().load("./assets/boxer_texture.jpg");
boxerTexture.colorSpace = THREE.SRGBColorSpace;
// 抽出元のglTFはUVがflipYなし前提のため、通常のTextureLoader(デフォルト
// flipY=true)のままだとテクスチャが上下逆かつ左右の対応もずれて表示される
boxerTexture.flipY = false;
// ボクサー用のマテリアルはモジュール最上位で1回だけ作る持続的なオブジェクト
// (🥊で何度ボクサーへ戻しても、同じマテリアル・テクスチャを使い回す。
// clearCurrentModelはこの2つだけを明示的にdispose対象から除外している)
const boxerMat = new THREE.MeshStandardMaterial({ map: boxerTexture, roughness: 0.7 });
const jointMat = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.6 });

// ---------- 現在のモデルの破棄(GLBインポート/ボクサーへの差し替え共通) ----------
// 「読み込んだモデルに差し替え」という方針のため、新しいモデルをrootへ
// 追加する前に、現在表示中のモデル(ボーン・メッシュ・当たり判定プロキシ)を
// 完全に取り除く。ギズモのリング類はroot(=GLTF書き出し対象)には含めず
// scene直下にあるため、ここでは一切触れない
function clearCurrentModel() {
  for (const proxy of boneHitProxies) {
    if (proxy.parent) proxy.parent.remove(proxy);
    proxy.geometry.dispose();
  }
  boneHitProxies = [];
  while (root.children.length > 0) {
    const child = root.children[0];
    root.remove(child);
    child.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m === boxerMat || m === jointMat) continue; // ボクサー用の永続マテリアルは使い回すため破棄しない
          m.dispose();
        }
      }
    });
  }
  allMeshes = [];
  poseKeyframes = [];
  currentTime = 0;
  rebuildSkeletonAndUI([]);
}

// ---------- ボクサーモデルの(再)読み込み ----------
// GLBインポート後に🥊ボタンを押すと、元のボクサーモデルへいつでも戻せる
function loadBoxerModel() {
  clearCurrentModel();
  const hipsBone = buildBoxerBoneHierarchy();
  root.add(hipsBone);
  root.updateMatrixWorld(true); // レストポーズのワールド行列を確定させる(バインド行列の計算に必要)

  const bones = [];
  hipsBone.traverse((o) => { if (o.isBone) bones.push(o); });
  rebuildSkeletonAndUI(bones);

  const skel = skeleton;
  const boneByName = boneNameToBone;

  fetch("./assets/boxer_parts.json")
    .then((res) => res.json())
    .then((parts) => {
      for (const [boneName, data] of Object.entries(parts)) {
        if (!data.positions || data.positions.length === 0) continue;
        const b = boneByName[boneName];
        if (!b) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(data.normals, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(data.uvs, 2));
        addWorldPart(geometry, boxerMat, b, skel);
      }
    })
    .catch((err) => console.error("boxer_parts.json の読み込みに失敗しました", err));

  // ---------- 関節カバー球(肩・肘・股関節・膝) ----------
  // パーツを完全に独立したメッシュへ分割したことで、関節を大きく曲げると
  // 境界が開いて隙間が見えてしまう問題があったため、各関節のちょうど
  // ボーン位置に小さな球を置いて隙間を隠す。球は「回転先(末端側)の
  // ボーン自身の原点」に、オフセット0で配置する。そのボーン自身の回転は
  // 球の位置を一切動かさない(原点にあるため、回転してもその場で自転
  // するだけ)ので、親ボーン側の回転だけで正しく追従しつつ、曲げ角度に
  // 関わらず常にその関節の真上に留まり続ける
  fetch("./assets/boxer_joints.json")
    .then((res) => res.json())
    .then(({ joints }) => {
      for (const { bone: boneName, radius, center } of Object.values(joints)) {
        const b = boneByName[boneName];
        if (!b) continue;
        const geometry = new THREE.SphereGeometry(radius, 14, 12);
        geometry.translate(center[0], center[1], center[2]);
        addWorldPart(geometry, jointMat, b, skel);
      }
    })
    .catch((err) => console.error("boxer_joints.json の読み込みに失敗しました", err));

  applyViewFraming(1.0, 1.15, 0.9); // ボクサー用に手調整した元のカメラ・ビュー範囲に戻す
  statusEl.textContent = "ボクサーモデルを読み込みました";
  setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 2000);
}

// ---------- GLBインポート(任意のボーン構成のモデルに差し替え) ----------
// 「別のアプリ(mesh-modeling-studio)で作った、ボーンとスキンがペアリング
// された状態のGLBをこのアプリで読み込んで、ポーズ編集・アニメーション
// 作成に使いたい」という依頼を受けて追加した。ボクサーの19本の固定ボーン
// 構成に依存せず、読み込んだGLBが実際に持っているボーン(本数・名前・
// 階層とも任意)をそのまま使ってポーズエディタ・ギズモ・キーフレーム・
// glTF書き出しを動かす(詳細は後述「GLBインポート」を参照)
function extractSkinnedContent(gltfScene) {
  const bonesSet = new Set();
  const meshes = [];
  gltfScene.traverse((obj) => {
    if (obj.isSkinnedMesh) {
      meshes.push(obj);
      for (const b of obj.skeleton.bones) bonesSet.add(b);
    } else if (obj.isMesh) {
      meshes.push(obj);
    }
  });
  const bones = Array.from(bonesSet);
  const boneSet = new Set(bones);
  const rootBones = bones.filter((b) => !b.parent || !boneSet.has(b.parent));
  return { bones, meshes, rootBones };
}

// オブジェクトを新しい親の子にしつつ、見た目のワールド変形(位置・回転・
// 拡大率)が変わらないよう、ローカルTransformを再計算する。読み込んだGLBの
// 中間ノード(Armature等)が単位行列でない変形を持っていた場合でも、
// モデルの見た目がズレないようにするための処理
function reparentPreservingWorldTransform(obj, newParent) {
  const worldMatrix = obj.matrixWorld.clone();
  newParent.add(obj);
  newParent.updateMatrixWorld(true);
  const parentWorldInverse = new THREE.Matrix4().copy(newParent.matrixWorld).invert();
  const localMatrix = new THREE.Matrix4().multiplyMatrices(parentWorldInverse, worldMatrix);
  localMatrix.decompose(obj.position, obj.quaternion, obj.scale);
}

function loadModelFromGLTFScene(gltfScene) {
  gltfScene.updateMatrixWorld(true);
  const { bones, meshes, rootBones } = extractSkinnedContent(gltfScene);
  if (meshes.length === 0) throw new Error("メッシュが見つかりませんでした");
  // ボーン(スケルトン)を持たない静的メッシュのGLBは、エラーなく読み込め
  // てしまうとポーズを付ける対象が0個のまま現在のモデルを上書きしてしまい、
  // 「読み込めたのに何も操作できない」という分かりにくい状態になる。
  // それよりも、現在のモデルは差し替えずにはっきり理由を伝える方が親切
  // なので、ここで明示的に失敗として扱う
  if (bones.length === 0) {
    throw new Error(
      "ボーン(スケルトン)が見つかりませんでした。先にBlenderなどでリグ" +
      "(ボーンの追加とスキニング)を済ませたGLBを読み込んでください。"
    );
  }

  clearCurrentModel();

  for (const rb of rootBones) reparentPreservingWorldTransform(rb, root);
  for (const m of meshes) {
    reparentPreservingWorldTransform(m, root);
    allMeshes.push(m);
  }
  root.updateMatrixWorld(true);

  rebuildSkeletonAndUI(bones);
  fitViewToCurrentModel();
}

// ---------- ポーズエディタ(FKによるボーン選択・回転・キーフレーム記録) ----------
// boneNameToBoneはモデル読み込み時にrebuildSkeletonAndUIが更新する
// (このファイルの先頭付近、root/allBones宣言のそばで let 宣言済み)

let selectedBone = null;

// ---------- 編集モード(POSE / MOVE) ----------
// POSE: 選択した関節を3軸回転させる(既存の操作)。
// MOVE: 現在のポーズ(各ボーンの回転・キーフレームに保存された値)を一切
// 変更せず、モデル全体(modelTransform)の位置だけをドラッグで移動する。
// この2つは完全に別の編集対象(pose = ボーンの回転、transform = モデル
// 全体の位置)であり、互いのデータを一切混ぜない
let editMode = "pose";

// ---------- 肘・膝の回転軸(ヒンジ軸)をボーンのローカル座標系から判定する ----------
// 「肘・膝は1軸のみ回転可能」とするため、どのローカル軸がその1軸に
// 当たるかを求める。固定で「X軸」と決め打ちするのではなく、実際の
// ボーン構造(左右の肩・腿の位置関係)から身体の左右(内外側)軸を求め、
// それを各関節ボーン自身のローカル座標系に変換して最も近い主軸に
// スナップする。肘・膝のような単純なヒンジ関節は、解剖学的に
// 身体の左右軸まわりにしか曲がらないため、この「身体の左右軸」が
// そのままヒンジ軸になる。
// (レストポーズの時点で1度だけ計算する。ポーズを変えた後も同じ軸を使う)
//
// GLBインポートで任意のボーン構成を受け入れられるよう、以前の
// leftShoulder/rightShoulder等への直接参照ではなく、ボーン名に
// "left"/"right"を含むペアを探して左右軸を推定する汎用版にしている
// (mesh-modeling-studio等このリポジトリの他プロジェクトと同じ、
// Left/Right命名規則を前提とする)。対になる名前が1つも見つからない
// 場合はワールドX軸をフォールバックとして使う
function computeSideAxisWorldGeneric(bonesList) {
  const byLowerName = new Map(bonesList.map((b) => [b.name.toLowerCase(), b]));
  const sum = new THREE.Vector3();
  let found = 0;
  for (const b of bonesList) {
    const lname = b.name.toLowerCase();
    if (!lname.includes("left")) continue;
    const rb = byLowerName.get(lname.replace("left", "right"));
    if (!rb) continue;
    const lp = new THREE.Vector3(), rp = new THREE.Vector3();
    b.getWorldPosition(lp);
    rb.getWorldPosition(rp);
    sum.add(lp.sub(rp));
    found++;
  }
  if (found === 0) return new THREE.Vector3(1, 0, 0);
  return sum.normalize();
}

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

// 肘(前腕)・膝(すね)に相当するボーンだけを1軸(ヒンジ)関節として扱う。
// ボクサーの固定ボーン名(leftForearm等)への直接参照ではなく、ボーン名に
// よくある単語(forearm/lowerLeg/shin/calf/elbow/knee)が含まれるかで
// 判定する汎用版にしている(大文字小文字は区別しない)。該当するボーンが
// 1つもない構成(例: 腕しかないロボット)でも、単にヒンジ関節が0個になる
// だけでエラーにはならない
const HINGE_NAME_PATTERNS = ["forearm", "lowerleg", "lower_leg", "shin", "calf", "elbow", "knee"];
function detectHingeBones(bonesList) {
  return bonesList.filter((b) => HINGE_NAME_PATTERNS.some((p) => b.name.toLowerCase().includes(p)));
}

// SIDE_AXIS_WORLD/HINGE_BONES/hingeAxisByBoneNameは、モデルを読み込む
// (rebuildSkeletonAndUIを呼ぶ)たびに作り直されるため let にしている
let SIDE_AXIS_WORLD = new THREE.Vector3(1, 0, 0);
let HINGE_BONES = [];
let hingeAxisByBoneName = {};

function recomputeHingeAndSideAxis(bonesList) {
  SIDE_AXIS_WORLD = computeSideAxisWorldGeneric(bonesList);
  HINGE_BONES = detectHingeBones(bonesList);
  hingeAxisByBoneName = {};
  for (const b of HINGE_BONES) hingeAxisByBoneName[b.name] = computeHingeAxisLocal(b);
}

// ---------- 選択中のボーンを操作する3軸回転ギズモ(スマートフォン向け) ----------
// 球体をドラッグして自由回転させる方式は廃止し、X/Y/Z軸ごとのリングを
// 個別にドラッグして、その軸だけを回転させる方式にした。リングは
// root(=GLTF書き出し対象)には含めず、scene直下に置くことで書き出し
// 結果に含まれないようにしている
//
// スマートフォンでの操作性のため、以下の工夫をしている:
// - 見た目のリングとは別に、はるかに太い非表示の当たり判定用トーラスを
//   同じ位置に重ねて用意し、指が細い線から多少ズレてもつかめるようにする
// - TOP/FRONT/LEFTの固定視点では、その視点から見て正面(操作しやすい)な
//   1軸だけを表示・操作可能にし、見えにくい(真横から見える線状の)軸は
//   そのビューでは表示しない。FREE CAMERAでは従来通り3軸とも有効
const RING_RADIUS = 0.17; // 以前(0.13)より大きくして視認性を上げた
const RING_TUBE = 0.016; // 見た目のリングの太さ(以前の0.011より太くした)
const HIT_TUBE = 0.075; // 当たり判定用(非表示)トーラスの太さ。見た目よりかなり太くして、指のズレを許容する

// Three.jsのレイヤー機能で「どのカメラにどのリングを見せるか」を切り替える。
// レイヤー0は全カメラが常に見ているデフォルト(ヒンジ関節の唯一の軸や
// ギズモの中心点など、常にどのビューでも見せたいものに使う)
const LAYER_RING_X = 1;
const LAYER_RING_Y = 2;
const LAYER_RING_Z = 3;
const LAYER_BY_AXIS_KEY = { x: LAYER_RING_X, y: LAYER_RING_Y, z: LAYER_RING_Z };

function makeRingPair(color) {
  const visual = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 10, 56),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 })
  );
  const hitProxy = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS, HIT_TUBE, 8, 32),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitProxy.visible = false; // 非表示だが、Three.jsのレイキャストは非表示オブジェクトにも反応するため当たり判定には使える
  const group = new THREE.Group();
  group.add(visual, hitProxy);
  return { group, visual, hitProxy };
}
const RING_COLOR = { x: 0xff5050, y: 0x55e06a, z: 0x4d9bff };
const ringX = makeRingPair(RING_COLOR.x);
const ringY = makeRingPair(RING_COLOR.y);
const ringZ = makeRingPair(RING_COLOR.z);
ringX.group.rotation.y = Math.PI / 2; // デフォルト(法線=ローカルZ)のトーラスを、法線がローカルXになるよう向ける
ringY.group.rotation.x = Math.PI / 2; // 法線がローカルYになるよう向ける
// ringZ はデフォルトのまま(法線=ローカルZ)
const gizmoDot = new THREE.Mesh(
  new THREE.SphereGeometry(0.022, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
);

const selectionGizmo = new THREE.Group();
selectionGizmo.add(ringX.group, ringY.group, ringZ.group, gizmoDot);
selectionGizmo.visible = false;
selectionGizmo.renderOrder = 999;
scene.add(selectionGizmo);

// ---------- 3Dカーソル(基準点)の表示 ----------
// 「3D空間上の基準点・目安」として視覚的に表示するだけのマーカー。
// 現時点では回転中心・移動基準・スナップ先などの機能は一切持たせず、
// ドラッグ移動・クリック移動・回転にも対応しない(見た目のみ)。
// ポーズ(ボーンの回転)やモデル全体のトランスフォーム(modelTransform)
// とは完全に独立した、ワールド座標系の値(cursorPosition)として管理する
const CURSOR_AXIS_LENGTH = 0.12; // ボーンの3軸ギズモ(半径0.17)より一回り控えめにし、目立ちすぎないようにしている
const CURSOR_AXIS_COLOR = { x: 0xff5050, y: 0x55e06a, z: 0x4d9bff }; // 既存の3軸ギズモ(X=赤,Y=緑,Z=青)と同じ配色にして、見た目の意味を揃えている

function makeCursorAxisMesh(color, axisVec) {
  // デフォルトでローカルY軸方向に伸びる細い円柱を作り、原点から
  // axisVec方向へ伸びる「軸」になるよう土台を原点に揃えてから向きを合わせる
  const geometry = new THREE.CylinderGeometry(0.004, 0.004, CURSOR_AXIS_LENGTH, 6);
  geometry.translate(0, CURSOR_AXIS_LENGTH / 2, 0);
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axisVec.clone().normalize());
  return mesh;
}

const cursorMarker = new THREE.Group();
cursorMarker.add(
  makeCursorAxisMesh(CURSOR_AXIS_COLOR.x, new THREE.Vector3(1, 0, 0)),
  makeCursorAxisMesh(CURSOR_AXIS_COLOR.y, new THREE.Vector3(0, 1, 0)),
  makeCursorAxisMesh(CURSOR_AXIS_COLOR.z, new THREE.Vector3(0, 0, 1))
);
const cursorDot = new THREE.Mesh(
  new THREE.SphereGeometry(0.012, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 })
);
cursorMarker.add(cursorDot);
cursorMarker.renderOrder = 998; // ギズモ(999)よりわずかに手前にならないようにしつつ、通常のメッシュよりは手前に描く
scene.add(cursorMarker);

// 将来的な拡張(回転中心・移動基準点・スナップ先・ポーズ編集の基準点など)に
// 備えて、cursorPositionはモデルのRoot位置やボーン位置とは別の、独立した
// 単純な3D座標オブジェクトとして管理する。初期位置はワールド原点
let cursorPosition = { x: 0, y: 0, z: 0 };
function setCursorPosition(x, y, z) {
  cursorPosition = { x, y, z };
  cursorMarker.position.set(x, y, z);
}

const ringByAxisKey = { x: ringX, y: ringY, z: ringZ };
function ringLocalAxis(key) {
  return key === "x" ? new THREE.Vector3(1, 0, 0) : key === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
}

// 固定ビュー(TOP/FRONT/LEFT)それぞれで、正面から見えて操作しやすい軸
function easyAxisForView(viewKey) {
  if (viewKey === "top") return "y";
  if (viewKey === "front") return "z";
  if (viewKey === "left") return "x";
  return null; // free: 制限なし(3軸とも有効)
}

function updateGizmoTransform() {
  // MOVEモード中は関節の回転操作を行わないため、紛らわしくないようギズモ
  // 自体を非表示にする(選択状態そのものは保持したままなので、POSEモードへ
  // 戻れば同じボーンのギズモがそのまま復帰する)
  if (!selectedBone || editMode !== "pose") {
    selectionGizmo.visible = false;
    return;
  }
  selectionGizmo.visible = true;
  selectedBone.getWorldPosition(selectionGizmo.position);
  selectedBone.getWorldQuaternion(selectionGizmo.quaternion);
}

// 選択したボーンが肘・膝(ヒンジ関節)かどうかで、表示する軸の本数を切り替える。
// 基本関節(3軸)の場合は、各軸リングを専用レイヤーに割り当てて、
// カメラ側のレイヤー設定でビューごとの表示を切り替えられるようにする。
// ヒンジ関節の場合は、唯一有効な軸をレイヤー0(全カメラ共通)に戻し、
// どのビューからでも常に操作できるようにする
function updateGizmoAxesForSelection() {
  const hinge = selectedBone ? hingeAxisByBoneName[selectedBone.name] : null;
  for (const key of ["x", "y", "z"]) {
    const ring = ringByAxisKey[key];
    const isHingeAxis = hinge && hinge.key === key;
    const layer = hinge ? 0 : LAYER_BY_AXIS_KEY[key];
    ring.group.visible = hinge ? isHingeAxis : !!selectedBone;
    // レイヤーは各メッシュ自身に設定する必要がある(Three.jsでは親Groupの
    // layersは子に自動で伝播しないため、グループにセットするだけでは
    // カメラ側のレイヤー制限が効かない)
    ring.visual.layers.set(layer);
    ring.hitProxy.layers.set(layer);
    ring.visual.material.opacity = 0.95;
    ring.visual.scale.setScalar(1);
  }
}

// 現在のボーン・ビューで実際に操作可能なリングの一覧(ヒットテスト対象)。
// 基本関節(3軸)はビューごとに「正面から見える1軸」だけに絞り込み、
// ヒンジ関節はどのビューでも唯一の軸のみを返す
function activeGizmoRings(viewKey) {
  if (!selectedBone) return [];
  const hinge = hingeAxisByBoneName[selectedBone.name];
  if (hinge) {
    return [{ key: hinge.key, ring: ringByAxisKey[hinge.key], axisLocal: ringLocalAxis(hinge.key) }];
  }
  const keys = viewKey === "free" || !viewKey ? ["x", "y", "z"] : [easyAxisForView(viewKey)].filter(Boolean);
  return keys.map((key) => ({ key, ring: ringByAxisKey[key], axisLocal: ringLocalAxis(key) }));
}

// ドラッグ中の軸を明確にハイライトし、同時に他の軸を薄く表示して
// 「ドラッグ中は他の軸を一時的に無効化している」ことを視覚的に示す
function setRingHighlight(activeKey, on) {
  for (const key of ["x", "y", "z"]) {
    const ring = ringByAxisKey[key];
    if (key === activeKey) {
      ring.visual.material.opacity = on ? 1 : 0.95;
      ring.visual.scale.setScalar(on ? 1.25 : 1);
    } else if (on) {
      ring.visual.material.opacity = 0.18;
    } else {
      ring.visual.material.opacity = 0.95;
    }
  }
}

const boneSelectEl = document.getElementById("boneSelect");
const selectedBoneLabelEl = document.getElementById("selectedBoneLabel");

function setSelectedBone(b) {
  selectedBone = b;
  boneSelectEl.value = b ? b.name : "";
  selectedBoneLabelEl.textContent = b ? b.name : "なし";
  // ボーン選択中は、ギズモのリングをドラッグする操作を優先するため、
  // カメラのオービット(OrbitControls)は無効化しておく
  controls.enabled = editMode === "pose" && !selectedBone;
  updateGizmoAxesForSelection();
  updateGizmoTransform(); // 次の描画フレームを待たず、選択直後にギズモの表示状態を反映する
}

boneSelectEl.addEventListener("change", () => {
  setSelectedBone(boneNameToBone[boneSelectEl.value] || null);
});

// ---------- [POSE]/[MOVE]モード切替 ----------
const modePoseBtn = document.getElementById("modePoseBtn");
const modeMoveBtn = document.getElementById("modeMoveBtn");
function setEditMode(mode) {
  editMode = mode;
  modePoseBtn.classList.toggle("active", mode === "pose");
  modeMoveBtn.classList.toggle("active", mode === "move");
  if (mode === "move") {
    // MOVEに切り替えた瞬間にリングドラッグ中だった場合はハイライトを戻す
    if (activeRingDrag) { setRingHighlight(activeRingDrag.key, false); activeRingDrag = null; }
    controls.enabled = false;
  } else {
    controls.enabled = !selectedBone;
  }
  updateGizmoTransform();
}
modePoseBtn.addEventListener("click", () => setEditMode("pose"));
modeMoveBtn.addEventListener("click", () => setEditMode("move"));

// ---------- タップでボーン選択・ドラッグでボーンを回転(FK) ----------
// 注意: Three.jsのSkinnedMeshの標準レイキャストは、ポーズ変更後の変形済み
// 形状ではなく「レストポーズ時点のジオメトリ」に対して判定されてしまうため、
// ポーズを変えた後にタップ判定がずれてしまう。これを避けるため、各ボーンの
// 子として追従する非表示の当たり判定用プロキシ球を用意し、そちらを
// レイキャスト対象にする(ボーンの現在のワールド変形に正しく追従する)
const PROXY_RADIUS = 0.075;
let boneHitProxies = [];

// ---------- モデル読み込み後のUI再構築(ドロップダウン・当たり判定・
// ヒンジ軸) ----------
// GLBインポート/ボクサーへの差し替えのたびに、現在のボーン一覧
// (allBones)に合わせてボーン選択ドロップダウン・タップ選択用の当たり
// 判定プロキシ・ヒンジ軸を作り直す。以前はこれらをモジュール最上位で
// 1回だけ実行していたが、モデルを差し替え可能にしたことで関数化した
function rebuildSkeletonAndUI(bonesList) {
  allBones = bonesList;
  skeleton = allBones.length > 0 ? new THREE.Skeleton(allBones) : null;
  boneNameToBone = Object.fromEntries(allBones.map((b) => [b.name, b]));

  boneSelectEl.innerHTML = "";
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "(ボーン未選択)";
  boneSelectEl.appendChild(emptyOpt);
  for (const b of allBones) {
    const opt = document.createElement("option");
    opt.value = b.name;
    opt.textContent = b.name;
    boneSelectEl.appendChild(opt);
  }

  for (const proxy of boneHitProxies) {
    if (proxy.parent) proxy.parent.remove(proxy);
    proxy.geometry.dispose();
  }
  boneHitProxies = [];
  for (const b of allBones) {
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(PROXY_RADIUS, 8, 6));
    proxy.visible = false;
    proxy.userData.bone = b;
    b.add(proxy);
    boneHitProxies.push(proxy);
  }

  recomputeHingeAndSideAxis(allBones);
  setSelectedBone(null);
}

const raycaster = new THREE.Raycaster();
// レイキャスト対象の絞り込みは、常にactiveGizmoRings(viewKey)で明示的な
// 候補リストとして行っているため、Raycaster自身のレイヤーフィルタ
// (デフォルトはレイヤー0のみ)はここでは使わず、全レイヤーを見るようにする。
// そうしないと、カメラの描画用レイヤー設定(ビューごとの軸の絞り込み)の
// 影響で、ギズモ用リング(レイヤー0以外に割り当てたもの)がヒットしなくなる
raycaster.layers.enableAll();
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

// 3Dカーソルの配置先となる平面の法線(=そのビューにとっての奥行き軸)。
// TOPはY=0、FRONTはZ=0、LEFTはX=0の平面上に配置する(FREE CAMERAは
// 今回未対応のため含めていない)
const CURSOR_PLANE_NORMAL_BY_VIEW = {
  top: new THREE.Vector3(0, 1, 0),
  front: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(1, 0, 0),
};

// 指定したビュー(正投影のTOP/FRONT/LEFTのみ)でのタップ位置を、そのビューの
// 奥行き軸を0に固定した3D座標へ変換し、3Dカーソルをそこへ移動する。
// 正投影カメラのレイは互いに平行で、かつカメラの向き自体がそのビューの
// 奥行き軸と一致しているため、対応する平面(原点を通る)との交点は
// 必ず一意に求まる
function placeCursorAt(clientX, clientY, viewKey) {
  const planeNormal = CURSOR_PLANE_NORMAL_BY_VIEW[viewKey];
  if (!planeNormal) return; // FREE CAMERAは今回未対応
  setRaycasterFromClient(clientX, clientY, viewKey);
  const plane = new THREE.Plane(planeNormal, 0);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return;
  // 浮動小数点の誤差を避け、奥行き軸を厳密に0へ固定する
  if (viewKey === "top") hit.y = 0;
  else if (viewKey === "front") hit.z = 0;
  else if (viewKey === "left") hit.x = 0;
  setCursorPosition(hit.x, hit.y, hit.z);
}

// ギズモのリング(選択中ボーンがある場合のみ)に対するヒットテスト。
// 見た目の細いリングではなく、太い非表示の当たり判定用トーラス(hitProxy)に
// 対して判定することで、指が多少ズレても同じ軸をつかめるようにしている。
// どの軸が候補になるかはビュー(象限)ごとに絞り込まれる(activeGizmoRings参照)
function pickGizmoRingAt(clientX, clientY) {
  if (!selectedBone) return null;
  const viewKey = viewAt(clientX, clientY);
  setRaycasterFromClient(clientX, clientY, viewKey);
  const rings = activeGizmoRings(viewKey);
  const hits = raycaster.intersectObjects(rings.map((r) => r.ring.hitProxy), false);
  if (hits.length === 0) return null;
  return rings.find((r) => r.ring.hitProxy === hits[0].object) || null;
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
  // MOVEモード中はどのビュー・選択状態でもオービットを無効化し、
  // ドラッグを常にモデル全体の移動操作に専念させる
  controls.enabled = editMode === "pose" && key === "free" && !selectedBone;
}
canvas.addEventListener("pointerdown", onPointerDownGate, { capture: true });

// ---------- MOVEモード: 現在のポーズを維持したままモデル全体を移動する ----------
// 各ボーンのrotationには一切触れず、modelTransform(root一式を束ねる
// 空のグループ)のpositionだけをドラッグで変更する。TOP/FRONT/LEFTの
// 正投影ビューでは、そのビューのカメラの右方向・上方向ベクトルを使って
// スクリーン座標の移動量をワールド座標の移動量に変換することで、
// 各カメラの向き(TOP/FRONT/LEFTで異なる)に応じて自動的にそのビューの
// 平面方向への移動になる(カメラの奥行き方向の成分は含まれないため、
// そのビューにとっての奥行き軸は変化しない)。FREE CAMERA(透視投影)でも
// 同じ考え方で、カメラから基準点までの距離をもとにスクリーン1pxあたりの
// ワールド距離を近似して同様に変換する
function screenDeltaToWorld(key, dxPx, dyPx, referencePoint) {
  const cam = camerasByKey[key];
  const vp = viewLayout[key];
  const camRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
  const camUp = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
  let worldPerPxX, worldPerPxY;
  if (cam.isOrthographicCamera) {
    worldPerPxX = (cam.right - cam.left) / (cam.zoom * vp.w);
    worldPerPxY = (cam.top - cam.bottom) / (cam.zoom * vp.h);
  } else {
    const dist = Math.max(0.01, cam.position.distanceTo(referencePoint));
    const worldHeightAtDist = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * dist;
    worldPerPxY = worldHeightAtDist / vp.h;
    worldPerPxX = worldPerPxY * cam.aspect;
  }
  return camRight.multiplyScalar(dxPx * worldPerPxX).add(camUp.multiplyScalar(-dyPx * worldPerPxY));
}

let modelDrag = null; // { key, startClientX, startClientY, startPosition }

function onPointerDownModel(evt) {
  modelDrag = {
    key: viewAt(evt.clientX, evt.clientY),
    startClientX: evt.clientX,
    startClientY: evt.clientY,
    startPosition: modelTransform.position.clone(),
  };
  controls.enabled = false;
}

function onPointerMoveModel(evt) {
  if (!modelDrag) return;
  const dx = evt.clientX - modelDrag.startClientX;
  const dy = evt.clientY - modelDrag.startClientY;
  const worldDelta = screenDeltaToWorld(modelDrag.key, dx, dy, modelDrag.startPosition);
  modelTransform.position.copy(modelDrag.startPosition).add(worldDelta);
}

function onPointerUpModel() {
  modelDrag = null;
  controls.enabled = false; // POSEモードへ切り替えるまでオービットは無効のまま
}

const DRAG_THRESHOLD_PX = 6; // この移動量未満なら「タップ」、以上なら「ドラッグ」とみなす

let pointerDownInfo = null; // { x, y, hitBone } (タップ判定用)
let activeRingDrag = null; // { key, axisLocal, center, sign, startAngle, startQuat }

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
    axisLocal: ringHit.axisLocal.clone(),
    center, sign, startAngle,
    startQuat: selectedBone.quaternion.clone(),
  };
}

function onPointerDownPose(evt) {
  if (editMode === "move") { onPointerDownModel(evt); return; }
  activeRingDrag = null;
  pointerDownInfo = { x: evt.clientX, y: evt.clientY, hitBone: null };

  if (selectedBone) {
    const ringHit = pickGizmoRingAt(evt.clientX, evt.clientY);
    if (ringHit) {
      const drag = beginRingDrag(evt, ringHit, viewAt(evt.clientX, evt.clientY));
      activeRingDrag = drag;
      setRingHighlight(drag.key, true); // 掴んだ軸をハイライトし、他の軸は一時的に薄くして操作不可を示す
      controls.enabled = false;
      return; // ギズモを掴んだ場合はタップ判定(ボーンの選択切替)は行わない
    }
  }
  pointerDownInfo.hitBone = pickBoneAt(evt.clientX, evt.clientY);
}

function onPointerMovePose(evt) {
  if (editMode === "move") { onPointerMoveModel(evt); return; }
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
  if (editMode === "move") { onPointerUpModel(); return; }
  if (activeRingDrag) {
    setRingHighlight(activeRingDrag.key, false);
    // ドラッグによって実際に回転が変化した場合のみUndo履歴に積む
    // (リングを掴んだだけで動かさなかった場合に無意味な履歴を残さないため)
    if (!activeRingDrag.startQuat.equals(selectedBone.quaternion)) {
      pushUndo({
        type: "rotateBone",
        boneName: selectedBone.name,
        beforeQuat: activeRingDrag.startQuat.toArray(),
      });
    }
    activeRingDrag = null;
    pointerDownInfo = null;
    controls.enabled = editMode === "pose" && !selectedBone;
    return;
  }
  if (!pointerDownInfo) return;
  const dx = evt.clientX - pointerDownInfo.x;
  const dy = evt.clientY - pointerDownInfo.y;
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
    // タップ: ヒットしたボーンを選択(ヒットしなければ選択解除)
    setSelectedBone(pointerDownInfo.hitBone);
    if (!pointerDownInfo.hitBone) {
      // 空白部分のタップ: 3Dカーソルをそのビューの平面上に配置する
      placeCursorAt(evt.clientX, evt.clientY, viewAt(evt.clientX, evt.clientY));
    }
  }
  pointerDownInfo = null;
  controls.enabled = editMode === "pose" && !selectedBone;
}

canvas.addEventListener("pointerdown", onPointerDownPose);
canvas.addEventListener("pointermove", onPointerMovePose);
canvas.addEventListener("pointerup", onPointerUpPose);
canvas.addEventListener("pointercancel", () => {
  if (activeRingDrag) setRingHighlight(activeRingDrag.key, false);
  activeRingDrag = null;
  pointerDownInfo = null;
  modelDrag = null;
  controls.enabled = editMode === "pose" && !selectedBone;
});

// ---------- タイムライン・キーフレーム ----------
// キーフレームは「その時刻でのPOSE(全ボーンの回転)」と「その時刻でのMOVE
// (モデル全体のmodelTransform.position、絶対座標)」を、同じ1つのフレーム
// エントリの中に別々のフィールドとして持つ(どちらか一方だけが設定されている
// ことも、両方設定されていることもある)。POSEは2つのキーフレーム間を
// 球面線形補間(slerp)、MOVEは線形補間(lerp)でつなぎ、それぞれ独立に
// なめらかに再現する
let currentTime = 0;
let poseKeyframes = []; // [{ time, pose: {[boneName]:[x,y,z,w]}|null, modelPosition: [x,y,z]|null }] (time昇順)
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

// ユーザーがPOSE/MOVEのどちらを編集していたかに関わらず、「+◆」を1回
// 押すだけで「このフレームのキャラクターの姿勢」と「このフレームの
// キャラクターの位置」を同時に保存する(ユーザーの編集操作を一体化する
// ための統合ポイント)。内部データとしては、引き続きpose(全ボーンの
// 姿勢)とmodelPosition(ModelRootの絶対座標)を別々のフィールドとして
// 保持しており、技術的に1つのデータへ統合しているわけではない。再生時の
// 補間もそれぞれ独立したトラックとして行う(applyBonePoseAtTime/
// applyModelTransformAtTimeを参照)。これにより、POSEのみ・MOVEのみ・
// 両方、という3パターンのキーフレーム(JSONインポート等で作られた
// ものも含む)を引き続き正しく扱える
function addKeyframeAt(time) {
  const entry = { time, pose: snapshotPose(), modelPosition: modelTransform.position.toArray() };
  const existingIdx = poseKeyframes.findIndex((k) => Math.abs(k.time - time) < 1e-6);
  if (existingIdx >= 0) poseKeyframes[existingIdx] = entry;
  else {
    poseKeyframes.push(entry);
    poseKeyframes.sort((a, b) => a.time - b.time);
  }
}

// 指定した時刻を挟む2つのキーフレーム(と補間係数alpha)を求める汎用ヘルパー。
// POSEトラック(pose!=nullのエントリだけ)とMOVEトラック(modelPosition!=null
// のエントリだけ)は、それぞれ別の「フィルタ済みリスト」として渡すことで、
// 互いに完全に独立して補間できるようにしている
function findBoundingKeyframes(list, time) {
  if (list.length === 0) return null;
  const first = list[0];
  const last = list[list.length - 1];
  if (time <= first.time) return { k0: first, k1: first, alpha: 0 };
  if (time >= last.time) return { k0: last, k1: last, alpha: 0 };
  for (let i = 0; i < list.length - 1; i++) {
    if (list[i].time <= time && time <= list[i + 1].time) {
      const span = list[i + 1].time - list[i].time;
      return { k0: list[i], k1: list[i + 1], alpha: span > 1e-9 ? (time - list[i].time) / span : 0 };
    }
  }
  return { k0: first, k1: first, alpha: 0 };
}

function applyBonePoseAtTime(time) {
  const track = poseKeyframes.filter((k) => k.pose);
  const b = findBoundingKeyframes(track, time);
  if (!b) return;
  if (b.k0 === b.k1) { applyPoseObject(b.k0.pose); return; }
  for (const bone of allBones) {
    const q0 = b.k0.pose[bone.name], q1 = b.k1.pose[bone.name];
    if (!q0 || !q1) continue;
    const a = new THREE.Quaternion(q0[0], q0[1], q0[2], q0[3]);
    const c = new THREE.Quaternion(q1[0], q1[1], q1[2], q1[3]);
    a.slerp(c, b.alpha);
    bone.quaternion.copy(a);
  }
}

// MOVEキーフレームが1つも無い場合は、modelTransform.positionには一切
// 触れない(編集中にドラッグで動かした位置や、既定の原点をそのまま保つ。
// これによりMOVEキーフレームを使わない既存のPOSEアニメーションの挙動は
// 完全に元のまま変化しない)
function applyModelTransformAtTime(time) {
  const track = poseKeyframes.filter((k) => k.modelPosition);
  const b = findBoundingKeyframes(track, time);
  if (!b) return;
  const p0 = b.k0.modelPosition, p1 = b.k1.modelPosition;
  modelTransform.position.set(
    p0[0] + (p1[0] - p0[0]) * b.alpha,
    p0[1] + (p1[1] - p0[1]) * b.alpha,
    p0[2] + (p1[2] - p0[2]) * b.alpha
  );
}

// 1. ModelRoot(modelTransform)のTransformを適用 → 2. 各ボーンのPOSEを適用
// → 3. レンダリング、という順序を踏襲する(呼び出し元のrender()が3を行う)
function applyPoseAtTime(time) {
  if (poseKeyframes.length === 0) return;
  applyModelTransformAtTime(time);
  applyBonePoseAtTime(time);
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

  // キーフレームの位置を三角マーカーで表示。ドラッグ中のキーフレームは
  // 元の位置には描かず、指に追従する現在のドラッグ先の位置に、より大きく
  // 明るい色のマーカーとして描画することで「掴んで動かしている」ことを
  // リアルタイムに示す。選択中のキーフレーム(削除対象)は、通常の黄色とは
  // 異なる色で少し大きく描き、どれが選択されているか分かるようにする
  for (const kf of poseKeyframes) {
    if (keyframeDragState && Math.abs(kf.time - keyframeDragState.originalTime) < 1e-6) continue;
    const isSelected = selectedKeyframeTime !== null && Math.abs(kf.time - selectedKeyframeTime) < 1e-6;
    const x = timelineFrameToX(frameOf(kf.time), cssW);
    timelineCtx.fillStyle = isSelected ? "#ff8a3d" : "#ffd24c";
    const halfWidth = isSelected ? 6 : 4;
    const bottomY = isSelected ? cssH * 1.0 : cssH * 0.98;
    timelineCtx.beginPath();
    timelineCtx.moveTo(x, cssH * 0.85);
    timelineCtx.lineTo(x - halfWidth, bottomY);
    timelineCtx.lineTo(x + halfWidth, bottomY);
    timelineCtx.closePath();
    timelineCtx.fill();
  }
  if (keyframeDragState) {
    const x = timelineFrameToX(frameOf(keyframeDragState.liveTime), cssW);
    timelineCtx.fillStyle = "#ffffff";
    timelineCtx.beginPath();
    timelineCtx.moveTo(x, cssH * 0.78);
    timelineCtx.lineTo(x - 6, cssH * 1.0);
    timelineCtx.lineTo(x + 6, cssH * 1.0);
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

// ---------- タイムラインの高さをドラッグで伸縮 ----------
// 4分割ビューとタイムラインの境界(#timelineResizeHandle)をドラッグすると、
// タイムライン全体の高さを変更できる。タイムライン内のFrame/Time表示・
// ボタン群の高さ(「chrome」部分)は変化させず、キャンバス部分の高さだけを
// 伸縮することで、既存のUI要素(ボタン等)のレイアウトは常に維持される
const appRootEl = document.getElementById("appRoot");
const timelineDock = document.getElementById("timelineDock");
const timelineResizeHandle = document.getElementById("timelineResizeHandle");
const TIMELINE_MIN_CANVAS_PX = 20; // どれだけ縮めても、タイムライン操作領域はこの高さを下回らない
const TIMELINE_MIN_VIEWPORT_PX = 160; // 4分割ビュー側に必ず残す最小高さ

// タイムラインキャンバス以外(Frame/Time表示・ボタン群・上下パディング)の
// 高さは、ページ読み込み時の自然なレイアウト(この時点ではまだ伸縮操作が
// 行われていない既定のCSSレイアウト)から一度だけ測っておく。この部分の
// 内容自体は高さ変更の影響を受けないため、以後は定数として扱って良い
const timelineChromePx = timelineDock.getBoundingClientRect().height - timelineCanvas.getBoundingClientRect().height;
let timelineHeight = timelineDock.getBoundingClientRect().height; // 初期値=現状の自然な高さ(見た目を変えない)

function clampTimelineHeight(h) {
  const min = timelineChromePx + TIMELINE_MIN_CANVAS_PX;
  const max = Math.max(min, Math.min(appRootEl.clientHeight - TIMELINE_MIN_VIEWPORT_PX, appRootEl.clientHeight * 0.6));
  return Math.max(min, Math.min(max, h));
}

function applyTimelineHeight(h) {
  timelineHeight = clampTimelineHeight(h);
  timelineDock.style.height = `${timelineHeight}px`;
  timelineCanvas.style.height = `${timelineHeight - timelineChromePx}px`;
  // タイムラインの高さが変わると#viewportArea(4分割ビュー)の実サイズも
  // flexboxによって変化するため、レンダラー・各カメラ・4分割レイアウトも
  // 同期して更新する(resizeはこのファイルの末尾で定義されているが、
  // 関数宣言はホイストされるためここから呼び出せる)
  resize();
  drawTimelineRuler();
}

let timelineResizeDrag = null; // { startClientY, startHeight }
function onTimelineResizePointerDown(evt) {
  timelineResizeHandle.setPointerCapture(evt.pointerId);
  timelineResizeDrag = { startClientY: evt.clientY, startHeight: timelineHeight };
}
function onTimelineResizePointerMove(evt) {
  if (!timelineResizeDrag) return;
  // 境界を上方向(clientYが減る方向)へドラッグするとタイムラインを拡大、
  // 下方向(clientYが増える方向)へドラッグすると縮小する
  const dy = evt.clientY - timelineResizeDrag.startClientY;
  applyTimelineHeight(timelineResizeDrag.startHeight - dy);
}
function onTimelineResizePointerUp() {
  timelineResizeDrag = null;
}
timelineResizeHandle.addEventListener("pointerdown", onTimelineResizePointerDown);
timelineResizeHandle.addEventListener("pointermove", onTimelineResizePointerMove);
timelineResizeHandle.addEventListener("pointerup", onTimelineResizePointerUp);
timelineResizeHandle.addEventListener("pointercancel", () => { timelineResizeDrag = null; });

// 画面回転・ウィンドウサイズ変更時も、新しい画面サイズに応じて高さの
// 上限/下限を再計算し、現在の高さをクランプし直す
window.addEventListener("resize", () => applyTimelineHeight(timelineHeight));

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

// ---------- キーフレーム♦のドラッグ移動 ----------
// 「キーフレームの確認・選択・ドラッグ移動を最優先の操作とする」という
// 要件のため、タイムライン上でのpointerdownは、まず既存キーフレームの
// 近く(見た目のマーカーそのものより十分広い当たり判定)かどうかを
// 判定し、該当すればスクラブ(現在位置の移動)ではなくキーフレームの
// ドラッグ移動として扱う
const KEYFRAME_HIT_PX = 14; // 見た目のマーカー(幅8px程度)よりかなり広いタップ許容範囲

function findKeyframeNearClientX(clientX) {
  const cssW = timelineCanvas.clientWidth;
  const rect = timelineCanvas.getBoundingClientRect();
  const x = clientX - rect.left;
  let nearest = null;
  let nearestDist = Infinity;
  for (const kf of poseKeyframes) {
    const kx = timelineFrameToX(frameOf(kf.time), cssW);
    const dist = Math.abs(kx - x);
    if (dist <= KEYFRAME_HIT_PX && dist < nearestDist) {
      nearest = kf;
      nearestDist = dist;
    }
  }
  return nearest;
}

// ドラッグ先の時刻を、タイムラインの範囲内にクランプした上でフレーム単位に
// スナップする(moveKeyframeと、そのUndo用情報を集める側の両方から使う
// ため、計算式を1箇所にまとめている)
function clampSnapTime(targetTime) {
  const maxTime = TOTAL_FRAMES / FPS;
  return timeOfFrame(frameOf(Math.max(0, Math.min(maxTime, targetTime))));
}

// ドラッグ先の時刻にスナップし、既存キーフレームと重複する場合は
// (手動でのキーフレーム上書き保存と同じルールで)そちらを置き換える形で
// 移動を確定する。pose・modelPositionの両方をまとめて運ぶことで、
// POSE/MOVEどちらか一方だけのキーフレームも、両方持つキーフレームも
// 内容を失わずに移動できる
function moveKeyframe(originalTime, targetTime, pose, modelPosition) {
  const snappedTime = clampSnapTime(targetTime);
  poseKeyframes = poseKeyframes.filter((k) => Math.abs(k.time - originalTime) > 1e-6);
  const entry = { time: snappedTime, pose, modelPosition };
  const existingIdx = poseKeyframes.findIndex((k) => Math.abs(k.time - snappedTime) < 1e-6);
  if (existingIdx >= 0) poseKeyframes[existingIdx] = entry;
  else {
    poseKeyframes.push(entry);
    poseKeyframes.sort((a, b) => a.time - b.time);
  }
  return snappedTime;
}

// ---------- Undo(元に戻す) ----------
// 直前の編集操作を1つ元に戻せるようにする。履歴は「操作ごとに、元に戻すのに
// 必要な最小限の情報だけ」を積む軽量な方式にしている(3Dモデル全体や
// メッシュを複製するような重い処理は行わない。保存する値はボーンの
// クォータニオン配列や、既存のpose/キーフレームオブジェクトへの参照のみで、
// いずれも数値の小さな配列程度のサイズしかない)。
// 対象は「実際に存在する編集操作」のみ(ボーンの回転・キーフレームの
// 追加・キーフレームの移動・キーフレームの削除・ポーズの貼り付け)。
// このアプリには現状ボーンの位置(Position)を編集する機能が無いため、
// その操作のUndoは実装していない(今回の依頼はUndo機能の追加のみで、
// 新しい編集機能は追加しないため)。
const UNDO_LIMIT = 50;
let undoStack = [];

function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  updateUndoBtnState();
}

function performUndo() {
  if (undoStack.length === 0) return false;
  const entry = undoStack.pop();
  switch (entry.type) {
    case "rotateBone": {
      const bone = boneNameToBone[entry.boneName];
      if (bone) bone.quaternion.fromArray(entry.beforeQuat);
      break;
    }
    case "pastePose": {
      applyPoseObject(entry.beforePose);
      break;
    }
    case "keyframeAdd": {
      poseKeyframes = poseKeyframes.filter((k) => Math.abs(k.time - entry.time) > 1e-6);
      if (entry.previous) {
        poseKeyframes.push(entry.previous);
        poseKeyframes.sort((a, b) => a.time - b.time);
      }
      selectedKeyframeTime = entry.previous ? entry.time : null;
      setCurrentTime(entry.time);
      if (!posePlaying) applyPoseAtTime(entry.time);
      break;
    }
    case "keyframeMove": {
      poseKeyframes = poseKeyframes.filter((k) => Math.abs(k.time - entry.targetTime) > 1e-6);
      if (entry.replaced) poseKeyframes.push(entry.replaced);
      poseKeyframes.push({ time: entry.originalTime, pose: entry.originalPose, modelPosition: entry.originalModelPosition });
      poseKeyframes.sort((a, b) => a.time - b.time);
      selectedKeyframeTime = entry.originalTime;
      setCurrentTime(entry.originalTime);
      if (!posePlaying) applyPoseAtTime(entry.originalTime);
      break;
    }
    case "keyframeDelete": {
      poseKeyframes.push(entry.removed);
      poseKeyframes.sort((a, b) => a.time - b.time);
      selectedKeyframeTime = entry.removed.time;
      setCurrentTime(entry.removed.time);
      if (!posePlaying) applyPoseAtTime(entry.removed.time);
      break;
    }
  }
  drawTimelineRuler();
  updateUndoBtnState();
  updateDeleteKeyframeBtnState();
  return true;
}

let timelineDragging = false;
let keyframeDragState = null; // { originalTime, pose, modelPosition, liveTime }
let selectedKeyframeTime = null; // タップ/ドラッグで選択中のキーフレームの時刻(削除対象)

function onTimelinePointerDown(evt) {
  timelineCanvas.setPointerCapture(evt.pointerId);
  const hitKf = findKeyframeNearClientX(evt.clientX);
  if (hitKf) {
    keyframeDragState = { originalTime: hitKf.time, pose: hitKf.pose, modelPosition: hitKf.modelPosition, liveTime: hitKf.time };
    // 掴んだ時点でそのキーフレームを選択状態にする(タップのみでドラッグ
    // しなかった場合も、そのまま「選択してこのキーフレームを確認・削除
    // できる」状態になる)
    selectedKeyframeTime = hitKf.time;
    updateDeleteKeyframeBtnState();
    setCurrentTime(hitKf.time);
    return; // キーフレームを掴んだ場合はスクラブ(現在位置の移動)は行わない
  }
  // キーフレーム以外の場所をタップ/ドラッグした場合は選択を解除する
  selectedKeyframeTime = null;
  updateDeleteKeyframeBtnState();
  timelineDragging = true;
  setCurrentTime(timeOfFrame(frameFromClientX(evt.clientX)));
  if (!posePlaying) applyPoseAtTime(currentTime);
}
function onTimelinePointerMove(evt) {
  if (keyframeDragState) {
    // ドラッグ中は現在のフレーム位置をリアルタイムに更新する(タイムラインの
    // 赤い現在位置線・ドラッグ中マーカーの両方が指に追従する)
    keyframeDragState.liveTime = timeOfFrame(frameFromClientX(evt.clientX));
    setCurrentTime(keyframeDragState.liveTime);
    return;
  }
  if (!timelineDragging) return;
  setCurrentTime(timeOfFrame(frameFromClientX(evt.clientX)));
  if (!posePlaying) applyPoseAtTime(currentTime);
}
function onTimelinePointerUp() {
  if (keyframeDragState) {
    const { originalTime, pose, modelPosition } = keyframeDragState;
    const snappedTime = clampSnapTime(keyframeDragState.liveTime);
    // 移動先に別のキーフレームが既にある場合、そのキーフレームはmoveKeyframeに
    // よって置き換えられてしまうため、Undoで復元できるよう移動前に内容を控えておく
    const replaced = Math.abs(snappedTime - originalTime) > 1e-9
      ? poseKeyframes.find((k) => Math.abs(k.time - snappedTime) < 1e-6) || null
      : null;
    const actuallyMoved = Math.abs(snappedTime - originalTime) > 1e-9 || !!replaced;
    moveKeyframe(originalTime, keyframeDragState.liveTime, pose, modelPosition);
    if (actuallyMoved) {
      pushUndo({ type: "keyframeMove", originalTime, originalPose: pose, originalModelPosition: modelPosition, targetTime: snappedTime, replaced });
    }
    keyframeDragState = null;
    // 選択状態は、移動後のキーフレームの新しい位置に追従させる
    selectedKeyframeTime = snappedTime;
    updateDeleteKeyframeBtnState();
    setCurrentTime(snappedTime);
    if (!posePlaying) applyPoseAtTime(snappedTime);
    return;
  }
  timelineDragging = false;
}
timelineCanvas.addEventListener("pointerdown", onTimelinePointerDown);
timelineCanvas.addEventListener("pointermove", onTimelinePointerMove);
timelineCanvas.addEventListener("pointerup", onTimelinePointerUp);
timelineCanvas.addEventListener("pointercancel", () => {
  timelineDragging = false;
  keyframeDragState = null;
  drawTimelineRuler();
});
window.addEventListener("resize", drawTimelineRuler);

const keyframeBtn = document.getElementById("keyframeBtn");
const posePlayBtn = document.getElementById("posePlayBtn");
const posePauseBtn = document.getElementById("posePauseBtn");
const statusEl = document.getElementById("status");

// ---------- UI ----------
// 「お辞儀アニメーション再生」ボタンは廃止した(ポーズエディタと同じボーンを
// 奪い合うため)。書き出し用のclip/mixer/actionオブジェクト自体は
// GLB書き出しに必要なため残しているが、プレビュー再生するUIはない

keyframeBtn.addEventListener("click", () => {
  // Undoで復元できるよう、上書き保存される場合に備えてその時刻の既存
  // キーフレームを事前に控えておく(新規追加の場合はnullのまま)
  const previous = poseKeyframes.find((k) => Math.abs(k.time - currentTime) < 1e-6) || null;
  addKeyframeAt(currentTime);
  pushUndo({ type: "keyframeAdd", time: currentTime, previous });
  statusEl.textContent = `${currentTime.toFixed(2)}s に姿勢+位置のキーフレームを保存しました(全${poseKeyframes.length}個)`;
  setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 2000);
});

posePlayBtn.addEventListener("click", () => { posePlaying = true; });
posePauseBtn.addEventListener("click", () => { posePlaying = false; });

// ---------- ポーズのコピー&ペースト ----------
// コピー対象は現在フレームの全ボーンのポーズ(回転)。本アプリのFKポーズ編集は
// 回転のみを扱うため、snapshotPose/applyPoseObjectをそのまま再利用する
// (将来position/scaleを編集できるようになった場合は、ここにも含める)。
// ペーストはキーフレーム追加とは別操作であり、ペースト後に+◆を押さない限り
// タイムライン上には保存されない(他フレームへ移動すると失われる)
const copyPoseBtn = document.getElementById("copyPoseBtn");
const pastePoseBtn = document.getElementById("pastePoseBtn");
let copiedPose = null;

copyPoseBtn.addEventListener("click", () => {
  copiedPose = snapshotPose();
  pastePoseBtn.disabled = false;
  statusEl.textContent = "現在のポーズをコピーしました";
  setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 2000);
});

pastePoseBtn.addEventListener("click", () => {
  if (!copiedPose) return;
  const beforePose = snapshotPose();
  applyPoseObject(copiedPose);
  pushUndo({ type: "pastePose", beforePose });
  statusEl.textContent = "ポーズを貼り付けました(+◆で保存しないと移動時に失われます)";
  setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 2500);
});

const undoBtn = document.getElementById("undoBtn");
function updateUndoBtnState() {
  undoBtn.disabled = undoStack.length === 0;
}
undoBtn.addEventListener("click", () => {
  const didUndo = performUndo();
  if (didUndo) {
    statusEl.textContent = "元に戻しました";
    setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 1500);
  }
});

// ---------- キーフレームの削除 ----------
// タイムライン上でキーフレーム♦をタップ/ドラッグで掴むと選択状態になる
// (selectedKeyframeTime、pickGizmoRingAt等とは無関係の別概念)。選択中は
// 🗑ボタンが有効になり、押すとそのキーフレーム1つだけを削除する。削除は
// Undo対象としており、誤って削除してしまっても元に戻せる
const deleteKeyframeBtn = document.getElementById("deleteKeyframeBtn");
function updateDeleteKeyframeBtnState() {
  deleteKeyframeBtn.disabled = selectedKeyframeTime === null;
}
deleteKeyframeBtn.addEventListener("click", () => {
  if (selectedKeyframeTime === null) return;
  const idx = poseKeyframes.findIndex((k) => Math.abs(k.time - selectedKeyframeTime) < 1e-6);
  if (idx < 0) return;
  const removed = poseKeyframes[idx];
  // 削除対象のキーフレームだけを取り除く。配列の他の要素(=他の
  // キーフレーム)の内容には一切触れないため、他のキーフレームへの
  // 影響は無い
  poseKeyframes = poseKeyframes.filter((_, i) => i !== idx);
  pushUndo({ type: "keyframeDelete", removed });
  selectedKeyframeTime = null;
  updateDeleteKeyframeBtnState();
  drawTimelineRuler();
  if (!posePlaying) applyPoseAtTime(currentTime);
  statusEl.textContent = "選択したキーフレームを削除しました";
  setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 1500);
});

// 3Dモデルの書き出し(.glb)は、メッシュ・マテリアル・ボーン構造のみを
// 対象とする。アニメーション(ポーズのキーフレーム)はモデルとは別データ
// として扱うため、ここではGLTFExporterにanimationsを一切渡さない
// (= 書き出されるGLBには常にアニメーションが含まれない)
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
      statusEl.textContent = "humanoid.glb を書き出しました(モデルのみ。アニメーションは🎞から別途書き出せます)";
      setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 3000);
    },
    (err) => {
      console.error(err);
      statusEl.textContent = "書き出しに失敗しました";
    },
    { binary: true }
  );
});

// ---------- アニメーションライブラリ(3Dモデルとは別データとして保存・書き出し) ----------
// 3Dモデル(メッシュ・マテリアル・ボーン構造。root/GLB書き出し対象)と
// アニメーション(ボーン名・キーフレーム・各フレームのTransform・FPS・長さ)を
// 同一データとして扱わず、完全に別の構造として保持する。
// アニメーション側のデータはボーン名だけをキーにしており、メッシュ等
// モデル固有の情報を一切含まないため、同じボーン構成(同じボーン名)を
// 持つ別モデルにもそのまま適用できる(applyPoseObjectは、渡されたポーズに
// 存在する/モデル側に存在するボーン名同士だけを照合して適用するため、
// ボーン構成が完全一致していなくても、共通するボーンだけに安全に適用される)。
//
// このアプリの既存タイムラインUIは30FPS・60フレーム固定のまま変更していない
// (「既存のUIは変更しない」という要件のため)。保存・書き出されるアニメーション
// データ自体にはfps/totalFramesを記録しておき、将来的に可変長のタイムラインへ
// 拡張できるようにしてある。インポート時に60フレームを超えるキーフレームは
// 末尾でクランプする
let animations = []; // [{ name, fps, totalFrames, keyframes: [{ time, pose }] }]

function currentAnimationData(name) {
  return {
    name,
    fps: FPS,
    totalFrames: TOTAL_FRAMES,
    keyframes: poseKeyframes.map((k) => ({ time: k.time, pose: k.pose, modelPosition: k.modelPosition || null })),
  };
}

function loadAnimationData(anim) {
  const maxTime = TOTAL_FRAMES / FPS;
  poseKeyframes = (anim.keyframes || [])
    .map((k) => ({ time: Math.max(0, Math.min(maxTime, k.time)), pose: k.pose || null, modelPosition: k.modelPosition || null }))
    .sort((a, b) => a.time - b.time);
  setCurrentTime(0);
  modelTransform.position.set(0, 0, 0);
  applyPoseAtTime(0);
}

function refreshAnimSelect() {
  animSelectEl.innerHTML = "";
  if (animations.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(保存されたアニメーションなし)";
    animSelectEl.appendChild(opt);
    return;
  }
  for (const anim of animations) {
    const opt = document.createElement("option");
    opt.value = anim.name;
    opt.textContent = anim.name;
    animSelectEl.appendChild(opt);
  }
}

function saveCurrentAsAnimation(name) {
  const data = currentAnimationData(name);
  const existingIdx = animations.findIndex((a) => a.name === name);
  if (existingIdx >= 0) animations[existingIdx] = data;
  else animations.push(data);
  refreshAnimSelect();
  animSelectEl.value = name;
}

function animationToExportJSON(anim) {
  return {
    formatVersion: 1,
    type: "humanoid-pose-animation",
    name: anim.name,
    fps: anim.fps,
    totalFrames: anim.totalFrames,
    durationSeconds: anim.totalFrames / anim.fps,
    boneNames: allBones.map((b) => b.name),
    keyframes: anim.keyframes.map((k) => ({ frame: Math.round(k.time * anim.fps), time: k.time, pose: k.pose, modelPosition: k.modelPosition || null })),
  };
}

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importAnimationJSON(json) {
  loadAnimationData({ keyframes: (json.keyframes || []).map((k) => ({ time: k.time ?? k.frame / (json.fps || FPS), pose: k.pose || null, modelPosition: k.modelPosition || null })) });
  if (json.name) {
    saveCurrentAsAnimation(json.name);
    animNameInputEl.value = json.name;
  }
}

const animMenuBtn = document.getElementById("animMenuBtn");
const animPanelEl = document.getElementById("animPanel");
const animNameInputEl = document.getElementById("animNameInput");
const animSelectEl = document.getElementById("animSelect");
const animSaveBtn = document.getElementById("animSaveBtn");
const animLoadBtn = document.getElementById("animLoadBtn");
const animExportBtn = document.getElementById("animExportBtn");
const animImportBtn = document.getElementById("animImportBtn");
const animImportFileEl = document.getElementById("animImportFile");

animMenuBtn.addEventListener("click", () => {
  animPanelEl.classList.toggle("open");
  animMenuBtn.classList.toggle("active", animPanelEl.classList.contains("open"));
});

animSaveBtn.addEventListener("click", () => {
  const name = animNameInputEl.value.trim();
  if (!name) {
    statusEl.textContent = "アニメーション名を入力してください";
    setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 2000);
    return;
  }
  saveCurrentAsAnimation(name);
  statusEl.textContent = `アニメーション「${name}」を保存しました(モデルとは別データ)`;
  setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 2500);
});

animLoadBtn.addEventListener("click", () => {
  const anim = animations.find((a) => a.name === animSelectEl.value);
  if (!anim) return;
  loadAnimationData(anim);
  animNameInputEl.value = anim.name;
  statusEl.textContent = `アニメーション「${anim.name}」をタイムラインへ読み込みました`;
  setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 2500);
});

animExportBtn.addEventListener("click", () => {
  const name = animNameInputEl.value.trim() || "animation";
  const json = animationToExportJSON(currentAnimationData(name));
  downloadJSON(json, `${name}.json`);
  statusEl.textContent = `${name}.json を書き出しました(3Dモデルとは別ファイル)`;
  setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 2500);
});

animImportBtn.addEventListener("click", () => animImportFileEl.click());
animImportFileEl.addEventListener("change", async () => {
  const file = animImportFileEl.files && animImportFileEl.files[0];
  animImportFileEl.value = "";
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    importAnimationJSON(json);
    statusEl.textContent = `「${json.name || file.name}」を読み込みました`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "アニメーションJSONの読み込みに失敗しました";
  }
  setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 2500);
});

refreshAnimSelect();

// ---------- 同梱アニメーション(assets/animations/<名前>.json) ----------
// 書き出しと同じ形式のJSONをアプリに同梱しておき、起動時にアニメーション
// 管理パネルの一覧へ追加する(📂でタイムラインへ読込→▶で再生→📤で書き出し)。
// index.html?anim=<名前> を開いた場合は、そのアニメーションを最初から
// タイムラインへ読み込み、アニメーション名欄にも名前を入れておく
// (そのまま📤を押すと <名前>.json として書き出せる)
const BUILTIN_ANIMATIONS = ["leftPunch", "leftPunch1"];
// 初期モデルの読み込み(?model=指定時は非同期)が終わる前にアニメーションを
// タイムラインへ読み込むと、モデル差し替え時のclearCurrentModelでキーフレームが
// 消えてしまうため、?anim=の読み込みはモデルの準備完了を待ってから行う
let resolveInitialModelReady;
const initialModelReady = new Promise((resolve) => { resolveInitialModelReady = resolve; });
const initialAnimName = new URLSearchParams(location.search).get("anim");
for (const animName of BUILTIN_ANIMATIONS) {
  fetch(`./assets/animations/${animName}.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`${animName}.json: ${res.status}`);
      return res.json();
    })
    .then((json) => {
      const fps = json.fps || FPS;
      const anim = {
        name: json.name || animName,
        fps,
        totalFrames: json.totalFrames || TOTAL_FRAMES,
        keyframes: (json.keyframes || []).map((k) => ({ time: k.time ?? k.frame / fps, pose: k.pose || null, modelPosition: k.modelPosition || null })),
      };
      if (!animations.some((a) => a.name === anim.name)) animations.push(anim);
      refreshAnimSelect();
      if (initialAnimName === anim.name) return initialModelReady.then(() => {
        loadAnimationData(anim);
        animSelectEl.value = anim.name;
        animNameInputEl.value = anim.name;
        statusEl.textContent = `アニメーション「${anim.name}」を読み込みました(▶で再生)`;
        setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 3000);
      });
    })
    .catch((err) => console.error("同梱アニメーションの読み込みに失敗しました", err));
}

// ---------- GLBインポート(モデルの差し替え) ----------
// 読み込んだGLBのボーン名・本数が今のモデルと一致していなくても、
// applyPoseObject等が存在するボーン名だけを安全に適用する既存の仕組み
// (「別モデルへの再利用を見据えた設計」を参照)があるため、ここでは
// 特にボーン構成の互換性チェックは行わない。読み込みに成功したら
// 現在のモデル(ボクサー、または以前に読み込んだ別のモデル)を完全に
// 差し替える
const importModelBtn = document.getElementById("importModelBtn");
const importModelFileEl = document.getElementById("importModelFile");
const resetModelBtn = document.getElementById("resetModelBtn");
const gltfLoader = new GLTFLoader();

importModelBtn.addEventListener("click", () => importModelFileEl.click());
importModelFileEl.addEventListener("change", async () => {
  const file = importModelFileEl.files && importModelFileEl.files[0];
  importModelFileEl.value = "";
  if (!file) return;
  statusEl.textContent = `「${file.name}」を読み込み中...`;
  try {
    const buffer = await file.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => {
      gltfLoader.parse(buffer, "", resolve, reject);
    });
    loadModelFromGLTFScene(gltf.scene);
    statusEl.textContent = `「${file.name}」を読み込みました(ボーン${allBones.length}本)`;
  } catch (err) {
    console.error("GLBモデルの読み込みに失敗しました", err);
    statusEl.textContent = err && err.message
      ? `読み込めませんでした: ${err.message}`
      : "GLBモデルの読み込みに失敗しました";
    setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 6000);
    return;
  }
  setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 3000);
});

resetModelBtn.addEventListener("click", () => loadBoxerModel());

// ---------- リサイズ ----------
// レンダラーのサイズは、ウィンドウ全体ではなく#viewportArea(3Dビュー専用領域、
// タイムラインドックを除いた残り全体)の実サイズに合わせる。これにより
// タイムラインと3Dビューは常に重ならない
function resize() {
  const w = viewportArea.clientWidth, h = viewportArea.clientHeight;
  renderer.setSize(w, h);
  layoutViews();
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();
setCurrentTime(0); // 初期状態のフレーム表示・目盛を描画しておく
updateUndoBtnState(); // 初期状態ではUndo履歴が空のためボタンを無効化しておく
updateDeleteKeyframeBtnState(); // 初期状態ではキーフレーム未選択のためボタンを無効化しておく
// ---------- URLパラメータでリグ済みモデルを開く(?model=box_usa など) ----------
// tools/tpose_rig.py でボーンを入れたGLBを assets/<名前>_rigged.glb に置いておくと、
// index.html?model=<名前> を開くだけで、📥でファイルを選ばなくても最初から
// そのモデルを読み込んだ状態で始められる(読み込み処理自体は📥と同じ)。
// ボクサーのパーツ読み込み(fetch)と並行させると、後から届いたボクサーの
// パーツが差し替え後のモデルに混ざってしまうため、指定があるときは
// ボクサーを読み込まない(読み込みに失敗した場合だけボクサーに戻す)
const initialModelName = new URLSearchParams(location.search).get("model");
if (initialModelName && /^[\w-]+$/.test(initialModelName)) {
  const url = `./assets/${initialModelName}_rigged.glb`;
  statusEl.textContent = `「${initialModelName}」を読み込み中...`;
  fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buffer) => new Promise((resolve, reject) => gltfLoader.parse(buffer, "", resolve, reject)))
    .then((gltf) => {
      loadModelFromGLTFScene(gltf.scene);
      statusEl.textContent = `「${initialModelName}」を読み込みました(ボーン${allBones.length}本)`;
    })
    .catch((err) => {
      console.error("リグ済みモデルの読み込みに失敗しました", err);
      loadBoxerModel();
      statusEl.textContent = `「${initialModelName}」の読み込みに失敗しました`;
    })
    .then(() => resolveInitialModelReady())
    .finally(() => setTimeout(() => { statusEl.textContent = "タップでボーン選択・ドラッグで回転"; }, 3000));
} else {
  loadBoxerModel(); // 初期表示は従来通りボクサーモデル
  resolveInitialModelReady();
}

// ---------- レンダーループ(4分割ビューを同じシーンに対して順に描画) ----------
const VIEW_ORDER = ["top", "front", "left", "free"];
const clock = new THREE.Clock();
function render() {
  const dt = clock.getDelta();

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
// skeleton/allBonesはGLBインポート/ボクサーへの差し替えのたびに作り
// 直される(let)ため、スナップショットではなくgetterで常に最新の値を返す
window.__scene = {
  scene, camera, root, modelTransform, cursorMarker,
  get skeleton() { return skeleton; },
  get allBones() { return allBones; },
};
// モデル書き出し(メッシュ・マテリアル・ボーン構造のみ。アニメーションは含まない)
window.__exportGLTF = () => new Promise((resolve, reject) => {
  const exporter = new GLTFExporter();
  exporter.parse(root, resolve, reject, { binary: true });
});

// ---------- GLBインポート/モデル差し替えのテスト/デバッグ用フック ----------
window.__model = {
  getBoneNames: () => allBones.map((b) => b.name),
  getBoneCount: () => allBones.length,
  isHingeBoneName: (name) => !!hingeAxisByBoneName[name],
  getSideAxisWorld: () => SIDE_AXIS_WORLD.toArray(),
  resetToBoxer: () => loadBoxerModel(),
  // ポインタ操作(ファイル選択ダイアログ)を介さず、ArrayBufferを直接
  // 渡してGLBを読み込む決定論的なテスト用の経路
  loadGLBArrayBuffer: (buffer) => new Promise((resolve, reject) => {
    gltfLoader.parse(buffer, "", (gltf) => {
      try {
        loadModelFromGLTFScene(gltf.scene);
        resolve({ boneNames: allBones.map((b) => b.name), meshCount: allMeshes.length });
      } catch (err) {
        reject(err);
      }
    }, reject);
  }),
  isImportBtnPresent: () => !!importModelBtn,
  isResetBtnPresent: () => !!resetModelBtn,
};

// ---------- ポーズエディタのテスト/デバッグ用フック ----------
window.__fk = {
  // boneNameToBoneはモデル読み込みのたびに作り直される(let)ため、
  // スナップショットではなくgetterで常に最新の値を返す
  get boneNameToBone() { return boneNameToBone; },
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
  getKeyframes: () => poseKeyframes.map((k) => ({ time: k.time, pose: k.pose, modelPosition: k.modelPosition })),
  clearKeyframes: () => { poseKeyframes = []; },
  setPosePlaying: (v) => { posePlaying = v; },
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
  // viewKeyを省略した場合は'free'(3軸とも有効)として扱う
  getActiveRingKeys: (viewKey) => activeGizmoRings(viewKey || "free").map((r) => r.key),
  easyAxisForView,
  getSideAxisWorld: () => SIDE_AXIS_WORLD.toArray(),
  pickGizmoRingAt,
  isRingHitProxyVisible: (axisKey) => ringByAxisKey[axisKey].group.visible,
  getRingWorldPosition: (axisKey) => {
    if (!ringByAxisKey[axisKey] || !ringByAxisKey[axisKey].group.visible) return null;
    const center = new THREE.Vector3();
    selectedBone.getWorldPosition(center);
    const axisWorld = ringLocalAxis(axisKey).applyQuaternion(selectedBone.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const arbitrary = Math.abs(axisWorld.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const refA = new THREE.Vector3().crossVectors(arbitrary, axisWorld).normalize();
    return center.clone().addScaledVector(refA, RING_RADIUS).toArray();
  },
  isRingDragActive: () => !!activeRingDrag,
  // レイアウト分離(3Dビュー/タイムライン)のテスト/デバッグ用
  getViewportAreaRect: () => viewportArea.getBoundingClientRect().toJSON(),
  getTimelineDockRect: () => document.getElementById("timelineDock").getBoundingClientRect().toJSON(),
  // ポーズのコピー&ペーストのテスト/デバッグ用
  copyPose: () => copyPoseBtn.click(),
  pastePose: () => pastePoseBtn.click(),
  hasCopiedPose: () => !!copiedPose,
  getCopiedPose: () => copiedPose,
  isPasteBtnDisabled: () => pastePoseBtn.disabled,
  // アニメーションライブラリ(3Dモデルとは別データ)のテスト/デバッグ用
  saveCurrentAsAnimation,
  loadAnimationByName: (name) => {
    const anim = animations.find((a) => a.name === name);
    if (anim) loadAnimationData(anim);
    return !!anim;
  },
  listAnimationNames: () => animations.map((a) => a.name),
  exportAnimationJSON: (name) => {
    const anim = animations.find((a) => a.name === name) || currentAnimationData(name || "animation");
    return animationToExportJSON(anim);
  },
  importAnimationJSON,
  isAnimPanelOpen: () => animPanelEl.classList.contains("open"),
  toggleAnimPanel: () => animMenuBtn.click(),
  // タイムラインのレイアウト・キーフレームドラッグのテスト/デバッグ用
  getTimelineButtonsRect: () => document.getElementById("timelineButtons").getBoundingClientRect().toJSON(),
  getTimelineCanvasRect: () => timelineCanvas.getBoundingClientRect().toJSON(),
  frameToClientX: (frame) => {
    const rect = timelineCanvas.getBoundingClientRect();
    return rect.left + timelineFrameToX(frame, timelineCanvas.clientWidth);
  },
  findKeyframeNearClientX,
  isKeyframeDragActive: () => !!keyframeDragState,
  getKeyframeDragLiveFrame: () => (keyframeDragState ? frameOf(keyframeDragState.liveTime) : null),
  // Undo(元に戻す)のテスト/デバッグ用
  undo: () => undoBtn.click(),
  canUndo: () => !undoBtn.disabled,
  getUndoStackSize: () => undoStack.length,
  peekUndoType: () => (undoStack.length > 0 ? undoStack[undoStack.length - 1].type : null),
  // キーフレームの選択・削除のテスト/デバッグ用
  getSelectedKeyframeFrame: () => (selectedKeyframeTime === null ? null : frameOf(selectedKeyframeTime)),
  deleteSelectedKeyframe: () => deleteKeyframeBtn.click(),
  isDeleteKeyframeBtnDisabled: () => deleteKeyframeBtn.disabled,
  // POSE/MOVEモードのテスト/デバッグ用
  getEditMode: () => editMode,
  setEditMode,
  getModelTransformPosition: () => modelTransform.position.toArray(),
  isOrbitControlsEnabled: () => controls.enabled,
  // 3Dカーソル(基準点)のテスト/デバッグ用
  getCursorPosition: () => ({ ...cursorPosition }),
  setCursorPosition,
  placeCursorAt,
  isCursorMarkerVisible: () => cursorMarker.visible,
  // タイムラインの高さ伸縮のテスト/デバッグ用
  getTimelineHeight: () => timelineHeight,
  getTimelineChromePx: () => timelineChromePx,
  getTimelineMinMaxHeight: () => ({
    min: timelineChromePx + TIMELINE_MIN_CANVAS_PX,
    max: Math.max(
      timelineChromePx + TIMELINE_MIN_CANVAS_PX,
      Math.min(appRootEl.clientHeight - TIMELINE_MIN_VIEWPORT_PX, appRootEl.clientHeight * 0.6)
    ),
  }),
  setTimelineHeight: applyTimelineHeight,
  getTimelineResizeHandleRect: () => timelineResizeHandle.getBoundingClientRect().toJSON(),
  getViewportAreaClientHeight: () => viewportArea.clientHeight,
};
