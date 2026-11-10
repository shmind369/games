// 対戦相手の簡易AI
//  - 間合い(約0.74m)を保つ: 遠ければステップで詰め、近すぎれば下がる。間合いでは時々横へ回り込む
//  - 届く距離で、間隔をあけてパンチを出す(ジャブ多め・ストレート・ワンツー・たまにフック)
//  - 打たれると少しの間ひるんで動きが止まる
export const AI = {
  range: 0.74,          // 保ちたい間合い [m](ジャブ・ストレートが頭に届く距離)
  far: 0.9,             // これより遠ければ詰める
  near: 0.58,           // これより近ければ下がる
  attackRange: 0.9,     // パンチを出す距離
  coolMin: 0.9,         // 次のパンチまでの間隔 [s]
  coolMax: 2.1,
  stunTime: 0.35,       // 打たれてひるむ時間 [s]
  // 攻撃パターン(重み付き)
  patterns: [
    { w: 0.45, seq: ['jab'] },
    { w: 0.2, seq: ['straight'] },
    { w: 0.2, seq: ['jab', 'straight'] },
    { w: 0.08, seq: ['hookL'] },
    { w: 0.07, seq: ['jab', 'jab', 'straight'] },
  ],
};

export class OpponentAI {
  constructor() {
    this.cool = 1.6;        // 最初は少し様子を見る
    this.sideT = 0;
    this.sideDir = 1;
    this.sideMove = false;
    this.stun = 0;
  }

  /** 打たれたとき */
  onHit() { this.stun = AI.stunTime; this.cool = Math.max(this.cool, 0.5); }

  /** me: 相手ボクサー(AIが動かす) / foe: 自機。戻り値はワールドの移動入力 {x, z} */
  update(dt, me, foe) {
    const zero = { x: 0, z: 0 };
    if (me.down || foe.down) return zero;
    if (this.stun > 0) { this.stun -= dt; return zero; }
    const dx = foe.pos.x - me.pos.x, dz = foe.pos.y - me.pos.y, d = Math.hypot(dx, dz) || 1;
    const fx = dx / d, fz = dz / d;      // 相手へ向かう向き
    const px = -fz, pz = fx;             // 横向き(回り込み)

    // ---- 攻撃 ----
    this.cool -= dt;
    if (this.cool <= 0 && d <= AI.attackRange && !me.punch) {
      let r = Math.random(), pick = AI.patterns[0];
      for (const p of AI.patterns) { if ((r -= p.w) <= 0) { pick = p; break; } }
      for (const k of pick.seq) me.throwPunch(k);
      this.cool = AI.coolMin + Math.random() * (AI.coolMax - AI.coolMin);
    }

    // ---- 間合い ----
    if (d > AI.far) return { x: fx * 0.85, z: fz * 0.85 };
    if (d < AI.near) return { x: -fx * 0.8, z: -fz * 0.8 };
    this.sideT -= dt;
    if (this.sideT <= 0) {
      this.sideT = 0.7 + Math.random() * 1.2;
      this.sideMove = Math.random() < 0.45;
      if (Math.random() < 0.5) this.sideDir *= -1;
    }
    if (this.sideMove && !me.punch) return { x: px * this.sideDir * 0.7, z: pz * this.sideDir * 0.7 };
    return zero;
  }
}
