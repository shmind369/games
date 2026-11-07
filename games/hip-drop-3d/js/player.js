// プレイヤー: 状態機械(normal / hipWindup / hipFall / hipLand)+ 見た目(手続きアニメーション)
import * as THREE from 'three';
import { PLAYER as P } from './config.js';
import { moveAndCollide } from './collision.js';

const TAU = Math.PI * 2;

export class Player {
  constructor(scene) {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.radius = P.radius;
    this.height = P.height;
    this.yaw = Math.PI;          // 向き(+Z が 0)。開始時は奥(-Z)を向く
    this.state = 'normal';
    this.stateTime = 0;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.hipBuf = 0;
    this.jumpCut = false;
    this.invincible = 0;
    this.hurtLock = 0;
    this.hp = P.maxHp;
    this.events = [];            // このステップで起きた出来事(演出・効果音用)
    this.groundY = 0;            // 真下の床の高さ
    this.superJump = false;
    this.longBuf = 0;            // 走り幅跳びの先行入力
    this.jumpKind = null;        // 'standing' | 'running' | 'long'(空中にいる間だけ)
    this.jumpT = 0;              // 踏み切りからの経過時間(アニメーション同期用)
    this.recentSpeed = 0;        // 直近の最高水平速度(入力遅延で踏み切り速度が落ちないように)

    // 描画用
    this.anim = { run: 0, squash: 0, squashV: 0, flip: 0 };
    this._buildModel(scene);
  }

  // ------------------------------------------------------------
  //  見た目(オリジナルの丸いキャラクター)
  // ------------------------------------------------------------
  _buildModel(scene) {
    const root = new THREE.Group();
    const body = new THREE.Group();   // 回転・伸縮用
    root.add(body);

    const skin = new THREE.MeshLambertMaterial({ color: 0xff9f43 });
    const belly = new THREE.MeshLambertMaterial({ color: 0xfff1d6 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2d2a32 });
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const shoe = new THREE.MeshLambertMaterial({ color: 0x3d7cff });

    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 16), skin);
    torso.position.y = 0.55;
    torso.scale.set(1, 0.95, 0.95);
    torso.castShadow = true;
    body.add(torso);
    const bel = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), belly);
    bel.position.set(0, 0.5, 0.2);
    bel.scale.set(1, 1, 0.7);
    body.add(bel);
    // おしり(攻撃部位)
    const hip = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), skin);
    hip.position.set(0, 0.36, -0.26);
    hip.castShadow = true;
    body.add(hip);
    // 目
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), white);
      e.position.set(s * 0.16, 0.72, 0.38);
      body.add(e);
      const pu = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), dark);
      pu.position.set(s * 0.16, 0.72, 0.465);
      body.add(pu);
    }
    // 耳
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 10), skin);
      ear.position.set(s * 0.24, 1.0, -0.02);
      ear.rotation.z = -s * 0.35;
      body.add(ear);
    }
    // 腕
    this.arms = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.42, 0.62, 0);
      const arm = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), skin);
      arm.scale.set(1, 1.5, 1);
      arm.position.y = -0.12;
      pivot.add(arm);
      body.add(pivot);
      this.arms.push(pivot);
    }
    // 足
    this.feet = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.2, 0.22, 0);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), shoe);
      f.scale.set(1, 0.7, 1.4);
      f.position.set(0, -0.12, 0.05);
      f.castShadow = true;
      pivot.add(f);
      body.add(pivot);
      this.feet.push(pivot);
    }

    // 足元の丸影(高さ感をつかみやすくする)と、空中での落下地点マーカー
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 32),
      new THREE.MeshBasicMaterial({ color: 0xff3b6b, transparent: true, opacity: 0.0, depthWrite: false })
    );
    marker.rotation.x = -Math.PI / 2;
    scene.add(shadow, marker);

    scene.add(root);
    this.root = root;
    this.body = body;
    this.shadow = shadow;
    this.marker = marker;
  }

  // ------------------------------------------------------------
  //  ロジック(固定時間刻み)
  // ------------------------------------------------------------
  reset(spawn) {
    this.pos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.state = 'normal';
    this.stateTime = 0;
    this.grounded = true;
    this.invincible = 0;
    this.hurtLock = 0;
    this.jumpBuf = 0; this.hipBuf = 0;
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  /** ジャンプ・ヒップアタック入力を受け付ける(フレーム単位で呼ぶ) */
  pressJump() { this.jumpBuf = P.jumpBuffer; }
  pressHip() { this.hipBuf = P.hipBuffer; }
  pressLongJump() { this.longBuf = P.jumpBuffer; }

  /** 走り幅跳びを受け付けられる状態か(入力側の誤判定防止にも使う) */
  canLongJump() {
    return this.state === 'normal' && (this.grounded || this.coyote > 0) &&
      this.recentSpeed >= P.runSpeed * P.longJumpMinRunFrac;
  }

  /**
   * move: {x,y} スティック入力 / camYaw: カメラの水平角 / jumpHeld: ボタン押下中か
   */
  step(dt, move, camYaw, jumpHeld, stage) {
    this.events.length = 0;
    this.stateTime += dt;
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    this.hipBuf = Math.max(0, this.hipBuf - dt);
    this.longBuf = Math.max(0, this.longBuf - dt);
    this.jumpT += dt;
    this.invincible = Math.max(0, this.invincible - dt);
    this.hurtLock = Math.max(0, this.hurtLock - dt);
    this.groundY = stage.groundBelow(this.pos.x, this.pos.z, this.pos.y + 0.05, this.radius * 0.5);

    switch (this.state) {
      case 'normal': this._stepNormal(dt, move, camYaw, jumpHeld, stage); break;
      case 'hipWindup': this._stepWindup(dt); break;
      case 'hipFall': this._stepFall(dt, stage); break;
      case 'hipLand': this._stepLand(dt, move, camYaw, jumpHeld, stage); break;
    }
  }

  _wishDir(move, camYaw) {
    // カメラ基準: スティック上 = カメラの向いている方向
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    return { x: fx * move.y + rx * move.x, z: fz * move.y + rz * move.x, mag: Math.min(1, Math.hypot(move.x, move.y)) };
  }

  _stepNormal(dt, move, camYaw, jumpHeld, stage) {
    const w = this.hurtLock > 0 ? { x: 0, z: 0, mag: 0 } : this._wishDir(move, camYaw);
    if (this.grounded) this._groundControl(dt, w);
    else this._airControl(dt, w);

    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded) this.recentSpeed = Math.max(sp, this.recentSpeed - (P.runSpeed / P.speedMemory) * dt);

    // 向き: 地上は入力方向へ、空中は実際に飛んでいる方向へ(地上より緩やか)
    if (this.grounded && w.mag > 0.05) {
      this.yaw = turnToward(this.yaw, Math.atan2(w.x, w.z), P.turnRate * dt);
    } else if (!this.grounded && sp > 1) {
      this.yaw = turnToward(this.yaw, Math.atan2(this.vel.x, this.vel.z), P.turnRate * 0.5 * dt);
    }

    // ジャンプ(コヨーテタイム+先行入力)。走り幅跳びを優先
    if (this.grounded) this.coyote = P.coyoteTime;
    else this.coyote = Math.max(0, this.coyote - dt);
    if (this.longBuf > 0 && this.coyote > 0 && this.recentSpeed >= P.runSpeed * P.longJumpMinRunFrac) {
      this._doJump('long');
    } else if (this.jumpBuf > 0 && this.coyote > 0) {
      this._doJump(sp > P.runSpeed * 0.35 ? 'running' : 'standing');
    }
    // 小ジャンプ: 上昇中にボタンを離したら上昇速度を削る(走り幅跳びは対象外)
    if (!jumpHeld && this.vel.y > 0 && !this.jumpCut && !this.grounded && this.jumpKind !== 'long') {
      this.vel.y *= P.jumpCutMul;
      this.jumpCut = true;
    }

    // 重力(走り幅跳び中は弱めて、長く伸びる放物線に)
    let g = this.vel.y > 0 ? P.gravityUp : P.gravityDown;
    if (this.jumpKind === 'long') g *= P.longJumpGravityMul;
    this.vel.y = Math.max(this.vel.y - g * dt, -P.maxFall);

    const wasGrounded = this.grounded;
    const fallSpeed = -this.vel.y;
    const res = moveAndCollide(this, stage.boxes, dt);
    this.grounded = res.landed;
    if (res.landed && !wasGrounded) {
      this.events.push({ type: 'land', speed: fallSpeed, kind: this.jumpKind });
      this.jumpKind = null;
      this.recentSpeed = Math.hypot(this.vel.x, this.vel.z); // 着地後もそのまま走り続けられる
      this.anim.squashV = -Math.min(10, fallSpeed * 0.5);
    }
    if (this.grounded) this.superJump = false;

    // ヒップアタック発動(空中で一定以上の高さがあるとき)
    if (this.hipBuf > 0 && !this.grounded && this.hurtLock <= 0) {
      const h = this.pos.y - stage.groundBelow(this.pos.x, this.pos.z, this.pos.y + 0.05, this.radius * 0.5);
      if (h >= P.hipMinHeight || this.vel.y > 2) {
        this.hipBuf = 0;
        this.setState('hipWindup');
        this.vel.set(0, 0, 0);
        this.jumpKind = null;
        this.events.push({ type: 'hipStart' });
      }
    }
  }

  /**
   * 踏み切り。水平速度はリセットせず引き継ぎ、垂直方向にだけ専用の初速を与える。
   *  standing / running: 高さ jumpHeight。水平速度はそのまま
   *  long: 高さ longJumpHeight、水平初速 = 直近の走行速度 × longJumpSpeedMul
   */
  _doJump(kind) {
    const gUp = P.gravityUp * (kind === 'long' ? P.longJumpGravityMul : 1);
    const h = kind === 'long' ? P.longJumpHeight : P.jumpHeight;
    this.vel.y = Math.sqrt(2 * gUp * h) * (this.superJump ? 1.3 : 1);
    if (kind === 'long') {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      // 方向は実際に走っている向き(止まりかけなら体の向き)
      const dx = sp > 0.5 ? this.vel.x / sp : Math.sin(this.yaw);
      const dz = sp > 0.5 ? this.vel.z / sp : Math.cos(this.yaw);
      const H = Math.min(P.longJumpMaxSpeed, Math.max(P.longJumpMinSpeed, Math.max(sp, this.recentSpeed) * P.longJumpSpeedMul));
      this.vel.x = dx * H; this.vel.z = dz * H;
      this.yaw = Math.atan2(dx, dz);
    }
    this.events.push({ type: this.superJump ? 'superJump' : kind === 'long' ? 'longJump' : 'jump', kind });
    this.jumpKind = kind;
    this.jumpT = 0;
    this.superJump = false;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.longBuf = 0;
    this.jumpCut = kind === 'long';
    this.anim.squashV = kind === 'long' ? 9 : 6;
  }

  /** 地上: 入力方向・速度へ素早く合わせる。走行速度を超える勢い(着地直後)はゆっくり落とす */
  _groundControl(dt, w) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (w.mag > 0.01) {
      const wl = Math.hypot(w.x, w.z) || 1;
      const dot = sp > 0.01 ? (this.vel.x * w.x + this.vel.z * w.z) / (sp * wl) : 0;
      let T = P.runSpeed * w.mag;
      if (sp > T && dot > 0.7) T = Math.max(T, sp - P.groundOverspeedDecel * dt);
      approach2(this.vel, (w.x / wl) * T, (w.z / wl) * T, P.groundAccel * dt);
    } else {
      approach2(this.vel, 0, 0, P.groundDecel * dt);
    }
  }

  /** 空中: 勢いを保ったまま、地上より緩やかに向きを変える。急減速・急停止はしない */
  _airControl(dt, w) {
    const v = this.vel;
    let sp = Math.hypot(v.x, v.z);
    if (w.mag > 0.05) {
      const wl = Math.hypot(w.x, w.z);
      const wx = w.x / wl, wz = w.z / wl;
      const T = P.runSpeed * w.mag;
      if (sp < 0.5) {
        approach2(v, wx * T, wz * T, P.airAccel * dt); // ほぼ真上へのジャンプ中: 入力方向へ加速
        return;
      }
      let dx = v.x / sp, dz = v.z / sp;
      const dot = dx * wx + dz * wz;
      // 進行方向を入力方向へ、最大 airTurnRate で回す(速さは保つ)
      const cross = dx * wz - dz * wx;
      const ang = Math.atan2(cross, dot);
      const maxA = P.airTurnRate * dt;
      const a = Math.max(-maxA, Math.min(maxA, ang));
      const c = Math.cos(a), sn = Math.sin(a);
      const ndx = dx * c - dz * sn, ndz = dx * sn + dz * c;
      dx = ndx; dz = ndz;
      if (dot < -0.3) sp = Math.max(0, sp - P.airBrake * dt * -dot);   // 逆入力: ブレーキ
      else if (sp < T) sp = Math.min(T, sp + P.airAccel * dt * Math.max(0.2, dot)); // 遅ければ加速
      else if (sp > P.runSpeed) sp = Math.max(P.runSpeed, sp - P.airOverspeedDecel * dt); // 勢いはゆっくり目減り
      v.x = dx * sp; v.z = dz * sp;
    } else if (sp > 0) {
      const ns = Math.max(0, sp - P.airDecel * dt);
      v.x *= ns / sp; v.z *= ns / sp;
    }
  }

  _stepWindup(dt) {
    // 空中で一瞬静止して前転(溜め)
    this.vel.set(0, 0, 0);
    if (this.stateTime >= P.hipWindup) {
      this.setState('hipFall');
      this.vel.set(0, -P.hipFallSpeed, 0);
    }
  }

  _stepFall(dt, stage) {
    // 水平移動は停止、真下へ急降下
    this.vel.x = 0; this.vel.z = 0;
    this.vel.y = -P.hipFallSpeed;
    const res = moveAndCollide(this, stage.boxes, dt);
    if (res.landed) {
      this.grounded = true;
      this.setState('hipLand');
      this.events.push({ type: 'hipImpact', x: this.pos.x, y: this.pos.y, z: this.pos.z });
      this.anim.squashV = -14;
    }
  }

  _stepLand(dt, move, camYaw, jumpHeld, stage) {
    this.vel.x *= 0.5; this.vel.z *= 0.5;
    this.vel.y = Math.max(this.vel.y - P.gravityDown * dt, -P.maxFall);
    const res = moveAndCollide(this, stage.boxes, dt);
    this.grounded = res.landed;
    // 着地硬直中にジャンプを押すと「大ジャンプ」(ヒップアタックの見返り)
    if (this.jumpBuf > 0 && this.stateTime > 0.05) {
      this.superJump = true;
      this.setState('normal');
      this._stepNormal(0, move, camYaw, jumpHeld, stage);
      return;
    }
    if (this.stateTime >= P.hipLandStun || !this.grounded) this.setState('normal');
  }

  /** 敵に命中したとき: 跳ね返って通常状態へ */
  bounceFromHit() {
    this.setState('normal');
    this.vel.set(0, P.hipBounce, 0);
    this.grounded = false;
    this.jumpCut = true; // 跳ね返りは小ジャンプ扱いにしない
    this.anim.squashV = 8;
  }

  /** 敵を踏んだ(通常落下): 小さく跳ねる */
  smallBounce() {
    this.vel.y = 9;
    this.jumpCut = true;
    this.grounded = false;
  }

  hurt(fromX, fromZ) {
    if (this.invincible > 0) return false;
    this.hp--;
    this.invincible = P.invincible;
    this.hurtLock = 0.3;
    let dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    this.vel.set((dx / l) * P.hurtKnock, P.hurtUp, (dz / l) * P.hurtKnock);
    this.grounded = false;
    this.setState('normal');
    this.events.push({ type: 'hurt' });
    return true;
  }

  // ------------------------------------------------------------
  //  描画(可変フレーム)
  // ------------------------------------------------------------
  render(dt, renderPos, time) {
    const a = this.anim;
    this.root.position.copy(renderPos);
    this.root.rotation.y = this.yaw;

    // 伸び縮み(ばね)
    a.squashV += (-a.squash * 180 - a.squashV * 14) * dt;
    a.squash += a.squashV * dt;
    const sq = THREE.MathUtils.clamp(a.squash, -0.45, 0.45);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const b = this.body;
    b.rotation.set(0, 0, 0);
    b.position.set(0, 0, 0);

    let armA = 0, footA = [0, 0], armSpread = 0;
    if (this.state === 'normal' || this.state === 'hipLand') {
      if (this.grounded) {
        a.run += speed * dt * 2.2;
        const s = Math.sin(a.run * 2);
        footA = [s * 0.8 * Math.min(1, speed / 4), -s * 0.8 * Math.min(1, speed / 4)];
        armA = -s * 0.6 * Math.min(1, speed / 4);
        b.position.y = Math.abs(Math.cos(a.run * 2)) * 0.07 * Math.min(1, speed / 3);
        b.rotation.x = Math.min(1, speed / P.runSpeed) * 0.18; // 前傾
      } else if (this.jumpKind === 'long') {
        // 走り幅跳び: 踏み切りで脚を大きく前後に開き前傾 → 下降に入ると両脚を前へ出して着地準備
        const k = THREE.MathUtils.smoothstep(-this.vel.y, -3, 4); // 0=上昇, 1=下降
        footA = [THREE.MathUtils.lerp(1.2, 0.9, k), THREE.MathUtils.lerp(-1.1, 0.7, k)];
        armA = THREE.MathUtils.lerp(-1.2, 0.6, k);
        armSpread = THREE.MathUtils.lerp(0.4, 1.6, k);
        b.rotation.x = THREE.MathUtils.lerp(0.4, -0.15, k);
      } else if (this.jumpKind === 'running' && this.jumpT < 0.3) {
        // 走りながらの踏み切り: 片脚を前に出し、反対の腕を振り上げる
        const k = this.jumpT / 0.3;
        footA = [THREE.MathUtils.lerp(1.0, -0.6, k), THREE.MathUtils.lerp(-0.9, -0.4, k)];
        armA = THREE.MathUtils.lerp(-0.9, 0, k);
        armSpread = THREE.MathUtils.lerp(0.6, 1.8, k);
        b.rotation.x = THREE.MathUtils.lerp(0.25, 0, k);
      } else {
        // 空中: 足をたたむ、上昇中は腕を上げる
        footA = [-0.6, -0.4];
        armSpread = this.vel.y > 0 ? 1.8 : 1.0;
        b.rotation.x = THREE.MathUtils.clamp(-this.vel.y * 0.02, -0.25, 0.25);
      }
      if (this.state === 'hipLand') { b.rotation.x = -0.1; armSpread = 0.4; }
    } else if (this.state === 'hipWindup') {
      // 前方宙返り
      const k = Math.min(1, this.stateTime / P.hipWindup);
      b.rotation.x = (1 - (1 - k) * (1 - k)) * (TAU - 0.75); // 1回転して攻撃姿勢(-0.75)につなげる
      footA = [-1.2, -1.2];
      armSpread = 0.3;
    } else if (this.state === 'hipFall') {
      // おしりを真下に向けた攻撃姿勢
      b.rotation.x = -0.75;
      footA = [-1.4, -1.4];
      armSpread = 2.6;
    }

    // 重心まわりに回転させる(回転の中心を体の中央 0.55 に)
    if (b.rotation.x !== 0) {
      const cy = 0.55;
      const r = b.rotation.x;
      b.position.y += cy - cy * Math.cos(r);
      b.position.z += -cy * Math.sin(r);
    }

    b.scale.set(1 - sq * 0.6, 1 + sq, 1 - sq * 0.6);
    this.feet[0].rotation.x = footA[0];
    this.feet[1].rotation.x = footA[1];
    this.arms[0].rotation.set(armA, 0, -armSpread * 0.5 - 0.15);
    this.arms[1].rotation.set(-armA, 0, armSpread * 0.5 + 0.15);

    // 無敵中の点滅
    this.root.visible = this.invincible <= 0 || Math.floor(time * 20) % 2 === 0;

    // 丸影・落下地点
    const gy = this.groundY;
    if (gy > -Infinity) {
      const h = renderPos.y - gy;
      this.shadow.visible = true;
      this.shadow.position.set(renderPos.x, gy + 0.02, renderPos.z);
      const s = THREE.MathUtils.clamp(1 - h * 0.08, 0.45, 1);
      this.shadow.scale.setScalar(s);
      this.shadow.material.opacity = 0.32 * s;
      this.marker.position.set(renderPos.x, gy + 0.025, renderPos.z);
      const showMarker = !this.grounded && h > P.hipMinHeight;
      const target = this.state === 'hipFall' || this.state === 'hipWindup' ? 0.95 : showMarker ? 0.45 : 0;
      this.marker.material.opacity += (target - this.marker.material.opacity) * Math.min(1, dt * 14);
      this.marker.rotation.z += dt * 3;
    } else {
      this.shadow.visible = false;
      this.marker.material.opacity = 0;
    }
  }
}

function approach2(v, tx, tz, maxDelta) {
  const dx = tx - v.x, dz = tz - v.z;
  const l = Math.hypot(dx, dz);
  if (l <= maxDelta || l < 1e-6) { v.x = tx; v.z = tz; return; }
  v.x += (dx / l) * maxDelta;
  v.z += (dz / l) * maxDelta;
}

function turnToward(a, b, maxStep) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const step = Math.min(1, maxStep);
  return a + d * step;
}
