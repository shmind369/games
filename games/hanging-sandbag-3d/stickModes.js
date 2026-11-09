// バーチャルスティックの入力強度(中心からの距離)で、待機 / 回避 / 移動 を切り替える
//   0〜15%   : 待機(ニュートラル)
//   15〜35%  : 小さな回避
//   35〜65%  : 大きな回避
//   65〜100% : 通常移動
// 境界付近で行ったり来たりしないよう、モードの出入りにヒステリシス(幅)を設ける。
export const STICK_ZONES = {
  dodgeIn: 0.15,      // 待機 → 回避 に入る強さ
  dodgeOut: 0.12,     // 回避 → 待機 に戻る強さ(入るときより小さい)
  bigDodge: 0.35,     // 小さな回避 / 大きな回避 の境目(表示用。深さは強さに応じて連続的に変わる)
  moveIn: 0.65,       // 回避 → 移動 に入る強さ
  moveOut: 0.58,      // 移動 → 回避 に戻る強さ(入るときより小さい)
  depthAtDodgeIn: 0.25, // 回避の深さ(0〜1): 15% で 0.25
  depthAtBig: 0.55,     //                    35% で 0.55
  depthAtMoveIn: 1.0,   //                    65% で 1.0
  moveMinSpeed: 0.45, // 移動に入った直後の速さ(最高速に対する割合)。100% で 1.0
  passRate: 4,        // 倒し量がこれより速く変化している間 [1/秒] は「通過中」とみなし回避を出さない
                      // (移動しようと一気に倒すとき、途中の回避ゾーンで一瞬ピクッと避けないように)
};

export class StickModes {
  constructor() {
    this.mode = 'neutral'; // 'neutral' | 'dodge' | 'move'
    this.prevMag = 0;
    this.rate = 0;         // 倒し量の変化の速さ(平滑化)
  }

  /**
   * active: 指がスティックに触れているか / x, y: スティック入力(-1..1, y+ が上)
   * 戻り値: { mode, mag, dirX, dirY, depth(回避の深さ 0..1), speed(移動の速さ 0..1), big(大きな回避か) }
   */
  update(active, x, y, dt = 1 / 60) {
    const Z = STICK_ZONES;
    const mag = active ? Math.min(1, Math.hypot(x, y)) : 0;
    const r = (mag - this.prevMag) / Math.max(dt, 1e-3);
    this.rate += (r - this.rate) * Math.min(1, dt * 45); // 指が止まったらすぐ「通過中」を解除(反応を速く)
    this.prevMag = mag;
    // ヒステリシス付きのモード遷移
    switch (this.mode) {
      case 'move':
        if (mag < Z.moveOut) this.mode = mag >= Z.dodgeIn ? 'dodge' : 'neutral';
        break;
      case 'dodge':
        if (mag >= Z.moveIn) this.mode = 'move';
        else if (mag < Z.dodgeOut) this.mode = 'neutral';
        break;
      default:
        if (mag >= Z.moveIn) this.mode = 'move';
        else if (mag >= Z.dodgeIn) this.mode = 'dodge';
    }
    const dirX = mag > 1e-4 ? x / mag : 0, dirY = mag > 1e-4 ? y / mag : 0;
    let depth = 0, speed = 0;
    if (this.mode === 'dodge') {
      // 強さに応じて深さを連続的に(区間ごとの直線補間。境目で段差なし)
      if (mag < Z.bigDodge) depth = lerp(Z.depthAtDodgeIn, Z.depthAtBig, (mag - Z.dodgeIn) / (Z.bigDodge - Z.dodgeIn));
      else depth = lerp(Z.depthAtBig, Z.depthAtMoveIn, (mag - Z.bigDodge) / (Z.moveIn - Z.bigDodge));
      depth = clamp01(depth);
      if (Math.abs(this.rate) > Z.passRate) depth = 0; // 通過中(指がまだ大きく動いている)
    } else if (this.mode === 'move') {
      speed = lerp(Z.moveMinSpeed, 1, (mag - Z.moveOut) / (1 - Z.moveOut));
      speed = Math.max(Z.moveMinSpeed * 0.8, Math.min(1, speed));
    }
    return { mode: this.mode, mag, dirX, dirY, depth, speed, big: mag >= Z.bigDodge };
  }
}

function lerp(a, b, t) { return a + (b - a) * clamp01(t); }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
