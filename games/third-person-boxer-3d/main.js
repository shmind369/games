import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

// ---------- 左右スワイプでの回避移動(Three.js非依存の純粋関数) ----------
const NEUTRAL_X = 0;
const DODGE_X = 0.55;
const OUT_MS = 140;
const RETURN_MS = 260;
const FAST_RETURN_MS = 110;

const SWIPE_THRESHOLD_PX = 30;
const SWIPE_MAX_MS = 500;

// dx/dy/dt(ポインターの移動量と経過時間)からスワイプ方向を判定する。
// 横方向の移動が縦方向より十分大きい場合は左右スワイプとみなす。
// 縦方向のスワイプは、以前は下スワイプ=しゃがみ込みだったが、今後の攻撃操作と
// 競合するおそれがあるため廃止した(nullを返す)
function classifySwipe(dx, dy, dt) {
  if (dt > SWIPE_MAX_MS) return null;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx >= SWIPE_THRESHOLD_PX && adx > ady * 1.2) {
    return dx < 0 ? "left" : "right";
  }
  return null;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function easeOutCubic(t) { const p = clamp01(t); return 1 - Math.pow(1 - p, 3); }

function createDodgeState() {
  return { side: null, phase: null, fromX: NEUTRAL_X, toX: NEUTRAL_X, startAt: 0, durationMs: 0 };
}

// スワイプ入力を受けて次のドジ状態を返す。
// 逆方向のスワイプが「ディフェンス中」(out/return いずれかの最中)に来た場合は、
// ニュートラルへの復帰(return)を通常より速いdurationで即座に開始する
function onSwipe(state, direction, now, currentX) {
  if (state.side && state.phase && state.side !== direction) {
    return { side: state.side, phase: "return", fromX: currentX, toX: NEUTRAL_X, startAt: now, durationMs: FAST_RETURN_MS };
  }
  const toX = direction === "left" ? -DODGE_X : DODGE_X;
  return { side: direction, phase: "out", fromX: currentX, toX, startAt: now, durationMs: OUT_MS };
}

// 現在時刻がdurationを過ぎていたら次のフェーズへ遷移させる
// (out完了→return開始、return完了→ニュートラルで停止)
function advanceDodge(state, now) {
  if (!state.phase) return state;
  const elapsed = now - state.startAt;
  if (elapsed < state.durationMs) return state;
  if (state.phase === "out") {
    return { side: state.side, phase: "return", fromX: state.toX, toX: NEUTRAL_X, startAt: now, durationMs: RETURN_MS };
  }
  return createDodgeState();
}

function computeDodgeX(state, now) {
  if (!state.phase) return NEUTRAL_X;
  const t = easeOutCubic((now - state.startAt) / state.durationMs);
  return state.fromX + (state.toX - state.fromX) * t;
}

// 回避姿勢(上半身の傾き・腰落とし・膝の曲げ)を駆動するための正規化された
// 進行度。-1(左いっぱい)〜0(ニュートラル)〜+1(右いっぱい)を返す。
// X移動と同じdodgeStateから導出するため、常にX移動と同期する
function computeDodgeProgress(state, now) {
  return computeDodgeX(state, now) / DODGE_X;
}

// 回避姿勢のパラメータ。progress(-1〜1)の符号が回避方向、絶対値が
// 「どれだけ深く回避姿勢に入っているか」を表す
const MAX_LEAN_Z = 0.5; // 上半身を回避方向へ傾ける角度(ラジアン)
const MAX_LEAN_X = 0.16; // 上半身を前へかがめる角度(パンチをかわす前傾)
const MAX_CROUCH_DROP = 0.11; // 腰を落とす量
const MAX_HIP_BEND = 0.5; // 股関節を曲げる角度(前へ)
const KNEE_COUNTER = 1.55; // 膝で打ち消す係数(足が浮き上がらないよう、股関節より大きく逆方向に曲げる)

function computeDodgePosture(progress) {
  const mag = Math.abs(progress);
  return {
    leanZ: progress * MAX_LEAN_Z,
    leanX: mag * MAX_LEAN_X,
    crouchDrop: mag * MAX_CROUCH_DROP,
    hipBend: mag * MAX_HIP_BEND,
    kneeBend: -mag * MAX_HIP_BEND * KNEE_COUNTER,
  };
}

// ---------- アイドル状態(常時構え)でループ再生するクリップ ----------
// humanoid-gltf-exporterで作成した、両腕を構えたボクシングのガードポーズ
// アニメーション。先頭(time=0)と末尾(time=1.333...秒)の姿勢・位置が
// 完全に一致しているため、末尾から先頭へそのままループさせても
// 継ぎ目(ポーズの飛び)が発生しない
const IDLE_CLIP = {
  keyframes: [
    {
      time: 0,
      pose: {
        Hips: [-0.04842264996522426, -0.24941858804105652, -0.012488328193081991, 0.9671037465385465],
        Spine: [0.08414530459210005, 0, 0, 0.9964534950087248], Chest: [0, 0, 0, 1], Neck: [0, 0, 0, 1], Head: [0, 0, 0, 1],
        LeftShoulder: [0, 0, 0, 1], LeftUpperArm: [-0.5227817586896102, 0, 0, 0.8524665581601417],
        LeftForearm: [0.7694078993313046, 0, 0, -0.6387577666428714], LeftHand: [0, 0, 0, 1],
        RightShoulder: [0.07150273705091792, 0.3494341390607078, -0.18728522048578872, 0.9152635616262229],
        RightUpperArm: [-0.5412665217663173, 0, 0, 0.8408510881333227],
        RightForearm: [-0.7288168373837771, 0, 0, 0.6847087099971119], RightHand: [0, 0, 0, 1],
        LeftUpperLeg: [-0.24950254146038775, 0.12167020706280558, 0.13173444128486084, 0.9516253882161125],
        LeftLowerLeg: [0.3318099345747083, 0, 0, 0.9433462605626461], LeftFoot: [0, 0, 0, 1],
        RightUpperLeg: [0.08670532327429584, 0.1583461580516255, -0.10766720648910869, 0.9776586591408178],
        RightLowerLeg: [0.34144127400634583, 0, 0, 0.9399031101155711],
        RightFoot: [-0.43481250254054554, 0, 0, 0.9005210089911441],
      },
      modelPosition: [6.399781846210084e-19, -0.09223057644110243, 0.00288220551378442],
    },
    {
      time: 0.7666666666666667,
      pose: {
        Hips: [-0.01961155453880588, -0.24967981163842193, -0.005057871257211775, 0.9681166234122413],
        Spine: [0.12373336335538015, -0.05672298058888147, -0.04396848980232421, 0.989716792911175], Chest: [0, 0, 0, 1], Neck: [0, 0, 0, 1], Head: [0, 0, 0, 1],
        LeftShoulder: [0, 0, 0, 1], LeftUpperArm: [-0.5227817586896102, 0, 0, 0.8524665581601417],
        LeftForearm: [0.7694078993313048, 0, 0, -0.6387577666428715], LeftHand: [0, 0, 0, 1],
        RightShoulder: [0.07150273705091792, 0.3494341390607078, -0.18728522048578872, 0.9152635616262229],
        RightUpperArm: [-0.5412665217663173, 0, 0, 0.8408510881333227],
        RightForearm: [-0.7288168373837771, 0, 0, 0.6847087099971119], RightHand: [0, 0, 0, 1],
        LeftUpperLeg: [-0.3143984497686581, 0.11231628451154163, 0.13979504476505192, 0.9321995561443506],
        LeftLowerLeg: [-0.4021841959584104, 0, 0, -0.9155587761150493], LeftFoot: [0, 0, 0, 1],
        RightUpperLeg: [0.08670532327429584, 0.1583461580516255, -0.10766720648910869, 0.9776586591408178],
        RightLowerLeg: [0.34144127400634583, 0, 0, 0.9399031101155711],
        RightFoot: [-0.43481250254054554, 0, 0, 0.9005210089911441],
      },
      modelPosition: [0.0021761128031455063, -0.10081066625099666, 0.04925439032807323],
    },
    {
      time: 1.3333333333333333,
      pose: {
        Hips: [-0.04842264996522426, -0.24941858804105652, -0.012488328193081991, 0.9671037465385465],
        Spine: [0.08414530459210005, 0, 0, 0.9964534950087248], Chest: [0, 0, 0, 1], Neck: [0, 0, 0, 1], Head: [0, 0, 0, 1],
        LeftShoulder: [0, 0, 0, 1], LeftUpperArm: [-0.5227817586896102, 0, 0, 0.8524665581601417],
        LeftForearm: [0.7694078993313046, 0, 0, -0.6387577666428714], LeftHand: [0, 0, 0, 1],
        RightShoulder: [0.07150273705091792, 0.3494341390607078, -0.18728522048578872, 0.9152635616262229],
        RightUpperArm: [-0.5412665217663173, 0, 0, 0.8408510881333227],
        RightForearm: [-0.7288168373837771, 0, 0, 0.6847087099971119], RightHand: [0, 0, 0, 1],
        LeftUpperLeg: [-0.24950254146038775, 0.12167020706280558, 0.13173444128486084, 0.9516253882161125],
        LeftLowerLeg: [0.3318099345747083, 0, 0, 0.9433462605626461], LeftFoot: [0, 0, 0, 1],
        RightUpperLeg: [0.08670532327429584, 0.1583461580516255, -0.10766720648910869, 0.9776586591408178],
        RightLowerLeg: [0.34144127400634583, 0, 0, 0.9399031101155711],
        RightFoot: [-0.43481250254054554, 0, 0, 0.9005210089911441],
      },
      modelPosition: [6.399781846210084e-19, -0.09223057644110243, 0.00288220551378442],
    },
  ],
};
const IDLE_LOOP_DURATION = IDLE_CLIP.keyframes[IDLE_CLIP.keyframes.length - 1].time;

// 現在時刻(ミリ秒)から、アイドルループの再生時刻(0〜IDLE_LOOP_DURATION秒)
// を求める。先頭と末尾の姿勢が一致しているため、単純に時刻を
// IDLE_LOOP_DURATIONで割った余りを取るだけでシームレスにループする
function computeIdleClipTime(nowMs) {
  return (nowMs / 1000) % IDLE_LOOP_DURATION;
}

// 指定した時刻を挟む2つのキーフレーム(と補間係数alpha)を求める汎用ヘルパー。
// humanoid-gltf-exporter側のfindBoundingKeyframesと同じ考え方で、POSEトラック
// (pose!=nullのエントリ)とMOVEトラック(modelPosition!=nullのエントリ)を
// それぞれ独立に補間できるようにしている
function findBoundingKeyframes(list, time) {
  if (list.length === 0) return null;
  const first = list[0], last = list[list.length - 1];
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

// クリップを指定した時刻でサンプリングし、{ pose: {ボーン名: THREE.Quaternion},
// modelPosition: [x,y,z] }を返す(POSEはslerp、MOVEはlerpで補間する)
function sampleClip(clip, time) {
  const poseTrack = clip.keyframes.filter((k) => k.pose);
  const moveTrack = clip.keyframes.filter((k) => k.modelPosition);
  const pose = {};
  const pb = findBoundingKeyframes(poseTrack, time);
  if (pb) {
    for (const name of Object.keys(pb.k0.pose)) {
      const q0 = pb.k0.pose[name], q1 = pb.k1.pose[name];
      if (!q0 || !q1) continue;
      const a = new THREE.Quaternion(q0[0], q0[1], q0[2], q0[3]);
      const b = new THREE.Quaternion(q1[0], q1[1], q1[2], q1[3]);
      a.slerp(b, pb.alpha);
      pose[name] = a;
    }
  }
  let modelPosition = [0, 0, 0];
  const mb = findBoundingKeyframes(moveTrack, time);
  if (mb) {
    const p0 = mb.k0.modelPosition, p1 = mb.k1.modelPosition;
    modelPosition = [0, 1, 2].map((i) => p0[i] + (p1[i] - p0[i]) * mb.alpha);
  }
  return { pose, modelPosition };
}

// 参照画像(スーパーパンチアウト風)の構図を再現するためのカメラパラメータ。
// 手前に背中を向けたプレイヤー(頭が画面の中ほど、腰より上が映る)、その奥に
// 向かい合う相手(頭が画面の上のほう、プレイヤーの約半分の大きさ)が並んで見えるよう、
// カメラを高めに置いて見下ろす。プレイヤーの頭・相手の頭・プレイヤーの腰の
// 画面上の高さが参照画像に近づくよう、距離と高さと角度を計算して決めた
// (縦FOV42°で、頭頂が画面の約46%・約24%の位置、プレイヤーの腰が約82%の位置。
// 相手はプレイヤーの約1.0m先にいて、左ジャブが届く距離。画面上の大きさはプレイヤーの約6割)。
// キャラクターは原点に立ち、背中をカメラ側(+Z)に向けている(-Z方向を向く)。
const CAMERA_FOV_DEG = 42;
const CAMERA_HEIGHT = 2.7;
const CAMERA_DISTANCE = 1.7;
const LOOK_AT_HEIGHT = 1.68;

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

// ---------- キャラクター(humanoid-gltf-exporterで書き出した、ボーン入りGLBを読み込む) ----------
// 参照画像(スーパーパンチアウト風)の構図に合わせて、2人のボクサーを向かい合わせに配置する。
//  ・手前(プレイヤー): 赤パンのボクサー(boxer_rigged.glb)。背中をカメラ(+Z)に向けて原点に立つ
//  ・奥(相手): USAボクサー(box_usa_rigged.glb)。プレイヤーの正面(-Z側)に、カメラ側(+Z)を向いて立つ
// どちらも19本のボーン(Hips/Spine/.../RightFoot)を持つ同じ構成のモデルで、ボーン名で
// 回転を適用できる。回避の姿勢制御(腰を支点にした上半身の傾き、股関節・膝の曲げ)は、
// プレイヤーモデルの内部にある同名のボーン(Spine/LeftUpperLeg/LeftLowerLeg等)を
// 直接回転させることで実現する。モデルが届くまでは空のグループのまま
// レンダーループを回し、読み込み完了時にボーン参照をセットする
const player = new THREE.Group();
player.rotation.y = Math.PI; // 背中をカメラ(+Z)に向ける
scene.add(player);

// 相手のボクサー(USA)。位置はOPPONENT_BASE(ワールド)で、プレイヤーと向かい合う
// (モデルは+Z方向を向いて作られているので、回転なしでカメラ側を向く)
// 左ジャブ(手首が相手の基準位置から約0.73m前へ伸びる)の拳が、プレイヤーの顔の前に
// 届く距離(z=-1.0)。横位置(x)は、プレイヤー(原点、x=0)と相手の中心線が一致するよう
// x=0(画面中央)にしている(正面から見て、両者が同じX座標)
const OPPONENT_BASE = new THREE.Vector3(0, 0, -1.0);
const opponent = new THREE.Group();
opponent.position.copy(OPPONENT_BASE);
scene.add(opponent);

const bones = { spine: null, leftUpperLeg: null, rightUpperLeg: null, leftLowerLeg: null, rightLowerLeg: null };
// アイドル・パンチのクリップはHips・LeftForearmなど、回避動作では使っていない
// ボーンも操作するため、ボーン名で引けるマップを別途用意する(将来別のクリップを
// 追加する場合もそのまま流用できる汎用的な仕組みにしている)
let allBonesByName = {};
let opponentBonesByName = {};
let opponentIdleClip = null; // assets/fightIdleUsa.json(USAボクサーの構えのアイドル。2秒でループ)

function loadFighter(url, group, onBones) {
  new GLTFLoader().load(
    url,
    (gltf) => {
      const model = gltf.scene;
      // 全ボーンを回転なしの直立姿勢にリセットしてから使う(クリップの回転と衝突しないように)
      model.traverse((o) => { if (o.isBone) o.quaternion.identity(); });
      group.add(model);
      const byName = {};
      model.traverse((o) => { if (o.isBone) byName[o.name] = o; });
      onBones(model, byName);
    },
    undefined,
    (err) => console.error(url + " の読み込みに失敗しました", err)
  );
}

loadFighter("./assets/boxer_rigged.glb", player, (model, byName) => {
  allBonesByName = byName;
  bones.hips = model.getObjectByName("Hips");
  bones.spine = model.getObjectByName("Spine");
  bones.leftUpperLeg = model.getObjectByName("LeftUpperLeg");
  bones.rightUpperLeg = model.getObjectByName("RightUpperLeg");
  bones.leftLowerLeg = model.getObjectByName("LeftLowerLeg");
  bones.rightLowerLeg = model.getObjectByName("RightLowerLeg");
  bones.leftForearm = model.getObjectByName("LeftForearm");
});
loadFighter("./assets/box_usa_rigged.glb", opponent, (model, byName) => { opponentBonesByName = byName; });
fetch("./assets/fightIdleUsa.json")
  .then((res) => res.json())
  .then((json) => { opponentIdleClip = json; })
  .catch((err) => console.error("fightIdleUsa.json の読み込みに失敗しました", err));

// ---------- 相手の攻撃遷移(Idle → 左ジャブ → Idle)のテスト ----------
// まずは「Idleが再生される → 5〜10秒のランダム待機 → 左ジャブ → 最後まで再生 → Idleへ戻る →
// また5〜10秒待機 → 左ジャブ」というループが正しく動くことだけを確認する(ダメージ判定・
// プレイヤーへの追従・戦闘判断はしない)。状態機械はThree.js非依存の純粋関数
// (createEnemyState/advanceEnemy)にしてあり、時刻と乱数を引数で受け取る。
//  ・待機時間(次の攻撃を始めるまで)は、Idleに入るたびに5〜10秒から決め直す
//  ・左ジャブの再生中は新しい攻撃タイマーを作らない。ジャブが最後まで再生されて
//    Idleへ戻った時点から、次の5〜10秒を数え始める
//  ・ジャブの長さは、クリップの最後のキーフレームの時刻(JSONのtotalFramesではない)
const ENEMY_WAIT_MIN_MS = 5000;
const ENEMY_WAIT_MAX_MS = 10000;
const ENEMY_BLEND_IN_MS = 120; // Idle→振りかぶりの頭で、Idleの姿勢からなじませる時間
const ENEMY_BLEND_OUT_MS = 150; // 攻撃の終わりで、攻撃の姿勢からIdleの姿勢へなじませる時間
// 敵の左ジャブは「大きな予備動作(振りかぶり)→タメ→高速のパンチ→戻り」の順に再生する。
// 敵の攻撃を「速さ」ではなく「予備動作」で見切れるようにするため(見てから避けられることを最優先)。
//  1. 振りかぶり+タメ: assets/leftJabWindupUsa.json(新規。左肩・左腕を大きく引いて拳を頭より高く振り上げ、
//     上体を反らす。0.3秒で振りかぶり、そこからさらに引いて約0.2秒タメる。合計約0.53秒)
//  2. パンチ: 振りかぶりの姿勢から、leftPunchUsa1.jsonのインパクトの姿勢(7フレーム)へ ENEMY_STRIKE_MS で
//     一気に打ち出す(元のジャブは構えからインパクトまで約0.23秒かかっていた。それが0.07秒になる)
//  3. 戻り: leftPunchUsa1.jsonの、インパクトより後ろ(引き戻して構えへ戻る部分)をそのまま再生する
const ENEMY_STRIKE_MS = 70; // 振りかぶり→インパクト。短いほど「パッ」と速い
const ENEMY_JAB_IMPACT_T = 7 / 30; // leftPunchUsa1.json の、インパクトのキーフレーム(7フレーム)の時刻(秒)

function pickEnemyWaitMs(rng) { return ENEMY_WAIT_MIN_MS + rng() * (ENEMY_WAIT_MAX_MS - ENEMY_WAIT_MIN_MS); }
function createEnemyState(now, rng = Math.random) {
  const waitMs = pickEnemyWaitMs(rng);
  return { phase: "idle", nextAttackAt: now + waitMs, waitMs };
}
function advanceEnemy(state, now, jabDurationMs, rng = Math.random) {
  if (state.phase === "idle" && now >= state.nextAttackAt) return { phase: "jab", startAt: now };
  if (state.phase === "jab" && now - state.startAt >= jabDurationMs) return createEnemyState(now, rng); // ここで初めて次のタイマーを作る
  return state;
}

let enemyState = null; // 2つのクリップ(idle・jab)が読み込まれてから作る
let enemyJabClip = null; // assets/leftPunchUsa1.json(USAボクサーの左ジャブ。humanoid-gltf-exporterで作成)
let enemyWindupClip = null; // assets/leftJabWindupUsa.json(左ジャブの予備動作。同じくhumanoid-gltf-exporterで作成)
const enemyLog = []; // テスト用: ["Idle", "Next attack in 7.3s", "Left Jab", "Return to Idle", ...]
function enemyDebug(message) {
  enemyLog.push({ t: performance.now(), message });
  console.log("[Enemy] " + message);
}
const clipEndMs = (clip) => clip.keyframes[clip.keyframes.length - 1].time * 1000;
function enemyWindupMs() { return clipEndMs(enemyWindupClip); }
// 攻撃1回の長さ = 振りかぶり+タメ → パンチ → 戻り
function enemyJabDurationMs() { return enemyWindupMs() + ENEMY_STRIKE_MS + (clipEndMs(enemyJabClip) - ENEMY_JAB_IMPACT_T * 1000); }

fetch("./assets/leftPunchUsa1.json")
  .then((res) => res.json())
  .then((json) => { enemyJabClip = json; })
  .catch((err) => console.error("leftPunchUsa1.json の読み込みに失敗しました", err));
fetch("./assets/leftJabWindupUsa.json")
  .then((res) => res.json())
  .then((json) => { enemyWindupClip = json; })
  .catch((err) => console.error("leftJabWindupUsa.json の読み込みに失敗しました", err));
// 敵のガード(プレイヤーのパンチをガードしたとき)のモーション。攻撃中でなければ、これを再生する
let enemyGuardClip = null; // assets/guardUsa1.json
const ENEMY_GUARD_BLEND_IN_MS = 40, ENEMY_GUARD_BLEND_OUT_MS = 100;
fetch("./assets/guardUsa1.json")
  .then((res) => res.json())
  .then((json) => { enemyGuardClip = json; })
  .catch((err) => console.error("guardUsa1.json の読み込みに失敗しました", err));
// ガードのクリップをどれだけ反映するか(0〜1)。ガード中でない/攻撃中(攻撃の腕を邪魔しない)/クリップ未読み込みなら0
function enemyGuardClipWeight(nowMs) {
  if (!enemyGuardClip || enemyReact.kind !== "guard" || (enemyState && enemyState.phase === "jab")) return 0;
  const e = nowMs - enemyReact.at, dur = clipEndMs(enemyGuardClip);
  if (e < 0 || e >= dur) return 0;
  return clamp01(Math.min(e / ENEMY_GUARD_BLEND_IN_MS, (dur - e) / ENEMY_GUARD_BLEND_OUT_MS));
}

function stepEnemyState(now) {
  if (!opponentIdleClip || !enemyJabClip || !enemyWindupClip) return;
  if (!enemyState) {
    enemyState = createEnemyState(now);
    enemyDebug("Idle");
    enemyDebug(`Next attack in ${(enemyState.waitMs / 1000).toFixed(1)}s`);
    return;
  }
  const prev = enemyState;
  enemyState = advanceEnemy(prev, now, enemyJabDurationMs());
  if (enemyState === prev) return;
  if (enemyState.phase === "jab") {
    enemyDebug("Left Jab (wind-up)");
    startEnemyAttack();
  } else {
    endEnemyAttack();
    enemyDebug("Return to Idle");
    enemyDebug(`Next attack in ${(enemyState.waitMs / 1000).toFixed(1)}s`);
  }
}

// ---------- 効果音(Web Audioでコード合成。音声ファイルは使わない) ----------
// 場面ごとに短い音をその場で作って鳴らす。後から音声ファイルへ差し替えるときは、
// SFX_BUILDERS の該当の関数を、<audio>/AudioBufferの再生に置き換えればよい。
// スマホのブラウザは最初のタップまで音を出せないので、最初の操作でAudioContextを開始する。
// 右上の🔊/🔇ボタンでミュート(設定は保存)
const SFX_MASTER_VOLUME = 0.7;
function makeNoiseBuffer(ctx, sec = 1) {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * sec)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
// ノイズ: フィルタ(type, f0→f1)と音量エンベロープ(アタック→指数減衰)
function sfxNoise(ctx, dest, t0, { dur, type, f0, f1 = f0, q = 1, gain, attack = 0.003 }) {
  const src = ctx.createBufferSource(); src.buffer = makeNoiseBuffer(ctx, dur + 0.05);
  const fil = ctx.createBiquadFilter(); fil.type = type; fil.Q.value = q;
  fil.frequency.setValueAtTime(f0, t0); fil.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(fil).connect(g).connect(dest); src.start(t0); src.stop(t0 + dur + 0.05);
}
// トーン: 周波数 f0→f1 の下降/上昇(ドスッという低い打撃の芯など)
function sfxTone(ctx, dest, t0, { dur, wave = "sine", f0, f1 = f0, gain, attack = 0.003 }) {
  const o = ctx.createOscillator(); o.type = wave;
  o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(dest); o.start(t0); o.stop(t0 + dur + 0.02);
}
const SFX_BUILDERS = {
  // プレイヤーが殴られた: 重いドスッ + 鈍い衝撃
  playerHit(c, d, t) { sfxTone(c, d, t, { dur: 0.28, f0: 150, f1: 42, gain: 1.0 }); sfxNoise(c, d, t, { dur: 0.2, type: "lowpass", f0: 1400, f1: 200, gain: 0.9 }); sfxNoise(c, d, t, { dur: 0.05, type: "bandpass", f0: 2500, q: 0.8, gain: 0.35 }); },
  // 敵が殴られた: 鋭いバシッ + 少し軽い芯
  enemyHit(c, d, t) { sfxTone(c, d, t, { dur: 0.2, f0: 220, f1: 70, gain: 0.8 }); sfxNoise(c, d, t, { dur: 0.14, type: "bandpass", f0: 2200, f1: 600, q: 0.7, gain: 1.0 }); sfxNoise(c, d, t, { dur: 0.04, type: "highpass", f0: 4000, gain: 0.3 }); },
  // ガード: 乾いたパンッ(短く、軽い)
  guard(c, d, t) { sfxNoise(c, d, t, { dur: 0.07, type: "bandpass", f0: 1000, f1: 700, q: 1.4, gain: 0.8 }); sfxTone(c, d, t, { dur: 0.06, wave: "triangle", f0: 260, f1: 150, gain: 0.45 }); },
  // かわした: 風切り(ヒュッ)
  dodge(c, d, t) { sfxNoise(c, d, t, { dur: 0.24, type: "bandpass", f0: 500, f1: 2200, q: 1.2, gain: 1.4, attack: 0.08 }); },
  // 敵の振りかぶり開始: 低い唸り(ゆっくり上がる)
  windup(c, d, t) { sfxTone(c, d, t, { dur: 0.5, wave: "sawtooth", f0: 80, f1: 190, gain: 0.3, attack: 0.15 }); sfxNoise(c, d, t, { dur: 0.45, type: "bandpass", f0: 300, f1: 900, q: 1, gain: 0.5, attack: 0.2 }); },
  // 敵の打ち出し: 鋭い風切り
  strike(c, d, t) { sfxNoise(c, d, t, { dur: 0.14, type: "bandpass", f0: 3200, f1: 700, q: 1.0, gain: 1.3, attack: 0.02 }); },
  // スリング発射: 弾ける風切り + 弦を離す音
  release(c, d, t) { sfxNoise(c, d, t, { dur: 0.16, type: "bandpass", f0: 2800, f1: 600, q: 0.9, gain: 1.4, attack: 0.015 }); sfxTone(c, d, t, { dur: 0.1, wave: "triangle", f0: 700, f1: 200, gain: 0.25 }); },
};
const sfx = {
  ctx: null, master: null, muted: false, log: [],
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : SFX_MASTER_VOLUME;
    this.master.connect(this.ctx.destination);
  },
  unlock() { try { this.init(); if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); } catch (_) {} },
  play(name) {
    this.log.push(name);
    if (this.muted || !this.ctx || this.ctx.state !== "running") return;
    try { SFX_BUILDERS[name](this.ctx, this.master, this.ctx.currentTime + 0.001); } catch (e) { console.warn("sfx", e); }
  },
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : SFX_MASTER_VOLUME;
    try { localStorage.setItem("boxer3d-muted", m ? "1" : "0"); } catch (_) {}
    muteBtn.textContent = m ? "🔇" : "🔊";
  },
  // テスト用: 音をオフラインで描画してサンプルを返す
  async render(name, sec = 0.8) {
    const oc = new OfflineAudioContext(1, Math.floor(44100 * sec), 44100);
    const g = oc.createGain(); g.gain.value = SFX_MASTER_VOLUME; g.connect(oc.destination);
    SFX_BUILDERS[name](oc, g, 0.01);
    return (await oc.startRendering()).getChannelData(0);
  },
};
const muteBtn = document.createElement("button");
muteBtn.id = "muteBtn";
muteBtn.style.cssText = "position:fixed;right:10px;top:max(10px,env(safe-area-inset-top));z-index:6;width:38px;height:38px;border-radius:19px;border:none;background:rgba(0,0,0,0.35);color:#fff;font-size:18px;line-height:38px;padding:0;";
muteBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
muteBtn.addEventListener("click", () => { sfx.unlock(); sfx.setMuted(!sfx.muted); });
document.body.appendChild(muteBtn);
try { sfx.muted = localStorage.getItem("boxer3d-muted") === "1"; } catch (_) {}
muteBtn.textContent = sfx.muted ? "🔇" : "🔊";
window.addEventListener("pointerdown", () => sfx.unlock(), { capture: true });
window.__sfx = { log: sfx.log, render: (n, s) => sfx.render(n, s), names: Object.keys(SFX_BUILDERS), state: () => (sfx.ctx ? sfx.ctx.state : "none"), unlock: () => sfx.unlock(), setMuted: (m) => sfx.setMuted(m), play: (n) => sfx.play(n) };


// ---------- プレイヤーの被ダメージ(敵のジャブが当たったらHPが減る) ----------
// 今回は被ダメージの処理だけを実装している(プレイヤーの攻撃・敵のパターン・やられモーション・
// 試合時間・勝敗判定・コンボ・ガードは変更していない)。まだHPのしくみは無かったので新しく作った。
//  ・敵のジャブ1回につき、当たれば ENEMY_JAB_DAMAGE(=10)のダメージ。当たらなければ0(Miss)
//  ・当たり判定は、ジャブの「拳」(左手首から前腕の向きへ少し先)の球と、プレイヤーの頭・胸の球が
//    重なったかどうか。ジャブが伸びている間(開始から0.10〜0.36秒)に、毎フレーム調べる。
//    回避でプレイヤーが横へ動いて球が離れていれば当たらない(ダメージなし)。
//    1回のジャブでダメージを受けるのは最大1回(当たった時点で、そのジャブの判定は終わり)
//  ・被弾状態: ダメージを受けた瞬間から HIT_STATE_MS の間(`isPlayerHit`)。被弾モーションは
//    まだ無いので、新しく作らず、HPの減少と状態のフラグ・ログ・HP表示の赤い点滅だけにしている
//  ・HPが0以下になったことは `playerKO` で検出できる(KO演出・試合終了・勝敗判定は未実装)
const PLAYER_MAX_HP = 100;
const ENEMY_JAB_DAMAGE = 10;
const HIT_STATE_MS = 400;
// パンチが当たる時間は、パンチを打ち出してからの短い間だけ(拳が伸びきる前後の約0.09秒)。
// 振りかぶりの間は当たらない(見てから避ける時間)。打ち出し(振りかぶりの終わり)からの経過時間で数える
const ENEMY_JAB_HIT_AFTER_STRIKE_MS = { from: 40, to: 130 };
const enemyHitWindow = () => ({ from: enemyWindupMs() + ENEMY_JAB_HIT_AFTER_STRIKE_MS.from, to: enemyWindupMs() + ENEMY_JAB_HIT_AFTER_STRIKE_MS.to });
const FIST_RADIUS_M = 0.1;
const FIST_FORWARD_OFFSET_M = 0.12; // 手首から拳の中心までの距離(前腕の向きへ)
const PLAYER_HURTBOXES = [{ bone: "Head", radius: 0.18 }, { bone: "Chest", radius: 0.24 }];

let playerHp = PLAYER_MAX_HP;
let playerKO = false;
let playerHitUntil = 0;
let playerHitAt = -1e9;
let enemyAttackResolved = true; // 今のジャブの判定が終わっているか(ジャブごとにリセット)
let enemyAttackDodged = false; // 判定の間に、回避の動作中だったか
let enemyStrikeLogged = false;
const combatLog = [];
function combatDebug(message) {
  combatLog.push({ t: performance.now(), message });
  console.log("[Combat] " + message);
}

// HP表示(小さな文字だけ。UIのデザインは変えていない)
const hpDisplayEl = document.createElement("div");
hpDisplayEl.id = "hpDisplay";
hpDisplayEl.style.cssText = "position:fixed;left:10px;top:max(10px,env(safe-area-inset-top));z-index:5;font:600 14px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.7);pointer-events:none;transition:color 0.1s;";
document.body.appendChild(hpDisplayEl);
function updateHpDisplay(now) {
  hpDisplayEl.textContent = `HP ${Math.max(0, Math.round(playerHp))} / ${PLAYER_MAX_HP}`;
  hpDisplayEl.style.color = now < playerHitUntil ? "#ff5a5a" : "#fff";
}
updateHpDisplay(0);
const isPlayerHit = (now) => now < playerHitUntil;

// ダメージを与える。KO(HP<=0)になったら以降は減らさない
function applyPlayerDamage(amount, now) {
  if (playerKO) return false;
  playerHp = Math.max(0, playerHp - amount);
  playerHitUntil = now + HIT_STATE_MS;
  playerHitAt = now;
  sfx.play("playerHit");
  if (playerHp <= 0) { playerKO = true; combatDebug("Player HP is 0 (KO detected)"); }
  return true;
}

// 敵の拳(球)の中心: 左手首から、前腕→手首の向きへ少し先
function enemyFistWorldPos() {
  const hand = opponentBonesByName.LeftHand, fore = opponentBonesByName.LeftForearm;
  if (!hand || !fore) return null;
  const h = hand.getWorldPosition(new THREE.Vector3()), f = fore.getWorldPosition(new THREE.Vector3());
  return h.clone().add(h.clone().sub(f).normalize().multiplyScalar(FIST_FORWARD_OFFSET_M));
}
// 拳がプレイヤーの頭・胸の球に重なっているか。{ hit, box, distance } を返す
function testFistAgainstPlayer(fist) {
  let best = { hit: false, box: null, distance: Infinity };
  for (const hb of PLAYER_HURTBOXES) {
    const bone = allBonesByName[hb.bone];
    if (!bone) continue;
    const d = fist.distanceTo(bone.getWorldPosition(new THREE.Vector3()));
    if (d < best.distance) best = { hit: d <= hb.radius + FIST_RADIUS_M, box: hb.bone, distance: d };
    if (d <= hb.radius + FIST_RADIUS_M) return { hit: true, box: hb.bone, distance: d };
  }
  return best;
}

function startEnemyAttack() { sfx.play("windup"); enemyAttackResolved = false; enemyAttackDodged = false; enemyStrikeLogged = false; }
// 毎フレーム(ジャブ中だけ)呼ばれる。ジャブが伸びている間に拳が当たれば、1回だけダメージ
function checkEnemyAttackHit(elapsedMs, now) {
  const win = enemyHitWindow();
  if (enemyAttackResolved || elapsedMs < win.from || elapsedMs > win.to) return;
  // 回避(左右のスワイプ)の動作中は、ダメージを受けない(かわし成功)。回避が早すぎて終わってしまう/
  // 遅すぎて間に合わない場合は、このあとの判定で当たる
  if (dodgeState.phase) { if (!enemyAttackDodged) sfx.play("dodge"); enemyAttackDodged = true; return; }
  const fist = enemyFistWorldPos();
  if (!fist) return;
  const r = testFistAgainstPlayer(fist);
  if (!r.hit) return;
  enemyAttackResolved = true;
  if (applyPlayerDamage(ENEMY_JAB_DAMAGE, now)) {
    combatDebug(`Enemy Left Jab: HIT ${r.box} (-${ENEMY_JAB_DAMAGE}) Player HP ${playerHp}/${PLAYER_MAX_HP}`);
    updateHpDisplay(now);
  }
}
// ジャブが終わった時点で、まだ当たっていなければMiss
function endEnemyAttack() {
  if (!enemyAttackResolved) {
    enemyAttackResolved = true;
    combatDebug(`Enemy Left Jab: MISS${enemyAttackDodged ? " (dodged)" : ""} (no damage) Player HP ${playerHp}/${PLAYER_MAX_HP}`);
  }
}

// 相手の姿勢を、現在時刻で更新する。Idle(構えのループ)は常に再生し続け、ジャブ中だけ
// ジャブのクリップをその上に重ねる(頭と終わりの短い時間でIdleの姿勢と混ぜるので、
// 遷移で姿勢が飛ばない)。Idleのクリップは先頭と末尾の姿勢・位置が一致しているので、
// 時刻を長さで割った余りを取るだけで継ぎ目なくループする
function updateOpponent(nowMs) {
  if (!opponentIdleClip) return;
  stepEnemyState(nowMs);
  const keys = opponentIdleClip.keyframes;
  const duration = keys[keys.length - 1].time;
  const sample = sampleClip(opponentIdleClip, (nowMs / 1000) % duration);
  if (enemyState && enemyState.phase === "jab" && enemyJabClip && enemyWindupClip) {
    const elapsedMs = nowMs - enemyState.startAt;
    const totalMs = enemyJabDurationMs(), windMs = enemyWindupMs();
    const w = clamp01(Math.min(elapsedMs / ENEMY_BLEND_IN_MS, (totalMs - elapsedMs) / ENEMY_BLEND_OUT_MS));
    let atk;
    if (elapsedMs < windMs) {
      atk = sampleClip(enemyWindupClip, elapsedMs / 1000); // 1) 振りかぶり+タメ
    } else if (elapsedMs < windMs + ENEMY_STRIKE_MS) {
      // 2) パンチ: 振りかぶりの最後の姿勢から、ジャブのインパクトの姿勢へ一気に(速く打ち出す)
      if (!enemyStrikeLogged) { enemyStrikeLogged = true; enemyDebug("Strike"); sfx.play("strike"); }
      const from = sampleClip(enemyWindupClip, windMs / 1000), to = sampleClip(enemyJabClip, ENEMY_JAB_IMPACT_T);
      const t = easeOutCubic((elapsedMs - windMs) / ENEMY_STRIKE_MS);
      atk = { pose: {}, modelPosition: from.modelPosition.map((v, i) => v + (to.modelPosition[i] - v) * t) };
      for (const name of Object.keys(to.pose)) atk.pose[name] = from.pose[name] ? from.pose[name].clone().slerp(to.pose[name], t) : to.pose[name];
    } else {
      if (!enemyStrikeLogged) { enemyStrikeLogged = true; enemyDebug("Strike"); sfx.play("strike"); }
      atk = sampleClip(enemyJabClip, ENEMY_JAB_IMPACT_T + (elapsedMs - windMs - ENEMY_STRIKE_MS) / 1000); // 3) 戻り
    }
    for (const name of Object.keys(atk.pose)) {
      sample.pose[name] = sample.pose[name] ? sample.pose[name].clone().slerp(atk.pose[name], w) : atk.pose[name];
    }
    sample.modelPosition = sample.modelPosition.map((v, i) => v + (atk.modelPosition[i] - v) * w);
  }
  const gw = enemyGuardClipWeight(nowMs);
  if (gw > 0) {
    const g = sampleClip(enemyGuardClip, (nowMs - enemyReact.at) / 1000);
    for (const name of Object.keys(g.pose)) sample.pose[name] = sample.pose[name] ? sample.pose[name].clone().slerp(g.pose[name], gw) : g.pose[name];
    sample.modelPosition = sample.modelPosition.map((v, i) => v + (g.modelPosition[i] - v) * gw);
  }
  for (const name of Object.keys(sample.pose)) {
    const bone = opponentBonesByName[name];
    if (bone) bone.quaternion.copy(sample.pose[name]);
  }
  opponent.position.set(OPPONENT_BASE.x + sample.modelPosition[0], OPPONENT_BASE.y + sample.modelPosition[1], OPPONENT_BASE.z + sample.modelPosition[2]);
  // 敵のジャブの当たり判定(姿勢を反映した直後の、拳の位置で調べる)
  if (enemyState && enemyState.phase === "jab") checkEnemyAttackHit(nowMs - enemyState.startAt, nowMs);
  updateHpDisplay(nowMs);
}

// クリップのサンプル結果(pose: ボーン名→Quaternion、modelPosition)を、
// 実際のシーングラフ(ボーン・player.position)へ適用する
function applyClipSample(sample) {
  for (const name of Object.keys(sample.pose)) {
    const bone = allBonesByName[name];
    if (bone) bone.quaternion.copy(sample.pose[name]);
  }
  player.position.set(sample.modelPosition[0], sample.modelPosition[1], sample.modelPosition[2]);
}

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
// 相手の足元にも同じ接地シャドウを置く
const opponentShadow = shadowBlob.clone();
opponentShadow.position.set(OPPONENT_BASE.x + 0.05, 0.015, OPPONENT_BASE.z + 0.04);
scene.add(opponentShadow);

// ---------- 肩タップのパンチ(左肩=左ジャブ、右肩=右ストレート) ----------
// Sling Kongのような「ゴムを弾く」感覚のパンチ入力のテストは、いったん終了した。
// 今は、プレイヤーのグローブ(拳)付近をタップするだけで、次のパンチが1回出る:
//    左グローブをタップ → 左ジャブ     右グローブをタップ → 右ストレート
// (以前は肩付近をタップしていたが、左右スワイプの「かわし」と競合するおそれがあるため、グローブへ移した)
// (フック・アッパー・スワイプでの方向指定・攻撃判定・ダメージ・コンボ・引っ張り量による威力変化は
//  作っていない。しゃがみ込み=下スワイプは、攻撃操作と競合するおそれがあるので廃止した)
//  ・モーションは、humanoid-gltf-exporterで作ったボクサー用のものをそのまま使う(ファイルは変更しない)
//      左ジャブ    = assets/leftPunch1.json   (腰を沈めて左足を踏み出しながら打つ。1m先の相手に拳が届く)
//      右ストレート = assets/rightStraight.json (腰を回して後ろ足のかかとを上げ、右腕をまっすぐ伸ばす。5キーフレーム)
//    体の前進・沈み込みは、クリップのmodelPositionに入っている。クリップはモデル向き(+Z)で
//    作られているが、プレイヤーは背中をカメラへ向けて(Y軸で180°回して)いるため、
//    ワールドでは x と z の符号を反転して適用する
//  ・再生は、クリップの先頭から「構えに戻った時点」まで(末尾の、構えのまま止まっている区間は
//    使わない)。キーフレームは変更せず、再生する範囲を決めるだけ
//  ・入力は「タップ」だけを受け付ける。グローブの円の中で指を置き、ほとんど動かさずに(PUNCH_TAP_MAX_MOVE_PX以内)
//    すぐ(PUNCH_TAP_MAX_MS以内に)離したらパンチ。動かしたらスワイプ=かわしとして扱う。
//    そのため、グローブの上から始めたスワイプでも、パンチではなく回避になる(競合しない)。
//    離した瞬間に出るので、指を置いた瞬間に出す方式より、数十ミリ秒だけ遅い
//  ・状態は IDLE ⇄ パンチ(1種類ずつ)。パンチ再生中のタップは、肩が左右どちらでも無視する
//    (多重再生しない)。パンチが終わったら、必ずIDLEへ戻る
const PUNCHES = {
  leftJab: { label: "Left Jab", url: "./assets/leftJabInPlace1.json", bone: "LeftHand", forearm: "LeftForearm", takebackSec: 5 / 30, clip: null, range: null },
  rightStraight: { label: "Right Straight", url: "./assets/rightStraight.json", bone: "RightHand", forearm: "RightForearm", clip: null, range: null },
};
const PUNCH_SPEED = 1.0; // 再生速度の倍率(1.0=ファイルのまま。大きくするとより速く弾ける。後から調整する用)
const PUNCH_BLEND_IN_MS = 60; // Idleの姿勢からパンチの最初の姿勢へなじませる時間(短いほど弾ける感じ)
const PUNCH_BLEND_OUT_MS = 150; // パンチの最後の構えからIdleへなじませる時間
const PUNCH_HIT_RADIUS_M = 0.16; // グローブのタップ判定の半径(ワールド単位。グローブの大きさとほぼ同じ。画面上ではこの大きさに投影する)
const PUNCH_GLOVE_FORWARD_M = 0.08; // 手首からグローブの中心までの距離(前腕の向きへ)
const PUNCH_HIT_MIN_RADIUS_PX = 44; // 画面が小さいときでも、指で押せる最小の半径(CSSピクセル)
// タップの判定: 指を離すまでに、この距離(px)より動かず、この時間(ms)以内なら「タップ」とみなす。
// これを超えて動いたものはスワイプとして扱い、回避の判定へ回す(グローブの上から始めたスワイプでも回避できる)
const PUNCH_TAP_MAX_MOVE_PX = 14;
const PUNCH_TAP_MAX_MS = 350;

function poseEquals(a, b) {
  for (const name of Object.keys(a)) {
    const x = a[name], y = b[name];
    if (!y) return false;
    for (let i = 0; i < 4; i++) if (Math.abs(x[i] - y[i]) > 1e-9) return false;
  }
  return true;
}
// 先頭の「構えのまま止まっている」区間の終わりと、末尾の「構えに戻って止まっている」区間の
// 始まりを、キーフレームから求める
function findPunchActiveRange(clip) {
  const keys = clip.keyframes.filter((k) => k.pose);
  let startIdx = 0;
  while (startIdx + 1 < keys.length && poseEquals(keys[startIdx + 1].pose, keys[0].pose)) startIdx++;
  let endIdx = keys.length - 1;
  while (endIdx - 1 > startIdx && poseEquals(keys[endIdx - 1].pose, keys[keys.length - 1].pose)) endIdx--;
  return { start: keys[startIdx].time, end: keys[endIdx].time };
}
// 左ジャブの「最大テイクバックの時刻」: 前腕が伸び始める直前のキー(それまでが引き・構えの部分)
function findTakebackTime(clip, forearmName) {
  const keys = clip.keyframes;
  const q0 = keys[0].pose[forearmName];
  if (!q0) return 0.15;
  for (let i = 1; i < keys.length; i++) {
    const q = keys[i].pose[forearmName];
    if (!q) continue;
    const dot = Math.abs(q0[0] * q[0] + q0[1] * q[1] + q0[2] * q[2] + q0[3] * q[3]);
    if (2 * Math.acos(Math.min(1, dot)) > 0.15) return keys[i - 1].time;
  }
  return 0.15;
}
// 右ストレート用: 前腕がまっすぐ伸びる(wが大きい)直前のキー = 最大テイクバック
function findTakebackByExtension(clip, forearmName) {
  const keys = clip.keyframes;
  for (let i = 1; i < keys.length; i++) {
    const q = keys[i].pose[forearmName];
    if (q && Math.abs(q[3]) > 0.9) return keys[i - 1].time;
  }
  return 0.15;
}
const punchDurationMs = (kind) => ((PUNCHES[kind].range.end - PUNCHES[kind].range.start) * 1000) / PUNCH_SPEED;

for (const [kind, p] of Object.entries(PUNCHES)) {
  fetch(p.url)
    .then((res) => res.json())
    .then((json) => {
      p.clip = json;
      p.range = findPunchActiveRange(json);
      p.hasMove = json.keyframes.some((k) => k.modelPosition);
      p.takebackT = json.takebackTime || p.takebackSec || (kind === "leftJab" ? findTakebackTime(json, p.forearm) : findTakebackByExtension(json, p.forearm));
      console.log(`[Player] ${p.label} clip ready (play ${p.range.start.toFixed(2)}s-${p.range.end.toFixed(2)}s, ${punchDurationMs(kind).toFixed(0)}ms)`);
    })
    .catch((err) => console.error(p.url + " の読み込みに失敗しました", err));
}

// 状態機械(Three.js非依存の純粋関数): { phase: null(=IDLE) | "leftJab" | "rightStraight", startAt }
function createPunchState() { return { phase: null, startAt: 0 }; }
function triggerPunch(state, kind, now, startOffsetMs = 0) {
  if (state.phase) return state; // 再生中は無視(多重再生しない)
  // startOffsetMs>0 は、クリップの途中(スリングで引いた位置)から始める。その場合は姿勢がすでにクリップ上なので、なじませ(ブレンドイン)はしない
  return { phase: kind, startAt: now - startOffsetMs, warm: startOffsetMs > 0 };
}
function advancePunch(state, now, durationMs) {
  if (state.phase && now - state.startAt >= durationMs) return createPunchState();
  return state;
}

let punchState = createPunchState();
const punchStats = { started: 0, ignored: 0, finished: 0 };
function playerDebug(message) { console.log("[Player] " + message); }

// グローブ(拳)の画面上の位置と、タップ判定の半径(CSSピクセル)を求める。グローブの中心は、
// 手首のボーンから前腕の向きへ少し先。構えやパンチで手が動くと、判定もグローブについてくる。
// プレイヤーは背中をカメラへ向けているので、モデルの「左」は画面の左側、「右」は右側に見える
function gloveScreenZone(kind) {
  const p = PUNCHES[kind];
  const bone = allBonesByName[p.bone], fore = allBonesByName[p.forearm];
  if (!bone || !fore) return null;
  const rect = canvas.getBoundingClientRect();
  const hand = bone.getWorldPosition(new THREE.Vector3());
  const p3 = hand.clone().add(hand.clone().sub(fore.getWorldPosition(new THREE.Vector3())).normalize().multiplyScalar(PUNCH_GLOVE_FORWARD_M));
  const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const toScreen = (v) => { const n = v.clone().project(camera); return { x: rect.left + (n.x * 0.5 + 0.5) * rect.width, y: rect.top + (-n.y * 0.5 + 0.5) * rect.height }; };
  const c = toScreen(p3), e = toScreen(p3.clone().addScaledVector(camRight, PUNCH_HIT_RADIUS_M));
  return { x: c.x, y: c.y, r: Math.max(PUNCH_HIT_MIN_RADIUS_PX, Math.hypot(e.x - c.x, e.y - c.y)) };
}
// タップ位置が、どのグローブの円に入っているか("leftJab" / "rightStraight" / null)。
// 2つの円が重なっているときは、中心に近いほうを選ぶ
function punchAtScreen(clientX, clientY) {
  let best = null, bestD = Infinity;
  for (const kind of Object.keys(PUNCHES)) {
    const z = gloveScreenZone(kind);
    if (!z) continue;
    const d = Math.hypot(clientX - z.x, clientY - z.y);
    if (d <= z.r && d < bestD) { best = kind; bestD = d; }
  }
  return best;
}

// タップされたときにパンチを始める。IDLEのときだけ受け付ける(パンチ中・回避中は無視)
function tryPunch(kind, now) {
  const p = PUNCHES[kind];
  if (!p.clip || !p.range) return false;
  if (punchState.phase || dodgeState.phase) {
    punchStats.ignored++;
    playerDebug(punchState.phase ? `${p.label} input ignored (${PUNCHES[punchState.phase].label} in progress)` : `${p.label} input ignored (busy)`);
    return false;
  }
  punchState = triggerPunch(punchState, kind, now);
  punchStats.started++;
  playerDebug(p.label);
  return true;
}

// IDLEの上にパンチを重ねた姿勢を作る。IDLEのクリップは止めずに進め続け、パンチ中だけ
// その上にパンチのクリップ(範囲の中だけ)をかぶせる。頭と終わりの短い時間はIDLEの姿勢・
// 体の位置と混ぜる(姿勢はクォータニオンのslerp、位置はlerp)ので、飛ばない。
// パンチのmodelPosition(モデル向きでの前進・沈み込み)は、プレイヤーが180°回っているため、
// xとzの符号を反転してワールドの位置にする
function samplePunchOverIdle(now) {
  const p = PUNCHES[punchState.phase];
  const idle = sampleClip(IDLE_CLIP, computeIdleClipTime(now));
  const elapsedMs = now - punchState.startAt;
  const totalMs = punchDurationMs(punchState.phase);
  const w = clamp01(Math.min(punchState.warm ? 1 : elapsedMs / PUNCH_BLEND_IN_MS, (totalMs - elapsedMs) / PUNCH_BLEND_OUT_MS));
  const sample = sampleClip(p.clip, p.range.start + (elapsedMs * PUNCH_SPEED) / 1000);
  for (const name of Object.keys(sample.pose)) {
    idle.pose[name] = idle.pose[name] ? idle.pose[name].clone().slerp(sample.pose[name], w) : sample.pose[name];
  }
  if (p.hasMove) {
    const worldPos = [-sample.modelPosition[0], sample.modelPosition[1], -sample.modelPosition[2]];
    idle.modelPosition = idle.modelPosition.map((v, i) => v + (worldPos[i] - v) * w);
  }
  return idle;
}

// 動作確認用: ?debug=1 を付けて開くと、左右のグローブのタップ判定の範囲を半透明の円で表示する
const punchZoneDebugEls = {};
if (new URLSearchParams(location.search).has("debug")) {
  for (const kind of Object.keys(PUNCHES)) {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;pointer-events:none;border:2px solid rgba(255,80,80,0.9);background:rgba(255,80,80,0.18);border-radius:50%;z-index:5;display:none;";
    document.body.appendChild(el);
    punchZoneDebugEls[kind] = el;
  }
}
function updatePunchZoneDebug() {
  for (const [kind, el] of Object.entries(punchZoneDebugEls)) {
    const z = gloveScreenZone(kind);
    if (!z) continue;
    el.style.display = "block";
    el.style.left = `${z.x - z.r}px`;
    el.style.top = `${z.y - z.r}px`;
    el.style.width = el.style.height = `${z.r * 2}px`;
  }
}


// ---------- スリング式・左ジャブ ----------
// 左グローブを押さえて下へドラッグ → 左ジャブのクリップの「テイクバック部分(0〜最大テイクバック)」を
// ドラッグ量に同期して手動で再生する(指を止めればアニメも止まる)。指を離すと、その位置から
// パンチ→フォロースルー→構えへ通常の時間で再生する。ドラッグ量の上限は SLING_MAX_DRAG_PX。
// 既存クリップの引きは小さいので、見た目で「引っ張っている」と分かるよう、ドラッグ量に比例した
// 腕・肩の引きを上乗せ(離すと一瞬で消えるので、腕が前へ弾ける)。新しいモーションファイルは作らない
const SLING_START_PX = 10;      // これ以上、下へ動いたらスリング開始(横に大きく動いたらスワイプ=かわし)
const SLING_MAX_DRAG_PX = 160;  // この距離で最大テイクバック(100%)
const SLING_MIN_PULL = 0.12;    // これ未満で離したらキャンセル(パンチを出さずIdleへ)
const SLING_EXTRA_RELEASE_MS = 70; // 離したあと、上乗せの引きが消えるまでの時間
const SLING_EXTRA = { // X軸回転(ラジアン)
  leftJab: { LeftShoulder: -0.05 }, // 左ジャブのクリップ自体に振りかぶりがあるので、上乗せは控えめ
  rightStraight: { RightShoulder: -0.1, Chest: 0.12 }, // 右ストレートのクリップは引きが大きいので、上乗せは控えめ
};
let slingSeq = 0;
const sling = { kind: "leftJab", startId: 0, releasedAnchor: null, active: false, pull: 0, pointerId: null, startY: 0, releasedAt: -1e9, releasedPull: 0 };
function slingTakebackSec() { return PUNCHES[sling.kind].takebackT || 0.15; }
function slingStart(y, pointerId = null, kind = "leftJab") {
  const p = PUNCHES[kind];
  if (!p.clip || !p.range || punchState.phase || dodgeState.phase || sling.active) return false;
  Object.assign(sling, { kind, active: true, pull: 0, pointerId, startY: y, startId: ++slingSeq });
  playerDebug(`Sling pull start (${p.label})`);
  return true;
}
function slingSetPull(pull) { if (sling.active) sling.pull = clamp01(pull); }
function slingDragTo(y) { slingSetPull((y - sling.startY) / SLING_MAX_DRAG_PX); }
function slingCancel(reason = "cancel") {
  if (!sling.active) return;
  sling.active = false;
  playerDebug(`Sling ${reason} (pull ${(sling.pull * 100).toFixed(0)}%) -> Idle`);
}
function slingRelease(now) {
  if (!sling.active) return false;
  if (sling.pull < SLING_MIN_PULL) { slingCancel("canceled: pull too small"); return false; }
  const t = sling.pull * slingTakebackSec();
  sling.active = false;
  sling.releasedAt = now;
  sling.releasedPull = sling.pull;
  sling.releasedAnchor = slingAnchor;
  punchState = triggerPunch(punchState, sling.kind, now, Math.max(1, (t * 1000) / PUNCH_SPEED));
  punchStats.started++;
  sfx.play("release");
  playerDebug(`Sling release (pull ${(sling.pull * 100).toFixed(0)}% = clip ${t.toFixed(3)}s) -> ${PUNCHES[sling.kind].label}`);
  return true;
}
// 引いている間の姿勢: クリップの 0〜takeback をドラッグ量で直接サンプルする(Idleからは最初の少しでなじませる)
function sampleSlingPull(now) {
  const p = PUNCHES[sling.kind];
  const idle = sampleClip(IDLE_CLIP, computeIdleClipTime(now));
  const sample = sampleClip(p.clip, sling.pull * slingTakebackSec());
  const w = clamp01(sling.pull / 0.15);
  for (const name of Object.keys(sample.pose)) {
    idle.pose[name] = idle.pose[name] ? idle.pose[name].clone().slerp(sample.pose[name], w) : sample.pose[name];
  }
  if (p.hasMove) {
    const worldPos = [-sample.modelPosition[0], sample.modelPosition[1], -sample.modelPosition[2]];
    idle.modelPosition = idle.modelPosition.map((v, i) => v + (worldPos[i] - v) * w);
  }
  return idle;
}
function slingExtraAmount(now) {
  if (sling.active) return sling.pull;
  const e = now - sling.releasedAt;
  if (e < 0 || e >= SLING_EXTRA_RELEASE_MS) return 0;
  return sling.releasedPull * (1 - e / SLING_EXTRA_RELEASE_MS);
}
const _sQ = new THREE.Quaternion(), _sE = new THREE.Euler();
function applySlingExtra(now) {
  const k = slingExtraAmount(now);
  if (k <= 0) return;
  const extra = SLING_EXTRA[sling.kind];
  for (const name of Object.keys(extra)) {
    const bone = allBonesByName[name];
    if (bone) bone.quaternion.premultiply(_sQ.setFromEuler(_sE.set(extra[name] * k, 0, 0)));
  }
}


// ---------- スリングの演出(引っ張っているのが分かる表示) ----------
// ・引いている間: グローブの位置から指までゴムのような帯が伸び、グローブの上(敵のいる奥の方向)へ
//   「︿︿︿」のシェブロンが並ぶ。引くほど帯が太く・シェブロンが点灯し、色は黄→橙→赤へ。
//   最大まで引くと全体が脈打って「離して発射!」と出る
// ・離した瞬間: シェブロンが奥(上)へ勢いよく飛んで消える
// ・何も操作していないとき: 各グローブの下に小さな「﹀」を薄く点滅(引っ張って遊ぶ操作のヒント)
const SLING_HINT_ENABLED = true;
const SLING_FX_RELEASE_MS = 260;
const SVGNS = "http://www.w3.org/2000/svg";
const slingFxSvg = document.createElementNS(SVGNS, "svg");
slingFxSvg.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:4;pointer-events:none;overflow:visible;";
document.body.appendChild(slingFxSvg);
const mk = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); slingFxSvg.appendChild(e); return e; };
const fxBand = mk("line", { "stroke-linecap": "round", opacity: 0 });
const fxBandOuter = mk("line", { "stroke-linecap": "round", stroke: "rgba(0,0,0,0.35)", opacity: 0 });
const fxHandle = mk("circle", { fill: "none", opacity: 0 });
const fxRing = mk("circle", { fill: "none", opacity: 0 });
const fxChevrons = Array.from({ length: 4 }, () => mk("polyline", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0 }));
const fxLabel = mk("text", { "text-anchor": "middle", "font-size": "15", "font-weight": "800", fill: "#fff", stroke: "rgba(0,0,0,0.6)", "stroke-width": "3", "paint-order": "stroke", opacity: 0, "font-family": "system-ui,sans-serif" });
fxLabel.textContent = "離して発射!";
const fxHints = {};
for (const kind of Object.keys(PUNCHES)) fxHints[kind] = [0, 1].map(() => mk("polyline", { fill: "none", stroke: "#fff", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0 }));
const fxColor = (k) => `hsl(${Math.round(55 - 55 * k)},100%,${Math.round(62 - 8 * k)}%)`; // 黄→橙→赤
// 上向きシェブロン(先が奥=敵の方向を指す)。中心(cx,cy)、半幅w、高さh
const chevronPts = (cx, cy, w, h) => `${cx - w},${cy + h / 2} ${cx},${cy - h / 2} ${cx + w},${cy + h / 2}`;
const hide = (...els) => els.forEach((e) => e.setAttribute("opacity", 0));
let slingAnchor = null; // 引き始めたときのグローブの画面位置
function updateSlingFx(now) {
  const idle = !sling.active && !punchState.phase && !dodgeState.phase;
  // ヒント(何も操作していないとき)
  for (const kind of Object.keys(PUNCHES)) {
    const z = SLING_HINT_ENABLED && idle && !playerKO ? gloveScreenZone(kind) : null;
    fxHints[kind].forEach((c, i) => {
      if (!z) return c.setAttribute("opacity", 0);
      const ph = (now / 900 + i * 0.25) % 1;
      const y = z.y + z.r * 0.75 + ph * 22 + i * 12;
      c.setAttribute("points", `${z.x - 9},${y - 5} ${z.x},${y + 4} ${z.x + 9},${y - 5}`);
      c.setAttribute("opacity", (0.55 * Math.sin(Math.PI * ph)).toFixed(2));
    });
  }
  if (sling.active) {
    if (!slingAnchor || slingAnchor.id !== sling.startId) {
      const z = gloveScreenZone(sling.kind) || { x: 195, y: 500, r: 60 };
      slingAnchor = { id: sling.startId, x: z.x, y: z.y, r: z.r };
    }
    const a = slingAnchor, k = sling.pull, col = fxColor(k);
    const ey = a.y + k * SLING_MAX_DRAG_PX; // 指(引いている端)の位置
    const pulse = k >= 0.95 ? 0.5 + 0.5 * Math.sin(now / 55) : 0;
    for (const [line, w, c] of [[fxBandOuter, 12 + 14 * k, "rgba(0,0,0,0.35)"], [fxBand, 7 + 12 * k, col]]) {
      line.setAttribute("x1", a.x); line.setAttribute("y1", a.y); line.setAttribute("x2", a.x); line.setAttribute("y2", ey);
      line.setAttribute("stroke", c); line.setAttribute("stroke-width", w.toFixed(1)); line.setAttribute("opacity", k > 0.02 ? 0.9 : 0);
    }
    fxHandle.setAttribute("cx", a.x); fxHandle.setAttribute("cy", ey); fxHandle.setAttribute("r", 14 + 8 * k + 4 * pulse);
    fxHandle.setAttribute("stroke", col); fxHandle.setAttribute("stroke-width", 5); fxHandle.setAttribute("opacity", 0.95);
    fxRing.setAttribute("cx", a.x); fxRing.setAttribute("cy", a.y); fxRing.setAttribute("r", a.r * (0.7 + 0.25 * k + 0.08 * pulse));
    fxRing.setAttribute("stroke", col); fxRing.setAttribute("stroke-width", 3 + 4 * k); fxRing.setAttribute("opacity", 0.55 + 0.4 * k);
    // シェブロン: グローブの上(奥)へ向かって並び、引くほど点灯。少しずつ奥へ流れる
    const lit = k * fxChevrons.length;
    fxChevrons.forEach((c, i) => {
      const flow = ((now / 500) % 1) * 14 * k;
      const cy = a.y - a.r * 0.9 - i * 26 - flow;
      const on = clamp01(lit - i);
      c.setAttribute("points", chevronPts(a.x, cy, 20 + 8 * k, 14));
      c.setAttribute("stroke", col); c.setAttribute("stroke-width", 7 + 3 * k);
      c.setAttribute("opacity", (0.18 + 0.82 * on).toFixed(2));
    });
    fxLabel.setAttribute("x", a.x); fxLabel.setAttribute("y", a.y - a.r * 0.9 - fxChevrons.length * 26 - 14);
    fxLabel.setAttribute("opacity", k >= 0.95 ? 0.7 + 0.3 * pulse : 0);
    return;
  }
  slingAnchor = null;
  // 離した直後: シェブロンが奥へ飛んで消える
  const e = now - sling.releasedAt;
  hide(fxBand, fxBandOuter, fxHandle, fxRing, fxLabel);
  if (e >= 0 && e < SLING_FX_RELEASE_MS && sling.releasedAnchor) {
    const t = e / SLING_FX_RELEASE_MS, a = sling.releasedAnchor, col = fxColor(sling.releasedPull);
    fxChevrons.forEach((c, i) => {
      const cy = a.y - a.r * 0.9 - i * 26 - easeOutCubic(t) * 150;
      c.setAttribute("points", chevronPts(a.x, cy, 24, 16));
      c.setAttribute("stroke", col); c.setAttribute("stroke-width", 9);
      c.setAttribute("opacity", ((1 - t) * 0.95).toFixed(2));
    });
  } else {
    hide(...fxChevrons);
  }
}

// ---------- 入力(左右スワイプ・グローブ操作) ----------
let dodgeState = createDodgeState();
let gestureStart = null;
function pointerPos(evt) { return { x: evt.clientX, y: evt.clientY }; }
function onPointerDown(evt) {
  // 指を置いた場所がグローブの円の中なら、その操作を覚えておく。
  //  ・右グローブ: タップだったとき、離した時にパンチ
  //  ・左グローブ: 下へドラッグするとスリング(離した時にジャブ)。タップだけでは何も出ない
  if (sling.active) return; // 2本目の指は無視
  gestureStart = { ...pointerPos(evt), t: performance.now(), punchKind: punchAtScreen(evt.clientX, evt.clientY), pointerId: evt.pointerId };
}
function onPointerMove(evt) {
  if (sling.active) { if (evt.pointerId === sling.pointerId) slingDragTo(evt.clientY); return; }
  if (!gestureStart || !gestureStart.punchKind || evt.pointerId !== gestureStart.pointerId) return;
  const dx = evt.clientX - gestureStart.x, dy = evt.clientY - gestureStart.y;
  // 下向きの動きが主で、少し動いたらスリング開始(横の動きが主ならスリングにせず、離した時のスワイプ=かわしになる)
  if (dy >= SLING_START_PX && dy > Math.abs(dx) && slingStart(gestureStart.y, evt.pointerId, gestureStart.punchKind)) {
    try { canvas.setPointerCapture(evt.pointerId); } catch (_) {}
    slingDragTo(evt.clientY);
  }
}
function onPointerUp(evt) {
  if (sling.active) {
    if (evt.pointerId === sling.pointerId) { slingRelease(performance.now()); gestureStart = null; }
    return;
  }
  if (!gestureStart) return;
  const end = pointerPos(evt);
  const now = performance.now();
  const dx = end.x - gestureStart.x, dt = now - gestureStart.t, dy = end.y - gestureStart.y;
  gestureStart = null;
  const direction = classifySwipe(dx, dy, dt);
  if (!direction) return;
  // パンチ中は、回避の入力を受け付けない
  if (punchState.phase) return;
  dodgeState = onSwipe(dodgeState, direction, now, computeDodgeX(dodgeState, now));
}
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", () => { gestureStart = null; slingCancel("canceled"); });

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


// ---------- 被弾のけぞり(瞬間的・大げさ) ----------
// 被弾の瞬間に一気に後ろへのけぞり(HIT_RECOIL_IN_MS)、少し止まってから、元の構えへ戻る。
// アイドル・パンチ・かわしのどの姿勢の上にも「上乗せ」する(ボーンの回転と位置を足すだけ)
const HIT_RECOIL_IN_MS = 55, HIT_RECOIL_HOLD_MS = 70, HIT_RECOIL_OUT_MS = 330;
const HIT_RECOIL_MS = HIT_RECOIL_IN_MS + HIT_RECOIL_HOLD_MS + HIT_RECOIL_OUT_MS;
// 値はX軸回転(ラジアン)。マイナス=後ろへ倒れる
const HIT_RECOIL_BONES = { Hips: -0.12, Spine: -0.3, Chest: -0.2, Neck: -0.3, Head: -0.3, LeftShoulder: -0.2, RightShoulder: -0.2, LeftUpperArm: -0.5, RightUpperArm: -0.5 };
const HIT_RECOIL_BACK_M = 0.06, HIT_RECOIL_DROP_M = 0.05;
function hitRecoilAmount(now) {
  const e = now - playerHitAt;
  if (e < 0 || e >= HIT_RECOIL_MS) return 0;
  if (e < HIT_RECOIL_IN_MS) return easeOutCubic(e / HIT_RECOIL_IN_MS);
  if (e < HIT_RECOIL_IN_MS + HIT_RECOIL_HOLD_MS) return 1;
  const t = (e - HIT_RECOIL_IN_MS - HIT_RECOIL_HOLD_MS) / HIT_RECOIL_OUT_MS;
  return 1 - t * t * (3 - 2 * t);
}
const _recoilQ = new THREE.Quaternion(), _recoilE = new THREE.Euler();
function applyHitRecoil(now) {
  const k = hitRecoilAmount(now);
  if (k <= 0) return;
  for (const name of Object.keys(HIT_RECOIL_BONES)) {
    const bone = allBonesByName[name];
    if (!bone) continue;
    _recoilQ.setFromEuler(_recoilE.set(HIT_RECOIL_BONES[name] * k, 0, 0));
    bone.quaternion.premultiply(_recoilQ);
  }
  player.position.z += HIT_RECOIL_BACK_M * k; // プレイヤーは-Zを向いているので、+Zが後ろ
  player.position.y -= HIT_RECOIL_DROP_M * k;
}


// ---------- 敵の被弾/ガード(プレイヤーのパンチの結果) ----------
// プレイヤーのパンチのグローブが敵の頭・胸に届いた瞬間に、1パンチにつき1回だけ結果を決める。
// ENEMY_HIT_CHANCE(=10%)で「被弾」、残り(90%)は「ガード」。どちらも、敵の現在の姿勢の上に
// ボーンの回転・位置を上乗せする(プレイヤーの被弾のけぞりと同じ方式)。
// 被弾したら、敵の攻撃は中断される(カウンター)。ガードでは攻撃は止まらない
const ENEMY_HIT_CHANCE = 0.1;
const ENEMY_REACT = {
  // 被弾: 瞬間的に大きくのけぞる(頭を跳ね上げ、腕を振り上げ、後ろへ下がる)
  hit: { inMs: 50, holdMs: 80, outMs: 380, back: 0.22, drop: 0.05,
    bones: { Hips: [-0.2, 0, 0], Spine: [-0.55, 0, 0], Chest: [-0.35, 0, 0], Neck: [-0.5, 0, 0], Head: [-0.6, 0, 0],
      LeftShoulder: [-0.3, 0, 0], RightShoulder: [-0.3, 0, 0], LeftUpperArm: [-0.7, 0, 0], RightUpperArm: [-0.7, 0, 0] } },
  // ガード: 両腕を顔の前へ固めて、頭を縮め、体が軽く後ろへ押される
  guard: { inMs: 40, holdMs: 90, outMs: 240, back: 0.07, drop: 0.03,
    bones: { Spine: [-0.12, 0, 0], Chest: [0.1, 0, 0], Neck: [0.25, 0, 0], Head: [0.2, 0, 0],
      LeftShoulder: [0.1, 0, 0.05], RightShoulder: [0.1, 0, -0.05], LeftUpperArm: [0.1, 0, 0], RightUpperArm: [0.1, 0, 0],
      LeftForearm: [-0.2, 0, 0], RightForearm: [-0.2, 0, 0] } },
};
let enemyReact = { kind: null, at: -1e9, side: 1 };
let enemyHitProbability = ENEMY_HIT_CHANCE;
let enemyForcedResult = null; // テスト用
let punchResolved = true;
const enemyReactMs = (r) => r.inMs + r.holdMs + r.outMs;
function enemyReactAmount(now) {
  if (!enemyReact.kind) return 0;
  const r = ENEMY_REACT[enemyReact.kind], e = now - enemyReact.at;
  if (e < 0 || e >= enemyReactMs(r)) return 0;
  if (e < r.inMs) return easeOutCubic(e / r.inMs);
  if (e < r.inMs + r.holdMs) return 1;
  const t = (e - r.inMs - r.holdMs) / r.outMs;
  return 1 - t * t * (3 - 2 * t);
}
const _eQ = new THREE.Quaternion(), _eE = new THREE.Euler();
function applyEnemyReact(now) {
  const k = enemyReactAmount(now);
  if (k <= 0) return;
  if (enemyReact.kind === "guard" && enemyGuardClipWeight(now) > 0) return; // ガードはクリップで再生中(上乗せは、攻撃中などクリップを使えないときだけ)
  const r = ENEMY_REACT[enemyReact.kind];
  for (const name of Object.keys(r.bones)) {
    const bone = opponentBonesByName[name];
    if (!bone) continue;
    const [x, y, z] = r.bones[name];
    // 被弾のときは、パンチの左右で頭と上体が少しひねられる
    const twist = enemyReact.kind === "hit" && (name === "Head" || name === "Spine") ? 0.35 * enemyReact.side : 0;
    bone.quaternion.premultiply(_eQ.setFromEuler(_eE.set(x * k, (y + twist) * k, z * k)));
  }
  opponent.position.z -= r.back * k; // 敵は+Zを向いているので、-Zが後ろ
  opponent.position.y -= r.drop * k;
}
// プレイヤーのグローブ(手首から前腕の向きへ少し先)が、敵の頭・胸の球に届いたか
function playerGloveReachesEnemy() {
  const p = PUNCHES[punchState.phase];
  const hand = allBonesByName[p.bone], fore = allBonesByName[p.forearm];
  if (!hand || !fore) return false;
  const h = hand.getWorldPosition(new THREE.Vector3()), f = fore.getWorldPosition(new THREE.Vector3());
  const glove = h.clone().add(h.clone().sub(f).normalize().multiplyScalar(PUNCH_GLOVE_FORWARD_M));
  for (const [name, radius] of [["Head", 0.18], ["Chest", 0.24]]) {
    const b = opponentBonesByName[name];
    if (b && glove.distanceTo(b.getWorldPosition(new THREE.Vector3())) <= radius + FIST_RADIUS_M) return true;
  }
  return false;
}
function resolvePlayerPunch(now) {
  const p = PUNCHES[punchState.phase];
  const hit = enemyForcedResult ? enemyForcedResult === "hit" : Math.random() < enemyHitProbability;
  enemyReact = { kind: hit ? "hit" : "guard", at: now, side: punchState.phase === "leftJab" ? 1 : -1 };
  playerDebug(`${p.label}: ${hit ? "HIT (enemy staggers)" : "GUARDED"}`);
  sfx.play(hit ? "enemyHit" : "guard");
  if (hit && enemyState && enemyState.phase === "jab") { enemyAttackResolved = true; enemyState = createEnemyState(now); enemyDebug("Attack interrupted by counter"); }
}
// 毎フレーム: パンチが始まった直後に判定をリセットし、グローブが届いた瞬間(届かなければ後半の途中)に1回だけ結果を出す
function updatePunchResult(now) {
  if (!punchState.phase) { punchResolved = false; return; }
  if (punchResolved) return;
  const elapsed = now - punchState.startAt, total = punchDurationMs(punchState.phase);
  if (playerGloveReachesEnemy() || elapsed > total * 0.6) { punchResolved = true; resolvePlayerPunch(now); }
}

// ---------- レンダーループ ----------
function render() {
  const now = performance.now();
  dodgeState = advanceDodge(dodgeState, now);

  // パンチ・左右の回避(ドジ)・アイドルの構えループは、常にどれか1つだけが
  // ボーン・モデル位置を完全に支配する(完全な排他制御)。優先順位はパンチ > ドジ > アイドルで、
  // どれも行っていないときは常にアイドルの構えループが再生される
  const prevPunch = punchState;
  if (prevPunch.phase) punchState = advancePunch(punchState, now, punchDurationMs(prevPunch.phase));
  if (prevPunch.phase && !punchState.phase) { punchStats.finished++; playerDebug("Return to Idle"); }

  if (punchState.phase && now - playerHitAt < HIT_RECOIL_MS) punchState = createPunchState(); // 被弾でパンチは中断
  if (sling.active) {
    // スリングで引いている間: クリップのテイクバック部分を、ドラッグ量で直接再生
    const sample = sampleSlingPull(now);
    applyClipSample(sample);
    shadowBlob.position.x = sample.modelPosition[0] + 0.05;
  } else if (punchState.phase) {
    // 肩タップのパンチ(IDLEの上に重ねる)。回避はパンチが終わるまで始まらない
    const sample = samplePunchOverIdle(now);
    applyClipSample(sample);
    shadowBlob.position.x = sample.modelPosition[0] + 0.05;
  } else if (dodgeState.phase) {
    const x = computeDodgeX(dodgeState, now);
    const progress = computeDodgeProgress(dodgeState, now);
    const posture = computeDodgePosture(progress);

    player.position.x = x;
    player.position.y = -posture.crouchDrop;
    player.position.z = 0;
    shadowBlob.position.x = x + 0.05;

    if (bones.spine) {
      // アイドル・パンチのクリップだけが操作するボーン(Hips・
      // LeftForearm)は、回避姿勢には含まれないため、ここで明示的に
      // 直立姿勢へ戻しておく(他のクリップの端数が残らないようにする)
      if (bones.hips) bones.hips.quaternion.identity();
      if (bones.leftForearm) bones.leftForearm.quaternion.identity();
      bones.spine.rotation.z = posture.leanZ;
      bones.spine.rotation.x = posture.leanX;
      bones.leftUpperLeg.rotation.x = posture.hipBend;
      bones.rightUpperLeg.rotation.x = posture.hipBend;
      bones.leftLowerLeg.rotation.x = posture.kneeBend;
      bones.rightLowerLeg.rotation.x = posture.kneeBend;
    }
  } else {
    const sample = sampleClip(IDLE_CLIP, computeIdleClipTime(now));
    applyClipSample(sample);
    shadowBlob.position.x = sample.modelPosition[0] + 0.05;
  }

  applySlingExtra(now);
  updateSlingFx(now);
  applyHitRecoil(now);
  updateOpponent(now);
  applyEnemyReact(now);
  updatePunchResult(now);
  updatePunchZoneDebug();

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// テスト/デバッグ用に主要オブジェクトを公開
window.__scene = { scene, camera, player, opponent, ground, grid, bones, allBonesByName: () => allBonesByName, opponentBonesByName: () => opponentBonesByName };
window.__dodge = {
  classifySwipe,
  onSwipe,
  advanceDodge,
  computeDodgeX,
  computeDodgeProgress,
  computeDodgePosture,
  createDodgeState,
  getState: () => dodgeState,
  simulateSwipe: (direction, now) => { dodgeState = onSwipe(dodgeState, direction, now, computeDodgeX(dodgeState, now)); },
};
// アイドル状態(常時構え)のループ再生のテスト/デバッグ用
window.__idle = {
  clip: IDLE_CLIP,
  loopDuration: IDLE_LOOP_DURATION,
  computeIdleClipTime,
  sampleClip,
  isActive: () => !dodgeState.phase,
};

// 相手の攻撃遷移のテスト/デバッグ用
window.__enemy = {
  createEnemyState,
  advanceEnemy,
  pickEnemyWaitMs,
  getState: () => enemyState,
  getLog: () => enemyLog.slice(),
  jabDurationMs: () => (enemyJabClip && enemyWindupClip ? enemyJabDurationMs() : null),
  windupMs: () => (enemyWindupClip ? enemyWindupMs() : null),
  WAIT_MIN_MS: ENEMY_WAIT_MIN_MS,
  WAIT_MAX_MS: ENEMY_WAIT_MAX_MS,
};

// 肩タップのパンチ(左ジャブ・右ストレート)のテスト/デバッグ用
window.__sling = {
  getState: () => ({ ...sling, takebackT: PUNCHES.leftJab.takebackT, takebackTRight: PUNCHES.rightStraight.takebackT }),
  start: (y = 0, kind = "leftJab") => slingStart(y, null, kind),
  setPull: slingSetPull,
  release: () => slingRelease(performance.now()),
  cancel: () => slingCancel(),
  extra: () => slingExtraAmount(performance.now()),
};
window.__punch = {
  createPunchState,
  triggerPunch,
  advancePunch,
  tryPunch,
  findPunchActiveRange,
  gloveScreenZone,
  punchAtScreen,
  getState: () => punchState,
  getStats: () => ({ ...punchStats }),
  getRange: (kind) => PUNCHES[kind].range,
  durationMs: (kind) => (PUNCHES[kind].range ? punchDurationMs(kind) : null),
};

// プレイヤーの被ダメージのテスト/デバッグ用
window.__enemyReact = {
  getState: () => ({ ...enemyReact }),
  amount: () => enemyReactAmount(performance.now()),
  force: (r) => { enemyForcedResult = r; }, // "hit" | "guard" | null
  setHitChance: (v) => { enemyHitProbability = v; },
  trigger: (kind) => { enemyReact = { kind, at: performance.now(), side: 1 }; },
};
window.__combat = {
  MAX_HP: PLAYER_MAX_HP,
  JAB_DAMAGE: ENEMY_JAB_DAMAGE,
  getHp: () => playerHp,
  isKO: () => playerKO,
  isHit: () => isPlayerHit(performance.now()),
  recoilAmount: () => hitRecoilAmount(performance.now()),
  getLog: () => combatLog.slice(),
  setHp: (v) => { playerHp = v; playerKO = v <= 0; updateHpDisplay(performance.now()); },
  applyDamage: (n) => applyPlayerDamage(n, performance.now()),
  // 敵の左ジャブを今すぐ始める(ランダムな待機を待たずに、当たり判定を試すため)
  forceEnemyJab: () => { if (!enemyState || enemyState.phase === "jab") return false; enemyState = { phase: "jab", startAt: performance.now() }; enemyDebug("Left Jab (forced)"); startEnemyAttack(); return true; },
  // テスト用: 敵の次のランダムな攻撃を、指定した時間だけ先へ延ばす(待機中のみ)
  postponeEnemy: (ms) => { if (enemyState && enemyState.phase === null || enemyState && enemyState.phase === "idle") enemyState = { ...enemyState, nextAttackAt: performance.now() + ms }; },
  enemyFistWorldPos: () => { const f = enemyFistWorldPos(); return f ? f.toArray() : null; },
  testFistAgainstPlayer: () => { const f = enemyFistWorldPos(); return f ? testFistAgainstPlayer(f) : null; },
};
