import * as THREE from "three";
import {
  TILE, FLOOR_GOAL, turnLeft, turnRight, oppositeHeading,
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

const wallMat = new THREE.MeshStandardMaterial({ color: 0x6a5b74, roughness: 0.85 });
const floorMat = new THREE.MeshStandardMaterial({ color: 0x433a4a, roughness: 0.9 });
const ceilMat = new THREE.MeshStandardMaterial({ color: 0x3a3143, roughness: 0.94, side: THREE.DoubleSide });
const stairsMat = new THREE.MeshStandardMaterial({ color: 0x1e6b66, roughness: 0.6, emissive: 0x0e3d3a, emissiveIntensity: 0.7 });
const potionMat = new THREE.MeshStandardMaterial({ color: 0xff5c6c, emissive: 0x991018, emissiveIntensity: 1.1, roughness: 0.4 });
const weaponMat = new THREE.MeshStandardMaterial({ color: 0x5cc8ff, emissive: 0x0d5a99, emissiveIntensity: 1.1, roughness: 0.35 });

const MONSTER_NAMES = { rat: "ネズミ", skeleton: "スケルトン", ogre: "オーガ" };

const MONSTER_VISUALS = {
  rat: { geo: () => new THREE.IcosahedronGeometry(0.17, 0), color: 0x8a6d4a, emissive: 0x2a1c0c, y: 0.18 },
  skeleton: { geo: () => new THREE.ConeGeometry(0.22, 0.62, 6), color: 0xdbe0c8, emissive: 0x2c2e22, y: 0.32 },
  ogre: { geo: () => new THREE.BoxGeometry(0.5, 0.9, 0.5), color: 0x7a2b2b, emissive: 0x3a0e0e, y: 0.46 },
};

const mazeGroup = new THREE.Group();
const monsterGroup = new THREE.Group();
const itemGroup = new THREE.Group();
scene.add(mazeGroup, monsterGroup, itemGroup);

function floorTileMaterial(tile) {
  return tile === TILE.STAIRS ? stairsMat : floorMat;
}

function buildFloorMesh(floor) {
  mazeGroup.clear();
  const floorGeo = new THREE.PlaneGeometry(CELL, CELL);
  const ceilGeo = new THREE.PlaneGeometry(CELL, CELL);
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);

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
      const f = new THREE.Mesh(floorGeo, floorTileMaterial(tile));
      f.rotation.x = -Math.PI / 2;
      f.position.set(wx, 0, wz);
      mazeGroup.add(f);
      const c = new THREE.Mesh(ceilGeo, ceilMat);
      c.rotation.x = Math.PI / 2;
      c.position.set(wx, WALL_H, wz);
      mazeGroup.add(c);
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

function createMonsterMesh(type) {
  const v = MONSTER_VISUALS[type];
  const mat = new THREE.MeshStandardMaterial({ color: v.color, emissive: v.emissive, emissiveIntensity: 0.6, roughness: 0.7 });
  const mesh = new THREE.Mesh(v.geo(), mat);
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
      rec = { mesh, vx: m.x * CELL, vz: m.y * CELL, flashUntil: 0 };
      monsterMeshMap.set(m.id, rec);
    }
    rec.vx += (m.x * CELL - rec.vx) * rate;
    rec.vz += (m.y * CELL - rec.vz) * rate;
    rec.mesh.position.x = rec.vx;
    rec.mesh.position.z = rec.vz;
    rec.mesh.material.emissiveIntensity = now < rec.flashUntil ? 2.4 : 0.6;
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

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
