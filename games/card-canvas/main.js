import {
  COLORS, createCard, clampPosition, nextZIndex, updateCard, removeCard,
  bringToFront, classifyPointerGesture, serializeCards, parseCards, CARD_W, CARD_H,
} from "./cards.js";

const STORAGE_KEY = "card-canvas.cards.v1";

const boardEl = document.getElementById("board");
const emptyHintEl = document.getElementById("emptyHint");
const addBtnEl = document.getElementById("addBtn");
const sheetBackdropEl = document.getElementById("sheetBackdrop");
const editSheetEl = document.getElementById("editSheet");
const editTitleEl = document.getElementById("editTitle");
const editBodyEl = document.getElementById("editBody");
const colorRowEl = document.getElementById("colorRow");
const deleteBtnEl = document.getElementById("deleteBtn");
const closeBtnEl = document.getElementById("closeBtn");

let cards = parseCards(localStorage.getItem(STORAGE_KEY));
const elById = new Map();
let editingId = null;
let editingColor = null;

function saveCards() {
  localStorage.setItem(STORAGE_KEY, serializeCards(cards));
}

function boardSize() {
  return { w: boardEl.clientWidth, h: boardEl.clientHeight };
}

function textOrPlaceholder(el, text, placeholder) {
  if (text) {
    el.textContent = text;
    el.classList.remove("empty");
  } else {
    el.textContent = placeholder;
    el.classList.add("empty");
  }
}

function applyCardStyle(el, card) {
  el.style.left = `${card.x}px`;
  el.style.top = `${card.y}px`;
  el.style.zIndex = String(card.zIndex);
  el.style.background = card.color;
  textOrPlaceholder(el.querySelector(".cardTitle"), card.title, "無題のカード");
  textOrPlaceholder(el.querySelector(".cardBody"), card.body, "");
}

function createCardElement(card) {
  const el = document.createElement("div");
  el.className = "card entering";
  el.dataset.id = card.id;
  const title = document.createElement("p");
  title.className = "cardTitle";
  const body = document.createElement("p");
  body.className = "cardBody";
  el.appendChild(title);
  el.appendChild(body);
  applyCardStyle(el, card);
  boardEl.appendChild(el);
  bindCardGestures(el);
  // Let the "entering" (scaled-down, transparent) state paint once before
  // removing it, so the transition to normal actually animates.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("entering")));
  return el;
}

function renderAll() {
  for (const card of cards) {
    let el = elById.get(card.id);
    if (!el) {
      el = createCardElement(card);
      elById.set(card.id, el);
    } else {
      applyCardStyle(el, card);
    }
  }
  emptyHintEl.classList.toggle("hide", cards.length > 0);
}

// ---------- Card drag / tap ----------
function bindCardGestures(el) {
  const drag = { active: false, confirmed: false, startPageX: 0, startPageY: 0, startCardX: 0, startCardY: 0, startT: 0, pointerId: null };

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const card = cards.find((c) => c.id === el.dataset.id);
    if (!card) return;
    drag.active = true;
    drag.confirmed = false;
    drag.pointerId = e.pointerId;
    drag.startPageX = e.clientX;
    drag.startPageY = e.clientY;
    drag.startCardX = card.x;
    drag.startCardY = card.y;
    drag.startT = performance.now();
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener("pointermove", (e) => {
    if (!drag.active || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startPageX, dy = e.clientY - drag.startPageY;
    if (!drag.confirmed) {
      if (Math.hypot(dx, dy) <= 4) return;
      drag.confirmed = true;
      el.classList.add("dragging");
      raiseCard(el.dataset.id);
    }
    const { w, h } = boardSize();
    const next = clampPosition(drag.startCardX + dx, drag.startCardY + dy, CARD_W, CARD_H, w, h);
    const card = cards.find((c) => c.id === el.dataset.id);
    card.x = next.x;
    card.y = next.y;
    el.style.left = `${next.x}px`;
    el.style.top = `${next.y}px`;
  });

  function endDrag(e) {
    if (!drag.active || e.pointerId !== drag.pointerId) return;
    drag.active = false;
    el.releasePointerCapture(e.pointerId);
    const dx = e.clientX - drag.startPageX, dy = e.clientY - drag.startPageY;
    const dt = performance.now() - drag.startT;
    const gesture = classifyPointerGesture(dx, dy, dt);
    if (drag.confirmed) {
      el.classList.remove("dragging");
      saveCards();
    } else if (gesture === "tap") {
      raiseCard(el.dataset.id);
      saveCards();
      openEditSheet(el.dataset.id);
    }
  }
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
}

function raiseCard(id) {
  cards = bringToFront(cards, id);
  const el = elById.get(id);
  const card = cards.find((c) => c.id === id);
  if (el && card) el.style.zIndex = String(card.zIndex);
}

// ---------- Add ----------
function addCard() {
  const { w, h } = boardSize();
  const jitter = () => (Math.random() - 0.5) * 40;
  const pos = clampPosition(
    w / 2 - CARD_W / 2 + jitter(),
    h / 2 - CARD_H / 2 + jitter(),
    CARD_W, CARD_H, w, h,
  );
  const card = createCard({ x: pos.x, y: pos.y, zIndex: nextZIndex(cards) });
  cards.push(card);
  saveCards();
  const el = createCardElement(card);
  elById.set(card.id, el);
  emptyHintEl.classList.add("hide");
}

addBtnEl.addEventListener("pointerdown", (e) => { e.preventDefault(); addBtnEl.classList.add("pressed"); });
addBtnEl.addEventListener("pointerup", (e) => { e.preventDefault(); addBtnEl.classList.remove("pressed"); addCard(); });
addBtnEl.addEventListener("pointercancel", () => addBtnEl.classList.remove("pressed"));

// ---------- Edit sheet ----------
function renderColorRow() {
  colorRowEl.innerHTML = "";
  for (const color of COLORS) {
    const btn = document.createElement("button");
    btn.className = "swatch";
    btn.style.background = color;
    btn.classList.toggle("selected", color === editingColor);
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      editingColor = color;
      renderColorRow();
    });
    colorRowEl.appendChild(btn);
  }
}

function openEditSheet(id) {
  const card = cards.find((c) => c.id === id);
  if (!card) return;
  editingId = id;
  editingColor = card.color;
  editTitleEl.value = card.title;
  editBodyEl.value = card.body;
  renderColorRow();
  sheetBackdropEl.classList.add("show");
  editSheetEl.classList.add("show");
}

function closeEditSheet() {
  if (editingId) {
    cards = updateCard(cards, editingId, {
      title: editTitleEl.value.trim(),
      body: editBodyEl.value.trim(),
      color: editingColor,
    });
    const el = elById.get(editingId);
    const card = cards.find((c) => c.id === editingId);
    if (el && card) applyCardStyle(el, card);
    saveCards();
  }
  editingId = null;
  sheetBackdropEl.classList.remove("show");
  editSheetEl.classList.remove("show");
}

function deleteEditingCard() {
  if (!editingId) return;
  const id = editingId;
  const el = elById.get(id);
  cards = removeCard(cards, id);
  saveCards();
  sheetBackdropEl.classList.remove("show");
  editSheetEl.classList.remove("show");
  editingId = null;
  if (el) {
    el.classList.add("leaving");
    el.addEventListener("transitionend", () => {
      el.remove();
      elById.delete(id);
      emptyHintEl.classList.toggle("hide", cards.length > 0);
    }, { once: true });
  }
}

closeBtnEl.addEventListener("pointerdown", (e) => { e.preventDefault(); closeEditSheet(); });
deleteBtnEl.addEventListener("pointerdown", (e) => { e.preventDefault(); deleteEditingCard(); });
sheetBackdropEl.addEventListener("pointerdown", (e) => { e.preventDefault(); closeEditSheet(); });

renderAll();
