// ---------- Pure helpers ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function pointInRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function starsFromRatio(ratio) {
  if (ratio >= 0.85) return 3;
  if (ratio >= 0.6) return 2;
  if (ratio >= 0.3) return 1;
  return 0;
}
function starsFromMistakes(mistakes) {
  if (mistakes === 0) return 3;
  if (mistakes <= 1) return 2;
  if (mistakes <= 3) return 1;
  return 0;
}
function starGlyphs(n) { return "★★★".slice(0, n) + "☆☆☆".slice(0, 3 - n); }

// ---------- Stage metadata ----------
const STAGE_META = [
  { id: "html", title: "HTML配置", desc: "タグを正しい位置にドラッグしよう" },
  { id: "css", title: "CSSスタイリング", desc: "スライダーでお手本の見た目に合わせよう" },
  { id: "js", title: "JS配線", desc: "バグのある行だけタップして直そう" },
  { id: "php", title: "PHPリクエスト仕分け", desc: "届いたリクエストを正しい行き先へドラッグしよう" },
  { id: "ios", title: "iOSアプリ化", desc: "必要なパーツをXcodeプロジェクトに詰め込もう" },
  { id: "review", title: "審査対応", desc: "審査中に届く指摘へすぐ対応しよう" },
];

// ---------- Drag-slot stage (used by html + ios) ----------
function createDragSlotStage(width, height, rng, itemDefs, layout) {
  const slotW = layout.slotW, slotH = layout.slotH;
  const slots = itemDefs.map((def, i) => ({
    id: def.id,
    label: def.label,
    x: layout.slotX(width, i),
    y: layout.slotY(height, i),
    w: slotW,
    h: slotH,
    filled: false,
  }));
  const order = shuffle(itemDefs.map((d) => d.id), rng);
  const chipW = layout.chipW, chipH = layout.chipH;
  const chips = order.map((id, i) => {
    const def = itemDefs.find((d) => d.id === id);
    const homeX = layout.chipHomeX(width, i, order.length);
    const homeY = layout.chipHomeY(height, i);
    return { id, label: def.label, emoji: def.emoji, x: homeX, y: homeY, w: chipW, h: chipH, home: { x: homeX, y: homeY }, placed: false, dragging: false };
  });
  return {
    kind: "dragSlot",
    slots, chips,
    mistakes: 0,
    placedCount: 0,
    dragId: null,
    dragOffset: { dx: 0, dy: 0 },
    done: false,
    stars: 0,
  };
}
function dragSlotHitTest(chips, x, y) {
  for (let i = chips.length - 1; i >= 0; i--) {
    const c = chips[i];
    if (c.placed) continue;
    if (pointInRect(x, y, { x: c.x - c.w / 2, y: c.y - c.h / 2, w: c.w, h: c.h })) return c.id;
  }
  return null;
}
function dragSlotFindSlot(slots, x, y) {
  const pad = 14;
  for (const s of slots) {
    if (s.filled) continue;
    if (pointInRect(x, y, { x: s.x - pad, y: s.y - pad, w: s.w + pad * 2, h: s.h + pad * 2 })) return s;
  }
  return null;
}
function dragSlotPointerDown(state, x, y) {
  const id = dragSlotHitTest(state.chips, x, y);
  if (!id) return;
  const chip = state.chips.find((c) => c.id === id);
  chip.dragging = true;
  state.dragId = id;
  state.dragOffset = { dx: x - chip.x, dy: y - chip.y };
  const idx = state.chips.indexOf(chip);
  state.chips.push(state.chips.splice(idx, 1)[0]);
}
function dragSlotPointerMove(state, x, y) {
  if (!state.dragId) return;
  const chip = state.chips.find((c) => c.id === state.dragId);
  if (!chip) return;
  chip.x = x - state.dragOffset.dx;
  chip.y = y - state.dragOffset.dy;
}
function dragSlotPointerUp(state, x, y) {
  if (!state.dragId) return;
  const chip = state.chips.find((c) => c.id === state.dragId);
  state.dragId = null;
  if (!chip) return;
  chip.dragging = false;
  const slot = dragSlotFindSlot(state.slots, chip.x, chip.y);
  if (slot) {
    if (slot.id === chip.id) {
      slot.filled = true;
      chip.placed = true;
      chip.x = slot.x + slot.w / 2;
      chip.y = slot.y + slot.h / 2;
      state.placedCount++;
      if (state.placedCount === state.slots.length) {
        state.done = true;
        state.stars = starsFromMistakes(state.mistakes);
      }
    } else {
      state.mistakes++;
      chip.x = chip.home.x;
      chip.y = chip.home.y;
    }
  } else {
    chip.x = chip.home.x;
    chip.y = chip.home.y;
  }
}

// ---------- CSS slider-match stage ----------
function randomCssTarget(rng) {
  return {
    hue: Math.floor(rng() * 360),
    size: 30 + Math.floor(rng() * 70),
    radius: Math.floor(rng() * 41),
  };
}
function hueDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
const CSS_TOL = { hue: 14, size: 6, radius: 4 };
function isCssMatched(current, target, tol) {
  return hueDiff(current.hue, target.hue) <= tol.hue &&
    Math.abs(current.size - target.size) <= tol.size &&
    Math.abs(current.radius - target.radius) <= tol.radius;
}
function cssMatchRatio(current, target, tol) {
  const h = clamp(1 - hueDiff(current.hue, target.hue) / (tol.hue * 3), 0, 1);
  const s = clamp(1 - Math.abs(current.size - target.size) / (tol.size * 3), 0, 1);
  const r = clamp(1 - Math.abs(current.radius - target.radius) / (tol.radius * 3), 0, 1);
  return (h + s + r) / 3;
}
function sliderValueFromPointer(px, track, min, max) {
  const t = clamp((px - track.x) / track.w, 0, 1);
  return min + t * (max - min);
}
function createCssStage(width, height, rng) {
  const target = randomCssTarget(rng);
  const trackX = width * 0.18, trackW = width * 0.64;
  const sliders = [
    { key: "hue", min: 0, max: 360, y: height * 0.62, track: { x: trackX, w: trackW } },
    { key: "size", min: 30, max: 100, y: height * 0.70, track: { x: trackX, w: trackW } },
    { key: "radius", min: 0, max: 40, y: height * 0.78, track: { x: trackX, w: trackW } },
  ];
  return {
    kind: "css",
    target,
    current: { hue: 180, size: 60, radius: 20 },
    sliders,
    draggingKey: null,
    totalMs: 18000,
    timeLeftMs: 18000,
    done: false,
    stars: 0,
    matchedOnTime: false,
  };
}
function cssStagePointerDown(state, x, y) {
  for (const s of state.sliders) {
    const r = { x: s.track.x - 10, y: s.y - 16, w: s.track.w + 20, h: 32 };
    if (pointInRect(x, y, r)) {
      state.draggingKey = s.key;
      state.current[s.key] = sliderValueFromPointer(x, s.track, s.min, s.max);
      return;
    }
  }
}
function cssStagePointerMove(state, x) {
  if (!state.draggingKey) return;
  const s = state.sliders.find((sl) => sl.key === state.draggingKey);
  state.current[s.key] = sliderValueFromPointer(x, s.track, s.min, s.max);
}
function cssStagePointerUp(state) { state.draggingKey = null; }
function cssStageUpdate(state, dt) {
  if (state.done) return;
  state.timeLeftMs -= dt;
  if (isCssMatched(state.current, state.target, CSS_TOL)) {
    state.done = true;
    state.matchedOnTime = true;
    const ratio = clamp(state.timeLeftMs / state.totalMs, 0, 1);
    state.stars = starsFromRatio(Math.max(ratio, 0.32));
    return;
  }
  if (state.timeLeftMs <= 0) {
    state.timeLeftMs = 0;
    state.done = true;
    const ratio = Math.min(cssMatchRatio(state.current, state.target, CSS_TOL), 0.75);
    state.stars = starsFromRatio(ratio);
  }
}

// ---------- JS bug-tap stage ----------
function createJsStage(width, height, rng) {
  return {
    kind: "js",
    rng,
    width, height,
    chips: [],
    nextId: 1,
    nextSpawnAt: 400,
    elapsed: 0,
    totalMs: 20000,
    spawnStopMs: 17000,
    spawnIntervalMs: 900,
    lifetimeMs: 1700,
    bugsFixed: 0,
    missedBugs: 0,
    mistakes: 0,
    totalBugs: 0,
    done: false,
    stars: 0,
  };
}
function jsChipHitTest(chips, x, y) {
  for (let i = chips.length - 1; i >= 0; i--) {
    const c = chips[i];
    if (c.resolved) continue;
    if (pointInRect(x, y, { x: c.x - c.w / 2, y: c.y - c.h / 2, w: c.w, h: c.h })) return c;
  }
  return null;
}
function computeRoundScore(fixed, total, mistakes) {
  if (total <= 0) return 1;
  return clamp((fixed - mistakes * 0.5) / total, 0, 1);
}
function jsStagePointerDown(state, x, y) {
  const chip = jsChipHitTest(state.chips, x, y);
  if (!chip) return;
  chip.resolved = true;
  if (chip.isBug) state.bugsFixed++;
  else state.mistakes++;
}
function jsStageUpdate(state, dt) {
  if (state.done) return;
  state.elapsed += dt;
  if (state.elapsed < state.spawnStopMs && state.elapsed >= state.nextSpawnAt) {
    state.nextSpawnAt = state.elapsed + state.spawnIntervalMs;
    const isBug = state.rng() < 0.5;
    if (isBug) state.totalBugs++;
    const lane = Math.floor(state.rng() * 3);
    const chipW = state.width * 0.42, chipH = 46;
    const x = state.width * 0.5;
    const y = state.height * (0.28 + lane * 0.13);
    state.chips.push({ id: state.nextId++, isBug, x, y, w: chipW, h: chipH, spawnTime: state.elapsed, resolved: false });
  }
  for (const c of state.chips) {
    if (c.resolved) continue;
    if (state.elapsed - c.spawnTime > state.lifetimeMs) {
      c.resolved = true;
      if (c.isBug) state.missedBugs++;
    }
  }
  state.chips = state.chips.filter((c) => !c.resolved || state.elapsed - c.spawnTime < state.lifetimeMs + 300);
  if (state.elapsed >= state.totalMs) {
    state.done = true;
    const ratio = computeRoundScore(state.bugsFixed, state.totalBugs, state.mistakes);
    state.stars = starsFromRatio(ratio);
  }
}

// ---------- PHP bucket-sort stage ----------
const PHP_TYPES = [
  { type: "user", label: "User", emoji: "👤" },
  { type: "order", label: "Order", emoji: "🛒" },
  { type: "error", label: "Error", emoji: "⚠️" },
];
function createPhpStage(width, height, rng) {
  const bucketW = width * 0.28, bucketH = height * 0.09;
  const gap = (width - bucketW * 3) / 4;
  const buckets = PHP_TYPES.map((t, i) => ({
    type: t.type, label: t.label, emoji: t.emoji,
    x: gap + i * (bucketW + gap), y: height * 0.80, w: bucketW, h: bucketH,
  }));
  return {
    kind: "php",
    rng, width, height,
    buckets,
    chips: [],
    nextId: 1,
    nextSpawnAt: 300,
    elapsed: 0,
    totalMs: 20000,
    spawnStopMs: 16000,
    spawnIntervalMs: 1100,
    fallSpeed: height * 0.055,
    correct: 0, wrong: 0, missed: 0, total: 0,
    dragId: null,
    dragOffset: { dx: 0, dy: 0 },
    done: false,
    stars: 0,
  };
}
function phpChipHitTest(chips, x, y) {
  for (let i = chips.length - 1; i >= 0; i--) {
    const c = chips[i];
    if (c.resolved) continue;
    if (pointInRect(x, y, { x: c.x - c.w / 2, y: c.y - c.h / 2, w: c.w, h: c.h })) return c;
  }
  return null;
}
function bucketAt(x, y, buckets) {
  for (const b of buckets) {
    if (pointInRect(x, y, { x: b.x, y: b.y, w: b.w, h: b.h })) return b;
  }
  return null;
}
function isCorrectBucket(chipType, bucket) { return !!bucket && chipType === bucket.type; }
function phpStagePointerDown(state, x, y) {
  const chip = phpChipHitTest(state.chips, x, y);
  if (!chip) return;
  chip.dragging = true;
  state.dragId = chip.id;
  state.dragOffset = { dx: x - chip.x, dy: y - chip.y };
}
function phpStagePointerMove(state, x, y) {
  if (!state.dragId) return;
  const chip = state.chips.find((c) => c.id === state.dragId);
  if (!chip) return;
  chip.x = x - state.dragOffset.dx;
  chip.y = y - state.dragOffset.dy;
}
function phpStagePointerUp(state, x, y) {
  if (!state.dragId) return;
  const chip = state.chips.find((c) => c.id === state.dragId);
  state.dragId = null;
  if (!chip) return;
  chip.dragging = false;
  const bucket = bucketAt(x, y, state.buckets);
  if (bucket) {
    chip.resolved = true;
    if (isCorrectBucket(chip.type, bucket)) state.correct++;
    else state.wrong++;
  }
}
function phpStageUpdate(state, dt) {
  if (state.done) return;
  state.elapsed += dt;
  if (state.elapsed < state.spawnStopMs && state.elapsed >= state.nextSpawnAt) {
    state.nextSpawnAt = state.elapsed + state.spawnIntervalMs;
    const def = PHP_TYPES[Math.floor(state.rng() * PHP_TYPES.length)];
    state.total++;
    state.chips.push({
      id: state.nextId++, type: def.type, label: def.label, emoji: def.emoji,
      x: state.width * (0.2 + state.rng() * 0.6), y: state.height * 0.16,
      w: state.width * 0.24, h: 40, dragging: false, resolved: false,
    });
  }
  for (const c of state.chips) {
    if (c.resolved || c.dragging) continue;
    c.y += state.fallSpeed * (dt / 1000);
    if (c.y > state.height * 0.78) {
      c.resolved = true;
      state.missed++;
    }
  }
  state.chips = state.chips.filter((c) => !c.resolved);
  if (state.elapsed >= state.totalMs) {
    state.done = true;
    const ratio = state.total > 0 ? clamp((state.correct - state.wrong * 0.5) / state.total, 0, 1) : 1;
    state.stars = starsFromRatio(ratio);
  }
}

// ---------- App review gauntlet stage ----------
function createReviewStage(width, height) {
  return {
    kind: "review",
    width, height,
    progress: 0,
    totalMs: 12000,
    paused: false,
    issues: [
      { atProgress: 25, triggered: false, resolved: false },
      { atProgress: 55, triggered: false, resolved: false },
      { atProgress: 80, triggered: false, resolved: false },
    ],
    activeIssue: null,
    issueDeadlineMs: 2200,
    issueElapsed: 0,
    handledInTime: 0,
    handledLate: 0,
    done: false,
    stars: 0,
  };
}
function shouldTriggerIssue(progress, issue) { return !issue.triggered && progress >= issue.atProgress; }
function reviewStagePointerDown(state) {
  if (!state.activeIssue) return;
  if (state.issueElapsed <= state.issueDeadlineMs) state.handledInTime++;
  else state.handledLate++;
  state.activeIssue.resolved = true;
  state.activeIssue = null;
  state.paused = false;
}
function reviewStageUpdate(state, dt) {
  if (state.done) return;
  if (state.paused) {
    state.issueElapsed += dt;
    if (state.issueElapsed > state.issueDeadlineMs + 900) {
      state.handledLate++;
      state.activeIssue.resolved = true;
      state.activeIssue = null;
      state.paused = false;
    }
    return;
  }
  state.progress += (100 * dt) / state.totalMs;
  for (const issue of state.issues) {
    if (shouldTriggerIssue(state.progress, issue)) {
      issue.triggered = true;
      state.activeIssue = issue;
      state.paused = true;
      state.issueElapsed = 0;
      break;
    }
  }
  if (state.progress >= 100) {
    state.progress = 100;
    state.done = true;
    const ratio = state.handledInTime / state.issues.length;
    state.stars = starsFromRatio(ratio);
  }
}

// ---------- Final results ----------
function computeDownloads(totalStars) {
  return Math.round(1200 + totalStars * 850 + totalStars * totalStars * 40);
}
function computeRating(totalStars) {
  return Math.min(5, Math.round((2.8 + totalStars * 0.12) * 10) / 10);
}

// ---------- DOM / canvas setup ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const stageTitleEl = document.getElementById("stageTitle");
const stageProgressEl = document.getElementById("stageProgress");
const bannerEl = document.getElementById("banner");
const titleOverlayEl = document.getElementById("titleOverlay");
const stageClearOverlayEl = document.getElementById("stageClearOverlay");
const clearStageTitleEl = document.getElementById("clearStageTitle");
const clearStarsEl = document.getElementById("clearStars");
const clearCommentEl = document.getElementById("clearComment");
const resultsOverlayEl = document.getElementById("resultsOverlay");
const resultStatsEl = document.getElementById("resultStats");
const startBtn = document.getElementById("startBtn");
const nextStageBtn = document.getElementById("nextStageBtn");
const restartBtn = document.getElementById("restartBtn");

let width = 0, height = 0;
function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (stageIndex >= 0 && currentStage) render();
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);

// ---------- Game orchestration ----------
let rngSeed = Date.now() >>> 0;
let stageIndex = -1;
let currentStage = null;
let stageResults = [];
let screen = "title";
let lastTs = 0;
let rafId = null;

function renderStageProgress() {
  stageProgressEl.innerHTML = "";
  STAGE_META.forEach((_, i) => {
    const dot = document.createElement("div");
    dot.className = "dot" + (i < stageResults.length ? " done" : i === stageIndex ? " current" : "");
    stageProgressEl.appendChild(dot);
  });
}

const HTML_ITEMS = [
  { id: "header", label: "header", emoji: "🔷" },
  { id: "nav", label: "nav", emoji: "🧭" },
  { id: "main", label: "main", emoji: "📄" },
  { id: "footer", label: "footer", emoji: "⬛" },
];
const IOS_ITEMS = [
  { id: "icon", label: "AppIcon", emoji: "🎨" },
  { id: "splash", label: "Splash", emoji: "🌅" },
  { id: "plist", label: "Info.plist", emoji: "📋" },
  { id: "build", label: "Build設定", emoji: "⚙️" },
];
function buildDragLayout() {
  return {
    get slotW() { return width * 0.68; },
    get slotH() { return height * 0.075; },
    slotX: (w) => w * 0.16,
    slotY: (h, i) => h * (0.14 + i * 0.095),
    get chipW() { return width * 0.4; },
    get chipH() { return height * 0.06; },
    chipHomeX: (w, i) => (i % 2 === 0) ? w * 0.28 : w * 0.72,
    chipHomeY: (h, i) => h * (0.66 + Math.floor(i / 2) * 0.12),
  };
}

function createStage(id, rng) {
  switch (id) {
    case "html": return createDragSlotStage(width, height, rng, HTML_ITEMS, buildDragLayout());
    case "ios": return createDragSlotStage(width, height, rng, IOS_ITEMS, buildDragLayout());
    case "css": return createCssStage(width, height, rng);
    case "js": return createJsStage(width, height, rng);
    case "php": return createPhpStage(width, height, rng);
    case "review": return createReviewStage(width, height);
    default: throw new Error("unknown stage " + id);
  }
}

function startGame() {
  stageResults = [];
  stageIndex = 0;
  screen = "playing";
  titleOverlayEl.classList.remove("show");
  stageClearOverlayEl.classList.remove("show");
  resultsOverlayEl.classList.remove("show");
  beginStage(stageIndex);
}
function beginStage(i) {
  const meta = STAGE_META[i];
  const rng = mulberry32(rngSeed + i * 7919);
  currentStage = createStage(meta.id, rng);
  stageTitleEl.textContent = meta.title;
  bannerEl.textContent = meta.desc;
  renderStageProgress();
}
function updateStage(dt) {
  if (!currentStage) return;
  switch (currentStage.kind) {
    case "css": cssStageUpdate(currentStage, dt); break;
    case "js": jsStageUpdate(currentStage, dt); break;
    case "php": phpStageUpdate(currentStage, dt); break;
    case "review": reviewStageUpdate(currentStage, dt); break;
    default: break;
  }
  checkStageCompletion();
}
function checkStageCompletion() {
  if (!currentStage || !currentStage.done || screen !== "playing") return;
  screen = "stageClear";
  const meta = STAGE_META[stageIndex];
  stageResults.push({ id: meta.id, stars: currentStage.stars });
  clearStageTitleEl.textContent = `${meta.title} クリア！`;
  clearStarsEl.textContent = starGlyphs(currentStage.stars);
  clearCommentEl.textContent = stageClearComment(currentStage.stars);
  renderStageProgress();
  stageClearOverlayEl.classList.add("show");
}
function stageClearComment(stars) {
  if (stars >= 3) return "完璧な仕事っぷり！";
  if (stars === 2) return "いい感じに仕上がった。";
  if (stars === 1) return "なんとか形になった…次はもっとスムーズに。";
  return "かなり手こずったけど、前には進んだ。";
}
function advanceAfterClear() {
  stageClearOverlayEl.classList.remove("show");
  stageIndex++;
  if (stageIndex >= STAGE_META.length) {
    finishGame();
  } else {
    screen = "playing";
    beginStage(stageIndex);
  }
}
function finishGame() {
  screen = "results";
  const totalStars = stageResults.reduce((s, r) => s + r.stars, 0);
  const downloads = computeDownloads(totalStars);
  const rating = computeRating(totalStars);
  resultStatsEl.innerHTML = `
    <div>合計スター: ${starGlyphs(3)} 換算 ${totalStars} / ${STAGE_META.length * 3}</div>
    <div>初日ダウンロード数: ${downloads.toLocaleString()}</div>
    <div>ストア評価: ${rating.toFixed(1)} / 5.0</div>
  `;
  resultsOverlayEl.classList.add("show");
  stageTitleEl.textContent = "SHIP IT SIM";
  bannerEl.textContent = "";
}
function restartGame() {
  resultsOverlayEl.classList.remove("show");
  rngSeed = Date.now() >>> 0;
  stageIndex = -1;
  currentStage = null;
  screen = "title";
  titleOverlayEl.classList.add("show");
  stageTitleEl.textContent = "SHIP IT SIM";
  bannerEl.textContent = "";
  stageProgressEl.innerHTML = "";
}

// ---------- Rendering ----------
function drawDragSlotStage(state, title) {
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#161b22";
  ctx.fillRect(width * 0.08, height * 0.10, width * 0.84, height * 0.46);
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.strokeRect(width * 0.08, height * 0.10, width * 0.84, height * 0.46);
  for (const s of state.slots) {
    ctx.fillStyle = s.filled ? "rgba(74, 222, 128, 0.18)" : "rgba(255,255,255,0.06)";
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.strokeStyle = s.filled ? "#4ade80" : "rgba(255,255,255,0.3)";
    ctx.setLineDash(s.filled ? [] : [6, 5]);
    ctx.strokeRect(s.x, s.y, s.w, s.h);
    ctx.setLineDash([]);
    if (!s.filled) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = `${Math.round(height * 0.024)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.label, s.x + s.w / 2, s.y + s.h / 2);
    }
  }
  for (const c of state.chips) {
    if (c.placed) continue;
    ctx.save();
    ctx.translate(c.x, c.y);
    if (c.dragging) { ctx.shadowColor = "rgba(76,141,255,0.6)"; ctx.shadowBlur = 18; }
    ctx.fillStyle = c.dragging ? "#4c8dff" : "#2a3140";
    roundRect(ctx, -c.w / 2, -c.h / 2, c.w, c.h, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.round(height * 0.022)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${c.emoji} ${c.label}`, 0, 0);
    ctx.restore();
  }
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function drawCssStage(state) {
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, width, height);
  const previewY = height * 0.22;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `${Math.round(height * 0.02)}px system-ui`;
  ctx.textAlign = "center";
  ctx.fillText("お手本", width * 0.28, previewY - height * 0.06);
  ctx.fillText("あなたの作品", width * 0.72, previewY - height * 0.06);
  drawSwatch(width * 0.28, previewY, state.target);
  drawSwatch(width * 0.72, previewY, state.current);
  const secLeft = Math.max(0, state.timeLeftMs / 1000);
  ctx.fillStyle = secLeft < 5 ? "#ff6b6b" : "#fff";
  ctx.font = `${Math.round(height * 0.03)}px system-ui`;
  ctx.fillText(`残り ${secLeft.toFixed(1)}s`, width * 0.5, height * 0.46);

  const labels = { hue: "色相 (Hue)", size: "サイズ", radius: "角丸" };
  for (const s of state.sliders) {
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(s.track.x, s.y);
    ctx.lineTo(s.track.x + s.track.w, s.y);
    ctx.stroke();
    ctx.lineWidth = 1;
    const t = (state.current[s.key] - s.min) / (s.max - s.min);
    const hx = s.track.x + t * s.track.w;
    ctx.fillStyle = state.draggingKey === s.key ? "#4c8dff" : "#e6edf3";
    ctx.beginPath();
    ctx.arc(hx, s.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `${Math.round(height * 0.018)}px system-ui`;
    ctx.textAlign = "left";
    ctx.fillText(labels[s.key], s.track.x, s.y - 16);
  }
}
function drawSwatch(cx, cy, style) {
  const size = 22 + style.size * 0.5;
  ctx.save();
  ctx.fillStyle = `hsl(${style.hue}, 70%, 55%)`;
  roundRect(ctx, cx - size / 2, cy - size / 2, size, size, style.radius * 0.5);
  ctx.fill();
  ctx.restore();
}
function drawJsStage(state) {
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `${Math.round(height * 0.02)}px system-ui`;
  ctx.textAlign = "center";
  ctx.fillText(`バグ修正 ${state.bugsFixed}/${state.totalBugs}　ミス ${state.mistakes}`, width * 0.5, height * 0.20);
  for (const c of state.chips) {
    if (c.resolved) continue;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.fillStyle = c.isBug ? "#3a1f24" : "#1c2333";
    roundRect(ctx, -c.w / 2, -c.h / 2, c.w, c.h, 8);
    ctx.fill();
    ctx.strokeStyle = c.isBug ? "#ff6b6b" : "rgba(255,255,255,0.2)";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.round(height * 0.02)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(c.isBug ? "🐛 if (x = 1) {" : "if (x === 1) {", 0, 0);
    ctx.restore();
  }
}
function drawPhpStage(state) {
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `${Math.round(height * 0.02)}px system-ui`;
  ctx.textAlign = "center";
  ctx.fillText(`正解 ${state.correct}　誤り ${state.wrong}　見逃し ${state.missed}`, width * 0.5, height * 0.10);
  for (const b of state.buckets) {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, b.x, b.y, b.w, b.h, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.round(height * 0.018)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${b.emoji} ${b.label}`, b.x + b.w / 2, b.y + b.h / 2);
  }
  for (const c of state.chips) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.fillStyle = c.dragging ? "#4c8dff" : "#2a3140";
    roundRect(ctx, -c.w / 2, -c.h / 2, c.w, c.h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.round(height * 0.02)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${c.emoji} ${c.label}`, 0, 0);
    ctx.restore();
  }
}
function drawReviewStage(state) {
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `${Math.round(height * 0.022)}px system-ui`;
  ctx.textAlign = "center";
  ctx.fillText("App Store審査中…", width * 0.5, height * 0.30);
  const barX = width * 0.12, barY = height * 0.35, barW = width * 0.76, barH = 22;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRect(ctx, barX, barY, barW, barH, 11);
  ctx.fill();
  ctx.fillStyle = "#4ade80";
  roundRect(ctx, barX, barY, barW * (state.progress / 100), barH, 11);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.round(height * 0.018)}px system-ui`;
  ctx.fillText(`${Math.floor(state.progress)}%`, width * 0.5, barY + barH + 24);

  if (state.activeIssue) {
    const cx = width * 0.5, cy = height * 0.55;
    ctx.fillStyle = "rgba(255,107,107,0.15)";
    roundRect(ctx, cx - width * 0.38, cy - height * 0.08, width * 0.76, height * 0.16, 14);
    ctx.fill();
    ctx.strokeStyle = "#ff6b6b";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.round(height * 0.02)}px system-ui`;
    ctx.fillText("⚠️ レビュー指摘が届いた！ タップして対応", cx, cy);
    const remain = Math.max(0, (state.issueDeadlineMs - state.issueElapsed) / 1000);
    ctx.fillStyle = remain < 0.8 ? "#ff6b6b" : "rgba(255,255,255,0.7)";
    ctx.fillText(`残り ${remain.toFixed(1)}s`, cx, cy + height * 0.045);
  }
}
function render() {
  if (!currentStage) return;
  switch (currentStage.kind) {
    case "dragSlot": drawDragSlotStage(currentStage); break;
    case "css": drawCssStage(currentStage); break;
    case "js": drawJsStage(currentStage); break;
    case "php": drawPhpStage(currentStage); break;
    case "review": drawReviewStage(currentStage); break;
  }
}

// ---------- Input ----------
function pointerPos(evt) {
  const rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}
function onPointerDown(evt) {
  if (screen !== "playing" || !currentStage) return;
  const { x, y } = pointerPos(evt);
  switch (currentStage.kind) {
    case "dragSlot": dragSlotPointerDown(currentStage, x, y); break;
    case "css": cssStagePointerDown(currentStage, x, y); break;
    case "js": jsStagePointerDown(currentStage, x, y); break;
    case "php": phpStagePointerDown(currentStage, x, y); break;
    case "review": reviewStagePointerDown(currentStage); break;
  }
}
function onPointerMove(evt) {
  if (screen !== "playing" || !currentStage) return;
  const { x, y } = pointerPos(evt);
  switch (currentStage.kind) {
    case "dragSlot": dragSlotPointerMove(currentStage, x, y); break;
    case "css": cssStagePointerMove(currentStage, x); break;
    case "php": phpStagePointerMove(currentStage, x, y); break;
  }
}
function onPointerUp(evt) {
  if (screen !== "playing" || !currentStage) return;
  const { x, y } = pointerPos(evt);
  switch (currentStage.kind) {
    case "dragSlot": dragSlotPointerUp(currentStage, x, y); break;
    case "css": cssStagePointerUp(currentStage); break;
    case "php": phpStagePointerUp(currentStage, x, y); break;
  }
  checkStageCompletion();
  render();
}
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);

startBtn.addEventListener("click", startGame);
nextStageBtn.addEventListener("click", advanceAfterClear);
restartBtn.addEventListener("click", restartGame);

// ---------- Main loop ----------
function loop(ts) {
  const dt = lastTs ? Math.min(50, ts - lastTs) : 16;
  lastTs = ts;
  if (screen === "playing") {
    updateStage(dt);
    render();
  }
  rafId = requestAnimationFrame(loop);
}

resize();
rafId = requestAnimationFrame(loop);
