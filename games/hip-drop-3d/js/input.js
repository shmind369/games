// 入力: 仮想スティック(左下) / ジャンプボタン(右下) / 下スワイプ=ヒップアタック / ドラッグ=カメラ回転
// PC: WASD・矢印=移動, Space=ジャンプ, Shift / K / ↓スワイプ(マウス)=ヒップアタック, マウスドラッグ=カメラ
import { INPUT } from './config.js';

export class Input {
  constructor(root) {
    this.root = root;
    this.move = { x: 0, y: 0 };      // スティック入力(-1..1, y+ が奥)
    this.jumpHeld = false;
    this._jumpPressed = false;       // 1回分のトリガー(consume で消費)
    this._hipPressed = false;
    this.camDragDx = 0;              // このフレームのカメラドラッグ量 [px]

    this.stickEl = document.getElementById('stick');
    this.knobEl = document.getElementById('stickKnob');
    this.jumpEl = document.getElementById('jumpBtn');
    this.stickHome = null;

    this.stick = null;               // { id, cx, cy }
    this.swipes = new Map();         // pointerId -> { x0, y0, t0, lx, onJump, fired, cam }
    this.keys = new Set();

    root.addEventListener('pointerdown', (e) => this._down(e));
    root.addEventListener('pointermove', (e) => this._moveEv(e));
    root.addEventListener('pointerup', (e) => this._up(e));
    root.addEventListener('pointercancel', (e) => this._up(e));
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.jumpHeld = false; });
  }

  // ---- 1フレーム分のトリガー取得 ----
  consumeJump() { const v = this._jumpPressed; this._jumpPressed = false; return v; }
  consumeHip() { const v = this._hipPressed; this._hipPressed = false; return v; }
  consumeCamDrag() { const v = this.camDragDx; this.camDragDx = 0; return v; }

  /** スティックとキーボードを合成した移動入力 */
  getMove() {
    let x = this.move.x, y = this.move.y;
    if (!this.stick) {
      const k = this.keys;
      x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
    }
    return { x, y };
  }

  _inStickZone(x, y) {
    return x < window.innerWidth * 0.5 && y > window.innerHeight * 0.45;
  }
  _onJumpBtn(x, y) {
    const r = this.jumpEl.getBoundingClientRect();
    const pad = 18; // 指が少しずれても押せるように当たり判定を広げる
    return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
  }

  _down(e) {
    if (e.target.closest && e.target.closest('.ui-block')) return; // ボタン等のUI
    e.preventDefault();
    try { this.root.setPointerCapture(e.pointerId); } catch (_) { /* 合成イベント等 */ }
    const x = e.clientX, y = e.clientY;

    if (this._onJumpBtn(x, y)) {
      this._jumpPressed = true;
      this.jumpHeld = true;
      this.jumpEl.classList.add('on');
      this.swipes.set(e.pointerId, { x0: x, y0: y, lx: x, onJump: true, fired: false, cam: false, hist: [{ x, y, t: performance.now() }] });
      return;
    }
    if (!this.stick && e.pointerType !== 'mouse' && this._inStickZone(x, y)) {
      this._startStick(e.pointerId, x, y);
      return;
    }
    // それ以外: 下スワイプ判定 or カメラドラッグ
    this.swipes.set(e.pointerId, { x0: x, y0: y, lx: x, onJump: false, fired: false, cam: false, hist: [{ x, y, t: performance.now() }] });
  }

  _startStick(id, x, y) {
    // 押した位置にスティックが出る(フローティング)
    this.stick = { id, cx: x, cy: y };
    this.stickEl.style.left = x + 'px';
    this.stickEl.style.top = y + 'px';
    this.stickEl.classList.add('active');
    this._setKnob(0, 0);
  }

  _moveEv(e) {
    const x = e.clientX, y = e.clientY;
    if (this.stick && e.pointerId === this.stick.id) {
      let dx = x - this.stick.cx, dy = y - this.stick.cy;
      const R = INPUT.stickRadius;
      const l = Math.hypot(dx, dy);
      if (l > R) {
        // 指が大きく離れたらスティックの中心も引っ張って付いてくる
        const over = l - R;
        this.stick.cx += (dx / l) * over; this.stick.cy += (dy / l) * over;
        this.stickEl.style.left = this.stick.cx + 'px';
        this.stickEl.style.top = this.stick.cy + 'px';
        dx = (dx / l) * R; dy = (dy / l) * R;
      }
      let nx = dx / R, ny = -dy / R;
      const m = Math.hypot(nx, ny);
      if (m < INPUT.deadZone) { nx = 0; ny = 0; }
      else { const k = (m - INPUT.deadZone) / (1 - INPUT.deadZone) / m; nx *= k; ny *= k; }
      this.move.x = nx; this.move.y = ny;
      this._setKnob(dx, dy);
      return;
    }
    const s = this.swipes.get(e.pointerId);
    if (!s) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) return;
    const dx = x - s.x0, dy = y - s.y0;
    // 直近 swipeMaxTime 秒の動きだけで判定する(ジャンプボタンを押しっぱなしにしてから
    // 頂点付近で下へはらう、という操作でも発動するように)
    const now = performance.now();
    s.hist.push({ x, y, t: now });
    while (s.hist.length > 2 && now - s.hist[0].t > INPUT.swipeMaxTime * 1000) s.hist.shift();
    let ref = s.hist[0];
    for (const h of s.hist) if (h.y < ref.y) ref = h; // 窓内で最も上の点から測る
    const sdx = x - ref.x, sdy = y - ref.y;
    if (!s.fired && !s.cam && sdy > INPUT.swipeMinDy && sdy > Math.abs(sdx) * 1.1) {
      s.fired = true;
      this._hipPressed = true;
      flash(this.jumpEl);
    }
    // 一度発動したら、指を上に戻すと再度スワイプできる
    if (s.fired && y < ref.y + 8) { s.fired = false; s.hist = [{ x, y, t: now }]; }
    // ジャンプボタン以外から始めた横ドラッグはカメラ回転
    if (!s.onJump && !s.fired && (s.cam || (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)))) {
      s.cam = true;
      this.camDragDx += x - s.lx;
    }
    s.lx = x;
  }

  _up(e) {
    if (this.stick && e.pointerId === this.stick.id) {
      this.stick = null;
      this.move.x = 0; this.move.y = 0;
      this.stickEl.classList.remove('active');
      this._resetStick();
      return;
    }
    const s = this.swipes.get(e.pointerId);
    if (s) {
      if (s.onJump) { this.jumpHeld = false; this.jumpEl.classList.remove('on'); }
      this.swipes.delete(e.pointerId);
    }
  }

  _setKnob(dx, dy) {
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  _resetStick() {
    this.stickEl.style.left = '';
    this.stickEl.style.top = '';
    this._setKnob(0, 0);
  }

  _key(e, down) {
    const c = e.code;
    if (down) {
      if (c === 'Space' && !e.repeat) { this._jumpPressed = true; this.jumpHeld = true; }
      if ((c === 'ShiftLeft' || c === 'ShiftRight' || c === 'KeyK' || c === 'KeyJ') && !e.repeat) this._hipPressed = true;
      this.keys.add(c);
      if (c.startsWith('Arrow') || c === 'Space') e.preventDefault();
    } else {
      if (c === 'Space') this.jumpHeld = false;
      this.keys.delete(c);
    }
  }
}

function flash(el) {
  el.classList.remove('hip');
  void el.offsetWidth;
  el.classList.add('hip');
}
