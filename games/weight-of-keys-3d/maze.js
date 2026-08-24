// Pure, DOM/Three.js-independent game logic for "Weight of Keys".
// Runnable directly under Node for unit testing (see maze.test.mjs).

// ---------- Maze generation (recursive backtracker, odd dimensions) ----------
// grid[y][x]: 1 = wall, 0 = floor
export function generateMaze(w, h, rng = Math.random) {
  if (w % 2 === 0 || h % 2 === 0) {
    throw new Error("maze width/height must be odd");
  }
  const grid = Array.from({ length: h }, () => new Array(w).fill(1));
  const visited = Array.from({ length: h }, () => new Array(w).fill(false));

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function carve(x, y) {
    visited[y][x] = true;
    grid[y][x] = 0;
    const dirs = shuffle([[2, 0], [-2, 0], [0, 2], [0, -2]]);
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx > 0 && nx < w - 1 && ny > 0 && ny < h - 1 && !visited[ny][nx]) {
        grid[y + dy / 2][x + dx / 2] = 0;
        carve(nx, ny);
      }
    }
  }

  carve(1, 1);
  return grid;
}

export function isWall(grid, gx, gy) {
  const h = grid.length;
  const w = grid[0].length;
  if (gx < 0 || gy < 0 || gx >= w || gy >= h) return true;
  return grid[gy][gx] === 1;
}

export function openCells(grid) {
  const cells = [];
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[0].length; x++) {
      if (grid[y][x] === 0) cells.push([x, y]);
    }
  }
  return cells;
}

const ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- BFS pathfinding on the open-cell grid ----------
// Returns a Map keyed by "x,y" -> distance in steps from (sx,sy), for every
// reachable open cell. Used both to place items sensibly and to drive the
// pursuer's chase behaviour.
export function bfsDistances(grid, sx, sy) {
  const dist = new Map();
  const key = (x, y) => `${x},${y}`;
  if (isWall(grid, sx, sy)) return dist;
  dist.set(key(sx, sy), 0);
  const queue = [[sx, sy]];
  let head = 0;
  while (head < queue.length) {
    const [x, y] = queue[head++];
    const d = dist.get(key(x, y));
    for (const [dx, dy] of ORTHOGONAL) {
      const nx = x + dx;
      const ny = y + dy;
      if (isWall(grid, nx, ny)) continue;
      const k = key(nx, ny);
      if (dist.has(k)) continue;
      dist.set(k, d + 1);
      queue.push([nx, ny]);
    }
  }
  return dist;
}

// Next single step from (fx,fy) toward (tx,ty), following the shortest path.
// Returns null if unreachable or already at the target.
export function bfsNextStep(grid, fx, fy, tx, ty) {
  if (fx === tx && fy === ty) return null;
  const distFromTarget = bfsDistances(grid, tx, ty);
  const key = (x, y) => `${x},${y}`;
  if (!distFromTarget.has(key(fx, fy))) return null;
  let best = null;
  let bestDist = Infinity;
  for (const [dx, dy] of ORTHOGONAL) {
    const nx = fx + dx;
    const ny = fy + dy;
    const d = distFromTarget.get(key(nx, ny));
    if (d !== undefined && d < bestDist) {
      bestDist = d;
      best = [nx, ny];
    }
  }
  return best;
}

// A random open neighbour, avoiding an immediate U-turn back to `from`
// when another option exists. Used for the pursuer's patrol/wander state.
export function pickWanderStep(grid, x, y, from, rng = Math.random) {
  const options = ORTHOGONAL
    .map(([dx, dy]) => [x + dx, y + dy])
    .filter(([nx, ny]) => !isWall(grid, nx, ny));
  if (options.length === 0) return null;
  const nonBacktrack = from
    ? options.filter(([nx, ny]) => !(nx === from[0] && ny === from[1]))
    : options;
  const pool = nonBacktrack.length > 0 ? nonBacktrack : options;
  return pool[Math.floor(rng() * pool.length)];
}

// ---------- Weight / speed system ----------
// Every point of carried weight shaves WEIGHT_SPEED_FACTOR off the player's
// speed multiplier, floored at MIN_SPEED_FACTOR so the player can never be
// brought fully to a stop just by carrying items.
export const BASE_PLAYER_SPEED = 4.3;
export const WEIGHT_SPEED_FACTOR = 0.11;
export const MIN_SPEED_FACTOR = 0.4;
export const PURSUER_SPEED = 3.0;

export function speedFactorForWeight(totalWeight) {
  return Math.max(MIN_SPEED_FACTOR, 1 - totalWeight * WEIGHT_SPEED_FACTOR);
}

export function playerSpeedForWeight(totalWeight) {
  return BASE_PLAYER_SPEED * speedFactorForWeight(totalWeight);
}

export function totalCarriedWeight(carriedItems) {
  return carriedItems.reduce((sum, item) => sum + item.weight, 0);
}

// ---------- Exit / escape logic ----------
export function canOpenExit(carriedKeyCount, requiredKeyCount) {
  return carriedKeyCount >= requiredKeyCount;
}

// ---------- Pursuer detection state machine ----------
// Pure decision function: given the current state and sensory inputs,
// decide whether the pursuer should be chasing or wandering next tick.
// - Enters "chase" when the player is within sight (line of sight AND
//   within sightRadius) or extremely close (within hearRadius, e.g. right
//   next to the pursuer even around a corner).
// - Once chasing, keeps chasing until the player has been both out of
//   sight AND beyond loseRadius for `loseGraceSteps` consecutive decisions,
//   so a pursuer doesn't instantly forget you the moment you duck around a
//   corner.
export function decidePursuerState(prev, input) {
  const { distance, hasLineOfSight, sightRadius, hearRadius, loseRadius, loseGraceSteps } = input;
  const detected = (hasLineOfSight && distance <= sightRadius) || distance <= hearRadius;

  if (detected) {
    return { mode: "chase", loseCounter: 0 };
  }

  if (prev.mode === "chase") {
    const stillLost = !hasLineOfSight && distance > loseRadius;
    if (!stillLost) return { mode: "chase", loseCounter: 0 };
    const loseCounter = prev.loseCounter + 1;
    if (loseCounter >= loseGraceSteps) return { mode: "wander", loseCounter: 0 };
    return { mode: "chase", loseCounter };
  }

  return { mode: "wander", loseCounter: 0 };
}

// ---------- Item placement ----------
// Spread `count` items across open cells that are all at least
// `minStepsFromStart` BFS-steps from the start cell, preferring the
// farthest-apart candidates so items don't cluster in one corner.
export function chooseSpreadCells(grid, startX, startY, count, minStepsFromStart, rng = Math.random) {
  const dist = bfsDistances(grid, startX, startY);
  const candidates = openCells(grid).filter(([x, y]) => {
    const d = dist.get(`${x},${y}`);
    return d !== undefined && d >= minStepsFromStart;
  });
  const chosen = [];
  const pool = candidates.slice();
  while (chosen.length < count && pool.length > 0) {
    // Greedily pick the pool member farthest (Chebyshev) from all chosen
    // so far, breaking ties randomly; falls back to random pick for the
    // first item.
    let idx;
    if (chosen.length === 0) {
      idx = Math.floor(rng() * pool.length);
    } else {
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const [px, py] = pool[i];
        let minSep = Infinity;
        for (const [cx, cy] of chosen) {
          minSep = Math.min(minSep, Math.abs(px - cx) + Math.abs(py - cy));
        }
        const score = minSep + rng() * 0.01;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      idx = bestIdx;
    }
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return chosen;
}
