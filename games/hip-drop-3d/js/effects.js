// 演出: 衝撃波リング・土煙パーティクル・画面揺れ・ヒットストップ・効果音(WebAudio)
import * as THREE from 'three';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.rings = [];
    this.parts = [];
    this.shake = 0;
    this.hitStop = 0;
    this.partGeo = new THREE.SphereGeometry(1, 6, 5);
    this.audio = null;
  }

  // ---------- 衝撃波 ----------
  shockwave(x, y, z, radius = 2.4, color = 0xffffff) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 1, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.04, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, t: 0, life: 0.35, radius });
    // 土煙
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 4 + Math.random() * 3;
      this.particle(x, y + 0.1, z, Math.cos(a) * sp, 1.5 + Math.random() * 2, Math.sin(a) * sp, 0xf3e3c3, 0.16 + Math.random() * 0.1, 0.5);
    }
  }

  burst(x, y, z, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(4 + Math.random() * 4);
      v.y = Math.abs(v.y) + 2;
      this.particle(x, y, z, v.x, v.y, v.z, color, 0.09 + Math.random() * 0.08, 0.6);
    }
  }

  particle(x, y, z, vx, vy, vz, color, size, life) {
    const m = new THREE.Mesh(this.partGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.set(x, y, z);
    m.scale.setScalar(size);
    this.scene.add(m);
    this.parts.push({ m, v: new THREE.Vector3(vx, vy, vz), t: 0, life, size });
  }

  update(dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      const e = 1 - (1 - k) * (1 - k);
      r.mesh.scale.setScalar(0.2 + e * r.radius);
      r.mesh.material.opacity = 0.9 * (1 - k);
      if (k >= 1) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      p.v.y -= 14 * dt;
      p.v.multiplyScalar(Math.exp(-dt * 3));
      p.m.position.addScaledVector(p.v, dt);
      const k = p.t / p.life;
      p.m.scale.setScalar(p.size * (1 - k * 0.7));
      p.m.material.opacity = 1 - k;
      if (k >= 1) { this.scene.remove(p.m); p.m.material.dispose(); this.parts.splice(i, 1); }
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  addShake(v) { this.shake = Math.min(0.6, this.shake + v); }

  // ---------- 効果音(合成音。素材ファイル不要) ----------
  unlockAudio() {
    if (this.audio) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.audio = new AC();
  }

  sound(type) {
    const ac = this.audio;
    if (!ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    const env = (a, d, peak = 0.25) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      o.start(t); o.stop(t + a + d + 0.02);
    };
    switch (type) {
      case 'jump':
        o.type = 'square'; o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(660, t + 0.12);
        env(0.005, 0.12, 0.08); break;
      case 'superJump':
        o.type = 'square'; o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(1100, t + 0.25);
        env(0.005, 0.25, 0.09); break;
      case 'hipStart':
        o.type = 'triangle'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.15);
        env(0.005, 0.15, 0.15); break;
      case 'hipImpact':
        o.type = 'sawtooth'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
        env(0.003, 0.28, 0.3); this._noise(0.2, 0.25); break;
      case 'defeat':
        o.type = 'square'; o.frequency.setValueAtTime(520, t); o.frequency.setValueAtTime(780, t + 0.06); o.frequency.setValueAtTime(1040, t + 0.12);
        env(0.005, 0.22, 0.1); break;
      case 'land':
        o.type = 'sine'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.06);
        env(0.003, 0.07, 0.12); break;
      case 'hurt':
        o.type = 'sawtooth'; o.frequency.setValueAtTime(400, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.3);
        env(0.005, 0.3, 0.12); break;
      case 'bump':
        o.type = 'triangle'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(200, t + 0.08);
        env(0.003, 0.09, 0.15); break;
      case 'clear':
        o.type = 'square';
        [523, 659, 784, 1047].forEach((f, i) => o.frequency.setValueAtTime(f, t + i * 0.12));
        env(0.01, 0.6, 0.1); break;
    }
  }

  _noise(dur, vol) {
    const ac = this.audio;
    const n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain(); g.gain.value = vol;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    src.connect(f); f.connect(g); g.connect(ac.destination);
    src.start();
  }
}
