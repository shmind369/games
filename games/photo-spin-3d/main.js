import * as THREE from "three";
import {
  clamp, lerp, segmentSilhouette, computeInflationField, computeSoftAlpha,
  makeFieldSampler, sampleColorBilinear, buildGridField, gridIndex,
  computeCellInclusion, findRimEdges, buildIndices,
} from "./depth.js";

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

// ---------- Photo -> silhouette-bounded volumetric mesh pipeline ----------
// Unlike a simple displaced plane (a flat card pushed in/out per-pixel), this
// builds an actual rounded volume bounded by the subject's outline:
//   1. segmentSilhouette cuts the subject out from its background.
//   2. computeInflationField gives it a rounded cross-section (a distance
//      transform from the silhouette edge run through a quarter-circle
//      profile — the classic "balloon inflation" trick), tapering to exactly
//      0 at the outline.
//   3. Front/back surfaces are only emitted for grid cells inside the
//      silhouette (background cells produce no geometry at all), and a rim
//      strip traces the silhouette's actual outline to close the volume.
// The back and the object's sides are never truly photographed, so their
// appearance is inferred (mirrored + blurred + darkened front texture) —
// see README for the honest scope of what this can and can't reconstruct.
const ANALYSIS_SIZE = 128;
const GRID_SEGMENTS = 88;
const FRONT_MAX_DISP = 0.5;
const BACK_MAX_DISP = 0.22;
const BACK_OFFSET = 0.015;
const INCLUDE_THRESHOLD = 0.5;
// A wide alpha blur is what actually matters here: it widens the band (in
// mesh-grid cells, not just analysis pixels) over which depth gets damped
// toward 0 near the silhouette edge, turning an abrupt 1-2-cell "cliff" at
// the boundary into a gentle multi-cell ramp — the single biggest factor in
// avoiding a jagged, spiky rim on the finished mesh.
const MASK_BLUR_RADIUS = 5;

function buildSurfaceBuffers(planeW, planeH, segments, depthGrid, maxDisp) {
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    const rowFrac = j / segments;
    for (let i = 0; i < n; i++) {
      const colFrac = i / segments;
      const gi = gridIndex(i, j, segments);
      positions[gi * 3] = (colFrac - 0.5) * planeW;
      positions[gi * 3 + 1] = (0.5 - rowFrac) * planeH;
      positions[gi * 3 + 2] = depthGrid[gi] * maxDisp;
      uvs[gi * 2] = colFrac;
      uvs[gi * 2 + 1] = 1 - rowFrac;
    }
  }
  return { positions, uvs };
}

function buildFilteredGeometry(positions, uvs, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Rim vertices sit AT the silhouette's discretized edge, not deep inside it —
// but the inflation profile has a steep (near-vertical) slope right at that
// edge, so even the small mismatch between the alpha-based cell-inclusion
// boundary and the depth field's own zero-crossing gets amplified into a
// large, spiky z value if sampled directly. Sealing the rim flush at z=0
// (front) / z=-BACK_OFFSET (back) sidesteps that entirely: it's exactly what
// the surfaces are already tapering toward at their shared silhouette edge.
function buildRimGeometry(rimEdges, frontPositions, segments, fullImageData, texW, texH) {
  const verts = [];
  const colors = [];
  const indices = [];
  for (const [[i0, j0], [i1, j1]] of rimEdges) {
    const fi0 = gridIndex(i0, j0, segments) * 3, fi1 = gridIndex(i1, j1, segments) * 3;
    const fx0 = frontPositions[fi0], fy0 = frontPositions[fi0 + 1];
    const fx1 = frontPositions[fi1], fy1 = frontPositions[fi1 + 1];
    const f0 = [fx0, fy0, 0];
    const f1 = [fx1, fy1, 0];
    const b0 = [fx0, fy0, -BACK_OFFSET];
    const b1 = [fx1, fy1, -BACK_OFFSET];

    const c0 = sampleColorBilinear(fullImageData, texW, texH, i0 / segments, j0 / segments);
    const c1 = sampleColorBilinear(fullImageData, texW, texH, i1 / segments, j1 / segments);
    const DARK = 0.62;

    const base = verts.length / 3;
    verts.push(...f0, ...f1, ...b1, ...b0);
    colors.push(
      c0.r, c0.g, c0.b,
      c1.r, c1.g, c1.b,
      c1.r * DARK, c1.g * DARK, c1.b * DARK,
      c0.r * DARK, c0.g * DARK, c0.b * DARK,
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildPhotoObject(image, analysisData, fullImageData, texW, texH) {
  const aspect = image.width / image.height;
  const planeW = aspect >= 1 ? 1.4 : 1.4 * aspect;
  const planeH = aspect >= 1 ? 1.4 / aspect : 1.4;

  const fgMask = segmentSilhouette(analysisData, ANALYSIS_SIZE, ANALYSIS_SIZE);
  const inflation = computeInflationField(fgMask, ANALYSIS_SIZE, ANALYSIS_SIZE);
  const softAlpha = computeSoftAlpha(fgMask, ANALYSIS_SIZE, ANALYSIS_SIZE, MASK_BLUR_RADIUS);
  const depthSampler = makeFieldSampler(inflation, ANALYSIS_SIZE, ANALYSIS_SIZE);
  const alphaSampler = makeFieldSampler(softAlpha, ANALYSIS_SIZE, ANALYSIS_SIZE);

  const depthGridFront = buildGridField(depthSampler, GRID_SEGMENTS, false);
  const depthGridBack = buildGridField(depthSampler, GRID_SEGMENTS, true);
  const alphaGrid = buildGridField(alphaSampler, GRID_SEGMENTS, false);
  const alphaGridMirrored = buildGridField(alphaSampler, GRID_SEGMENTS, true);
  const cellIncluded = computeCellInclusion(alphaGrid, GRID_SEGMENTS, INCLUDE_THRESHOLD);
  const indices = buildIndices(cellIncluded, GRID_SEGMENTS);
  const rimEdges = findRimEdges(cellIncluded, GRID_SEGMENTS);

  // Damp depth by the (soft, blurred) alpha confidence at each vertex. A
  // boundary cell can pass the average-of-4-corners inclusion test while one
  // of its own corners still sits deep inside the silhouette (large raw
  // depth) — multiplying by alpha (which is ~0 right at the true edge and
  // ~1 well inside) pulls that corner's depth back down in proportion to how
  // close it actually is to the edge, smoothing out the last ring of
  // boundary triangles instead of leaving them at their raw, possibly-large
  // sampled depth.
  for (let k = 0; k < depthGridFront.length; k++) depthGridFront[k] *= alphaGrid[k];
  for (let k = 0; k < depthGridBack.length; k++) depthGridBack[k] *= alphaGridMirrored[k];

  // Force the exact boundary vertices (the rim edge endpoints) to true zero
  // depth on both surfaces. Alpha damping alone still leaves a small residual
  // (a boundary cell only needs to average >0.5, so an individual corner can
  // land at e.g. alpha=0.6 and keep a sliver of depth) — that sliver is small
  // in absolute terms, but the rim strip connecting to it is built perfectly
  // flat at z=0, so any nonzero residual here is a real, visible step
  // between two thin, nearly-parallel surfaces right at the silhouette edge,
  // which is exactly what shows up as z-fighting/moiré when viewed near
  // edge-on. Snapping both surfaces' own boundary ring to match the rim
  // exactly removes that step at the source.
  const boundaryVerts = new Set();
  for (const [[i0, j0], [i1, j1]] of rimEdges) {
    boundaryVerts.add(gridIndex(i0, j0, GRID_SEGMENTS));
    boundaryVerts.add(gridIndex(i1, j1, GRID_SEGMENTS));
  }
  for (const gi of boundaryVerts) { depthGridFront[gi] = 0; depthGridBack[gi] = 0; }

  const front = buildSurfaceBuffers(planeW, planeH, GRID_SEGMENTS, depthGridFront, FRONT_MAX_DISP);
  const back = buildSurfaceBuffers(planeW, planeH, GRID_SEGMENTS, depthGridBack, BACK_MAX_DISP);

  const frontGeo = buildFilteredGeometry(front.positions, front.uvs, indices);
  const backGeo = buildFilteredGeometry(back.positions, back.uvs, indices);
  const rimGeo = buildRimGeometry(rimEdges, front.positions, GRID_SEGMENTS, fullImageData, texW, texH);

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
  bctx.filter = "blur(6px) brightness(0.62) saturate(0.85)";
  bctx.drawImage(image, -texW, 0, texW, texH);
  bctx.restore();
  const backTexture = new THREE.CanvasTexture(backCanvas);
  backTexture.colorSpace = THREE.SRGBColorSpace;

  const frontMat = new THREE.MeshStandardMaterial({ map: frontTexture, roughness: 0.85, side: THREE.FrontSide });
  const backMat = new THREE.MeshStandardMaterial({ map: backTexture, roughness: 0.95, side: THREE.FrontSide });
  const rimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });

  const frontMesh = new THREE.Mesh(frontGeo, frontMat);
  const backMesh = new THREE.Mesh(backGeo, backMat);
  backMesh.rotation.y = Math.PI;
  backMesh.position.z = -BACK_OFFSET;
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

  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = texW; fullCanvas.height = texH;
  fullCanvas.getContext("2d").drawImage(image, 0, 0, texW, texH);
  const fullImageData = fullCanvas.getContext("2d").getImageData(0, 0, texW, texH);

  if (currentPhotoGroup) {
    objectGroup.remove(currentPhotoGroup);
    disposeGroup(currentPhotoGroup);
  }
  currentPhotoGroup = buildPhotoObject(image, analysisData, fullImageData, texW, texH);
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
