// 三人称カメラ: プレイヤー後方から滑らかに追従。移動中は背後へ自動で回り込み、
// 壁に遮られたら手前に寄せる。ドラッグで水平回転。
import * as THREE from 'three';
import { CAMERA as C, PLAYER } from './config.js';

export class ThirdPersonCamera {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 0;                 // カメラはプレイヤーの +Z 側(手前)から奥を見る
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.dist = C.distance;
    this.manualHold = 0;          // 手動回転直後は自動回り込みを止める
    this._ray = new THREE.Vector3();
  }

  snap(playerPos, playerYaw) {
    this.yaw = playerYaw + Math.PI;
    this._compute(playerPos, playerYaw, 0, null, true);
  }

  addYaw(dx) {
    this.yaw -= dx;
    this.manualHold = 0.8;
  }

  /**
   * p: プレイヤー描画位置, player: Player, shake: 揺れ量
   */
  update(dt, p, player, shake, stage) {
    this.manualHold = Math.max(0, this.manualHold - dt);
    const speed = Math.hypot(player.vel.x, player.vel.z);
    // 移動中はプレイヤーの背後へ回り込む(速く走るほど強く)。急降下中は固定
    if (this.manualHold <= 0 && speed > 0.5 && player.state === 'normal') {
      const behind = player.yaw + Math.PI;
      const d = wrap(behind - this.yaw);
      // 真後ろへ走る(カメラに向かってくる)ときは回り込まない: ぐるぐる回るのを防ぐ
      const facingCam = Math.abs(d) > Math.PI * 0.75;
      if (!facingCam) this.yaw += d * Math.min(1, C.yawFollow * dt * (speed / PLAYER.runSpeed));
    }
    this._compute(p, player.yaw, dt, stage, false, speed);

    // 揺れ
    if (shake > 0) {
      const s = shake * shake;
      this.cam.position.x += (Math.random() - 0.5) * s;
      this.cam.position.y += (Math.random() - 0.5) * s;
      this.cam.position.z += (Math.random() - 0.5) * s;
    }
  }

  _compute(p, playerYaw, dt, stage, instant, speed = 0) {
    // 注視点: 頭のあたり + 進行方向へ少し先
    const ahead = C.lookAhead * Math.min(1, speed / PLAYER.runSpeed);
    const lookT = new THREE.Vector3(
      p.x + Math.sin(playerYaw) * ahead,
      p.y + C.lookHeight,
      p.z + Math.cos(playerYaw) * ahead
    );
    const off = new THREE.Vector3(Math.sin(this.yaw) * C.distance, C.height, Math.cos(this.yaw) * C.distance);
    const desired = lookT.clone().add(off);

    // 遮蔽物チェック: 注視点→カメラ の線分が足場を貫いたら手前に寄せる
    if (stage) {
      const dir = desired.clone().sub(lookT);
      const len = dir.length();
      dir.divideScalar(len);
      let tHit = len;
      for (const b of stage.boxes) {
        const t = rayAabb(lookT, dir, b);
        if (t !== null && t < tHit) tHit = t;
      }
      const d = Math.max(C.minDistance, tHit - 0.3);
      if (d < len) desired.copy(lookT).addScaledVector(dir, d);
    }

    if (instant) {
      this.pos.copy(desired);
      this.look.copy(lookT);
    } else {
      const k = 1 - Math.exp(-C.posLerp * dt);
      this.pos.lerp(desired, k);
      // 縦方向は少しゆっくり(ジャンプのたびに画面が上下しすぎない)、ただし落下は追う
      this.look.x += (lookT.x - this.look.x) * Math.min(1, k * 1.6);
      this.look.z += (lookT.z - this.look.z) * Math.min(1, k * 1.6);
      this.look.y += (lookT.y - this.look.y) * k;
    }
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
  }
}

function wrap(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

// レイと AABB の交差距離(内側スタートは無視)
function rayAabb(o, d, b) {
  let tmin = 0, tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(d[ax]) < 1e-8) {
      if (o[ax] < b.min[ax] || o[ax] > b.max[ax]) return null;
    } else {
      let t1 = (b.min[ax] - o[ax]) / d[ax];
      let t2 = (b.max[ax] - o[ax]) / d[ax];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin > 0 ? tmin : null;
}
