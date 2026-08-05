// ---------- Scope ----------
// A minimalist 1-on-1 "punch duel" prototype in the spirit of early
// arcade street-fighting games: two fighters stand in a single lane and
// trade high/low punches. There's no health bar — every clean hit shoves
// the loser one step toward their own edge of the screen, and getting
// pushed all the way off ends the round on the spot. If time runs out
// first, whoever has pushed the fight closer to the opponent's edge wins
// on points. A punch is blocked only by guarding the matching zone at
// the instant it lands; guarding (or punching) the wrong zone does
// nothing to stop it.

// ---------- Tuning ----------
const EDGE_LIMIT = 5; // battlePosition range: -EDGE_LIMIT (player's edge) .. +EDGE_LIMIT (CPU's edge)
const PUSH_STEP = 1;
const ROUND_TIME_MS = 60000;

const HOLD_THRESHOLD_MS = 180; // press-and-hold longer than this to guard instead of punch
const PUNCH_RECOVERY_MS = 260; // brief vulnerable lockout after any punch attempt (hit, blocked, or whiffed)

const CPU_ACTION_MIN_MS = 700;
const CPU_ACTION_MAX_MS = 1500;
const CPU_GUARD_HOLD_MS = 900;
const CPU_PUNCH_PROB = 0.6; // vs. guarding, when the CPU decides to act

const HAZARD_MIN_INTERVAL_MS = 4500;
const HAZARD_MAX_INTERVAL_MS = 8000;
const HAZARD_TELEGRAPH_MS = 700;

const FIGHT_GAP_PX = 60; // on-screen distance kept between the two fighters
const LANE_MARGIN_PX = 36;

// ---------- Pure logic (no DOM/canvas — directly unit testable) ----------
// A punch only lands if the defender isn't guarding the same zone.
function resolvePunch(zone, defenderStance) {
  const blocked = (zone === "high" && defenderStance === "guardHigh") || (zone === "low" && defenderStance === "guardLow");
  return blocked ? "blocked" : "hit";
}

// The falling hazard is an overhead threat: only a high guard avoids it.
function resolveHazard(targetStance) {
  return targetStance === "guardHigh" ? "avoided" : "hit";
}

function applyPush(position, direction, step, edgeLimit) {
  return Math.max(-edgeLimit, Math.min(edgeLimit, position + direction * step));
}

// Returns 'player' | 'cpu' | null (round continues).
function checkRoundEnd(position, edgeLimit) {
  if (position >= edgeLimit) return "player"; // CPU pushed off their own edge
  if (position <= -edgeLimit) return "cpu"; // player pushed off their own edge
  return null;
}

// Returns 'player' | 'cpu' | 'draw' for a timeout with no KO.
function resolveTimeout(position) {
  if (position > 0) return "player";
  if (position < 0) return "cpu";
  return "draw";
}

function computeFighterPositions(position, edgeLimit, laneLeft, laneRight, fightGap) {
  const laneCenter = (laneLeft + laneRight) / 2;
  const maxShift = laneRight - laneCenter - fightGap / 2;
  const t = position / edgeLimit;
  const pairCenter = laneCenter + t * maxShift;
  return { playerX: pairCenter - fightGap / 2, cpuX: pairCenter + fightGap / 2 };
}

// ---------- Canvas setup ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let width = 0;
let height = 0;

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- Game state ----------
const player = { stance: "neutral", actionLockUntil: 0 };
const cpu = { stance: "neutral", actionLockUntil: 0, nextActionAt: 0, guardUntil: 0 };
let battlePosition = 0;
let hits = 0;
let timeLeftMs = ROUND_TIME_MS;
let roundOver = false;
let nextHazardAt = 0;
let hazard = null; // { target: 'player'|'cpu', spawnAt, resolveAt, resolved }

const hitsEl = document.getElementById("hits");
const timerEl = document.getElementById("timer");
const flashEl = document.getElementById("flashText");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlayTitle");
const overlaySubtitleEl = document.getElementById("overlaySubtitle");
const highBtn = document.getElementById("highBtn");
const lowBtn = document.getElementById("lowBtn");
document.getElementById("restartBtn").addEventListener("click", resetGame);

function resetGame() {
  player.stance = "neutral";
  player.actionLockUntil = 0;
  cpu.stance = "neutral";
  cpu.actionLockUntil = 0;
  cpu.nextActionAt = performance.now() + randRange(CPU_ACTION_MIN_MS, CPU_ACTION_MAX_MS);
  cpu.guardUntil = 0;
  battlePosition = 0;
  hits = 0;
  timeLeftMs = ROUND_TIME_MS;
  roundOver = false;
  hazard = null;
  nextHazardAt = performance.now() + randRange(HAZARD_MIN_INTERVAL_MS, HAZARD_MAX_INTERVAL_MS);
  hitsEl.textContent = String(hits);
  timerEl.textContent = String(Math.ceil(timeLeftMs / 1000));
  overlayEl.classList.remove("show");
  flashEl.classList.remove("show");
  resize();
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function flash(text, color) {
  flashEl.textContent = text;
  flashEl.style.color = color;
  flashEl.classList.remove("show");
  void flashEl.offsetWidth;
  flashEl.classList.add("show");
}

function endRound(winner) {
  if (roundOver) return;
  roundOver = true;
  if (winner === "player") {
    overlayTitleEl.textContent = "WIN";
    overlaySubtitleEl.textContent = `HIT: ${hits}`;
  } else if (winner === "cpu") {
    overlayTitleEl.textContent = "LOSE";
    overlaySubtitleEl.textContent = `HIT: ${hits}`;
  } else {
    overlayTitleEl.textContent = "DRAW";
    overlaySubtitleEl.textContent = `HIT: ${hits}`;
  }
  overlayEl.classList.add("show");
}

// ---------- Punch resolution ----------
function throwPunch(attacker, zone, now) {
  if (roundOver || now < attacker.actionLockUntil) return;
  attacker.actionLockUntil = now + PUNCH_RECOVERY_MS;
  attacker.stance = zone === "high" ? "punchHigh" : "punchLow"; // visual only; cleared by the recovery decay below
  const defender = attacker === player ? cpu : player;
  const outcome = resolvePunch(zone, defender.stance);
  if (outcome === "hit") {
    const direction = attacker === player ? 1 : -1;
    battlePosition = applyPush(battlePosition, direction, PUSH_STEP, EDGE_LIMIT);
    if (attacker === player) {
      hits += 1;
      hitsEl.textContent = String(hits);
      flash("HIT!", "#ffe066");
    } else {
      flash("食らった!", "#ff6b6b");
    }
    const winner = checkRoundEnd(battlePosition, EDGE_LIMIT);
    if (winner) endRound(winner);
  } else if (attacker === player) {
    flash("BLOCKED", "#9fd6ff");
  }
}

// ---------- Player input: tap = punch, hold past threshold = guard ----------
function bindZoneButton(el, zone) {
  let pointerId = null;
  let pressStart = 0;
  let guarding = false;

  el.addEventListener("pointerdown", (e) => {
    if (roundOver || performance.now() < player.actionLockUntil) return;
    pointerId = e.pointerId;
    pressStart = performance.now();
    guarding = false;
    el.setPointerCapture(e.pointerId);
    el.classList.add("active");
  });

  el.addEventListener("pointerup", (e) => {
    if (e.pointerId !== pointerId) return;
    const now = performance.now();
    if (!guarding) {
      throwPunch(player, zone, now);
    } else {
      player.stance = "neutral";
    }
    pointerId = null;
    el.classList.remove("active");
  });
  el.addEventListener("pointercancel", (e) => {
    if (e.pointerId !== pointerId) return;
    if (guarding) player.stance = "neutral";
    pointerId = null;
    el.classList.remove("active");
  });

  // Promote a held press into an active guard once it crosses the hold
  // threshold; checked every frame from the main loop via this closure's
  // exposed updater rather than a stray timer, so it stays in lockstep
  // with the rest of the simulation.
  return function updateHold(now) {
    if (pointerId === null || guarding) return;
    if (now - pressStart >= HOLD_THRESHOLD_MS) {
      guarding = true;
      player.stance = zone === "high" ? "guardHigh" : "guardLow";
    }
  };
}
const updateHighHold = bindZoneButton(highBtn, "high");
const updateLowHold = bindZoneButton(lowBtn, "low");

// ---------- CPU AI ----------
function updateCpu(now) {
  if (roundOver) return;
  if (cpu.stance !== "neutral" && cpu.stance !== "punchHigh" && cpu.stance !== "punchLow" && now >= cpu.guardUntil) {
    cpu.stance = "neutral";
  }
  if (now < cpu.nextActionAt) return;
  cpu.nextActionAt = now + randRange(CPU_ACTION_MIN_MS, CPU_ACTION_MAX_MS);
  if (now < cpu.actionLockUntil) return;

  const zone = Math.random() < 0.5 ? "high" : "low";
  if (Math.random() < CPU_PUNCH_PROB) {
    throwPunch(cpu, zone, now);
  } else {
    cpu.stance = zone === "high" ? "guardHigh" : "guardLow";
    cpu.guardUntil = now + CPU_GUARD_HOLD_MS;
  }
}

// ---------- Falling hazard ----------
function updateHazard(now, dt) {
  if (roundOver) return;
  if (!hazard && now >= nextHazardAt) {
    hazard = {
      target: Math.random() < 0.5 ? "player" : "cpu",
      resolveAt: now + HAZARD_TELEGRAPH_MS,
      resolved: false,
    };
  }
  if (hazard && !hazard.resolved && now >= hazard.resolveAt) {
    hazard.resolved = true;
    const victim = hazard.target === "player" ? player : cpu;
    const outcome = resolveHazard(victim.stance);
    if (outcome === "hit") {
      const direction = hazard.target === "player" ? -1 : 1;
      battlePosition = applyPush(battlePosition, direction, PUSH_STEP, EDGE_LIMIT);
      if (hazard.target === "player") flash("直撃!", "#ff6b6b");
      else flash("命中!", "#ffe066");
      const winner = checkRoundEnd(battlePosition, EDGE_LIMIT);
      if (winner) endRound(winner);
    }
    nextHazardAt = now + randRange(HAZARD_MIN_INTERVAL_MS, HAZARD_MAX_INTERVAL_MS);
    hazard = null;
  }
}

// ---------- Drawing ----------
function drawFighter(x, groundY, stance, color, facing) {
  const w = 24;
  const h = 46;
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, groundY - h, w, h);

  // Arm indicator: raised for guard, extended for a punch.
  ctx.fillStyle = "#f2c9a0";
  if (stance === "guardHigh" || stance === "punchHigh") {
    const extend = stance === "punchHigh" ? 22 : 8;
    ctx.fillRect(x + facing * (w / 2), groundY - h + 6, facing * extend, 7);
  } else if (stance === "guardLow" || stance === "punchLow") {
    const extend = stance === "punchLow" ? 22 : 8;
    ctx.fillRect(x + facing * (w / 2), groundY - h + 30, facing * extend, 7);
  }
}

function draw(now) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#2a2a38";
  ctx.fillRect(0, 0, width, height);

  const groundY = height * 0.5; // keep the duel clear of the fixed control bar at the bottom
  ctx.strokeStyle = "#484860";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();

  // Edge markers (the manholes fighters get knocked into).
  ctx.fillStyle = "#1c1c28";
  ctx.beginPath();
  ctx.ellipse(LANE_MARGIN_PX, groundY, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(width - LANE_MARGIN_PX, groundY, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  const pos = computeFighterPositions(battlePosition, EDGE_LIMIT, LANE_MARGIN_PX, width - LANE_MARGIN_PX, FIGHT_GAP_PX);
  drawFighter(pos.playerX, groundY, player.stance, "#3a6bd8", 1);
  drawFighter(pos.cpuX, groundY, cpu.stance, "#d24545", -1);

  if (hazard && !hazard.resolved) {
    const t = Math.min(1, (now - (hazard.resolveAt - HAZARD_TELEGRAPH_MS)) / HAZARD_TELEGRAPH_MS);
    const hx = hazard.target === "player" ? pos.playerX : pos.cpuX;
    const hy = groundY - 46 - (1 - t) * (height * 0.4);
    ctx.fillStyle = "#8a5a2a";
    ctx.fillRect(hx - 8, hy, 16, 16);
    ctx.fillStyle = "rgba(255,80,80,0.5)";
    ctx.beginPath();
    ctx.ellipse(hx, groundY - 46, 10 * t, 4 * t, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A punch stance is purely visual (the hit/block decision already happened
// the instant it was thrown); clear it back to neutral once the attacker's
// recovery lock expires so the arm-extended pose doesn't linger.
function decayPunchStance(fighter, now) {
  if ((fighter.stance === "punchHigh" || fighter.stance === "punchLow") && now >= fighter.actionLockUntil) {
    fighter.stance = "neutral";
  }
}

// ---------- Main loop ----------
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(now - lastTime, 50);
  lastTime = now;

  updateHighHold(now);
  updateLowHold(now);
  decayPunchStance(player, now);
  decayPunchStance(cpu, now);

  if (!roundOver) {
    timeLeftMs -= dt;
    if (timeLeftMs <= 0) {
      timeLeftMs = 0;
      endRound(resolveTimeout(battlePosition));
    }
    timerEl.textContent = String(Math.ceil(timeLeftMs / 1000));

    updateCpu(now);
    updateHazard(now, dt);
  }

  draw(now);
  requestAnimationFrame(loop);
}

resetGame();
requestAnimationFrame(loop);
