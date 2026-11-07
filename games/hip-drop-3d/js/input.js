// 入力
//  操作タイプ 'gesture'(既定): 指1本のジェスチャー。画面のどこでも、
//                              ・15px 以上スライド → 移動(触れた位置にスティックが出る)
//                              ・動かさずに短く離す → ジャンプ(判定は指を離したとき)
//                              ・地上で走りながらすばやく上へはらう → 走り幅跳び
//                              ・空中ですばやく下へはらう → ヒップアタック
//  操作タイプ 'center'       : 画面下中央に固定の移動パッド。パッドの真ん中をタップでジャンプ、
//                              空中でパッドを下へすばやくはらうとヒップアタック。
//  操作タイプ 'classic'      : 左下に仮想スティック + 右下にジャンプボタン(ボタンから下スワイプでヒップ)
//  共通: パッド以外の場所の下スワイプ=ヒップアタック / 横ドラッグ=カメラ回転
//  PC: WASD・矢印=移動, Space=ジャンプ, Shift / K=ヒップアタック, マウスドラッグ=カメラ
import { INPUT } from './config.js';

const LAYOUT_KEY = 'hipdrop.layout2'; // 既定変更に伴いキーを更新(以前の選択は引き継がない)
const LAYOUTS = ['gesture', 'center', 'classic'];

export function loadLayout() {
  const q = new URLSearchParams(location.search).get('pad');
  if (LAYOUTS.includes(q)) return q;
  try { const v = localStorage.getItem(LAYOUT_KEY); if (LAYOUTS.includes(v)) return v; } catch (_) {}
  return 'gesture';
}

export class Input {
  constructor(root) {
    this.root = root;
    this.move = { x: 0, y: 0 };      // スティック入力(-1..1, y+ が奥)
    this.jumpHeld = false;
    this._jumpPressed = false;       // 1回分のトリガー(consume で消費)
    this._hipPressed = false;
    this._longPressed = false;       // 走り幅跳び(上フリック)
    this.camDragDx = 0;              // このフレームのカメラドラッグ量 [px]
    this.canHipFromPad = () => true; // パッドのはらいでヒップを出してよいか(main が空中判定を渡す)
    this.canLongJump = () => true;   // 上フリックを走り幅跳びとして受け付けてよいか(main が走行判定を渡す)

    this.stickEl = document.getElementById('stick');
    this.knobEl = document.getElementById('stickKnob');
    this.jumpEl = document.getElementById('jumpBtn');

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
  }

  /** タップで跳ぶ操作タイプでは、指を離しても小ジャンプにしない */
  get fullJumpOnTap() { return this.layout !== 'classic'; }

  // ---- 1フレーム分のトリガー取得 ----
  consumeJump() { const v = this._jumpPressed; this._jumpPressed = false; return v; }
  consumeHip() { const v = this._hipPressed; this._hipPressed = false; return v; }
  consumeLongJump() { const v = this._longPressed; this._longPressed = false; return v; }
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

    if (this.layout === 'gesture') {
      // 1本目の指だけをジェスチャーとして扱う(同じ pointerId の二重 down は無視)
      if (this.gest && this.gest.id === e.pointerId) return;
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
          this.stick = { id: e.pointerId, cx: c.x, cy: c.y, ox: 0, oy: 0, t0: now, fixed: true, jump: false, fired: false, hist: [{ x, y, t: now }] };
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
        this.stick = { id: e.pointerId, cx: x, cy: y, ox: 0, oy: 0, t0: now, fixed: false, jump: false, fired: false, hist: [{ x, y, t: now }] };
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
    // ox,oy: 上フリックで指が動いた分。スティック入力に反映させない(フリックで進路が変わらないように)
    let dx = x - s.cx - s.ox, dy = y - s.cy - s.oy;
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
    s.lastRel = { x: dx, y: dy };
    this._setKnob(dx, dy);
  }

  /**
   * 直近 swipeMaxTime 秒の動きで下スワイプを判定する(押しっぱなしから途中ではらっても発動)。
   * 発動したら true。
   */
  _pushHist(s, x, y) {
    const now = performance.now();
    // rel: その時点で直前まで有効だったスティック入力(中心からの相対位置)。上フリック後の復元に使う
    const rel = s.cx !== undefined && s.lastRel ? { x: s.lastRel.x, y: s.lastRel.y } : null;
    s.hist.push({ x, y, t: now, rel });
    while (s.hist.length > 2 && now - s.hist[0].t > INPUT.swipeMaxTime * 1000) s.hist.shift();
  }

  /**
   * 走り幅跳びの上フリック判定。移動量・速さ・方向・時間をすべて満たしたときだけ、測定の基準点を返す。
   * ゆっくり上へドラッグ(=前進)や歩き出しの勢いとは区別する。
   */
  _detectUpFlick(s, x, y) {
    const now = performance.now();
    if (s.upT && now - s.upT < INPUT.upFlickRearm * 1000) return null;
    if (now - s.t0 < INPUT.upFlickArmTime * 1000) return null;
    // 判定窓 upFlickTime 内で最も古いサンプルから測る
    let ref = null;
    for (const h of s.hist) if (now - h.t <= INPUT.upFlickTime * 1000) { ref = h; break; }
    if (!ref || ref.t === now) return null;
    const dx = x - ref.x, up = ref.y - y;
    const dist = Math.hypot(dx, up);
    const speed = dist / ((now - ref.t) / 1000);
    const angle = Math.atan2(Math.abs(dx), up) * 180 / Math.PI;
    if (up >= INPUT.upFlickMinDist && speed >= INPUT.upFlickMinSpeed && angle <= INPUT.upFlickMaxAngle) return ref;
    return null;
  }

  _tryLongJump(s, x, y) {
    const ref = this._detectUpFlick(s, x, y);
    if (ref && this.canLongJump()) {
      s.upT = performance.now();
      // フリックで動いた分はスティック入力から差し引き、フリック前の進路と速さを保つ
      if (ref.rel) { s.ox = x - s.cx - ref.rel.x; s.oy = y - s.cy - ref.rel.y; }
      else { s.ox += x - ref.x; s.oy += y - ref.y; }
      this._longPressed = true;
      flash(this.stickEl);
    }
  }

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
        this.stick = { id: g.id, cx: g.x0, cy: g.y0, ox: 0, oy: 0, t0: performance.now(), fixed: false, jump: false, fired: false, hist: g.hist };
        this.stickEl.style.left = g.x0 + 'px';
        this.stickEl.style.top = g.y0 + 'px';
        this.stickEl.classList.add('active');
      }
      this._pushHist(g.mode === 'move' ? this.stick : g, x, y);
      if (g.mode === 'move') {
        this._tryLongJump(this.stick, x, y); // 地上で走りながら上へはらう → 走り幅跳び
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
      this._tryLongJump(this.stick, x, y);
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
    this._pushHist(s, x, y);
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
        this._tapFx(g.x0, g.y0);
      }
      if (this.stick && this.stick.id === g.id) this._releaseStick();
      return;
    }
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
      if (c === 'Space' && !e.repeat) { this._jumpPressed = true; this.jumpHeld = true; }
      if ((c === 'ShiftLeft' || c === 'ShiftRight' || c === 'KeyK' || c === 'KeyJ') && !e.repeat) this._hipPressed = true;
      if ((c === 'KeyL' || c === 'KeyE') && !e.repeat) this._longPressed = true;
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
