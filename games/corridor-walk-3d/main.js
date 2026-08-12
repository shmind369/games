import * as THREE from "three";
import {
  clamp, computeQuadHomography, mapUnitToQuad, computeLocalScale,
  computeScreenForwardAngle, computeJoystickAxes, computeCharacterStep,
  imageFractionToViewportFraction,
} from "./floorMap.js";

// ---------- Floor calibration ----------
// The background photo (assets/room.jpg) is a corridor shot; this quad was
// hand-calibrated against it (see README) as [nearLeft, nearRight, farRight,
// farLeft] in fractions of the SOURCE IMAGE (not the viewport — the photo is
// shown with object-fit:cover, so imageFractionToViewportFraction() converts
// for whatever region actually ends up on screen).
const IMAGE_ASPECT = 900 / 1636;
const FLOOR_QUAD_IMAGE = [
  { x: 0.32, y: 0.98 }, // near-left
  { x: 0.80, y: 0.90 }, // near-right
  { x: 0.73, y: 0.60 }, // far-right
  { x: 0.50, y: 0.62 }, // far-left
];

const TURN_SPEED = 2.4; // rad/sec at full stick deflection
const MOVE_SPEED = 0.55; // floor-space units/sec at full stick deflection
const JOYSTICK_MAX_RADIUS = 70; // px

// ---------- Three.js scene (orthographic — the character's on-screen
// position/scale is driven directly by the floor-quad homography above, not
// by a simulated camera, so a flat orthographic projection keeps the model's
// own 3D shading/rotation without re-introducing a second, conflicting
// source of perspective). ----------
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(0, aspect, 1, 0, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xfff3e0, 0.85));
const key = new THREE.DirectionalLight(0xffe8c0, 0.9);
key.position.set(0.6, 1.5, 2);
scene.add(key);
const fill = new THREE.DirectionalLight(0x88aaff, 0.25);
fill.position.set(-1, 0.5, -1);
scene.add(fill);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  aspect = w / h;
  camera.right = aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- 5-6 head-tall placeholder humanoid ----------
function buildCharacter() {
  const headH = 0.2; // 1 "head unit"
  const skin = new THREE.MeshStandardMaterial({ color: 0xf0c090, roughness: 0.8 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x4a3527, roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x3f6fd1, roughness: 0.75 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x33384a, roughness: 0.8 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.6 });

  const group = new THREE.Group();

  const legLen = headH * 2.75;
  const hipY = legLen;
  const torsoLen = headH * 1.6;
  const shoulderY = hipY + torsoLen;
  const neckLen = headH * 0.15;
  const headR = headH * 0.5;
  const hipWidth = headH * 0.85;
  const shoulderWidth = headH * 1.05;

  // Legs: pivot at the hip so a walk cycle can swing them.
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

  // Torso
  const torsoGeo = new THREE.CapsuleGeometry(shoulderWidth * 0.42, torsoLen - shoulderWidth * 0.5, 4, 8);
  const torso = new THREE.Mesh(torsoGeo, shirt);
  torso.position.set(0, hipY + torsoLen / 2, 0);
  group.add(torso);

  // Neck + head
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

  // Arms: pivot at the shoulder so a walk cycle can swing them.
  const armLen = torsoLen * 0.95;
  const armGeo = new THREE.CapsuleGeometry(headH * 0.13, armLen - headH * 0.26, 4, 6);
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * shoulderWidth * 0.52, shoulderY - headH * 0.05, 0);
    const mesh = new THREE.Mesh(armGeo, skin);
    mesh.position.y = -armLen / 2;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  }
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  group.userData.totalHeight = shoulderY + neckLen + headR * 2;
  return { group, leftLeg, rightLeg, leftArm, rightArm };
}

const character = buildCharacter();
scene.add(character.group);

// ---------- Floor-space state & rendering ----------
const floorCoeffs = computeQuadHomography(FLOOR_QUAD_IMAGE);
const START_STATE = { u: 0.5, v: 0.05, heading: 0 };
let state = { ...START_STATE };
let walkCycle = 0;

function applyCharacterTransform() {
  const viewportFrac = imageFractionToViewportFraction(
    mapUnitToQuad(floorCoeffs, state.u, state.v),
    IMAGE_ASPECT,
    aspect,
  );
  const scale = computeLocalScale(floorCoeffs, state.u, state.v);
  const screenAngle = computeScreenForwardAngle(floorCoeffs, state.u, state.v, state.heading);

  const worldX = viewportFrac.x * aspect;
  const worldY = 1 - viewportFrac.y;
  const baseScale = 0.62 * scale;

  character.group.position.set(worldX, worldY, 0);
  character.group.scale.setScalar(baseScale);
  // Screen-space rotation: atan2 gives the angle from +X: convert to a
  // Y-axis model rotation so the character visually turns to face that
  // on-screen direction (subtracting 90deg since the model's own "forward"
  // faces -Z by construction, i.e. toward the camera at heading 0).
  character.group.rotation.y = -screenAngle + Math.PI / 2;
}

function updateWalkCycle(dt, moveAxis) {
  const speed = Math.abs(moveAxis);
  if (speed > 0.05) {
    walkCycle += dt * (6 + speed * 4);
  } else {
    walkCycle += (0 - (walkCycle % (Math.PI * 2) > Math.PI ? walkCycle - Math.PI * 2 : walkCycle)) * Math.min(1, dt * 6);
  }
  const swing = Math.sin(walkCycle) * Math.min(1, speed * 1.6) * 0.55;
  character.leftLeg.rotation.x = swing;
  character.rightLeg.rotation.x = -swing;
  character.leftArm.rotation.x = -swing * 0.8;
  character.rightArm.rotation.x = swing * 0.8;
}

applyCharacterTransform();

// ---------- Joystick input (drag-from-touch-start) ----------
const joystickArea = document.getElementById("joystickArea");
const stickEl = document.getElementById("stick");
let joystick = null; // { pointerId, startX, startY }
let axes = { turnAxis: 0, moveAxis: 0 };

function onPointerDown(evt) {
  if (joystick) return;
  joystick = { pointerId: evt.pointerId, startX: evt.clientX, startY: evt.clientY };
  stickEl.style.left = evt.clientX + "px";
  stickEl.style.top = evt.clientY + "px";
  stickEl.style.display = "block";
  stickEl.firstElementChild.style.transform = "translate(0px,0px)";
}
function onPointerMove(evt) {
  if (!joystick || evt.pointerId !== joystick.pointerId) return;
  axes = computeJoystickAxes(joystick.startX, joystick.startY, evt.clientX, evt.clientY, JOYSTICK_MAX_RADIUS);
  stickEl.firstElementChild.style.transform =
    `translate(${axes.turnAxis * (JOYSTICK_MAX_RADIUS * 0.55)}px, ${-axes.moveAxis * (JOYSTICK_MAX_RADIUS * 0.55)}px)`;
}
function onPointerUp(evt) {
  if (!joystick || evt.pointerId !== joystick.pointerId) return;
  joystick = null;
  axes = { turnAxis: 0, moveAxis: 0 };
  stickEl.style.display = "none";
}
joystickArea.addEventListener("pointerdown", onPointerDown);
joystickArea.addEventListener("pointermove", onPointerMove);
joystickArea.addEventListener("pointerup", onPointerUp);
joystickArea.addEventListener("pointercancel", onPointerUp);

document.getElementById("resetBtn").addEventListener("click", () => {
  state = { ...START_STATE };
  applyCharacterTransform();
});

// ---------- Render loop ----------
let lastT = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  state = computeCharacterStep(state, axes.turnAxis, axes.moveAxis, dt, TURN_SPEED, MOVE_SPEED);
  updateWalkCycle(dt, axes.moveAxis);
  applyCharacterTransform();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
