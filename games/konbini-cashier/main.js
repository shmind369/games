// ---------- Scope ----------
// A convenience-store cashier simulation for one-handed portrait play:
// scan each item in the current customer's basket by tapping it (running
// subtotal shown live), then re-type that exact total on the numpad to
// check them out. A wrong total costs points and must be corrected before
// the customer can leave. New customers arrive on a timer that speeds up
// the longer you survive; if the queue reaches five people, it's game over.

// ---------- Tuning ----------
const MAX_QUEUE = 5; // reaching this many customers in line ends the game
const ITEM_MIN_COUNT = 1;
const ITEM_MAX_COUNT = 4;
const PRICE_OPTIONS = [98, 108, 128, 158, 178, 198, 258, 298, 320, 380, 420, 480, 580, 680, 780, 980];
const BASE_ARRIVAL_INTERVAL_MS = 7000;
const MIN_ARRIVAL_INTERVAL_MS = 3000;
const ARRIVAL_STEP_PER_SERVED_MS = 250;
const SCORE_PER_CHECKOUT = 30;
const PENALTY_WRONG = 15;
const MAX_INPUT_DIGITS = 6;
const FLASH_MS = 400;

// ---------- Pure logic (no DOM — directly unit testable) ----------
function itemsTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

function isCorrectAmount(inputStr, total) {
  if (inputStr === "") return false;
  return Number(inputStr) === total;
}

function arrivalIntervalForServed(served) {
  return Math.max(MIN_ARRIVAL_INTERVAL_MS, BASE_ARRIVAL_INTERVAL_MS - served * ARRIVAL_STEP_PER_SERVED_MS);
}

function willOverflowQueue(queueLengthBeforeArrival, maxQueue) {
  return queueLengthBeforeArrival + 1 >= maxQueue;
}

// ---------- Random customer generation ----------
let nextCustomerId = 1;
let nextItemId = 1;
function makeCustomer(rng = Math.random) {
  const count = ITEM_MIN_COUNT + Math.floor(rng() * (ITEM_MAX_COUNT - ITEM_MIN_COUNT + 1));
  const items = [];
  for (let i = 0; i < count; i++) {
    const price = PRICE_OPTIONS[Math.floor(rng() * PRICE_OPTIONS.length)];
    items.push({ id: nextItemId++, price, scanned: false });
  }
  return { id: nextCustomerId++, items };
}

// ---------- DOM refs ----------
const scoreEl = document.getElementById("score");
const servedEl = document.getElementById("served");
const queueEl = document.getElementById("queue");
const queueWarnEl = document.getElementById("queueWarn");
const idleMsgEl = document.getElementById("idleMsg");
const subtotalRowEl = document.getElementById("subtotalRow");
const subtotalEl = document.getElementById("subtotal");
const scanHintEl = document.getElementById("scanHint");
const itemGridEl = document.getElementById("itemGrid");
const inputDisplayEl = document.getElementById("inputDisplay");
const numpadGridEl = document.getElementById("numpadGrid");
const checkoutBtn = document.getElementById("checkoutBtn");
const clearBtn = document.getElementById("clearBtn");
const overlayEl = document.getElementById("overlay");
const overlaySubtitleEl = document.getElementById("overlaySubtitle");
const restartBtn = document.getElementById("restartBtn");

// ---------- Game state ----------
let customers = [];
let score = 0;
let served = 0;
let inputValue = "";
let gameOver = false;
let arrivalTimer = 0;
let flashTimer = 0;

function resetGame() {
  customers = [makeCustomer()];
  score = 0;
  served = 0;
  inputValue = "";
  gameOver = false;
  arrivalTimer = 0;
  flashTimer = 0;
  overlayEl.classList.remove("show");
  inputDisplayEl.classList.remove("flashOk", "flashNg");
  render();
}

function currentCustomer() {
  return customers[0] || null;
}

function allScanned(customer) {
  return customer !== null && customer.items.every((item) => item.scanned);
}

// ---------- Rendering ----------
function render() {
  scoreEl.textContent = String(score);
  servedEl.textContent = String(served);

  // Queue strip.
  queueEl.innerHTML = "";
  queueEl.appendChild(queueWarnEl);
  customers.forEach((c, i) => {
    const el = document.createElement("div");
    el.className = "customer-icon" + (i === 0 ? " active" : "");
    el.innerHTML = `<div class="head"></div><div class="body"></div><div class="label">${i === 0 ? "レジ中" : "待ち"}</div>`;
    queueEl.insertBefore(el, queueWarnEl);
  });
  queueWarnEl.classList.toggle("show", customers.length >= MAX_QUEUE - 1 && !gameOver);

  // Basket.
  const cust = currentCustomer();
  if (!cust) {
    idleMsgEl.style.display = "";
    subtotalRowEl.style.display = "none";
    scanHintEl.style.display = "none";
    itemGridEl.style.display = "none";
  } else {
    idleMsgEl.style.display = "none";
    subtotalRowEl.style.display = "";
    scanHintEl.style.display = allScanned(cust) ? "none" : "";
    itemGridEl.style.display = "grid";
    const scannedTotal = itemsTotal(cust.items.filter((i) => i.scanned));
    subtotalEl.textContent = String(scannedTotal);

    itemGridEl.innerHTML = "";
    for (const item of cust.items) {
      const btn = document.createElement("button");
      btn.className = "item-card" + (item.scanned ? " scanned" : "");
      btn.disabled = item.scanned || gameOver;
      btn.innerHTML = `<div class="barcode"></div><div class="price">¥${item.price}</div>`;
      btn.addEventListener("click", () => onScanItem(cust, item));
      itemGridEl.appendChild(btn);
    }
  }

  // Numpad.
  inputDisplayEl.textContent = inputValue === "" ? " " : inputValue;
  const scanned = cust !== null && allScanned(cust);
  for (const btn of numpadGridEl.querySelectorAll(".digit")) {
    btn.disabled = !scanned || gameOver;
  }
  clearBtn.disabled = !scanned || gameOver;
  checkoutBtn.disabled = !scanned || gameOver || inputValue === "";
}

function flashInput(ok) {
  inputDisplayEl.classList.remove("flashOk", "flashNg");
  // Force reflow so re-adding the same class restarts the transition.
  void inputDisplayEl.offsetWidth;
  inputDisplayEl.classList.add(ok ? "flashOk" : "flashNg");
  flashTimer = FLASH_MS;
}

// ---------- Interactions ----------
function onScanItem(customer, item) {
  if (gameOver || item.scanned) return;
  item.scanned = true;
  render();
}

function onDigit(d) {
  if (gameOver || inputValue.length >= MAX_INPUT_DIGITS) return;
  inputValue += d;
  render();
}

function onClear() {
  if (gameOver) return;
  inputValue = "";
  render();
}

function onCheckout() {
  if (gameOver) return;
  const cust = currentCustomer();
  if (!cust || !allScanned(cust) || inputValue === "") return;
  const total = itemsTotal(cust.items);
  if (isCorrectAmount(inputValue, total)) {
    score += SCORE_PER_CHECKOUT;
    served += 1;
    customers.shift();
    inputValue = "";
    flashInput(true);
  } else {
    score = Math.max(0, score - PENALTY_WRONG);
    inputValue = "";
    flashInput(false);
  }
  render();
}

for (const btn of numpadGridEl.querySelectorAll(".digit")) {
  btn.addEventListener("click", () => onDigit(btn.textContent));
}
clearBtn.addEventListener("click", onClear);
checkoutBtn.addEventListener("click", onCheckout);
restartBtn.addEventListener("click", resetGame);

// ---------- Arrivals & game-over check ----------
function spawnArrival() {
  const overflow = willOverflowQueue(customers.length, MAX_QUEUE);
  customers.push(makeCustomer());
  if (overflow) {
    gameOver = true;
    overlaySubtitleEl.textContent = `SCORE: ${score} / 対応済み: ${served}人`;
    overlayEl.classList.add("show");
  }
  render();
}

// ---------- Main loop (drives the arrival timer only; all other state
// changes are event-driven from taps) ----------
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(now - lastTime, 200);
  lastTime = now;

  if (!gameOver) {
    arrivalTimer += dt;
    const interval = arrivalIntervalForServed(served);
    if (arrivalTimer >= interval) {
      arrivalTimer = 0;
      spawnArrival();
    }
  }

  if (flashTimer > 0) {
    flashTimer -= dt;
    if (flashTimer <= 0) {
      inputDisplayEl.classList.remove("flashOk", "flashNg");
    }
  }

  requestAnimationFrame(loop);
}

resetGame();
requestAnimationFrame(loop);
