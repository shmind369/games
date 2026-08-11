import * as THREE from "three";

// ---------- Pure logic (unit-testable) ----------
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function applyDamage(hp, dmg) { return Math.max(0, hp - dmg); }
function oppositeSide(side) { return side === "left" ? "right" : "left"; }

const BASE_TELEGRAPH_MS = 1300;
const MIN_TELEGRAPH_MS = 550;
function computeTelegraphMs(oppHpRatio) {
  return lerp(MIN_TELEGRAPH_MS, BASE_TELEGRAPH_MS, clamp(oppHpRatio, 0, 1));
}

function pickNextSide(rng, lastSide, repeatCount) {
  if (lastSide && repeatCount >= 2) return oppositeSide(lastSide);
  return rng() < 0.5 ? "left" : "right";
}

const SWIPE_THRESHOLD_PX = 40;
const SWIPE_MAX_MS = 550;
const TAP_MAX_MOVE_PX = 18;
const TAP_MAX_MS = 300;
function classifySwipe(dx, dy, dt) {
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx < TAP_MAX_MOVE_PX && ady < TAP_MAX_MOVE_PX && dt <= TAP_MAX_MS) return "tap";
  if (adx >= SWIPE_THRESHOLD_PX && adx > ady * 1.2 && dt <= SWIPE_MAX_MS) {
    return dx < 0 ? "left" : "right";
  }
  return null;
}
function evaluateDodge(requiredSide, gesture) { return gesture === requiredSide; }

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAYER_MAX_HP = 100, OPP_MAX_HP = 100;
const HIT_DAMAGE = 14;
const COUNTER_DAMAGE = 18;
const VULNERABLE_MS = 850;
const HIT_RECOVER_MS = 350;
const COUNTER_RECOVER_MS = 400;

// ---------- Three.js scene ----------
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141a26);
scene.fog = new THREE.Fog(0x141a26, 6, 16);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
const cameraBase = new THREE.Vector3(0, 1.6, 2.5);
camera.position.copy(cameraBase);
camera.lookAt(0, 1.45, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(2, 4, 3);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x6688ff, 0.4);
rimLight.position.set(-3, 2, -2);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 6),
  new THREE.MeshStandardMaterial({ color: 0x1b2130, roughness: 1 })
);
backdrop.position.set(0, 3, -2.2);
scene.add(backdrop);

const ropeMat = new THREE.MeshStandardMaterial({ color: 0xdb4b4b, emissive: 0x330000 });
for (const y of [0.55, 0.95, 1.35]) {
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 6, 8), ropeMat);
  rope.rotation.z = Math.PI / 2;
  rope.position.set(0, y, -1.3);
  scene.add(rope);
}

// Opponent boxer (built from primitives)
const opponent = new THREE.Group();
const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.7 });
const shortsMat = new THREE.MeshStandardMaterial({ color: 0x2255cc, roughness: 0.6 });
const gloveMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.4, emissive: 0x000000 });

const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 4, 8), skinMat);
torso.position.set(0, 1.15, 0);
opponent.add(torso);

const shorts = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.3, 8), shortsMat);
shorts.position.set(0, 0.75, 0);
opponent.add(shorts);

const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16), skinMat);
head.position.set(0, 1.78, 0);
opponent.add(head);

const GUARD = { left: new THREE.Vector3(-0.42, 1.32, 0.32), right: new THREE.Vector3(0.42, 1.32, 0.32) };
const WINDUP = { left: new THREE.Vector3(-0.55, 1.25, -0.15), right: new THREE.Vector3(0.55, 1.25, -0.15) };
const STRIKE = { left: new THREE.Vector3(-0.15, 1.4, 1.35), right: new THREE.Vector3(0.15, 1.4, 1.35) };

const leftGlove = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), gloveMat.clone());
leftGlove.position.copy(GUARD.left);
opponent.add(leftGlove);
const rightGlove = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), gloveMat.clone());
rightGlove.position.copy(GUARD.right);
opponent.add(rightGlove);

opponent.position.set(0, 0, -1.15);
scene.add(opponent);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- Game state ----------
const hud = {
  oppFill: document.getElementById("oppFill"),
  playerFill: document.getElementById("playerFill"),
  cue: document.getElementById("cue"),
  flash: document.getElementById("flash"),
  titleOverlay: document.getElementById("titleOverlay"),
  resultOverlay: document.getElementById("resultOverlay"),
  resultTitle: document.getElementById("resultTitle"),
  resultSubtitle: document.getElementById("resultSubtitle"),
  startBtn: document.getElementById("startBtn"),
  retryBtn: document.getElementById("retryBtn"),
};

let rngSeed = Date.now() >>> 0;
let rng = mulberry32(rngSeed);
let match = null;

function newMatch() {
  return {
    phase: "title", // title | telegraph | vulnerable | hitRecover | counterRecover | win | gameover
    playerHp: PLAYER_MAX_HP,
    oppHp: OPP_MAX_HP,
    telegraphSide: null,
    lastSide: null,
    repeatCount: 0,
    phaseUntil: 0,
    camShake: 0,
    camDodgeOffset: 0,
    camLunge: 0,
    flashT: 0,
  };
}

function updateHud() {
  hud.oppFill.style.width = `${(match.oppHp / OPP_MAX_HP) * 100}%`;
  hud.playerFill.style.width = `${(match.playerHp / PLAYER_MAX_HP) * 100}%`;
}
function showCue(text, cls) {
  hud.cue.textContent = text;
  hud.cue.className = cls ? `show ${cls}` : "show";
}
function hideCue() { hud.cue.className = ""; }

function startMatch() {
  match = newMatch();
  match.phase = "waiting";
  match.phaseUntil = performance.now() + 500;
  hud.titleOverlay.classList.remove("show");
  hud.resultOverlay.classList.remove("show");
  updateHud();
  hideCue();
}
function scheduleNextMove(now) {
  const side = pickNextSide(rng, match.lastSide, match.repeatCount);
  match.repeatCount = side === match.lastSide ? match.repeatCount + 1 : 1;
  match.lastSide = side;
  match.telegraphSide = side;
  const ms = computeTelegraphMs(match.oppHp / OPP_MAX_HP);
  match.phase = "telegraph";
  match.telegraphStartAt = now;
  match.phaseUntil = now + ms;
  const requiredSide = oppositeSide(side);
  showCue(requiredSide === "left" ? "⬅ スワイプで躱せ" : "スワイプで躱せ ➡", "dodge");
}

function onDodgeSuccess(now) {
  match.phase = "vulnerable";
  match.phaseUntil = now + VULNERABLE_MS;
  match.camDodgeOffset = match.telegraphSide === "left" ? 1 : -1;
  showCue("今だ！タップで反撃", "counter");
}
function onDodgeFail(now) {
  match.playerHp = applyDamage(match.playerHp, HIT_DAMAGE);
  match.camShake = 1;
  match.flashT = 1;
  hud.flash.classList.add("show");
  requestAnimationFrame(() => hud.flash.classList.remove("show"));
  updateHud();
  hideCue();
  if (match.playerHp <= 0) {
    endMatch(false);
    return;
  }
  match.phase = "hitRecover";
  match.phaseUntil = now + HIT_RECOVER_MS;
}
function onCounterHit(now) {
  match.oppHp = applyDamage(match.oppHp, COUNTER_DAMAGE);
  match.camLunge = 1;
  updateHud();
  hideCue();
  if (match.oppHp <= 0) {
    endMatch(true);
    return;
  }
  match.phase = "counterRecover";
  match.phaseUntil = now + COUNTER_RECOVER_MS;
}
function onVulnerableExpire(now) {
  hideCue();
  match.phase = "waiting";
  match.phaseUntil = now + 350;
}
function endMatch(playerWon) {
  match.phase = playerWon ? "win" : "gameover";
  hideCue();
  hud.resultTitle.textContent = playerWon ? "TKO WIN!" : "KNOCKED OUT…";
  hud.resultSubtitle.textContent = playerWon
    ? "見事な反撃だった！"
    : "次はもっと見切ろう。";
  hud.resultOverlay.classList.add("show");
}

function update(now) {
  if (!match || match.phase === "title" || match.phase === "win" || match.phase === "gameover") return;
  if (match.phase === "waiting" && now >= match.phaseUntil) {
    scheduleNextMove(now);
  } else if (match.phase === "telegraph" && now >= match.phaseUntil) {
    onDodgeFail(now);
  } else if (match.phase === "vulnerable" && now >= match.phaseUntil) {
    onVulnerableExpire(now);
  } else if (match.phase === "hitRecover" && now >= match.phaseUntil) {
    match.phase = "waiting";
    match.phaseUntil = now + 300;
  } else if (match.phase === "counterRecover" && now >= match.phaseUntil) {
    match.phase = "waiting";
    match.phaseUntil = now + 300;
  }
  match.camShake *= 0.88;
  match.camDodgeOffset *= 0.85;
  match.camLunge *= 0.82;
  match.flashT *= 0.85;
}

function render(now) {
  const t = now * 0.001;
  head.position.y = 1.78 + Math.sin(t * 1.6) * 0.01;
  torso.position.y = 1.15 + Math.sin(t * 1.6) * 0.008;

  let leftTarget = GUARD.left, rightTarget = GUARD.right;
  let glowLeft = 0, glowRight = 0;
  if (match) {
    if (match.phase === "telegraph") {
      const p = clamp((now - match.telegraphStartAt) / (match.phaseUntil - match.telegraphStartAt), 0, 1);
      const wind = match.telegraphSide === "left" ? WINDUP.left : WINDUP.right;
      const guard = match.telegraphSide === "left" ? GUARD.left : GUARD.right;
      const target = new THREE.Vector3().lerpVectors(guard, wind, Math.min(1, p * 1.4));
      if (match.telegraphSide === "left") { leftTarget = target; glowLeft = p; }
      else { rightTarget = target; glowRight = p; }
    } else if (match.phase === "hitRecover") {
      const strike = match.telegraphSide === "left" ? STRIKE.left : STRIKE.right;
      if (match.telegraphSide === "left") leftTarget = strike; else rightTarget = strike;
    }
  }
  leftGlove.position.lerp(leftTarget, 0.28);
  rightGlove.position.lerp(rightTarget, 0.28);
  leftGlove.material.emissive.setRGB(glowLeft * 0.9, glowLeft * 0.7, 0);
  rightGlove.material.emissive.setRGB(glowRight * 0.9, glowRight * 0.7, 0);

  if (match && match.phase === "counterRecover") {
    opponent.rotation.z = Math.sin((now - (match.phaseUntil - COUNTER_RECOVER_MS)) * 0.02) * 0.05;
  } else {
    opponent.rotation.z *= 0.8;
  }

  const shakeX = match ? (rng() - 0.5) * match.camShake * 0.06 : 0;
  const shakeY = match ? (rng() - 0.5) * match.camShake * 0.04 : 0;
  const dodgeX = match ? match.camDodgeOffset * 0.32 : 0;
  const lungeZ = match ? -match.camLunge * 0.22 : 0;
  camera.position.set(cameraBase.x + shakeX + dodgeX, cameraBase.y + shakeY, cameraBase.z + lungeZ);
  camera.lookAt(dodgeX * -0.6, 1.45, 0);

  renderer.render(scene, camera);
}

function loop(now) {
  update(now);
  render(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- Input ----------
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
  const gesture = classifySwipe(dx, dy, dt);
  if (!gesture || !match) return;
  handleGesture(gesture, now);
}
function handleGesture(gesture, now) {
  if (match.phase === "telegraph" && (gesture === "left" || gesture === "right")) {
    const requiredSide = oppositeSide(match.telegraphSide);
    if (evaluateDodge(requiredSide, gesture)) onDodgeSuccess(now);
    else onDodgeFail(now);
  } else if (match.phase === "vulnerable" && gesture === "tap") {
    onCounterHit(now);
  }
}
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", () => { gestureStart = null; });

hud.startBtn.addEventListener("click", startMatch);
hud.retryBtn.addEventListener("click", startMatch);

match = newMatch();
