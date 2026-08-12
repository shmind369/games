// ---------- Pure maze logic: parsing, movement, item collection, secret
// walls, floor transitions, win condition. No DOM/THREE dependency, so this
// is directly unit-testable under Node.

export const TILE = {
  WALL: "#",
  FLOOR: ".",
  START: "S",
  ITEM: "I",
  SECRET: "X", // looks like a wall; becomes FLOOR once searched
  STAIRS_UP: "U", // floor 0 only -> floor 1 at the STAIRS_DOWN tile
  STAIRS_DOWN: "D", // floor 1 only -> floor 0 at the STAIRS_UP tile
  ROOF_DOOR: "R", // floor 1 only -> win, if all items collected
};

export function parseFloor(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const grid = rows.map((row) => row.split(""));
  return { width, height, grid };
}

export function tileAt(floor, x, y) {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return TILE.WALL;
  return floor.grid[y][x];
}

export function findTile(floor, tile) {
  for (let y = 0; y < floor.height; y++) {
    for (let x = 0; x < floor.width; x++) {
      if (floor.grid[y][x] === tile) return { x, y };
    }
  }
  return null;
}

export function countItems(floors) {
  let n = 0;
  for (const f of floors) {
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        if (f.grid[y][x] === TILE.ITEM) n++;
      }
    }
  }
  return n;
}

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

export function isPassable(tile) {
  return tile === TILE.FLOOR || tile === TILE.START || tile === TILE.ITEM
    || tile === TILE.STAIRS_UP || tile === TILE.STAIRS_DOWN;
}

export function createInitialState(floors) {
  const start = findTile(floors[0], TILE.START);
  return {
    floorIndex: 0,
    x: start.x,
    y: start.y,
    heading: 1, // facing east by default
    itemsCollected: 0,
    // Snapshotted once here, before any collection mutates the grid — item
    // tiles turn into FLOOR on pickup, so counting ITEM tiles later would
    // undercount the original total.
    totalItems: countItems(floors),
    win: false,
  };
}

// Returns { state, event } where event.type is one of:
// 'moved' | 'blocked' | 'collected' | 'floorChange' | 'locked' | 'win'
// `stepHeading` defaults to state.heading (move forward); pass
// (state.heading+2)%4 to step backward while keeping the facing direction
// unchanged (the classic dungeon-crawler "back up without turning around").
export function attemptMove(state, floors, stepHeading = state.heading) {
  const floor = floors[state.floorIndex];
  const target = forwardCell(state.x, state.y, stepHeading);
  const tile = tileAt(floor, target.x, target.y);

  if (tile === TILE.ROOF_DOOR) {
    if (state.itemsCollected >= state.totalItems) {
      return { state: { ...state, win: true }, event: { type: "win" } };
    }
    return { state, event: { type: "locked", have: state.itemsCollected, need: state.totalItems } };
  }

  if (tile === TILE.STAIRS_UP) {
    const dest = findTile(floors[state.floorIndex + 1], TILE.STAIRS_DOWN);
    const newState = { ...state, floorIndex: state.floorIndex + 1, x: dest.x, y: dest.y };
    return { state: newState, event: { type: "floorChange", floorIndex: newState.floorIndex } };
  }
  if (tile === TILE.STAIRS_DOWN) {
    const dest = findTile(floors[state.floorIndex - 1], TILE.STAIRS_UP);
    const newState = { ...state, floorIndex: state.floorIndex - 1, x: dest.x, y: dest.y };
    return { state: newState, event: { type: "floorChange", floorIndex: newState.floorIndex } };
  }

  if (!isPassable(tile)) {
    return { state, event: { type: "blocked" } };
  }

  const newState = { ...state, x: target.x, y: target.y };
  if (tile === TILE.ITEM) {
    floor.grid[target.y][target.x] = TILE.FLOOR;
    newState.itemsCollected = state.itemsCollected + 1;
    return { state: newState, event: { type: "collected", itemsCollected: newState.itemsCollected } };
  }
  return { state: newState, event: { type: "moved" } };
}

export function facingSecret(state, floors) {
  const floor = floors[state.floorIndex];
  const target = forwardCell(state.x, state.y, state.heading);
  return tileAt(floor, target.x, target.y) === TILE.SECRET;
}

// Returns { state, event } where event.type is 'revealed' | 'nothing'.
export function attemptSearch(state, floors) {
  const floor = floors[state.floorIndex];
  const target = forwardCell(state.x, state.y, state.heading);
  if (tileAt(floor, target.x, target.y) === TILE.SECRET) {
    floor.grid[target.y][target.x] = TILE.FLOOR;
    return { state, event: { type: "revealed" } };
  }
  return { state, event: { type: "nothing" } };
}
