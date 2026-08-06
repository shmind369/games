// ---------- Scope (slice 1 of the WORLD ROGUE spec) ----------
// A seamless 100x100 open-field turn-based roguelike: one player action
// advances the world by exactly one turn, movement is 4-direction tile
// stepping, and combat happens by bumping into an enemy on the map — no
// separate battle screen. This slice covers: the world map itself,
// movement/camera, bump combat, and leveling. Deliberately NOT included
// yet (see README "スコープ外"): the two dungeon interiors, equipment,
// items, town shops/save, and the boss fight/ending — the map already
// places their landmarks (visible, some intentionally unreachable) so
// the overall shape of the game reads correctly even before they exist.

// ---------- World grid ----------
const SIZE = 100;
const T = {
  SEA: 0, PLAIN: 1, FOREST: 2, MOUNTAIN: 3, DESERT: 4, SWAMP: 5, WATER: 6,
  ROAD: 7, BRIDGE: 8, TOWN: 9, CASTLE: 10, GATE_LOCKED: 11,
  DUNGEON_ROCK: 12, DUNGEON_PYRAMID: 13,
};
const IMPASSABLE = new Set([T.SEA, T.MOUNTAIN, T.WATER, T.GATE_LOCKED]);
const WORLD_SEED = 20260806;
const TOWN_CENTER = { x: 50, y: 93 };
const CASTLE_CENTER = { x: 50, y: 12 };
const DUNGEON_ROCK_POS = { x: 17, y: 50 };
const DUNGEON_PYRAMID_POS = { x: 80, y: 52 };

// ---------- Pure logic (no DOM/canvas — directly unit testable) ----------
function idx(x, y) {
  return y * SIZE + x;
}
function inBounds(x, y) {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}
function isPassable(terrain) {
  return !IMPASSABLE.has(terrain);
}

// Deterministic PRNG (mulberry32) so the world layout and enemy spawns
// are reproducible/testable instead of different every load.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function computeDamage(atk, def, rng) {
  const variance = 0.85 + rng() * 0.3;
  return Math.max(1, Math.round((atk - def * 0.5) * variance));
}
function applyDamage(hp, amount) {
  return Math.max(0, hp - amount);
}
function xpForLevel(level) {
  return 10 + (level - 1) * 8;
}
// Applies XP and resolves however many level-ups it triggers. Returns the
// new {xp, level} plus how many levels were gained (0 if none).
function applyXp(xp, level, amount) {
  let newXp = xp + amount;
  let newLevel = level;
  let levelsGained = 0;
  while (newXp >= xpForLevel(newLevel)) {
    newXp -= xpForLevel(newLevel);
    newLevel += 1;
    levelsGained += 1;
  }
  return { xp: newXp, level: newLevel, levelsGained };
}

// Determines what a directional input against a given tile/occupant
// resolves to, without touching any game state — the caller applies it.
function resolveBump(terrain, occupantEnemy) {
  if (occupantEnemy) return "attack";
  if (terrain === T.GATE_LOCKED) return "locked";
  if (!isPassable(terrain)) return "blocked";
  return "move";
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Camera top-left tile so the view stays centered on the player but never
// shows outside the SIZE x SIZE grid.
function computeCameraOrigin(playerX, playerY, viewCols, viewRows) {
  const camX = clamp(playerX - (viewCols >> 1), 0, Math.max(0, SIZE - viewCols));
  const camY = clamp(playerY - (viewRows >> 1), 0, Math.max(0, SIZE - viewRows));
  return { camX, camY };
}

// ---------- World generation ----------
function fillRect(grid, x0, y0, x1, y1, terrain) {
  for (let y = Math.max(0, y0); y <= Math.min(SIZE - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(SIZE - 1, x1); x++) {
      grid[idx(x, y)] = terrain;
    }
  }
}
function fillEllipseNoisy(grid, cx, cy, rx, ry, terrain, rng, jitter) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const noise = (rng() - 0.5) * jitter * 0.06;
      if (dx * dx + dy * dy + noise <= 1) grid[idx(x, y)] = terrain;
    }
  }
}
function carvePath(grid, waypoints, terrain, width) {
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [x0, y0] = waypoints[i];
    const [x1, y1] = waypoints[i + 1];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      for (let wy = -width; wy <= width; wy++) {
        for (let wx = -width; wx <= width; wx++) {
          if (inBounds(x + wx, y + wy)) grid[idx(x + wx, y + wy)] = terrain;
        }
      }
    }
  }
}

function generateWorld(seed) {
  const rng = mulberry32(seed);
  const grid = new Uint8Array(SIZE * SIZE).fill(T.SEA);

  // Castle island (north), cut off from the mainland by a sea gap.
  fillEllipseNoisy(grid, 50, 12, 13, 8, T.MOUNTAIN, rng, 2);
  fillEllipseNoisy(grid, 50, 12, 8, 5, T.PLAIN, rng, 2);
  fillRect(grid, 47, 9, 52, 14, T.CASTLE);
  fillRect(grid, 0, 21, SIZE - 1, 27, T.SEA);

  // Mainland continent.
  fillEllipseNoisy(grid, 50, 66, 46, 37, T.PLAIN, rng, 3);
  fillEllipseNoisy(grid, 20, 45, 18, 20, T.FOREST, rng, 3);
  fillEllipseNoisy(grid, 72, 33, 11, 8, T.MOUNTAIN, rng, 2);
  fillEllipseNoisy(grid, 18, 75, 12, 9, T.MOUNTAIN, rng, 2);
  fillEllipseNoisy(grid, 78, 52, 17, 17, T.DESERT, rng, 3);
  fillEllipseNoisy(grid, 78, 80, 14, 12, T.SWAMP, rng, 3);

  // Town.
  fillRect(grid, 43, 88, 57, 97, T.PLAIN);
  fillRect(grid, 46, 90, 54, 96, T.TOWN);

  // Dungeon entrance landmarks (interiors are a future slice).
  fillEllipseNoisy(grid, DUNGEON_ROCK_POS.x, DUNGEON_ROCK_POS.y, 4, 4, T.PLAIN, rng, 1);
  grid[idx(DUNGEON_ROCK_POS.x, DUNGEON_ROCK_POS.y)] = T.DUNGEON_ROCK;
  grid[idx(DUNGEON_PYRAMID_POS.x, DUNGEON_PYRAMID_POS.y)] = T.DUNGEON_PYRAMID;

  // River, running roughly north-south through the mainland.
  carvePath(grid, [[50, 21], [49, 30], [51, 40], [48, 50], [51, 60], [49, 70], [50, 80], [50, 88]], T.WATER, 1);

  // Main road connecting the town up to the castle bridge.
  carvePath(grid, [[50, 33], [50, 45], [50, 55], [50, 65], [50, 75], [50, 86]], T.ROAD, 0);

  // The one bridge to the castle, plus the road connecting it to the
  // castle's interior through its mountain ring.
  fillRect(grid, 49, 21, 51, 27, T.BRIDGE);
  fillRect(grid, 49, 14, 51, 20, T.ROAD);

  // River crossings along the main road.
  for (const by of [40, 50, 60, 70, 80]) {
    fillRect(grid, 49, by - 1, 51, by + 1, T.BRIDGE);
  }

  // The castle bridge starts locked — this slice has no story-progression
  // system yet to ever unlock it, so it stays locked for the whole game.
  fillRect(grid, 49, 25, 51, 26, T.GATE_LOCKED);

  // Guarantee the outer border is sea per spec, regardless of noise.
  fillRect(grid, 0, 0, SIZE - 1, 1, T.SEA);
  fillRect(grid, 0, SIZE - 2, SIZE - 1, SIZE - 1, T.SEA);
  fillRect(grid, 0, 0, 1, SIZE - 1, T.SEA);
  fillRect(grid, SIZE - 2, 0, SIZE - 1, SIZE - 1, T.SEA);

  return grid;
}

// ---------- Enemies ----------
const ENEMY_LABELS = { slime: "スライム", wolf: "オオカミ", ghost: "ゴースト", mummy: "ミイラ", golem: "ゴーレム", dragon: "ドラゴン" };
const ENEMY_SPAWNS = [
  { type: "slime", hp: 8, atk: 3, def: 1, xp: 4, count: 14, box: [30, 70, 70, 90] },
  { type: "wolf", hp: 14, atk: 5, def: 2, xp: 8, count: 10, box: [10, 40, 60, 80] },
  { type: "ghost", hp: 12, atk: 6, def: 1, xp: 9, count: 8, box: [5, 25, 40, 65] },
  { type: "mummy", hp: 18, atk: 6, def: 3, xp: 12, count: 8, box: [65, 35, 95, 68] },
  { type: "golem", hp: 30, atk: 7, def: 6, xp: 20, count: 5, box: [60, 22, 88, 42] },
  { type: "golem", hp: 30, atk: 7, def: 6, xp: 20, count: 5, box: [8, 62, 32, 88] },
  { type: "dragon", hp: 50, atk: 12, def: 8, xp: 50, count: 3, box: [55, 25, 85, 40] },
];
const SPECIAL_TILES = new Set([T.TOWN, T.CASTLE, T.GATE_LOCKED, T.DUNGEON_ROCK, T.DUNGEON_PYRAMID]);

function spawnEnemies(grid, rng, townPos) {
  const enemies = [];
  let nextId = 1;
  for (const def of ENEMY_SPAWNS) {
    for (let i = 0; i < def.count; i++) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const x = def.box[0] + Math.floor(rng() * (def.box[2] - def.box[0]));
        const y = def.box[1] + Math.floor(rng() * (def.box[3] - def.box[1]));
        if (!inBounds(x, y)) continue;
        const terrain = grid[idx(x, y)];
        if (!isPassable(terrain) || SPECIAL_TILES.has(terrain)) continue;
        if (Math.hypot(x - townPos.x, y - townPos.y) < 10) continue;
        if (enemies.some((e) => e.x === x && e.y === y)) continue;
        enemies.push({
          id: nextId++, type: def.type, x, y,
          hp: def.hp, maxHp: def.hp, atk: def.atk, def: def.def, xp: def.xp,
          alive: true,
        });
        break;
      }
    }
  }
  return enemies;
}

// ---------- Canvas setup ----------
const gameAreaEl = document.getElementById("gameArea");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let width = 0;
let height = 0;
function resize() {
  // The play view only occupies the #gameArea half of the screen (Wonders-
  // Dungeon-style split), so size the canvas off its own box, not the window.
  const rect = gameAreaEl.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Setting canvas.width/height clears its contents per the Canvas spec,
  // so any resize after the game has already started (address bar
  // show/hide, orientation settling, etc.) needs an explicit re-render —
  // otherwise the map stays blank until the player's next action. Guard
  // for the very first call, made before `player`/`grid` exist yet;
  // resetGame() renders once on its own right after this returns.
  if (player && grid) render();
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);

const worldMapCanvas = document.getElementById("worldMapCanvas");
const worldMapCtx = worldMapCanvas.getContext("2d");

// ---------- Game state ----------
let grid = null;
let enemies = [];
let combatRng = Math.random;
let player = null;
let gameOver = false;
let messages = [];

const AGGRO_RADIUS = 6;
const DEFEND_DAMAGE_MULT = 0.5;
// 8-direction movement (including diagonals) — the classic Mystery-Dungeon-
// genre control scheme, rather than the orthogonal-only 4-direction pad
// the original spec called for.
const DIRS = {
  up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 },
  upLeft: { dx: -1, dy: -1 }, upRight: { dx: 1, dy: -1 }, downLeft: { dx: -1, dy: 1 }, downRight: { dx: 1, dy: 1 },
};

const lvEl = document.getElementById("lv");
const hpTextEl = document.getElementById("hpText");
const hpFillEl = document.getElementById("hpFill");
const xpTextEl = document.getElementById("xpText");
const xpFillEl = document.getElementById("xpFill");
const messageLogEl = document.getElementById("messageLog");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlayTitle");
const overlaySubtitleEl = document.getElementById("overlaySubtitle");
const worldMapOverlayEl = document.getElementById("worldMapOverlay");

function resetGame() {
  grid = generateWorld(WORLD_SEED);
  const spawnRng = mulberry32(WORLD_SEED + 1);
  enemies = spawnEnemies(grid, spawnRng, TOWN_CENTER);
  player = {
    x: TOWN_CENTER.x, y: TOWN_CENTER.y,
    level: 1, xp: 0,
    hp: 20, maxHp: 20, mp: 5, maxMp: 5, atk: 6, def: 3,
    defending: false,
  };
  gameOver = false;
  messages = [];
  overlayEl.classList.remove("show");
  worldMapOverlayEl.classList.remove("show");
  messageLogEl.replaceChildren();
  resize();
  updateHud();
  render();
}

function pushMessage(text) {
  messages.unshift(text);
  messages = messages.slice(0, 3);
  messageLogEl.replaceChildren(
    ...messages.map((m) => {
      const d = document.createElement("div");
      d.textContent = m;
      return d;
    })
  );
}

function updateHud() {
  lvEl.textContent = String(player.level);
  hpTextEl.textContent = `HP ${player.hp}/${player.maxHp}`;
  hpFillEl.style.width = `${Math.max(0, (player.hp / player.maxHp) * 100)}%`;
  const need = xpForLevel(player.level);
  xpTextEl.textContent = `XP ${player.xp}/${need}`;
  xpFillEl.style.width = `${(player.xp / need) * 100}%`;
}

function triggerGameOver() {
  gameOver = true;
  overlayTitleEl.textContent = "GAME OVER";
  overlaySubtitleEl.textContent = `Lv${player.level} で力尽きた…`;
  overlayEl.classList.add("show");
}

function grantXp(amount) {
  const result = applyXp(player.xp, player.level, amount);
  player.xp = result.xp;
  if (result.levelsGained > 0) {
    for (let i = 0; i < result.levelsGained; i++) {
      player.maxHp += 6;
      player.maxMp += 2;
      player.atk += 2;
      player.def += 1;
    }
    player.level = result.level;
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    pushMessage(`レベルアップ！ Lv${player.level}になった`);
  }
}

function effectivePlayerDef() {
  return player.defending ? player.def + Math.round(player.def * DEFEND_DAMAGE_MULT) : player.def;
}

function checkLandmarkMessage(terrain) {
  if (terrain === T.DUNGEON_ROCK) pushMessage("岩の迷宮の入口だ…(準備中)");
  else if (terrain === T.DUNGEON_PYRAMID) pushMessage("ピラミッドの入口だ…(準備中)");
}

function tryMoveEnemy(enemy, nx, ny) {
  if (!inBounds(nx, ny)) return;
  const terrain = grid[idx(nx, ny)];
  if (!isPassable(terrain) || SPECIAL_TILES.has(terrain)) return;
  if (nx === player.x && ny === player.y) return;
  if (enemies.some((e) => e.alive && e.id !== enemy.id && e.x === nx && e.y === ny)) return;
  enemy.x = nx;
  enemy.y = ny;
}

function processEnemyTurn() {
  for (const enemy of enemies) {
    if (!enemy.alive || gameOver) continue;
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    // Chebyshev (8-direction) distance, matching the player's own movement
    // freedom — otherwise enemies would feel stuck on rails next to a
    // player who can now step and attack diagonally.
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist === 1) {
      const dmg = computeDamage(enemy.atk, effectivePlayerDef(), combatRng);
      player.hp = applyDamage(player.hp, dmg);
      pushMessage(`${ENEMY_LABELS[enemy.type]}の攻撃！ ${dmg}のダメージ`);
      if (player.hp <= 0) {
        triggerGameOver();
        return;
      }
    } else if (dist <= AGGRO_RADIUS) {
      const stepX = Math.sign(dx);
      const stepY = Math.sign(dy);
      tryMoveEnemy(enemy, enemy.x + stepX, enemy.y + stepY);
    } else if (combatRng() < 0.3) {
      const dirKeys = Object.keys(DIRS);
      const d = DIRS[dirKeys[Math.floor(combatRng() * dirKeys.length)]];
      tryMoveEnemy(enemy, enemy.x + d.dx, enemy.y + d.dy);
    }
  }
}

function endPlayerTurn() {
  processEnemyTurn();
  player.defending = false;
  updateHud();
  render();
}

function performMove(direction) {
  if (gameOver) return;
  const { dx, dy } = DIRS[direction];
  const nx = player.x + dx;
  const ny = player.y + dy;
  if (!inBounds(nx, ny)) return;
  const targetEnemy = enemies.find((e) => e.alive && e.x === nx && e.y === ny);
  const terrain = grid[idx(nx, ny)];
  const outcome = resolveBump(terrain, targetEnemy);

  if (outcome === "attack") {
    const dmg = computeDamage(player.atk, targetEnemy.def, combatRng);
    targetEnemy.hp = applyDamage(targetEnemy.hp, dmg);
    pushMessage(`${ENEMY_LABELS[targetEnemy.type]}に${dmg}のダメージ！`);
    if (targetEnemy.hp <= 0) {
      targetEnemy.alive = false;
      pushMessage(`${ENEMY_LABELS[targetEnemy.type]}を倒した！`);
      grantXp(targetEnemy.xp);
    }
    endPlayerTurn();
  } else if (outcome === "locked") {
    pushMessage("鍵がかかっている…");
  } else if (outcome === "blocked") {
    pushMessage("進めない。");
  } else {
    player.x = nx;
    player.y = ny;
    checkLandmarkMessage(terrain);
    endPlayerTurn();
  }
}

function performWait() {
  if (gameOver) return;
  pushMessage("様子を見ている…");
  endPlayerTurn();
}

function performDefend() {
  if (gameOver) return;
  player.defending = true;
  pushMessage("身を守っている…");
  endPlayerTurn();
}

// ---------- Rendering ----------
const TERRAIN_COLORS = {
  [T.SEA]: "#1b4a6b", [T.PLAIN]: "#5a9c4a", [T.FOREST]: "#2f6b35", [T.MOUNTAIN]: "#8a8378",
  [T.DESERT]: "#d9c06a", [T.SWAMP]: "#4a5a3a", [T.WATER]: "#2f78b5", [T.ROAD]: "#c2a876",
  [T.BRIDGE]: "#a9884f", [T.TOWN]: "#c99a5b", [T.CASTLE]: "#666f8a", [T.GATE_LOCKED]: "#7a3b3b",
  [T.DUNGEON_ROCK]: "#4a4038", [T.DUNGEON_PYRAMID]: "#b58a3d",
};
const ENEMY_COLORS = { slime: "#7ed957", wolf: "#b0b0b0", ghost: "#cfd8ff", mummy: "#d8c98a", golem: "#8b7355", dragon: "#e05555" };

let TILE_PX = 34;

function drawDecoration(terrain, px, py, size) {
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  if (terrain === T.FOREST) {
    ctx.beginPath();
    ctx.arc(px + size * 0.3, py + size * 0.35, size * 0.14, 0, Math.PI * 2);
    ctx.arc(px + size * 0.65, py + size * 0.6, size * 0.16, 0, Math.PI * 2);
    ctx.fill();
  } else if (terrain === T.MOUNTAIN) {
    ctx.beginPath();
    ctx.moveTo(px + size * 0.2, py + size * 0.8);
    ctx.lineTo(px + size * 0.5, py + size * 0.2);
    ctx.lineTo(px + size * 0.8, py + size * 0.8);
    ctx.closePath();
    ctx.fill();
  } else if (terrain === T.DESERT) {
    ctx.beginPath();
    ctx.arc(px + size * 0.3, py + size * 0.5, size * 0.06, 0, Math.PI * 2);
    ctx.arc(px + size * 0.7, py + size * 0.3, size * 0.06, 0, Math.PI * 2);
    ctx.fill();
  } else if (terrain === T.SEA || terrain === T.WATER) {
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = Math.max(1, size * 0.04);
    ctx.beginPath();
    ctx.moveTo(px + size * 0.15, py + size * 0.55);
    ctx.quadraticCurveTo(px + size * 0.5, py + size * 0.4, px + size * 0.85, py + size * 0.55);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, width, height);
  const viewCols = Math.ceil(width / TILE_PX) + 1;
  const viewRows = Math.ceil(height / TILE_PX) + 1;
  const { camX, camY } = computeCameraOrigin(player.x, player.y, viewCols, viewRows);

  for (let ty = 0; ty < viewRows; ty++) {
    const wy = camY + ty;
    if (wy < 0 || wy >= SIZE) continue;
    for (let tx = 0; tx < viewCols; tx++) {
      const wx = camX + tx;
      if (wx < 0 || wx >= SIZE) continue;
      const terrain = grid[idx(wx, wy)];
      const px = tx * TILE_PX;
      const py = ty * TILE_PX;
      ctx.fillStyle = TERRAIN_COLORS[terrain];
      ctx.fillRect(px, py, TILE_PX, TILE_PX);
      drawDecoration(terrain, px, py, TILE_PX);
    }
  }

  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.x < camX || e.x >= camX + viewCols || e.y < camY || e.y >= camY + viewRows) continue;
    const px = (e.x - camX) * TILE_PX;
    const py = (e.y - camY) * TILE_PX;
    ctx.fillStyle = ENEMY_COLORS[e.type] || "#ffffff";
    ctx.beginPath();
    ctx.arc(px + TILE_PX / 2, py + TILE_PX / 2, TILE_PX * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  const ppx = (player.x - camX) * TILE_PX;
  const ppy = (player.y - camY) * TILE_PX;
  ctx.fillStyle = "#3a6bd8";
  ctx.beginPath();
  ctx.arc(ppx + TILE_PX / 2, ppy + TILE_PX / 2, TILE_PX * 0.36, 0, Math.PI * 2);
  ctx.fill();
}

function render() {
  TILE_PX = Math.max(18, Math.floor(width / 9));
  draw();
}

function renderWorldMapOverview() {
  const w = worldMapCanvas.width;
  const h = worldMapCanvas.height;
  const px = w / SIZE;
  worldMapCtx.clearRect(0, 0, w, h);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      worldMapCtx.fillStyle = TERRAIN_COLORS[grid[idx(x, y)]];
      worldMapCtx.fillRect(x * px, y * px, px + 0.5, px + 0.5);
    }
  }
  worldMapCtx.strokeStyle = "#ffe066";
  worldMapCtx.lineWidth = 2;
  worldMapCtx.strokeRect(CASTLE_CENTER.x * px - 10, CASTLE_CENTER.y * px - 10, 20, 20);
  worldMapCtx.fillStyle = "#3a6bd8";
  worldMapCtx.beginPath();
  worldMapCtx.arc(player.x * px, player.y * px, 4, 0, Math.PI * 2);
  worldMapCtx.fill();
}

// ---------- Input wiring ----------
document.getElementById("dUp").addEventListener("click", () => performMove("up"));
document.getElementById("dDown").addEventListener("click", () => performMove("down"));
document.getElementById("dLeft").addEventListener("click", () => performMove("left"));
document.getElementById("dRight").addEventListener("click", () => performMove("right"));
document.getElementById("dUpLeft").addEventListener("click", () => performMove("upLeft"));
document.getElementById("dUpRight").addEventListener("click", () => performMove("upRight"));
document.getElementById("dDownLeft").addEventListener("click", () => performMove("downLeft"));
document.getElementById("dDownRight").addEventListener("click", () => performMove("downRight"));
document.getElementById("waitBtn").addEventListener("click", performWait);
document.getElementById("defendBtn").addEventListener("click", performDefend);
document.getElementById("restartBtn").addEventListener("click", resetGame);
document.getElementById("mapToggle").addEventListener("click", () => {
  renderWorldMapOverview();
  worldMapOverlayEl.classList.add("show");
});
document.getElementById("closeMapBtn").addEventListener("click", () => {
  worldMapOverlayEl.classList.remove("show");
});

resetGame();
