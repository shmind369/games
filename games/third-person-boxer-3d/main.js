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
// 横方向の移動が縦方向より十分大きい場合は左右スワイプ、縦方向の移動が
// 横方向より十分大きく、かつ下向きの場合は下スワイプ(しゃがみ込み)と
// みなす(上スワイプは今回のスコープに含まれないため未対応のまま)
function classifySwipe(dx, dy, dt) {
  if (dt > SWIPE_MAX_MS) return null;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx >= SWIPE_THRESHOLD_PX && adx > ady * 1.2) {
    return dx < 0 ? "left" : "right";
  }
  if (ady >= SWIPE_THRESHOLD_PX && ady > adx * 1.2 && dy > 0) {
    return "down";
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

// ---------- 下スワイプでのしゃがみ込み(humanoid-gltf-exporterで作成した ----------
// ポーズアニメーションJSONを再生する、小さなクリッププレイヤー)
// クリップのデータ構造(pose: 各ボーンの姿勢、modelPosition: ModelRootの
// 絶対座標)は、humanoid-gltf-exporter側のキーフレームシステムとそのまま
// 互換性がある。このゲームでは、そのうちの1本(しゃがみ込みながら
// 後方へ沈み込むポーズ)をアセットとして同梱し、下スワイプで再生する
const DUCK_CLIP = {
  keyframes: [
    {
      time: 0,
      pose: {
        Hips: [0, 0, 0, 1], Spine: [0, 0, 0, 1], Chest: [0, 0, 0, 1], Neck: [0, 0, 0, 1], Head: [0, 0, 0, 1],
        LeftShoulder: [0, 0, 0, 1], LeftUpperArm: [0, 0, 0, 1], LeftForearm: [0, 0, 0, 1], LeftHand: [0, 0, 0, 1],
        RightShoulder: [0, 0, 0, 1], RightUpperArm: [0, 0, 0, 1], RightForearm: [0, 0, 0, 1], RightHand: [0, 0, 0, 1],
        LeftUpperLeg: [0, 0, 0, 1], LeftLowerLeg: [0, 0, 0, 1], LeftFoot: [0, 0, 0, 1],
        RightUpperLeg: [0, 0, 0, 1], RightLowerLeg: [0, 0, 0, 1], RightFoot: [0, 0, 0, 1],
      },
      modelPosition: [0, 0, 0],
    },
    {
      time: 0.5,
      pose: {
        Hips: [0.00854071962748727, 0, 0, 0.9999635273889966], Spine: [0, 0, 0, 1], Chest: [0, 0, 0, 1], Neck: [0, 0, 0, 1], Head: [0, 0, 0, 1],
        LeftShoulder: [0, 0, 0, 1], LeftUpperArm: [0, 0, 0, 1], LeftForearm: [-0.8966347975492622, 0, 0, 0.44277086605127214], LeftHand: [0, 0, 0, 1],
        RightShoulder: [0, 0, 0, 1], RightUpperArm: [0, 0, 0, 1], RightForearm: [0, 0, 0, 1], RightHand: [0, 0, 0, 1],
        LeftUpperLeg: [-0.6836714393495077, 0, 0, 0.729789944448245], LeftLowerLeg: [-0.7248182352526064, 0, 0, -0.6889401467800358], LeftFoot: [0, 0, 0, 1],
        RightUpperLeg: [0, 0, 0, 1], RightLowerLeg: [-0.741607709700769, 0, 0, -0.6708338131850391], RightFoot: [0, 0, 0, 1],
      },
      modelPosition: [-0.02706766917293233, -0.4035087719298246, -0.412781954887218],
    },
    {
      time: 0.9,
      pose: {
        Hips: [0.00854071962748727, 0, 0, 0.9999635273889966], Spine: [0, 0, 0, 1], Chest: [0, 0, 0, 1], Neck: [0, 0, 0, 1], Head: [0, 0, 0, 1],
        LeftShoulder: [0, 0, 0, 1], LeftUpperArm: [0, 0, 0, 1], LeftForearm: [-0.8966347975492622, 0, 0, 0.44277086605127214], LeftHand: [0, 0, 0, 1],
        RightShoulder: [0, 0, 0, 1], RightUpperArm: [0, 0, 0, 1], RightForearm: [0, 0, 0, 1], RightHand: [0, 0, 0, 1],
        LeftUpperLeg: [-0.6836714393495077, 0, 0, 0.729789944448245], LeftLowerLeg: [-0.7248182352526064, 0, 0, -0.6889401467800358], LeftFoot: [0, 0, 0, 1],
        RightUpperLeg: [0, 0, 0, 1], RightLowerLeg: [-0.741607709700769, 0, 0, -0.6708338131850391], RightFoot: [0, 0, 0, 1],
      },
      modelPosition: [-0.013533834586466165, -0.4035087719298246, -0.42180451127819535],
    },
  ],
};
const DUCK_CLIP_END_TIME = DUCK_CLIP.keyframes[DUCK_CLIP.keyframes.length - 1].time;
// クリップ本来のテンポ(0→0.9秒でしゃがみ込む)を、しゃがむ方向・戻る方向の
// 両方にそのまま使う(対称な速さで、しゃがんで→戻る、という動作にする)
const DUCK_OUT_MS = DUCK_CLIP_END_TIME * 1000;
const DUCK_RETURN_MS = DUCK_CLIP_END_TIME * 1000;

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

// しゃがみ込みの状態機械(Three.js非依存の純粋関数。既存の左右スワイプ回避
// (dodgeState)と同じ「out→return→ニュートラル」という構成にしている)
function createDuckState() { return { phase: null, startAt: 0 }; }

function triggerDuck(state, now) {
  if (state.phase) return state; // 再生中は多重起動しない
  return { phase: "out", startAt: now };
}

function advanceDuck(state, now) {
  if (!state.phase) return state;
  const dur = state.phase === "out" ? DUCK_OUT_MS : DUCK_RETURN_MS;
  if (now - state.startAt < dur) return state;
  if (state.phase === "out") return { phase: "return", startAt: now };
  return createDuckState();
}

// 現在のduckStateから、クリップ上の再生時刻(秒)を求める。
// outフェーズは0→クリップ終端、returnフェーズはクリップ終端→0と、
// クリップを逆再生することでしゃがんだ姿勢から自然に元の姿勢へ戻す
function computeDuckClipTime(state, now) {
  if (!state.phase) return 0;
  const dur = state.phase === "out" ? DUCK_OUT_MS : DUCK_RETURN_MS;
  const t = clamp01((now - state.startAt) / dur);
  return state.phase === "out" ? DUCK_CLIP_END_TIME * t : DUCK_CLIP_END_TIME * (1 - t);
}

// 参照画像(スーパーパンチアウト風)の構図を再現するためのカメラパラメータ。
// 手前に背中を向けたプレイヤー(頭が画面の中ほど、腰より上が映る)、その奥に
// 向かい合う相手(頭が画面の上のほう、プレイヤーの約半分の大きさ)が並んで見えるよう、
// カメラを高めに置いて見下ろす。プレイヤーの頭・相手の頭・プレイヤーの腰の
// 画面上の高さが参照画像に近づくよう、距離と高さと角度を計算して決めた
// (縦FOV42°で、頭頂が画面の約49%・約20%の位置、プレイヤーの腰が約88%の位置。
// 相手はプレイヤーの約1.7m先にいて、画面上の大きさはプレイヤーの約半分)。
// キャラクターは原点に立ち、背中をカメラ側(+Z)に向けている(-Z方向を向く)。
const CAMERA_FOV_DEG = 42;
const CAMERA_HEIGHT = 2.55;
const CAMERA_DISTANCE = 1.8;
const LOOK_AT_HEIGHT = 1.67;

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
const OPPONENT_BASE = new THREE.Vector3(0.1, 0, -1.7);
const opponent = new THREE.Group();
opponent.position.copy(OPPONENT_BASE);
scene.add(opponent);

const bones = { spine: null, leftUpperLeg: null, rightUpperLeg: null, leftLowerLeg: null, rightLowerLeg: null };
// しゃがみ込みクリップ(DUCK_CLIP)はSpine/LeftUpperLeg等だけでなく、Hips・
// LeftForearmなど回避動作では使っていないボーンも操作するため、ボーン名で
// 引けるマップを別途用意する(将来別のクリップを追加する場合もそのまま
// 流用できる汎用的な仕組みにしている)
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
const ENEMY_BLEND_IN_MS = 120; // Idle→ジャブの頭で、Idleの姿勢からジャブの姿勢へなじませる時間
const ENEMY_BLEND_OUT_MS = 150; // ジャブの終わりで、ジャブの姿勢からIdleの姿勢へなじませる時間

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
const enemyLog = []; // テスト用: ["Idle", "Next attack in 7.3s", "Left Jab", "Return to Idle", ...]
function enemyDebug(message) {
  enemyLog.push({ t: performance.now(), message });
  console.log("[Enemy] " + message);
}
function enemyJabDurationMs() { return enemyJabClip.keyframes[enemyJabClip.keyframes.length - 1].time * 1000; }

fetch("./assets/leftPunchUsa1.json")
  .then((res) => res.json())
  .then((json) => { enemyJabClip = json; })
  .catch((err) => console.error("leftPunchUsa1.json の読み込みに失敗しました", err));

function stepEnemyState(now) {
  if (!opponentIdleClip || !enemyJabClip) return;
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
    enemyDebug("Left Jab");
  } else {
    enemyDebug("Return to Idle");
    enemyDebug(`Next attack in ${(enemyState.waitMs / 1000).toFixed(1)}s`);
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
  if (enemyState && enemyState.phase === "jab" && enemyJabClip) {
    const elapsedMs = nowMs - enemyState.startAt;
    const jabMs = enemyJabDurationMs();
    const w = clamp01(Math.min(elapsedMs / ENEMY_BLEND_IN_MS, (jabMs - elapsedMs) / ENEMY_BLEND_OUT_MS));
    const jab = sampleClip(enemyJabClip, Math.min(elapsedMs / 1000, jabMs / 1000));
    for (const name of Object.keys(jab.pose)) {
      sample.pose[name] = sample.pose[name] ? sample.pose[name].clone().slerp(jab.pose[name], w) : jab.pose[name];
    }
    sample.modelPosition = sample.modelPosition.map((v, i) => v + (jab.modelPosition[i] - v) * w);
  }
  for (const name of Object.keys(sample.pose)) {
    const bone = opponentBonesByName[name];
    if (bone) bone.quaternion.copy(sample.pose[name]);
  }
  opponent.position.set(OPPONENT_BASE.x + sample.modelPosition[0], OPPONENT_BASE.y + sample.modelPosition[1], OPPONENT_BASE.z + sample.modelPosition[2]);
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

// ---------- 入力(左右スワイプ・下スワイプ) ----------
let dodgeState = createDodgeState();
let duckState = createDuckState();
let gestureStart = null;
function pointerPos(evt) { return { x: evt.clientX, y: evt.clientY }; }
function onPointerDown(evt) {
  gestureStart = { ...pointerPos(evt), t: performance.now() };
}
function onPointerUp(evt) {
  if (!gestureStart) return;
  const end = pointerPos(evt);
  const now = performance.now();
  const dx = end.x - gestureStart.x, dy = end.y - gestureStart.y, dt = now - gestureStart.t;
  gestureStart = null;
  const direction = classifySwipe(dx, dy, dt);
  if (!direction) return;
  // しゃがみ込み中は、一連の動作(しゃがむ→戻る)が終わるまで新しい入力を
  // 受け付けない(左右の回避移動としゃがみ込みが同時に競合しないようにする)
  if (duckState.phase) return;
  if (direction === "down") {
    duckState = triggerDuck(duckState, now);
    dodgeState = createDodgeState(); // 進行中の回避があれば、しゃがみ込みで打ち切る
    return;
  }
  dodgeState = onSwipe(dodgeState, direction, now, computeDodgeX(dodgeState, now));
}
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", () => { gestureStart = null; });

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
function render() {
  const now = performance.now();
  duckState = advanceDuck(duckState, now);
  dodgeState = advanceDodge(dodgeState, now);

  // しゃがみ込み(ダウン)・左右の回避(ドジ)・アイドルの構えループは、
  // 常にどれか1つだけがボーン・モデル位置を完全に支配する(3状態の
  // 完全な排他制御)。優先順位はダウン > ドジ > アイドルで、ドジも
  // ダウンも行っていないときは常にアイドルの構えループが再生される
  if (duckState.phase) {
    const clipTime = computeDuckClipTime(duckState, now);
    const sample = sampleClip(DUCK_CLIP, clipTime);
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
      // しゃがみ込み・アイドルのクリップだけが操作するボーン(Hips・
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

  updateOpponent(now);

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
// しゃがみ込み(下スワイプ)のテスト/デバッグ用
window.__duck = {
  createDuckState,
  triggerDuck,
  advanceDuck,
  computeDuckClipTime,
  sampleClip,
  clip: DUCK_CLIP,
  clipEndTime: DUCK_CLIP_END_TIME,
  getState: () => duckState,
  simulateDown: (now) => { duckState = triggerDuck(duckState, now); dodgeState = createDodgeState(); },
};
// アイドル状態(常時構え)のループ再生のテスト/デバッグ用
window.__idle = {
  clip: IDLE_CLIP,
  loopDuration: IDLE_LOOP_DURATION,
  computeIdleClipTime,
  sampleClip,
  isActive: () => !duckState.phase && !dodgeState.phase,
};

// 相手の攻撃遷移のテスト/デバッグ用
window.__enemy = {
  createEnemyState,
  advanceEnemy,
  pickEnemyWaitMs,
  getState: () => enemyState,
  getLog: () => enemyLog.slice(),
  jabDurationMs: () => (enemyJabClip ? enemyJabDurationMs() : null),
  WAIT_MIN_MS: ENEMY_WAIT_MIN_MS,
  WAIT_MAX_MS: ENEMY_WAIT_MAX_MS,
};
