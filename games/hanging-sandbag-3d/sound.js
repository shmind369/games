// 効果音(WebAudio で合成。音声ファイルは使わない)
//  hit   : バッグに当たった「ドスッ」(撃力が強いほど重く大きく)+ 革の「パン」
//  chain : 吊りチェーンの「チャリッ」(強く当たったとき、少し遅れて)
//  swing : パンチの風切り音
//  step  : ステップの蹴り出し / 着地のシューズの音
//  dodge : 回避に入ったときの短い風切り音
// iOS Safari は最初のタッチまで音を出せないので、unlock() を操作のたびに呼ぶ(指を離した・タップしたイベントの中で)。
// iPhone のマナーモード(消音スイッチ)では WebAudio の音が消されるため、音声を「メディア再生」扱いにして鳴るようにする。
const MUTE_KEY = 'sandbag.muted';
// 0.1 秒の無音 WAV(古い iOS のマナーモード対策で、ループ再生してメディア再生扱いにする)
const SILENT_WAV = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (_) {}
    this._noise = null;
  }

  /** ユーザー操作(指を離した・タップ・キー)のたびに呼ぶ。AudioContext を作る/再開する */
  unlock() {
    // iOS 17 以降: 音声を「再生」扱いに(マナーモードでも鳴る)
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (_) {}
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor(); // 連打で音割れしないように
      comp.threshold.value = -14; comp.ratio.value = 6;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1.0;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      // 白色雑音(使い回す)
      const n = this.ctx.sampleRate * 1.0, buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    // 'suspended' だけでなく、着信などで止められた 'interrupted' からも戻す
    if (this.ctx.state !== 'running') { try { this.ctx.resume().catch(() => {}); } catch (_) {} }
    if (!this._kicked) {
      // 操作の中で無音を1回鳴らして、iOS の音声のロックを解除する
      try {
        const b = this.ctx.createBuffer(1, 1, 22050), src = this.ctx.createBufferSource();
        src.buffer = b; src.connect(this.ctx.destination); src.start(0);
        this._kicked = true;
      } catch (_) {}
    }
    // 古い iOS(audioSession が無い)のマナーモード対策: 無音の <audio> をループ再生しておく
    if (IS_IOS && !navigator.audioSession && !this._silentEl) {
      try {
        const a = new Audio(SILENT_WAV);
        a.loop = true; a.setAttribute('playsinline', ''); a.setAttribute('webkit-playsinline', '');
        const pr = a.play(); if (pr && pr.catch) pr.catch(() => { this._silentEl = null; });
        this._silentEl = a;
      } catch (_) {}
    }
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (_) {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1.0, this.ctx.currentTime, 0.02);
  }

  get ready() { return this.ctx && this.ctx.state === 'running' && !this.muted; }

  // ---- 部品 ----
  _noiseSrc(t, dur, type, f0, f1, q, gain, attack = 0.002) {
    const c = this.ctx, src = c.createBufferSource(), flt = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this._noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  _tone(t, dur, wave, f0, f1, gain, attack = 0.002) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ---- 効果音 ----
  /** バッグに当たった音。impulse [N·s](16=ジャブ〜30=ストレート)。heavy: フック・ストレートなど */
  hit(impulse, heavy = false) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, k = Math.min(1.5, 0.55 + impulse / 32); // ジャブ ≈1.05 / ストレート ≈1.5
    // 低い「ドスッ」: 砂袋の重さ
    this._tone(t, 0.16 + 0.06 * k, 'sine', heavy ? 95 : 120, 45, 1.3 * k);
    this._noiseSrc(t, 0.12 + 0.05 * k, 'lowpass', 900 + 500 * k, 180, 0.7, 1.4 * k);
    // 革の「パン」: 表面を叩いた高い成分
    this._noiseSrc(t, 0.035, 'bandpass', heavy ? 1700 : 2300, heavy ? 1200 : 1600, 1.2, 1.6 * k);
    if (impulse > 20) this.chain(Math.min(1, (impulse - 20) / 15), 0.07);
  }

  /** 吊りチェーンの音(強さ 0..1、delay 秒後) */
  chain(strength = 0.5, delay = 0) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime + delay, n = 2 + Math.round(strength * 3);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.035 + Math.random() * 0.03), f = 2600 + Math.random() * 1800;
      this._tone(t, 0.08, 'triangle', f, f * 0.98, 0.16 * (0.5 + strength));
      this._noiseSrc(t, 0.03, 'highpass', 5000, 5000, 0.7, 0.25 * (0.5 + strength));
    }
  }

  /** パンチの風切り音 */
  swing(kind) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, hook = kind && kind.startsWith('hook');
    const dur = kind === 'jab' ? 0.11 : hook ? 0.2 : 0.15;
    this._noiseSrc(t, dur, 'bandpass', hook ? 700 : 900, hook ? 1800 : 2400, 1.4, 1.6, 0.03);
  }

  /** ステップ: push=蹴り出し(キュッ) / land=着地(トン) */
  step(type) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (type === 'push') {
      this._noiseSrc(t, 0.05, 'bandpass', 3200, 4200, 3, 1.4);
    } else {
      this._tone(t, 0.06, 'sine', 140, 80, 0.45);
      this._noiseSrc(t, 0.04, 'lowpass', 1400, 400, 0.7, 0.5);
    }
  }

  /** 回避に入ったときの短い風切り音 */
  dodge() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._noiseSrc(t, 0.12, 'bandpass', 1400, 600, 1.0, 1.4, 0.02);
  }
}
