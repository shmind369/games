import * as THREE from "three";
import {
  generateMaze, isWall, bfsDistances, bfsNextStep, pickWanderStep,
  playerSpeedForWeight, speedFactorForWeight, totalCarriedWeight,
  canOpenExit, decidePursuerState, chooseSpreadCells,
  PURSUER_SPEED,
} from "./maze.js";

// ---------- Tunables ----------
const MAZE_W = 15;
const MAZE_H = 15;
const CELL = 4;
const WALL_HEIGHT = 3.2;
const EYE_HEIGHT = 1.62;
const PLAYER_RADIUS = 0.38;
const TOTAL_KEYS = 6;
const REQUIRED_KEYS = 4;
const PICKUP_RANGE = 1.5;
const EXIT_RANGE = 1.6;
const CATCH_RANGE = PLAYER_RADIUS + 0.55;

const AI_TICK_MS = 160;
const SIGHT_RADIUS = CELL * 3.4;
const HEAR_RADIUS = CELL * 0.85;
const LOSE_RADIUS = CELL * 4.4;
const LOSE_GRACE_TICKS = 7;

function gridToWorld(gx, gy) {
  return new THREE.Vector3(gx * CELL, 0, gy * CELL);
}
function distanceXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// ---------- Maze data ----------
const grid = generateMaze(MAZE_W, MAZE_H);
const startCell = [1, 1];
const distFromStart = bfsDistances(grid, startCell[0], startCell[1]);

function farthestCell() {
  let best = startCell, bestD = -1;
  for (const [k, d] of distFromStart) {
    if (d > bestD) { bestD = d; best = k.split(",").map(Number); }
  }
  return best;
}
const exitCell = farthestCell();

const keyWeights = [1, 2, 1, 2, 1, 2];
const keyCells = chooseSpreadCells(grid, startCell[0], startCell[1], TOTAL_KEYS, 5);

const pursuerCandidates = [...distFromStart].filter(([, d]) => d >= 12).map(([k]) => k.split(",").map(Number));
const pursuerStartCell = pursuerCandidates.length > 0
  ? pursuerCandidates[Math.floor(Math.random() * pursuerCandidates.length)]
  : exitCell;

// ---------- Scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.Fog(0x05060a, CELL * 3.2, CELL * 11);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);
camera.rotation.order = "YXZ";

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(new THREE.AmbientLight(0x8f96b8, 0.9));
scene.add(new THREE.HemisphereLight(0x8fa0d8, 0x141018, 0.5));
const lantern = new THREE.PointLight(0xffd9a0, 2.2, CELL * 8, 1.7);
scene.add(lantern);

// ---------- Maze geometry ----------
const floorGeo = new THREE.PlaneGeometry(MAZE_W * CELL, MAZE_H * CELL);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x171a24, roughness: 0.95 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.set(((MAZE_W - 1) * CELL) / 2, 0, ((MAZE_H - 1) * CELL) / 2);
scene.add(floor);

const ceilGeo = new THREE.PlaneGeometry(MAZE_W * CELL, MAZE_H * CELL);
const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0b0c11, roughness: 1 });
const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.set(((MAZE_W - 1) * CELL) / 2, WALL_HEIGHT, ((MAZE_H - 1) * CELL) / 2);
scene.add(ceiling);

const wallPositions = [];
for (let y = 0; y < MAZE_H; y++) {
  for (let x = 0; x < MAZE_W; x++) {
    if (grid[y][x] === 1) wallPositions.push([x, y]);
  }
}
const wallGeo = new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b3040, roughness: 0.85 });
const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallPositions.length);
const dummy = new THREE.Object3D();
wallPositions.forEach(([gx, gy], i) => {
  dummy.position.set(gx * CELL, WALL_HEIGHT / 2, gy * CELL);
  dummy.updateMatrix();
  wallMesh.setMatrixAt(i, dummy.matrix);
});
scene.add(wallMesh);

// ---------- Exit door ----------
const exitGroup = new THREE.Group();
const exitFrameMat = new THREE.MeshStandardMaterial({ color: 0x3a3f52, roughness: 0.6, metalness: 0.3 });
const exitFrame = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.9, WALL_HEIGHT * 0.94, 0.3), exitFrameMat);
exitGroup.add(exitFrame);
const exitDoorMat = new THREE.MeshStandardMaterial({
  color: 0x552222, emissive: 0x551515, emissiveIntensity: 0.9, roughness: 0.4,
});
const exitDoor = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.62, WALL_HEIGHT * 0.72, 0.22), exitDoorMat);
exitDoor.position.y = -0.05;
exitGroup.add(exitDoor);
exitGroup.position.copy(gridToWorld(exitCell[0], exitCell[1])).setY(WALL_HEIGHT / 2);
scene.add(exitGroup);
const exitLight = new THREE.PointLight(0xff5544, 1.1, CELL * 3.5, 2);
exitLight.position.copy(exitGroup.position);
scene.add(exitLight);

// ---------- Keys ----------
const lightKeyGeo = new THREE.TorusKnotGeometry(0.24, 0.07, 64, 8, 2, 3);
const heavyKeyGeo = new THREE.TorusKnotGeometry(0.32, 0.11, 64, 8, 2, 3);
const lightKeyMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x3a2c00, metalness: 0.7, roughness: 0.3 });
const heavyKeyMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, emissive: 0x1a0f00, metalness: 0.6, roughness: 0.4 });

const items = keyCells.map(([gx, gy], i) => {
  const weight = keyWeights[i % keyWeights.length];
  const heavy = weight >= 2;
  const mesh = new THREE.Mesh(heavy ? heavyKeyGeo : lightKeyGeo, heavy ? heavyKeyMat : lightKeyMat);
  mesh.position.copy(gridToWorld(gx, gy)).setY(1.05);
  scene.add(mesh);
  return {
    id: `key${i}`,
    label: heavy ? `重い鍵 (重さ2)` : `軽い鍵 (重さ1)`,
    weight,
    mesh,
    carried: false,
    homeCell: [gx, gy],
  };
});

// ---------- Player ----------
const player = {
  pos: gridToWorld(startCell[0], startCell[1]).setY(EYE_HEIGHT),
  yaw: Math.PI,
  pitch: 0,
};
camera.position.copy(player.pos);

function resolveCollision(pos) {
  const gx = Math.round(pos.x / CELL);
  const gy = Math.round(pos.z / CELL);
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = gx + ox, cy = gy + oy;
      if (!isWall(grid, cx, cy)) continue;
      const center = gridToWorld(cx, cy);
      const half = CELL / 2;
      const closestX = THREE.MathUtils.clamp(pos.x, center.x - half, center.x + half);
      const closestZ = THREE.MathUtils.clamp(pos.z, center.z - half, center.z + half);
      const dx = pos.x - closestX, dz = pos.z - closestZ;
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

// ---------- Pursuer ----------
const pursuerGeo = new THREE.CapsuleGeometry(0.42, 1.05, 4, 10);
const pursuerMat = new THREE.MeshStandardMaterial({ color: 0x140505, roughness: 0.85, emissive: 0x220000 });
const pursuerMesh = new THREE.Mesh(pursuerGeo, pursuerMat);
pursuerMesh.position.copy(gridToWorld(pursuerStartCell[0], pursuerStartCell[1])).setY(1.0);
scene.add(pursuerMesh);
const pursuerGlow = new THREE.PointLight(0xff2a2a, 0.55, CELL * 2.4, 2);
scene.add(pursuerGlow);

const pursuer = {
  cell: [...pursuerStartCell],
  from: null,
  target: pursuerMesh.position.clone(),
  aiState: { mode: "wander", loseCounter: 0 },
  aiTimer: 0,
  distanceSinceStep: 0,
};

function pursuerRetarget() {
  const [px, py] = pursuer.cell;
  let next = null;
  if (pursuer.aiState.mode === "chase") {
    const playerCell = [Math.round(player.pos.x / CELL), Math.round(player.pos.z / CELL)];
    next = bfsNextStep(grid, px, py, playerCell[0], playerCell[1]);
  }
  if (!next) next = pickWanderStep(grid, px, py, pursuer.from, Math.random);
  if (next) {
    pursuer.from = pursuer.cell;
    pursuer.cell = next;
    pursuer.target = gridToWorld(next[0], next[1]).setY(1.0);
  }
}
pursuerRetarget();

const camRaycaster = new THREE.Raycaster();
function hasLineOfSight() {
  const from = pursuerMesh.position.clone().setY(1.2);
  const to = camera.position.clone().setY(1.2);
  const dir = to.clone().sub(from);
  const dist = dir.length();
  if (dist < 0.01) return true;
  dir.normalize();
  camRaycaster.set(from, dir);
  camRaycaster.near = 0;
  camRaycaster.far = dist;
  const hits = camRaycaster.intersectObject(wallMesh);
  return hits.length === 0;
}

// ---------- Input: joystick ----------
const joystickBase = document.getElementById("joystickBase");
const joystickKnob = document.getElementById("joystickKnob");
const joystickDir = { x: 0, y: 0 };
let joystickPointerId = null;

function updateJoystick(clientX, clientY) {
  const rect = joystickBase.getBoundingClientRect();
  const radius = rect.width / 2;
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  const dist = Math.hypot(dx, dy) || 1;
  const clamped = Math.min(dist, radius);
  const mag = clamped / radius;
  joystickKnob.style.transform = `translate(${(dx / dist) * clamped}px, ${(dy / dist) * clamped}px)`;
  joystickDir.x = (dx / dist) * mag;
  joystickDir.y = (dy / dist) * mag;
}
function resetJoystick() {
  joystickPointerId = null;
  joystickDir.x = 0;
  joystickDir.y = 0;
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
joystickBase.addEventListener("pointerup", (e) => { if (e.pointerId === joystickPointerId) resetJoystick(); });
joystickBase.addEventListener("pointercancel", resetJoystick);

// ---------- Input: look (drag anywhere) ----------
const lookLayer = document.getElementById("lookLayer");
const LOOK_SENSITIVITY = 0.0032;
let lookPointerId = null;
let lastLookX = 0, lastLookY = 0;

lookLayer.addEventListener("pointerdown", (e) => {
  lookPointerId = e.pointerId;
  lastLookX = e.clientX;
  lastLookY = e.clientY;
  lookLayer.setPointerCapture(e.pointerId);
});
lookLayer.addEventListener("pointermove", (e) => {
  if (e.pointerId !== lookPointerId) return;
  const dx = e.clientX - lastLookX;
  const dy = e.clientY - lastLookY;
  lastLookX = e.clientX;
  lastLookY = e.clientY;
  player.yaw -= dx * LOOK_SENSITIVITY;
  player.pitch = THREE.MathUtils.clamp(player.pitch - dy * LOOK_SENSITIVITY, -0.55, 0.55);
});
lookLayer.addEventListener("pointerup", (e) => { if (e.pointerId === lookPointerId) lookPointerId = null; });
lookLayer.addEventListener("pointercancel", () => { lookPointerId = null; });

// ---------- HUD / state ----------
const keyCountEl = document.getElementById("keyCount");
const weightFillEl = document.getElementById("weightFill");
const weightLabelEl = document.getElementById("weightLabel");
const messageEl = document.getElementById("message");
const pickupBtn = document.getElementById("pickupBtn");
const dropBtn = document.getElementById("dropBtn");
const dropTray = document.getElementById("dropTray");

let messageTimer = null;
function showMessage(text, ms = 1600) {
  messageEl.textContent = text;
  messageEl.classList.add("show");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => messageEl.classList.remove("show"), ms);
}

const gameState = { started: false, over: false, won: false, nearItem: null, trayOpen: false, exitWarnedAt: 0 };

function carriedItems() { return items.filter((it) => it.carried); }
function refreshHud() {
  const carried = carriedItems();
  const weight = totalCarriedWeight(carried);
  const speedPct = Math.round(speedFactorForWeight(weight) * 100);
  keyCountEl.textContent = `${carried.length} / ${REQUIRED_KEYS}`;
  keyCountEl.classList.toggle("ready", carried.length >= REQUIRED_KEYS);
  weightFillEl.style.width = `${Math.min(100, (weight / 9) * 100)}%`;
  weightLabelEl.textContent = `速度 ${speedPct}%`;
}
refreshHud();

function updateActionButtons() {
  pickupBtn.classList.toggle("show", !!gameState.nearItem);
  dropBtn.classList.toggle("show", carriedItems().length > 0);
  if (carriedItems().length === 0) { gameState.trayOpen = false; dropTray.classList.remove("show"); }
}

pickupBtn.addEventListener("click", () => {
  const item = gameState.nearItem;
  if (!item) return;
  item.carried = true;
  item.mesh.visible = false;
  gameState.nearItem = null;
  updateActionButtons();
  showMessage(`${item.label}を拾った`);
});

dropBtn.addEventListener("click", () => {
  gameState.trayOpen = !gameState.trayOpen;
  renderDropTray();
});

function renderDropTray() {
  dropTray.innerHTML = "";
  dropTray.classList.toggle("show", gameState.trayOpen);
  if (!gameState.trayOpen) return;
  for (const item of carriedItems()) {
    const chip = document.createElement("button");
    chip.className = "dropChip";
    chip.textContent = `${item.label} を置く`;
    chip.addEventListener("click", () => {
      item.carried = false;
      item.mesh.position.copy(player.pos).setY(1.05);
      item.mesh.visible = true;
      gameState.trayOpen = carriedItems().length > 0 && gameState.trayOpen;
      updateActionButtons();
      renderDropTray();
      showMessage(`${item.label}を足元に置いた`);
    });
    dropTray.appendChild(chip);
  }
}

// ---------- Overlays ----------
const startOverlay = document.getElementById("startOverlay");
const caughtOverlay = document.getElementById("caughtOverlay");
const clearOverlay = document.getElementById("clearOverlay");

let audioCtx = null;
document.getElementById("startBtn").addEventListener("click", () => {
  startOverlay.classList.remove("show");
  gameState.started = true;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
});
document.getElementById("retryBtn").addEventListener("click", () => location.reload());
document.getElementById("againBtn").addEventListener("click", () => location.reload());

function endGame(won) {
  gameState.over = true;
  gameState.won = won;
  if (won) {
    document.getElementById("clearDetail").textContent =
      `${carriedItems().length}個の鍵を持って脱出した。`;
    clearOverlay.classList.add("show");
  } else {
    document.getElementById("caughtDetail").textContent =
      `重さ ${totalCarriedWeight(carriedItems())} を抱えていた。`;
    caughtOverlay.classList.add("show");
  }
}

// ---------- Footstep audio ----------
const FOOTSTEP_STRIDE = CELL * 0.42;
const AUDIBLE_RANGE = CELL * 9;

function playFootstep(distance, panValue, chasing) {
  if (!audioCtx) return;
  const volume = Math.max(0, 1 - distance / AUDIBLE_RANGE);
  if (volume <= 0.015) return;
  const t0 = audioCtx.currentTime;
  const eased = Math.pow(volume, 1.4);

  const pan = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
  const master = audioCtx.createGain();
  master.gain.value = eased * (chasing ? 0.85 : 0.55);
  if (pan) {
    pan.pan.value = THREE.MathUtils.clamp(panValue, -1, 1);
    master.connect(pan);
    pan.connect(audioCtx.destination);
  } else {
    master.connect(audioCtx.destination);
  }

  // low thump
  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  const oscGain = audioCtx.createGain();
  const basePitch = chasing ? 82 : 68;
  osc.frequency.setValueAtTime(basePitch + Math.random() * 8, t0);
  osc.frequency.exponentialRampToValueAtTime(basePitch * 0.55, t0 + 0.11);
  oscGain.gain.setValueAtTime(0.9, t0);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
  osc.connect(oscGain).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.14);

  // noise tick (footfall texture)
  const bufSize = Math.floor(audioCtx.sampleRate * 0.05);
  const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
  const noise = audioCtx.createBufferSource();
  noise.buffer = buf;
  const noiseFilter = audioCtx.createBiquadFilter();
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.value = 900;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.5, t0);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
  noise.connect(noiseFilter).connect(noiseGain).connect(master);
  noise.start(t0);
}

// ---------- Main loop ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  if (gameState.started && !gameState.over) {
    refreshHud();

    // Player movement, camera-relative, speed scaled by carried weight.
    const mag = Math.hypot(joystickDir.x, joystickDir.y);
    if (mag > 0.001) {
      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
      const dir = forward.multiplyScalar(-joystickDir.y).add(right.multiplyScalar(joystickDir.x));
      if (dir.lengthSq() > 1e-6) dir.normalize();
      const speed = playerSpeedForWeight(totalCarriedWeight(carriedItems()));
      const newPos = player.pos.clone().addScaledVector(dir, speed * mag * delta);
      newPos.y = EYE_HEIGHT;
      resolveCollision(newPos);
      player.pos.copy(newPos);
    }
    camera.position.copy(player.pos);
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    lantern.position.copy(player.pos);

    // Nearby item detection
    let nearest = null, nearestD = Infinity;
    for (const item of items) {
      if (item.carried) continue;
      const d = distanceXZ(item.mesh.position, player.pos);
      if (d < PICKUP_RANGE && d < nearestD) { nearest = item; nearestD = d; }
      item.mesh.rotation.y += delta * 1.4;
      item.mesh.position.y = 1.05 + Math.sin(performance.now() * 0.002 + item.mesh.position.x) * 0.06;
    }
    if (gameState.nearItem !== nearest) { gameState.nearItem = nearest; updateActionButtons(); }

    // Exit check
    const distToExit = distanceXZ(exitGroup.position, player.pos);
    const carriedKeys = carriedItems().length;
    const unlocked = canOpenExit(carriedKeys, REQUIRED_KEYS);
    exitDoorMat.color.setHex(unlocked ? 0x225a2a : 0x552222);
    exitDoorMat.emissive.setHex(unlocked ? 0x1e5522 : 0x551515);
    exitLight.color.setHex(unlocked ? 0x44ff66 : 0xff5544);
    if (distToExit < EXIT_RANGE) {
      if (unlocked) {
        endGame(true);
      } else if (performance.now() - gameState.exitWarnedAt > 1400) {
        gameState.exitWarnedAt = performance.now();
        showMessage(`鍵が足りない (${carriedKeys} / ${REQUIRED_KEYS})`);
      }
    }

    // ---------- Pursuer AI tick ----------
    pursuer.aiTimer += delta * 1000;
    if (pursuer.aiTimer >= AI_TICK_MS) {
      pursuer.aiTimer = 0;
      const dist = distanceXZ(pursuerMesh.position, player.pos);
      const los = dist < SIGHT_RADIUS + 2 ? hasLineOfSight() : false;
      const prevMode = pursuer.aiState.mode;
      pursuer.aiState = decidePursuerState(pursuer.aiState, {
        distance: dist,
        hasLineOfSight: los,
        sightRadius: SIGHT_RADIUS,
        hearRadius: HEAR_RADIUS,
        loseRadius: LOSE_RADIUS,
        loseGraceSteps: LOSE_GRACE_TICKS,
      });
      if (prevMode !== "chase" && pursuer.aiState.mode === "chase") {
        pursuer.cell = [Math.round(pursuerMesh.position.x / CELL), Math.round(pursuerMesh.position.z / CELL)];
        pursuerRetarget();
      }
    }

    // Pursuer movement toward its current target cell
    const toTarget = pursuer.target.clone().sub(pursuerMesh.position);
    const stepDist = PURSUER_SPEED * delta;
    if (toTarget.length() < stepDist + 0.02) {
      pursuerMesh.position.copy(pursuer.target);
      pursuerRetarget();
    } else {
      pursuerMesh.position.addScaledVector(toTarget.normalize(), stepDist);
    }
    pursuer.distanceSinceStep += stepDist;
    pursuerGlow.position.copy(pursuerMesh.position).setY(1.4);
    pursuerGlow.intensity = pursuer.aiState.mode === "chase" ? 0.95 : 0.5;
    pursuerMat.emissive.setHex(pursuer.aiState.mode === "chase" ? 0x550000 : 0x220000);

    if (pursuer.distanceSinceStep >= FOOTSTEP_STRIDE) {
      pursuer.distanceSinceStep = 0;
      const toPlayer = player.pos.clone().sub(pursuerMesh.position);
      const dist = toPlayer.length();
      const camForward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
      const camRight = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
      const dirToPursuer = pursuerMesh.position.clone().sub(player.pos).normalize();
      const pan = dirToPursuer.dot(camRight);
      playFootstep(dist, pan, pursuer.aiState.mode === "chase");
    }

    // Catch check
    if (distanceXZ(pursuerMesh.position, player.pos) < CATCH_RANGE) {
      endGame(false);
    }
  }

  renderer.render(scene, camera);
}

updateActionButtons();
animate();
