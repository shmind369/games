// ---------- Scope ----------
// An RPG-style field map shaped like the JR Yamanote Line loop: the 30
// real stations form a ring of "walls" around the boundary, and the
// player walks freely inside that ring via a virtual joystick. This is
// a map/movement foundation only — no encounters, battles, or per-station
// events are implemented yet (see README for what's deliberately out of
// scope).

// ---------- Real Yamanote Line stations, in loop order ----------
const STATIONS = [
  "巣鴨", "駒込", "田端", "西日暮里", "日暮里", "鶯谷", "上野", "御徒町", "秋葉原", "神田",
  "東京", "有楽町", "新橋", "浜松町", "田町", "高輪ゲートウェイ", "品川", "大崎", "五反田", "目黒",
  "恵比寿", "渋谷", "原宿", "代々木", "新宿", "新大久保", "高田馬場", "目白", "池袋", "大塚",
];

// ---------- Tuning ----------
const PLAYER_RADIUS = 9;
const PLAYER_SPEED = 150; // px/s at full joystick deflection
const JOYSTICK_MAX_RADIUS_PX = 55;

// ---------- Pure geometry (no DOM/canvas — directly unit testable) ----------
// Station 0 sits at the top (12 o'clock) and the index increases clockwise,
// matching the reference diagram's layout.
function angleForStationIndex(index, total) {
  return (index / total) * Math.PI * 2 - Math.PI / 2;
}

function stationPosition(index, total, centerX, centerY, radius) {
  const angle = angleForStationIndex(index, total);
  return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
}

function nearestStationIndex(playerX, playerY, centerX, centerY, total) {
  const angle = Math.atan2(playerY - centerY, playerX - centerX);
  let normalized = angle + Math.PI / 2;
  if (normalized < 0) normalized += Math.PI * 2;
  return Math.round((normalized / (Math.PI * 2)) * total) % total;
}

function clampToCircle(x, y, centerX, centerY, maxRadius) {
  const dx = x - centerX;
  const dy = y - centerY;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxRadius || dist === 0) return { x, y };
  const scale = maxRadius / dist;
  return { x: centerX + dx * scale, y: centerY + dy * scale };
}

function computeJoystickVector(dx, dy, maxRadius) {
  const dist = Math.hypot(dx, dy);
  if (dist <= maxRadius) return { x: dx, y: dy, magnitude: dist / maxRadius };
  const scale = maxRadius / dist;
  return { x: dx * scale, y: dy * scale, magnitude: 1 };
}

// ---------- Canvas setup ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let width = 0;
let height = 0;

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layoutMap();
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);

// ---------- Map layout (recomputed on resize so it always fits) ----------
let mapCenterX = 0;
let mapCenterY = 0;
let stationRingRadius = 0;
let playBoundaryRadius = 0;

function layoutMap() {
  mapCenterX = width / 2;
  mapCenterY = height * 0.44;
  stationRingRadius = Math.min(width, height) * 0.32;
  playBoundaryRadius = stationRingRadius - 24;
}

// ---------- Game state ----------
const player = { x: 0, y: 0 };
let nearestIndex = 0;

const nearestStationEl = document.getElementById("nearestStation");

function resetGame() {
  resize();
  player.x = mapCenterX;
  player.y = mapCenterY;
  updateNearestStation();
}

function updateNearestStation() {
  const idx = nearestStationIndex(player.x, player.y, mapCenterX, mapCenterY, STATIONS.length);
  if (idx !== nearestIndex || nearestStationEl.textContent === "") {
    nearestIndex = idx;
    nearestStationEl.textContent = `${STATIONS[idx]}駅付近`;
  }
}

// ---------- Input: virtual joystick, drag from anywhere on screen ----------
let pointerId = null;
let anchorX = 0;
let anchorY = 0;
let stickX = 0;
let stickY = 0;
let stickMagnitude = 0;
let stickActive = false;

canvas.addEventListener("pointerdown", (e) => {
  pointerId = e.pointerId;
  anchorX = e.clientX;
  anchorY = e.clientY;
  stickX = 0;
  stickY = 0;
  stickMagnitude = 0;
  stickActive = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== pointerId) return;
  const vec = computeJoystickVector(e.clientX - anchorX, e.clientY - anchorY, JOYSTICK_MAX_RADIUS_PX);
  stickX = vec.x;
  stickY = vec.y;
  stickMagnitude = vec.magnitude;
});
function endTouch(e) {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  stickActive = false;
  stickX = 0;
  stickY = 0;
  stickMagnitude = 0;
}
canvas.addEventListener("pointerup", endTouch);
canvas.addEventListener("pointercancel", endTouch);

// ---------- Main loop ----------
let lastTime = performance.now();

function update(dt) {
  if (stickMagnitude > 0) {
    const dist = Math.hypot(stickX, stickY);
    const dirX = stickX / dist;
    const dirY = stickY / dist;
    const moveDist = PLAYER_SPEED * stickMagnitude * (dt / 1000);
    const next = clampToCircle(player.x + dirX * moveDist, player.y + dirY * moveDist, mapCenterX, mapCenterY, playBoundaryRadius - PLAYER_RADIUS);
    player.x = next.x;
    player.y = next.y;
  }
  updateNearestStation();
}

function drawStationLabel(text, x, y, angle, highlighted) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = highlighted ? "#ffe066" : "#dfe8df";
  ctx.font = highlighted ? "bold 12px system-ui, sans-serif" : "9px system-ui, sans-serif";
  ctx.textAlign = Math.cos(angle) > 0.15 ? "left" : Math.cos(angle) < -0.15 ? "right" : "center";
  ctx.textBaseline = Math.sin(angle) > 0.15 ? "top" : Math.sin(angle) < -0.15 ? "bottom" : "middle";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#17301f";
  ctx.fillRect(0, 0, width, height);

  // Interior playable field.
  ctx.fillStyle = "#274a32";
  ctx.beginPath();
  ctx.arc(mapCenterX, mapCenterY, playBoundaryRadius, 0, Math.PI * 2);
  ctx.fill();

  // Boundary ring (the "wall" made of stations).
  ctx.strokeStyle = "#4a7a58";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(mapCenterX, mapCenterY, playBoundaryRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Stations: dot on the ring + staggered label just outside it.
  for (let i = 0; i < STATIONS.length; i++) {
    const angle = angleForStationIndex(i, STATIONS.length);
    const pos = stationPosition(i, STATIONS.length, mapCenterX, mapCenterY, stationRingRadius);
    const highlighted = i === nearestIndex;

    ctx.fillStyle = highlighted ? "#ffe066" : "#9fd6ff";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, highlighted ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();

    const labelOffset = stationRingRadius + (i % 2 === 0 ? 14 : 24);
    const labelPos = { x: mapCenterX + Math.cos(angle) * labelOffset, y: mapCenterY + Math.sin(angle) * labelOffset };
    drawStationLabel(STATIONS[i], labelPos.x, labelPos.y, angle, highlighted);
  }

  // Player marker.
  ctx.fillStyle = "#ff6b6b";
  ctx.beginPath();
  ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Joystick visual feedback while dragging.
  if (stickActive) {
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(anchorX, anchorY, JOYSTICK_MAX_RADIUS_PX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(anchorX + stickX, anchorY + stickY, 16, 0, Math.PI * 2);
    ctx.fill();
  }
}

function loop(now) {
  const dt = Math.min(now - lastTime, 50);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

resetGame();
requestAnimationFrame(loop);

