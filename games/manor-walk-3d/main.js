import * as THREE from "three";
import {
  ROOMS, START_STATE, WALL_MARGIN, zoneAt, isInExitZone, integrateTankStep,
} from "./manor.js";

const MOVE_SPEED = 1.7; // units/sec
const TURN_SPEED = 2.1; // rad/sec
const WALL_H = 2.6;
const WALL_T = 0.2;

const ROOM_LABELS = { hall: "玄関ホール", corridor: "廊下", library: "書庫", study: "書斎" };

// Fixed cameras, one per room, authored by hand so each frames its room from
// inside the room's own footprint (below the ceiling) — a real cut, not a
// smoothed follow-cam, the way classic fixed-camera survival horror works.
const ZONE_CAMERAS = {
  hall: { pos: [2.7, 2.4, 5.5], look: [0, 1.0, 0.5] },
  corridor: { pos: [0.6, 2.2, 6.6], look: [0, 1.1, 11.5] },
  library: { pos: [-1.3, 2.6, 8.0], look: [-3.45, 1.0, 9.0] },
  study: { pos: [2.4, 2.2, 12.6], look: [-0.3, 1.1, 16.3] },
};

// ---------- Three.js scene ----------
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a0812, 8, 24);
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.05, 40);

scene.add(new THREE.HemisphereLight(0x7a6a88, 0x241c2c, 1.1));
scene.add(new THREE.AmbientLight(0x554466, 1.0));

function addLamp(x, y, z, color, intensity, distance) {
  const light = new THREE.PointLight(color, intensity, distance, 2);
  light.position.set(x, y, z);
  scene.add(light);
}
addLamp(0, 2.3, 3, 0xffcf94, 3.4, 9);
addLamp(0, 2.3, 9, 0xffcf94, 2.8, 8);
addLamp(-3.5, 2.3, 9, 0xd8b878, 2.6, 7);
addLamp(0, 2.3, 14.5, 0xffcf94, 3.0, 8);
const doorGlow = new THREE.PointLight(0x8fd6ff, 2.2, 6, 2);
doorGlow.position.set(0, 1.6, 16.7);
scene.add(doorGlow);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- Room geometry ----------
const floorMat = new THREE.MeshStandardMaterial({ color: 0x4a3c34, roughness: 0.95 });
const libraryFloorMat = new THREE.MeshStandardMaterial({ color: 0x40352e, roughness: 0.95 });
const ceilMat = new THREE.MeshStandardMaterial({ color: 0x2a2130, roughness: 1, side: THREE.DoubleSide });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x635046, roughness: 0.85 });
const doorMat = new THREE.MeshStandardMaterial({
  color: 0x2a4a5a, roughness: 0.4, emissive: 0x2f8fc9, emissiveIntensity: 1.3,
});

const worldGroup = new THREE.Group();
scene.add(worldGroup);

function addFloorCeil(room, mat) {
  const w = room.x1 - room.x0, d = room.z1 - room.z0;
  const cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  worldGroup.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, WALL_H, cz);
  worldGroup.add(ceil);
}

function addWallBox(x0, x1, z0, z1, mat = wallMat) {
  const w = x1 - x0, d = z1 - z0;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), mat);
  mesh.position.set((x0 + x1) / 2, WALL_H / 2, (z0 + z1) / 2);
  worldGroup.add(mesh);
}

addFloorCeil(ROOMS.hall, floorMat);
addFloorCeil(ROOMS.corridor, floorMat);
addFloorCeil(ROOMS.library, libraryFloorMat);
addFloorCeil(ROOMS.study, floorMat);

// Hall
addWallBox(-3, 3, -0.1, 0.1); // south
addWallBox(-3, -0.9, 5.9, 6.1); // north-left (doorway to corridor between)
addWallBox(0.9, 3, 5.9, 6.1); // north-right
addWallBox(-3.1, -2.9, 0, 6); // west
addWallBox(2.9, 3.1, 0, 6); // east

// Corridor
addWallBox(-1.0, -0.8, 6, 7.5); // west-south (doorway to library between)
addWallBox(-1.0, -0.8, 10.5, 12); // west-north
addWallBox(0.8, 1.0, 6, 12); // east

// Library
addWallBox(-6.1, -5.9, 7.5, 10.5); // west
addWallBox(-6, -0.9, 7.4, 7.6); // south
addWallBox(-6, -0.9, 10.4, 10.6); // north

// Study
addWallBox(-3, -0.9, 11.9, 12.1); // south-left (doorway to corridor between)
addWallBox(0.9, 3, 11.9, 12.1); // south-right
addWallBox(-3, -1, 16.9, 17.1); // north-left (exit door between)
addWallBox(1, 3, 16.9, 17.1); // north-right
addWallBox(-3.1, -2.9, 12, 17); // west
addWallBox(2.9, 3.1, 12, 17); // east
addWallBox(-1, 1, 16.85, 17.05, doorMat); // exit door

// A few plain box "furniture" silhouettes so rooms don't read as empty
// crates — purely decorative, no gameplay meaning.
function addProp(x, y, z, sx, sy, sz, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
  );
  mesh.position.set(x, y + sy / 2, z);
  worldGroup.add(mesh);
}
addProp(-2.3, 0, 1.2, 0.9, 0.75, 0.5, 0x3a2f28); // hall table
addProp(2.3, 0, 2.0, 0.6, 1.3, 1.6, 0x2e2620); // hall cabinet
addProp(-3.0, 0, 10.15, 2.8, 1.7, 0.3, 0x2a221c); // library shelf (against north wall)
addProp(-2.2, 0, 14.8, 0.8, 1.0, 0.7, 0x362b22); // study desk
addProp(2.2, 0, 13.4, 0.5, 1.5, 0.5, 0x2e2620); // study shelf

// ---------- Character (procedural humanoid, ~5.5 heads tall) ----------
function buildCharacter() {
  const headH = 0.32;
  const skin = new THREE.MeshStandardMaterial({ color: 0xdcae82, roughness: 0.85 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x2a2016, roughness: 0.7 });
  const coat = new THREE.MeshStandardMaterial({ color: 0x51413a, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2c2a30, roughness: 0.85 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x18161a, roughness: 0.6 });

  const group = new THREE.Group();

  const legLen = headH * 2.7;
  const hipY = legLen;
  const torsoLen = headH * 1.6;
  const shoulderY = hipY + torsoLen;
  const neckLen = headH * 0.15;
  const headR = headH * 0.5;
  const hipWidth = headH * 0.85;
  const shoulderWidth = headH * 1.05;

  const legGeo = new THREE.CapsuleGeometry(headH * 0.16, legLen - headH * 0.32, 4, 6);
  const footGeo = new THREE.BoxGeometry(headH * 0.32, headH * 0.12, headH * 0.5);
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * hipWidth * 0.5, hipY, 0);
    const mesh = new THREE.Mesh(legGeo, pants);
    mesh.position.y = -legLen / 2;
    pivot.add(mesh);
    const foot = new THREE.Mesh(footGeo, shoe);
    foot.position.set(0, -legLen + headH * 0.06, headH * 0.12);
    pivot.add(foot);
    group.add(pivot);
    return pivot;
  }
  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  const torsoGeo = new THREE.CapsuleGeometry(shoulderWidth * 0.42, torsoLen - shoulderWidth * 0.5, 4, 8);
  const torso = new THREE.Mesh(torsoGeo, coat);
  torso.position.set(0, hipY + torsoLen / 2, 0);
  group.add(torso);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(headH * 0.14, headH * 0.16, neckLen, 8), skin);
  neck.position.set(0, shoulderY + neckLen / 2, 0);
  group.add(neck);

  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(headR, 16, 12), skin);
  headMesh.position.set(0, shoulderY + neckLen + headR, 0);
  group.add(headMesh);

  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.05, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
  hairCap.position.copy(headMesh.position);
  hairCap.position.y += headR * 0.08;
  group.add(hairCap);

  const armLen = torsoLen * 0.95;
  const armGeo = new THREE.CapsuleGeometry(headH * 0.13, armLen - headH * 0.26, 4, 6);
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * shoulderWidth * 0.52, shoulderY - headH * 0.05, 0);
    const mesh = new THREE.Mesh(armGeo, coat);
    mesh.position.y = -armLen / 2;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  }
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  return { group, leftLeg, rightLeg, leftArm, rightArm };
}

const character = buildCharacter();
scene.add(character.group);

// ---------- Game state ----------
let state = { ...START_STATE };
let currentZone = zoneAt(state.x, state.z);
let goalReached = false;
let started = false;
let walkCycle = 0;

function applyCharacterTransform() {
  character.group.position.set(state.x, 0, state.z);
  character.group.rotation.y = state.heading;
}

function updateWalkCycle(dt, moving) {
  if (moving) {
    walkCycle += dt * 7.5;
  }
  const swing = moving ? Math.sin(walkCycle) * 0.55 : 0;
  character.leftLeg.rotation.x = swing;
  character.rightLeg.rotation.x = -swing;
  character.leftArm.rotation.x = -swing * 0.8;
  character.rightArm.rotation.x = swing * 0.8;
}

function applyZoneCamera(zoneId) {
  const cam = ZONE_CAMERAS[zoneId];
  camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
  camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
}

applyCharacterTransform();
applyZoneCamera(currentZone);

// ---------- UI ----------
const roomLabelEl = document.getElementById("roomLabel");
const messageEl = document.getElementById("message");
const titleOverlay = document.getElementById("titleOverlay");
const goalOverlay = document.getElementById("goalOverlay");

let messageTimer = null;
function showMessage(text, ms = 1800) {
  messageEl.textContent = text;
  messageEl.classList.add("show");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => messageEl.classList.remove("show"), ms);
}

function resetGame() {
  state = { ...START_STATE };
  currentZone = zoneAt(state.x, state.z);
  goalReached = false;
  applyCharacterTransform();
  applyZoneCamera(currentZone);
  roomLabelEl.textContent = ROOM_LABELS[currentZone];
  goalOverlay.classList.remove("show");
}

// ---------- Tank-control D-pad (hold-to-move/turn) ----------
const input = { forward: false, backward: false, turnLeft: false, turnRight: false };
function bindHoldButton(id, key) {
  const el = document.getElementById(id);
  const press = (e) => { e.preventDefault(); input[key] = true; el.classList.add("pressed"); };
  const release = (e) => { if (e) e.preventDefault(); input[key] = false; el.classList.remove("pressed"); };
  el.addEventListener("pointerdown", press);
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("pointerleave", release);
}
bindHoldButton("btnForward", "forward");
bindHoldButton("btnBackward", "backward");
bindHoldButton("btnTurnLeft", "turnLeft");
bindHoldButton("btnTurnRight", "turnRight");

document.getElementById("startBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  titleOverlay.classList.remove("show");
  started = true;
});
document.getElementById("retryBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  resetGame();
  started = true;
});

// ---------- Render loop ----------
let lastT = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (started && !goalReached) {
    state = integrateTankStep(state, input, dt, MOVE_SPEED, TURN_SPEED);
    const moving = input.forward || input.backward;
    updateWalkCycle(dt, moving);
    applyCharacterTransform();

    const zone = zoneAt(state.x, state.z);
    if (zone !== currentZone) {
      currentZone = zone;
      applyZoneCamera(currentZone);
      roomLabelEl.textContent = ROOM_LABELS[currentZone];
    }

    if (isInExitZone(state.x, state.z)) {
      goalReached = true;
      showMessage("扉にたどり着いた");
      setTimeout(() => goalOverlay.classList.add("show"), 700);
    }
  }

  doorGlow.intensity = 2.0 + Math.sin(t * 0.0022) * 0.4;

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
