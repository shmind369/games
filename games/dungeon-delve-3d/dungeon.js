// ---------- Pure dungeon logic: RNG, procedural generation, movement,
// real-time combat resolution, monster AI. No DOM/THREE dependency, so this
// is directly unit-testable under Node.
//
// Convention: discrete grid actions (generateFloor, attemptMove, descend)
// return fresh state objects. Per-frame real-time updates that run many
// times a second (stepMonsters, finishAttack) mutate their arguments in
// place instead — recreating the whole floor/monster tree on every
// animation frame would be wasteful and buys nothing here.

export const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2 };

// How many floors deep the player must reach to clear the run.
export const FLOOR_GOAL = 5;

// Monsters ignore the player until within this many grid steps, so a fresh
// floor never opens with several monsters converging on the spawn point at
// once (spawn placement below prefers cells further away than this, falling
// back to "the farthest half of the floor" on small maps where that isn't
// possible). Diagonal movement shortens path lengths, so this is generous
// on purpose.
const AGGRO_RADIUS = 6;

// 8-way compass headings, 45° apart: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW.
export const HEADING_DELTA = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
];
// Cardinal-only subset, used by the dungeon carver so corridors stay
// axis-aligned (diagonal mobility is a player/monster movement rule, not a
// map-generation one).
const CARDINAL_DELTA = [HEADING_DELTA[0], HEADING_DELTA[2], HEADING_DELTA[4], HEADING_DELTA[6]];

export function turnLeft(heading) { return (heading + 7) % 8; }
export function turnRight(heading) { return (heading + 1) % 8; }
export function oppositeHeading(heading) { return (heading + 4) % 8; }
export function forwardCell(x, y, heading) {
  const d = HEADING_DELTA[heading];
  return { x: x + d.dx, y: y + d.dy };
}

export function tileAt(floor, x, y) {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return TILE.WALL;
  return floor.grid[y][x];
}

// Diagonal headings (odd indices) are only passable if both flanking
// cardinal cells are open too — otherwise you could cut across a solid
// wall corner. Returns the target cell, or null if the step is blocked.
function canStepTo(floor, x, y, heading) {
  const target = forwardCell(x, y, heading);
  if (tileAt(floor, target.x, target.y) === TILE.WALL) return null;
  if (heading % 2 === 1) {
    const c1 = forwardCell(x, y, (heading + 7) % 8);
    const c2 = forwardCell(x, y, (heading + 1) % 8);
    if (tileAt(floor, c1.x, c1.y) === TILE.WALL || tileAt(floor, c2.x, c2.y) === TILE.WALL) return null;
  }
  return target;
}

// ---------- RNG (mulberry32) ----------
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
function variance(rng) { return Math.floor(rng() * 3) - 1; } // -1, 0, +1

// ---------- Weapons & monsters ----------
export const WEAPONS = {
  dagger: { id: "dagger", name: "ダガー", atk: 3, swingTime: 220, recoveryTime: 220 },
  sword: { id: "sword", name: "ソード", atk: 6, swingTime: 320, recoveryTime: 320 },
  axe: { id: "axe", name: "アックス", atk: 10, swingTime: 500, recoveryTime: 450 },
};

export const MONSTERS = {
  rat: { type: "rat", hp: 5, atk: 2, moveInterval: 900, attackInterval: 900 },
  skeleton: { type: "skeleton", hp: 12, atk: 4, moveInterval: 1100, attackInterval: 950 },
  ogre: { type: "ogre", hp: 22, atk: 7, moveInterval: 1400, attackInterval: 1150 },
};

function monsterPoolForFloor(floorNumber) {
  if (floorNumber >= 4) return ["rat", "rat", "skeleton", "skeleton", "ogre"];
  if (floorNumber >= 3) return ["rat", "rat", "skeleton"];
  return ["rat"];
}

// ---------- Procedural generation ----------
function bfsDistances(floor, startX, startY) {
  const dist = Array.from({ length: floor.height }, () => new Array(floor.width).fill(Infinity));
  if (tileAt(floor, startX, startY) === TILE.WALL) return dist;
  dist[startY][startX] = 0;
  const queue = [{ x: startX, y: startY }];
  let head = 0;
  while (head < queue.length) {
    const { x, y } = queue[head++];
    for (let h = 0; h < HEADING_DELTA.length; h++) {
      const next = canStepTo(floor, x, y, h);
      if (!next) continue;
      if (dist[next.y][next.x] !== Infinity) continue;
      dist[next.y][next.x] = dist[y][x] + 1;
      queue.push(next);
    }
  }
  return dist;
}

function carve(size, rng) {
  const grid = Array.from({ length: size }, () => new Array(size).fill(TILE.WALL));
  const cx = size >> 1, cy = size >> 1;
  grid[cy][cx] = TILE.FLOOR;
  const floorCells = [{ x: cx, y: cy }];
  let x = cx, y = cy;
  const target = Math.floor(size * size * 0.4);
  let guard = 0;
  while (floorCells.length < target && guard < size * size * 40) {
    guard++;
    const d = CARDINAL_DELTA[Math.floor(rng() * 4)];
    const nx = x + d.dx, ny = y + d.dy;
    if (nx < 1 || ny < 1 || nx >= size - 1 || ny >= size - 1) {
      const p = pick(floorCells, rng);
      x = p.x; y = p.y;
      continue;
    }
    x = nx; y = ny;
    if (grid[y][x] === TILE.WALL) {
      grid[y][x] = TILE.FLOOR;
      floorCells.push({ x, y });
    }
    if (rng() < 0.08) {
      const p = pick(floorCells, rng);
      x = p.x; y = p.y;
    }
  }
  return { grid, floorCells, start: { x: cx, y: cy } };
}

let entityIdSeq = 1;

export function generateFloor(floorNumber, rng) {
  const size = 11 + Math.min(floorNumber - 1, 2) * 2; // 11 -> 13 -> 15 (caps at floor 3+)
  const { grid, floorCells, start } = carve(size, rng);
  const floor = { width: size, height: size, grid, monsters: [], items: [] };

  const dist = bfsDistances(floor, start.x, start.y);
  let stairs = start;
  let best = -1;
  for (const c of floorCells) {
    const dd = dist[c.y][c.x];
    if (dd !== Infinity && dd > best) { best = dd; stairs = c; }
  }
  grid[stairs.y][stairs.x] = TILE.STAIRS;

  const occupied = new Set([`${start.x},${start.y}`, `${stairs.x},${stairs.y}`]);
  // Keep monster spawns out past AGGRO_RADIUS so a floor never opens with
  // several monsters already awake and converging on the player. Diagonal
  // shortcuts make BFS distances shorter than a cardinal-only map would
  // give, and small early floors don't always have enough cells past a
  // fixed radius — so fall back to "farthest half of the floor" instead of
  // failing to place monsters at all.
  const candidates = floorCells.filter((c) => !occupied.has(`${c.x},${c.y}`));
  candidates.sort((a, b) => dist[b.y][b.x] - dist[a.y][a.x]);
  const beyondAggro = candidates.filter((c) => dist[c.y][c.x] > AGGRO_RADIUS);
  const farCells = beyondAggro.length >= 4 ? beyondAggro : candidates.slice(0, Math.max(4, Math.ceil(candidates.length / 2)));

  function takeCell(pool) {
    if (pool.length === 0) return null;
    const idx = Math.floor(rng() * pool.length);
    const c = pool[idx];
    pool.splice(idx, 1);
    occupied.add(`${c.x},${c.y}`);
    return c;
  }

  const monsterCount = Math.min(1 + floorNumber, 6);
  const pool = monsterPoolForFloor(floorNumber);
  let ogrePlaced = false;
  // Keep spawn points spread apart so the player can't wake two monsters
  // at once just by approaching one (no instant 2-on-1 pack fights).
  const MIN_MONSTER_SPACING = 3;
  for (let i = 0; i < monsterCount; i++) {
    const cell = takeCell(farCells);
    if (!cell) break;
    for (let j = farCells.length - 1; j >= 0; j--) {
      const d = Math.abs(farCells[j].x - cell.x) + Math.abs(farCells[j].y - cell.y);
      if (d < MIN_MONSTER_SPACING) farCells.splice(j, 1);
    }
    let type = pick(pool, rng);
    if (type === "ogre") {
      if (ogrePlaced) type = "rat";
      else ogrePlaced = true;
    }
    const tpl = MONSTERS[type];
    floor.monsters.push({
      id: entityIdSeq++,
      type,
      x: cell.x, y: cell.y,
      hp: tpl.hp, maxHp: tpl.hp, atk: tpl.atk,
      moveInterval: tpl.moveInterval, attackInterval: tpl.attackInterval,
      moveReadyAt: 0, attackReadyAt: 0, awake: false,
    });
  }

  const restCells = floorCells.filter((c) => !occupied.has(`${c.x},${c.y}`));
  const potionCount = 2 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < potionCount; i++) {
    const cell = takeCell(restCells);
    if (!cell) break;
    floor.items.push({ id: entityIdSeq++, kind: "potion", x: cell.x, y: cell.y, heal: 10 });
  }
  if (floorNumber === 2 || floorNumber === 4) {
    const cell = takeCell(restCells);
    if (cell) {
      const weaponId = floorNumber === 2 ? "sword" : "axe";
      floor.items.push({ id: entityIdSeq++, kind: "weapon", x: cell.x, y: cell.y, weaponId });
    }
  }

  return { ...floor, start, stairs };
}

// ---------- Player / run lifecycle ----------
export function createPlayer(now) {
  return {
    x: 0, y: 0, heading: 2, // 2 = East
    hp: 24, maxHp: 24,
    weapon: WEAPONS.dagger,
    floorNumber: 1,
    swingUntil: 0,
    attackReadyAt: now,
  };
}

export function initRun(now, rng) {
  const floor = generateFloor(1, rng);
  const player = createPlayer(now);
  player.x = floor.start.x;
  player.y = floor.start.y;
  return { floor, player };
}

// ---------- Movement ----------
function monsterAt(floor, x, y) {
  return floor.monsters.find((m) => m.x === x && m.y === y) || null;
}

export function attemptMove(player, floor, stepHeading, now) {
  if (player.swingUntil && now < player.swingUntil) {
    return { player, event: { type: "busy" } };
  }
  const target = canStepTo(floor, player.x, player.y, stepHeading);
  if (!target) {
    return { player, event: { type: "blocked" } };
  }
  const tile = tileAt(floor, target.x, target.y);
  if (monsterAt(floor, target.x, target.y)) {
    return { player, event: { type: "blockedByMonster" } };
  }

  const newPlayer = { ...player, x: target.x, y: target.y };

  const item = floor.items.find((it) => it.x === target.x && it.y === target.y);
  if (item) {
    floor.items = floor.items.filter((it) => it !== item);
    if (item.kind === "potion") {
      newPlayer.hp = Math.min(newPlayer.maxHp, newPlayer.hp + item.heal);
      return { player: newPlayer, event: { type: "itemPickup", kind: "potion", heal: item.heal } };
    }
    if (item.kind === "weapon") {
      newPlayer.weapon = WEAPONS[item.weaponId];
      return { player: newPlayer, event: { type: "itemPickup", kind: "weapon", weapon: newPlayer.weapon } };
    }
  }

  if (tile === TILE.STAIRS) {
    return { player: newPlayer, event: { type: "reachStairs" } };
  }

  return { player: newPlayer, event: { type: "moved" } };
}

export function descend(player, rng, now) {
  const nextFloorNumber = player.floorNumber + 1;
  if (nextFloorNumber >= FLOOR_GOAL) {
    return { event: { type: "win" }, player: { ...player, floorNumber: nextFloorNumber } };
  }
  const floor = generateFloor(nextFloorNumber, rng);
  const newPlayer = {
    ...player,
    floorNumber: nextFloorNumber,
    x: floor.start.x, y: floor.start.y, heading: 2,
  };
  return { event: { type: "descend" }, player: newPlayer, floor };
}

// ---------- Real-time combat ----------
export function canAttack(player, now) {
  return !player.swingUntil && now >= player.attackReadyAt;
}

// Begins the swing; the caller resolves the hit once `swingUntil` elapses
// by calling finishAttack. Mutates player (see module-level convention note).
export function startAttack(player, now) {
  if (!canAttack(player, now)) return null;
  player.swingUntil = now + player.weapon.swingTime;
  return player.weapon.swingTime;
}

export function finishAttack(player, floor, rng, now) {
  player.swingUntil = 0;
  player.attackReadyAt = now + player.weapon.recoveryTime;
  const { x, y } = forwardCell(player.x, player.y, player.heading);
  const target = monsterAt(floor, x, y);
  if (!target) return { type: "attackMiss" };
  const dmg = Math.max(1, player.weapon.atk + variance(rng));
  target.hp -= dmg;
  if (target.hp <= 0) {
    floor.monsters = floor.monsters.filter((m) => m !== target);
    return { type: "attackHit", monsterId: target.id, monsterType: target.type, dmg, killed: true };
  }
  return { type: "attackHit", monsterId: target.id, monsterType: target.type, dmg, killed: false };
}

function bestStepToward(floor, x, y, distField, occupied) {
  let best = null, bestDist = distField[y][x];
  for (let h = 0; h < HEADING_DELTA.length; h++) {
    const next = canStepTo(floor, x, y, h);
    if (!next) continue;
    if (occupied.has(`${next.x},${next.y}`)) continue;
    const dd = distField[next.y][next.x];
    if (dd < bestDist) { bestDist = dd; best = next; }
  }
  return best;
}

// Advances monster AI by one real-time tick. Mutates `player.hp` and each
// monster's position/cooldowns in place (see module-level convention note).
export function stepMonsters(floor, player, now, rng) {
  const events = [];
  if (floor.monsters.length === 0) return events;
  const distField = bfsDistances(floor, player.x, player.y);
  const occupied = new Set(floor.monsters.map((m) => `${m.x},${m.y}`));

  for (const m of floor.monsters) {
    // Chebyshev distance: with 8-way movement, diagonal neighbors count as
    // 1 step away too, same as cardinal ones.
    const dist = Math.max(Math.abs(player.x - m.x), Math.abs(player.y - m.y));
    if (!m.awake) {
      if (dist > AGGRO_RADIUS) continue;
      m.awake = true;
    }
    if (dist === 1) {
      if (now >= m.attackReadyAt) {
        const dmg = Math.max(1, m.atk + variance(rng));
        player.hp -= dmg;
        m.attackReadyAt = now + m.attackInterval;
        events.push({ type: "monsterAttack", monsterId: m.id, monsterType: m.type, dmg });
        if (player.hp <= 0) events.push({ type: "playerDefeated" });
      }
    } else if (dist > 1 && now >= m.moveReadyAt) {
      occupied.delete(`${m.x},${m.y}`);
      const next = bestStepToward(floor, m.x, m.y, distField, occupied);
      if (next) { m.x = next.x; m.y = next.y; }
      occupied.add(`${m.x},${m.y}`);
      m.moveReadyAt = now + m.moveInterval;
    }
  }
  return events;
}
