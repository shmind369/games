// Pure, DOM/Canvas-independent logic for the map view: region blob layout,
// period-based coloring, the pan/zoom camera transform, year-bar and
// zoom-slider coordinate mapping, and UI-chrome i18n strings. Kept separate
// from main.js so it can be unit tested directly in Node.
//
// The historical dataset itself (data.json / history.js) is shared verbatim
// with the sibling world-history-viewer app rather than duplicated.

export const MIN_YEAR = -4000;
export const MAX_YEAR = 2019;

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function clampYear(year) { return Math.round(clamp(year, MIN_YEAR, MAX_YEAR)); }

// ---------- Region layout ----------
// Normalized (0..1) positions on an abstract equirectangular canvas. These
// are schematic blob placements for a small, hand-picked set of regions the
// dataset actually covers, not real coastline geometry — there's no map
// tile imagery to trace here, so the world map is drawn as soft shapes in
// roughly correct relative positions rather than an attempt at real
// cartographic accuracy.
export const REGION_SHAPES = {
  europe: { x: 0.46, y: 0.30, rx: 0.055, ry: 0.06 },
  middleeast: { x: 0.545, y: 0.40, rx: 0.05, ry: 0.05 },
  china: { x: 0.73, y: 0.38, rx: 0.09, ry: 0.08 },
  japan: { x: 0.855, y: 0.34, rx: 0.025, ry: 0.05 },
};

export const PERIOD_COLORS = {
  古代: "#c9a66b",
  中世: "#a65d57",
  近世: "#4f8fa6",
  近代: "#4f6fa6",
  現代: "#4fa672",
};
export const DEFAULT_REGION_COLOR = "#8a8578";

export function colorForPeriod(period) {
  return PERIOD_COLORS[period] || DEFAULT_REGION_COLOR;
}

export function pointInRegionShape(mapX, mapY, shape) {
  const dx = (mapX - shape.x) / shape.rx;
  const dy = (mapY - shape.y) / shape.ry;
  return dx * dx + dy * dy <= 1;
}

// Returns the region id whose blob contains the given normalized map-space
// point, or null. Iterates REGION_SHAPES' own key order, which is fine here
// since none of the hand-placed blobs overlap.
export function hitTestRegion(mapX, mapY, shapes = REGION_SHAPES) {
  for (const [region, shape] of Object.entries(shapes)) {
    if (pointInRegionShape(mapX, mapY, shape)) return region;
  }
  return null;
}

// ---------- Camera (pan/zoom) ----------
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 4;

export function clampZoom(zoom) { return clamp(zoom, MIN_ZOOM, MAX_ZOOM); }

// Keeps the pan offset from dragging the abstract map so far off-screen
// that it can never be recovered: the map's own virtual size scales with
// zoom, and pan is clamped to (roughly) half that size in each direction.
export function clampPan(panX, panY, zoom, mapW, mapH) {
  const maxX = (mapW * zoom) / 2;
  const maxY = (mapH * zoom) / 2;
  return { x: clamp(panX, -maxX, maxX), y: clamp(panY, -maxY, maxY) };
}

// Converts a normalized (0..1) map-space point to screen pixels, given the
// current camera (pan in screen px, zoom scalar) and viewport size.
export function mapToScreen(mapX, mapY, camera, mapW, mapH, viewportW, viewportH) {
  const vx = (mapX - 0.5) * mapW * camera.zoom;
  const vy = (mapY - 0.5) * mapH * camera.zoom;
  return {
    x: viewportW / 2 + vx + camera.panX,
    y: viewportH / 2 + vy + camera.panY,
  };
}

export function screenToMap(screenX, screenY, camera, mapW, mapH, viewportW, viewportH) {
  const vx = screenX - viewportW / 2 - camera.panX;
  const vy = screenY - viewportH / 2 - camera.panY;
  return {
    x: vx / (mapW * camera.zoom) + 0.5,
    y: vy / (mapH * camera.zoom) + 0.5,
  };
}

// ---------- Zoom slider (horizontal track, draggable thumb) ----------
export function zoomFromSliderX(x, trackWidth) {
  const t = clamp(x / trackWidth, 0, 1);
  return MIN_ZOOM + t * (MAX_ZOOM - MIN_ZOOM);
}
export function sliderXFromZoom(zoom, trackWidth) {
  const t = (clampZoom(zoom) - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
  return t * trackWidth;
}

// ---------- Year bar (coarse drag-to-jump) ----------
export function yearFromBarX(x, barWidth) {
  const t = clamp(x / barWidth, 0, 1);
  return clampYear(MIN_YEAR + t * (MAX_YEAR - MIN_YEAR));
}
export function barXFromYear(year, barWidth) {
  const t = (clampYear(year) - MIN_YEAR) / (MAX_YEAR - MIN_YEAR);
  return t * barWidth;
}

// ---------- UI chrome i18n ----------
// Only the app's own chrome (buttons, labels, static copy) is localized.
// The historical dataset (era/person names and descriptions) is authored
// in Japanese only and shown as-is regardless of the selected UI language —
// translating specialized historical terminology accurately into English
// and Chinese is out of scope for this prototype (see README).
export const LANGS = ["ja", "en", "zh"];

const STRINGS = {
  ja: {
    title: "世界歴史地図",
    yearSuffix: "年",
    noFigures: "この年に記録されている人物はいません",
    era: "時代",
    ageSuffix: "歳",
    approxPrefix: "約",
  },
  en: {
    title: "World Historical Atlas",
    yearSuffix: "",
    noFigures: "No recorded figures for this year",
    era: "Era",
    ageSuffix: "",
    approxPrefix: "~",
  },
  zh: {
    title: "世界历史地图",
    yearSuffix: "年",
    noFigures: "该年份没有记录的人物",
    era: "时代",
    ageSuffix: "岁",
    approxPrefix: "约",
  },
};

export function t(lang, key) {
  const table = STRINGS[lang] || STRINGS.ja;
  return table[key] ?? STRINGS.ja[key] ?? key;
}

export function formatYear(year, lang) {
  const y = clampYear(year);
  if (lang === "en") return y < 0 ? `${-y} BCE` : `${y} CE`;
  const suffix = t(lang, "yearSuffix");
  const bcePrefix = lang === "zh" ? "公元前" : "紀元前";
  return y < 0 ? `${bcePrefix}${-y}${suffix}` : `${y}${suffix}`;
}
