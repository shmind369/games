import * as THREE from "three";

// ---------- Scope ----------
// A single-arena prototype of "pull your own character back like a
// slingshot and let go" battle action: touch the character, drag it
// away from where you want it to fly, release to launch it in the
// opposite direction. It bounces elastically off the walls and off
// enemies, dealing more damage the faster it's moving and building a
// combo multiplier for each additional enemy hit within the same shot
// (including re-hitting one after bouncing off a wall). Turn-based: once
// the character coasts to a stop, any surviving enemies take one step
// toward it and deal contact damage before control returns to the player.

// ---------- Tuning ----------
const ARENA_HALF_W = 4.5;
const ARENA_HALF_D = 6.2;
const PLAYER_RADIUS = 0.5;
const ENEMY_RADIUS = 0.55;
const PLAYER_MAX_HP = 3;
const PLAYER_START_X = 0;
const PLAYER_START_Z = 4.6;

const MAX_PULL_WORLD = 3.0; // world units of stretch for max launch power
const LAUNCH_SPEED_MAX = 13; // units/sec
const LAUNCH_SPEED_MIN = 2.5; // below this, releasing cancels instead of launching
const GRAB_RADIUS_WORLD = 1.6; // touch must land within this of the character to start a pull

const FRICTION = 7; // units/sec^2 deceleration while flying
const REST_SPEED = 0.15; // below this, the character is considered stopped
const WALL_RESTITUTION = 0.82;
const ENEMY_RESTITUTION = 0.88;

const BASE_DAMAGE = 20;
const DAMAGE_SPEED_SCALE = 3; // extra damage per unit of impact speed
const COMBO_BONUS_RATIO = 0.5; // +50% per additional hit within the same shot
const ENEMY_MAX_HP = 45;
const ENEMY_CONTACT_DAMAGE = 1;
const ENEMY_ADVANCE_STEP = 0.55; // world units an enemy closes in per enemy-turn
const ENEMY_TURN_MS = 450; // purely cosmetic pause so the turn reads as a beat, not a flicker

const SCORE_PER_KILL = 100;
const SCORE_PER_COMBO_STEP = 20;

// ---------- Pure physics/logic (no THREE/DOM — directly unit testable) ----------
function clampPullVector(pullX, pullZ, maxPull) {
  const dist = Math.hypot(pullX, pullZ);
  if (dist < 1e-6) return { x: 0, z: 0, dist: 0 };
  const clamped = Math.min(dist, maxPull);
  return { x: (pullX / dist) * clamped, z: (pullZ / dist) * clamped, dist: clamped };
}

// Launch direction is opposite the (already-clamped) pull vector, like a
// slingshot. Returns null if the pull was too weak to count as a real shot.
function computeLaunchVelocity(clampedPullX, clampedPullZ, maxPull, maxSpeed, minSpeed) {
  const dist = Math.hypot(clampedPullX, clampedPullZ);
  if (dist < 1e-6) return null;
  const speed = (dist / maxPull) * maxSpeed;
  if (speed < minSpeed) return null;
  return { vx: (-clampedPullX / dist) * speed, vz: (-clampedPullZ / dist) * speed, speed };
}

function bounceOffWalls(x, z, vx, vz, halfW, halfD, radius, restitution) {
  let nx = x;
  let nz = z;
  let nvx = vx;
  let nvz = vz;
  if (nx - radius < -halfW) {
    nx = -halfW + radius;
    nvx = -nvx * restitution;
  } else if (nx + radius > halfW) {
    nx = halfW - radius;
    nvx = -nvx * restitution;
  }
  if (nz - radius < -halfD) {
    nz = -halfD + radius;
    nvz = -nvz * restitution;
  } else if (nz + radius > halfD) {
    nz = halfD - radius;
    nvz = -nvz * restitution;
  }
  return { x: nx, z: nz, vx: nvx, vz: nvz };
}

function circlesOverlap(x1, z1, r1, x2, z2, r2) {
  return Math.hypot(x1 - x2, z1 - z2) < r1 + r2;
}

// nx,nz must be the unit normal pointing from the obstacle's center
// toward the moving circle.
function reflectOffCircle(vx, vz, nx, nz, restitution) {
  const dot = vx * nx + vz * nz;
  return { vx: vx - (1 + restitution) * dot * nx, vz: vz - (1 + restitution) * dot * nz };
}

function computeImpactDamage(speed, comboIndex) {
  const base = BASE_DAMAGE + speed * DAMAGE_SPEED_SCALE;
  return Math.round(base * (1 + comboIndex * COMBO_BONUS_RATIO));
}

function advanceToward(x, z, targetX, targetZ, step) {
  const dx = targetX - x;
  const dz = targetZ - z;
  const dist = Math.hypot(dx, dz);
  if (dist <= step || dist < 1e-6) return { x: targetX, z: targetZ };
  return { x: x + (dx / dist) * step, z: z + (dz / dist) * step };
}

// ---------- Scene setup ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10151f);
scene.fog = new THREE.Fog(0x10151f, 14, 30);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 11, 9.5);
camera.lookAt(0, 0, 0.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
document.body.appendChild(renderer.domElement);

let width = window.innerWidth;
let height = window.innerHeight;
function handleResize() {
  width = window.innerWidth;
  height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
window.addEventListener("resize", handleResize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", handleResize);
handleResize();

scene.add(new THREE.AmbientLight(0x8fa8ff, 0.65));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(6, 14, 8);
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA_HALF_W * 2, ARENA_HALF_D * 2),
  new THREE.MeshStandardMaterial({ color: 0x1c2636, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x2e3a52 });
const WALL_H = 0.6;
const WALL_T = 0.25;
function makeWall(w, d, x, z) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
  wall.position.set(x, WALL_H / 2, z);
  scene.add(wall);
}
makeWall(ARENA_HALF_W * 2 + WALL_T * 2, WALL_T, 0, -ARENA_HALF_D - WALL_T / 2);
makeWall(ARENA_HALF_W * 2 + WALL_T * 2, WALL_T, 0, ARENA_HALF_D + WALL_T / 2);
makeWall(WALL_T, ARENA_HALF_D * 2, -ARENA_HALF_W - WALL_T / 2, 0);
makeWall(WALL_T, ARENA_HALF_D * 2, ARENA_HALF_W + WALL_T / 2, 0);

// ---------- Player character ----------
const playerMesh = new THREE.Mesh(
  new THREE.SphereGeometry(PLAYER_RADIUS, 20, 20),
  new THREE.MeshStandardMaterial({ color: 0x3a6bd8 })
);
playerMesh.position.set(PLAYER_START_X, PLAYER_RADIUS, PLAYER_START_Z);
scene.add(playerMesh);

// ---------- Pull-line indicator ----------
const pullLineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const pullLineMat = new THREE.LineBasicMaterial({ color: 0xffe066 });
const pullLine = new THREE.Line(pullLineGeom, pullLineMat);
pullLine.visible = false;
scene.add(pullLine);

// ---------- Enemies ----------
let enemies = []; // { mesh, x, z, hp, maxHp, overlappingShot }

function makeEnemyMesh() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(ENEMY_RADIUS, 18, 18),
    new THREE.MeshStandardMaterial({ color: 0xd24545 })
  );
}

function spawnEnemies() {
  for (const e of enemies) scene.remove(e.mesh);
  enemies = [];
  const layout = [
    { x: -2.6, z: -3.8 },
    { x: 2.6, z: -3.8 },
    { x: 0, z: -4.6 },
    { x: -2.9, z: -1.2 },
    { x: 2.9, z: -1.2 },
  ];
  for (const pos of layout) {
    const mesh = makeEnemyMesh();
    mesh.position.set(pos.x, ENEMY_RADIUS, pos.z);
    scene.add(mesh);
    enemies.push({ mesh, x: pos.x, z: pos.z, hp: ENEMY_MAX_HP, maxHp: ENEMY_MAX_HP, overlappingShot: false });
  }
}

// ---------- Game state ----------
let hp = PLAYER_MAX_HP;
let score = 0;
let phase = "ready"; // ready | pulling | flying | enemyTurn | gameOver | win
let velX = 0;
let velZ = 0;
let comboIndex = 0;
let enemyTurnTimer = 0;

const hpEl = document.getElementById("hp");
const scoreEl = document.getElementById("score");
const enemyCountEl = document.getElementById("enemyCount");
const comboBannerEl = document.getElementById("comboBanner");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlayTitle");
const overlaySubtitleEl = document.getElementById("overlaySubtitle");
document.getElementById("restartBtn").addEventListener("click", resetGame);

function resetGame() {
  hp = PLAYER_MAX_HP;
  score = 0;
  phase = "ready";
  velX = 0;
  velZ = 0;
  comboIndex = 0;
  enemyTurnTimer = 0;
  playerMesh.position.set(PLAYER_START_X, PLAYER_RADIUS, PLAYER_START_Z);
  pullLine.visible = false;
  spawnEnemies();
  hpEl.textContent = String(hp);
  scoreEl.textContent = String(score);
  enemyCountEl.textContent = `残り敵: ${enemies.length}`;
  comboBannerEl.classList.remove("show");
  overlayEl.classList.remove("show");
}

function damagePlayer(amount) {
  hp = Math.max(0, hp - amount);
  hpEl.textContent = String(hp);
  if (hp <= 0 && phase !== "gameOver") {
    phase = "gameOver";
    overlayTitleEl.textContent = "GAME OVER";
    overlaySubtitleEl.textContent = `SCORE: ${score}`;
    overlayEl.classList.add("show");
  }
}

function addScore(points) {
  score += points;
  scoreEl.textContent = String(score);
}

function showCombo(n) {
  if (n < 2) return;
  comboBannerEl.textContent = `${n} COMBO!`;
  comboBannerEl.classList.remove("show");
  void comboBannerEl.offsetWidth;
  comboBannerEl.classList.add("show");
}

// ---------- Input: grab the character and pull it back like a slingshot ----------
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function screenToGround(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const point = new THREE.Vector3();
  raycaster.ray.intersectPlane(groundPlane, point);
  return point || new THREE.Vector3();
}

let pointerId = null;
let pullOriginX = 0;
let pullOriginZ = 0;
let currentPull = { x: 0, z: 0, dist: 0 };

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (phase !== "ready") return;
  const g = screenToGround(e.clientX, e.clientY);
  if (Math.hypot(g.x - playerMesh.position.x, g.z - playerMesh.position.z) > GRAB_RADIUS_WORLD) return;
  pointerId = e.pointerId;
  pullOriginX = playerMesh.position.x;
  pullOriginZ = playerMesh.position.z;
  currentPull = { x: 0, z: 0, dist: 0 };
  phase = "pulling";
  pullLine.visible = true;
  renderer.domElement.setPointerCapture(e.pointerId);
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (e.pointerId !== pointerId || phase !== "pulling") return;
  const g = screenToGround(e.clientX, e.clientY);
  currentPull = clampPullVector(g.x - pullOriginX, g.z - pullOriginZ, MAX_PULL_WORLD);
  playerMesh.position.x = pullOriginX + currentPull.x;
  playerMesh.position.z = pullOriginZ + currentPull.z;
  updatePullLine();
});

function updatePullLine() {
  const positions = pullLine.geometry.attributes.position;
  positions.setXYZ(0, pullOriginX, PLAYER_RADIUS, pullOriginZ);
  positions.setXYZ(1, playerMesh.position.x, PLAYER_RADIUS, playerMesh.position.z);
  positions.needsUpdate = true;
  const t = currentPull.dist / MAX_PULL_WORLD;
  pullLineMat.color.setHSL(0.15 - 0.15 * t, 1, 0.55); // yellow -> red as power increases
}

function endPull(e) {
  if (e.pointerId !== pointerId || phase !== "pulling") return;
  pointerId = null;
  pullLine.visible = false;

  const launch = computeLaunchVelocity(currentPull.x, currentPull.z, MAX_PULL_WORLD, LAUNCH_SPEED_MAX, LAUNCH_SPEED_MIN);
  playerMesh.position.x = pullOriginX;
  playerMesh.position.z = pullOriginZ;

  if (!launch) {
    phase = "ready";
    return;
  }

  velX = launch.vx;
  velZ = launch.vz;
  comboIndex = 0;
  for (const enemy of enemies) enemy.overlappingShot = false;
  phase = "flying";
}
renderer.domElement.addEventListener("pointerup", endPull);
renderer.domElement.addEventListener("pointercancel", endPull);

// ---------- Flight resolution ----------
function resolveEnemyHit(enemy, speed) {
  const damage = computeImpactDamage(speed, comboIndex);
  comboIndex += 1;
  enemy.hp = Math.max(0, enemy.hp - damage);
  if (enemy.hp <= 0) {
    scene.remove(enemy.mesh);
    addScore(SCORE_PER_KILL + comboIndex * SCORE_PER_COMBO_STEP);
    enemy.dead = true;
  } else {
    enemy.mesh.scale.setScalar(0.6 + 0.4 * (enemy.hp / enemy.maxHp));
  }
  showCombo(comboIndex);
}

function updateFlying(dt) {
  const speed = Math.hypot(velX, velZ);
  if (speed <= REST_SPEED) {
    velX = 0;
    velZ = 0;
    startEnemyTurn();
    return;
  }

  const newSpeed = Math.max(0, speed - FRICTION * dt);
  const dirX = velX / speed;
  const dirZ = velZ / speed;
  velX = dirX * newSpeed;
  velZ = dirZ * newSpeed;

  let x = playerMesh.position.x + velX * dt;
  let z = playerMesh.position.z + velZ * dt;

  const bounced = bounceOffWalls(x, z, velX, velZ, ARENA_HALF_W, ARENA_HALF_D, PLAYER_RADIUS, WALL_RESTITUTION);
  x = bounced.x;
  z = bounced.z;
  velX = bounced.vx;
  velZ = bounced.vz;

  for (const enemy of enemies) {
    if (enemy.dead) continue;
    const overlapping = circlesOverlap(x, z, PLAYER_RADIUS, enemy.x, enemy.z, ENEMY_RADIUS);
    if (overlapping && !enemy.overlappingShot) {
      const dist = Math.hypot(x - enemy.x, z - enemy.z) || 1;
      const nx = (x - enemy.x) / dist;
      const nz = (z - enemy.z) / dist;
      const impactSpeed = Math.hypot(velX, velZ);
      const reflected = reflectOffCircle(velX, velZ, nx, nz, ENEMY_RESTITUTION);
      velX = reflected.vx;
      velZ = reflected.vz;
      x = enemy.x + nx * (PLAYER_RADIUS + ENEMY_RADIUS);
      z = enemy.z + nz * (PLAYER_RADIUS + ENEMY_RADIUS);
      resolveEnemyHit(enemy, impactSpeed);
    }
    enemy.overlappingShot = overlapping;
  }

  enemies = enemies.filter((e) => !e.dead);
  enemyCountEl.textContent = `残り敵: ${enemies.length}`;

  playerMesh.position.x = x;
  playerMesh.position.z = z;

  if (enemies.length === 0) {
    phase = "win";
    overlayTitleEl.textContent = "CLEAR!";
    overlaySubtitleEl.textContent = `SCORE: ${score}`;
    overlayEl.classList.add("show");
  }
}

function startEnemyTurn() {
  if (phase === "win" || phase === "gameOver") return;
  phase = "enemyTurn";
  enemyTurnTimer = ENEMY_TURN_MS;
  for (const enemy of enemies) {
    const next = advanceToward(enemy.x, enemy.z, playerMesh.position.x, playerMesh.position.z, ENEMY_ADVANCE_STEP);
    enemy.x = next.x;
    enemy.z = next.z;
    enemy.mesh.position.x = enemy.x;
    enemy.mesh.position.z = enemy.z;
    if (circlesOverlap(enemy.x, enemy.z, ENEMY_RADIUS, playerMesh.position.x, playerMesh.position.z, PLAYER_RADIUS)) {
      damagePlayer(ENEMY_CONTACT_DAMAGE);
    }
  }
}

// ---------- Main loop ----------
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(now - lastTime, 50) / 1000;
  const dtMs = Math.min(now - lastTime, 50);
  lastTime = now;

  if (phase === "flying") {
    updateFlying(dt);
  } else if (phase === "enemyTurn") {
    enemyTurnTimer -= dtMs;
    if (enemyTurnTimer <= 0 && phase === "enemyTurn") {
      phase = "ready";
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

resetGame();
requestAnimationFrame(loop);
