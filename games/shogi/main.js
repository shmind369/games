// ---------- Rules note ----------
// This is a casual, fully-legal implementation of shogi move generation
// (drops, promotion, hand pieces) but intentionally skips check/checkmate/
// repetition/uchifuzume: the game simply ends the instant a king is
// captured. That keeps the scope sane while still being "real" shogi in
// every square-to-square rule that matters during play.

const PIECES = ["FU", "KY", "KE", "GI", "KI", "KA", "HI", "OU"];
const PROMOTABLE = new Set(["FU", "KY", "KE", "GI", "KA", "HI"]);

const GLYPH = {
  FU: "歩", KY: "香", KE: "桂", GI: "銀", KI: "金", KA: "角", HI: "飛",
};
const PROMOTED_GLYPH = {
  FU: "と", KY: "成香", KE: "成桂", GI: "成銀", KA: "馬", HI: "龍",
};
const TWO_CHAR = new Set(["KY", "KE", "GI"]); // promoted forms shown as 2 kanji

// Spoken readings for the kifu read-aloud feature. Kanji piece names are
// ambiguous or just wrong when handed straight to TTS (e.g. 角 as "かど"),
// so the announcement uses these hiragana readings while the board itself
// keeps showing the kanji glyphs above.
const READING = {
  FU: "ふ", KY: "きょう", KE: "けい", GI: "ぎん", KI: "きん", KA: "かく", HI: "ひ",
};
const PROMOTED_READING = {
  FU: "と", KY: "なりきょう", KE: "なりけい", GI: "なりぎん", KA: "うま", HI: "りゅう",
};
const KING_READING = { sente: "おう", gote: "ぎょく" };

const KANJI_DAN = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const SIDE_LABEL = { sente: "先手", gote: "後手" };

const VALUE = { FU: 1, KY: 3, KE: 4, GI: 5, KI: 6, KA: 8, HI: 10, OU: 1000 };
const PROMOTED_VALUE = { FU: 6, KY: 6, KE: 6, GI: 6, KA: 10, HI: 12 };

function valueOf(type, promoted) {
  if (type === "OU") return VALUE.OU;
  return promoted ? PROMOTED_VALUE[type] : VALUE[type];
}

// ---------- Board setup ----------
// board[row][col] = { type, owner: 'sente'|'gote', promoted } | null
// row 0 = gote's back rank (top), row 8 = sente's back rank (bottom, player).
function initialBoard() {
  const b = Array.from({ length: 9 }, () => new Array(9).fill(null));
  const backRow = ["KY", "KE", "GI", "KI", "OU", "KI", "GI", "KE", "KY"];
  for (let c = 0; c < 9; c++) {
    b[0][c] = { type: backRow[c], owner: "gote", promoted: false };
    b[8][c] = { type: backRow[c], owner: "sente", promoted: false };
    b[2][c] = { type: "FU", owner: "gote", promoted: false };
    b[6][c] = { type: "FU", owner: "sente", promoted: false };
  }
  b[1][1] = { type: "HI", owner: "gote", promoted: false };
  b[1][7] = { type: "KA", owner: "gote", promoted: false };
  b[7][1] = { type: "KA", owner: "sente", promoted: false };
  b[7][7] = { type: "HI", owner: "sente", promoted: false };
  return b;
}

function emptyHand() {
  return { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };
}

function inBounds(r, c) {
  return r >= 0 && r < 9 && c >= 0 && c < 9;
}

function promotionZone(owner, r) {
  return owner === "sente" ? r <= 2 : r >= 6;
}

// ---------- Move generation ----------
function pieceMoveSpec(type, promoted, owner) {
  const dr = owner === "sente" ? -1 : 1;
  if (type === "OU") {
    return { step: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]], slide: [], knight: [] };
  }
  if (type === "KI" || (promoted && (type === "FU" || type === "KY" || type === "KE" || type === "GI"))) {
    return { step: [[dr, -1], [dr, 0], [dr, 1], [0, -1], [0, 1], [-dr, 0]], slide: [], knight: [] };
  }
  if (type === "FU") return { step: [[dr, 0]], slide: [], knight: [] };
  if (type === "KY") return { step: [], slide: [[dr, 0]], knight: [] };
  if (type === "KE") return { step: [], slide: [], knight: [[dr * 2, -1], [dr * 2, 1]] };
  if (type === "GI") return { step: [[dr, -1], [dr, 0], [dr, 1], [-dr, -1], [-dr, 1]], slide: [], knight: [] };
  if (type === "KA") {
    const diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    return promoted
      ? { step: [[1, 0], [-1, 0], [0, 1], [0, -1]], slide: diag, knight: [] }
      : { step: [], slide: diag, knight: [] };
  }
  if (type === "HI") {
    const ortho = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    return promoted
      ? { step: [[1, 1], [1, -1], [-1, 1], [-1, -1]], slide: ortho, knight: [] }
      : { step: [], slide: ortho, knight: [] };
  }
  return { step: [], slide: [], knight: [] };
}

// Would this non-promoted piece have zero legal moves if it landed on `r`?
// (used to force promotion so pawns/lances/knights never get stranded)
function wouldBeStuck(type, owner, r) {
  if (type === "FU" || type === "KY") return owner === "sente" ? r === 0 : r === 8;
  if (type === "KE") return owner === "sente" ? r <= 1 : r >= 7;
  return false;
}

function boardMovesForPiece(board, r, c) {
  const piece = board[r][c];
  const spec = pieceMoveSpec(piece.type, piece.promoted, piece.owner);
  const moves = [];

  for (const [dr, dc] of spec.step) {
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    const target = board[nr][nc];
    if (target && target.owner === piece.owner) continue;
    moves.push(makeMove(piece, r, c, nr, nc));
  }
  for (const [dr, dc] of spec.knight) {
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    const target = board[nr][nc];
    if (target && target.owner === piece.owner) continue;
    moves.push(makeMove(piece, r, c, nr, nc));
  }
  for (const [dr, dc] of spec.slide) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const target = board[nr][nc];
      if (target && target.owner === piece.owner) break;
      moves.push(makeMove(piece, r, c, nr, nc));
      if (target) break; // captured an enemy piece, can't continue past it
      nr += dr; nc += dc;
    }
  }
  return moves;
}

function makeMove(piece, r, c, nr, nc) {
  const mustPromote = !piece.promoted && PROMOTABLE.has(piece.type) && wouldBeStuck(piece.type, piece.owner, nr);
  const canPromote =
    !mustPromote && !piece.promoted && PROMOTABLE.has(piece.type) &&
    (promotionZone(piece.owner, r) || promotionZone(piece.owner, nr));
  return {
    kind: "move", from: { r, c }, to: { r: nr, c: nc },
    piece: piece.type, mustPromote, canPromote,
  };
}

function dropMovesForType(board, hands, owner, type) {
  if (hands[owner][type] <= 0) return [];
  const moves = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c]) continue;
      if (type === "FU" || type === "KY") {
        if (owner === "sente" ? r === 0 : r === 8) continue;
      }
      if (type === "KE" && (owner === "sente" ? r <= 1 : r >= 7)) continue;
      if (type === "FU") {
        const hasPawnOnFile = board.some((row) => {
          const p = row[c];
          return p && p.owner === owner && p.type === "FU" && !p.promoted;
        });
        if (hasPawnOnFile) continue;
      }
      moves.push({ kind: "drop", to: { r, c }, piece: type });
    }
  }
  return moves;
}

function generateMoves(board, hands, turn) {
  const moves = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p && p.owner === turn) moves.push(...boardMovesForPiece(board, r, c));
    }
  }
  for (const type of PIECES) {
    if (type === "OU") continue;
    moves.push(...dropMovesForType(board, hands, turn, type));
  }
  return moves;
}

// ---------- Applying moves ----------
function cloneBoard(board) {
  return board.map((row) => row.slice());
}
function cloneHands(hands) {
  return { sente: { ...hands.sente }, gote: { ...hands.gote } };
}

// `move.promote` must already be decided (true/false) before calling this.
function applyMove(board, hands, turn, move) {
  if (move.kind === "drop") {
    board[move.to.r][move.to.c] = { type: move.piece, owner: turn, promoted: false };
    hands[turn][move.piece]--;
    return null;
  }
  const piece = board[move.from.r][move.from.c];
  const captured = board[move.to.r][move.to.c];
  if (captured) hands[turn][captured.type]++;
  board[move.from.r][move.from.c] = null;
  board[move.to.r][move.to.c] = {
    type: piece.type, owner: turn, promoted: piece.promoted || !!move.promote,
  };
  return captured;
}

// ---------- Evaluation & CPU search ----------
function evaluateBoard(board, hands) {
  let score = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p) continue;
      const v = valueOf(p.type, p.promoted);
      score += p.owner === "sente" ? v : -v;
    }
  }
  for (const type of PIECES) {
    if (type === "OU") continue;
    score += hands.sente[type] * VALUE[type] * 0.9;
    score -= hands.gote[type] * VALUE[type] * 0.9;
  }
  return score;
}

// CPU always promotes when eligible (forced or optional) — a reasonable
// simplification since promoting is materially better in nearly all cases.
function decidePromotion(move) {
  return move.mustPromote || move.canPromote;
}

function simulateMove(board, hands, turn, move) {
  const nb = cloneBoard(board);
  const nh = cloneHands(hands);
  const decided = { ...move, promote: decidePromotion(move) };
  applyMove(nb, nh, turn, decided);
  return { board: nb, hands: nh };
}

function chooseCpuMove(board, hands) {
  const cpuMoves = generateMoves(board, hands, "gote");
  if (cpuMoves.length === 0) return null;

  let bestMove = cpuMoves[0];
  let bestScore = Infinity;
  for (const move of cpuMoves) {
    const { board: nb, hands: nh } = simulateMove(board, hands, "gote", move);
    let opponentBest = -Infinity;
    const replies = generateMoves(nb, nh, "sente");
    if (replies.length === 0) {
      opponentBest = evaluateBoard(nb, nh);
    } else {
      for (const reply of replies) {
        const { board: nb2, hands: nh2 } = simulateMove(nb, nh, "sente", reply);
        const val = evaluateBoard(nb2, nh2);
        if (val > opponentBest) opponentBest = val;
      }
    }
    // small random jitter so the CPU doesn't always pick the exact same
    // move among near-equal options
    const jittered = opponentBest + (Math.random() - 0.5) * 0.3;
    if (jittered < bestScore) {
      bestScore = jittered;
      bestMove = move;
    }
  }
  return bestMove;
}

// ---------- Game state ----------
let board = initialBoard();
let hands = { sente: emptyHand(), gote: emptyHand() };
let turn = "sente";
let gameOver = false;
let selected = null; // { kind:'board', r, c, moves } | { kind:'hand', piece, moves }
let pendingPromotionMove = null;
let cpuThinking = false;

const boardEl = document.getElementById("board");
const senteHandEl = document.getElementById("senteHand");
const goteHandEl = document.getElementById("goteHand");
const turnIndicatorEl = document.getElementById("turnIndicator");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlayTitle");
const promptEl = document.getElementById("promotePrompt");
const voiceToggleEl = document.getElementById("voiceToggle");

// ---------- Kifu (game record) read-aloud ----------
// Builds the text handed to speechSynthesis: standard kifu position
// (arabic file number, counted from sente's right, so file = 9 - column;
// kanji rank number, counted from gote's back rank, so rank = row + 1)
// plus the piece's *spoken reading* — hiragana, not the kanji glyph, since
// TTS engines mangle several of these kanji (e.g. 角 as "かど") and the
// readings the board displays aren't necessarily the readings you'd say
// aloud. `piece` is the moving piece's state *before* this move (or null
// for a drop) so a newly-promoting move is read as the base piece + なり,
// not the promoted piece's own reading.
function kifuText(owner, move, piece) {
  const suji = 9 - move.to.c;
  const dan = KANJI_DAN[move.to.r];
  const label = SIDE_LABEL[owner];
  // A full-width comma (rather than a plain space) gives most Japanese TTS
  // voices a natural breath/pause and a bit of pitch movement around it,
  // instead of reading the whole line flat and run-on.
  if (move.kind === "drop") {
    return `${label}、${suji}${dan}${READING[move.piece]}うち`;
  }
  const wasPromoted = piece.promoted;
  const reading = wasPromoted
    ? PROMOTED_READING[piece.type]
    : (piece.type === "OU" ? KING_READING[owner] : READING[piece.type]);
  const promoSuffix = !wasPromoted && move.promote ? "なり" : "";
  return `${label}、${suji}${dan}${reading}${promoSuffix}`;
}

let voiceEnabled = true;
let japaneseVoice = null;
function refreshJapaneseVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  japaneseVoice = voices.find((v) => v.lang === "ja-JP") || voices.find((v) => v.lang?.startsWith("ja")) || null;
}
if ("speechSynthesis" in window) {
  refreshJapaneseVoice();
  window.speechSynthesis.addEventListener("voiceschanged", refreshJapaneseVoice);
}

// `onDone` fires once this utterance has actually finished (or immediately,
// synchronously, if voice is off/unsupported) — callers use it to hold off
// the next side's announcement instead of cutting this one short.
function speak(text, onDone) {
  if (!voiceEnabled || !("speechSynthesis" in window)) {
    onDone?.();
    return;
  }
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ja-JP";
  if (japaneseVoice) utter.voice = japaneseVoice;
  utter.rate = 0.8; // slower and easier to follow than default speed
  utter.pitch = 1.15; // a bit brighter/more animated than the flat default
  utter.onend = () => onDone?.();
  utter.onerror = () => onDone?.();
  window.speechSynthesis.speak(utter);
}

if (voiceToggleEl) {
  voiceToggleEl.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    voiceToggleEl.textContent = voiceEnabled ? "🔊" : "🔇";
    voiceToggleEl.setAttribute("aria-pressed", String(voiceEnabled));
    if (!voiceEnabled && "speechSynthesis" in window) window.speechSynthesis.cancel();
  });
}

function cellKey(r, c) { return `${r},${c}`; }

function render() {
  boardEl.innerHTML = "";
  const targetSet = new Set((selected?.moves ?? []).map((m) => cellKey(m.to.r, m.to.c)));

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.r = r;
      cell.dataset.c = c;
      if (selected?.kind === "board" && selected.r === r && selected.c === c) {
        cell.classList.add("selected");
      }
      if (targetSet.has(cellKey(r, c))) cell.classList.add("target");

      const piece = board[r][c];
      if (piece) {
        const glyphSpan = document.createElement("div");
        const isTwoChar = piece.promoted && TWO_CHAR.has(piece.type);
        glyphSpan.className = "piece" + (piece.owner === "gote" ? " gote" : "") +
          (piece.promoted ? " promoted" : "") + (isTwoChar ? " two-char" : "");
        glyphSpan.textContent = piece.promoted
          ? PROMOTED_GLYPH[piece.type]
          : (piece.type === "OU" ? (piece.owner === "sente" ? "王" : "玉") : GLYPH[piece.type]);
        cell.appendChild(glyphSpan);
      }
      cell.addEventListener("click", () => onCellClick(r, c));
      boardEl.appendChild(cell);
    }
  }

  renderHand(senteHandEl, "sente");
  renderHand(goteHandEl, "gote");

  if (gameOver) {
    turnIndicatorEl.textContent = "終了";
  } else if (cpuThinking) {
    turnIndicatorEl.textContent = "相手（CPU）の番です";
    turnIndicatorEl.classList.add("thinking");
  } else {
    turnIndicatorEl.textContent = turn === "sente" ? "あなたの番です" : "相手（CPU）の番です";
    turnIndicatorEl.classList.remove("thinking");
  }
}

function renderHand(el, owner) {
  el.innerHTML = "";
  for (const type of PIECES) {
    if (type === "OU") continue;
    const count = hands[owner][type];
    if (count <= 0) continue;
    const div = document.createElement("div");
    div.className = "hand-piece";
    if (owner === "sente" && turn === "sente" && !gameOver) div.classList.add("selectable");
    if (selected?.kind === "hand" && selected.piece === type && selected.owner === owner) {
      div.classList.add("selected");
    }
    div.textContent = GLYPH[type];
    const countEl = document.createElement("span");
    countEl.className = "count";
    countEl.textContent = String(count);
    div.appendChild(countEl);
    if (owner === "sente") {
      div.addEventListener("click", (e) => { e.stopPropagation(); onHandClick(type); });
    }
    el.appendChild(div);
  }
}

function clearSelection() {
  selected = null;
}

function onHandClick(type) {
  if (gameOver || turn !== "sente" || cpuThinking) return;
  if (selected?.kind === "hand" && selected.piece === type) {
    clearSelection();
    render();
    return;
  }
  const moves = dropMovesForType(board, hands, "sente", type);
  selected = { kind: "hand", piece: type, owner: "sente", moves };
  render();
}

function onCellClick(r, c) {
  if (gameOver || turn !== "sente" || cpuThinking) return;

  if (selected) {
    const move = selected.moves.find((m) => m.to.r === r && m.to.c === c);
    if (move) {
      executeHumanMove(move);
      return;
    }
  }

  const piece = board[r][c];
  if (piece && piece.owner === "sente") {
    selected = { kind: "board", r, c, moves: boardMovesForPiece(board, r, c) };
  } else {
    clearSelection();
  }
  render();
}

function executeHumanMove(move) {
  if (move.mustPromote) {
    finalizeMove({ ...move, promote: true });
  } else if (move.canPromote) {
    pendingPromotionMove = move;
    promptEl.classList.add("show");
  } else {
    finalizeMove({ ...move, promote: false });
  }
}

document.getElementById("promoteYes").addEventListener("click", () => {
  promptEl.classList.remove("show");
  finalizeMove({ ...pendingPromotionMove, promote: true });
  pendingPromotionMove = null;
});
document.getElementById("promoteNo").addEventListener("click", () => {
  promptEl.classList.remove("show");
  finalizeMove({ ...pendingPromotionMove, promote: false });
  pendingPromotionMove = null;
});

function finalizeMove(move) {
  const mover = turn;
  const movingPiece = move.kind === "move" ? board[move.from.r][move.from.c] : null;
  const captured = applyMove(board, hands, turn, move);
  const text = kifuText(mover, move, movingPiece);
  clearSelection();
  if (captured && captured.type === "OU") {
    speak(text);
    endGame(mover === "sente" ? "あなたの勝ちです" : "CPUの勝ちです");
    return;
  }
  turn = mover === "sente" ? "gote" : "sente";
  render();
  // Only start the CPU's turn once the player's own move has finished
  // being read aloud (plus a short pause), so the two announcements never
  // overlap or cut each other off.
  speak(text, () => {
    if (turn === "gote" && !gameOver) scheduleCpuTurn();
  });
}

const CPU_PAUSE_AFTER_SPEECH_MS = 500;

function scheduleCpuTurn() {
  cpuThinking = true;
  render();
  setTimeout(runCpuTurn, CPU_PAUSE_AFTER_SPEECH_MS);
}

function runCpuTurn() {
  cpuThinking = false;
  if (gameOver) { render(); return; }
  const move = chooseCpuMove(board, hands);
  if (!move) {
    endGame("あなたの勝ちです（CPUが動けません）");
    return;
  }
  const decided = { ...move, promote: decidePromotion(move) };
  const movingPiece = decided.kind === "move" ? board[decided.from.r][decided.from.c] : null;
  const captured = applyMove(board, hands, "gote", decided);
  speak(kifuText("gote", decided, movingPiece));
  if (captured && captured.type === "OU") {
    endGame("CPUの勝ちです");
    return;
  }
  turn = "sente";
  render();
}

function endGame(message) {
  gameOver = true;
  overlayTitleEl.textContent = message;
  overlayEl.classList.add("show");
  render();
}

document.getElementById("restartBtn").addEventListener("click", () => location.reload());

render();
