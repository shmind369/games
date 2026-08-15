// Pure, DOM/Three.js-independent logic: room layout, wall collision, tank-control
// movement integration, and fixed-camera zone lookup. Kept separate from main.js
// so it can be unit tested directly in Node.

// Each room is one axis-aligned rectangle in world X/Z. Adjacent rooms are
// authored to share an exact boundary edge over the width of their doorway
// (e.g. the corridor's x-range is a subset of the hall's, so they connect
// with no gap where they touch at z=6). This is also what main.js uses to
// decide where to leave a gap when building wall meshes.
export const ROOMS = {
  hall: { x0: -3, x1: 3, z0: 0, z1: 6 },
  corridor: { x0: -0.9, x1: 0.9, z0: 6, z1: 12 },
  library: { x0: -6, x1: -0.9, z0: 7.5, z1: 10.5 },
  study: { x0: -3, x1: 3, z0: 12, z1: 17 },
};

export const ZONE_ORDER = ["library", "hall", "study", "corridor"];

export const EXIT_ZONE = { x0: -1, x1: 1, z0: 15.5, z1: 17 };

export const START_STATE = { x: 0, z: 1, heading: 0 }; // heading 0 = facing +Z (north, into the manor)

// Character is treated as a point; WALL_MARGIN inflates each room rect so the
// point can't get closer than ~this distance to an outer wall, while unioning
// two inflated adjacent rects still leaves the shared doorway fully open.
export const WALL_MARGIN = 0.32;

export function pointInRect(x, z, rect) {
  return x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1;
}

export function inflateRect(rect, m) {
  return { x0: rect.x0 - m, x1: rect.x1 + m, z0: rect.z0 - m, z1: rect.z1 + m };
}

export function canStandAt(x, z) {
  return Object.values(ROOMS).some((r) => pointInRect(x, z, inflateRect(r, WALL_MARGIN)));
}

// Axis-separated slide: try the full move, then each axis alone, so walking
// diagonally into a wall slides along it instead of stopping dead.
export function resolveMove(x, z, dx, dz) {
  if (canStandAt(x + dx, z + dz)) return { x: x + dx, z: z + dz };
  if (canStandAt(x + dx, z)) return { x: x + dx, z };
  if (canStandAt(x, z + dz)) return { x, z: z + dz };
  return { x, z };
}

// Uses the same WALL_MARGIN-inflated rects as canStandAt so every position
// the character can actually stand at (including flush against a wall)
// resolves to a real room, never an arbitrary fallback.
export function zoneAt(x, z) {
  for (const id of ZONE_ORDER) {
    if (pointInRect(x, z, inflateRect(ROOMS[id], WALL_MARGIN))) return id;
  }
  return ZONE_ORDER[ZONE_ORDER.length - 1];
}

export function isInExitZone(x, z) {
  return pointInRect(x, z, EXIT_ZONE);
}

// input: { forward, backward, turnLeft, turnRight } booleans (held state).
// heading 0 = +Z; increases turning right (clockwise looking from above).
export function integrateTankStep(state, input, dt, moveSpeed, turnSpeed) {
  let heading = state.heading;
  if (input.turnLeft) heading -= turnSpeed * dt;
  if (input.turnRight) heading += turnSpeed * dt;

  let moveDir = 0;
  if (input.forward) moveDir += 1;
  if (input.backward) moveDir -= 1;

  let x = state.x, z = state.z;
  if (moveDir !== 0) {
    const dx = Math.sin(heading) * moveDir * moveSpeed * dt;
    const dz = Math.cos(heading) * moveDir * moveSpeed * dt;
    const next = resolveMove(x, z, dx, dz);
    x = next.x; z = next.z;
  }
  return { x, z, heading };
}
