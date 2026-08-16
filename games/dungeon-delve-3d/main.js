import * as THREE from "three";
import {
  TILE, FLOOR_GOAL, HEADING_DELTA, turnLeft, turnRight, oppositeHeading,
  makeRng, initRun, attemptMove, descend,
  startAttack, finishAttack, stepMonsters,
} from "./dungeon.js";

// ---------- Three.js scene ----------
const CELL = 2.2;
const WALL_H = 2.6;
const EYE_H = 1.5;

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x241c28, 9, 26);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 40);

scene.add(new THREE.HemisphereLight(0x9a89b8, 0x2a2436, 0.85));
scene.add(new THREE.AmbientLight(0x6c5d80, 1.05));
const torch = new THREE.PointLight(0xffc082, 2.8, 14, 1.6);
camera.add(torch);
scene.add(camera);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- Procedural stone/wood textures (no external image assets) ----------
function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  return { canvas, ctx: canvas.getContext("2d") };
}

function createStoneBlockTexture() {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = "#26222c";
  ctx.fillRect(0, 0, size, size);
  const cols = 4, rows = 6;
  const bw = size / cols, bh = size / rows;
  for (let ry = 0; ry < rows; ry++) {
    const offset = (ry % 2) * (bw / 2);
    for (let rx = -1; rx <= cols; rx++) {
      const x = rx * bw + offset, y = ry * bh;
      const shade = 148 + Math.floor(Math.random() * 34 - 17);
      ctx.fillStyle = `rgb(${shade},${shade - 4},${shade + 6})`;
      const pad = 3;
      ctx.fillRect(x + pad, y + pad, bw - pad * 2, bh - pad * 2);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
        ctx.fillRect(x + pad + Math.random() * (bw - pad * 2), y + pad + Math.random() * (bh - pad * 2), 2, 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createFlagstoneTexture() {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = "#1c1922";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const cx = Math.random() * size, cy = Math.random() * size;
    const r = 18 + Math.random() * 20;
    const sides = 5 + Math.floor(Math.random() * 3);
    const shade = 92 + Math.floor(Math.random() * 38);
    ctx.fillStyle = `rgb(${shade},${shade - 4},${shade + 6})`;
    ctx.beginPath();
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2 + Math.random() * 0.3;
      const rr = r * (0.75 + Math.random() * 0.35);
      const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createWoodDoorTexture() {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = "#4a3018";
  ctx.fillRect(0, 0, size, size);
  const planks = 6;
  const pw = size / planks;
  for (let i = 0; i < planks; i++) {
    const shade = Math.floor(Math.random() * 22 - 6);
    ctx.fillStyle = `rgb(${112 + shade},${72 + Math.floor(shade * 0.6)},${40 + Math.floor(shade * 0.3)})`;
    ctx.fillRect(i * pw + 2, 0, pw - 4, size);
    ctx.strokeStyle = "rgba(25,12,4,0.4)";
    for (let g = 0; g < 4; g++) {
      const gx = i * pw + 5 + Math.random() * (pw - 10);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx + (Math.random() * 6 - 3), size);
      ctx.stroke();
    }
  }
  ctx.fillStyle = "#241811";
  ctx.fillRect(0, size * 0.16, size, 9);
  ctx.fillRect(0, size * 0.78, size, 9);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const stoneWallTexture = createStoneBlockTexture();
const flagstoneTexture = createFlagstoneTexture();
const woodDoorTexture = createWoodDoorTexture();

const wallMat = new THREE.MeshStandardMaterial({ map: stoneWallTexture, color: 0xd8d0e0, roughness: 0.88 });
const floorMat = new THREE.MeshStandardMaterial({ map: flagstoneTexture, color: 0xcfc7da, roughness: 0.92 });
const ceilMat = new THREE.MeshStandardMaterial({ map: stoneWallTexture, color: 0xb8aec6, roughness: 0.94, side: THREE.DoubleSide });
const stairsMat = new THREE.MeshStandardMaterial({ color: 0x1e6b66, roughness: 0.6, emissive: 0x0e3d3a, emissiveIntensity: 0.7 });
const potionMat = new THREE.MeshStandardMaterial({ color: 0xff5c6c, emissive: 0x991018, emissiveIntensity: 1.1, roughness: 0.4 });
const weaponMat = new THREE.MeshStandardMaterial({ color: 0x5cc8ff, emissive: 0x0d5a99, emissiveIntensity: 1.1, roughness: 0.35 });
const doorMat = new THREE.MeshStandardMaterial({ map: woodDoorTexture, color: 0xffffff, roughness: 0.8 });
const buttonFrameMat = new THREE.MeshStandardMaterial({ map: stoneWallTexture, color: 0xd8d0e0, roughness: 0.88 });

const MONSTER_NAMES = { zombie: "ゾンビ", skeleton: "スケルトン", ogre: "オーガ" };

// Builds a blocky voxel zombie out of boxes (Minecraft-style), each monster
// instance getting its own material clones so hit-flash doesn't bleed
// across other zombies sharing the same geometry.
function createZombieVoxel() {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x5c7a44, emissive: 0x14200e, emissiveIntensity: 0.6, roughness: 0.85 });
  const clothMat = new THREE.MeshStandardMaterial({ color: 0x3c4a3a, emissive: 0x0c140c, emissiveIntensity: 0.6, roughness: 0.9 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff4020, emissive: 0xff2000, emissiveIntensity: 1.6, roughness: 0.5 });

  const legGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, skinMat);
    leg.position.set(side * 0.1, 0.25, 0);
    group.add(leg);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.24), clothMat);
  torso.position.set(0, 0.725, 0);
  group.add(torso);

  const armGeo = new THREE.BoxGeometry(0.14, 0.42, 0.14);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, skinMat);
    arm.position.set(side * 0.28, 0.78, 0);
    arm.rotation.x = -0.9; // classic zombie arms-forward reach
    group.add(arm);
  }

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), skinMat);
  head.position.set(0, 1.09, 0);
  group.add(head);

  const eyeGeo = new THREE.BoxGeometry(0.05, 0.05, 0.03);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 0.07, 1.11, 0.15);
    group.add(eye);
  }
  return group;
}

const MONSTER_VISUALS = {
  zombie: { create: createZombieVoxel, y: 0 },
  skeleton: {
    create: () => new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.62, 6),
      new THREE.MeshStandardMaterial({ color: 0xdbe0c8, emissive: 0x2c2e22, emissiveIntensity: 0.6, roughness: 0.7 }),
    ),
    y: 0.32,
  },
  ogre: {
    create: () => new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.9, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x7a2b2b, emissive: 0x3a0e0e, emissiveIntensity: 0.6, roughness: 0.7 }),
    ),
    y: 0.46,
  },
};

const mazeGroup = new THREE.Group();
const monsterGroup = new THREE.Group();
const itemGroup = new THREE.Group();
scene.add(mazeGroup, monsterGroup, itemGroup);

function floorTileMaterial(tile) {
  return tile === TILE.STAIRS ? stairsMat : floorMat;
}

let doorMesh = null;
let buttonMesh = null;
const doorRestY = WALL_H / 2;
const doorOpenY = doorRestY + WALL_H + 0.1;

function buildFloorMesh(floor) {
  mazeGroup.clear();
  doorMesh = null;
  buttonMesh = null;
  const floorGeo = new THREE.PlaneGeometry(CELL, CELL);
  const ceilGeo = new THREE.PlaneGeometry(CELL, CELL);
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
  const doorGeo = new THREE.BoxGeometry(CELL * 0.96, WALL_H * 0.96, CELL * 0.4);

  for (let y = 0; y < floor.height; y++) {
    for (let x = 0; x < floor.width; x++) {
      const tile = floor.grid[y][x];
      const wx = x * CELL, wz = y * CELL;
      if (tile === TILE.WALL) {
        const wallMesh = new THREE.Mesh(wallGeo, wallMat);
        wallMesh.position.set(wx, WALL_H / 2, wz);
        mazeGroup.add(wallMesh);
        continue;
      }
      if (tile === TILE.BUTTON) {
        const wallMesh = new THREE.Mesh(wallGeo, buttonFrameMat);
        wallMesh.position.set(wx, WALL_H / 2, wz);
        mazeGroup.add(wallMesh);
        const dir = HEADING_DELTA[floor.button.facing];
        const panelGeo = dir.dx !== 0
          ? new THREE.BoxGeometry(0.06, 0.42, 0.42)
          : new THREE.BoxGeometry(0.42, 0.42, 0.06);
        const panelMat = new THREE.MeshStandardMaterial({ color: 0x7a2a24, emissive: 0x4a1008, emissiveIntensity: 1.0, roughness: 0.5 });
        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(wx + dir.dx * (CELL / 2 - 0.03), 1.2, wz + dir.dy * (CELL / 2 - 0.03));
        mazeGroup.add(panel);
        buttonMesh = panel;
        continue;
      }

      const f = new THREE.Mesh(floorGeo, floorTileMaterial(tile));
      f.rotation.x = -Math.PI / 2;
      f.position.set(wx, 0, wz);
      mazeGroup.add(f);
      const c = new THREE.Mesh(ceilGeo, ceilMat);
      c.rotation.x = Math.PI / 2;
      c.position.set(wx, WALL_H, wz);
      mazeGroup.add(c);

      if (tile === TILE.DOOR) {
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(wx, floor.door && floor.door.open ? doorOpenY : doorRestY, wz);
        door.userData.animState = floor.door && floor.door.open ? "done" : null;
        mazeGroup.add(door);
        doorMesh = door;
      }
    }
  }
}

// ---------- Game state ----------
let rng = makeRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
let now0 = performance.now();
let { floor, player } = initRun(now0, rng);
let visual = { x: player.x * CELL, z: player.y * CELL, yaw: headingToYaw(player.heading) };
let started = false;
let gameOver = false;
let win = false;

function headingToYaw(heading) { return -heading * (Math.PI / 4); }
function shortestAngleLerp(current, target, t) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

buildFloorMesh(floor);
camera.position.set(visual.x, EYE_H, visual.z);
camera.rotation.y = visual.yaw;

// ---------- UI ----------
const hudFloor = document.getElementById("floorLabel");
const hudWeapon = document.getElementById("weaponLabel");
const hpFill = document.getElementById("hpFill");
const hpText = document.getElementById("hpText");
const messageEl = document.getElementById("message");
const hitFlash = document.getElementById("hitFlash");
const titleOverlay = document.getElementById("titleOverlay");
const winOverlay = document.getElementById("winOverlay");
const deathOverlay = document.getElementById("deathOverlay");
const deathFloorEl = document.getElementById("deathFloor");

let messageTimer = null;
function showMessage(text, ms = 1400) {
  messageEl.textContent = text;
  messageEl.classList.add("show");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => messageEl.classList.remove("show"), ms);
}

function flashHit() {
  hitFlash.classList.add("show");
  setTimeout(() => hitFlash.classList.remove("show"), 160);
}

function updateHud() {
  hudFloor.textContent = `B${player.floorNumber}F / 目標 B${FLOOR_GOAL}F`;
  hudWeapon.textContent = player.weapon.name;
  const pct = Math.max(0, player.hp / player.maxHp) * 100;
  hpFill.style.width = `${pct}%`;
  hpText.textContent = `${Math.max(0, player.hp)}/${player.maxHp}`;
}

function endGame(reason) {
  gameOver = reason === "death";
  win = reason === "win";
  if (gameOver) {
    deathFloorEl.textContent = `B${player.floorNumber}F`;
    setTimeout(() => deathOverlay.classList.add("show"), 400);
  } else if (win) {
    setTimeout(() => winOverlay.classList.add("show"), 400);
  }
}

function startNewRun() {
  rng = makeRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  const t = performance.now();
  const r = initRun(t, rng);
  floor = r.floor;
  player = r.player;
  visual = { x: player.x * CELL, z: player.y * CELL, yaw: headingToYaw(player.heading) };
  buildFloorMesh(floor);
  gameOver = false;
  win = false;
  deathOverlay.classList.remove("show");
  winOverlay.classList.remove("show");
  updateHud();
}

// ---------- Movement / combat input ----------
function handleMoveEvent(result) {
  player = result.player;
  const event = result.event;
  if (event.type === "blocked" || event.type === "busy") return;
  if (event.type === "blockedByMonster") { showMessage("何かがいる!"); return; }
  if (event.type === "buttonPressed") {
    showMessage("ガコン…どこかで扉が開いた音がした");
    if (buttonMesh) { buttonMesh.material.color.set(0x3fd15a); buttonMesh.material.emissive.set(0x0a5c1c); }
    return;
  }
  if (event.type === "itemPickup") {
    if (event.kind === "potion") showMessage(`ポーションを見つけた (HP+${event.heal})`);
    else showMessage(`${event.weapon.name}を手に入れた!`);
    updateHud();
    return;
  }
  if (event.type === "reachStairs") {
    const t = performance.now();
    const d = descend(player, rng, t);
    player = d.player;
    if (d.event.type === "win") { endGame("win"); return; }
    floor = d.floor;
    buildFloorMesh(floor);
    visual = { x: player.x * CELL, z: player.y * CELL, yaw: headingToYaw(player.heading) };
    showMessage(`B${player.floorNumber}Fへ降りた`);
    updateHud();
    return;
  }
}

function doForward() {
  if (!started || gameOver || win) return;
  const result = attemptMove(player, floor, player.heading, performance.now());
  if (result.event.type === "blockedByMonster") { doAttack(); return; }
  handleMoveEvent(result);
}
function doBackward() {
  if (!started || gameOver || win) return;
  handleMoveEvent(attemptMove(player, floor, oppositeHeading(player.heading), performance.now()));
}
function doTurnLeft() {
  if (!started || gameOver || win) return;
  const now = performance.now();
  if (player.swingUntil && now < player.swingUntil) return;
  player = { ...player, heading: turnLeft(player.heading) };
}
function doTurnRight() {
  if (!started || gameOver || win) return;
  const now = performance.now();
  if (player.swingUntil && now < player.swingUntil) return;
  player = { ...player, heading: turnRight(player.heading) };
}
function doAttack() {
  if (!started || gameOver || win) return;
  startAttack(player, performance.now());
}

function bindTapButton(id, handler) {
  const el = document.getElementById(id);
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); handler(); });
}
bindTapButton("attackBtn", doAttack);

// ---------- Swipe controls (replaces the old d-pad) ----------
// Up = advance (bumping into a monster attacks it instead), down = step
// back, left/right = turn 45°. A short tap (below the distance threshold)
// is ignored so it doesn't fire an accidental move.
const SWIPE_THRESHOLD = 28;
let swipeStart = null;
canvas.addEventListener("pointerdown", (e) => {
  swipeStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", (e) => {
  if (!swipeStart || e.pointerId !== swipeStart.id) return;
  const dx = e.clientX - swipeStart.x;
  const dy = e.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) return;
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 0) doTurnRight(); else doTurnLeft();
  } else {
    if (dy < 0) doForward(); else doBackward();
  }
});
canvas.addEventListener("pointercancel", () => { swipeStart = null; });

document.getElementById("startBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  titleOverlay.classList.remove("show");
  started = true;
  updateHud();
});
document.getElementById("retryDeathBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  startNewRun();
});
document.getElementById("retryWinBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  startNewRun();
});

updateHud();

// ---------- Monster/item mesh sync ----------
const monsterMeshMap = new Map();
const itemMeshMap = new Map();
const deathFx = [];

function setMonsterFlash(mesh, on) {
  mesh.traverse((child) => {
    if (child.isMesh) child.material.emissiveIntensity = on ? 2.4 : child.userData.baseEmissive ?? 0.6;
  });
}

function createMonsterMesh(type) {
  const v = MONSTER_VISUALS[type];
  const mesh = v.create();
  mesh.traverse((child) => {
    if (child.isMesh) child.userData.baseEmissive = child.material.emissiveIntensity;
  });
  return mesh;
}

function syncMonsterMeshes(dt, now) {
  const liveIds = new Set(floor.monsters.map((m) => m.id));
  for (const [id, rec] of monsterMeshMap) {
    if (!liveIds.has(id)) { monsterGroup.remove(rec.mesh); monsterMeshMap.delete(id); }
  }
  const rate = 1 - Math.exp(-dt * 8);
  for (const m of floor.monsters) {
    let rec = monsterMeshMap.get(m.id);
    const v = MONSTER_VISUALS[m.type];
    if (!rec) {
      const mesh = createMonsterMesh(m.type);
      mesh.position.set(m.x * CELL, v.y, m.y * CELL);
      monsterGroup.add(mesh);
      rec = { mesh, vx: m.x * CELL, vz: m.y * CELL, flashUntil: 0, flashing: false };
      monsterMeshMap.set(m.id, rec);
    }
    rec.vx += (m.x * CELL - rec.vx) * rate;
    rec.vz += (m.y * CELL - rec.vz) * rate;
    rec.mesh.position.x = rec.vx;
    rec.mesh.position.z = rec.vz;
    const shouldFlash = now < rec.flashUntil;
    if (shouldFlash !== rec.flashing) { setMonsterFlash(rec.mesh, shouldFlash); rec.flashing = shouldFlash; }
  }
}

function syncItemMeshes(t) {
  const liveIds = new Set(floor.items.map((it) => it.id));
  for (const [id, rec] of itemMeshMap) {
    if (!liveIds.has(id)) { itemGroup.remove(rec.mesh); itemMeshMap.delete(id); }
  }
  for (const it of floor.items) {
    let rec = itemMeshMap.get(it.id);
    if (!rec) {
      const geo = it.kind === "potion" ? new THREE.SphereGeometry(0.15, 10, 8) : new THREE.OctahedronGeometry(0.18, 0);
      const mesh = new THREE.Mesh(geo, it.kind === "potion" ? potionMat : weaponMat);
      mesh.position.set(it.x * CELL, 1.0, it.y * CELL);
      itemGroup.add(mesh);
      rec = { mesh };
      itemMeshMap.set(it.id, rec);
    }
    rec.mesh.position.y = 1.0 + Math.sin(t * 0.003 + it.x * 1.7 + it.y) * 0.06;
    rec.mesh.rotation.y += 0.02;
  }
}

function triggerDeathFx(monsterId) {
  const rec = monsterMeshMap.get(monsterId);
  if (!rec) return;
  monsterMeshMap.delete(monsterId);
  deathFx.push({ mesh: rec.mesh, until: performance.now() + 300 });
}

function updateDeathFx(now) {
  for (let i = deathFx.length - 1; i >= 0; i--) {
    const fx = deathFx[i];
    const t = 1 - Math.max(0, fx.until - now) / 300;
    fx.mesh.scale.setScalar(Math.max(0.001, 1 - t));
    fx.mesh.position.y += 0.01;
    if (t >= 1) {
      monsterGroup.remove(fx.mesh);
      deathFx.splice(i, 1);
    }
  }
}

const DOOR_ANIM_MS = 700;
function updateDoorAnim(now) {
  if (!doorMesh || !floor.door || !floor.door.open) return;
  if (doorMesh.userData.animState === "done") return;
  if (!doorMesh.userData.animState) {
    doorMesh.userData.animState = "animating";
    doorMesh.userData.animStartT = now;
    doorMesh.userData.animFromY = doorMesh.position.y;
  }
  const p = Math.min(1, (now - doorMesh.userData.animStartT) / DOOR_ANIM_MS);
  const eased = 1 - Math.pow(1 - p, 3);
  doorMesh.position.y = doorMesh.userData.animFromY + (doorOpenY - doorMesh.userData.animFromY) * eased;
  if (p >= 1) doorMesh.userData.animState = "done";
}

// ---------- Render loop ----------
let lastT = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (started && !gameOver && !win) {
    const events = stepMonsters(floor, player, t, rng);
    for (const ev of events) {
      if (ev.type === "monsterAttack") { flashHit(); }
      else if (ev.type === "playerDefeated") { endGame("death"); }
    }
    if (player.swingUntil && t >= player.swingUntil) {
      const ev = finishAttack(player, floor, rng, t);
      if (ev.type === "attackHit") {
        const name = MONSTER_NAMES[ev.monsterType] || ev.monsterType;
        showMessage(ev.killed ? `${name}を倒した!` : `${ev.dmg}のダメージ!`, 900);
        if (ev.killed) triggerDeathFx(ev.monsterId);
        else { const rec = monsterMeshMap.get(ev.monsterId); if (rec) rec.flashUntil = t + 150; }
      }
    }
    updateHud();
  }

  const targetX = player.x * CELL, targetZ = player.y * CELL;
  const targetYaw = headingToYaw(player.heading);
  const posRate = 1 - Math.exp(-dt * 9);
  const rotRate = 1 - Math.exp(-dt * 10);
  visual.x += (targetX - visual.x) * posRate;
  visual.z += (targetZ - visual.z) * posRate;
  visual.yaw = shortestAngleLerp(visual.yaw, targetYaw, rotRate);

  let bob = 0;
  if (player.swingUntil) {
    const swingTotal = player.weapon.swingTime;
    const progress = 1 - Math.max(0, player.swingUntil - t) / swingTotal;
    bob = Math.sin(Math.min(1, progress) * Math.PI) * 0.1;
  }
  camera.position.set(visual.x, EYE_H - bob, visual.z);
  camera.rotation.y = visual.yaw;

  syncMonsterMeshes(dt, t);
  syncItemMeshes(t);
  updateDeathFx(t);
  updateDoorAnim(t);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
