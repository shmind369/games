// 敵: 決まった範囲をうろつく。ヒップアタックで撃破され、吹き飛んで消える。
import * as THREE from 'three';
import { ENEMY as E } from './config.js';

export class Enemy {
  constructor(scene, spawn) {
    this.spawn = spawn;
    this.pos = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.prevPos = this.pos.clone();
    this.radius = E.radius;
    this.height = E.height;
    this.alive = true;
    this.dying = false;
    this.dieT = 0;
    this.dieVel = new THREE.Vector3();
    this.target = new THREE.Vector2(spawn.x, spawn.z);
    this.wait = Math.random() * 0.8;
    this.yaw = Math.random() * Math.PI * 2;
    this.squish = 0;          // 踏まれたときのつぶれ
    this.t = Math.random() * 10;
    this._build(scene);
  }

  _build(scene) {
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    const mat = new THREE.MeshLambertMaterial({ color: 0x8e44ad });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.scale.set(1, 1.3, 1);
    dome.castShadow = true;
    body.add(dome);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.18, 18), new THREE.MeshLambertMaterial({ color: 0x5b2c6f }));
    base.position.y = 0.0;
    body.add(base);
    // トゲ(上から普通に踏んでも倒せない、の目印)
    const spikeMat = new THREE.MeshLambertMaterial({ color: 0xecf0f1 });
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 8), spikeMat);
      const a = (i / 5) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.22, 0.6, Math.sin(a) * 0.22);
      s.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      body.add(s);
    }
    const eyeW = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeB = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), eyeW);
      e.position.set(sx * 0.17, 0.32, 0.4);
      e.scale.set(1, 1.3, 0.6);
      body.add(e);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), eyeB);
      p.position.set(sx * 0.17, 0.3, 0.46);
      body.add(p);
    }
    body.position.y = 0.09;
    this.group = g;
    this.body = body;
    scene.add(g);
  }

  step(dt) {
    this.prevPos.copy(this.pos);
    this.t += dt;
    if (this.dying) {
      // 吹き飛び(重力付き)
      this.dieT += dt;
      this.dieVel.y -= 30 * dt;
      this.pos.addScaledVector(this.dieVel, dt);
      return;
    }
    if (!this.alive) return;
    this.squish = Math.max(0, this.squish - dt * 3);

    // 徘徊: 範囲内の目標点へ歩き、着いたら少し止まって次の目標へ
    if (this.wait > 0) { this.wait -= dt; return; }
    const dx = this.target.x - this.pos.x, dz = this.target.y - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.1) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * this.spawn.range;
      this.target.set(this.spawn.x + Math.cos(a) * r, this.spawn.z + Math.sin(a) * r);
      this.wait = 0.3 + Math.random() * 0.9;
      return;
    }
    const step = Math.min(d, E.speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    const want = Math.atan2(dx, dz);
    let diff = ((want - this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.yaw += diff * Math.min(1, dt * 8);
  }

  /** 撃破: 吹き飛ばす方向を受け取る */
  kill(fromX, fromZ, power = 1) {
    if (!this.alive) return;
    this.alive = false;
    this.dying = true;
    let dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const l = Math.hypot(dx, dz);
    if (l < 0.05) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }
    else { dx /= l; dz /= l; }
    this.dieVel.set(dx * 6 * power, 11 * power, dz * 6 * power);
  }

  render(alpha) {
    const g = this.group;
    if (this.dying && this.dieT > 1.0) { g.visible = false; return; }
    g.position.lerpVectors(this.prevPos, this.pos, alpha);
    if (this.dying) {
      // くるくる回りながら縮んで消える
      g.rotation.x = this.dieT * 14;
      g.rotation.z = this.dieT * 9;
      const s = Math.max(0.01, 1 - Math.max(0, this.dieT - 0.4) / 0.6);
      g.scale.set(s, s, s);
      return;
    }
    g.rotation.y = this.yaw;
    const bob = Math.abs(Math.sin(this.t * 7)) * 0.06;
    const sq = this.squish;
    this.body.position.y = 0.09 + bob;
    this.body.scale.set(1 + sq * 0.5, 1 - sq * 0.6 + Math.sin(this.t * 7) * 0.03, 1 + sq * 0.5);
  }
}
