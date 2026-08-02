import * as THREE from "three";

// ---------- Table geometry ----------
// Everything lives on the XZ plane (a flat, tilted playfield seen from
// above at an angle); Y is only used for visual height. -Z is "up the
// table" (away from the player), +Z is "down" toward the flippers/drain.
const TABLE_LEFT = -6;
const TABLE_RIGHT = 6.6;
const TABLE_TOP = -16;
const TABLE_BOTTOM = 6.2;
const LANE_X = 5; // divider wall separating the right plunger lane
const LANE_TOP = -12; // divider stops short of the top wall so the ball
                       // can flow from the lane into the main field
const DRAIN_Z = 6.6; // past this, the ball is lost

const BALL_RADIUS = 0.32;
const GRAVITY_Z = 15; // "downhill" acceleration toward the player
const DAMPING = 0.999;
const MAX_SPEED = 32; // must stay >= LAUNCH_MAX_SPEED or every launch gets clipped
const WALL_RESTITUTION = 0.65;
const BUMPER_KICK_SPEED = 11;
const FLIP_KICK_SPEED = 15;
const FLIP_KICK_UP_BOOST = 6;

// ---------- Scene setup ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05050a);
scene.fog = new THREE.Fog(0x05050a, 18, 34);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 15, 11);
camera.lookAt(0, 0, -3);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// visualViewport catches iOS Safari's address-bar show/hide, which doesn't
// always fire a plain window "resize" event promptly.
function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", handleResize);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", handleResize);
}

scene.add(new THREE.AmbientLight(0x8899ff, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(6, 16, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

// Playfield
const floorGeo = new THREE.PlaneGeometry(TABLE_RIGHT - TABLE_LEFT, TABLE_BOTTOM - TABLE_TOP);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x0e1230, roughness: 0.85 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.set(
  (TABLE_LEFT + TABLE_RIGHT) / 2,
  0,
  (TABLE_TOP + TABLE_BOTTOM) / 2
);
floor.receiveShadow = true;
scene.add(floor);

// ---------- Walls (straight capsule segments) ----------
// Each wall is {x1,z1,x2,z2,thickness}. Collision + rendering both derive
// from this single list so visuals and physics can never drift apart.
const walls = [
  { x1: TABLE_LEFT, z1: TABLE_TOP, x2: TABLE_LEFT, z2: TABLE_BOTTOM, thickness: 0.4 },
  { x1: TABLE_RIGHT, z1: TABLE_TOP, x2: TABLE_RIGHT, z2: TABLE_BOTTOM, thickness: 0.2 },
  { x1: TABLE_LEFT, z1: TABLE_TOP, x2: TABLE_RIGHT, z2: TABLE_TOP, thickness: 0.4 },
  { x1: LANE_X, z1: LANE_TOP, x2: LANE_X, z2: TABLE_BOTTOM, thickness: 0.2 },
  // short guide nudging balls away from the dead bottom-left corner
  { x1: TABLE_LEFT, z1: 4.6, x2: -3.5, z2: 6.3, thickness: 0.3 },
  // deflector above the lane: redirects a launched ball leftward into the
  // main field. Natural angle-of-incidence reflection here wasn't reliable
  // (the ball just fell back into the lane before clearing it), so this
  // one gives a fixed kick instead, like the flippers and bumpers do.
  {
    x1: 5.9, z1: LANE_TOP - 0.6, x2: 2, z2: -15.5, thickness: 0.3,
    kick: { vx: -13, vz: 3 },
  },
];

const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4270, roughness: 0.5 });
for (const w of walls) {
  const dx = w.x2 - w.x1;
  const dz = w.z2 - w.z1;
  const len = Math.hypot(dx, dz);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(len, 1.1, w.thickness),
    wallMat
  );
  mesh.position.set((w.x1 + w.x2) / 2, 0.55, (w.z1 + w.z2) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// ---------- Bumpers ----------
const bumpers = [
  { x: -2.6, z: -9, radius: 0.85 },
  { x: 2.6, z: -9, radius: 0.85 },
  { x: 0, z: -12, radius: 0.85 },
].map((b) => {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(b.radius, b.radius, 1, 20),
    new THREE.MeshStandardMaterial({
      color: 0xff5566,
      emissive: 0x550012,
      metalness: 0.4,
      roughness: 0.35,
    })
  );
  mesh.position.set(b.x, 0.5, b.z);
  mesh.castShadow = true;
  scene.add(mesh);
  return { ...b, mesh, flashUntil: 0 };
});

// ---------- Flippers ----------
const FLIPPER_LENGTH = 2.4;
const FLIPPER_RADIUS = 0.32;
const FLIPPER_ANGULAR_SPEED = Math.PI * 9; // rad/s, snappy arcade feel

function makeFlipperMesh() {
  const geo = new THREE.BoxGeometry(FLIPPER_LENGTH, 0.5, FLIPPER_RADIUS * 2);
  geo.translate(FLIPPER_LENGTH / 2, 0, 0);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xffe066, roughness: 0.4 })
  );
  mesh.position.y = 0.4;
  mesh.castShadow = true;
  return mesh;
}

const flippers = [
  {
    pivot: new THREE.Vector3(-2.6, 0, 5.6),
    restAngle: THREE.MathUtils.degToRad(200),
    activeAngle: THREE.MathUtils.degToRad(60),
    angle: THREE.MathUtils.degToRad(200),
    active: false,
    mesh: makeFlipperMesh(),
  },
  {
    pivot: new THREE.Vector3(2.6, 0, 5.6),
    restAngle: THREE.MathUtils.degToRad(-20),
    activeAngle: THREE.MathUtils.degToRad(120),
    angle: THREE.MathUtils.degToRad(-20),
    active: false,
    mesh: makeFlipperMesh(),
  },
];
for (const f of flippers) {
  f.mesh.position.set(f.pivot.x, 0.4, f.pivot.z);
  f.mesh.rotation.y = f.angle;
  scene.add(f.mesh);
}

function flipperTip(f) {
  return new THREE.Vector3(
    f.pivot.x + FLIPPER_LENGTH * Math.cos(f.angle),
    0,
    f.pivot.z - FLIPPER_LENGTH * Math.sin(f.angle)
  );
}

// ---------- Ball ----------
const LANE_REST = new THREE.Vector3((LANE_X + TABLE_RIGHT) / 2, 0, 5.8);
const ball = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_RADIUS, 20, 20),
  new THREE.MeshStandardMaterial({ color: 0xd8d8e0, metalness: 0.8, roughness: 0.25 })
);
ball.position.copy(LANE_REST).setY(BALL_RADIUS);
ball.castShadow = true;
scene.add(ball);

const ballPos = LANE_REST.clone();
const ballVel = new THREE.Vector3();
let launched = false;

function resetBall() {
  ballPos.copy(LANE_REST);
  ballVel.set(0, 0, 0);
  launched = false;
}

// ---------- Collision helpers ----------
// Generic capsule (line segment with thickness) vs circle collision, used
// for both static walls and the swinging flippers so there is one code
// path to reason about.
// `kick`: true for the flipper-style "hit along the collision normal" kick,
// or a fixed {vx, vz} vector for walls with a deterministic bounce (e.g.
// the plunger-lane deflector, where relying on incoming-angle physics
// wasn't reliable enough to consistently clear the ball into the field).
function resolveSegmentCollision(x1, z1, x2, z2, thickness, kick) {
  const segX = x2 - x1;
  const segZ = z2 - z1;
  const segLenSq = segX * segX + segZ * segZ;
  let t = 0;
  if (segLenSq > 1e-8) {
    t = ((ballPos.x - x1) * segX + (ballPos.z - z1) * segZ) / segLenSq;
    t = THREE.MathUtils.clamp(t, 0, 1);
  }
  const closestX = x1 + segX * t;
  const closestZ = z1 + segZ * t;
  const dx = ballPos.x - closestX;
  const dz = ballPos.z - closestZ;
  const dist = Math.hypot(dx, dz);
  const minDist = BALL_RADIUS + thickness;
  if (dist >= minDist || dist < 1e-6) return;

  const nx = dx / dist;
  const nz = dz / dist;

  if (kick && typeof kick === "object") {
    // Push out along the kick direction itself, not the collision normal —
    // otherwise the position correction can shove the ball toward whatever
    // is behind the wall (e.g. the outer rail right next to a deflector),
    // which immediately reflects the kick's velocity right back.
    const kickLen = Math.hypot(kick.vx, kick.vz) || 1;
    ballPos.x += (kick.vx / kickLen) * (minDist - dist);
    ballPos.z += (kick.vz / kickLen) * (minDist - dist);
    ballVel.set(kick.vx, 0, kick.vz);
  } else if (kick) {
    ballPos.x += nx * (minDist - dist);
    ballPos.z += nz * (minDist - dist);
    ballVel.set(nx * FLIP_KICK_SPEED, 0, nz * FLIP_KICK_SPEED - FLIP_KICK_UP_BOOST);
  } else {
    ballPos.x += nx * (minDist - dist);
    ballPos.z += nz * (minDist - dist);
    const vn = ballVel.x * nx + ballVel.z * nz;
    if (vn < 0) {
      ballVel.x -= (1 + WALL_RESTITUTION) * vn * nx;
      ballVel.z -= (1 + WALL_RESTITUTION) * vn * nz;
    }
  }
}

function resolveBumperCollision(bumper) {
  const dx = ballPos.x - bumper.x;
  const dz = ballPos.z - bumper.z;
  const dist = Math.hypot(dx, dz);
  const minDist = BALL_RADIUS + bumper.radius;
  if (dist >= minDist || dist < 1e-6) return;

  const nx = dx / dist;
  const nz = dz / dist;
  ballPos.x += nx * (minDist - dist);
  ballPos.z += nz * (minDist - dist);
  ballVel.set(nx * BUMPER_KICK_SPEED, 0, nz * BUMPER_KICK_SPEED);

  score += 10;
  scoreEl.textContent = String(score);
  bumper.flashUntil = performance.now() + 150;
}

// ---------- Input ----------
// Flipper touch zones support independent multi-touch (one finger per
// side); the launch button tracks its own charge-and-release gesture.
const flipperLeftZone = document.getElementById("flipperLeftZone");
const flipperRightZone = document.getElementById("flipperRightZone");
const launchBtn = document.getElementById("launchBtn");

function bindFlipperZone(zone, flipper) {
  const activePointers = new Set();
  zone.addEventListener("pointerdown", (e) => {
    activePointers.add(e.pointerId);
    zone.setPointerCapture(e.pointerId);
    flipper.active = true;
  });
  const release = (e) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) flipper.active = false;
  };
  zone.addEventListener("pointerup", release);
  zone.addEventListener("pointercancel", release);
}
bindFlipperZone(flipperLeftZone, flippers[0]);
bindFlipperZone(flipperRightZone, flippers[1]);

const LAUNCH_CHARGE_MS = 900;
const LAUNCH_MIN_SPEED = 12;
const LAUNCH_MAX_SPEED = 30;
let launchChargeStart = 0;
let charging = false;

launchBtn.addEventListener("pointerdown", (e) => {
  if (launched) return;
  charging = true;
  launchChargeStart = performance.now();
  launchBtn.classList.add("charging");
  launchBtn.setPointerCapture(e.pointerId);
});
launchBtn.addEventListener("pointerup", () => {
  if (!charging) return;
  charging = false;
  launchBtn.classList.remove("charging");
  if (launched) return;
  const held = Math.min(performance.now() - launchChargeStart, LAUNCH_CHARGE_MS);
  const power = held / LAUNCH_CHARGE_MS;
  ballVel.set(0, 0, -(LAUNCH_MIN_SPEED + (LAUNCH_MAX_SPEED - LAUNCH_MIN_SPEED) * power));
  launched = true;
});
launchBtn.addEventListener("pointercancel", () => {
  charging = false;
  launchBtn.classList.remove("charging");
});

// ---------- Game state ----------
let score = 0;
let ballsLeft = 3;
let gameOver = false;

const scoreEl = document.getElementById("score");
const ballsLeftEl = document.getElementById("ballsLeft");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlayTitle");
document.getElementById("restartBtn").addEventListener("click", () => location.reload());

function loseBall() {
  ballsLeft--;
  ballsLeftEl.textContent = String(ballsLeft);
  if (ballsLeft <= 0) {
    gameOver = true;
    overlayTitleEl.textContent = "Game Over";
    overlayEl.classList.add("show");
  } else {
    resetBall();
  }
}

// ---------- Main loop ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.033);
  const now = performance.now();

  if (!gameOver) {
    for (const f of flippers) {
      const target = f.active ? f.activeAngle : f.restAngle;
      const maxStep = FLIPPER_ANGULAR_SPEED * delta;
      const diff = target - f.angle;
      f.angle += THREE.MathUtils.clamp(diff, -maxStep, maxStep);
      f.mesh.rotation.y = f.angle;
    }

    if (launched) {
      ballVel.z += GRAVITY_Z * delta;
      ballVel.multiplyScalar(DAMPING);
      if (ballVel.length() > MAX_SPEED) ballVel.setLength(MAX_SPEED);

      ballPos.addScaledVector(ballVel, delta);

      for (const w of walls) {
        resolveSegmentCollision(w.x1, w.z1, w.x2, w.z2, w.thickness, w.kick ?? false);
      }
      for (const b of bumpers) resolveBumperCollision(b);
      for (const f of flippers) {
        const tip = flipperTip(f);
        resolveSegmentCollision(
          f.pivot.x, f.pivot.z, tip.x, tip.z, FLIPPER_RADIUS,
          f.active && f.angle !== f.restAngle
        );
      }

      if (ballPos.z > DRAIN_Z) loseBall();
    }

    ballPos.y = BALL_RADIUS;
    ball.position.copy(ballPos);

    for (const b of bumpers) {
      const flashing = now < b.flashUntil;
      const s = flashing ? 1.25 : 1;
      b.mesh.scale.set(s, 1, s);
    }
  }

  renderer.render(scene, camera);
}

animate();
