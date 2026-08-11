import * as THREE from "three";

// ---------- Pure math helpers ----------
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clampIdx(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ---------- Heuristic depth estimation (no ML model available in this
// environment — see README for why). Combines three classic monocular
// depth cues: local detail/edge density (sharper = closer), distance
// from center (subjects tend to be centered), and vertical position
// (lower in frame = closer, a common ground-plane assumption). ----------
function toGrayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return gray;
}
function sobelMagnitude(gray, width, height) {
  const out = new Float32Array(width * height);
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx = 0, sy = 0, k = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const xi = clampIdx(x + i, 0, width - 1);
          const yj = clampIdx(y + j, 0, height - 1);
          const v = gray[yj * width + xi];
          sx += v * gx[k]; sy += v * gy[k]; k++;
        }
      }
      out[y * width + x] = Math.sqrt(sx * sx + sy * sy);
    }
  }
  return out;
}
function boxBlur(src, width, height, radius) {
  if (radius <= 0) return src.slice();
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const size = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[y * width + clampIdx(x, 0, width - 1)];
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / size;
      sum += src[y * width + clampIdx(x + radius + 1, 0, width - 1)] - src[y * width + clampIdx(x - radius, 0, width - 1)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[clampIdx(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / size;
      sum += tmp[clampIdx(y + radius + 1, 0, height - 1) * width + x] - tmp[clampIdx(y - radius, 0, height - 1) * width + x];
    }
  }
  return out;
}
function normalize01(arr) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < arr.length; i++) { if (arr[i] < min) min = arr[i]; if (arr[i] > max) max = arr[i]; }
  const range = max - min || 1;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - min) / range;
  return out;
}
const DEPTH_WEIGHTS = { edge: 0.55, center: 0.30, vertical: 0.15 };
function computeDepthMap(imageData, width, height, opts) {
  const o = Object.assign({ ...DEPTH_WEIGHTS, blurRadius: 2 }, opts);
  const gray = toGrayscale(imageData);
  const edgesNorm = normalize01(boxBlur(sobelMagnitude(gray, width, height), width, height, o.blurRadius));
  const combined = new Float32Array(width * height);
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy) || 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const centerScore = 1 - Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / maxDist;
      const vertScore = y / ((height - 1) || 1);
      combined[i] = o.edge * edgesNorm[i] + o.center * centerScore + o.vertical * vertScore;
    }
  }
  return boxBlur(normalize01(combined), width, height, o.blurRadius);
}
function makeDepthSampler(depthArray, width, height) {
  return function (u, v) {
    const x = clampIdx(u, 0, 1) * (width - 1);
    const y = clampIdx(v, 0, 1) * (height - 1);
    const x0 = Math.floor(x), x1 = Math.min(x0 + 1, width - 1);
    const y0 = Math.floor(y), y1 = Math.min(y0 + 1, height - 1);
    const fx = x - x0, fy = y - y0;
    const d00 = depthArray[y0 * width + x0], d10 = depthArray[y0 * width + x1];
    const d01 = depthArray[y1 * width + x0], d11 = depthArray[y1 * width + x1];
    return lerp(lerp(d00, d10, fx), lerp(d01, d11, fx), fy);
  };
}
function averageBorderColor(imageData, width, height) {
  const { data } = imageData;
  let r = 0, g = 0, b = 0, count = 0;
  const step = Math.max(1, Math.floor(width / 48));
  for (let x = 0; x < width; x += step) {
    for (const y of [0, height - 1]) {
      const i = (y * width + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
    }
  }
  for (let y = 0; y < height; y += step) {
    for (const x of [0, width - 1]) {
      const i = (y * width + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
    }
  }
  count = count || 1;
  return { r: r / count / 255, g: g / count / 255, b: b / count / 255 };
}

// ---------- Touch-control math ----------
const PITCH_LIMIT = Math.PI / 2.4;
function computeDragRotation(prevYaw, prevPitch, dx, dy, sensitivity) {
  return {
    yaw: prevYaw + dx * sensitivity,
    pitch: clamp(prevPitch - dy * sensitivity, -PITCH_LIMIT, PITCH_LIMIT),
  };
}
function pointerDistance(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }
function computeCameraDistance(startCamDist, startTouchDist, currentTouchDist, minDist, maxDist) {
  if (startTouchDist <= 0) return startCamDist;
  return clamp(startCamDist / (currentTouchDist / startTouchDist), minDist, maxDist);
}

// ---------- Three.js scene ----------
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 50);
const CAM_MIN_DIST = 1.1, CAM_MAX_DIST = 4.5, CAM_DEFAULT_DIST = 2.4;
camera.position.set(0, 0, CAM_DEFAULT_DIST);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const key = new THREE.DirectionalLight(0xffffff, 0.8);
key.position.set(1.5, 2, 2.5);
scene.add(key);
const fill = new THREE.DirectionalLight(0x8899ff, 0.35);
fill.position.set(-2, -1, -1.5);
scene.add(fill);

const objectGroup = new THREE.Group();
scene.add(objectGroup);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- Photo -> relief mesh pipeline ----------
const ANALYSIS_SIZE = 96;
const GRID_SEGMENTS = 40;
const FRONT_MAX_DISP = 0.42;
const BACK_MAX_DISP = 0.14;
const BACK_OFFSET = 0.05;

function buildDisplacedGeometry(depthSampler, planeW, planeH, segments, maxDisp, mirrorU) {
  const geo = new THREE.PlaneGeometry(planeW, planeH, segments, segments);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const d = depthSampler(mirrorU ? 1 - u : u, 1 - v);
    pos.setZ(i, d * maxDisp);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
function perimeterGridCoords(segments) {
  const coords = [];
  for (let i = 0; i <= segments; i++) coords.push([i, 0]); // top row, left->right
  for (let j = 1; j <= segments; j++) coords.push([segments, j]); // right col, top->bottom
  for (let i = segments - 1; i >= 0; i--) coords.push([i, segments]); // bottom row, right->left
  for (let j = segments - 1; j >= 1; j--) coords.push([0, j]); // left col, bottom->top
  return coords;
}
function gridFlatIndex(i, j, segments) { return j * (segments + 1) + i; }
function buildRimGeometry(frontGeo, backLocalPositions, segments) {
  const coords = perimeterGridCoords(segments);
  const frontPos = frontGeo.attributes.position;
  const n = coords.length;
  const verts = [];
  for (let k = 0; k < n; k++) {
    const [i, j] = coords[k];
    const fi = gridFlatIndex(i, j, segments);
    const fx = frontPos.getX(fi), fy = frontPos.getY(fi), fz = frontPos.getZ(fi);
    // The back mesh is rotated 180deg around Y (flipping world X) and offset
    // in -Z. To connect a straight, untwisted rim strip, the back vertex we
    // stitch to must land at the SAME world (x,y) as the front vertex —
    // which, because the rotation mirrors X, means sampling back's LOCAL
    // grid at the horizontally-mirrored column (segments-i), not the same
    // (i,j). See games/photo-spin-3d/README.md for the derivation.
    const bi = gridFlatIndex(segments - i, j, segments) * 3;
    const lx = backLocalPositions[bi], ly = backLocalPositions[bi + 1], lz = backLocalPositions[bi + 2];
    const bx = -lx, by = ly, bz = -lz - BACK_OFFSET;
    verts.push(fx, fy, fz, bx, by, bz);
  }
  const indices = [];
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const f0 = k * 2, b0 = k * 2 + 1, f1 = k2 * 2, b1 = k2 * 2 + 1;
    indices.push(f0, f1, b1, f0, b1, b0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildPhotoObject(image, imageDataFull, depthArray, analysisSize, texW, texH) {
  const aspect = image.width / image.height;
  const planeW = aspect >= 1 ? 1.4 : 1.4 * aspect;
  const planeH = aspect >= 1 ? 1.4 / aspect : 1.4;
  const sampler = makeDepthSampler(depthArray, analysisSize, analysisSize);

  const frontGeo = buildDisplacedGeometry(sampler, planeW, planeH, GRID_SEGMENTS, FRONT_MAX_DISP, false);
  const backGeoRaw = buildDisplacedGeometry(sampler, planeW, planeH, GRID_SEGMENTS, BACK_MAX_DISP, true);
  const backLocalPositions = backGeoRaw.attributes.position.array.slice();
  const rimColor = averageBorderColor(imageDataFull, imageDataFull.width, imageDataFull.height);

  const frontCanvas = document.createElement("canvas");
  frontCanvas.width = texW; frontCanvas.height = texH;
  frontCanvas.getContext("2d").drawImage(image, 0, 0, texW, texH);
  const frontTexture = new THREE.CanvasTexture(frontCanvas);
  frontTexture.colorSpace = THREE.SRGBColorSpace;

  const backCanvas = document.createElement("canvas");
  backCanvas.width = texW; backCanvas.height = texH;
  const bctx = backCanvas.getContext("2d");
  bctx.save();
  bctx.scale(-1, 1);
  bctx.filter = "blur(6px) brightness(0.6)";
  bctx.drawImage(image, -texW, 0, texW, texH);
  bctx.restore();
  const backTexture = new THREE.CanvasTexture(backCanvas);
  backTexture.colorSpace = THREE.SRGBColorSpace;

  const frontMat = new THREE.MeshStandardMaterial({ map: frontTexture, roughness: 0.85, side: THREE.FrontSide });
  const backMat = new THREE.MeshStandardMaterial({ map: backTexture, roughness: 0.95, side: THREE.FrontSide });
  const rimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(rimColor.r, rimColor.g, rimColor.b), roughness: 1 });

  const frontMesh = new THREE.Mesh(frontGeo, frontMat);
  const backMesh = new THREE.Mesh(backGeoRaw, backMat);
  backMesh.rotation.y = Math.PI;
  backMesh.position.z = -BACK_OFFSET;

  const rimGeo = buildRimGeometry(frontGeo, backLocalPositions, GRID_SEGMENTS);
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);

  const group = new THREE.Group();
  group.add(frontMesh, backMesh, rimMesh);
  return group;
}

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
    }
  });
}

// ---------- App state / UI ----------
const statusEl = document.getElementById("status");
const placeholderEl = document.getElementById("placeholder");
const fileInput = document.getElementById("fileInput");
const loadBtn = document.getElementById("loadBtn");
const resetBtn = document.getElementById("resetBtn");

let currentPhotoGroup = null;
let camDist = CAM_DEFAULT_DIST;
let hasPhoto = false;

async function loadPhotoFile(file) {
  statusEl.textContent = "解析中…";
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });

  const maxTexSize = 1024;
  const scaleTex = Math.min(1, maxTexSize / Math.max(image.width, image.height));
  const texW = Math.max(1, Math.round(image.width * scaleTex));
  const texH = Math.max(1, Math.round(image.height * scaleTex));

  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = ANALYSIS_SIZE;
  analysisCanvas.height = ANALYSIS_SIZE;
  const actx = analysisCanvas.getContext("2d");
  actx.drawImage(image, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
  const analysisData = actx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
  const depthArray = computeDepthMap(analysisData, ANALYSIS_SIZE, ANALYSIS_SIZE);

  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = texW; fullCanvas.height = texH;
  fullCanvas.getContext("2d").drawImage(image, 0, 0, texW, texH);
  const fullImageData = fullCanvas.getContext("2d").getImageData(0, 0, texW, texH);

  if (currentPhotoGroup) {
    objectGroup.remove(currentPhotoGroup);
    disposeGroup(currentPhotoGroup);
  }
  currentPhotoGroup = buildPhotoObject(image, fullImageData, depthArray, ANALYSIS_SIZE, texW, texH);
  objectGroup.add(currentPhotoGroup);
  objectGroup.rotation.set(0, 0, 0);
  camDist = CAM_DEFAULT_DIST;
  camera.position.set(0, 0, camDist);
  hasPhoto = true;
  placeholderEl.classList.add("hide");
  statusEl.textContent = "";
  URL.revokeObjectURL(image.src);
}

function resetView() {
  objectGroup.rotation.set(0, 0, 0);
  camDist = CAM_DEFAULT_DIST;
  camera.position.set(0, 0, camDist);
}

loadBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) loadPhotoFile(file).catch((err) => { statusEl.textContent = "読み込みに失敗しました"; console.error(err); });
  fileInput.value = "";
});
resetBtn.addEventListener("click", resetView);

// ---------- Input: drag to rotate, pinch to zoom ----------
const activePointers = new Map();
let dragLast = null;
let pinchStart = null;
const DRAG_SENSITIVITY = 0.008;

function onPointerDown(evt) {
  activePointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
  if (activePointers.size === 1) {
    dragLast = { x: evt.clientX, y: evt.clientY };
  } else if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    pinchStart = { touchDist: pointerDistance(pts[0], pts[1]), camDist };
    dragLast = null;
  }
}
function onPointerMove(evt) {
  if (!activePointers.has(evt.pointerId)) return;
  activePointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
  if (activePointers.size === 1 && dragLast && hasPhoto) {
    const dx = evt.clientX - dragLast.x;
    const dy = evt.clientY - dragLast.y;
    const r = computeDragRotation(objectGroup.rotation.y, objectGroup.rotation.x, dx, dy, DRAG_SENSITIVITY);
    objectGroup.rotation.y = r.yaw;
    objectGroup.rotation.x = r.pitch;
    dragLast = { x: evt.clientX, y: evt.clientY };
  } else if (activePointers.size === 2 && pinchStart) {
    const pts = Array.from(activePointers.values());
    const dist = pointerDistance(pts[0], pts[1]);
    camDist = computeCameraDistance(pinchStart.camDist, pinchStart.touchDist, dist, CAM_MIN_DIST, CAM_MAX_DIST);
    camera.position.set(0, 0, camDist);
  }
}
function onPointerUp(evt) {
  activePointers.delete(evt.pointerId);
  if (activePointers.size === 0) { dragLast = null; pinchStart = null; }
  else if (activePointers.size === 1) {
    const [remaining] = activePointers.values();
    dragLast = { x: remaining.x, y: remaining.y };
    pinchStart = null;
  }
}
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);

// ---------- Render loop ----------
function loop() {
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
