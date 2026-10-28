// ---------- データモデル ----------
// 1つの「予定」は { id, text, date, startMinutes, durationMinutes } という
// 単純なオブジェクト。date/startMinutesがnullの間は「未配置」として
// 上部の待機トレイに表示され、ドラッグしてカレンダーへ置くと両方に値が入る。
// 所要時間(durationMinutes)は今回のプロトタイプでは固定値のみ対応
// (「予定の所要時間の設定方法」は企画書の今後の検討事項のため)。
const STORAGE_KEY = "drag-magnet-calendar.schedules.v1";
const SNAP_MINUTES = 15;
const DEFAULT_DURATION_MIN = 60;
const HOUR_PX = 56; // 1時間あたりの高さ(px)。時間軸・当日カラムの座標計算の基準
const DAY_MINUTES = 24 * 60;

function loadSchedules() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
function saveSchedules() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
}

let schedules = loadSchedules();
let nextIdCounter = schedules.reduce((m, s) => Math.max(m, parseInt(s.id, 10) || 0), 0) + 1;
function newId() {
  return String(nextIdCounter++);
}

// ---------- 日付ユーティリティ ----------
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
function formatDayLabel(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

let viewDate = startOfDay(new Date());

// ---------- DOM参照 ----------
const newTextEl = document.getElementById("newText");
const addBtnEl = document.getElementById("addBtn");
const pendingTrayEl = document.getElementById("pendingTray");
const pendingHintEl = document.getElementById("pendingHint");
const dayLabelEl = document.getElementById("dayLabel");
const prevDayBtnEl = document.getElementById("prevDayBtn");
const nextDayBtnEl = document.getElementById("nextDayBtn");
const todayBtnEl = document.getElementById("todayBtn");
const calendarScrollEl = document.getElementById("calendarScroll");
const timeAxisEl = document.getElementById("timeAxis");
const dayColumnWrapEl = document.getElementById("dayColumnWrap");
const dayColumnEl = document.getElementById("dayColumn");
const snapIndicatorEl = document.getElementById("snapIndicator");
const unscheduleHintEl = document.getElementById("unscheduleHint");
const dragLayerEl = document.getElementById("dragLayer");
const ghostEl = document.getElementById("ghost");

// ---------- 時間軸(固定の目盛り、1回だけ構築) ----------
const dayHeightPx = DAY_MINUTES / 60 * HOUR_PX;
timeAxisEl.style.height = `${dayHeightPx}px`;
dayColumnWrapEl.style.height = `${dayHeightPx}px`;
dayColumnEl.style.height = `${dayHeightPx}px`;

for (let h = 0; h <= 24; h++) {
  if (h < 24) {
    const label = document.createElement("div");
    label.className = "hourLabel";
    label.style.top = `${h * HOUR_PX}px`;
    label.textContent = `${h}:00`;
    timeAxisEl.appendChild(label);
  }
  if (h > 0) {
    const line = document.createElement("div");
    line.className = "hourLine";
    line.style.top = `${h * HOUR_PX}px`;
    dayColumnWrapEl.appendChild(line);
  }
  if (h < 24) {
    const halfLine = document.createElement("div");
    halfLine.className = "hourLine half";
    halfLine.style.top = `${h * HOUR_PX + HOUR_PX / 2}px`;
    dayColumnWrapEl.appendChild(halfLine);
  }
}

// ---------- 「現在時刻」ライン ----------
const nowLineEl = document.createElement("div");
nowLineEl.id = "nowLine";
dayColumnWrapEl.appendChild(nowLineEl);
function updateNowLine() {
  const now = new Date();
  const isToday = dateKey(now) === dateKey(viewDate);
  if (!isToday) {
    nowLineEl.style.display = "none";
    return;
  }
  nowLineEl.style.display = "block";
  const minutes = now.getHours() * 60 + now.getMinutes();
  nowLineEl.style.top = `${(minutes / 60) * HOUR_PX}px`;
}
setInterval(updateNowLine, 30000);

// ---------- 描画 ----------
const pendingCardEls = new Map(); // id -> element
const scheduledCardEls = new Map();

function render({ animateIds = [] } = {}) {
  dayLabelEl.innerHTML = "";
  const d = viewDate;
  const today = startOfDay(new Date());
  const isToday = d.getTime() === today.getTime();
  dayLabelEl.textContent = `${formatDayLabel(d)} (${WEEKDAY_JA[d.getDay()]})`;
  if (isToday) {
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent = "今日";
    dayLabelEl.appendChild(sub);
  }

  const pending = schedules.filter((s) => !s.date);
  const scheduledToday = schedules.filter((s) => s.date === dateKey(viewDate));

  renderPendingTray(pending, animateIds);
  renderDayColumn(scheduledToday, animateIds);
  updateNowLine();
}

function renderPendingTray(pending, animateIds) {
  pendingHintEl.style.display = pending.length === 0 ? "" : "none";
  const seen = new Set();
  for (const s of pending) {
    seen.add(s.id);
    let el = pendingCardEls.get(s.id);
    if (!el) {
      el = createPendingCardEl(s);
      pendingCardEls.set(s.id, el);
      pendingTrayEl.appendChild(el);
    }
    el.querySelector(".cardText").textContent = s.text;
    if (el.dataset.dragging !== "1") el.style.display = "";
    if (animateIds.includes(s.id)) {
      el.classList.remove("landed");
      void el.offsetWidth;
      el.classList.add("landed");
    }
  }
  for (const [id, el] of pendingCardEls) {
    if (!seen.has(id)) {
      el.remove();
      pendingCardEls.delete(id);
    }
  }
}

function renderDayColumn(scheduledToday, animateIds) {
  const seen = new Set();
  for (const s of scheduledToday) {
    seen.add(s.id);
    let el = scheduledCardEls.get(s.id);
    if (!el) {
      el = createScheduledCardEl(s);
      scheduledCardEls.set(s.id, el);
      dayColumnEl.appendChild(el);
    }
    el.querySelector(".cardTime").textContent = `${formatMinutes(s.startMinutes)}〜`;
    el.querySelector(".cardText").textContent = s.text;
    if (el.dataset.dragging !== "1") {
      el.style.top = `${(s.startMinutes / 60) * HOUR_PX + 2}px`;
      el.style.height = `${(s.durationMinutes / 60) * HOUR_PX - 4}px`;
    }
    if (animateIds.includes(s.id)) {
      el.classList.remove("landed");
      void el.offsetWidth;
      el.classList.add("landed");
    }
  }
  for (const [id, el] of scheduledCardEls) {
    if (!seen.has(id)) {
      el.remove();
      scheduledCardEls.delete(id);
    }
  }
}

function createPendingCardEl(s) {
  const el = document.createElement("div");
  el.className = "card pendingCard";
  el.dataset.id = s.id;
  const text = document.createElement("span");
  text.className = "cardText";
  el.appendChild(text);
  el.appendChild(makeDeleteBtn(s.id));
  bindCardDrag(el, s.id);
  return el;
}
function createScheduledCardEl(s) {
  const el = document.createElement("div");
  el.className = "card scheduledCard";
  el.dataset.id = s.id;
  const time = document.createElement("span");
  time.className = "cardTime";
  const text = document.createElement("span");
  text.className = "cardText";
  el.appendChild(time);
  el.appendChild(text);
  el.appendChild(makeDeleteBtn(s.id));
  bindCardDrag(el, s.id);
  return el;
}
function makeDeleteBtn(id) {
  const btn = document.createElement("div");
  btn.className = "delBtn";
  btn.textContent = "×";
  btn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  btn.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    e.preventDefault();
    deleteSchedule(id);
  });
  return btn;
}

// ---------- 予定の追加・削除 ----------
function addSchedule(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  schedules.push({ id: newId(), text: trimmed, date: null, startMinutes: null, durationMinutes: DEFAULT_DURATION_MIN });
  saveSchedules();
  render({ animateIds: [schedules[schedules.length - 1].id] });
}
function deleteSchedule(id) {
  schedules = schedules.filter((s) => s.id !== id);
  saveSchedules();
  render();
}

addBtnEl.addEventListener("click", () => {
  addSchedule(newTextEl.value);
  newTextEl.value = "";
  newTextEl.focus();
  updateAddBtnState();
});
newTextEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addSchedule(newTextEl.value);
    newTextEl.value = "";
    updateAddBtnState();
  }
});
newTextEl.addEventListener("input", updateAddBtnState);
function updateAddBtnState() {
  addBtnEl.disabled = newTextEl.value.trim().length === 0;
}
updateAddBtnState();

// ---------- 日付ナビゲーション ----------
prevDayBtnEl.addEventListener("click", () => { viewDate = addDays(viewDate, -1); render(); });
nextDayBtnEl.addEventListener("click", () => { viewDate = addDays(viewDate, 1); render(); });
todayBtnEl.addEventListener("click", () => { viewDate = startOfDay(new Date()); render(); });

// ---------- ドラッグ&マグネット ----------
// 「待機トレイのカード」も「配置済みカード」も同じ仕組みでドラッグする。
// ドラッグ中は元の要素を透明にし、フロート表示のゴースト(#ghost)が
// 指に追従する。ゴーストがカレンダーの当日カラム上にある間は、最も近い
// SNAP_MINUTES単位の時刻へ自動的に吸着(スナップ)した位置へアニメーション
// しながら移動する(Ultrahand/スクラビルドのような「吸い付く」感触を
// 意図している)。カラムの外(上部の待機トレイ付近まで指を持ち上げた場合)
// ではスナップせず指にそのまま追従し、離すと未配置(待機トレイ)に戻る。
const DRAG_THRESHOLD_PX = 6;
const EDGE_AUTOSCROLL_PX = 36;
const EDGE_AUTOSCROLL_SPEED = 10;

let drag = null; // { pointerId, id, isNewFromPending, confirmed, startClientX, startClientY, snapped, snappedMinutes, autoScrollTimer }

function bindCardDrag(el, id) {
  el.addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("delBtn")) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* 一部のブラウザ/合成イベントでは失敗することがあるが、ポインタキャプチャなしでも後続のpointermove/upはそのまま要素で拾えるため致命的ではない */ }
    drag = {
      pointerId: e.pointerId,
      id,
      confirmed: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
      snapped: false,
      snappedMinutes: null,
      el,
      autoScrollDir: 0,
      autoScrollRAF: null,
    };
  });
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
}

function getSchedule(id) {
  return schedules.find((s) => s.id === id);
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const dx = e.clientX - drag.startClientX;
  const dy = e.clientY - drag.startClientY;
  if (!drag.confirmed) {
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
    confirmDragStart(e);
  }
  updateGhost(e.clientX, e.clientY);
}

function confirmDragStart(e) {
  drag.confirmed = true;
  const s = getSchedule(drag.id);
  const isPending = !s.date;
  drag.isNewFromPending = isPending;
  drag.el.dataset.dragging = "1";
  drag.el.classList.add("dragging");

  ghostEl.className = "card";
  ghostEl.classList.add("show");
  ghostEl.classList.add(isPending ? "pending" : "scheduled");
  ghostEl.innerHTML = "";
  const time = document.createElement("span");
  time.className = "cardTime";
  time.style.display = isPending ? "none" : "";
  time.textContent = isPending ? "" : `${formatMinutes(s.startMinutes)}〜`;
  ghostEl.appendChild(time);
  const text = document.createElement("span");
  text.textContent = s.text;
  ghostEl.appendChild(text);

  const rect = drag.el.getBoundingClientRect();
  drag.grabOffsetX = e.clientX - rect.left;
  drag.grabOffsetY = e.clientY - rect.top;
  drag.freeWidth = isPending ? 128 : rect.width;
  ghostEl.style.width = `${drag.freeWidth}px`;
  ghostEl.style.left = `${rect.left}px`;
  ghostEl.style.top = `${rect.top}px`;
}

function dayColumnDropInfo(clientX, clientY) {
  // 「カレンダー上にいるか」の判定は、見えているビューポート
  // (calendarScrollEl、スクロールしても矩形自体は動かない)で行う。
  // 一方、実際の時刻(localY)はスクロールされた中身の要素
  // (dayColumnWrapEl)の現在の画面上の位置を基準にする。
  // getBoundingClientRectは常にスクロール後の実際の画面位置を返すため、
  // scrollTopを別途足し引きする必要はない(足すと二重計算になるバグになる)
  const viewportRect = calendarScrollEl.getBoundingClientRect();
  const overCalendar = clientX >= viewportRect.left && clientX <= viewportRect.right && clientY >= viewportRect.top && clientY <= viewportRect.bottom;
  if (!overCalendar) return null;
  const contentRect = dayColumnWrapEl.getBoundingClientRect();
  const localY = clientY - contentRect.top;
  const rawMinutes = (localY / HOUR_PX) * 60;
  let snapped = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
  const s = getSchedule(drag.id);
  const duration = s.durationMinutes || DEFAULT_DURATION_MIN;
  snapped = Math.max(0, Math.min(DAY_MINUTES - duration, snapped));
  return { rect: contentRect, snapped, duration };
}

function updateGhost(clientX, clientY) {
  const info = dayColumnDropInfo(clientX, clientY);
  handleAutoScroll(clientY, info);
  const timeEl = ghostEl.querySelector(".cardTime");
  if (info) {
    if (!drag.snapped) {
      ghostEl.classList.add("snapped");
    }
    drag.snapped = true;
    drag.snappedMinutes = info.snapped;
    ghostEl.classList.remove("pending");
    ghostEl.classList.add("scheduled");
    ghostEl.style.left = `${info.rect.left + 4}px`;
    ghostEl.style.width = `${info.rect.width - 8}px`;
    ghostEl.style.top = `${info.rect.top + (info.snapped / 60) * HOUR_PX + 2}px`;
    if (timeEl) {
      timeEl.style.display = "";
      timeEl.textContent = `${formatMinutes(info.snapped)}〜`;
    }
    snapIndicatorEl.classList.add("show");
    snapIndicatorEl.style.top = `${(info.snapped / 60) * HOUR_PX}px`;
  } else {
    drag.snapped = false;
    ghostEl.classList.remove("snapped");
    ghostEl.classList.toggle("pending", drag.isNewFromPending);
    ghostEl.classList.toggle("scheduled", !drag.isNewFromPending);
    if (timeEl) timeEl.style.display = drag.isNewFromPending ? "none" : "";
    ghostEl.style.width = `${drag.freeWidth}px`;
    ghostEl.style.left = `${clientX - drag.grabOffsetX}px`;
    ghostEl.style.top = `${clientY - drag.grabOffsetY}px`;
    snapIndicatorEl.classList.remove("show");
  }

  const wasScheduled = !drag.isNewFromPending;
  const liftedHighEnough = clientY < 90;
  unscheduleHintEl.classList.toggle("show", wasScheduled && !info && liftedHighEnough);
}

function handleAutoScroll(clientY, info) {
  if (!info) { drag.autoScrollDir = 0; return; }
  const rect = calendarScrollEl.getBoundingClientRect();
  if (clientY < rect.top + EDGE_AUTOSCROLL_PX) drag.autoScrollDir = -1;
  else if (clientY > rect.bottom - EDGE_AUTOSCROLL_PX) drag.autoScrollDir = 1;
  else drag.autoScrollDir = 0;
  if (drag.autoScrollDir !== 0 && !drag.autoScrollRAF) {
    const step = () => {
      if (!drag || drag.autoScrollDir === 0) { drag.autoScrollRAF = null; return; }
      calendarScrollEl.scrollTop += drag.autoScrollDir * EDGE_AUTOSCROLL_SPEED;
      drag.autoScrollRAF = requestAnimationFrame(step);
    };
    drag.autoScrollRAF = requestAnimationFrame(step);
  }
}

function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  try { d.el.releasePointerCapture(e.pointerId); } catch { /* setPointerCaptureが失敗していた場合はこちらも対象なしで失敗するが無害 */ }
  if (d.autoScrollRAF) cancelAnimationFrame(d.autoScrollRAF);
  drag = null;

  ghostEl.classList.remove("show", "snapped", "pending", "scheduled");
  snapIndicatorEl.classList.remove("show");
  unscheduleHintEl.classList.remove("show");
  d.el.classList.remove("dragging");
  delete d.el.dataset.dragging;

  if (!d.confirmed) return; // タップのみ(ドラッグなし)は何もしない

  const s = getSchedule(d.id);
  if (!s) return;

  if (d.snapped && d.snappedMinutes != null) {
    s.date = dateKey(viewDate);
    s.startMinutes = d.snappedMinutes;
  } else {
    s.date = null;
    s.startMinutes = null;
  }
  saveSchedules();
  render({ animateIds: [s.id] });
}

// ---------- 初期描画 ----------
render();

// ---------- テスト/デバッグ用フック ----------
window.__cal = {
  getSchedules: () => schedules.map((s) => ({ ...s })),
  getViewDateKey: () => dateKey(viewDate),
  setViewDateKey: (key) => { viewDate = startOfDay(new Date(`${key}T00:00:00`)); render(); },
  goPrevDay: () => prevDayBtnEl.click(),
  goNextDay: () => nextDayBtnEl.click(),
  goToday: () => todayBtnEl.click(),
  addScheduleDirect: (text) => { addSchedule(text); return schedules[schedules.length - 1].id; },
  deleteScheduleDirect: (id) => deleteSchedule(id),
  getPendingCardRect: (id) => pendingCardEls.get(id)?.getBoundingClientRect().toJSON() ?? null,
  getScheduledCardRect: (id) => scheduledCardEls.get(id)?.getBoundingClientRect().toJSON() ?? null,
  getDayColumnRect: () => dayColumnWrapEl.getBoundingClientRect().toJSON(),
  getCalendarViewportRect: () => calendarScrollEl.getBoundingClientRect().toJSON(),
  getScrollTop: () => calendarScrollEl.scrollTop,
  setScrollTop: (y) => { calendarScrollEl.scrollTop = y; },
  minutesToClientY: (min) => dayColumnWrapEl.getBoundingClientRect().top + (min / 60) * HOUR_PX,
  clientYToMinutes: (clientY) => {
    const rect = dayColumnWrapEl.getBoundingClientRect();
    return ((clientY - rect.top) / HOUR_PX) * 60;
  },
  HOUR_PX,
  SNAP_MINUTES,
  DEFAULT_DURATION_MIN,
  isGhostVisible: () => ghostEl.classList.contains("show"),
  isUnscheduleHintVisible: () => unscheduleHintEl.classList.contains("show"),
  clearAll: () => { schedules = []; saveSchedules(); render(); },
};
