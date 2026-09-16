// Pure, DOM/Canvas-independent fight logic: gesture classification (charge
// punch vs quick dodge vs down-swipe guard), the enemy's
// idle -> telegraph -> recovery state machine, and damage/outcome resolution.
// Kept separate from main.js so it can be unit tested directly in Node.

export const MAX_HP = 100;

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function oppositeSide(side) { return side === "left" ? "right" : "left"; }

// ---------- Gesture classification ----------
// Punch: touch one half of the screen, drag further OUTWARD (away from
// center, i.e. further left from the left half / further right from the
// right half) like drawing back a slingshot, then release. Dodge: a quick
// short swipe left/right from anywhere. Guard: a downward swipe, held.
// These are deliberately disambiguated at release time (like a tap vs. swipe
// classifier), except guard, which must be recognized live while the finger
// is still down since it's a hold, not a release-triggered action.
export const GESTURE = {
  GUARD_DY_PX: 40,
  GUARD_DOMINANCE: 1.3,
  DODGE_MAX_MS: 220,
  DODGE_MIN_PX: 36,
  DODGE_DOMINANCE: 1.2,
  MIN_CHARGE_PX: 14,
  MAX_PULL_PX: 140,
  CHARGE_TIME_BONUS_MS: 500,
  CHARGE_TIME_BONUS_MAX: 0.2,
};

// Called continuously on pointermove (before release) so a held-down swipe
// can engage guard without waiting for pointerup.
export function checkGuardTrigger(dx, dy) {
  return dy > GESTURE.GUARD_DY_PX && dy > Math.abs(dx) * GESTURE.GUARD_DOMINANCE;
}

// Called once at pointerup (when guard was not already triggered in-flight).
// dx/dy are release-point minus start-point; dt is hold duration in ms;
// side is which half of the screen the touch started on ("left"/"right").
export function classifyRelease(dx, dy, dt, side) {
  const adx = Math.abs(dx), ady = Math.abs(dy);

  if (dt <= GESTURE.DODGE_MAX_MS && adx >= GESTURE.DODGE_MIN_PX && adx > ady * GESTURE.DODGE_DOMINANCE) {
    return { type: "dodge", dir: dx < 0 ? "left" : "right" };
  }

  if (adx >= GESTURE.MIN_CHARGE_PX) {
    const outward = side === "left" ? -dx : dx; // positive = pulled the correct way
    if (outward > 0) {
      const distPower = clamp(outward / GESTURE.MAX_PULL_PX, 0, 1);
      const timeBonus = clamp(dt / GESTURE.CHARGE_TIME_BONUS_MS, 0, 1) * GESTURE.CHARGE_TIME_BONUS_MAX;
      return { type: "punch", side, power: clamp(distPower + timeBonus, 0, 1) };
    }
  }

  return { type: "none" };
}

export function isDodgeCorrect(enemySide, dodgeDir) {
  return dodgeDir === oppositeSide(enemySide);
}

// ---------- Punch stats ----------
// Keyed directly by screen side, matching classifyRelease's punch.side, so
// there's no separate "punch type" name to keep in sync with which half of
// the screen throws it. Left = jab: fast, low startup, low damage.
// Right = straight: slow, high startup, high damage. Both scale further
// with the charge power (0..1) from the gesture.
export const PUNCH_STATS = {
  left: { baseDamage: 6, powerDamage: 6, baseStartupMs: 160, powerStartupMs: 80 },
  right: { baseDamage: 12, powerDamage: 14, baseStartupMs: 380, powerStartupMs: 220 },
};

export function computePunch(side, power) {
  const stats = PUNCH_STATS[side];
  return {
    damage: stats.baseDamage + stats.powerDamage * power,
    startupMs: stats.baseStartupMs + stats.powerStartupMs * power,
  };
}

// ---------- Enemy state machine ----------
// idle (cooldown) -> telegraph (side shown, player must dodge/guard) ->
// recovery (vulnerable window, punches landed here are clean counters) -> idle
export const ENEMY = {
  punchDamage: 14,
  telegraphMsFull: 1400,
  telegraphMsLow: 700,
  recoveryMs: 650,
  idleMinMs: 500,
  idleMaxMs: 1000,
  counterMultiplier: 1.5,
};

export function computeTelegraphMs(enemyHpRatio) {
  return lerp(ENEMY.telegraphMsLow, ENEMY.telegraphMsFull, clamp(enemyHpRatio, 0, 1));
}

export function pickEnemySide(lastSide, repeatCount, rng) {
  if (lastSide && repeatCount >= 2) return oppositeSide(lastSide);
  return rng() < 0.5 ? "left" : "right";
}

export function createEnemyState() {
  return { phase: "idle", timer: 600, side: null, lastSide: null, repeatCount: 0 };
}

// Advances the enemy's timers by dt (ms) and returns the next state plus an
// event fired the instant a telegraph resolves ("hit" or "defended"), based
// on `defended` — whether the player guarded or correctly dodged at any
// point during that telegraph (the caller accumulates this; see README).
export function tickEnemy(enemy, dt, defended, enemyHpRatio, rng) {
  let { phase, timer, side, lastSide, repeatCount } = enemy;
  timer -= dt;
  let event = null;

  if (phase === "telegraph" && timer <= 0) {
    event = { type: defended ? "defended" : "hit" };
    phase = "recovery";
    timer = ENEMY.recoveryMs;
  } else if (phase === "recovery" && timer <= 0) {
    phase = "idle";
    timer = ENEMY.idleMinMs + rng() * (ENEMY.idleMaxMs - ENEMY.idleMinMs);
  } else if (phase === "idle" && timer <= 0) {
    const nextSide = pickEnemySide(lastSide, repeatCount, rng);
    repeatCount = nextSide === lastSide ? repeatCount + 1 : 1;
    phase = "telegraph";
    timer = computeTelegraphMs(enemyHpRatio);
    side = nextSide;
    lastSide = nextSide;
  }

  return { enemy: { phase, timer, side, lastSide, repeatCount }, event };
}

// ---------- Damage / outcome ----------
export function applyDamage(hp, dmg) { return clamp(hp - dmg, 0, MAX_HP); }

// enemyPhase is checked at the moment the punch's startup finishes, not when
// it was thrown: a punch that lands while the enemy is in "recovery" (the
// vulnerable window right after its own attack) counts as a clean counter.
export function resolvePlayerPunchDamage(damage, enemyPhase) {
  return enemyPhase === "recovery" ? damage * ENEMY.counterMultiplier : damage;
}

export function checkOutcome(playerHp, enemyHp) {
  if (enemyHp <= 0) return "win";
  if (playerHp <= 0) return "lose";
  return null;
}
