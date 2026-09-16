import {
  GESTURE, classifyRelease, isDodgeCorrect, computePunch,
  createEnemyState, tickEnemy, applyDamage, resolvePlayerPunchDamage, checkOutcome,
  MAX_HP,
} from "./fight.js";

// Elastic "ease out back" curve: overshoots past 1 before settling there, so
// a value driven by it visually snaps forward and springs back into place —
// the rubber-band release feel, applied to the punch's forward extension.
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

// ---------- Canvas setup ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- Game state ----------
let rngSeed = 1;
function rng() {
  // mulberry32
  rngSeed |= 0; rngSeed = (rngSeed + 0x6D2B79F5) | 0;
  let t = Math.imul(rngSeed ^ (rngSeed >>> 15), 1 | rngSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function freshState() {
  return {
    phase: "title", // title | playing | gameover
    playerHp: MAX_HP,
    enemyHp: MAX_HP,
    enemy: createEnemyState(),
    defendedThisTelegraph: false,
    playerPunch: null, // { side, power, timer }
    effects: [], // transient visual effects: { type, side, until }
  };
}
let game = freshState();

// ---------- UI ----------
const playerHpFillEl = document.getElementById("playerHpFill");
const enemyHpFillEl = document.getElementById("enemyHpFill");
const flashTextEl = document.getElementById("flashText");
const titleOverlayEl = document.getElementById("titleOverlay");
const resultOverlayEl = document.getElementById("resultOverlay");
const resultTitleEl = document.getElementById("resultTitle");
const resultSubtitleEl = document.getElementById("resultSubtitle");

function updateHpBars() {
  playerHpFillEl.style.width = `${Math.max(0, (game.playerHp / MAX_HP) * 100)}%`;
  enemyHpFillEl.style.width = `${Math.max(0, (game.enemyHp / MAX_HP) * 100)}%`;
}

let flashTimer = null;
function showFlash(text, ms = 550) {
  flashTextEl.textContent = text;
  flashTextEl.classList.add("show");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => flashTextEl.classList.remove("show"), ms);
}

function addEffect(type, side, durationMs) {
  game.effects.push({ type, side, until: performance.now() + durationMs });
}
function effectActive(type, side) {
  const now = performance.now();
  return game.effects.some((e) => e.type === type && (side === undefined || e.side === side) && e.until > now);
}
function pruneEffects() {
  const now = performance.now();
  game.effects = game.effects.filter((e) => e.until > now);
}

function startGame() {
  game = freshState();
  game.phase = "playing";
  updateHpBars();
  titleOverlayEl.classList.remove("show");
  resultOverlayEl.classList.remove("show");
}

document.getElementById("startBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  startGame();
});
document.getElementById("retryBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  startGame();
});

// ---------- Gesture input (single active touch; no on-screen buttons) ----------
const touch = { active: false, pointerId: null, startX: 0, startY: 0, startT: 0, side: "left", curX: 0, curY: 0 };

function sideForX(x) { return x < canvas.clientWidth / 2 ? "left" : "right"; }

function throwPunch(side, power) {
  const { damage, startupMs } = computePunch(side, power);
  game.playerPunch = { side, power, damage, timer: startupMs, totalMs: startupMs };
}

function onPointerDown(e) {
  if (game.phase !== "playing") return;
  if (touch.active) return;
  touch.active = true;
  touch.pointerId = e.pointerId;
  touch.startX = touch.curX = e.clientX;
  touch.startY = touch.curY = e.clientY;
  touch.startT = performance.now();
  touch.side = sideForX(e.clientX);
}
function onPointerMove(e) {
  if (!touch.active || e.pointerId !== touch.pointerId) return;
  touch.curX = e.clientX;
  touch.curY = e.clientY;
}
function onPointerUp(e) {
  if (!touch.active || e.pointerId !== touch.pointerId) return;
  const dx = touch.curX - touch.startX, dy = touch.curY - touch.startY;
  const dt = performance.now() - touch.startT;
  if (game.phase === "playing") {
    const result = classifyRelease(dx, dy, dt, touch.side);
    if (result.type === "dodge") {
      addEffect("dodge", result.dir, 200);
      if (game.enemy.phase === "telegraph" && isDodgeCorrect(game.enemy.side, result.dir)) {
        game.defendedThisTelegraph = true;
      }
    } else if (result.type === "punch" && !game.playerPunch) {
      throwPunch(result.side, result.power);
    }
  }
  touch.active = false;
}
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);

// ---------- Update ----------
function endMatch(outcome) {
  game.phase = "gameover";
  if (outcome === "win") {
    resultTitleEl.textContent = "WIN";
    resultSubtitleEl.textContent = "相手をダウンさせた。";
  } else {
    resultTitleEl.textContent = "LOSE";
    resultSubtitleEl.textContent = "ダウンしてしまった。";
  }
  resultOverlayEl.classList.add("show");
}

function update(dt) {
  if (game.phase !== "playing") return;

  if (game.playerPunch) {
    game.playerPunch.timer -= dt;
    if (game.playerPunch.timer <= 0) {
      const dmg = resolvePlayerPunchDamage(game.playerPunch.damage, game.enemy.phase);
      game.enemyHp = applyDamage(game.enemyHp, dmg);
      addEffect("enemyHit", game.playerPunch.side, 220);
      showFlash(game.enemy.phase === "recovery" ? "COUNTER!" : "HIT!", 400);
      game.playerPunch = null;
      updateHpBars();
    }
  }

  const prevPhase = game.enemy.phase;
  const { enemy, event } = tickEnemy(game.enemy, dt, game.defendedThisTelegraph, game.enemyHp / MAX_HP, rng);
  game.enemy = enemy;
  if (prevPhase !== "telegraph" && enemy.phase === "telegraph") {
    game.defendedThisTelegraph = false;
  }
  if (event) {
    addEffect("enemyPunchOut", game.enemy.side, 180);
    if (event.type === "hit") {
      game.playerHp = applyDamage(game.playerHp, 14);
      addEffect("playerHit", null, 260);
      showFlash("HIT!", 400);
      updateHpBars();
    } else {
      addEffect("defended", null, 260);
      showFlash("AVOID!", 400);
    }
  }

  const outcome = checkOutcome(game.playerHp, game.enemyHp);
  if (outcome) endMatch(outcome);

  pruneEffects();
}

// ---------- Render ----------
function drawBackground(w, h) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#22243a");
  grad.addColorStop(1, "#0a0a10");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 3;
  for (const t of [0.4, 0.48, 0.56]) {
    ctx.beginPath();
    ctx.moveTo(0, h * t);
    ctx.lineTo(w, h * t);
    ctx.stroke();
  }
}

function drawEnemy(w, h) {
  const cx = w / 2, cy = h * 0.36;
  const scale = Math.min(w, h * 1.4) * 0.9;
  const t = performance.now() * 0.002;
  const bob = Math.sin(t) * scale * 0.01;

  const enemy = game.enemy;
  const hitShake = effectActive("enemyHit") ? (rng() - 0.5) * scale * 0.03 : 0;

  ctx.save();
  ctx.translate(cx + hitShake, cy + bob);

  // Torso
  ctx.fillStyle = effectActive("enemyHit") ? "#ffb0a8" : "#c94b3f";
  roundRect(-scale * 0.16, -scale * 0.02, scale * 0.32, scale * 0.34, scale * 0.05);
  ctx.fill();

  // Head
  ctx.beginPath();
  ctx.fillStyle = "#e0a884";
  ctx.arc(0, -scale * 0.1, scale * 0.11, 0, Math.PI * 2);
  ctx.fill();

  // Arms (fists as circles). Pull back during telegraph on the telegraphed
  // side, punch outward (toward the viewer) briefly when the telegraph
  // resolves, hang open during recovery (visibly exposed).
  const armY = scale * 0.05;
  const baseSpread = scale * 0.22;
  for (const side of ["left", "right"]) {
    const sign = side === "left" ? -1 : 1;
    let fx = sign * baseSpread, fy = armY;
    if (enemy.phase === "telegraph" && enemy.side === side) {
      fx = sign * (baseSpread + scale * 0.08);
      fy = armY - scale * 0.05;
    } else if (effectActive("enemyPunchOut", side)) {
      fy = armY + scale * 0.15;
    } else if (enemy.phase === "recovery") {
      fx = sign * baseSpread * 1.3;
      fy = armY + scale * 0.1;
    }
    ctx.beginPath();
    ctx.fillStyle = enemy.phase === "telegraph" && enemy.side === side ? "#ffd166" : "#8a1f1a";
    ctx.arc(fx, fy, scale * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function chargeColor(power) {
  return `rgb(255, ${Math.round(209 - power * 130)}, ${Math.round(102 - power * 90)})`;
}

// The pulled-back band: a single elastic line from the resting anchor to the
// current fist position, thickening and reddening with power like a
// slingshot band under tension.
function drawRubberBand(anchorX, anchorY, tipX, tipY, power, color) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3 + power * 5;
  ctx.lineCap = "round";
  ctx.moveTo(anchorX, anchorY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.arc(anchorX, anchorY, 4, 0, Math.PI * 2);
  ctx.fill();
}

// A radial gauge ring around the fist showing charge 0..1, so the pull has
// a clear "how far until it snaps" readout without any on-screen button.
function drawChargeGauge(cx, cy, r, power, color) {
  ctx.beginPath();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 4;
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * power);
  ctx.stroke();
}

function drawPlayerGloves(w, h) {
  const gloveY = h * 0.9;
  const leftX = w * 0.16, rightX = w * 0.84;
  const scale = Math.min(w, h) * 0.16;
  // A fixed "slingshot post" mounted at bottom-center: charging pulls the
  // fist away from this anchor (not just from its own resting spot), so the
  // band stretches across a large, clearly visible span as power builds.
  const anchorX = w / 2, anchorY = h * 0.99;

  for (const side of ["left", "right"]) {
    const baseX = side === "left" ? leftX : rightX;
    let x = baseX, y = gloveY, r = scale * 0.5, color = "#3a3f52";
    let chargeVisual = null;

    const isCharging = touch.active && touch.side === side && sideForX(touch.startX) === side;
    if (isCharging) {
      const dx = touch.curX - touch.startX;
      const outward = side === "left" ? -dx : dx;
      const power = Math.max(0, Math.min(1, outward / GESTURE.MAX_PULL_PX));
      const dir = side === "left" ? -1 : 1;
      x = baseX + dir * power * scale * 0.9;
      y = gloveY - power * scale * 0.2;
      r = scale * (0.5 + power * 0.25);
      color = chargeColor(power);
      chargeVisual = { power };
    }
    if (game.playerPunch && game.playerPunch.side === side) {
      // Elastic snap: the fist rushes forward, overshoots, then settles —
      // the "pull back and let go" pop, instead of a flat linear travel.
      const t = Math.min(1, 1 - Math.max(0, game.playerPunch.timer) / game.playerPunch.totalMs);
      const snap = easeOutBack(t);
      y = gloveY - snap * scale * 1.6;
      r = scale * 0.55;
      color = "#ffdd55";
    }

    if (chargeVisual) {
      drawRubberBand(anchorX, anchorY, x, y, chargeVisual.power, color);
      drawChargeGauge(x, y, r + scale * 0.18, chargeVisual.power, color);
    }
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function render() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  drawBackground(w, h);
  if (game.phase !== "title") {
    drawEnemy(w, h);
    drawPlayerGloves(w, h);
  }
}

// ---------- Loop ----------
let lastT = performance.now();
function loop(t) {
  const dt = Math.min(50, t - lastT);
  lastT = t;
  update(dt);
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
