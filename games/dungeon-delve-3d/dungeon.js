// ---------- Pure dungeon logic: RNG, procedural generation, movement,
// real-time combat resolution, monster AI. No DOM/THREE dependency, so this
// is directly unit-testable under Node.
//
// Convention: discrete grid actions (generateFloor, attemptMove, descend)
// return fresh state objects. Per-frame real-time updates that run many
// times a second (stepMonsters, finishAttack) mutate their arguments in
// place instead — recreating the whole floor/monster tree on every
// animation frame would be wasteful and buys nothing here.

export const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2, DOOR: 3 };

// How many floors deep the player must reach to clear the run.
export const FLOOR_GOAL = 5;

// Monsters ignore the player until within this many grid steps, so a fresh
// floor never opens with several monsters converging on the spawn point at
// once (spawn placement below prefers cells further away than this, falling
// back to "the farthest half of the floor" on small maps where that isn't
// possible).
const AGGRO_RADIUS = 4;

// Compass headings: 0=N(dy-1), 1=E(dx+1), 2=S(dy+1), 3=W(dx-1).
export const HEADING_DELTA = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

export function turnLeft(heading) { return (heading + 3) % 4; }
export function turnRight(heading) { return (heading + 1) % 4; }
export function oppositeHeading(heading) { return (heading + 2) % 4; }
export function forwardCell(x, y, heading) {
  const d = HEADING_DELTA[heading];
  return { x: x + d.dx, y: y + d.dy };
}

export function tileAt(floor, x, y) {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return TILE.WALL;
  return floor.grid[y][x];
}

export function doorAt(floor, x, y) {
  return floor.doors.find((d) => d.x === x && d.y === y) || null;
}

// WALL always blocks. A DOOR blocks movement unless it's fully open — mid
// animation (opening/closing) and locked doors still block, matching the
// spec's "fully retracted before it's passable" rule. This is the
// real-time-aware check used for actual player/monster movement.
export function isBlockingTile(floor, x, y) {
  const t = tileAt(floor, x, y);
  if (t === TILE.WALL) return true;
  if (t === TILE.DOOR) {
    const door = doorAt(floor, x, y);
    return !door || door.state !== "open";
  }
  return false;
}

// Structural blocking: only real walls count. Used by generation-time
// layout logic (stairs BFS, spawn-distance sorting) so that doors — which
// all default to closed — don't fragment the floor's true topology; the
// player can always eventually open one, so generation should reason about
// the maze as if every door were passable.
function isStructurallyBlocking(floor, x, y) {
  return tileAt(floor, x, y) === TILE.WALL;
}

function canStepTo(floor, x, y, heading, blockingFn = isBlockingTile) {
  const target = forwardCell(x, y, heading);
  if (blockingFn(floor, target.x, target.y)) return null;
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
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- Weapons & monsters ----------
// swingTime is the visible swing motion (kept at its original, snappy
// pacing) and is also when the hit resolves. recoveryTime is everything
// after that before the next swing is allowed — sized so
// swingTime + recoveryTime equals 3x the original total cooldown (the
// cooldown was refilling too fast; the swing animation itself was not
// the problem).
export const WEAPONS = {
  dagger: { id: "dagger", name: "ダガー", atk: 3, swingTime: 220, recoveryTime: 1100 },
  sword: { id: "sword", name: "ソード", atk: 6, swingTime: 320, recoveryTime: 1600 },
  axe: { id: "axe", name: "アックス", atk: 10, swingTime: 500, recoveryTime: 2350 },
};

export const MONSTERS = {
  zombie: { type: "zombie", hp: 7, atk: 2, moveInterval: 2400, attackInterval: 2000 },
  skeleton: { type: "skeleton", hp: 12, atk: 4, moveInterval: 2200, attackInterval: 1900 },
  doppel: { type: "doppel", hp: 16, atk: 6, moveInterval: 2300, attackInterval: 2000 },
  ogre: { type: "ogre", hp: 22, atk: 7, moveInterval: 2800, attackInterval: 2300 },
};

function monsterPoolForFloor(floorNumber) {
  if (floorNumber >= 4) return ["zombie", "zombie", "skeleton", "skeleton", "doppel", "ogre"];
  if (floorNumber >= 3) return ["zombie", "zombie", "skeleton", "doppel"];
  return ["zombie"];
}

// ---------- Procedural generation ----------
function bfsDistances(floor, startX, startY, blockingFn = isBlockingTile) {
  const dist = Array.from({ length: floor.height }, () => new Array(floor.width).fill(Infinity));
  if (blockingFn(floor, startX, startY)) return dist;
  dist[startY][startX] = 0;
  const queue = [{ x: startX, y: startY }];
  let head = 0;
  while (head < queue.length) {
    const { x, y } = queue[head++];
    for (let h = 0; h < HEADING_DELTA.length; h++) {
      const next = canStepTo(floor, x, y, h, blockingFn);
      if (!next) continue;
      if (dist[next.y][next.x] !== Infinity) continue;
      dist[next.y][next.x] = dist[y][x] + 1;
      queue.push(next);
    }
  }
  return dist;
}

// ---------- Room + corridor generation (Torneko-style: a handful of
// rectangular rooms joined by single corridors, rather than a cave carve)
const MIN_ROOM_SIZE = 3, MAX_ROOM_SIZE = 5;

function roomCenter(room) {
  return { x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) };
}

// Rooms are placed one-per-sector on a grid that's sized to the target room
// count, with a 1-cell gutter reserved between sectors. This guarantees the
// requested 3-5 rooms always fit with no overlap, instead of the previous
// random-rejection placement which frequently gave up after only 1-2 rooms
// on these floor sizes.
function sectorLayoutFor(count) {
  if (count <= 3) return { cols: 3, rows: 1 };
  if (count === 4) return { cols: 2, rows: 2 };
  return { cols: 3, rows: 2 }; // count === 5 (6 sectors, one left unused)
}

// Returns the full list of cells the path touched (including its start),
// so the caller can later find exactly where it crosses from one room's
// footprint into open corridor space — that crossing point is where a door
// belongs.
function carveCorridorPath(grid, from, to, rng) {
  const path = [];
  let x = from.x, y = from.y;
  const step = () => {
    if (grid[y][x] === TILE.WALL) grid[y][x] = TILE.FLOOR;
    path.push({ x, y });
  };
  step();
  if (rng() < 0.5) {
    while (x !== to.x) { x += x < to.x ? 1 : -1; step(); }
    while (y !== to.y) { y += y < to.y ? 1 : -1; step(); }
  } else {
    while (y !== to.y) { y += y < to.y ? 1 : -1; step(); }
    while (x !== to.x) { x += x < to.x ? 1 : -1; step(); }
  }
  return path;
}

// Walks a corridor path and picks out the corridor-side cell(s) adjacent to
// each room it connects — the first cell after leaving fromRoomId, and the
// last corridor cell before entering toRoomId. Those are the natural
// doorway thresholds.
function boundaryDoorCells(path, roomIdGrid, fromRoomId, toRoomId) {
  const cells = [];
  let leftFrom = false, enteredTo = false;
  for (let i = 0; i < path.length; i++) {
    const { x, y } = path[i];
    const id = roomIdGrid[y][x];
    if (!leftFrom && id !== fromRoomId) {
      cells.push(path[i]);
      leftFrom = true;
    }
    if (leftFrom && !enteredTo && id === toRoomId) {
      const prev = path[i - 1];
      if (prev && roomIdGrid[prev.y][prev.x] === -1) cells.push(prev);
      enteredTo = true;
    }
  }
  return cells;
}

function carveRooms(size, rng) {
  const grid = Array.from({ length: size }, () => new Array(size).fill(TILE.WALL));
  const roomIdGrid = Array.from({ length: size }, () => new Array(size).fill(-1));
  const rooms = [];
  const targetRoomCount = 3 + Math.floor(rng() * 3); // 3..5
  const { cols, rows } = sectorLayoutFor(targetRoomCount);

  // Sector pitch reserves a 1-cell gutter between sectors (and a 1-cell
  // border around the whole grid) so sibling rooms can never end up
  // touching without a wall between them.
  const sectorW = Math.max(MIN_ROOM_SIZE, Math.floor((size - 2 - (cols - 1)) / cols));
  const sectorH = Math.max(MIN_ROOM_SIZE, Math.floor((size - 2 - (rows - 1)) / rows));

  const sectors = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) sectors.push({ r, c });
  shuffle(sectors, rng);
  const chosen = sectors.slice(0, Math.min(targetRoomCount, sectors.length));

  for (const sec of chosen) {
    const baseX = 1 + sec.c * (sectorW + 1);
    const baseY = 1 + sec.r * (sectorH + 1);
    const maxW = Math.min(MAX_ROOM_SIZE, sectorW);
    const maxH = Math.min(MAX_ROOM_SIZE, sectorH);
    const minW = Math.min(MIN_ROOM_SIZE, maxW);
    const minH = Math.min(MIN_ROOM_SIZE, maxH);
    const w = minW + Math.floor(rng() * (maxW - minW + 1));
    const h = minH + Math.floor(rng() * (maxH - minH + 1));
    const x = baseX + Math.floor(rng() * Math.max(1, sectorW - w + 1));
    const y = baseY + Math.floor(rng() * Math.max(1, sectorH - h + 1));
    const room = { id: rooms.length, x, y, w, h };
    rooms.push(room);
    for (let ry = y; ry < y + h; ry++) {
      for (let rx = x; rx < x + w; rx++) { grid[ry][rx] = TILE.FLOOR; roomIdGrid[ry][rx] = room.id; }
    }
  }
  if (rooms.length === 0) {
    const w = MIN_ROOM_SIZE, h = MIN_ROOM_SIZE;
    const x = (size - w) >> 1, y = (size - h) >> 1;
    const room = { id: 0, x, y, w, h };
    rooms.push(room);
    for (let ry = y; ry < y + h; ry++) for (let rx = x; rx < x + w; rx++) { grid[ry][rx] = TILE.FLOOR; roomIdGrid[ry][rx] = 0; }
  }

  const order = rooms.map((_, i) => i);
  shuffle(order, rng);
  const corridorPaths = [];
  for (let i = 1; i < order.length; i++) {
    const roomA = rooms[order[i - 1]], roomB = rooms[order[i]];
    const path = carveCorridorPath(grid, roomCenter(roomA), roomCenter(roomB), rng);
    corridorPaths.push({ path, fromRoomId: roomA.id, toRoomId: roomB.id });
  }

  const floorCells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y][x] !== TILE.WALL) floorCells.push({ x, y });
    }
  }
  return { grid, roomIdGrid, rooms, floorCells, corridorPaths, start: roomCenter(rooms[order[0]]) };
}

let entityIdSeq = 1;

// Carves a small sealed vault room a single door-cell away from some
// existing floor cell — an optional side-treasure, never on the only path
// to the stairs. The door is locked; the matching key is placed elsewhere
// among the floor's regular room cells by the caller (guaranteed reachable
// without ever needing to pass this door). Because the vault and its door
// are carved purely out of untouched wall space, this can never disturb
// the existing start<->stairs connectivity (unlike sealing a cell that was
// already part of a path), so no after-the-fact solvability check is
// needed here. Returns { keyId } on success, or null.
function placeVaultDoor(floor, floorCells, rooms, roomIdGrid, occupied, rng) {
  const size = floor.width;
  const grid = floor.grid;
  const VAULT_W = 2, VAULT_H = 2;

  function vaultRect(doorX, doorY, dir) {
    if (dir === 0) return { x: doorX - (VAULT_W >> 1), y: doorY - VAULT_H, w: VAULT_W, h: VAULT_H };
    if (dir === 2) return { x: doorX - (VAULT_W >> 1), y: doorY + 1, w: VAULT_W, h: VAULT_H };
    if (dir === 1) return { x: doorX + 1, y: doorY - (VAULT_H >> 1), w: VAULT_W, h: VAULT_H };
    return { x: doorX - VAULT_W, y: doorY - (VAULT_H >> 1), w: VAULT_W, h: VAULT_H };
  }
  function rectAllWall(r) {
    if (r.x < 1 || r.y < 1 || r.x + r.w >= size - 1 || r.y + r.h >= size - 1) return false;
    for (let y = r.y - 1; y <= r.y + r.h; y++) {
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        if (grid[y][x] !== TILE.WALL) return false;
      }
    }
    return true;
  }

  const anchors = shuffle(floorCells.slice(), rng);
  for (const c of anchors) {
    if (occupied.has(`${c.x},${c.y}`)) continue;
    const dirs = shuffle([0, 1, 2, 3], rng);
    for (const dir of dirs) {
      const d = HEADING_DELTA[dir];
      const doorX = c.x + d.dx, doorY = c.y + d.dy;
      if (doorX < 1 || doorY < 1 || doorX >= size - 1 || doorY >= size - 1) continue;
      if (grid[doorY][doorX] !== TILE.WALL) continue;
      const rect = vaultRect(doorX, doorY, dir);
      if (!rectAllWall(rect)) continue;

      const roomId = rooms.length;
      rooms.push({ id: roomId, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      const vaultCells = [];
      for (let ry = rect.y; ry < rect.y + rect.h; ry++) {
        for (let rx = rect.x; rx < rect.x + rect.w; rx++) {
          grid[ry][rx] = TILE.FLOOR;
          roomIdGrid[ry][rx] = roomId;
          vaultCells.push({ x: rx, y: ry });
          occupied.add(`${rx},${ry}`);
        }
      }
      grid[doorY][doorX] = TILE.DOOR;
      occupied.add(`${doorX},${doorY}`);

      const keyId = `key-${entityIdSeq}`;
      floor.doors.push({ id: entityIdSeq++, x: doorX, y: doorY, state: "closed", locked: true, keyId });

      const treasureCell = pick(vaultCells, rng);
      floor.items.push({ id: entityIdSeq++, kind: "potion", x: treasureCell.x, y: treasureCell.y, heal: 10 });
      return { keyId };
    }
  }
  return null;
}

// Marks a cell as seen on the minimap: a whole room reveals at once the
// instant it's entered, a corridor cell only reveals the exact steps taken.
function revealAt(floor, x, y) {
  const roomId = floor.roomIdGrid[y][x];
  if (roomId >= 0) floor.roomsEntered.add(roomId);
  else floor.explored.add(`${x},${y}`);
}

export function generateFloor(floorNumber, rng) {
  const size = 17 + Math.min(floorNumber - 1, 2) * 2; // 17 -> 19 -> 21 (caps at floor 3+)
  const { grid, roomIdGrid, rooms, floorCells, corridorPaths, start } = carveRooms(size, rng);
  const floor = {
    width: size, height: size, grid, monsters: [], items: [], doors: [],
    rooms, roomIdGrid, explored: new Set(), roomsEntered: new Set(),
  };

  // A door at every room<->corridor threshold — every room entrance starts
  // closed and has to be opened by hand (see toggleDoor / DOOR_ANIM_MS).
  const doorSeen = new Set();
  for (const { path, fromRoomId, toRoomId } of corridorPaths) {
    for (const cell of boundaryDoorCells(path, roomIdGrid, fromRoomId, toRoomId)) {
      const key = `${cell.x},${cell.y}`;
      if (doorSeen.has(key)) continue;
      doorSeen.add(key);
      grid[cell.y][cell.x] = TILE.DOOR;
      floor.doors.push({ id: entityIdSeq++, x: cell.x, y: cell.y, state: "closed", locked: false, keyId: null });
    }
  }

  const dist = bfsDistances(floor, start.x, start.y, isStructurallyBlocking);
  let stairs = start;
  let best = -1;
  for (const c of floorCells) {
    const dd = dist[c.y][c.x];
    if (dd !== Infinity && dd > best) { best = dd; stairs = c; }
  }
  grid[stairs.y][stairs.x] = TILE.STAIRS;

  const occupied = new Set([`${start.x},${start.y}`, `${stairs.x},${stairs.y}`, ...doorSeen]);
  const vaultResult = placeVaultDoor(floor, floorCells, rooms, roomIdGrid, occupied, rng);
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
  let ogrePlaced = false, doppelPlaced = false;
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
      if (ogrePlaced) type = "zombie";
      else ogrePlaced = true;
    } else if (type === "doppel") {
      if (doppelPlaced) type = "zombie";
      else doppelPlaced = true;
    }
    const tpl = MONSTERS[type];
    floor.monsters.push({
      id: entityIdSeq++,
      type,
      x: cell.x, y: cell.y,
      hp: tpl.hp, maxHp: tpl.hp, atk: tpl.atk,
      moveInterval: tpl.moveInterval, attackInterval: tpl.attackInterval,
      moveReadyAt: 0, attackReadyAt: 0, awake: false, windingUp: false,
    });
  }

  // Items are confined to room cells (never corridors) so their minimap
  // reveal-on-room-entry rule always has a room to attach to.
  const restCells = floorCells.filter((c) => !occupied.has(`${c.x},${c.y}`) && roomIdGrid[c.y][c.x] >= 0);
  if (vaultResult) {
    const cell = takeCell(restCells);
    if (cell) floor.items.push({ id: entityIdSeq++, kind: "key", x: cell.x, y: cell.y, keyId: vaultResult.keyId });
  }
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
    x: 0, y: 0, heading: 1, // 1 = East
    hp: 24, maxHp: 24,
    weapon: WEAPONS.dagger,
    floorNumber: 1,
    swingUntil: 0,
    attackReadyAt: now,
    keys: new Set(),
  };
}

export function initRun(now, rng) {
  const floor = generateFloor(1, rng);
  const player = createPlayer(now);
  player.x = floor.start.x;
  player.y = floor.start.y;
  revealAt(floor, player.x, player.y);
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
  revealAt(floor, target.x, target.y);

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
    if (item.kind === "key") {
      newPlayer.keys = new Set(player.keys);
      newPlayer.keys.add(item.keyId);
      return { player: newPlayer, event: { type: "itemPickup", kind: "key", keyId: item.keyId } };
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
    x: floor.start.x, y: floor.start.y, heading: 1,
  };
  revealAt(floor, floor.start.x, floor.start.y);
  return { event: { type: "descend" }, player: newPlayer, floor };
}

// ---------- Doors ----------
// Shutter-style: tapping a door's own cell is the only way to operate it
// (see main.js for the tap-to-raycast interaction). Both opening and
// closing take DOOR_ANIM_MS to resolve; isBlockingTile only treats a door
// as passable once its state is fully "open", so movement and the
// animation timing can never disagree about whether the cell is crossable.
export const DOOR_ANIM_MS = 900;
const DOOR_PINCH_DAMAGE = 4;

// Discrete action triggered by tapping a door cell. Mutates floor.doors /
// floor.monsters in place (see module-level convention note); returns a
// possibly-new player (a locked door consumes a key from player.keys).
export function toggleDoor(floor, player, x, y, now) {
  const door = doorAt(floor, x, y);
  if (!door) return { player, events: [{ type: "noDoor" }] };
  if (door.state === "opening" || door.state === "closing") {
    return { player, events: [{ type: "doorBusy" }] };
  }
  if (door.locked) {
    if (!player.keys.has(door.keyId)) {
      return { player, events: [{ type: "doorLocked" }] };
    }
    const newPlayer = { ...player, keys: new Set(player.keys) };
    newPlayer.keys.delete(door.keyId);
    door.locked = false;
    return { player: newPlayer, events: [{ type: "doorUnlocked" }] };
  }
  if (door.state === "closed") {
    door.state = "opening";
    door.actionReadyAt = now + DOOR_ANIM_MS;
    return { player, events: [{ type: "doorOpening" }] };
  }
  // door.state === "open" — closing it back up. Anything currently
  // standing in the doorway gets crushed for environmental damage,
  // separate from weapon attacks.
  const pinched = floor.monsters.filter((m) => m.x === x && m.y === y);
  door.state = "closing";
  door.actionReadyAt = now + DOOR_ANIM_MS;
  const events = [{ type: "doorClosing" }];
  for (const m of pinched) {
    m.hp -= DOOR_PINCH_DAMAGE;
    events.push({ type: "doorPinch", monsterId: m.id, monsterType: m.type, dmg: DOOR_PINCH_DAMAGE, killed: m.hp <= 0 });
  }
  if (pinched.some((m) => m.hp <= 0)) {
    floor.monsters = floor.monsters.filter((m) => !(m.x === x && m.y === y && m.hp <= 0));
  }
  return { player, events };
}

// Resolves door open/close animations once their timer elapses. Mutates
// floor.doors in place (see module-level convention note).
export function updateDoors(floor, now) {
  for (const door of floor.doors) {
    if (door.state === "opening" && now >= door.actionReadyAt) door.state = "open";
    else if (door.state === "closing" && now >= door.actionReadyAt) door.state = "closed";
  }
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
    const dist = Math.abs(player.x - m.x) + Math.abs(player.y - m.y);
    if (!m.awake) {
      if (dist > AGGRO_RADIUS) continue;
      m.awake = true;
    }
    if (dist === 1) {
      if (!m.windingUp) {
        // Just closed to melee range this tick — telegraph the first hit
        // instead of landing it the instant the monster arrives.
        m.windingUp = true;
        m.attackReadyAt = now + m.attackInterval;
      } else if (now >= m.attackReadyAt) {
        const dmg = Math.max(1, m.atk + variance(rng));
        player.hp -= dmg;
        m.attackReadyAt = now + m.attackInterval;
        events.push({ type: "monsterAttack", monsterId: m.id, monsterType: m.type, dmg });
        if (player.hp <= 0) events.push({ type: "playerDefeated" });
      }
    } else {
      // Stepped out of melee range — cancel any pending wind-up so
      // re-entering later starts a fresh telegraph, not an instant hit.
      m.windingUp = false;
      if (dist > 1 && now >= m.moveReadyAt) {
        occupied.delete(`${m.x},${m.y}`);
        const next = bestStepToward(floor, m.x, m.y, distField, occupied);
        if (next) { m.x = next.x; m.y = next.y; }
        occupied.add(`${m.x},${m.y}`);
        m.moveReadyAt = now + m.moveInterval;
      }
    }
  }
  return events;
}
