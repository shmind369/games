import {
  MIN_YEAR, MAX_YEAR, clampYear, REGION_SHAPES, colorForPeriod, hitTestRegion,
  clampZoom, clampPan, mapToScreen, screenToMap, zoomFromSliderX, sliderXFromZoom,
  yearFromBarX, barXFromYear, t, formatYear, LANGS,
} from "./worldmap.js";
import { REGION_LABELS, mostSpecificEra, formatEraLabel, peopleAliveInYear, formatAge } from "./history.js";

const MAP_W = 600, MAP_H = 340;

// Decorative, non-interactive landmasses so the map doesn't read as empty
// ocean outside the four regions the dataset actually covers. Schematic
// blob placements, not real coastlines (see README).
const DECOR_SHAPES = [
  { x: 0.20, y: 0.28, rx: 0.11, ry: 0.13 },
  { x: 0.28, y: 0.62, rx: 0.07, ry: 0.13 },
  { x: 0.50, y: 0.55, rx: 0.09, ry: 0.14 },
  { x: 0.68, y: 0.50, rx: 0.06, ry: 0.06 },
  { x: 0.85, y: 0.72, rx: 0.06, ry: 0.045 },
];

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const yearBarCanvas = document.getElementById("yearBarCanvas");
const yearBarCtx = yearBarCanvas.getContext("2d");

const topBarEl = document.getElementById("topBar");
const yearBoxEl = document.getElementById("yearBox");
const yearDisplayEl = document.getElementById("yearDisplay");
const yearInputEl = document.getElementById("yearInput");
const eraLabelEl = document.getElementById("eraLabel");
const zoomSliderEl = document.getElementById("zoomSlider");
const zoomThumbEl = document.getElementById("zoomThumb");
const yearCursorEl = document.getElementById("yearCursor");
const yearBarTrackEl = document.getElementById("yearBarTrack");
const yearPrevBtn = document.getElementById("yearPrevBtn");
const yearNextBtn = document.getElementById("yearNextBtn");
const sheetBackdropEl = document.getElementById("sheetBackdrop");
const regionSheetEl = document.getElementById("regionSheet");
const regionTitleEl = document.getElementById("regionTitle");
const regionEraEl = document.getElementById("regionEra");
const personListEl = document.getElementById("personList");
const personEmptyEl = document.getElementById("personEmpty");
const sheetCloseBtn = document.getElementById("sheetCloseBtn");

let data = { people: [], events: [], eras: [] };
let lang = "ja";
let year = 1582;
let camera = { panX: 0, panY: 0, zoom: 1 };
let openRegion = null;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const [c, ctxRef] of [[canvas, ctx], [yearBarCanvas, yearBarCtx]]) {
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    ctxRef.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  camera.zoom = clampZoom(window.innerWidth / MAP_W);
  render();
}

// ---------- Map rendering ----------
function drawShape(shape, color) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const center = mapToScreen(shape.x, shape.y, camera, MAP_W, MAP_H, w, h);
  const edge = mapToScreen(shape.x + shape.rx, shape.y, camera, MAP_W, MAP_H, w, h);
  const rScreen = Math.abs(edge.x - center.x);
  const vEdge = mapToScreen(shape.x, shape.y + shape.ry, camera, MAP_W, MAP_H, w, h);
  const rScreenV = Math.abs(vEdge.y - center.y);
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, rScreen, rScreenV, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  return center;
}

function renderMap() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#274353");
  grad.addColorStop(1, "#152029");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Faint lat/long grid for map texture.
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= 1; gx += 0.1) {
    const a = mapToScreen(gx, 0, camera, MAP_W, MAP_H, w, h);
    const b = mapToScreen(gx, 1, camera, MAP_W, MAP_H, w, h);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (let gy = 0; gy <= 1; gy += 0.1) {
    const a = mapToScreen(0, gy, camera, MAP_W, MAP_H, w, h);
    const b = mapToScreen(1, gy, camera, MAP_W, MAP_H, w, h);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  for (const shape of DECOR_SHAPES) drawShape(shape, "#586a5e");

  for (const region of Object.keys(REGION_SHAPES)) {
    const era = mostSpecificEra(data.eras, region, year);
    const color = colorForPeriod(era ? era.period : null);
    const center = drawShape(REGION_SHAPES[region], color);
    if (region === openRegion) {
      const shape = REGION_SHAPES[region];
      const edge = mapToScreen(shape.x + shape.rx, shape.y, camera, MAP_W, MAP_H, w, h);
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, Math.abs(edge.x - center.x) + 4, Math.abs(mapToScreen(shape.x, shape.y + shape.ry, camera, MAP_W, MAP_H, w, h).y - center.y) + 4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = "#fbf7ee";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(REGION_LABELS[region] ? REGION_LABELS[region].label : region, center.x, center.y);
  }
}

function renderYearBar() {
  const w = yearBarCanvas.clientWidth, h = yearBarCanvas.clientHeight;
  yearBarCtx.clearRect(0, 0, w, h);
  yearBarCtx.strokeStyle = "rgba(255,255,255,0.25)";
  yearBarCtx.lineWidth = 2;
  yearBarCtx.beginPath();
  yearBarCtx.moveTo(0, h / 2);
  yearBarCtx.lineTo(w, h / 2);
  yearBarCtx.stroke();
  yearBarCtx.fillStyle = "rgba(255,255,255,0.45)";
  yearBarCtx.font = "9px system-ui, sans-serif";
  yearBarCtx.textAlign = "center";
  const step = 1000;
  for (let yr = Math.ceil(MIN_YEAR / step) * step; yr <= MAX_YEAR; yr += step) {
    const x = barXFromYear(yr, w);
    yearBarCtx.beginPath();
    yearBarCtx.moveTo(x, h / 2 - 5);
    yearBarCtx.lineTo(x, h / 2 + 5);
    yearBarCtx.stroke();
  }
  yearCursorEl.style.left = `${barXFromYear(year, w)}px`;
}

function renderTopBar() {
  yearDisplayEl.textContent = formatYear(year, lang);
  const era = mostSpecificEra(data.eras, "japan", year);
  eraLabelEl.textContent = era ? `${t(lang, "era")}: ${era.name}` : "";
  for (const btn of document.querySelectorAll(".langBtn")) {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  }
  document.title = t(lang, "title");
}

function renderZoomThumb() {
  const trackH = zoomSliderEl.clientHeight;
  const y = trackH - sliderXFromZoom(camera.zoom, trackH) - zoomThumbEl.clientHeight / 2;
  zoomThumbEl.style.top = `${Math.max(0, Math.min(trackH - zoomThumbEl.clientHeight, y))}px`;
}

function renderSheet() {
  if (!openRegion) return;
  const info = REGION_LABELS[openRegion];
  regionTitleEl.textContent = info ? `${info.emoji} ${info.label}` : openRegion;
  const era = mostSpecificEra(data.eras, openRegion, year);
  regionEraEl.textContent = `${formatYear(year, lang)} ・ ${era ? formatEraLabel(openRegion, era, year) : "-"}`;
  const people = peopleAliveInYear(data.people, year).filter((p) => p.region === openRegion);
  personListEl.innerHTML = "";
  personEmptyEl.style.display = people.length === 0 ? "block" : "none";
  personEmptyEl.textContent = t(lang, "noFigures");
  for (const person of people) {
    const row = document.createElement("div");
    row.className = "personRow";
    const name = document.createElement("div");
    name.className = "personName";
    name.textContent = person.name;
    const meta = document.createElement("div");
    meta.className = "personMeta";
    meta.textContent = `${person.occupation} ・ ${formatAge(person, year)}`;
    row.appendChild(name);
    row.appendChild(meta);
    personListEl.appendChild(row);
  }
  sheetCloseBtn.textContent = lang === "en" ? "Close" : lang === "zh" ? "关闭" : "閉じる";
}

function render() {
  renderMap();
  renderYearBar();
  renderTopBar();
  renderZoomThumb();
  if (openRegion) renderSheet();
}

// ---------- Region sheet open/close ----------
function openRegionSheet(region) {
  openRegion = region;
  renderSheet();
  sheetBackdropEl.classList.add("show");
  regionSheetEl.classList.add("show");
  renderMap();
}
function closeRegionSheet() {
  openRegion = null;
  sheetBackdropEl.classList.remove("show");
  regionSheetEl.classList.remove("show");
  renderMap();
}
sheetCloseBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); closeRegionSheet(); });
sheetBackdropEl.addEventListener("pointerdown", (e) => { e.preventDefault(); closeRegionSheet(); });

// ---------- Map pan / tap-to-select ----------
const mapDrag = { active: false, pointerId: null, startX: 0, startY: 0, startPanX: 0, startPanY: 0, confirmed: false };
canvas.addEventListener("pointerdown", (e) => {
  mapDrag.active = true;
  mapDrag.confirmed = false;
  mapDrag.pointerId = e.pointerId;
  mapDrag.startX = e.clientX;
  mapDrag.startY = e.clientY;
  mapDrag.startPanX = camera.panX;
  mapDrag.startPanY = camera.panY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!mapDrag.active || e.pointerId !== mapDrag.pointerId) return;
  const dx = e.clientX - mapDrag.startX, dy = e.clientY - mapDrag.startY;
  if (!mapDrag.confirmed && Math.hypot(dx, dy) <= 5) return;
  mapDrag.confirmed = true;
  const clamped = clampPan(mapDrag.startPanX + dx, mapDrag.startPanY + dy, camera.zoom, MAP_W, MAP_H);
  camera.panX = clamped.x;
  camera.panY = clamped.y;
  renderMap();
});
function endMapDrag(e) {
  if (!mapDrag.active || e.pointerId !== mapDrag.pointerId) return;
  mapDrag.active = false;
  canvas.releasePointerCapture(e.pointerId);
  if (!mapDrag.confirmed) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const mp = screenToMap(e.clientX, e.clientY, camera, MAP_W, MAP_H, w, h);
    const region = hitTestRegion(mp.x, mp.y);
    if (region) openRegionSheet(region);
    else closeRegionSheet();
  }
}
canvas.addEventListener("pointerup", endMapDrag);
canvas.addEventListener("pointercancel", endMapDrag);

// ---------- Zoom slider ----------
const zoomDrag = { active: false, pointerId: null };
function setZoomFromClientY(clientY) {
  const rect = zoomSliderEl.getBoundingClientRect();
  const relY = clamp0(clientY - rect.top, 0, rect.height);
  const fromBottom = rect.height - relY;
  camera.zoom = clampZoom(zoomFromSliderX(fromBottom, rect.height));
  const clamped = clampPan(camera.panX, camera.panY, camera.zoom, MAP_W, MAP_H);
  camera.panX = clamped.x; camera.panY = clamped.y;
  renderMap();
  renderZoomThumb();
}
function clamp0(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
zoomSliderEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  zoomDrag.active = true;
  zoomDrag.pointerId = e.pointerId;
  zoomSliderEl.setPointerCapture(e.pointerId);
  setZoomFromClientY(e.clientY);
});
zoomSliderEl.addEventListener("pointermove", (e) => {
  if (!zoomDrag.active || e.pointerId !== zoomDrag.pointerId) return;
  setZoomFromClientY(e.clientY);
});
function endZoomDrag(e) {
  if (!zoomDrag.active || e.pointerId !== zoomDrag.pointerId) return;
  zoomDrag.active = false;
  zoomSliderEl.releasePointerCapture(e.pointerId);
}
zoomSliderEl.addEventListener("pointerup", endZoomDrag);
zoomSliderEl.addEventListener("pointercancel", endZoomDrag);

// ---------- Year bar drag ----------
const barDrag = { active: false, pointerId: null };
function setYearFromClientX(clientX) {
  const rect = yearBarTrackEl.getBoundingClientRect();
  const relX = clamp0(clientX - rect.left, 0, rect.width);
  setYear(yearFromBarX(relX, rect.width));
}
yearBarTrackEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  barDrag.active = true;
  barDrag.pointerId = e.pointerId;
  yearBarTrackEl.setPointerCapture(e.pointerId);
  setYearFromClientX(e.clientX);
});
yearBarTrackEl.addEventListener("pointermove", (e) => {
  if (!barDrag.active || e.pointerId !== barDrag.pointerId) return;
  setYearFromClientX(e.clientX);
});
function endBarDrag(e) {
  if (!barDrag.active || e.pointerId !== barDrag.pointerId) return;
  barDrag.active = false;
  yearBarTrackEl.releasePointerCapture(e.pointerId);
}
yearBarTrackEl.addEventListener("pointerup", endBarDrag);
yearBarTrackEl.addEventListener("pointercancel", endBarDrag);

// ---------- Year: set / arrows / direct input ----------
function setYear(y) {
  year = clampYear(y);
  renderYearBar();
  renderTopBar();
  renderMap();
  if (openRegion) renderSheet();
}

function bindRepeatButton(el, step) {
  let timer = null;
  const fire = () => setYear(year + step);
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    fire();
    clearTimeout(timer);
    timer = setTimeout(function repeat() {
      fire();
      timer = setTimeout(repeat, 80);
    }, 400);
  });
  const stop = () => clearTimeout(timer);
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  el.addEventListener("pointerleave", stop);
}
bindRepeatButton(yearPrevBtn, -1);
bindRepeatButton(yearNextBtn, 1);

yearDisplayEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  yearInputEl.value = String(year);
  yearBoxEl.classList.add("editing");
  yearInputEl.focus();
  yearInputEl.select();
});
function commitYearInput() {
  const parsed = parseInt(yearInputEl.value, 10);
  if (!Number.isNaN(parsed)) setYear(parsed);
  yearBoxEl.classList.remove("editing");
}
yearInputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commitYearInput(); } });
yearInputEl.addEventListener("blur", commitYearInput);

// ---------- Language ----------
for (const btn of document.querySelectorAll(".langBtn")) {
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    lang = btn.dataset.lang;
    renderTopBar();
    if (openRegion) renderSheet();
  });
}

window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);

// ---------- Boot ----------
fetch("./data.json")
  .then((res) => res.json())
  .then((loaded) => {
    data = loaded;
    resize();
  });
