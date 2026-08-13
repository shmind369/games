import * as THREE from "three";
import {
  TILE, parseFloor, tileAt, countItems, turnLeft, turnRight, oppositeHeading,
  createInitialState, attemptMove, facingSecret, attemptSearch,
} from "./maze.js";

// ---------- Level data ----------
const FLOOR1_ROWS = [
  "#########",
  "#S..#...#",
  "#.#.#.#.#",
  "#.#...#.#",
  "#.#####.#",
  "#.......#",
  "#.#####.#",
  "#I....I.#",
  "#####U###",
];
const FLOOR2_ROWS = [
  "#########",
  "#D..#...#",
  "#.#.#.#.#",
  "#.....#.#",
  "#.#X###.#",
  "#.#I###.#",
  "#.#####.#",
  "#I....R.#",
  "#########",
];

function freshFloors() {
  return [parseFloor(FLOOR1_ROWS), parseFloor(FLOOR2_ROWS)];
}

// ---------- Three.js scene ----------
const CELL = 2.2;
const WALL_H = 2.6;
const EYE_H = 1.5;

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x1c2338, 7, 22);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 40);

scene.add(new THREE.HemisphereLight(0x8fa3c8, 0x2a2e3c, 0.5));
scene.add(new THREE.AmbientLight(0x445a77, 0.85));
const torch = new THREE.PointLight(0xffe3b0, 2.2, 12, 1.6);
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

const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a5570, roughness: 0.85 });
const floorMat = new THREE.MeshStandardMaterial({ color: 0x30333f, roughness: 0.9 });
const ceilMat = new THREE.MeshStandardMaterial({ color: 0x363b4c, roughness: 0.95, side: THREE.DoubleSide });
const stairsMat = new THREE.MeshStandardMaterial({ color: 0x1e6b66, roughness: 0.6, emissive: 0x0e3d3a, emissiveIntensity: 0.6 });
const doorMat = new THREE.MeshStandardMaterial({ color: 0x7a5320, roughness: 0.6, emissive: 0x3a2200, emissiveIntensity: 0.7 });
const itemMat = new THREE.MeshStandardMaterial({ color: 0xffd35c, emissive: 0x996a00, emissiveIntensity: 1.1, roughness: 0.4 });

const mazeGroup = new THREE.Group();
scene.add(mazeGroup);
let itemMeshes = [];

function floorTileMaterial(tile) {
  if (tile === TILE.STAIRS_UP || tile === TILE.STAIRS_DOWN) return stairsMat;
  if (tile === TILE.ROOF_DOOR) return doorMat;
  return floorMat;
}

function buildFloorMesh(floorIndex) {
  mazeGroup.clear();
  itemMeshes = [];
  const floor = floors[floorIndex];
  const floorGeo = new THREE.PlaneGeometry(CELL, CELL);
  const ceilGeo = new THREE.PlaneGeometry(CELL, CELL);
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
  const itemGeo = new THREE.OctahedronGeometry(0.16, 0);

  for (let y = 0; y < floor.height; y++) {
    for (let x = 0; x < floor.width; x++) {
      const tile = floor.grid[y][x];
      const wx = x * CELL, wz = y * CELL;
      if (tile === TILE.WALL || tile === TILE.SECRET) {
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
      if (tile === TILE.ITEM) {
        const item = new THREE.Mesh(itemGeo, itemMat);
        item.position.set(wx, 1.0, wz);
        item.userData = { x, y, baseY: 1.0 };
        mazeGroup.add(item);
        itemMeshes.push(item);
      }
    }
  }
}

// ---------- Game state ----------
let floors = freshFloors();
let state = createInitialState(floors);
let visual = { x: state.x * CELL, z: state.y * CELL, yaw: headingToYaw(state.heading) };
let started = false;

function headingToYaw(heading) { return -heading * (Math.PI / 2); }

function shortestAngleLerp(current, target, t) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

buildFloorMesh(state.floorIndex);
camera.position.set(visual.x, EYE_H, visual.z);
camera.rotation.y = visual.yaw;

// ---------- UI ----------
const hudFloor = document.getElementById("floorLabel");
const hudItems = document.getElementById("itemLabel");
const messageEl = document.getElementById("message");
const searchBtn = document.getElementById("searchBtn");
const titleOverlay = document.getElementById("titleOverlay");
const winOverlay = document.getElementById("winOverlay");

let messageTimer = null;
function showMessage(text, ms = 1600) {
  messageEl.textContent = text;
  messageEl.classList.add("show");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => messageEl.classList.remove("show"), ms);
}

function updateHud() {
  hudFloor.textContent = state.floorIndex === 0 ? "1F" : "2F";
  hudItems.textContent = `アイテム ${state.itemsCollected}/${state.totalItems}`;
  searchBtn.classList.toggle("show", started && !state.win && facingSecret(state, floors));
}

function handleEvent(event) {
  if (event.type === "blocked") return;
  if (event.type === "collected") showMessage("鍵を手に入れた!");
  else if (event.type === "floorChange") {
    buildFloorMesh(state.floorIndex);
    // Snap the smoothed camera instantly to the new floor's position: the
    // two floors share the same grid coordinate space, so without this the
    // lerp would ease the camera FROM its old-floor coordinates through
    // whatever new-floor geometry happens to occupy that same spot first
    // (often a solid wall cell), producing a jarring flash of being
    // "inside" a wall for a few frames before it catches up.
    visual = { x: state.x * CELL, z: state.y * CELL, yaw: headingToYaw(state.heading) };
    showMessage(state.floorIndex === 1 ? "2階に上がった" : "1階に戻った");
  } else if (event.type === "locked") showMessage(`扉には鍵が必要だ (${event.have}/${event.need})`);
  else if (event.type === "win") {
    showMessage("屋上への扉が開いた!");
    setTimeout(() => winOverlay.classList.add("show"), 500);
  }
  updateHud();
}

function doForward() {
  if (!started || state.win) return;
  const r = attemptMove(state, floors);
  state = r.state;
  handleEvent(r.event);
}
function doBackward() {
  if (!started || state.win) return;
  const r = attemptMove(state, floors, oppositeHeading(state.heading));
  state = r.state;
  handleEvent(r.event);
}
function doTurnLeft() {
  if (!started || state.win) return;
  state = { ...state, heading: turnLeft(state.heading) };
  updateHud();
}
function doTurnRight() {
  if (!started || state.win) return;
  state = { ...state, heading: turnRight(state.heading) };
  updateHud();
}
function doSearch() {
  if (!started || state.win) return;
  const r = attemptSearch(state, floors);
  if (r.event.type === "revealed") {
    buildFloorMesh(state.floorIndex);
    showMessage("怪しい壁だ…隠し通路を見つけた!");
  }
  updateHud();
}

function bindTapButton(id, handler) {
  const el = document.getElementById(id);
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); handler(); });
}
bindTapButton("btnForward", doForward);
bindTapButton("btnBackward", doBackward);
bindTapButton("btnTurnLeft", doTurnLeft);
bindTapButton("btnTurnRight", doTurnRight);
bindTapButton("searchBtn", doSearch);

document.getElementById("startBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  titleOverlay.classList.remove("show");
  started = true;
  updateHud();
});
document.getElementById("retryBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  floors = freshFloors();
  state = createInitialState(floors);
  visual = { x: state.x * CELL, z: state.y * CELL, yaw: headingToYaw(state.heading) };
  buildFloorMesh(state.floorIndex);
  winOverlay.classList.remove("show");
  updateHud();
});

updateHud();

// ---------- Render loop ----------
let lastT = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  const targetX = state.x * CELL, targetZ = state.y * CELL;
  const targetYaw = headingToYaw(state.heading);
  const posRate = 1 - Math.exp(-dt * 9);
  const rotRate = 1 - Math.exp(-dt * 10);
  visual.x += (targetX - visual.x) * posRate;
  visual.z += (targetZ - visual.z) * posRate;
  visual.yaw = shortestAngleLerp(visual.yaw, targetYaw, rotRate);

  camera.position.set(visual.x, EYE_H, visual.z);
  camera.rotation.y = visual.yaw;

  for (const item of itemMeshes) {
    item.position.y = item.userData.baseY + Math.sin(t * 0.003 + item.userData.x * 1.7 + item.userData.y) * 0.06;
    item.rotation.y += dt * 1.4;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
