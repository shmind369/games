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
function manhattan(x1, y1, x2, y2) { return Math.abs(x1 - x2) + Math.abs(y1 - y2); }

// ---------- Map ----------
const GRID_W = 12, GRID_H = 16;
const T = { PLAIN: 0, ROAD: 1, FOREST: 2, MOUNTAIN: 3, RIVER: 4, BRIDGE: 5, CASTLE: 6, RETREAT: 7 };
const TERRAIN_CHAR = { ".": T.PLAIN, r: T.ROAD, f: T.FOREST, m: T.MOUNTAIN, "~": T.RIVER, b: T.BRIDGE, c: T.CASTLE, e: T.RETREAT };
const MAP_ROWS = [
  "mm..cccc..mm",
  "mm..cccc..mm",
  "m....rr....m",
  "m..f.rr.f..m",
  "m..f.rr.f..m",
  "m....rr....m",
  "m...frrf...m",
  "m...frrf...m",
  "m~~~~bb~~~~m",
  "m....rr....m",
  "m..f.rr.f..m",
  "m..f.rr.f..m",
  "m....rr....m",
  "m..........m",
  "mm.eeeeee.mm",
  "mm.eeeeee.mm",
];
function idx(x, y) { return y * GRID_W + x; }
function inBounds(x, y) { return x >= 0 && x < GRID_W && y >= 0 && y < GRID_H; }
function parseMap(rows) {
  const grid = new Uint8Array(GRID_W * GRID_H);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      grid[idx(x, y)] = TERRAIN_CHAR[rows[y][x]];
    }
  }
  return grid;
}
const TERRAIN_INFO = {
  [T.PLAIN]: { moveCost: 1, def: 0, atk: 0, avoid: 0, label: "平地" },
  [T.ROAD]: { moveCost: 1, def: 0, atk: 0, avoid: 0, label: "街道" },
  [T.FOREST]: { moveCost: 2, def: 2, atk: 0, avoid: 15, label: "森林" },
  [T.MOUNTAIN]: { moveCost: 3, def: 3, atk: 0, avoid: 10, label: "山" },
  [T.RIVER]: { moveCost: 3, def: -1, atk: -1, avoid: -10, label: "川" },
  [T.BRIDGE]: { moveCost: 1, def: 0, atk: 0, avoid: 0, label: "橋" },
  [T.CASTLE]: { moveCost: 1, def: 4, atk: 1, avoid: 0, label: "城" },
  [T.RETREAT]: { moveCost: 1, def: 0, atk: 0, avoid: 0, label: "撤退地点" },
};
function terrainInfo(t) { return TERRAIN_INFO[t]; }
function isRetreatTile(t) { return t === T.RETREAT; }

// ---------- Move range (Dijkstra over terrain move cost) ----------
function computeMoveRange(grid, unit, allUnits) {
  const occupied = new Map();
  for (const u of allUnits) {
    if (u.id !== unit.id && u.hp > 0 && !u.escaped) occupied.set(idx(u.x, u.y), u.side);
  }
  const costSoFar = new Map();
  const start = idx(unit.x, unit.y);
  costSoFar.set(start, 0);
  const frontier = [{ x: unit.x, y: unit.y, cost: 0 }];
  const moveCostMod = unit.roadMountainDiscount ? 1 : 0;
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift();
    const curIdx = idx(cur.x, cur.y);
    if (cur.cost > (costSoFar.get(curIdx) ?? Infinity)) continue;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      const occSide = occupied.get(ni);
      if (occSide !== undefined && occSide !== unit.side) continue; // enemy blocks
      const terrain = grid[ni];
      let cost = terrainInfo(terrain).moveCost;
      if (moveCostMod && (terrain === T.ROAD || terrain === T.MOUNTAIN)) cost = Math.max(1, cost - 1);
      const newCost = cur.cost + cost;
      if (newCost > unit.mov) continue;
      if (newCost < (costSoFar.get(ni) ?? Infinity)) {
        costSoFar.set(ni, newCost);
        frontier.push({ x: nx, y: ny, cost: newCost });
      }
    }
  }
  // A tile occupied by an ally cannot be a final stopping point (only passed through).
  const result = new Map();
  for (const [i, cost] of costSoFar) {
    const occSide = occupied.get(i);
    if (occSide !== undefined) continue;
    result.set(i, cost);
  }
  return result;
}
function tilesWithinRange(cx, cy, range) {
  const out = [];
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > range) continue;
      const x = cx + dx, y = cy + dy;
      if (inBounds(x, y)) out.push({ x, y });
    }
  }
  return out;
}
function computeAttackableTargets(moveRangeTiles, unit, allUnits) {
  const targets = new Map(); // enemyId -> best attack-from tile
  const enemies = allUnits.filter((u) => u.side !== unit.side && u.hp > 0 && !u.escaped);
  const moveTiles = [{ x: unit.x, y: unit.y, cost: 0 }, ...Array.from(moveRangeTiles.keys()).map((i) => ({ x: i % GRID_W, y: Math.floor(i / GRID_W) }))];
  for (const mt of moveTiles) {
    for (const e of enemies) {
      if (targets.has(e.id)) continue;
      if (manhattan(mt.x, mt.y, e.x, e.y) <= unit.range && manhattan(mt.x, mt.y, e.x, e.y) > 0) {
        targets.set(e.id, { x: mt.x, y: mt.y });
      }
    }
  }
  return targets;
}

// ---------- Combat math ----------
function effectiveAtk(unit, allUnits) {
  let atk = unit.atk + (unit.atkBuff || 0) - (unit.atkDebuff || 0);
  if (unit.template === "ikeda") {
    const nearbyEnemies = allUnits.filter((u) => u.side !== unit.side && u.hp > 0 && !u.escaped && manhattan(u.x, u.y, unit.x, unit.y) === 1).length;
    if (nearbyEnemies >= 2) atk += 1;
  }
  return atk;
}
function effectiveDef(unit, terrain, allUnits) {
  let def = unit.def + terrainInfo(terrain).def;
  if (unit.template === "hideyoshi" && unit.hp <= unit.maxHp * 0.5) def += 3;
  const allyGuard = allUnits.some((u) => u.template === "ieyasu" && u.side === unit.side && u.id !== unit.id && u.hp > 0 && !u.escaped && manhattan(u.x, u.y, unit.x, unit.y) === 1);
  if (allyGuard) def += 2;
  return def;
}
function computeHitChance(attacker, defender, defenderTerrain) {
  const base = 85 - terrainInfo(defenderTerrain).avoid + (attacker.lv - defender.lv) * 2;
  return clamp(Math.round(base), 10, 95);
}
function computeDamagePreview(attacker, defender, defenderTerrain, allUnits) {
  const atk = effectiveAtk(attacker, allUnits) + terrainInfo(defenderTerrain).atk * 0;
  const def = effectiveDef(defender, defenderTerrain, allUnits);
  return Math.max(1, atk - def);
}
function computeDamageRoll(attacker, defender, defenderTerrain, allUnits, rng) {
  const preview = computeDamagePreview(attacker, defender, defenderTerrain, allUnits);
  const variance = 0.85 + rng() * 0.3;
  return Math.max(1, Math.round(preview * variance));
}
function applyDamage(hp, amount) { return Math.max(0, hp - amount); }
function computeKillChance(hitChance, damage, defenderHp) {
  return damage >= defenderHp ? hitChance : 0;
}

// ---------- Experience / leveling ----------
function xpToNext(level) { return 30 + (level - 1) * 10; }
function expForDamage(damage) { return Math.max(1, Math.round(damage * 0.6)); }
function expForKill(defenderLevel) { return 20 + defenderLevel * 4; }
function applyExp(unit, amount) {
  let xp = unit.xp + amount;
  let level = unit.lv;
  let maxHp = unit.maxHp, atk = unit.atk, def = unit.def, mov = unit.mov;
  let levelsGained = 0;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level++;
    levelsGained++;
    maxHp += 4; atk += 1; def += 1;
    if (levelsGained % 2 === 0) mov += 1;
  }
  return { xp, lv: level, maxHp, atk, def, mov, levelsGained };
}

// ---------- Win / lose ----------
const MAX_TURNS = 15;
const SURVIVOR_THRESHOLD = 4;
function checkOutcome(state) {
  const nobunaga = state.units.find((u) => u.template === "nobunaga");
  if (nobunaga && nobunaga.hp <= 0) return { type: "lose-death" };
  if (nobunaga && nobunaga.escaped) {
    const escapedCount = state.units.filter((u) => u.side === "oda" && u.escaped).length;
    return escapedCount >= SURVIVOR_THRESHOLD ? { type: "win-full", escapedCount } : { type: "win-partial", escapedCount };
  }
  if (state.turn > MAX_TURNS) return { type: "lose-timeout" };
  return null;
}

// ---------- Enemy AI ----------
function pickEnemyAction(unit, grid, allUnits) {
  const moveRange = computeMoveRange(grid, unit, allUnits);
  const targets = computeAttackableTargets(moveRange, unit, allUnits);
  if (targets.size > 0) {
    let bestId = null, bestHp = Infinity;
    for (const [id] of targets) {
      const t = allUnits.find((u) => u.id === id);
      if (t.hp < bestHp) { bestHp = t.hp; bestId = id; }
    }
    return { moveTo: targets.get(bestId), attackId: bestId };
  }
  // No target in range: advance toward the nearest player unit.
  const players = allUnits.filter((u) => u.side === "oda" && u.hp > 0 && !u.escaped);
  if (players.length === 0) return { moveTo: null, attackId: null };
  let nearest = players[0], nearestDist = manhattan(unit.x, unit.y, players[0].x, players[0].y);
  for (const p of players) {
    const d = manhattan(unit.x, unit.y, p.x, p.y);
    if (d < nearestDist) { nearestDist = d; nearest = p; }
  }
  let bestTile = null, bestDist = nearestDist;
  for (const [i] of moveRange) {
    const x = i % GRID_W, y = Math.floor(i / GRID_W);
    const d = manhattan(x, y, nearest.x, nearest.y);
    if (d < bestDist) { bestDist = d; bestTile = { x, y }; }
  }
  return { moveTo: bestTile, attackId: null };
}

// ---------- Unit templates ----------
const ODA_TEMPLATES = [
  { template: "nobunaga", name: "織田信長", cls: "総大将", hp: 32, atk: 11, def: 7, mov: 5, range: 1, skill: "tenkafubu" },
  { template: "hideyoshi", name: "木下藤吉郎", cls: "足軽大将", hp: 26, atk: 8, def: 5, mov: 6, range: 1 },
  { template: "ieyasu", name: "徳川家康", cls: "援軍大将", hp: 30, atk: 8, def: 9, mov: 4, range: 1 },
  { template: "ikeda", name: "池田勝正", cls: "先鋒", hp: 24, atk: 9, def: 6, mov: 5, range: 1 },
  { template: "mitsuhide", name: "明智光秀", cls: "鉄砲大将", hp: 20, atk: 7, def: 4, mov: 4, range: 2 },
  { template: "hisahide", name: "松永久秀", cls: "謀将", hp: 20, atk: 6, def: 4, mov: 4, range: 1, skill: "kakuran" },
  { template: "kutsuki", name: "朽木元綱", cls: "道案内", hp: 22, atk: 7, def: 5, mov: 5, range: 1, roadMountainDiscount: true },
];
const ASAKURA_TEMPLATES = [
  { template: "yoshikage", name: "朝倉義景", cls: "総大将", hp: 34, atk: 10, def: 8, mov: 4, range: 1 },
  { template: "kagetsune", name: "朝倉景恒", cls: "城将", hp: 26, atk: 9, def: 7, mov: 4, range: 1 },
  { template: "ashigaru_a", name: "朝倉兵", cls: "足軽", hp: 14, atk: 6, def: 3, mov: 4, range: 1 },
];
const AZAI_TEMPLATES = [
  { template: "nagamasa", name: "浅井長政", cls: "裏切りの将", hp: 30, atk: 10, def: 7, mov: 5, range: 1 },
  { template: "ashigaru_b", name: "浅井兵", cls: "足軽", hp: 14, atk: 6, def: 3, mov: 4, range: 1 },
];
function makeUnit(nextId, tmpl, side, x, y) {
  return {
    id: nextId, template: tmpl.template, name: tmpl.name, cls: tmpl.cls, side, x, y,
    hp: tmpl.hp, maxHp: tmpl.hp, atk: tmpl.atk, def: tmpl.def, mov: tmpl.mov, range: tmpl.range,
    lv: 1, xp: 0, skill: tmpl.skill || null, skillUsed: false,
    roadMountainDiscount: !!tmpl.roadMountainDiscount,
    atkBuff: 0, buffTurns: 0, atkDebuff: 0, debuffTurns: 0,
    acted: false, escaped: false,
  };
}
function buildInitialUnits() {
  let nid = 1;
  const units = [];
  const odaStart = [[5, 2], [6, 2], [4, 2], [7, 2], [4, 3], [7, 3], [5, 3]];
  ODA_TEMPLATES.forEach((tmpl, i) => units.push(makeUnit(nid++, tmpl, "oda", odaStart[i][0], odaStart[i][1])));
  const asakuraStart = [[5, 1], [6, 1], [3, 0], [8, 0], [4, 1], [7, 1]];
  const asakuraTmpls = [ASAKURA_TEMPLATES[0], ASAKURA_TEMPLATES[1], ASAKURA_TEMPLATES[2], ASAKURA_TEMPLATES[2], ASAKURA_TEMPLATES[2], ASAKURA_TEMPLATES[2]];
  asakuraTmpls.forEach((tmpl, i) => units.push(makeUnit(nid++, tmpl, "asakura", asakuraStart[i][0], asakuraStart[i][1])));
  return { units, nextId: nid };
}
function buildReinforcements(nextId) {
  const positions = [[10, 9], [11, 9], [10, 10]];
  const tmpls = [AZAI_TEMPLATES[0], AZAI_TEMPLATES[1], AZAI_TEMPLATES[1]];
  const units = [];
  let nid = nextId;
  tmpls.forEach((tmpl, i) => units.push(makeUnit(nid++, tmpl, "asakura", positions[i][0], positions[i][1])));
  return { units, nextId: nid };
}

// ---------- Canvas / DOM setup ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const mapAreaEl = document.getElementById("mapArea");
const turnNumEl = document.getElementById("turnNum");
const phaseLabelEl = document.getElementById("phaseLabel");
const bannerEl = document.getElementById("banner");
const unitInfoEl = document.getElementById("unitInfo");
const unitPortraitEl = document.getElementById("unitPortrait");
const endTurnBtn = document.getElementById("endTurnBtn");
const actionMenuEl = document.getElementById("actionMenu");
const actAttackBtn = document.getElementById("actAttackBtn");
const actSkillBtn = document.getElementById("actSkillBtn");
const actWaitBtn = document.getElementById("actWaitBtn");
const actCancelBtn = document.getElementById("actCancelBtn");
const forecastOverlayEl = document.getElementById("forecastOverlay");
const confirmAttackBtn = document.getElementById("confirmAttackBtn");
const cancelAttackBtn = document.getElementById("cancelAttackBtn");
const titleOverlayEl = document.getElementById("titleOverlay");
const resultOverlayEl = document.getElementById("resultOverlay");
const resultTitleEl = document.getElementById("resultTitle");
const resultSubtitleEl = document.getElementById("resultSubtitle");
const startBtn = document.getElementById("startBtn");
const retryBtn = document.getElementById("retryBtn");

let width = 0, height = 0;
let TILE_PX = 34;
function resize() {
  width = mapAreaEl.clientWidth;
  height = mapAreaEl.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  TILE_PX = Math.max(20, Math.floor(width / GRID_W));
  if (game) render();
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);

// ---------- Opening cutscene (Fire Emblem-style chapter intro) ----------
// Oda Nobunaga stays fixed on the right for the whole scene (every line is
// either him or someone reporting to him); whoever else is currently
// speaking occupies the left slot and stays there — dimmed, not hidden —
// while Nobunaga responds, matching how these back-and-forth intros read.
const PORTRAIT_SRC = {
  nobunaga: "assets/portraits/nobunaga.png",
  ieyasu: "assets/portraits/ieyasu.png",
  mitsuhide: "assets/portraits/mitsuhide.png",
  ikeda: "assets/portraits/ikeda.png",
  hideyoshi: "assets/portraits/hideyoshi.png",
  hisahide: "assets/portraits/hisahide.png",
  kutsuki: "assets/portraits/kutsuki.png",
  yoshikage: "assets/portraits/yoshikage.png",
  nagamasa: "assets/portraits/nagamasa.png",
  // kagetsune / ashigaru_a / ashigaru_b have no dedicated art — they fall
  // back to a colored glyph tile (see setPortraitEl) rather than an image.
};
const CHAR_NAMES = {
  nobunaga: "織田信長",
  ieyasu: "徳川家康",
  mitsuhide: "明智光秀",
  ikeda: "池田勝正",
  hideyoshi: "木下藤吉郎",
};
const SCENE_SCRIPT = [
  { speaker: "ieyasu", text: "上様、ご報告申し上げます。\n金ヶ崎城、落ちました。" },
  { speaker: "nobunaga", text: "よし。ならば、このまま越前へ進むぞ。" },
  { speaker: "mitsuhide", text: "……お待ちください、上様。" },
  { speaker: "nobunaga", text: "どうした、光秀。" },
  { speaker: "mitsuhide", text: "何やら……様子がおかしゅうございます。" },
  { speaker: null, text: "――その時。" },
  { speaker: "ikeda", text: "申し上げます！！！" },
  { speaker: "nobunaga", text: "何事だ。" },
  { speaker: "ikeda", text: "浅井軍が……！" },
  { speaker: "ikeda", text: "我らの退路へ向け、進軍しております！" },
  { speaker: "nobunaga", text: "……" },
  { speaker: "nobunaga", text: "ははははは！" },
  { speaker: "nobunaga", text: "長政が、そんな馬鹿なことをするわけがなかろう。" },
  { speaker: "ikeda", text: "……確かでございます！" },
  { speaker: "nobunaga", text: "…………" },
  { speaker: "nobunaga", text: "……馬鹿な。" },
  { speaker: "nobunaga", text: "ありえぬ……。" },
  { speaker: "ieyasu", text: "上様！" },
  { speaker: "ieyasu", text: "一刻の猶予もございませぬ！" },
  { speaker: "ieyasu", text: "このままでは挟み撃ちとなり、我らは全滅でございます！" },
  { speaker: "ieyasu", text: "ご決断を！！" },
  { speaker: "nobunaga", text: "…………" },
  { speaker: "nobunaga", text: "……撤退じゃ。" },
  { speaker: "hideyoshi", text: "お館様！" },
  { speaker: "hideyoshi", text: "ここは、この藤吉郎に殿をお任せくだされ！" },
  { speaker: "nobunaga", text: "……死ぬ気か。" },
  { speaker: "hideyoshi", text: "なんの、この藤吉郎。" },
  { speaker: "hideyoshi", text: "お館様が天下に立たれるまで、死にませぬ。" },
  { speaker: "nobunaga", text: "……そうか。" },
  { speaker: "nobunaga", text: "ならば……" },
  { speaker: "nobunaga", text: "生きて、また会おうぞ。" },
  { speaker: "hideyoshi", text: "はっ！" },
  { speaker: null, text: "――織田軍、撤退開始。" },
];

const dialogueOverlayEl = document.getElementById("dialogueOverlay");
const dlgChapterTitleEl = document.getElementById("dlgChapterTitle");
const dlgPortraitLeftEl = document.getElementById("dlgPortraitLeft");
const dlgPortraitRightEl = document.getElementById("dlgPortraitRight");
const dlgBoxEl = document.getElementById("dlgBox");
const dlgNameEl = document.getElementById("dlgName");
const dlgTextEl = document.getElementById("dlgText");
const dlgSkipBtn = document.getElementById("dlgSkipBtn");

let dlgIndex = 0;
let dlgLeftChar = null;
let dlgRightChar = null;
let dlgOnComplete = null;

function renderDialogueLine() {
  const line = SCENE_SCRIPT[dlgIndex];
  if (line.speaker === null) {
    dlgBoxEl.classList.add("narration");
    dlgNameEl.textContent = "";
    dlgTextEl.textContent = line.text;
    dlgPortraitLeftEl.classList.remove("active");
    dlgPortraitRightEl.classList.remove("active");
    return;
  }
  dlgBoxEl.classList.remove("narration");
  if (line.speaker !== "nobunaga") dlgLeftChar = line.speaker;

  if (dlgLeftChar) {
    dlgPortraitLeftEl.src = PORTRAIT_SRC[dlgLeftChar];
    dlgPortraitLeftEl.classList.remove("hide");
  }
  if (dlgRightChar) {
    dlgPortraitRightEl.src = PORTRAIT_SRC[dlgRightChar];
    dlgPortraitRightEl.classList.remove("hide");
  }
  dlgPortraitLeftEl.classList.toggle("active", line.speaker === dlgLeftChar);
  dlgPortraitRightEl.classList.toggle("active", line.speaker === "nobunaga");
  dlgNameEl.textContent = CHAR_NAMES[line.speaker];
  dlgTextEl.textContent = line.text;
}

function advanceDialogue() {
  dlgIndex++;
  if (dlgIndex >= SCENE_SCRIPT.length) { endScene(); return; }
  renderDialogueLine();
}

function endScene() {
  dialogueOverlayEl.classList.remove("show");
  const cb = dlgOnComplete;
  dlgOnComplete = null;
  if (cb) cb();
}

function playOpeningScene(onComplete) {
  dlgIndex = 0;
  dlgLeftChar = null;
  dlgRightChar = "nobunaga"; // present for the whole scene, revealed on first render
  dlgOnComplete = onComplete;
  dlgChapterTitleEl.textContent = "第十一章　金ヶ崎の退き口";
  dlgPortraitLeftEl.classList.add("hide");
  dlgPortraitRightEl.classList.add("hide");
  dialogueOverlayEl.classList.add("show");
  renderDialogueLine();
}

dialogueOverlayEl.addEventListener("pointerdown", (e) => {
  if (e.target === dlgSkipBtn) return;
  advanceDialogue();
});
dlgSkipBtn.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  endScene();
});

// ---------- Game orchestration ----------
let game = null;
function newGame() {
  const grid = parseMap(MAP_ROWS);
  const { units, nextId } = buildInitialUnits();
  return {
    grid, units, nextId,
    turn: 1, phase: "player", // player | enemy
    reinforced: false,
    selectedId: null, moveRange: null, attackTargets: null, moveOrigin: null, movedTo: null,
    pendingAttack: null, // {attackerId, defenderId}
    pendingSkillTarget: null,
    combatRng: mulberry32(Date.now() >>> 0),
    camY: 0,
    outcome: null,
    log: "",
  };
}
function unitAt(x, y) { return game.units.find((u) => u.x === x && u.y === y && u.hp > 0 && !u.escaped); }
function getUnit(id) { return game.units.find((u) => u.id === id); }

function startGame() {
  game = newGame();
  titleOverlayEl.classList.remove("show");
  resultOverlayEl.classList.remove("show");
  resize();
  updateHud();
  render();
}
function restartGame() {
  resultOverlayEl.classList.remove("show");
  startGame();
}

function setBanner(text) { bannerEl.textContent = text; }
function updateHud() {
  turnNumEl.textContent = game.turn;
  phaseLabelEl.textContent = game.phase === "player" ? "自軍フェイズ" : "敵軍フェイズ";
  phaseLabelEl.className = "phase " + (game.phase === "player" ? "player" : "enemy");
  updateUnitInfo();
}
// Fills a portrait element (either the bottom-panel thumbnail or a battle
// animation slot) with the unit's real portrait art if available, or a
// colored glyph tile (matching the on-map token style) as a fallback for
// templates with no dedicated art (kagetsune, ashigaru_a, ashigaru_b).
function setPortraitEl(el, unit) {
  const src = PORTRAIT_SRC[unit.template];
  // Battle-overlay portrait slots wrap their glyph in a `.glyphText` span
  // that's counter-flipped in CSS when the slot itself is mirrored (see
  // .battlePortraitWrap.flip); the plain bottom-panel thumbnail has no such
  // span and never gets mirrored, so it just falls back to the element itself.
  const glyphTarget = el.querySelector(".glyphText") || el;
  if (src) {
    el.style.backgroundImage = `url(${src})`;
    el.style.backgroundColor = "";
    glyphTarget.textContent = "";
  } else {
    el.style.backgroundImage = "none";
    el.style.backgroundColor = SIDE_COLORS[unit.side];
    glyphTarget.textContent = unitGlyph(unit);
  }
}
function updateUnitInfo() {
  const sel = game.selectedId ? getUnit(game.selectedId) : null;
  if (!sel) {
    unitInfoEl.classList.add("empty");
    unitInfoEl.innerHTML = "ユニットを選択してください";
    unitPortraitEl.classList.remove("show");
    return;
  }
  unitInfoEl.classList.remove("empty");
  unitInfoEl.innerHTML = `
    <div class="name">${sel.name}<span class="cls">${sel.cls}</span></div>
    <div>HP ${sel.hp}/${sel.maxHp}</div>
    <div>Lv ${sel.lv}</div>
    <div>攻撃 ${sel.atk}</div>
    <div>防御 ${sel.def}</div>
    <div>移動 ${sel.mov}</div>
  `;
  setPortraitEl(unitPortraitEl, sel);
  unitPortraitEl.classList.add("show");
}

// ---------- Selection / movement flow ----------
function selectUnit(unit) {
  game.selectedId = unit.id;
  game.moveOrigin = { x: unit.x, y: unit.y };
  game.moveRange = computeMoveRange(game.grid, unit, game.units);
  game.attackTargets = computeAttackableTargets(game.moveRange, unit, game.units);
  game.movedTo = null;
  hideActionMenu();
  updateUnitInfo();
  render();
}
function deselect() {
  game.selectedId = null;
  game.moveRange = null;
  game.attackTargets = null;
  game.moveOrigin = null;
  game.movedTo = null;
  hideActionMenu();
  updateUnitInfo();
  render();
}
function tryMoveSelectedTo(x, y) {
  const unit = getUnit(game.selectedId);
  const tileIdx = idx(x, y);
  const inRange = tileIdx === idx(unit.x, unit.y) || game.moveRange.has(tileIdx);
  if (!inRange) return false;
  unit.x = x; unit.y = y;
  game.movedTo = { x, y };
  game.attackTargets = computeAttackableTargets(new Map([[tileIdx, 0]]), unit, game.units);
  showActionMenu(unit);
  render();
  return true;
}
function showActionMenu(unit) {
  const hasTargets = game.attackTargets.size > 0;
  actAttackBtn.disabled = !hasTargets;
  const canSkill = unit.skill && !unit.skillUsed;
  actSkillBtn.style.display = canSkill ? "block" : "none";
  actionMenuEl.classList.add("show");
  const px = clamp((unit.x + 0.5) * TILE_PX, 60, width - 60);
  const py = clamp((unit.y - game.camY + 0.5) * TILE_PX, 10, height - 120);
  actionMenuEl.style.left = `${px - 55}px`;
  actionMenuEl.style.top = `${py}px`;
}
function hideActionMenu() { actionMenuEl.classList.remove("show"); }

function confirmWait() {
  const unit = getUnit(game.selectedId);
  unit.acted = true;
  if (isRetreatTile(game.grid[idx(unit.x, unit.y)]) && unit.side === "oda") {
    unit.escaped = true;
    setBanner(`${unit.name}が撤退した！`);
  }
  deselect();
  checkAndAdvance();
}
function cancelMove() {
  const unit = getUnit(game.selectedId);
  if (game.moveOrigin) { unit.x = game.moveOrigin.x; unit.y = game.moveOrigin.y; }
  selectUnit(unit);
}
function openAttackTargeting() {
  hideActionMenu();
  render();
}
function beginAttack(defenderId) {
  game.pendingAttack = { attackerId: game.selectedId, defenderId };
  showForecast(getUnit(game.selectedId), getUnit(defenderId));
}
function showForecast(attacker, defender) {
  const defTerrain = game.grid[idx(defender.x, defender.y)];
  const atkTerrain = game.grid[idx(attacker.x, attacker.y)];
  const hitA = computeHitChance(attacker, defender, defTerrain);
  const dmgA = computeDamagePreview(attacker, defender, defTerrain, game.units);
  const killA = computeKillChance(hitA, dmgA, defender.hp);
  document.getElementById("fAtkName").textContent = attacker.name;
  document.getElementById("fAtkPower").textContent = effectiveAtk(attacker, game.units);
  document.getElementById("fAtkHit").textContent = `${hitA}%`;
  document.getElementById("fAtkDmg").textContent = dmgA;
  document.getElementById("fAtkKill").textContent = `${killA}%`;
  document.getElementById("fDefName").textContent = defender.name;
  document.getElementById("fDefPower").textContent = effectiveDef(defender, defTerrain, game.units);
  const canCounter = manhattan(attacker.x, attacker.y, defender.x, defender.y) <= defender.range;
  if (canCounter && dmgA < defender.hp) {
    const hitD = computeHitChance(defender, attacker, atkTerrain);
    const dmgD = computeDamagePreview(defender, attacker, atkTerrain, game.units);
    const killD = computeKillChance(hitD, dmgD, attacker.hp);
    document.getElementById("fDefHit").textContent = `${hitD}%`;
    document.getElementById("fDefDmg").textContent = dmgD;
    document.getElementById("fDefKill").textContent = `${killD}%`;
  } else {
    document.getElementById("fDefHit").textContent = "-";
    document.getElementById("fDefDmg").textContent = "-";
    document.getElementById("fDefKill").textContent = "反撃不可";
  }
  forecastOverlayEl.classList.add("show");
}
function cancelForecast() {
  game.pendingAttack = null;
  forecastOverlayEl.classList.remove("show");
  const unit = getUnit(game.selectedId);
  showActionMenu(unit);
}
// Applies the full attack + optional-counter exchange exactly as before
// (same RNG draw order, same mutations, same banner text), but also returns
// a structured step list describing what happened, so a battle animation
// can play through the exchange visually without re-deriving or re-rolling
// anything — the steps are a record of the mutation that already happened,
// not a separate simulation.
function resolveCombat(attackerId, defenderId) {
  const attacker = getUnit(attackerId), defender = getUnit(defenderId);
  const defTerrain = game.grid[idx(defender.x, defender.y)];
  const atkTerrain = game.grid[idx(attacker.x, attacker.y)];
  const steps = [];
  const hitA = computeHitChance(attacker, defender, defTerrain);
  let msg = "";
  if (game.combatRng() * 100 < hitA) {
    const dmg = computeDamageRoll(attacker, defender, defTerrain, game.units, game.combatRng);
    defender.hp = applyDamage(defender.hp, dmg);
    const gained = applyExp(attacker, expForDamage(dmg));
    Object.assign(attacker, gained);
    msg = `${attacker.name}の攻撃！ ${dmg}ダメージ`;
    steps.push({ actorId: attackerId, targetId: defenderId, hit: true, damage: dmg, targetHpAfter: defender.hp, defeated: false });
  } else {
    msg = `${attacker.name}の攻撃は外れた`;
    steps.push({ actorId: attackerId, targetId: defenderId, hit: false, damage: 0, targetHpAfter: defender.hp, defeated: false });
  }
  if (defender.hp <= 0) {
    const gained = applyExp(attacker, expForKill(defender.lv));
    Object.assign(attacker, gained);
    msg = `${msg}／${defender.name}を撃破！`;
    steps[steps.length - 1].defeated = true;
    setBanner(msg);
    return { steps, message: msg };
  }
  if (manhattan(attacker.x, attacker.y, defender.x, defender.y) <= defender.range) {
    const hitD = computeHitChance(defender, attacker, atkTerrain);
    if (game.combatRng() * 100 < hitD) {
      const dmg2 = computeDamageRoll(defender, attacker, atkTerrain, game.units, game.combatRng);
      attacker.hp = applyDamage(attacker.hp, dmg2);
      const gained2 = applyExp(defender, expForDamage(dmg2));
      Object.assign(defender, gained2);
      msg += `／反撃！ ${dmg2}ダメージ`;
      steps.push({ actorId: defenderId, targetId: attackerId, hit: true, damage: dmg2, targetHpAfter: attacker.hp, defeated: false });
      if (attacker.hp <= 0) {
        const gained3 = applyExp(defender, expForKill(attacker.lv));
        Object.assign(defender, gained3);
        msg += `／${attacker.name}を撃破！`;
        steps[steps.length - 1].defeated = true;
      }
    } else {
      msg += "／反撃は外れた";
      steps.push({ actorId: defenderId, targetId: attackerId, hit: false, damage: 0, targetHpAfter: attacker.hp, defeated: false });
    }
  }
  setBanner(msg);
  return { steps, message: msg };
}
function confirmAttack() {
  const { attackerId, defenderId } = game.pendingAttack;
  forecastOverlayEl.classList.remove("show");
  game.pendingAttack = null;
  playBattleAnimation(attackerId, defenderId, () => {
    const attacker = getUnit(attackerId);
    if (attacker.hp > 0) attacker.acted = true;
    deselect();
    checkAndAdvance();
  });
}

// ---------- Battle animation (simple Fire Emblem-style attack exchange) ----------
const battleOverlayEl = document.getElementById("battleOverlay");
const battleLeftPortraitEl = document.getElementById("battleLeftPortrait");
const battleRightPortraitEl = document.getElementById("battleRightPortrait");
const battleLeftNameEl = document.getElementById("battleLeftName");
const battleRightNameEl = document.getElementById("battleRightName");
const battleLeftHpFillEl = document.getElementById("battleLeftHpFill");
const battleRightHpFillEl = document.getElementById("battleRightHpFill");
const battleLeftDamageEl = document.getElementById("battleLeftDamage");
const battleRightDamageEl = document.getElementById("battleRightDamage");

function setHpFillEl(el, hp, maxHp) {
  const ratio = clamp(hp / maxHp, 0, 1);
  el.style.width = `${ratio * 100}%`;
  el.classList.toggle("low", ratio > 0.25 && ratio <= 0.5);
  el.classList.toggle("critical", ratio <= 0.25);
}
function showDamageNumber(el, text, isMiss) {
  el.textContent = text;
  el.classList.remove("show");
  void el.offsetWidth; // restart the CSS animation even if it's showing the same text again
  el.classList.toggle("miss", !!isMiss);
  el.classList.add("show");
}

// Attacker is always drawn on the left, defender on the right — the portrait
// wrap on the right side is CSS-mirrored (scaleX(-1)) so both face each
// other, same convention as the opening cutscene. The lunge/shake/flash
// classes go on the *inner* (unmirrored) element, so "lunge forward" always
// just means translateX(+16px) in local space: on the left that reads as
// moving toward the center on screen, and on the mirrored right side the
// same local translate also reads as moving toward the center — no
// side-specific animation variants needed.
function playBattleAnimation(attackerId, defenderId, onComplete) {
  const attackerBefore = { ...getUnit(attackerId) };
  const defenderBefore = { ...getUnit(defenderId) };

  const result = resolveCombat(attackerId, defenderId); // mutates game state, returns the step log

  battleLeftNameEl.textContent = attackerBefore.name;
  battleRightNameEl.textContent = defenderBefore.name;
  setPortraitEl(battleLeftPortraitEl, attackerBefore);
  setPortraitEl(battleRightPortraitEl, defenderBefore);
  battleLeftPortraitEl.className = "battlePortraitInner";
  battleRightPortraitEl.className = "battlePortraitInner";
  battleLeftDamageEl.classList.remove("show");
  battleRightDamageEl.classList.remove("show");
  setHpFillEl(battleLeftHpFillEl, attackerBefore.hp, attackerBefore.maxHp);
  setHpFillEl(battleRightHpFillEl, defenderBefore.hp, defenderBefore.maxHp);
  battleOverlayEl.classList.add("show");

  const hpTrack = { [attackerId]: attackerBefore.hp, [defenderId]: defenderBefore.hp };
  const maxHpTrack = { [attackerId]: attackerBefore.maxHp, [defenderId]: defenderBefore.maxHp };

  function playStep(i) {
    if (i >= result.steps.length) {
      setTimeout(() => {
        battleOverlayEl.classList.remove("show");
        onComplete();
      }, 380);
      return;
    }
    const step = result.steps[i];
    const actorIsAttacker = step.actorId === attackerId;
    const actorPortrait = actorIsAttacker ? battleLeftPortraitEl : battleRightPortraitEl;
    const targetPortrait = actorIsAttacker ? battleRightPortraitEl : battleLeftPortraitEl;
    const targetHpFill = actorIsAttacker ? battleRightHpFillEl : battleLeftHpFillEl;
    const targetDamageEl = actorIsAttacker ? battleRightDamageEl : battleLeftDamageEl;

    actorPortrait.classList.add("lunge-forward");
    setTimeout(() => {
      actorPortrait.classList.remove("lunge-forward");
      if (step.hit) {
        targetPortrait.classList.add("flash", "shake");
        showDamageNumber(targetDamageEl, `-${step.damage}`, false);
        setTimeout(() => targetPortrait.classList.remove("flash"), 130);
        setTimeout(() => targetPortrait.classList.remove("shake"), 320);
      } else {
        showDamageNumber(targetDamageEl, "MISS", true);
      }
      hpTrack[step.targetId] = step.targetHpAfter;
      setHpFillEl(targetHpFill, hpTrack[step.targetId], maxHpTrack[step.targetId]);
      if (step.defeated) {
        setTimeout(() => targetPortrait.classList.add("defeated"), 200);
      }
      setTimeout(() => playStep(i + 1), 650);
    }, 150);
  }
  playStep(0);
}

function useSkill() {
  const unit = getUnit(game.selectedId);
  if (unit.skill === "tenkafubu") {
    unit.atkBuff = 4; unit.buffTurns = 3; unit.skillUsed = true;
    setBanner(`${unit.name}「天下布武」発動！ 攻撃力上昇`);
    unit.acted = true;
    deselect();
    checkAndAdvance();
  } else if (unit.skill === "kakuran") {
    game.pendingSkillTarget = unit.id;
    hideActionMenu();
    setBanner("攪乱の対象となる敵をタップ");
    render();
  }
}
function applyKakuranTo(targetId) {
  const user = getUnit(game.pendingSkillTarget);
  const target = getUnit(targetId);
  if (manhattan(user.x, user.y, target.x, target.y) > user.range + 1) return;
  target.atkDebuff = 3; target.debuffTurns = 2;
  user.skillUsed = true;
  user.acted = true;
  setBanner(`${user.name}「攪乱」！ ${target.name}の攻撃力を下げた`);
  game.pendingSkillTarget = null;
  deselect();
  checkAndAdvance();
}

function checkAndAdvance() {
  const outcome = checkOutcome(game);
  if (outcome) { finishGame(outcome); return; }
  updateHud();
  render();
  const remaining = game.units.filter((u) => u.side === "oda" && u.hp > 0 && !u.escaped && !u.acted);
  if (remaining.length === 0 && game.phase === "player") endPlayerTurn();
}

function endPlayerTurn() {
  deselect();
  game.phase = "enemy";
  updateHud();
  setBanner("敵軍フェイズ");
  render();
  setTimeout(runEnemyPhase, 300);
}
function runEnemyPhase() {
  const enemies = game.units.filter((u) => u.side === "asakura" && u.hp > 0);
  let i = 0;
  function step() {
    if (i >= enemies.length) { finishEnemyPhase(); return; }
    const unit = enemies[i++];
    if (unit.hp <= 0) { setTimeout(step, 10); return; }
    const action = pickEnemyAction(unit, game.grid, game.units);
    if (action.moveTo) { unit.x = action.moveTo.x; unit.y = action.moveTo.y; }
    render();
    if (action.attackId) {
      playBattleAnimation(unit.id, action.attackId, () => {
        render();
        const outcome = checkOutcome(game);
        if (outcome) { finishGame(outcome); return; }
        setTimeout(step, 220);
      });
    } else {
      const outcome = checkOutcome(game);
      if (outcome) { finishGame(outcome); return; }
      setTimeout(step, 220);
    }
  }
  step();
}
function finishEnemyPhase() {
  game.turn++;
  game.phase = "player";
  for (const u of game.units) {
    u.acted = false;
    if (u.buffTurns > 0) { u.buffTurns--; if (u.buffTurns === 0) u.atkBuff = 0; }
    if (u.debuffTurns > 0) { u.debuffTurns--; if (u.debuffTurns === 0) u.atkDebuff = 0; }
  }
  if (!game.reinforced && game.turn >= 4) {
    const { units, nextId } = buildReinforcements(game.nextId);
    game.units.push(...units);
    game.nextId = nextId;
    game.reinforced = true;
    setBanner("浅井長政、裏切りて来襲！");
  } else {
    setBanner("");
  }
  const outcome = checkOutcome(game);
  if (outcome) { finishGame(outcome); return; }
  updateHud();
  render();
}
function finishGame(outcome) {
  game.outcome = outcome;
  const titles = {
    "win-full": "完全勝利", "win-partial": "辛勝",
    "lose-death": "信長討死", "lose-timeout": "退路を断たれた",
  };
  const subs = {
    "win-full": `信長を含む${outcome.escapedCount}名が無事に撤退した。織田軍は再起を期す。`,
    "win-partial": `信長は撤退したが、生還したのは${outcome.escapedCount}名のみだった。`,
    "lose-death": "織田信長、討死。",
    "lose-timeout": "敵軍に完全に包囲され、退路を断たれた。",
  };
  resultTitleEl.textContent = titles[outcome.type];
  resultSubtitleEl.textContent = subs[outcome.type];
  resultOverlayEl.classList.add("show");
}

// ---------- Camera ----------
function updateCamera() {
  const sel = game.selectedId ? getUnit(game.selectedId) : null;
  const focusY = sel ? sel.y : (game.units.find((u) => u.template === "nobunaga") || { y: 2 }).y;
  const visibleRows = Math.ceil(height / TILE_PX);
  let camY = focusY - Math.floor(visibleRows / 2);
  camY = clamp(camY, 0, Math.max(0, GRID_H - visibleRows));
  game.camY = camY;
}

// ---------- Rendering ----------
const TERRAIN_COLORS = {
  [T.PLAIN]: "#6f8f4a", [T.ROAD]: "#c9b48a", [T.FOREST]: "#3f6b3a",
  [T.MOUNTAIN]: "#7a7166", [T.RIVER]: "#3a6ea8", [T.BRIDGE]: "#a9784f",
  [T.CASTLE]: "#8f7a5a", [T.RETREAT]: "#e0c060",
};
const SIDE_COLORS = { oda: "#e05a4c", asakura: "#3d5fa8" };
// A per-template glyph map avoids collisions that a "last character of the
// name" heuristic would hit (e.g. 明智光秀/松永久秀 both end in 秀).
const UNIT_GLYPH = {
  nobunaga: "信", hideyoshi: "藤", ieyasu: "家", ikeda: "池",
  mitsuhide: "光", hisahide: "久", kutsuki: "朽",
  yoshikage: "義", kagetsune: "恒", ashigaru_a: "兵",
  nagamasa: "政", ashigaru_b: "兵",
};
function unitGlyph(unit) { return UNIT_GLYPH[unit.template] || unit.name[unit.name.length - 1]; }
function render() {
  if (!game) return;
  updateCamera();
  ctx.clearRect(0, 0, width, height);
  const visibleRows = Math.ceil(height / TILE_PX) + 1;
  for (let ty = 0; ty < visibleRows; ty++) {
    const gy = game.camY + ty;
    if (gy >= GRID_H) continue;
    for (let gx = 0; gx < GRID_W; gx++) {
      const terrain = game.grid[idx(gx, gy)];
      const px = gx * TILE_PX, py = ty * TILE_PX;
      ctx.fillStyle = TERRAIN_COLORS[terrain];
      ctx.fillRect(px, py, TILE_PX, TILE_PX);
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.strokeRect(px, py, TILE_PX, TILE_PX);
    }
  }
  if (game.moveRange) {
    ctx.fillStyle = "rgba(80,150,255,0.4)";
    for (const [i] of game.moveRange) {
      const x = i % GRID_W, y = Math.floor(i / GRID_W) - game.camY;
      ctx.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
    }
  }
  if (game.attackTargets) {
    ctx.fillStyle = "rgba(255,70,60,0.4)";
    for (const [enemyId] of game.attackTargets) {
      const e = getUnit(enemyId);
      const y = e.y - game.camY;
      ctx.fillRect(e.x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
    }
  }
  for (const u of game.units) {
    if (u.hp <= 0 || u.escaped) continue;
    const y = u.y - game.camY;
    if (y < -1 || y > visibleRows) continue;
    const cx = u.x * TILE_PX + TILE_PX / 2, cy = y * TILE_PX + TILE_PX / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_PX * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = SIDE_COLORS[u.side];
    ctx.fill();
    if (u.id === game.selectedId) { ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1; }
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.round(TILE_PX * 0.4)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(unitGlyph(u), cx, cy);
    const hpRatio = u.hp / u.maxHp;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(cx - TILE_PX * 0.4, cy + TILE_PX * 0.32, TILE_PX * 0.8, 4);
    ctx.fillStyle = hpRatio > 0.5 ? "#4ade80" : hpRatio > 0.25 ? "#facc15" : "#ef4444";
    ctx.fillRect(cx - TILE_PX * 0.4, cy + TILE_PX * 0.32, TILE_PX * 0.8 * hpRatio, 4);
  }
}

// ---------- Input ----------
function canvasToTile(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((clientX - rect.left) / TILE_PX);
  const y = Math.floor((clientY - rect.top) / TILE_PX) + game.camY;
  return { x, y };
}
function onCanvasClick(evt) {
  if (!game || game.phase !== "player" || game.outcome) return;
  const { x, y } = canvasToTile(evt.clientX, evt.clientY);
  if (!inBounds(x, y)) return;

  if (game.pendingSkillTarget) {
    const user = getUnit(game.pendingSkillTarget);
    const target = unitAt(x, y);
    if (target && target.side !== user.side && manhattan(user.x, user.y, target.x, target.y) <= user.range + 1) {
      applyKakuranTo(target.id);
    } else {
      // Tapped something invalid: don't leave the player stuck mid-targeting.
      game.pendingSkillTarget = null;
      showActionMenu(user);
      render();
    }
    return;
  }
  if (game.selectedId && game.movedTo) return; // action menu / forecast is driving input now

  const clicked = unitAt(x, y);
  if (game.selectedId) {
    const sel = getUnit(game.selectedId);
    if (clicked && clicked.side === sel.side && clicked.id !== sel.id) { selectUnit(clicked); return; }
    tryMoveSelectedTo(x, y);
    return;
  }
  if (clicked && clicked.side === "oda" && !clicked.acted) selectUnit(clicked);
}
canvas.addEventListener("pointerup", onCanvasClick);

actAttackBtn.addEventListener("click", () => {
  if (game.attackTargets.size === 1) {
    const [[defenderId]] = game.attackTargets;
    beginAttack(defenderId);
  } else {
    openAttackTargeting();
    setBanner("攻撃する敵をタップ");
    const origHandler = onCanvasClick;
    canvas.removeEventListener("pointerup", origHandler);
    const pickHandler = (evt) => {
      const { x, y } = canvasToTile(evt.clientX, evt.clientY);
      const target = unitAt(x, y);
      canvas.removeEventListener("pointerup", pickHandler);
      canvas.addEventListener("pointerup", onCanvasClick);
      if (target && game.attackTargets.has(target.id)) {
        beginAttack(target.id);
      } else {
        // Tapped something invalid: fall back to the action menu instead of
        // leaving the player stuck with no listener able to progress.
        const unit = getUnit(game.selectedId);
        showActionMenu(unit);
        render();
      }
    };
    canvas.addEventListener("pointerup", pickHandler);
  }
});
actSkillBtn.addEventListener("click", useSkill);
actWaitBtn.addEventListener("click", confirmWait);
actCancelBtn.addEventListener("click", cancelMove);
confirmAttackBtn.addEventListener("click", confirmAttack);
cancelAttackBtn.addEventListener("click", cancelForecast);
endTurnBtn.addEventListener("click", () => { if (game && game.phase === "player" && !game.outcome) endPlayerTurn(); });
startBtn.addEventListener("click", () => {
  titleOverlayEl.classList.remove("show");
  playOpeningScene(startGame);
});
retryBtn.addEventListener("click", restartGame);
