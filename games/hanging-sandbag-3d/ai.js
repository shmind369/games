// 対戦相手の簡易AI
//  - 間合い(約0.9m)を保つ: 遠ければステップで詰め、近すぎれば下がる。間合いでは時々横へ回り込む
//  - 攻撃するときだけパンチと一緒に踏み込み(届く距離まで)、打ち終わったら下がって間合いに戻る(ヒット&アウェイ)
//  - パンチは間隔をあけて出す(ジャブ多め・ストレート・ワンツー・たまにフックやアッパー)
//  - 打たれると少しの間ひるんで動きが止まる
export const AI = {
  range: 0.9,           // 保ちたい間合い [m](パンチは届かない。打つときに踏み込む)
  far: 1.05,            // これより遠ければ詰める
  near: 0.78,           // これより近ければ下がる
  attackRange: 1.08,    // ここまでなら踏み込んでパンチを出す
  reach: 0.74,          // 踏み込む先の距離(ジャブ・ストレートが頭に届く距離)
  lungeTime: 0.14,      // 踏み込みにかける時間 [s](拳が伸びきる前に届く距離へ)
  backOff: 0.45,        // 打ち終わってから下がる時間 [s]
  coolMin: 0.9,         // 次のパンチまでの間隔 [s]
  coolMax: 2.1,
  stunTime: 0.35,       // 打たれてひるむ時間 [s]
  // 攻撃パターン(重み付き)
  patterns: [
    { w: 0.38, seq: ['jab'] },
    { w: 0.17, seq: ['straight'] },
    { w: 0.18, seq: ['jab', 'straight'] },
    { w: 0.08, seq: ['hookL'] },
    { w: 0.06, seq: ['hookR'] },
    { w: 0.06, seq: ['jab', 'upperR'] },
    { w: 0.04, seq: ['upperL'] },
    { w: 0.03, seq: ['jab', 'jab', 'straight'] },
  ],
};

export class OpponentAI {
  constructor() {
    this.cool = 1.6;        // 最初は少し様子を見る
    this.sideT = 0;
    this.sideDir = 1;
    this.sideMove = false;
    this.stun = 0;
    this.back = 0;          // 打ったあと下がる残り時間
  }

  /** 打たれたとき */
  onHit() { this.stun = AI.stunTime; this.cool = Math.max(this.cool, 0.5); }

  /** me: 相手ボクサー(AIが動かす) / foe: 自機。戻り値はワールドの移動入力 {x, z} */
  update(dt, me, foe) {
    const zero = { x: 0, z: 0 };
    me.pressMin = AI.reach - 0.04;      // コンビネーションの詰めでも、届く距離より内側には入らない
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
      // 届く距離まで、パンチと一緒に踏み込む(コンビネーションの詰めと同じ仕組み)
      const lunge = Math.max(0, d - AI.reach);
      if (lunge > 0.01) me.press = { left: lunge, t: 0, speed: lunge / AI.lungeTime };
      for (const k of pick.seq) me.throwPunch(k);
      this.back = AI.backOff;
      this.cool = AI.coolMin + Math.random() * (AI.coolMax - AI.coolMin);
    }

    // ---- 打ち終わったら下がる ----
    if (me.punch || me.queue.length) return zero;
    if (this.back > 0) {
      this.back -= dt;
      if (d < AI.range) return { x: -fx * 0.75, z: -fz * 0.75 };
    }
    // ---- 間合い ----
    // 1回の跳びの幅はスティックの倒し具合で決まる(60%で約0.22m)。間合いの近くでは小さく跳んで、跳び越して近づきすぎないように
    if (d > AI.far) { const s = d > AI.far + 0.35 ? 0.85 : 0.6; return { x: fx * s, z: fz * s }; }
    if (d < AI.near) return { x: -fx * 0.6, z: -fz * 0.6 };
    this.sideT -= dt;
    if (this.sideT <= 0) {
      this.sideT = 0.7 + Math.random() * 1.2;
      this.sideMove = Math.random() < 0.45;
      if (Math.random() < 0.5) this.sideDir *= -1;
    }
    if (this.sideMove) return { x: px * this.sideDir * 0.7, z: pz * this.sideDir * 0.7 };
    return zero;
  }
}
