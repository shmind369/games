import * as THREE from "three";

// ---------- Scope ----------
// A pseudo-3D "into the screen" rail-shooter stage in the style of
// Contra's even-numbered stages: the camera sits behind/above the player
// character and everything scrolls toward the camera automatically. The
// player only controls left/right strafing (drag) and where to shoot
// (tap) — there is no forward/back control, matching the on-rails feel.
//
// Three hazard types, each testable in isolation:
//   - soldiers: must be shot before they reach the player (contact damage)
//   - turrets: fire telegraphed projectiles the player can shoot down or
//     dodge by strafing off the impact lane
//   - laser gates: an unshootable barrier with a gap; the player must be
//     standing in the gap when it reaches them

// ---------- Tuning ----------
const LANE_HALF_WIDTH = 4.5;
const PLAYER_Z = 0;
const BASE_SCROLL_SPEED = 12; // units/sec at stage start
const MAX_SCROLL_SPEED = 19; // units/sec near stage end
const STAGE_LENGTH = 820; // total scroll distance to clear the stage
const SPAWN_MARGIN = 40; // stop spawning new hazards this close to the end
const SPAWN_Z = -120;
const COLLIDE_Z = -3.2; // z at which an approaching hazard resolves against the player
const PLAYER_MAX_HP = 5;

const SOLDIER_SPAWN_INTERVAL_MS = 1450;
const TURRET_SPAWN_INTERVAL_MS = 4000;
const GATE_SPAWN_INTERVAL_MS = 5600;
const PILLAR_SPAWN_INTERVAL_MS = 550;

const TURRET_FIRE_INTERVAL_MS = 1700;
const PROJECTILE_TRAVEL_MS = 1000;
const PROJECTILE_HIT_RADIUS = 1.15;
const GATE_GAP_HALF_WIDTH = 1.5;

const TAP_MAX_MS = 260;
const TAP_MAX_DRAG_PX = 14;
const SHOOT_HIT_RADIUS_PX = 50;

const SCORE_PER_SOLDIER = 100;
const SCORE_PER_TURRET = 150;

// ---------- Pure logic (no THREE/DOM — directly unit testable) ----------
function clampLaneX(x) {
  return Math.max(-LANE_HALF_WIDTH, Math.min(LANE_HALF_WIDTH, x));
}

// candidates: [{ id, screenX, screenY }]. Returns the id of the nearest
// candidate within radiusPx of the tap, or null if none qualify.
function pickTarget(tapX, tapY, candidates, radiusPx) {
  let bestId = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.screenX - tapX, c.screenY - tapY);
    if (d <= radiusPx && d < bestDist) {
      bestDist = d;
      bestId = c.id;
    }
  }
  return bestId;
}

function isInGateGap(playerX, gapCenter, gapHalfWidth) {
  return Math.abs(playerX - gapCenter) <= gapHalfWidth;
}

function isProjectileHit(playerX, targetX, hitRadius) {
  return Math.abs(playerX - targetX) <= hitRadius;
}

function scrollSpeedForProgress(progress) {
  const t = Math.max(0, Math.min(1, progress));
  return BASE_SCROLL_SPEED + (MAX_SCROLL_SPEED - BASE_SCROLL_SPEED) * t;
}

// ---------- Scene setup ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1018);
scene.fog = new THREE.Fog(0x0a1018, 30, 110);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 200);

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

scene.add(new THREE.AmbientLight(0x8fa8ff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(8, 20, 10);
scene.add(sun);

// ---------- Ground: large static plane with an animated grid texture so
// motion reads as "scrolling toward camera" without moving real geometry ----------
function makeGridTexture() {
  const size = 128;
  const cnv = document.createElement("canvas");
  cnv.width = cnv.height = size;
  const c = cnv.getContext("2d");
  c.fillStyle = "#132018";
  c.fillRect(0, 0, size, size);
  c.strokeStyle = "#20402a";
  c.lineWidth = 5;
  c.strokeRect(2, 2, size - 4, size - 4);
  const tex = new THREE.CanvasTexture(cnv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 240);
  return tex;
}
const groundTexture = makeGridTexture();
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(LANE_HALF_WIDTH * 7, 2400),
  new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, 0, -1100);
scene.add(ground);

// ---------- Player (seen from behind) ----------
const player = new THREE.Group();
const torso = new THREE.Mesh(
  new THREE.BoxGeometry(0.9, 1.1, 0.5),
  new THREE.MeshStandardMaterial({ color: 0x3a6bd8 })
);
torso.position.y = 1.0;
player.add(torso);
const head = new THREE.Mesh(
  new THREE.SphereGeometry(0.32, 16, 16),
  new THREE.MeshStandardMaterial({ color: 0xe0b592 })
);
head.position.y = 1.75;
player.add(head);
const gun = new THREE.Mesh(
  new THREE.BoxGeometry(0.14, 0.14, 0.9),
  new THREE.MeshStandardMaterial({ color: 0x222222 })
);
gun.position.set(0.55, 1.05, -0.7);
player.add(gun);
player.position.set(0, 0, PLAYER_Z);
scene.add(player);

const GUN_TIP_LOCAL = new THREE.Vector3(0.55, 1.05, -1.15);

// ---------- Entity pools ----------
let soldiers = []; // { mesh, x, z, dead, resolved }
let turrets = []; // { mesh, x, z, dead, resolved, fireTimer }
let gates = []; // { group, gapCenter, z, resolved }
let projectiles = []; // { mesh, fromX, fromZ, targetX, z, elapsed, resolved }
let pillars = []; // { mesh, z } decorative only

function makeSoldier(x) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.0, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xd24545 })
  );
  body.position.y = 0.9;
  group.add(body);
  const h = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x7a2020 })
  );
  h.position.y = 1.5;
  group.add(h);
  return group;
}

function makeTurret() {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.55, 1.4, 10),
    new THREE.MeshStandardMaterial({ color: 0x555b66 })
  );
  base.position.y = 0.7;
  group.add(base);
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xff5050, emissive: 0x882020 })
  );
  eye.position.set(0, 1.5, 0.3);
  group.add(eye);
  return group;
}

function makeGate(gapCenter) {
  const group = new THREE.Group();
  const barMat = new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0x660018 });
  const leftWidth = gapCenter - GATE_GAP_HALF_WIDTH - -(LANE_HALF_WIDTH + 2);
  const rightWidth = LANE_HALF_WIDTH + 2 - (gapCenter + GATE_GAP_HALF_WIDTH);
  if (leftWidth > 0.05) {
    const left = new THREE.Mesh(new THREE.BoxGeometry(leftWidth, 2.4, 0.25), barMat);
    left.position.set(-(LANE_HALF_WIDTH + 2) + leftWidth / 2, 1.2, 0);
    group.add(left);
  }
  if (rightWidth > 0.05) {
    const right = new THREE.Mesh(new THREE.BoxGeometry(rightWidth, 2.4, 0.25), barMat);
    right.position.set(gapCenter + GATE_GAP_HALF_WIDTH + rightWidth / 2, 1.2, 0);
    group.add(right);
  }
  return group;
}

function makeProjectile() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xffaa33, emissive: 0xaa5500 })
  );
}

function makePillar(side) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 3, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x2a3040 })
  );
  mesh.position.set(side * (LANE_HALF_WIDTH + 1.4), 1.5, SPAWN_Z);
  return mesh;
}

// ---------- Impact flashes (shot feedback) ----------
let flashes = []; // { mesh, age, life }
function spawnFlash(x, y, z, color) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 10),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);
  flashes.push({ mesh, age: 0, life: 220 });
}

// ---------- Game state ----------
let hp = PLAYER_MAX_HP;
let score = 0;
let distance = 0;
let gameOver = false;
let stageClear = false;
let playerX = 0;

let soldierTimer = 0;
let turretTimer = 0;
let gateTimer = 0;
let pillarTimer = 0;

const hpEl = document.getElementById("hp");
const scoreEl = document.getElementById("score");
const progressBarEl = document.getElementById("progressBar");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlayTitle");
const overlaySubtitleEl = document.getElementById("overlaySubtitle");
document.getElementById("restartBtn").addEventListener("click", resetGame);

function resetGame() {
  for (const s of soldiers) scene.remove(s.mesh);
  for (const t of turrets) scene.remove(t.mesh);
  for (const g of gates) scene.remove(g.group);
  for (const p of projectiles) scene.remove(p.mesh);
  for (const p of pillars) scene.remove(p.mesh);
  for (const f of flashes) scene.remove(f.mesh);
  soldiers = [];
  turrets = [];
  gates = [];
  projectiles = [];
  pillars = [];
  flashes = [];

  hp = PLAYER_MAX_HP;
  score = 0;
  distance = 0;
  gameOver = false;
  stageClear = false;
  playerX = 0;
  soldierTimer = 0;
  turretTimer = 0;
  gateTimer = 0;
  pillarTimer = 0;

  hpEl.textContent = String(hp);
  scoreEl.textContent = String(score);
  progressBarEl.style.width = "0%";
  overlayEl.classList.remove("show");
}

function damagePlayer(amount) {
  hp = Math.max(0, hp - amount);
  hpEl.textContent = String(hp);
  if (hp <= 0 && !gameOver && !stageClear) {
    gameOver = true;
    overlayTitleEl.textContent = "GAME OVER";
    overlaySubtitleEl.textContent = `SCORE: ${score}`;
    overlayEl.classList.add("show");
  }
}

function addScore(points) {
  score += points;
  scoreEl.textContent = String(score);
}

// ---------- Input: drag to strafe, tap to shoot ----------
// Same tap-vs-drag distinction used elsewhere in this repo: a pointer
// gesture that stays within a small radius and resolves quickly is a
// shot; anything that moves further is a strafe drag.
let pointerId = null;
let pointerStartX = 0;
let pointerStartY = 0;
let pointerStartTime = 0;
let dragOriginPlayerX = 0;
let isDragging = false;

function strafeSensitivity() {
  // Dragging across ~90% of the screen width should cover the full lane.
  return (LANE_HALF_WIDTH * 2) / (width * 0.9);
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  pointerId = e.pointerId;
  pointerStartX = e.clientX;
  pointerStartY = e.clientY;
  pointerStartTime = performance.now();
  dragOriginPlayerX = playerX;
  isDragging = false;
  renderer.domElement.setPointerCapture(e.pointerId);
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (e.pointerId !== pointerId || gameOver || stageClear) return;
  const dx = e.clientX - pointerStartX;
  const dy = e.clientY - pointerStartY;
  if (!isDragging && Math.hypot(dx, dy) > TAP_MAX_DRAG_PX) isDragging = true;
  if (isDragging) {
    playerX = clampLaneX(dragOriginPlayerX + dx * strafeSensitivity());
  }
});

function handlePointerEnd(e) {
  if (e.pointerId !== pointerId) return;
  const elapsed = performance.now() - pointerStartTime;
  if (!isDragging && elapsed <= TAP_MAX_MS && !gameOver && !stageClear) {
    shootAt(e.clientX, e.clientY);
  }
  pointerId = null;
  isDragging = false;
}
renderer.domElement.addEventListener("pointerup", handlePointerEnd);
renderer.domElement.addEventListener("pointercancel", handlePointerEnd);

// ---------- Shooting ----------
const _projectVec = new THREE.Vector3();
function worldToScreen(x, y, z) {
  _projectVec.set(x, y, z).project(camera);
  return {
    x: (_projectVec.x * 0.5 + 0.5) * width,
    y: (1 - (_projectVec.y * 0.5 + 0.5)) * height,
  };
}

const raycaster = new THREE.Raycaster();
function shootAt(clientX, clientY) {
  const candidates = [];
  for (const s of soldiers) {
    if (s.dead || s.resolved) continue;
    const p = worldToScreen(s.x, 0.9, s.z);
    candidates.push({ id: s, screenX: p.x, screenY: p.y });
  }
  for (const t of turrets) {
    if (t.dead || t.resolved) continue;
    const p = worldToScreen(t.x, 1.0, t.z);
    candidates.push({ id: t, screenX: p.x, screenY: p.y });
  }

  const target = pickTarget(clientX, clientY, candidates, SHOOT_HIT_RADIUS_PX);

  const gunTip = GUN_TIP_LOCAL.clone().add(new THREE.Vector3(playerX, 0, PLAYER_Z));
  if (target) {
    target.dead = true;
    addScore(target.kind === "turret" ? SCORE_PER_TURRET : SCORE_PER_SOLDIER);
    spawnFlash(target.x, target.kind === "turret" ? 1.0 : 0.9, target.z, 0xffe066);
  } else {
    const ndc = new THREE.Vector2((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const missPoint = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(30));
    spawnFlash(missPoint.x, missPoint.y, missPoint.z, 0x888888);
  }
  spawnFlash(gunTip.x, gunTip.y, gunTip.z, 0xffffff);
}

// ---------- Spawning ----------
function trySpawn(dt) {
  if (distance >= STAGE_LENGTH - SPAWN_MARGIN) return;

  soldierTimer += dt;
  if (soldierTimer >= SOLDIER_SPAWN_INTERVAL_MS) {
    soldierTimer = 0;
    const x = clampLaneX((Math.random() * 2 - 1) * LANE_HALF_WIDTH);
    const mesh = makeSoldier(x);
    mesh.position.set(x, 0, SPAWN_Z);
    scene.add(mesh);
    soldiers.push({ mesh, x, z: SPAWN_Z, dead: false, resolved: false, kind: "soldier" });
  }

  turretTimer += dt;
  if (turretTimer >= TURRET_SPAWN_INTERVAL_MS) {
    turretTimer = 0;
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * (LANE_HALF_WIDTH + 1.4);
    const mesh = makeTurret();
    mesh.position.set(x, 0, SPAWN_Z);
    scene.add(mesh);
    turrets.push({ mesh, x, z: SPAWN_Z, dead: false, resolved: false, fireTimer: 0, kind: "turret" });
  }

  gateTimer += dt;
  if (gateTimer >= GATE_SPAWN_INTERVAL_MS) {
    gateTimer = 0;
    const gapCenter = clampLaneX((Math.random() * 2 - 1) * (LANE_HALF_WIDTH - GATE_GAP_HALF_WIDTH));
    const group = makeGate(gapCenter);
    group.position.set(0, 0, SPAWN_Z);
    scene.add(group);
    gates.push({ group, gapCenter, z: SPAWN_Z, resolved: false });
  }

  pillarTimer += dt;
  if (pillarTimer >= PILLAR_SPAWN_INTERVAL_MS) {
    pillarTimer = 0;
    const left = makePillar(-1);
    const right = makePillar(1);
    scene.add(left);
    scene.add(right);
    pillars.push({ mesh: left, z: SPAWN_Z }, { mesh: right, z: SPAWN_Z });
  }
}

// ---------- Main loop ----------
let lastTime = performance.now();

function update(dt) {
  if (gameOver || stageClear) return;

  const speed = scrollSpeedForProgress(distance / STAGE_LENGTH);
  const moveZ = (speed * dt) / 1000;
  distance += moveZ;
  progressBarEl.style.width = `${Math.min(100, (distance / STAGE_LENGTH) * 100)}%`;

  trySpawn(dt);

  player.position.x = playerX;
  camera.position.set(playerX * 0.55, 3.3, PLAYER_Z + 6.5);
  camera.lookAt(playerX * 0.25, 1.3, PLAYER_Z - 12);

  // Soldiers: advance, edge-trigger contact damage at COLLIDE_Z, remove once shot or resolved.
  for (const s of soldiers) {
    if (s.dead) continue;
    s.z += moveZ;
    s.mesh.position.z = s.z;
    if (!s.resolved && s.z >= COLLIDE_Z) {
      s.resolved = true;
      damagePlayer(1);
    }
  }

  // Turrets: advance, fire telegraphed projectiles while alive and ahead
  // of the collide line, despawn harmlessly once they reach it.
  for (const t of turrets) {
    if (t.dead) continue;
    t.z += moveZ;
    t.mesh.position.z = t.z;
    if (t.z < COLLIDE_Z) {
      t.fireTimer += dt;
      if (t.fireTimer >= TURRET_FIRE_INTERVAL_MS) {
        t.fireTimer = 0;
        const mesh = makeProjectile();
        mesh.position.set(t.x, 1.1, t.z);
        scene.add(mesh);
        projectiles.push({
          mesh,
          fromX: t.x,
          fromZ: t.z,
          targetX: playerX,
          elapsed: 0,
          resolved: false,
        });
      }
    } else if (!t.resolved) {
      t.resolved = true;
    }
  }

  // Laser gates: advance, edge-trigger gap check at COLLIDE_Z.
  for (const g of gates) {
    g.z += moveZ;
    g.group.position.z = g.z;
    if (!g.resolved && g.z >= COLLIDE_Z) {
      g.resolved = true;
      if (!isInGateGap(playerX, g.gapCenter, GATE_GAP_HALF_WIDTH)) {
        damagePlayer(1);
      }
    }
  }

  // Turret projectiles: travel from turret to a fixed target point over
  // PROJECTILE_TRAVEL_MS, then resolve a hit check against the player's
  // *current* lane position.
  for (const p of projectiles) {
    if (p.resolved) continue;
    p.elapsed += dt;
    const t = Math.min(1, p.elapsed / PROJECTILE_TRAVEL_MS);
    p.mesh.position.x = p.fromX + (p.targetX - p.fromX) * t;
    p.mesh.position.z = p.fromZ + (PLAYER_Z - p.fromZ) * t;
    p.mesh.position.y = 1.1 + 0.6 * Math.sin(Math.PI * t); // slight arc feel
    if (t >= 1) {
      p.resolved = true;
      if (isProjectileHit(playerX, p.targetX, PROJECTILE_HIT_RADIUS)) {
        damagePlayer(1);
      }
    }
  }

  // Decorative pillars: pure visual scroll, despawn once past camera.
  for (const pl of pillars) {
    pl.z += moveZ;
    pl.mesh.position.z = pl.z;
  }

  // Flash fx aging.
  for (const f of flashes) {
    f.age += dt;
    const t = f.age / f.life;
    f.mesh.scale.setScalar(1 + t * 1.8);
    f.mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
  }

  // Scroll the ground texture to sell forward motion without moving geometry.
  groundTexture.offset.y -= moveZ / 8;

  // Cleanup: remove dead/passed soldiers & turrets, resolved gates,
  // resolved projectiles, expired flashes, and pillars that scrolled past.
  soldiers = soldiers.filter((s) => {
    const remove = s.dead || s.resolved;
    if (remove) scene.remove(s.mesh);
    return !remove;
  });
  turrets = turrets.filter((t) => {
    const remove = t.dead || t.resolved;
    if (remove) scene.remove(t.mesh);
    return !remove;
  });
  gates = gates.filter((g) => {
    const remove = g.resolved;
    if (remove) scene.remove(g.group);
    return !remove;
  });
  projectiles = projectiles.filter((p) => {
    const remove = p.resolved;
    if (remove) scene.remove(p.mesh);
    return !remove;
  });
  pillars = pillars.filter((pl) => {
    const remove = pl.z > 8;
    if (remove) scene.remove(pl.mesh);
    return !remove;
  });
  flashes = flashes.filter((f) => {
    const remove = f.age >= f.life;
    if (remove) scene.remove(f.mesh);
    return !remove;
  });

  if (distance >= STAGE_LENGTH && !stageClear && !gameOver) {
    stageClear = true;
    overlayTitleEl.textContent = "STAGE CLEAR";
    overlaySubtitleEl.textContent = `SCORE: ${score}`;
    overlayEl.classList.add("show");
  }
}

function loop(now) {
  const dt = Math.min(now - lastTime, 50);
  lastTime = now;
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

resetGame();
requestAnimationFrame(loop);
