// ---------- Prototype scope ----------
// Validates only the *feel* of one-handed portrait swipe control combined
// with Ys-1/2-style "bump" combat: no attack button, walking into an
// enemy dead-on hurts you, walking into it off-center (relative to your
// current movement axis) defeats it. Visuals are intentionally plain —
// see the README for what's deliberately out of scope.

// ---------- Tuning ----------
const PLAYER_RADIUS = 15;
const ENEMY_RADIUS = 13;
const PLAYER_SPEED = 190; // px/s
const ENEMY_SPEED = 55; // px/s
const PLAYER_MAX_HP = 3;
const MAX_ENEMIES = 6;
const ENEMY_SPAWN_INTERVAL_MS = 1600;
const SWIPE_DEADZONE_PX = 6; // ignore tiny jitter before a direction is picked

// How far off the movement axis a contact needs to be, as a fraction of
// the two colliders' combined radius, to count as a glancing (winning)
// hit rather than a head-on (losing) one.
const OFFSET_THRESHOLD_RATIO = 0.45;

// Walk-cycle animation: phase advances with distance actually moved (not
// elapsed time), so the leg swing matches stride length instead of
// sliding out of sync when the player stops or changes speed.
const WALK_STRIDE_PX = 22; // px of movement per full leg-swing cycle

// Player sprite sheet: 4x4 grid (4 walk frames per row). Row 0 = facing
// up (back view), row 1 = facing down (front view), row 2 = facing left.
// There's no separate "facing right" row, so that direction reuses row 2
// mirrored horizontally at draw time.
const SPRITE_COLS = 4;
const SPRITE_CELL = 128; // source cell size in assets/player-walk.png (512/4)
const SPRITE_ROW = { up: 0, down: 1, left: 2 };
const SPRITE_DRAW_W = 40;
const SPRITE_DRAW_H = 50;
const SPRITE_DRAW_OFFSET_Y = -8; // shift up slightly so feet land near the collision circle's base

const playerSprite = new Image();
let playerSpriteLoaded = false;
playerSprite.onload = () => {
  playerSpriteLoaded = true;
};
playerSprite.src = "./assets/player-walk.png";

// ---------- Pure collision resolution (no DOM/canvas — testable directly
// with synthetic positions and a facing direction) ----------
// `facing` is the player's current/last movement direction: 'up' | 'down'
// | 'left' | 'right'. Returns 'enemyDefeated' or 'playerDamaged'.
function resolveContact(px, py, ex, ey, facing) {
  const perpDiff = facing === "left" || facing === "right" ? Math.abs(py - ey) : Math.abs(px - ex);
  const threshold = (PLAYER_RADIUS + ENEMY_RADIUS) * OFFSET_THRESHOLD_RATIO;
  return perpDiff >= threshold ? "enemyDefeated" : "playerDamaged";
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
const player = { x: 0, y: 0, hp: PLAYER_MAX_HP, facing: "down", walkPhase: 0, moving: false };
let enemies = []; // { x, y, overlapping }
let gameOver = false;
let spawnTimer = 0;

function resetGame() {
  player.x = width / 2;
  player.y = height / 2;
  player.hp = PLAYER_MAX_HP;
  player.facing = "down";
  player.walkPhase = 0;
  player.moving = false;
  enemies = [];
  gameOver = false;
  spawnTimer = 0;
  hpEl.textContent = `HP: ${player.hp}`;
  overlayEl.classList.remove("show");
}

// ---------- Input: whole-screen swipe, 4-direction only ----------
// Direction is derived from the vector between where the finger first
// touched down and its current position (re-evaluated continuously), so
// the player can adjust direction mid-drag without lifting their finger.
let touchId = null;
let touchStartX = 0;
let touchStartY = 0;
let dragDirection = null; // 'up' | 'down' | 'left' | 'right' | null

function directionFromDelta(dx, dy) {
  if (Math.hypot(dx, dy) < SWIPE_DEADZONE_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

canvas.addEventListener("pointerdown", (e) => {
  touchId = e.pointerId;
  touchStartX = e.clientX;
  touchStartY = e.clientY;
  dragDirection = null;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== touchId) return;
  dragDirection = directionFromDelta(e.clientX - touchStartX, e.clientY - touchStartY);
});
function endTouch(e) {
  if (e.pointerId !== touchId) return;
  touchId = null;
  dragDirection = null;
}
canvas.addEventListener("pointerup", endTouch);
canvas.addEventListener("pointercancel", endTouch);

// ---------- Enemies ----------
function spawnEnemy() {
  if (enemies.length >= MAX_ENEMIES) return;
  const edge = Math.floor(Math.random() * 4);
  const margin = ENEMY_RADIUS + 10;
  let x, y;
  if (edge === 0) { x = Math.random() * width; y = -margin; }
  else if (edge === 1) { x = width + margin; y = Math.random() * height; }
  else if (edge === 2) { x = Math.random() * width; y = height + margin; }
  else { x = -margin; y = Math.random() * height; }
  enemies.push({ x, y, overlapping: false });
}

// ---------- Main loop ----------
const hpEl = document.getElementById("hp");
const overlayEl = document.getElementById("overlay");
document.getElementById("restartBtn").addEventListener("click", resetGame);

let lastTime = performance.now();

function update(dt) {
  if (gameOver) return;

  spawnTimer += dt;
  if (spawnTimer >= ENEMY_SPAWN_INTERVAL_MS) {
    spawnTimer = 0;
    spawnEnemy();
  }

  player.moving = !!dragDirection;
  if (dragDirection) {
    player.facing = dragDirection;
    const dist = (PLAYER_SPEED * dt) / 1000;
    if (dragDirection === "up") player.y -= dist;
    else if (dragDirection === "down") player.y += dist;
    else if (dragDirection === "left") player.x -= dist;
    else if (dragDirection === "right") player.x += dist;
    player.x = Math.max(PLAYER_RADIUS, Math.min(width - PLAYER_RADIUS, player.x));
    player.y = Math.max(PLAYER_RADIUS, Math.min(height - PLAYER_RADIUS, player.y));
    player.walkPhase += (dist / WALK_STRIDE_PX) * Math.PI * 2;
  }

  // Enemies chase along a single axis per frame (whichever gap to the
  // player is currently larger), never both at once — same 4-direction
  // constraint as the player, no diagonal movement.
  const moveDist = (ENEMY_SPEED * dt) / 1000;
  for (const enemy of enemies) {
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      enemy.x += Math.sign(dx) * Math.min(moveDist, Math.abs(dx));
    } else if (dy !== 0) {
      enemy.y += Math.sign(dy) * Math.min(moveDist, Math.abs(dy));
    }
  }

  // Edge-triggered contact resolution: only act the moment an enemy
  // starts overlapping the player, not on every frame they stay pressed
  // together, so one contact is exactly one outcome.
  const contactDist = PLAYER_RADIUS + ENEMY_RADIUS;
  for (const enemy of enemies) {
    const overlapping = Math.hypot(player.x - enemy.x, player.y - enemy.y) < contactDist;
    if (overlapping && !enemy.overlapping) {
      const outcome = resolveContact(player.x, player.y, enemy.x, enemy.y, player.facing);
      if (outcome === "enemyDefeated") {
        enemy.dead = true;
      } else {
        player.hp = Math.max(0, player.hp - 1);
        hpEl.textContent = `HP: ${player.hp}`;
        if (player.hp <= 0) {
          gameOver = true;
          overlayEl.classList.add("show");
        }
      }
    }
    enemy.overlapping = overlapping;
  }
  enemies = enemies.filter((e) => !e.dead);
}

// Which sprite-sheet frame to show: cycles through the 4 walk frames as
// walkPhase advances, frozen on frame 0 (the standing pose) while idle.
function spriteFrameIndex() {
  if (!player.moving) return 0;
  const cycle = player.walkPhase % (Math.PI * 2);
  return Math.floor((cycle / (Math.PI * 2)) * SPRITE_COLS) % SPRITE_COLS;
}

function drawPlayer() {
  if (!playerSpriteLoaded) return;

  const frame = spriteFrameIndex();
  const flip = player.facing === "right";
  const row = SPRITE_ROW[flip ? "left" : player.facing];
  const sx = frame * SPRITE_CELL;
  const sy = row * SPRITE_CELL;

  ctx.save();
  ctx.translate(player.x, player.y + SPRITE_DRAW_OFFSET_Y);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(
    playerSprite,
    sx,
    sy,
    SPRITE_CELL,
    SPRITE_CELL,
    -SPRITE_DRAW_W / 2,
    -SPRITE_DRAW_H / 2,
    SPRITE_DRAW_W,
    SPRITE_DRAW_H
  );
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#eef1e8";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#d24545";
  for (const enemy of enemies) {
    ctx.fillRect(enemy.x - ENEMY_RADIUS, enemy.y - ENEMY_RADIUS, ENEMY_RADIUS * 2, ENEMY_RADIUS * 2);
  }

  drawPlayer();
}

function loop(now) {
  const dt = Math.min(now - lastTime, 50);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

resetGame();
requestAnimationFrame(loop);
