import * as THREE from "three";

// ---------- Scope ----------
// A whip simulated purely through physics (Position Based Dynamics /
// Verlet integration over a mass-tapered particle chain) — not a scripted
// "crack" animation. The core physical mechanism that produces a real
// whip crack is mass tapering: each segment toward the tip is lighter
// than the one before it, so as momentum imparted at the root propagates
// segment-to-segment through the distance constraints, conservation of
// momentum forces the lighter segments to move faster. That's the entire
// trick — there is no hand-authored "wave" logic anywhere in this file.

// ---------- Tunable parameters (live-adjustable via the settings panel) ----------
const params = {
  stiffness: 0.95, // per-iteration distance-constraint correction factor (0..1)
  damping: 0.02, // global per-step velocity retention loss (0..1)
  massRatio: 0.06, // tip mass / root mass (smaller = more dramatic taper -> sharper crack)
  segments: 28, // number of segments (20..40 per spec); nodes = segments + 1
  airResistance: 0.03, // quadratic air-drag coefficient
};

const TOTAL_LENGTH = 2.4; // world units, held constant across segment-count changes
const CONSTRAINT_ITERATIONS = 14;
const FIXED_DT = 1 / 120; // fixed physics timestep for PBD stability
const MAX_SUBSTEPS_PER_FRAME = 8; // guards against a spiral of death after a stall
const GRAVITY = new THREE.Vector3(0, -9.8, 0);
const ROOT_ANCHOR = new THREE.Vector3(0, 1.1, 0);
const MAX_DRAG_DISTANCE = 1.1; // world units; caps how far a single flick can stretch the grip

// ---------- Pure physics (no THREE/DOM dependency — directly unit testable) ----------
// Tapered mass: t=0 at the root, t=1 at the tip. mass = massRatio^t, so the
// root always has mass 1 and the tip has mass `massRatio` (< 1 = lighter).
function taperedMass(index, segmentCount, massRatio) {
  const t = index / segmentCount;
  return Math.pow(massRatio, t);
}

// Standard PBD distance-constraint solve, operating on plain numbers so it
// has no THREE.js dependency and is trivial to unit test in isolation.
function solveDistanceConstraint(ax, ay, az, invMassA, bx, by, bz, invMassB, restLength, stiffness) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  const wSum = invMassA + invMassB;
  if (dist < 1e-9 || wSum < 1e-9) {
    return { ax, ay, az, bx, by, bz };
  }
  const diff = ((dist - restLength) / dist) * stiffness;
  const corrA = (invMassA / wSum) * diff;
  const corrB = (invMassB / wSum) * diff;
  return {
    ax: ax + dx * corrA,
    ay: ay + dy * corrA,
    az: az + dz * corrA,
    bx: bx - dx * corrB,
    by: by - dy * corrB,
    bz: bz - dz * corrB,
  };
}

// ---------- Whip chain (Verlet particles + distance constraints) ----------
class WhipChain {
  constructor(segmentCount, totalLength, rootPos) {
    this.rebuild(segmentCount, totalLength, rootPos);
  }

  rebuild(segmentCount, totalLength, rootPos) {
    this.n = segmentCount;
    this.restLength = totalLength / segmentCount;
    this.nodes = [];
    for (let i = 0; i <= this.n; i++) {
      const pos = rootPos.clone();
      pos.y -= i * this.restLength;
      this.nodes.push({
        pos: pos.clone(),
        prev: pos.clone(),
        naturalInvMass: 1 / taperedMass(i, this.n, params.massRatio),
        invMass: 0,
      });
    }
    this.rootKinematic = true;
    this.applyRootMode();
  }

  // Re-derive every node's natural (non-kinematic) inverse mass from the
  // current massRatio slider, without disturbing positions/velocities.
  refreshMasses() {
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].naturalInvMass = 1 / taperedMass(i, this.n, params.massRatio);
    }
    this.applyRootMode();
  }

  applyRootMode() {
    this.nodes[0].invMass = this.rootKinematic ? 0 : this.nodes[0].naturalInvMass;
    for (let i = 1; i < this.nodes.length; i++) {
      this.nodes[i].invMass = this.nodes[i].naturalInvMass;
    }
  }

  // Called at most once per physics substep while dragging: shifts `prev`
  // to the position the root had a moment ago before moving it, so
  // (pos - prev) always encodes the true one-substep drag velocity —
  // including on the very last call before release.
  setRootPosition(target) {
    const root = this.nodes[0];
    root.prev.copy(root.pos);
    root.pos.copy(target);
  }

  // Re-pin the root at a new grip point and kill any residual velocity it
  // was carrying (used when the player grabs the whip again after a flick).
  regrip(target) {
    this.rootKinematic = true;
    const root = this.nodes[0];
    root.pos.copy(target);
    root.prev.copy(target);
    this.applyRootMode();
  }

  // Un-pin the root. Deliberately does NOT touch root.prev: that history
  // already encodes the drag's last-moment velocity, and Verlet
  // integration will carry it forward on its own from here.
  release() {
    this.rootKinematic = false;
    this.applyRootMode();
  }

  step(dt) {
    for (const node of this.nodes) {
      if (node.invMass === 0) continue; // kinematic root: position is set externally
      const vx = (node.pos.x - node.prev.x) * (1 - params.damping);
      const vy = (node.pos.y - node.prev.y) * (1 - params.damping);
      const vz = (node.pos.z - node.prev.z) * (1 - params.damping);
      const speed = Math.hypot(vx, vy, vz);
      const dragX = -params.airResistance * vx * speed;
      const dragY = -params.airResistance * vy * speed;
      const dragZ = -params.airResistance * vz * speed;
      const nx = node.pos.x + vx + (GRAVITY.x + dragX) * dt * dt;
      const ny = node.pos.y + vy + (GRAVITY.y + dragY) * dt * dt;
      const nz = node.pos.z + vz + (GRAVITY.z + dragZ) * dt * dt;
      node.prev.set(node.pos.x, node.pos.y, node.pos.z);
      node.pos.set(nx, ny, nz);
    }

    for (let iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
      for (let i = 0; i < this.n; i++) {
        const a = this.nodes[i];
        const b = this.nodes[i + 1];
        const r = solveDistanceConstraint(
          a.pos.x, a.pos.y, a.pos.z, a.invMass,
          b.pos.x, b.pos.y, b.pos.z, b.invMass,
          this.restLength, params.stiffness
        );
        a.pos.set(r.ax, r.ay, r.az);
        b.pos.set(r.bx, r.by, r.bz);
      }
    }
  }

  speedAt(index, dt) {
    const n = this.nodes[index];
    return Math.hypot((n.pos.x - n.prev.x) / dt, (n.pos.y - n.prev.y) / dt, (n.pos.z - n.prev.z) / dt);
  }

  get tipIndex() {
    return this.n;
  }
}

// ---------- Scene setup ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0f16);
scene.fog = new THREE.Fog(0x0c0f16, 8, 34);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
const CAMERA_INITIAL_TARGET = new THREE.Vector3(0, -0.3, 0);
const CAMERA_INITIAL_POS = new THREE.Vector3(0, 0.9, 6.4);
camera.position.copy(CAMERA_INITIAL_POS);
camera.lookAt(CAMERA_INITIAL_TARGET);

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

// ---------- Auto-framing camera ----------
// Dollies the (fixed-direction) camera in/out each frame so the whip's
// current bounding sphere always fits inside the view frustum, instead of
// letting a fast crack fling the tip off camera. Zooming OUT happens
// instantly (never lets the whip clip out of frame, even for one frame);
// zooming back IN happens gradually once it's safe, for a smooth dolly
// feel rather than jarring snaps.
const CAMERA_MARGIN = 1.25;
const CAMERA_ZOOM_IN_LERP = 0.06;
const cameraDir = CAMERA_INITIAL_POS.clone().sub(CAMERA_INITIAL_TARGET).normalize();
const MIN_CAMERA_DISTANCE = CAMERA_INITIAL_POS.distanceTo(CAMERA_INITIAL_TARGET);
const MAX_CAMERA_DISTANCE = 40;
let cameraDistance = MIN_CAMERA_DISTANCE;
const cameraTarget = CAMERA_INITIAL_TARGET.clone();
const _boundsCenter = new THREE.Vector3();

function updateCameraFraming() {
  _boundsCenter.set(0, 0, 0);
  for (const node of chain.nodes) _boundsCenter.add(node.pos);
  _boundsCenter.divideScalar(chain.nodes.length);

  let maxRadius = 0;
  for (const node of chain.nodes) {
    const d = node.pos.distanceTo(_boundsCenter);
    if (d > maxRadius) maxRadius = d;
  }

  const halfVFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const halfHFov = Math.atan(Math.tan(halfVFov) * camera.aspect);
  const tightHalfFov = Math.min(halfVFov, halfHFov);
  const requiredDistance = THREE.MathUtils.clamp(
    (maxRadius * CAMERA_MARGIN) / Math.sin(tightHalfFov),
    MIN_CAMERA_DISTANCE,
    MAX_CAMERA_DISTANCE
  );

  cameraDistance = requiredDistance > cameraDistance
    ? requiredDistance
    : THREE.MathUtils.lerp(cameraDistance, requiredDistance, CAMERA_ZOOM_IN_LERP);

  // The target must exactly track the bounding sphere's true center (no
  // smoothing lag here) — the distance formula above only guarantees
  // containment if the camera is actually looking at that center. Physics
  // motion is already continuous frame-to-frame, so this reads as smooth.
  cameraTarget.copy(_boundsCenter);
  camera.position.copy(cameraTarget).addScaledVector(cameraDir, cameraDistance);
  camera.lookAt(cameraTarget);
}

scene.add(new THREE.AmbientLight(0x8fa8ff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(4, 6, 5);
scene.add(sun);

const grip = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 14, 14),
  new THREE.MeshStandardMaterial({ color: 0x3a6bd8 })
);
scene.add(grip);

const tipMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.035, 10, 10),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
scene.add(tipMarker);

// ---------- Whip chain + tapered-cylinder rendering ----------
let chain = new WhipChain(params.segments, TOTAL_LENGTH, ROOT_ANCHOR);
let segmentMeshes = [];

function buildSegmentMeshes() {
  for (const m of segmentMeshes) {
    scene.remove(m);
    m.geometry.dispose();
  }
  segmentMeshes = [];
  const material = new THREE.MeshStandardMaterial({ color: 0xd9a35a });
  for (let i = 0; i < chain.n; i++) {
    const t0 = i / chain.n;
    const t1 = (i + 1) / chain.n;
    const r0 = THREE.MathUtils.lerp(0.05, 0.006, t0);
    const r1 = THREE.MathUtils.lerp(0.05, 0.006, t1);
    const geo = new THREE.CylinderGeometry(r1, r0, 1, 8, 1);
    const mesh = new THREE.Mesh(geo, material);
    scene.add(mesh);
    segmentMeshes.push(mesh);
  }
}
buildSegmentMeshes();

const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

function updateSegmentMeshes() {
  for (let i = 0; i < chain.n; i++) {
    const a = chain.nodes[i].pos;
    const b = chain.nodes[i + 1].pos;
    const mesh = segmentMeshes[i];
    _mid.copy(a).add(b).multiplyScalar(0.5);
    _dir.copy(b).sub(a);
    const segLen = _dir.length();
    mesh.position.copy(_mid);
    if (segLen > 1e-6) {
      _dir.normalize();
      _quat.setFromUnitVectors(_up, _dir);
      mesh.quaternion.copy(_quat);
      mesh.scale.set(1, segLen, 1);
    }
  }
  grip.position.copy(chain.nodes[0].pos);
  tipMarker.position.copy(chain.nodes[chain.tipIndex].pos);
}

// ---------- Input: drag on a camera-facing plane through the root ----------
const raycaster = new THREE.Raycaster();
const dragPlane = new THREE.Plane();
let latestTarget = ROOT_ANCHOR.clone();
let dragging = false;
let pointerId = null;

function screenToDragPlane(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const point = new THREE.Vector3();
  raycaster.ray.intersectPlane(dragPlane, point);
  return point || latestTarget.clone();
}

let dragOrigin = new THREE.Vector3();

renderer.domElement.addEventListener("pointerdown", (e) => {
  pointerId = e.pointerId;
  const normal = new THREE.Vector3();
  camera.getWorldDirection(normal);
  dragPlane.setFromNormalAndCoplanarPoint(normal, chain.nodes[0].pos);
  const target = screenToDragPlane(e.clientX, e.clientY);
  chain.regrip(target);
  dragOrigin.copy(target);
  latestTarget.copy(target);
  dragging = true;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (e.pointerId !== pointerId || !dragging) return;
  const raw = screenToDragPlane(e.clientX, e.clientY);
  // Cap how far the grip can be dragged from where it was grabbed. This
  // bounds how much energy a single flick can inject (a real arm has
  // limited reach too) and keeps the whip from launching clean off camera.
  const offset = raw.clone().sub(dragOrigin);
  if (offset.length() > MAX_DRAG_DISTANCE) {
    offset.setLength(MAX_DRAG_DISTANCE);
  }
  latestTarget.copy(dragOrigin).add(offset);
});
function endDrag(e) {
  if (e.pointerId !== pointerId || !dragging) return;
  dragging = false;
  pointerId = null;
  chain.release();
}
renderer.domElement.addEventListener("pointerup", endDrag);
renderer.domElement.addEventListener("pointercancel", endDrag);

// ---------- Settings panel wiring ----------
const settingsToggle = document.getElementById("settingsToggle");
const settingsPanel = document.getElementById("settingsPanel");
settingsToggle.addEventListener("click", () => settingsPanel.classList.toggle("show"));

function bindSlider(id, onChange) {
  const el = document.getElementById(id);
  const valEl = document.getElementById(`${id}Val`);
  el.value = params[id];
  valEl.textContent = String(params[id]);
  el.addEventListener("input", () => {
    const v = parseFloat(el.value);
    valEl.textContent = el.step.includes(".") ? v.toFixed(2) : String(v);
    onChange(v);
  });
}
bindSlider("stiffness", (v) => { params.stiffness = v; });
bindSlider("damping", (v) => { params.damping = v; });
bindSlider("massRatio", (v) => { params.massRatio = v; chain.refreshMasses(); });
bindSlider("airResistance", (v) => { params.airResistance = v; });
bindSlider("segments", (v) => {
  params.segments = Math.round(v);
  chain = new WhipChain(params.segments, TOTAL_LENGTH, chain.nodes[0].pos.clone());
  buildSegmentMeshes();
});

document.getElementById("resetBtn").addEventListener("click", () => {
  chain = new WhipChain(params.segments, TOTAL_LENGTH, ROOT_ANCHOR);
  buildSegmentMeshes();
});

// ---------- Main loop (fixed-timestep physics substeps) ----------
const tipSpeedEl = document.getElementById("tipSpeed");
let lastTime = performance.now();
let accumulator = 0;

function loop(now) {
  let frameDt = (now - lastTime) / 1000;
  lastTime = now;
  frameDt = Math.min(frameDt, MAX_SUBSTEPS_PER_FRAME * FIXED_DT);
  accumulator += frameDt;

  let substeps = 0;
  while (accumulator >= FIXED_DT && substeps < MAX_SUBSTEPS_PER_FRAME) {
    if (dragging) chain.setRootPosition(latestTarget);
    chain.step(FIXED_DT);
    accumulator -= FIXED_DT;
    substeps += 1;
  }

  updateSegmentMeshes();
  const tipSpeed = chain.speedAt(chain.tipIndex, FIXED_DT);
  tipSpeedEl.textContent = tipSpeed.toFixed(1);

  updateCameraFraming();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
