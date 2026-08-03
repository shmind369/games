import * as THREE from "three";

// ---------- Tuning ----------
const PITCH_DISTANCE = 18; // mound-to-plate, world units
const TOTAL_PITCHES = 10;
const SPEED_MIN_KMH = 110;
const SPEED_MAX_KMH = 150;
// Real pitch flight times (~0.4-0.6s) are too fast for a touchscreen
// reaction game, so displayed speed and actual timing are decoupled: this
// scales the physics-derived flight time up to something learnable while
// keeping "138km/h"-style numbers on screen for flavor.
const GAME_TIME_SCALE = 2.4;
const GRACE_AFTER_ARRIVAL_MS = 200; // no-swing auto-strike delay

// Swing timing windows, as a fraction of that pitch's flight time — this
// makes faster pitches have proportionally tighter windows, same as the
// display speed implies, without tracking a separate difficulty knob.
const PERFECT_FRAC = 0.08;
const GOOD_FRAC = 0.18;
const FOUL_FRAC = 0.32;

const RESULT_DISPLAY_MS = 1100;

// ---------- Pure swing evaluation (kept separate from animation/DOM so it
// can be tested directly with synthetic timings) ----------
function flightTimeMs(speedKmh) {
  const metersPerSecond = speedKmh / 3.6;
  return (PITCH_DISTANCE / metersPerSecond) * GAME_TIME_SCALE * 1000;
}

// `errorMs` is (tapTime - idealContactTime); null means no swing occurred.
function evaluateSwing(errorMs, travelMs) {
  if (errorMs === null) return "look"; // 見逃し
  const absError = Math.abs(errorMs);
  if (absError <= travelMs * PERFECT_FRAC) return "homerun";
  if (absError <= travelMs * GOOD_FRAC) return "hit";
  if (absError <= travelMs * FOUL_FRAC) return "foul";
  return "miss"; // 空振り
}

const OUTCOME_INFO = {
  homerun: { label: "ホームラン!", score: 4, color: "#ffd23f", isHit: true, isHomer: true },
  hit: { label: "ヒット!", score: 2, color: "#7be08c", isHit: true, isHomer: false },
  foul: { label: "ファウル", score: 0, color: "#9aa4b2", isHit: false, isHomer: false },
  miss: { label: "空振り...", score: 0, color: "#ff6b6b", isHit: false, isHomer: false },
  look: { label: "見逃し...", score: 0, color: "#ff6b6b", isHit: false, isHomer: false },
};

// ---------- Scene setup ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd0ff);
scene.fog = new THREE.Fog(0x8fd0ff, 22, 42);

// Third-person, over-the-shoulder: pulled back and to the side of the
// batter so their swing is visible, rather than a strict first-person
// view where only the bat would ever be on screen.
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(2.6, 2.6, 5.2);
camera.lookAt(0.3, 1.4, -PITCH_DISTANCE * 0.4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", handleResize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", handleResize);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(8, 20, 6);
sun.castShadow = true;
scene.add(sun);

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x3f9142, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.z = -18;
ground.receiveShadow = true;
scene.add(ground);

// Dirt infield circle around the plate
const dirt = new THREE.Mesh(
  new THREE.CircleGeometry(3.2, 24),
  new THREE.MeshStandardMaterial({ color: 0xb98552, roughness: 1 })
);
dirt.rotation.x = -Math.PI / 2;
dirt.position.set(0, 0.01, -1.5);
scene.add(dirt);

// Pitcher's mound
const mound = new THREE.Mesh(
  new THREE.CylinderGeometry(1.4, 1.6, 0.25, 20),
  new THREE.MeshStandardMaterial({ color: 0xa9754a, roughness: 1 })
);
mound.position.set(0, 0.12, -PITCH_DISTANCE + 1);
scene.add(mound);

// Very simple pitcher figure (just enough to sell "someone is throwing")
const pitcher = new THREE.Group();
const pitcherBody = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.28, 0.9, 4, 8),
  new THREE.MeshStandardMaterial({ color: 0xe4e4e4 })
);
pitcherBody.position.y = 1.1;
pitcherBody.castShadow = true;
const pitcherCap = new THREE.Mesh(
  new THREE.SphereGeometry(0.2, 12, 12),
  new THREE.MeshStandardMaterial({ color: 0x2c4a8f })
);
pitcherCap.position.y = 1.75;
pitcher.add(pitcherBody, pitcherCap);
pitcher.position.set(0, 0.25, -PITCH_DISTANCE + 1);
scene.add(pitcher);

// Outfield fence, just for a sense of distance / home-run reference
const fence = new THREE.Mesh(
  new THREE.BoxGeometry(34, 2.2, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.9 })
);
fence.position.set(0, 1.1, -34);
scene.add(fence);

// Home plate
const plate = new THREE.Mesh(
  new THREE.CircleGeometry(0.35, 5),
  new THREE.MeshStandardMaterial({ color: 0xffffff })
);
plate.rotation.x = -Math.PI / 2;
plate.position.set(0, 0.02, 0);
scene.add(plate);

// Ball
const ball = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 14, 14),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
);
ball.castShadow = true;
ball.visible = false;
scene.add(ball);

// Batter figure, standing just beside the plate facing the pitcher.
const BATTER_POS = { x: 0.55, z: 0.35 };
const batter = new THREE.Group();
const batterBody = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.26, 0.85, 4, 8),
  new THREE.MeshStandardMaterial({ color: 0xf5f5f5 })
);
batterBody.position.y = 1.05;
batterBody.castShadow = true;
const batterHead = new THREE.Mesh(
  new THREE.SphereGeometry(0.18, 12, 12),
  new THREE.MeshStandardMaterial({ color: 0xe0b088 })
);
batterHead.position.y = 1.68;
batterHead.castShadow = true;
const batterCap = new THREE.Mesh(
  new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0xc23b3b })
);
batterCap.position.y = 1.72;
batter.add(batterBody, batterHead, batterCap);
batter.position.set(BATTER_POS.x, 0, BATTER_POS.z);
batter.rotation.y = -0.35; // angled toward the pitcher, not square-on
scene.add(batter);

// Bat: a pivot group at the batter's hands with the bat mesh extending
// out horizontally from it, so swinging is a rotation around the pivot's
// *vertical* (Y) axis — a level, horizontal swing — rather than around Z,
// which would chop straight down at the ground.
const BAT_LENGTH = 0.9;
const batGeo = new THREE.CylinderGeometry(0.035, 0.06, BAT_LENGTH, 10);
batGeo.rotateZ(Math.PI / 2); // lay the cylinder along local +X
batGeo.translate(BAT_LENGTH / 2, 0, 0); // hands (pivot) at one end, tip at the other
const bat = new THREE.Mesh(batGeo, new THREE.MeshStandardMaterial({ color: 0xc99a52 }));
bat.castShadow = true;
const batPivot = new THREE.Group();
batPivot.add(bat);
batPivot.position.set(-0.1, 1.2, 0.15); // roughly hand height, relative to batter
batPivot.rotation.y = -2.1; // resting, cocked-back stance
batter.add(batPivot);

// ---------- HUD elements ----------
const pitchCountEl = document.getElementById("pitchCount");
const pitchTotalEl = document.getElementById("pitchTotal");
const homerCountEl = document.getElementById("homerCount");
const scoreEl = document.getElementById("score");
const speedTagEl = document.getElementById("speedTag");
const resultBannerEl = document.getElementById("resultBanner");
const startOverlayEl = document.getElementById("startOverlay");
const overlayEl = document.getElementById("overlay");
const overlayStatsEl = document.getElementById("overlayStats");
const swingLayerEl = document.getElementById("swingLayer");

pitchTotalEl.textContent = String(TOTAL_PITCHES);

// ---------- Game state ----------
let pitchIndex = 0;
let score = 0;
let hitCount = 0;
let homerCount = 0;
let started = false;
let gameOver = false;

let pitchActive = false;
let swingLocked = true;
let pitchStartMs = 0;
let travelMs = 0;
let currentSpeedKmh = 0;
let startX = 0;
let endX = 0;
let strikeTimeoutId = null;

function startPitch() {
  pitchActive = true;
  swingLocked = false;
  currentSpeedKmh = SPEED_MIN_KMH + Math.random() * (SPEED_MAX_KMH - SPEED_MIN_KMH);
  travelMs = flightTimeMs(currentSpeedKmh);
  startX = (Math.random() - 0.5) * 0.7;
  endX = (Math.random() - 0.5) * 0.5;
  pitchStartMs = performance.now();

  ball.visible = true;
  ball.position.set(startX, 1.75, -PITCH_DISTANCE + 1.2);

  speedTagEl.textContent = `${currentSpeedKmh.toFixed(0)}km/h`;
  speedTagEl.classList.add("show");
  resultBannerEl.classList.remove("show");

  strikeTimeoutId = setTimeout(() => {
    if (pitchActive && !swingLocked) resolveSwing(null);
  }, travelMs + GRACE_AFTER_ARRIVAL_MS);
}

function updateBallPosition(now) {
  if (!pitchActive) return;
  const t = Math.min((now - pitchStartMs) / travelMs, 1);
  ball.position.x = startX + (endX - startX) * t;
  ball.position.z = -PITCH_DISTANCE + 1.2 + (PITCH_DISTANCE + 1.2) * t;
  // slight downward drop from the release point to the plate
  ball.position.y = 1.75 - 0.55 * t - 0.25 * t * t;
}

function resolveSwing(tapMs) {
  if (swingLocked) return;
  swingLocked = true;
  pitchActive = false;
  clearTimeout(strikeTimeoutId);

  const idealMs = pitchStartMs + travelMs;
  const errorMs = tapMs === null ? null : tapMs - idealMs;
  const outcome = evaluateSwing(errorMs, travelMs);
  applyOutcome(outcome);
}

function applyOutcome(outcome) {
  const info = OUTCOME_INFO[outcome];
  score += info.score;
  if (info.isHit) hitCount++;
  if (info.isHomer) homerCount++;

  scoreEl.textContent = String(score);
  homerCountEl.textContent = String(homerCount);

  resultBannerEl.textContent = info.label;
  resultBannerEl.style.color = info.color;
  resultBannerEl.classList.add("show");
  speedTagEl.classList.remove("show");

  if (outcome !== "look") showSwingFlourish();
  animateHitBall(outcome);

  pitchIndex++;
  pitchCountEl.textContent = String(pitchIndex);

  setTimeout(() => {
    ball.visible = false;
    if (pitchIndex >= TOTAL_PITCHES) {
      endGame();
    } else if (!gameOver) {
      startPitch();
    }
  }, RESULT_DISPLAY_MS);
}

const SWING_START_ANGLE = -2.1; // cocked back, bat pointing behind the batter
const SWING_END_ANGLE = 0.9; // follow-through, swept around toward the pitcher

function showSwingFlourish() {
  batPivot.rotation.y = SWING_START_ANGLE;
  const start = performance.now();
  function animateBat(now) {
    const t = (now - start) / 220;
    if (t >= 1) {
      batPivot.rotation.y = SWING_START_ANGLE; // back to the ready stance
      return;
    }
    batPivot.rotation.y = SWING_START_ANGLE + (SWING_END_ANGLE - SWING_START_ANGLE) * t;
    requestAnimationFrame(animateBat);
  }
  requestAnimationFrame(animateBat);
}

// A short cosmetic flight for the struck (or missed) ball, distinct from
// the pitch animation — direction/distance communicate the outcome.
function animateHitBall(outcome) {
  const from = ball.position.clone();
  let to;
  const duration =
    outcome === "homerun" ? 1300 : outcome === "hit" ? 900 : outcome === "foul" ? 500 : 300;

  if (outcome === "homerun") {
    to = new THREE.Vector3((Math.random() - 0.5) * 6, 6, -40);
  } else if (outcome === "hit") {
    to = new THREE.Vector3((Math.random() - 0.5) * 10, 0.3, -14 - Math.random() * 6);
  } else if (outcome === "foul") {
    const side = Math.random() < 0.5 ? -1 : 1;
    to = new THREE.Vector3(side * 8, 1, -2 - Math.random() * 3);
  } else {
    to = from.clone();
    to.z += 0.6;
  }

  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    ball.position.lerpVectors(from, to, t);
    if (outcome === "homerun" || outcome === "hit") {
      ball.position.y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * 1.5;
    }
    if (t < 1 && ball.visible) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function endGame() {
  gameOver = true;
  const rating =
    score >= 30 ? "レジェンド級!" : score >= 20 ? "お見事!" : score >= 10 ? "なかなかやるね!" : "また挑戦しよう!";
  overlayStatsEl.innerHTML =
    `スコア: ${score}<br />ヒット: ${hitCount}本 / ホームラン: ${homerCount}本<br /><br />${rating}`;
  overlayEl.classList.add("show");
}

// ---------- Input ----------
function onSwingTap() {
  if (!started || gameOver || swingLocked) return;
  resolveSwing(performance.now());
}
swingLayerEl.addEventListener("pointerdown", onSwingTap);

document.getElementById("startBtn").addEventListener("click", () => {
  started = true;
  startOverlayEl.classList.remove("show");
  startPitch();
});
document.getElementById("restartBtn").addEventListener("click", () => location.reload());

// ---------- Main loop ----------
function animate() {
  requestAnimationFrame(animate);
  updateBallPosition(performance.now());
  renderer.render(scene, camera);
}
animate();
