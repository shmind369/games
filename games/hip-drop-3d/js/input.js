// 入力
//  操作タイプ 'center'(既定): 画面下中央に固定の移動パッド。パッドの真ん中をタップでジャンプ、
//                              空中でパッドを下へすばやくはらうとヒップアタック。
//  操作タイプ 'classic'      : 左下に仮想スティック + 右下にジャンプボタン(ボタンから下スワイプでヒップ)
//  共通: パッド以外の場所の下スワイプ=ヒップアタック / 横ドラッグ=カメラ回転
//  PC: WASD・矢印=移動, Space=ジャンプ, Shift / K=ヒップアタック, マウスドラッグ=カメラ
import { INPUT } from './config.js';

const LAYOUT_KEY = 'hipdrop.layout';

export function loadLayout() {
  const q = new URLSearchParams(location.search).get('pad');
  if (q === 'classic' || q === 'center') return q;
  try { const v = localStorage.getItem(LAYOUT_KEY); if (v === 'classic' || v === 'center') return v; } catch (_) {}
  return 'center';
}

export class Input {
  constructor(root) {
    this.root = root;
    this.move = { x: 0, y: 0 };      // スティック入力(-1..1, y+ が奥)
    this.jumpHeld = false;
    this._jumpPressed = false;       // 1回分のトリガー(consume で消費)
    this._hipPressed = false;
    this.camDragDx = 0;              // このフレームのカメラドラッグ量 [px]
    this.canHipFromPad = () => true; // パッドのはらいでヒップを出してよいか(main が空中判定を渡す)

    this.stickEl = document.getElementById('stick');
    this.knobEl = document.getElementById('stickKnob');
    this.jumpEl = document.getElementById('jumpBtn');

    this.stick = null;               // { id, cx, cy, fixed, jump, hist, fired }
    this.swipes = new Map();         // pointerId -> { x0, y0, lx, onJump, fired, cam, hist }
    this.keys = new Set();

    this.setLayout(loadLayout());

    root.addEventListener('pointerdown', (e) => this._down(e));
    root.addEventListener('pointermove', (e) => this._moveEv(e));
    root.addEventListener('pointerup', (e) => this._up(e));
    root.addEventListener('pointercancel', (e) => this._up(e));
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.jumpHeld = false; });
  }

  setLayout(layout) {
    this.layout = layout;
    document.body.dataset.layout = layout;
    try { localStorage.setItem(LAYOUT_KEY, layout); } catch (_) {}
    this._releaseStick();
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

  // ------------------------------------------------------------
  _padCenter() {
    const r = this.stickEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
  }
  _inClassicStickZone(x, y) {
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
    const now = performance.now();

    if (this.layout === 'center') {
      if (!this.stick) {
        const c = this._padCenter();
        const d = Math.hypot(x - c.x, y - c.y);
        if (d <= c.r + INPUT.padGrabMargin) {
          // 固定パッド: 中心は動かさない(真ん中タップを確実に判定するため)
          this.stick = { id: e.pointerId, cx: c.x, cy: c.y, fixed: true, jump: false, fired: false, hist: [{ x, y, t: now }] };
          this.stickEl.classList.add('active');
          if (d <= INPUT.centerJumpRadius) {
            // 真ん中をタップ → ジャンプ(押している間は高く跳ぶ)
            this._jumpPressed = true;
            this.jumpHeld = true;
            this.stick.jump = true;
            this.stickEl.classList.add('jump');
          }
          this._updateStick(x, y);
          return;
        }
      }
    } else {
      if (this._onJumpBtn(x, y)) {
        this._jumpPressed = true;
        this.jumpHeld = true;
        this.jumpEl.classList.add('on');
        this.swipes.set(e.pointerId, { x0: x, y0: y, lx: x, onJump: true, fired: false, cam: false, hist: [{ x, y, t: now }] });
        return;
      }
      if (!this.stick && e.pointerType !== 'mouse' && this._inClassicStickZone(x, y)) {
        // 押した位置にスティックが出る(フローティング)
        this.stick = { id: e.pointerId, cx: x, cy: y, fixed: false, jump: false, fired: false, hist: [{ x, y, t: now }] };
        this.stickEl.style.left = x + 'px';
        this.stickEl.style.top = y + 'px';
        this.stickEl.classList.add('active');
        this._setKnob(0, 0);
        return;
      }
    }
    // それ以外: 下スワイプ判定 or カメラドラッグ
    this.swipes.set(e.pointerId, { x0: x, y0: y, lx: x, onJump: false, fired: false, cam: false, hist: [{ x, y, t: now }] });
  }

  _updateStick(x, y) {
    const s = this.stick;
    let dx = x - s.cx, dy = y - s.cy;
    const R = INPUT.stickRadius;
    const l = Math.hypot(dx, dy);
    if (l > R) {
      if (!s.fixed) {
        // フローティング: 指が大きく離れたら中心も引っ張って付いてくる
        const over = l - R;
        s.cx += (dx / l) * over; s.cy += (dy / l) * over;
        this.stickEl.style.left = s.cx + 'px';
        this.stickEl.style.top = s.cy + 'px';
      }
      dx = (dx / l) * R; dy = (dy / l) * R;
    }
    let nx = dx / R, ny = -dy / R;
    const m = Math.hypot(nx, ny);
    if (m < INPUT.deadZone) { nx = 0; ny = 0; }
    else { const k = (m - INPUT.deadZone) / (1 - INPUT.deadZone) / m; nx *= k; ny *= k; }
    this.move.x = nx; this.move.y = ny;
    this._setKnob(dx, dy);
  }

  /**
   * 直近 swipeMaxTime 秒の動きで下スワイプを判定する(押しっぱなしから途中ではらっても発動)。
   * 発動したら true。
   */
  _detectFlick(s, x, y, minDy) {
    const now = performance.now();
    s.hist.push({ x, y, t: now });
    while (s.hist.length > 2 && now - s.hist[0].t > INPUT.swipeMaxTime * 1000) s.hist.shift();
    let ref = s.hist[0];
    for (const h of s.hist) if (h.y < ref.y) ref = h; // 窓内で最も上の点から測る
    const sdx = x - ref.x, sdy = y - ref.y;
    let fired = false;
    if (!s.fired && sdy > minDy && sdy > Math.abs(sdx) * 1.1) {
      s.fired = true;
      fired = true;
    }
    // 一度発動したら、指を上に戻すと再度スワイプできる
    if (s.fired && !fired && y < ref.y + 8) { s.fired = false; s.hist = [{ x, y, t: now }]; }
    return fired;
  }

  _moveEv(e) {
    const x = e.clientX, y = e.clientY;
    if (this.stick && e.pointerId === this.stick.id) {
      this._updateStick(x, y);
      // センターパッド: 空中でパッドを下へすばやくはらう → ヒップアタック
      if (this.layout === 'center' && this._detectFlick(this.stick, x, y, INPUT.padFlickDy) && this.canHipFromPad()) {
        this._hipPressed = true;
        flash(this.stickEl);
      }
      return;
    }
    const s = this.swipes.get(e.pointerId);
    if (!s) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) return;
    const dx = x - s.x0, dy = y - s.y0;
    if (!s.cam && this._detectFlick(s, x, y, INPUT.swipeMinDy)) {
      this._hipPressed = true;
      flash(this.layout === 'center' ? this.stickEl : this.jumpEl);
    }
    // ジャンプボタン以外から始めた横ドラッグはカメラ回転
    if (!s.onJump && !s.fired && (s.cam || (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)))) {
      s.cam = true;
      this.camDragDx += x - s.lx;
    }
    s.lx = x;
  }

  _up(e) {
    if (this.stick && e.pointerId === this.stick.id) {
      this._releaseStick();
      return;
    }
    const s = this.swipes.get(e.pointerId);
    if (s) {
      if (s.onJump) { this.jumpHeld = false; this.jumpEl.classList.remove('on'); }
      this.swipes.delete(e.pointerId);
    }
  }

  _releaseStick() {
    // センターパッドでは「タップ=ジャンプ」なので、指を離しても小ジャンプにはしない(常にフルジャンプ)
    if (this.stick && this.stick.jump && this.layout !== 'center') this.jumpHeld = false;
    this.stick = null;
    this.move.x = 0; this.move.y = 0;
    this.stickEl.classList.remove('active', 'jump');
    this.stickEl.style.left = '';
    this.stickEl.style.top = '';
    this._setKnob(0, 0);
  }

  _setKnob(dx, dy) {
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
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
