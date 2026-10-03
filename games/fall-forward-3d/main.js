import * as THREE from "three";

// ============================================================
// FALL FORWARD — 「足を出して前に進む」のではなく、
// 「前に倒れた結果、足で支えて前進する」ことを核にしたタイムアタック。
//
// 核となるルール(企画書より):
// - 身体は常に一定の角速度で前へ倒れ続ける
// - タップで足を出す。その瞬間の傾き具合によって進む距離が変わる
//   (倒れ切る直前ほど大きく進む。早すぎると少ししか進まない)
// - 倒れ角度が限界を超える前にタップできなければ転倒=ゲームオーバー
// - ゴールまでのタイムを計測するタイムアタック
//
// ロジック(advanceTime/tapStep等)はThree.js・DOMに依存しない純粋な
// 関数として実装しており、タイミングがシビアなゲーム性の検証を
// decoupleした形でテストできるようにしている。
// ============================================================

// ---------- ゲームロジック(純粋関数。Three.js/DOM非依存) ----------
const FALL_RATE_DEG_PER_SEC = 65; // 身体が前へ倒れていく角速度
const MAX_LEAN_DEG = 72; // これに達すると転倒(ゲームオーバー)
const BASE_STEP = 1.6; // 倒れ切る直前(傾き=限界)で出した一歩の進行距離
const MIN_STEP_FRACTION = 0.08; // 傾きがほぼ0でも最低限は進む下限割合
const GOAL_DISTANCE = 40; // ゴールまでの距離

function createGameState(goalDistance = GOAL_DISTANCE) {
  return {
    leanDeg: 0,
    distance: 0,
    elapsed: 0,
    steps: 0,
    running: false, // スタート前/終了後はfalse(倒れも進行もしない)
    gameOver: false,
    cleared: false,
    goalDistance,
    lastStepFraction: 0, // 直近の一歩の評価(0〜1。演出・デバッグ用)
  };
}

// 時間経過による「前へ倒れていく」処理。限界角度に達したら転倒させる
function advanceTime(state, dtSeconds) {
  if (!state.running || state.gameOver || state.cleared) return state;
  state.elapsed += dtSeconds;
  state.leanDeg += FALL_RATE_DEG_PER_SEC * dtSeconds;
  if (state.leanDeg >= MAX_LEAN_DEG) {
    state.leanDeg = MAX_LEAN_DEG;
    state.gameOver = true;
    state.running = false;
  }
  return state;
}

// 現在の傾きで今タップした場合に進む距離を計算する(表示用にも使う:
// 「今タップしたらどれだけ進むか」を足の伸びとして可視化している)
function computeStepResult(leanDeg) {
  const fraction = Math.max(0, Math.min(1, leanDeg / MAX_LEAN_DEG));
  const eased = fraction * fraction; // 倒れ切る直前ほど急激に伸びるカーブ
  const distance = BASE_STEP * (MIN_STEP_FRACTION + (1 - MIN_STEP_FRACTION) * eased);
  return { distance, fraction };
}

// タップ=足を出す。着地した瞬間に初めて前進し、姿勢を立て直す(傾き0に戻る)
function tapStep(state) {
  if (!state.running || state.gameOver || state.cleared) return state;
  const { distance, fraction } = computeStepResult(state.leanDeg);
  state.distance += distance;
  state.steps += 1;
  state.lastStepFraction = fraction;
  state.leanDeg = 0;
  if (state.distance >= state.goalDistance) {
    state.distance = state.goalDistance;
    state.cleared = true;
    state.running = false;
  }
  return state;
}

function startRun(state) {
  state.running = true;
  return state;
}

// ---------- Renderer / Scene ----------
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.fog = new THREE.Fog(0x0d1117, 14, 34);

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(4, 8, 6);
scene.add(keyLight);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
const CAMERA_HEIGHT = 2.0;
const CAMERA_BACK = 0.6; // キャラクターよりわずかに後ろから見る(進行方向が見えるように)
const CAMERA_SIDE_DIST = 7.5; // サイドビュー: Z方向に大きく離れて横から見る

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- 地面・コース ----------
const groundGeo = new THREE.PlaneGeometry(200, 20);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 1 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(80, 0, 0);
scene.add(ground);

// 進んだ距離が分かりやすいよう、1ユニットごとに目盛り線を置く
const tickGroup = new THREE.Group();
scene.add(tickGroup);
const tickGeo = new THREE.BoxGeometry(0.04, 0.02, 1.6);
const tickMat = new THREE.MeshBasicMaterial({ color: 0x2c3850 });
for (let x = 0; x <= GOAL_DISTANCE + 2; x += 1) {
  const tick = new THREE.Mesh(tickGeo, tickMat);
  tick.position.set(x, 0.011, 0);
  tickGroup.add(tick);
}

// ゴール地点の旗
const flagGroup = new THREE.Group();
const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 2.2, 8);
const poleMat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
const pole = new THREE.Mesh(poleGeo, poleMat);
pole.position.y = 1.1;
flagGroup.add(pole);
const flagGeo = new THREE.PlaneGeometry(0.6, 0.4);
const flagMat = new THREE.MeshStandardMaterial({ color: 0x6fe3ff, side: THREE.DoubleSide });
const flag = new THREE.Mesh(flagGeo, flagMat);
flag.position.set(0.3, 1.9, 0);
flagGroup.add(flag);
flagGroup.position.set(GOAL_DISTANCE, 0, 0);
scene.add(flagGroup);

// ---------- キャラクター ----------
// 詳細な関節モデルではなく、「支点(接地している足)を中心に身体が
// 前へ傾く」という核のルールが一目で伝わることを優先した簡易構成:
// - hipPivot: 現在接地している足の位置(=キャラクターの現在地)
// - body: hipPivotを支点に前方(X軸方向)へ傾く胴体+頭
// - backLeg: hipPivotから胴体の付け根までを結ぶ軸足
// - frontLeg: 「今タップしたら着地する位置」まで伸びる前足
//   (傾くほど・タップが近いほど前方に伸びる=進む量の視覚的な予告になる)
const character = new THREE.Group();
scene.add(character);

const hipPivot = new THREE.Group();
character.add(hipPivot);

const HIP_HEIGHT = 0.9;
const bodyPivot = new THREE.Group(); // ここを回転させることで「hipPivotを中心に前へ傾く」を表現する
bodyPivot.position.set(0, HIP_HEIGHT, 0);
hipPivot.add(bodyPivot);

const torsoGeo = new THREE.CapsuleGeometry(0.22, 0.5, 4, 8);
const torsoMat = new THREE.MeshStandardMaterial({ color: 0x4c8dff, roughness: 0.6 });
const torso = new THREE.Mesh(torsoGeo, torsoMat);
torso.position.y = 0.35;
bodyPivot.add(torso);

const headGeo = new THREE.SphereGeometry(0.18, 16, 12);
const headMat = new THREE.MeshStandardMaterial({ color: 0xffd9b3, roughness: 0.7 });
const head = new THREE.Mesh(headGeo, headMat);
head.position.y = 0.75;
bodyPivot.add(head);

// 軸足(接地点〜腰)。頂点2点を結ぶ線として毎フレーム引き直す
const legMat = new THREE.LineBasicMaterial({ color: 0xaab4c8, linewidth: 2 });
const backLegGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const backLeg = new THREE.Line(backLegGeo, legMat);
character.add(backLeg);

const frontLegMat = new THREE.LineBasicMaterial({ color: 0xffd23d, linewidth: 2 });
const frontLegGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const frontLeg = new THREE.Line(frontLegGeo, frontLegMat);
character.add(frontLeg);

// 「今タップしたら着地する位置」を示す足跡マーカー
const nextFootMarkerGeo = new THREE.RingGeometry(0.08, 0.12, 16);
const nextFootMarkerMat = new THREE.MeshBasicMaterial({ color: 0xffd23d, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
const nextFootMarker = new THREE.Mesh(nextFootMarkerGeo, nextFootMarkerMat);
nextFootMarker.rotation.x = -Math.PI / 2;
nextFootMarker.position.y = 0.012;
scene.add(nextFootMarker);

// ---------- ゲーム状態・入力 ----------
let state = createGameState(GOAL_DISTANCE);
let visualX = 0; // カメラ・キャラクターの表示位置(ロジックのdistanceへ毎フレーム補間)
let visualLeanDeg = 0; // 見た目の傾き(ロジックのleanDegへ毎フレーム補間。着地の瞬間の急な戻りを滑らかに見せる)
let bestTime = null;

const timerEl = document.getElementById("timer");
const bestTimeEl = document.getElementById("bestTime");
const progressFillEl = document.getElementById("progressFill");
const leanMeterFillEl = document.getElementById("leanMeterFill");
const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");
const gameOverOverlay = document.getElementById("gameOverOverlay");
const gameOverTimeEl = document.getElementById("gameOverTime");
const gameOverBestEl = document.getElementById("gameOverBest");
const retryFromGameOverBtn = document.getElementById("retryFromGameOverBtn");
const clearOverlay = document.getElementById("clearOverlay");
const clearTimeEl = document.getElementById("clearTime");
const clearBestEl = document.getElementById("clearBest");
const retryFromClearBtn = document.getElementById("retryFromClearBtn");

function formatTime(sec) {
  return `${sec.toFixed(2)}s`;
}

function updateBestTimeDisplay() {
  const text = bestTime == null ? "BEST --" : `BEST ${formatTime(bestTime)}`;
  bestTimeEl.textContent = text;
  gameOverBestEl.textContent = text;
  clearBestEl.textContent = text;
}

function showOverlay(el) { el.classList.remove("hidden"); }
function hideOverlay(el) { el.classList.add("hidden"); }

function resetGame() {
  state = createGameState(GOAL_DISTANCE);
  visualX = 0;
  visualLeanDeg = 0;
  hideOverlay(gameOverOverlay);
  hideOverlay(clearOverlay);
  showOverlay(startOverlay);
}

function beginRun() {
  hideOverlay(startOverlay);
  startRun(state);
}

// 転倒(gameOver)・ゴール(cleared)への遷移を検知してオーバーレイを出す。
// タップで足を出した瞬間(tapStep経由)だけでなく、タップせずに時間切れで
// 転倒した場合(advanceTime経由、レンダーループから呼ばれる)の両方で
// 同じように結果画面を出す必要があるため、1箇所にまとめている
function checkRunEndTransition() {
  if (state.gameOver && gameOverOverlay.classList.contains("hidden")) {
    // 転倒はクリアしていないため、ベストタイムは更新しない
    gameOverTimeEl.textContent = formatTime(state.elapsed);
    updateBestTimeDisplay();
    showOverlay(gameOverOverlay);
  } else if (state.cleared && clearOverlay.classList.contains("hidden")) {
    clearTimeEl.textContent = formatTime(state.elapsed);
    if (bestTime == null || state.elapsed < bestTime) {
      bestTime = state.elapsed;
    }
    updateBestTimeDisplay();
    showOverlay(clearOverlay);
  }
}

function handleTap() {
  if (!state.running) return; // スタート前・終了後のタップは無視(オーバーレイのボタンで処理する)
  tapStep(state);
  checkRunEndTransition();
}

canvas.addEventListener("pointerdown", handleTap);
startBtn.addEventListener("click", beginRun);
retryFromGameOverBtn.addEventListener("click", resetGame);
retryFromClearBtn.addEventListener("click", resetGame);

// ---------- レンダーループ ----------
const VISUAL_LERP_SPEED = 14; // 見た目(カメラ・キャラ位置、傾きの戻り)の追従速度
let lastTime = performance.now();
// テスト用: trueの間は実時間によるadvanceTimeを止め、__advanceTimeRaw等で
// タイミングをシビアに決定的に検証できるようにする(見た目の描画自体は
// 止めない。実際のプレイでは常にfalseのまま)
let testTimeFrozen = false;

function render(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000); // タブ非アクティブ復帰時の大ジャンプを防ぐ
  lastTime = now;

  if (!testTimeFrozen) {
    advanceTime(state, dt);
    checkRunEndTransition(); // タップせず時間切れで転倒した場合もここで検知する
  }
  timerEl.textContent = formatTime(state.elapsed);
  progressFillEl.style.width = `${Math.min(100, (state.distance / state.goalDistance) * 100)}%`;
  leanMeterFillEl.style.height = `${Math.min(100, (state.leanDeg / MAX_LEAN_DEG) * 100)}%`;

  // 見た目はロジック値へ指数的に追従させ、着地の瞬間の傾き0への
  // 戻りや、転倒寸前の急な動きを不自然にジャンプさせず滑らかに見せる
  const lerpT = 1 - Math.exp(-VISUAL_LERP_SPEED * dt);
  visualX += (state.distance - visualX) * lerpT;
  visualLeanDeg += (state.leanDeg - visualLeanDeg) * lerpT;

  character.position.x = visualX;
  bodyPivot.rotation.z = -THREE.MathUtils.degToRad(visualLeanDeg);

  const hipWorld = new THREE.Vector3();
  bodyPivot.getWorldPosition(hipWorld);
  const localHip = character.worldToLocal(hipWorld.clone());
  backLeg.geometry.setFromPoints([new THREE.Vector3(0, 0, 0), localHip]);

  const stepNow = computeStepResult(state.leanDeg);
  const frontFootLocalX = stepNow.distance; // 現在のdistanceからの相対位置(character.position.xはvisualX基準なので0起点でよい)
  frontLeg.geometry.setFromPoints([localHip, new THREE.Vector3(frontFootLocalX, 0, 0)]);
  nextFootMarker.position.x = visualX + frontFootLocalX;

  // カメラ: サイドビューでキャラクターに追従(わずかに進行方向を向く)
  const camTargetX = visualX + CAMERA_BACK;
  camera.position.x += (camTargetX - camera.position.x) * lerpT;
  camera.position.y = CAMERA_HEIGHT;
  camera.position.z = CAMERA_SIDE_DIST;
  camera.lookAt(camera.position.x, 1.0, 0);

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
camera.position.set(CAMERA_BACK, CAMERA_HEIGHT, CAMERA_SIDE_DIST);
requestAnimationFrame(render);

updateBestTimeDisplay();

// ---------- テスト/デバッグ用に主要オブジェクトを公開 ----------
window.__scene = { scene, camera, renderer, character, ground, flagGroup };
window.__game = {
  getState: () => ({ ...state }),
  createGameState,
  advanceTime: (dtSeconds) => advanceTime(state, dtSeconds),
  tapStep: () => { handleTap(); return { ...state }; },
  computeStepResult,
  startRun: () => { beginRun(); return { ...state }; },
  resetGame: () => { resetGame(); return { ...state }; },
  getBestTime: () => bestTime,
  getConstants: () => ({ FALL_RATE_DEG_PER_SEC, MAX_LEAN_DEG, BASE_STEP, MIN_STEP_FRACTION, GOAL_DISTANCE }),
  isOverlayVisible: (name) => {
    const map = { start: startOverlay, gameOver: gameOverOverlay, clear: clearOverlay };
    const el = map[name];
    return el ? !el.classList.contains("hidden") : null;
  },
  getVisualX: () => visualX,
  getVisualLeanDeg: () => visualLeanDeg,
  // 決定論的なテスト用: レンダーループの実時間によるadvanceTimeを止めた上で、
  // ロジックだけを直接操作する(アニメーション追従を待たない経路)
  setTestTimeFrozen: (frozen) => { testTimeFrozen = frozen; },
  __advanceTimeRaw: (dtSeconds) => { const s = advanceTime(state, dtSeconds); checkRunEndTransition(); return { ...s }; },
  __tapStepRaw: () => { const s = tapStep(state); checkRunEndTransition(); return { ...s }; },
};
