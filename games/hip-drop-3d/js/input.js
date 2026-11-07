// 入力
//  操作タイプ 'release'(既定): 画面下中央の固定パッド。
//                              ・パッドを最大まで倒した位置で指を離す → その方向へ斜めジャンプ
//                              ・それ以外の位置で離す → ジャンプせず、その場で止まる
//                              ・止まっているときにパッドの中心を押す → 垂直ジャンプ(その場ジャンプ)
//                              ・空中でパッドを下へすばやくはらう / 他の場所で下スワイプ → ヒップアタック
//  操作タイプ 'dynamic'      : 画面下中央に固定の移動パッド。移動している間だけ、パッドの
//                              移動方向側にジャンプボタンが現れる(タップで即ジャンプ)。
//                              空中でパッド / ボタン / それ以外を下へすばやくはらう → ヒップアタック
//  操作タイプ 'gesture'      : 指1本のジェスチャー。スライド=移動 / 動かさずに短く離す=ジャンプ
//  操作タイプ 'center'       : 下中央の固定パッド。パッドの真ん中をタップでジャンプ
//  操作タイプ 'classic'      : 左下に仮想スティック + 右下にジャンプボタン
//  共通: パッド以外の場所の下スワイプ=ヒップアタック / 横ドラッグ=カメラ回転
//  PC: WASD・矢印=移動, Space=ジャンプ, Shift / K=ヒップアタック, マウスドラッグ=カメラ
//
//  指の管理: すべて Pointer Events の pointerId で管理する。移動パッドの指・ジャンプボタンの指・
//  それ以外(カメラ/スワイプ)の指はそれぞれ独立しており、互いの入力を途切れさせない。
import { INPUT } from './config.js';
import { DynamicJumpButton } from './jumpButton.js';

const LAYOUT_KEY = 'hipdrop.layout4'; // 既定変更に伴いキーを更新(以前の選択は引き継がない)
const LAYOUTS = ['release', 'dynamic', 'gesture', 'center', 'classic'];

export function loadLayout() {
  const q = new URLSearchParams(location.search).get('pad');
  if (LAYOUTS.includes(q)) return q;
  try { const v = localStorage.getItem(LAYOUT_KEY); if (LAYOUTS.includes(v)) return v; } catch (_) {}
  return 'release';
}

export class Input {
  constructor(root) {
    this.root = root;
    this.move = { x: 0, y: 0 };      // スティック入力(-1..1, y+ が奥)
    this.jumpHeld = false;
    this._jumpPressed = false;       // 1回分のトリガー(consume で消費)
    this._hipPressed = false;
    this.jumpKeepsMomentum = false;  // 直前のジャンプ入力が動的ボタンから(移動の勢いを引き継ぐ)
    this.jumpDir = null;             // 方向付きジャンプのスティック方向 {x,y}(パッドを倒して離したとき)
    this._stopPressed = false;       // パッドを途中で離した: その場で止まる
    this.canVerticalJump = () => true; // 止まっているか(パッド中心で垂直ジャンプしてよいか。main が渡す)
    this.camDragDx = 0;              // このフレームのカメラドラッグ量 [px]
    this.canHipFromPad = () => true; // パッドのはらいでヒップを出してよいか(main が空中判定を渡す)

    this.stickEl = document.getElementById('stick');
    this.knobEl = document.getElementById('stickKnob');
    this.jumpEl = document.getElementById('jumpBtn');
    this.dynJump = new DynamicJumpButton(document.getElementById('dynJump'));

    this.stick = null;               // { id, cx, cy, fixed, jump, hist, fired }
    this.gest = null;                // ジェスチャー操作中の指 { id, x0, y0, t0, maxD, mode:'pending'|'move' }
    this.tapFxEl = document.getElementById('tapFx');
    this.swipes = new Map();         // pointerId -> { x0, y0, lx, onJump, fired, cam, hist }
    this.keys = new Set();

    this.setLayout(loadLayout());

    root.addEventListener('pointerdown', (e) => this._down(e));
    root.addEventListener('pointermove', (e) => this._moveEv(e));
    root.addEventListener('pointerup', (e) => this._up(e));
    root.addEventListener('pointercancel', (e) => this._up(e, true));
    // iOS Safari: ダブルタップ拡大・長押しの選択/虫めがね・ピンチ拡大を抑止。
    // ゲームの処理は Pointer Events だけで行い、touch 系は既定動作の抑止のみ(二重発火しない)
    const block = (e) => { if (!(e.target.closest && e.target.closest('.ui-block'))) e.preventDefault(); };
    root.addEventListener('touchstart', block, { passive: false });
    root.addEventListener('touchmove', block, { passive: false });
    root.addEventListener('touchend', block, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.jumpHeld = false; });
  }

  setLayout(layout) {
    this.layout = layout;
    document.body.dataset.layout = layout;
    try { localStorage.setItem(LAYOUT_KEY, layout); } catch (_) {}
    this._releaseStick();
    this.gest = null;
    this.swipes.clear();
    this.dynJump.hide();
  }

  /** タップで跳ぶ操作タイプでは、指を離しても小ジャンプにしない */
  get fullJumpOnTap() { return this.layout !== 'classic'; }

  // ---- 1フレーム分のトリガー取得 ----
  consumeJump() { const v = this._jumpPressed; this._jumpPressed = false; return v; }
  consumeStop() { const v = this._stopPressed; this._stopPressed = false; return v; }
  consumeJumpDir() { const v = this.jumpDir; this.jumpDir = null; return v; }
  consumeHip() { const v = this._hipPressed; this._hipPressed = false; return v; }
  consumeCamDrag() { const v = this.camDragDx; this.camDragDx = 0; return v; }

  /** 毎フレーム: 動的ジャンプボタンの表示・追従 */
  update(dt) {
    if (this.layout !== 'dynamic') return;
    let dir = null;
    if (this.stick) {
      const m = Math.hypot(this.move.x, this.move.y);
      // 画面上の移動方向(スティックの y+ は画面の上)
      if (m >= INPUT.jumpBtnShowMin) dir = { x: this.move.x / m, y: -this.move.y / m };
    }
    this.dynJump.update(dt, this._padCenter(), dir);
  }

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

  _newSwipe(e, x, y, now, onJump) {
    this.swipes.set(e.pointerId, { x0: x, y0: y, lx: x, onJump, fired: false, cam: false, hist: [{ x, y, t: now }] });
  }

  _down(e) {
    if (e.target.closest && e.target.closest('.ui-block')) return; // ボタン等のUI
    e.preventDefault();
    // 同じ指の down が二重に届いた場合は無視
    if ((this.stick && this.stick.id === e.pointerId) || this.swipes.has(e.pointerId) ||
        (this.gest && this.gest.id === e.pointerId)) return;
    try { this.root.setPointerCapture(e.pointerId); } catch (_) { /* 合成イベント等 */ }
    const x = e.clientX, y = e.clientY;
    const now = performance.now();

    if (this.layout === 'release') {
      if (!this.stick) {
        const c = this._padCenter();
        const d = Math.hypot(x - c.x, y - c.y);
        if (d <= c.r + INPUT.padGrabMargin) {
          this.stick = { id: e.pointerId, cx: c.x, cy: c.y, fixed: true, jump: false, fired: false, hist: [{ x, y, t: now }] };
          this.stickEl.classList.add('active');
          // 止まっているときに中心を押す → 垂直ジャンプ(既定: 押した瞬間に跳ぶ)
          this.stick.centerTap = d <= INPUT.centerJumpRadius && this.canVerticalJump() ? { t: now } : null;
          if (this.stick.centerTap && !INPUT.centerJumpOnRelease) {
            this._jumpPressed = true;
            this.jumpHeld = true;
            this.jumpKeepsMomentum = false;
            this.jumpDir = null;
            this.stickEl.classList.add('jump');
          }
          this._updateStick(x, y);
          return;
        }
      }
    } else if (this.layout === 'dynamic') {
      // 1) 動的ジャンプボタン(表示中のみ。見た目より少し広い判定)→ 即ジャンプ
      if (this.dynJump.hit(x, y, now)) {
        this._jumpPressed = true;
        this.jumpHeld = true;
        this.jumpKeepsMomentum = true;
        this.dynJump.press();
        this._newSwipe(e, x, y, now, true); // そのまま下へはらえばヒップアタック
        return;
      }
      // 2) 移動パッド(固定。2本目の指は掴まない)
      if (!this.stick) {
        const c = this._padCenter();
        if (Math.hypot(x - c.x, y - c.y) <= c.r + INPUT.dynPadGrabMargin) {
          this.stick = { id: e.pointerId, cx: c.x, cy: c.y, fixed: true, jump: false, fired: false, hist: [{ x, y, t: now }] };
          this.stickEl.classList.add('active');
          this._updateStick(x, y);
          return;
        }
      }
    } else if (this.layout === 'gesture') {
      if (!this.gest) {
        this.gest = { id: e.pointerId, x0: x, y0: y, t0: now, maxD: 0, mode: 'pending', fired: false, hist: [{ x, y, t: now }] };
        return; // タッチ開始時にはジャンプしない
      }
      // 2本目以降の指はカメラ回転 / 下スワイプ用(下へ)
    } else if (this.layout === 'center') {
      if (!this.stick) {
        const c = this._padCenter();
        const d = Math.hypot(x - c.x, y - c.y);
        if (d <= c.r + INPUT.padGrabMargin) {
          // 固定パッド: 中心は動かさない(真ん中タップを確実に判定するため)
          this.stick = { id: e.pointerId, cx: c.x, cy: c.y, fixed: true, jump: false, fired: false, hist: [{ x, y, t: now }] };
          this.stickEl.classList.add('active');
          if (d <= INPUT.centerJumpRadius) {
            this._jumpPressed = true;
            this.jumpHeld = true;
            this.jumpKeepsMomentum = false;
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
        this.jumpKeepsMomentum = false;
        this.jumpEl.classList.add('on');
        this._newSwipe(e, x, y, now, true);
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
    this._newSwipe(e, x, y, now, false);
  }

  _updateStick(x, y) {
    const s = this.stick;
    let dx = x - s.cx, dy = y - s.cy;
    const R = INPUT.stickRadius;
    const l = Math.hypot(dx, dy);
    s.tilt = Math.min(1, l / R);   // 倒し具合(デッドゾーン適用前、0..1)
    s.maxTilt = Math.max(s.maxTilt || 0, s.tilt);
    s.dirX = l > 0 ? dx / l : 0; s.dirY = l > 0 ? -dy / l : 0;
    if (this.layout === 'release') this.stickEl.classList.toggle('max', s.tilt >= INPUT.releaseJumpTilt);
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

  _pushHist(s, x, y) {
    const now = performance.now();
    s.hist.push({ x, y, t: now });
    while (s.hist.length > 2 && now - s.hist[0].t > INPUT.swipeMaxTime * 1000) s.hist.shift();
  }

  /**
   * 直近 swipeMaxTime 秒の動きで下スワイプを判定する(押しっぱなしから途中ではらっても発動)。
   * 発動したら true。
   */
  _detectFlick(s, x, y, minDy) {
    const now = performance.now();
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
    const g = this.gest;
    if (g && e.pointerId === g.id) {
      g.maxD = Math.max(g.maxD, Math.hypot(x - g.x0, y - g.y0)); // 一度でも閾値を超えたらタップではない
      if (g.mode === 'pending' && g.maxD >= INPUT.moveThreshold) {
        // 移動操作に確定: タッチ開始位置を中心にスティックを出す
        g.mode = 'move';
        this.stick = { id: g.id, cx: g.x0, cy: g.y0, fixed: false, jump: false, fired: false, hist: g.hist };
        this.stickEl.style.left = g.x0 + 'px';
        this.stickEl.style.top = g.y0 + 'px';
        this.stickEl.classList.add('active');
      }
      this._pushHist(g.mode === 'move' ? this.stick : g, x, y);
      if (g.mode === 'move') {
        this._updateStick(x, y);
        // 空中ですばやく下へはらう → ヒップアタック
        if (this._detectFlick(this.stick, x, y, INPUT.padFlickDy) && this.canHipFromPad()) {
          this._hipPressed = true;
          flash(this.stickEl);
        }
      }
      return;
    }
    if (this.stick && e.pointerId === this.stick.id) {
      this._pushHist(this.stick, x, y);
      this._updateStick(x, y);
      // 固定パッド: 空中でパッドを下へすばやくはらう → ヒップアタック
      if ((this.layout === 'center' || this.layout === 'dynamic' || this.layout === 'release') &&
          this._detectFlick(this.stick, x, y, INPUT.padFlickDy) && this.canHipFromPad()) {
        this._hipPressed = true;
        flash(this.stickEl);
      }
      return;
    }
    const s = this.swipes.get(e.pointerId);
    if (!s) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) return;
    const dx = x - s.x0, dy = y - s.y0;
    this._pushHist(s, x, y);
    if (!s.cam && this._detectFlick(s, x, y, INPUT.swipeMinDy)) {
      this._hipPressed = true;
      flash(this.layout === 'classic' ? this.jumpEl : this.stickEl);
    }
    // ジャンプボタン以外から始めた横ドラッグはカメラ回転
    if (!s.onJump && !s.fired && (s.cam || (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)))) {
      s.cam = true;
      this.camDragDx += x - s.lx;
    }
    s.lx = x;
  }

  _up(e, cancelled = false) {
    const g = this.gest;
    if (g && e.pointerId === g.id) {
      this.gest = null; // 先に消しておき、同じ指の up が二重に来ても1回しか判定しない
      // ジャンプ判定は指を離したときだけ: 閾値未満の移動で、かつ短時間のタップ
      const dt = (performance.now() - g.t0) / 1000;
      const d = Math.max(g.maxD, Math.hypot(e.clientX - g.x0, e.clientY - g.y0));
      if (!cancelled && g.mode === 'pending' && d < INPUT.moveThreshold && dt <= INPUT.tapMaxTime) {
        this._jumpPressed = true;
        this.jumpHeld = true;
        this.jumpKeepsMomentum = false;
        this._tapFx(g.x0, g.y0);
      }
      if (this.stick && this.stick.id === g.id) this._releaseStick();
      return;
    }
    if (this.stick && e.pointerId === this.stick.id) {
      if (this.layout === 'release') {
        const st = this.stick;
        if (!cancelled) this._updateStick(e.clientX, e.clientY); // 離した位置で最終判定
        const ct = st.centerTap;
        if (INPUT.centerJumpOnRelease && ct && !cancelled && st.maxTilt * INPUT.stickRadius <= INPUT.centerJumpRadius &&
            performance.now() - ct.t <= INPUT.tapMaxTime * 1000) {
          // (centerJumpOnRelease 時)中心を短くタップして離した → 垂直ジャンプ
          this._jumpPressed = true;
          this.jumpHeld = true;
          this.jumpKeepsMomentum = false;
          this.jumpDir = null;
        } else if (!cancelled && !st.fired && st.tilt >= INPUT.releaseJumpTilt) {
          // 最大まで倒した位置で離した → その方向へ斜めジャンプ
          this._jumpPressed = true;
          this.jumpHeld = true;
          this.jumpKeepsMomentum = false;
          this.jumpDir = { x: st.dirX, y: st.dirY };
          flash(this.stickEl);
        } else {
          // 途中で離した → その場で止まる
          this._stopPressed = true;
        }
      }
      this._releaseStick();
      return;
    }
    const s = this.swipes.get(e.pointerId);
    if (s) {
      this.swipes.delete(e.pointerId);
      if (s.onJump) {
        if (this.layout === 'dynamic') this.dynJump.release();
        else { this.jumpHeld = false; this.jumpEl.classList.remove('on'); }
      }
    }
  }

  _releaseStick() {
    // センターパッドでは「タップ=ジャンプ」なので、指を離しても小ジャンプにはしない(常にフルジャンプ)
    if (this.stick && this.stick.jump && this.layout !== 'center') this.jumpHeld = false;
    this.stick = null;
    this.move.x = 0; this.move.y = 0;
    this.stickEl.classList.remove('active', 'jump', 'max');
    this.stickEl.style.left = '';
    this.stickEl.style.top = '';
    this._setKnob(0, 0);
  }

  _tapFx(x, y) {
    const el = this.tapFxEl;
    if (!el) return;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  _setKnob(dx, dy) {
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  _key(e, down) {
    const c = e.code;
    if (down) {
      if (c === 'Space' && !e.repeat) { this._jumpPressed = true; this.jumpHeld = true; this.jumpKeepsMomentum = false; }
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
