// Pure, DOM-independent logic: the card data model, position clamping,
// tap-vs-drag gesture classification, z-order, and defensive
// serialize/parse for localStorage. Kept separate from main.js so it can be
// unit tested directly in Node.

export const COLORS = ["#f6efe3", "#eaf1e6", "#e9eef6", "#f5e9ee", "#f2ecf7", "#f7f0e0"];
export const CARD_W = 152;
export const CARD_H = 108;

let idCounter = 0;
export function resetIdCounter(n = 0) { idCounter = n; }

export function createCard({
  title = "", body = "", color = COLORS[0], x = 0, y = 0,
  id = null, createdAt = null, zIndex = 1,
} = {}) {
  return {
    id: id ?? `c${Date.now().toString(36)}${(idCounter++).toString(36)}`,
    title,
    body,
    color,
    x,
    y,
    zIndex,
    createdAt: createdAt ?? Date.now(),
  };
}

// Keeps a card fully inside the given viewport, so a drag toward the edge
// never leaves it partially or fully off-screen (there's no panning/scroll
// canvas in this prototype, so an off-screen card would just be lost).
export function clampPosition(x, y, cardW, cardH, viewportW, viewportH) {
  const maxX = Math.max(0, viewportW - cardW);
  const maxY = Math.max(0, viewportH - cardH);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
}

export function nextZIndex(cards) {
  return cards.reduce((max, c) => Math.max(max, c.zIndex), 0) + 1;
}

export function updateCard(cards, id, patch) {
  return cards.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

export function removeCard(cards, id) {
  return cards.filter((c) => c.id !== id);
}

export function bringToFront(cards, id) {
  const z = nextZIndex(cards);
  return updateCard(cards, id, { zIndex: z });
}

// ---------- Gesture classification ----------
// A tap opens the card; anything that moves further or takes longer is a
// drag. Checked once at pointerup against the whole gesture's totals.
export const GESTURE = {
  TAP_MAX_MOVE_PX: 6,
  TAP_MAX_MS: 400,
};

export function classifyPointerGesture(dx, dy, dt) {
  const dist = Math.hypot(dx, dy);
  if (dist <= GESTURE.TAP_MAX_MOVE_PX && dt <= GESTURE.TAP_MAX_MS) return "tap";
  return "drag";
}

// ---------- Persistence ----------
// Defensive parsing: a corrupted or hand-edited localStorage value should
// degrade to an empty board rather than crash the app on load.
export function serializeCards(cards) {
  return JSON.stringify(cards);
}

export function parseCards(json) {
  if (!json) return [];
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c === "object" && typeof c.id === "string")
    .map((c) => createCard({
      id: c.id,
      title: typeof c.title === "string" ? c.title : "",
      body: typeof c.body === "string" ? c.body : "",
      color: typeof c.color === "string" ? c.color : COLORS[0],
      x: typeof c.x === "number" && Number.isFinite(c.x) ? c.x : 0,
      y: typeof c.y === "number" && Number.isFinite(c.y) ? c.y : 0,
      zIndex: typeof c.zIndex === "number" && Number.isFinite(c.zIndex) ? c.zIndex : 1,
      createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
    }));
}
