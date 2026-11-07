// 動的ジャンプボタン(操作タイプ 'dynamic')の表示・配置
//  - 移動パッドの外周に、現在の移動方向側へ配置する
//  - 移動方向が変わると、パッドのまわりを滑らかに回り込んで追従する
//  - 画面外にはみ出す向き(真下など)では、収まる角度まで横へずらす
//  - 親指をパッドから離したら位置を固定(押しに行く途中で動かない)し、猶予時間が過ぎたら消える
import { INPUT } from './config.js';

export class DynamicJumpButton {
  constructor(el) {
    this.el = el;
    this.visible = false;
    this.angle = -Math.PI / 2;     // 画面座標での角度(-90° = パッドの真上)
    this.x = 0; this.y = 0;        // ボタン中心(画面座標)
    this.shownAt = 0;              // 表示し始めた時刻 [ms]
    this.graceLeft = 0;            // 移動をやめてから消えるまでの残り時間 [s]
    this.frozen = false;
    this.held = false;             // ボタンを押している指がある
    this._placed = false;
  }

  get radius() { return INPUT.jumpBtnSize / 2; }

  /** 当たり判定(見た目より jumpBtnHitPad だけ広い)。表示直後の誤タップは受け付けない */
  hit(x, y, now) {
    if (!this.visible) return false;
    if (now - this.shownAt < INPUT.jumpBtnArmTime * 1000) return false;
    return Math.hypot(x - this.x, y - this.y) <= this.radius + INPUT.jumpBtnHitPad;
  }

  /**
   * 毎フレーム呼ぶ。
   * pad: {x, y, r} パッド中心と半径 / dir: 画面上の移動方向 {x,y}(単位ベクトル)か null(移動していない)
   */
  update(dt, pad, dir) {
    const now = performance.now();
    if (dir) {
      // 移動中: 表示して方向へ追従
      if (!this.visible) {
        this.visible = true;
        this.shownAt = now;
        if (!this._placed || this.graceLeft <= 0) this.angle = Math.atan2(dir.y, dir.x); // 出現時は追従アニメなしで所定位置
      }
      this.frozen = false;
      this.graceLeft = INPUT.jumpBtnGrace;
      const target = Math.atan2(dir.y, dir.x);
      const k = 1 - Math.exp(-INPUT.jumpBtnFollow * dt);
      this.angle += wrap(target - this.angle) * k;
    } else if (this.visible) {
      // 移動していない: 位置を固定し、猶予後に消す(押している間は消さない)
      this.frozen = true;
      if (!this.held) {
        this.graceLeft -= dt;
        if (this.graceLeft <= 0) this.visible = false;
      }
    }

    if (!this.frozen || !this._placed) {
      const p = this._fit(pad, this.angle);
      this.x = p.x; this.y = p.y;
      this._placed = true;
    }
    this._apply();
  }

  /** 角度 a の位置が画面に収まらなければ、収まる最も近い角度を探す */
  _fit(pad, a) {
    const D = pad.r + INPUT.jumpBtnGap + this.radius;
    const m = INPUT.jumpBtnMargin + this.radius;
    const W = window.innerWidth, H = window.innerHeight;
    const at = (ang) => ({ x: pad.x + Math.cos(ang) * D, y: pad.y + Math.sin(ang) * D });
    const ok = (p) => p.x >= m && p.x <= W - m && p.y >= m && p.y <= H - m - INPUT.jumpBtnBottomSafe;
    let p = at(a);
    if (ok(p)) return p;
    const step = Math.PI / 90; // 2°
    // 上方向(画面内)へ近い側から探す
    const prefer = Math.sin(a) > 0 ? (Math.cos(a) >= 0 ? -1 : 1) : 1;
    for (let i = 1; i <= 90; i++) {
      for (const s of [prefer, -prefer]) {
        p = at(a + s * i * step);
        if (ok(p)) return p;
      }
    }
    return { x: Math.min(Math.max(p.x, m), W - m), y: Math.min(Math.max(p.y, m), H - m) };
  }

  _apply() {
    const el = this.el;
    el.style.transform = `translate(${this.x - this.radius}px, ${this.y - this.radius}px)`;
    el.classList.toggle('show', this.visible);
    el.classList.toggle('frozen', this.frozen && this.visible);
  }

  press() {
    this.held = true;
    this.el.classList.add('on');
  }

  release() {
    this.held = false;
    this.graceLeft = INPUT.jumpBtnGrace; // 離したあとも少しの間は連続で押せる
    this.el.classList.remove('on');
  }

  hide() {
    this.visible = false;
    this.held = false;
    this._apply();
  }
}

function wrap(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}
