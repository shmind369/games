import * as THREE from "three";

// ---------- Maze generation (recursive backtracker) ----------
// grid dimensions must be odd; 1 = wall, 0 = floor
const MAZE_W = 15;
const MAZE_H = 15;
const CELL = 4; // world units per grid cell

function generateMaze(w, h) {
  const grid = Array.from({ length: h }, () => new Array(w).fill(1));
  const visited = Array.from({ length: h }, () => new Array(w).fill(false));

  function carve(x, y) {
    visited[y][x] = true;
    grid[y][x] = 0;
    const dirs = [
      [2, 0], [-2, 0], [0, 2], [0, -2],
    ].sort(() => Math.random() - 0.5);

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

function gridToWorld(gx, gy) {
  return new THREE.Vector3(gx * CELL, 0, gy * CELL);
}

// Horizontal-only distance, ignoring height, since pickup/hit checks are
// meant to be grid-plane checks regardless of a mesh's vertical offset.
function distanceXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// ---------- Scene setup ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a12);
scene.fog = new THREE.Fog(0x0a0a12, CELL * 6, CELL * 18);

const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Lighting
scene.add(new THREE.AmbientLight(0x8899ff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(20, 30, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
scene.add(sun);

// ---------- Maze mesh ----------
const maze = generateMaze(MAZE_W, MAZE_H);

const floorGeo = new THREE.PlaneGeometry(MAZE_W * CELL, MAZE_H * CELL);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c2033, roughness: 0.9 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.set(((MAZE_W - 1) * CELL) / 2, 0, ((MAZE_H - 1) * CELL) / 2);
floor.receiveShadow = true;
scene.add(floor);

const wallPositions = [];
for (let y = 0; y < MAZE_H; y++) {
  for (let x = 0; x < MAZE_W; x++) {
    if (maze[y][x] === 1) wallPositions.push([x, y]);
  }
}

const wallHeight = 3;
const wallGeo = new THREE.BoxGeometry(CELL, wallHeight, CELL);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4270, roughness: 0.6 });
const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallPositions.length);
wallMesh.castShadow = true;
wallMesh.receiveShadow = true;

const dummy = new THREE.Object3D();
wallPositions.forEach(([gx, gy], i) => {
  dummy.position.set(gx * CELL, wallHeight / 2, gy * CELL);
  dummy.updateMatrix();
  wallMesh.setMatrixAt(i, dummy.matrix);
});
scene.add(wallMesh);

function isWall(gx, gy) {
  if (gx < 0 || gy < 0 || gx >= MAZE_W || gy >= MAZE_H) return true;
  return maze[gy][gx] === 1;
}

function openCells() {
  const cells = [];
  for (let y = 0; y < MAZE_H; y++) {
    for (let x = 0; x < MAZE_W; x++) {
      if (maze[y][x] === 0) cells.push([x, y]);
    }
  }
  return cells;
}

// ---------- Player ----------
const PLAYER_RADIUS = 0.5;
const PLAYER_SPEED = 6.5;

const playerGroup = new THREE.Group();
const playerBody = new THREE.Mesh(
  new THREE.CapsuleGeometry(PLAYER_RADIUS, 0.8, 4, 8),
  new THREE.MeshStandardMaterial({ color: 0x4c8dff, roughness: 0.4 })
);
playerBody.position.y = 0.9;
playerBody.castShadow = true;
const facingMark = new THREE.Mesh(
  new THREE.ConeGeometry(0.2, 0.5, 8),
  new THREE.MeshStandardMaterial({ color: 0xffe066 })
);
facingMark.rotation.x = Math.PI / 2;
facingMark.position.set(0, 0.9, -0.6);
playerGroup.add(playerBody, facingMark);
scene.add(playerGroup);

const start = gridToWorld(1, 1);
playerGroup.position.copy(start);
let playerFacing = new THREE.Vector3(0, 0, -1);

// ---------- Coins ----------
const COIN_COUNT = 12;
const coins = [];
{
  const free = openCells().filter(([x, y]) => !(x <= 2 && y <= 2));
  free.sort(() => Math.random() - 0.5);
  const coinGeo = new THREE.TorusGeometry(0.4, 0.15, 8, 16);
  const coinMat = new THREE.MeshStandardMaterial({
    color: 0xffd23f,
    emissive: 0x664400,
    metalness: 0.6,
    roughness: 0.3,
  });
  for (let i = 0; i < Math.min(COIN_COUNT, free.length); i++) {
    const [gx, gy] = free[i];
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.position.copy(gridToWorld(gx, gy)).setY(1.1);
    mesh.castShadow = true;
    scene.add(mesh);
    coins.push({ mesh, collected: false });
  }
}

// ---------- Enemies ----------
const ENEMY_COUNT = 2;
const enemies = [];
{
  const free = openCells().filter(([x, y]) => Math.abs(x - 1) + Math.abs(y - 1) > 6);
  const enemyGeo = new THREE.IcosahedronGeometry(0.55, 0);
  const enemyMat = new THREE.MeshStandardMaterial({
    color: 0xff4d4d,
    emissive: 0x440000,
    roughness: 0.4,
  });
  for (let i = 0; i < ENEMY_COUNT; i++) {
    const [gx, gy] = free[Math.floor(Math.random() * free.length)];
    const mesh = new THREE.Mesh(enemyGeo, enemyMat);
    mesh.position.copy(gridToWorld(gx, gy)).setY(0.8);
    mesh.castShadow = true;
    scene.add(mesh);
    enemies.push({
      mesh,
      cell: [gx, gy],
      target: gridToWorld(gx, gy).setY(0.8),
      speed: 2 + Math.random(),
    });
  }
}

function pickNextEnemyTarget(enemy) {
  const [x, y] = enemy.cell;
  const options = [
    [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
  ].filter(([nx, ny]) => !isWall(nx, ny));
  if (options.length === 0) return;
  const [nx, ny] = options[Math.floor(Math.random() * options.length)];
  enemy.cell = [nx, ny];
  enemy.target = gridToWorld(nx, ny).setY(0.8);
}

// ---------- Input ----------
const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// Touch/mouse virtual joystick, bottom-left of the screen. Reports a
// direction vector with magnitude 0-1 so dragging halfway gives half speed.
const joystickBase = document.getElementById("joystickBase");
const joystickKnob = document.getElementById("joystickKnob");
const joystickDir = new THREE.Vector3();
const JOYSTICK_RADIUS = 46;
let joystickPointerId = null;

function updateJoystick(clientX, clientY) {
  const rect = joystickBase.getBoundingClientRect();
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  const dist = Math.hypot(dx, dy) || 1;
  const clamped = Math.min(dist, JOYSTICK_RADIUS);
  const mag = clamped / JOYSTICK_RADIUS;
  joystickKnob.style.transform =
    `translate(${(dx / dist) * clamped}px, ${(dy / dist) * clamped}px)`;
  joystickDir.set((dx / dist) * mag, 0, (dy / dist) * mag);
}

function resetJoystick() {
  joystickPointerId = null;
  joystickDir.set(0, 0, 0);
  joystickKnob.style.transform = "translate(0px, 0px)";
}

joystickBase.addEventListener("pointerdown", (e) => {
  joystickPointerId = e.pointerId;
  joystickBase.setPointerCapture(e.pointerId);
  updateJoystick(e.clientX, e.clientY);
});
joystickBase.addEventListener("pointermove", (e) => {
  if (e.pointerId !== joystickPointerId) return;
  updateJoystick(e.clientX, e.clientY);
});
joystickBase.addEventListener("pointerup", (e) => {
  if (e.pointerId === joystickPointerId) resetJoystick();
});
joystickBase.addEventListener("pointercancel", resetJoystick);

function inputDirection() {
  if (joystickDir.lengthSq() > 0.0001) return joystickDir.clone();

  const dir = new THREE.Vector3();
  if (keys.has("w") || keys.has("arrowup")) dir.z -= 1;
  if (keys.has("s") || keys.has("arrowdown")) dir.z += 1;
  if (keys.has("a") || keys.has("arrowleft")) dir.x -= 1;
  if (keys.has("d") || keys.has("arrowright")) dir.x += 1;
  if (dir.lengthSq() > 0) dir.normalize();
  return dir;
}

// Resolve circle-vs-wall-grid collision by pushing the player out of any
// overlapping wall cell (checked in the 3x3 neighborhood around it).
function resolveCollision(pos) {
  const gx = Math.round(pos.x / CELL);
  const gy = Math.round(pos.z / CELL);
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = gx + ox;
      const cy = gy + oy;
      if (!isWall(cx, cy)) continue;
      const cellCenter = gridToWorld(cx, cy);
      const halfExtent = CELL / 2;
      const closestX = THREE.MathUtils.clamp(
        pos.x, cellCenter.x - halfExtent, cellCenter.x + halfExtent
      );
      const closestZ = THREE.MathUtils.clamp(
        pos.z, cellCenter.z - halfExtent, cellCenter.z + halfExtent
      );
      const dx = pos.x - closestX;
      const dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < PLAYER_RADIUS * PLAYER_RADIUS && distSq > 1e-9) {
        const dist = Math.sqrt(distSq);
        const overlap = PLAYER_RADIUS - dist;
        pos.x += (dx / dist) * overlap;
        pos.z += (dz / dist) * overlap;
      }
    }
  }
}

// ---------- Game state ----------
const state = {
  score: 0,
  lives: 3,
  invulnerableUntil: 0,
  gameOver: false,
  won: false,
};

const coinCountEl = document.getElementById("coinCount");
const coinTotalEl = document.getElementById("coinTotal");
const livesEl = document.getElementById("lives");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlayTitle");
document.getElementById("restartBtn").addEventListener("click", () => location.reload());

coinTotalEl.textContent = String(coins.length);

function endGame(won) {
  state.gameOver = true;
  state.won = won;
  overlayTitleEl.textContent = won ? "クリア!" : "ゲームオーバー";
  overlayEl.classList.add("show");
}

// ---------- Camera ----------
const cameraOffset = new THREE.Vector3(0, 4.5, 6);
const cameraTarget = new THREE.Vector3();
const camRaycaster = new THREE.Raycaster();
camera.position.copy(playerGroup.position).add(cameraOffset);

// ---------- Main loop ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  if (!state.gameOver) {
    // Player movement
    const dir = inputDirection();
    if (dir.lengthSq() > 0) {
      playerFacing.lerp(dir, 0.35).normalize();
      const targetQuat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, -1), playerFacing
      );
      playerGroup.quaternion.slerp(targetQuat, 0.3);

      const newPos = playerGroup.position.clone().addScaledVector(dir, PLAYER_SPEED * delta);
      resolveCollision(newPos);
      playerGroup.position.copy(newPos);
    }

    // Coins
    for (const coin of coins) {
      if (coin.collected) continue;
      coin.mesh.rotation.y += delta * 2;
      if (distanceXZ(coin.mesh.position, playerGroup.position) < PLAYER_RADIUS + 0.6) {
        coin.collected = true;
        coin.mesh.visible = false;
        state.score++;
        coinCountEl.textContent = String(state.score);
        if (state.score >= coins.length) endGame(true);
      }
    }

    // Enemies
    for (const enemy of enemies) {
      const toTarget = enemy.target.clone().sub(enemy.mesh.position);
      if (toTarget.length() < 0.05) {
        pickNextEnemyTarget(enemy);
      } else {
        enemy.mesh.position.addScaledVector(toTarget.normalize(), enemy.speed * delta);
      }
      enemy.mesh.rotation.y += delta;
      enemy.mesh.rotation.x += delta * 0.6;

      if (
        now > state.invulnerableUntil &&
        distanceXZ(enemy.mesh.position, playerGroup.position) < PLAYER_RADIUS + 0.6
      ) {
        state.lives--;
        livesEl.textContent = String(state.lives);
        state.invulnerableUntil = now + 1500;
        playerGroup.position.copy(start);
        if (state.lives <= 0) endGame(false);
      }
    }

    // Camera follow, with wall-collision avoidance so the chase camera
    // never clips through maze walls in narrow corridors.
    cameraTarget.copy(playerGroup.position).addScaledVector(playerFacing, -2);
    const camOrigin = playerGroup.position.clone().setY(playerGroup.position.y + 1.2);
    const desiredCamPos = playerGroup.position.clone()
      .addScaledVector(playerFacing, -cameraOffset.z)
      .setY(playerGroup.position.y + cameraOffset.y);

    const toDesired = desiredCamPos.clone().sub(camOrigin);
    const fullDist = toDesired.length();
    let allowedDist = fullDist;
    if (fullDist > 0.001) {
      const rayDir = toDesired.clone().normalize();
      camRaycaster.set(camOrigin, rayDir);
      camRaycaster.far = fullDist;
      camRaycaster.near = 0;
      const hits = camRaycaster.intersectObject(wallMesh);
      if (hits.length > 0) {
        allowedDist = Math.max(hits[0].distance - 0.4, 1.2);
      }
    }
    const clampedCamPos = camOrigin.clone().addScaledVector(
      toDesired.normalize(), allowedDist
    );

    camera.position.lerp(clampedCamPos, 1 - Math.pow(0.001, delta));
    camera.lookAt(cameraTarget.setY(1));
  }

  renderer.render(scene, camera);
}

animate();
