// テストステージ: 当たり判定は軸平行の箱(AABB)の集合。見た目も同じ箱から作る。
import * as THREE from 'three';

// [cx, cz, sx, sz, top, thickness, colorKey]  … 上面の高さ top を基準に指定
const BLOCKS = [
  // --- エリアA: スタート地点の平地 ---
  [0, -6, 16, 26, 0, 2, 'grass'],
  // 段差の足場(低→高)
  [4.2, -4.5, 3, 3, 0.8, 0.8, 'step'],
  [5.6, -8.0, 2.6, 2.6, 1.7, 1.7, 'step'],
  [2.4, -10.6, 2.4, 2.4, 2.6, 2.6, 'step'],
  // 障害物の壁(ジャンプで越える)
  [-3.5, -13.5, 9, 0.9, 1.3, 1.3, 'wall'],
  [5.2, -13.5, 5.6, 0.9, 1.3, 1.3, 'wall'],
  // 小さな箱(ヒップアタックの練習台)
  [-5, -3, 1.4, 1.4, 1.0, 1.0, 'crate'],

  // --- 穴を越える飛び石 ---
  [0, -20.8, 2.2, 2.2, 0.3, 1.2, 'stone'],
  [-2.6, -23.6, 2.0, 2.0, 0.7, 1.2, 'stone'],

  // --- エリアB ---
  [0, -34, 16, 18, 0, 2, 'grass'],
  [-4.5, -30, 1.2, 1.2, 1.6, 1.6, 'wall'],
  [4.5, -30, 1.2, 1.2, 1.6, 1.6, 'wall'],
  // 高台(敵がいる)
  [4, -37, 5, 5, 1.8, 1.8, 'step'],
  [0.6, -36, 1.8, 1.8, 0.9, 0.9, 'step'],

  // --- ゴールへの階段 ---
  [-4.5, -40.0, 2.4, 2.4, 1.0, 1.0, 'stone'],
  [-4.5, -43.2, 2.2, 2.2, 2.2, 1.0, 'stone'],
  [-1.2, -45.4, 2.2, 2.2, 3.3, 1.0, 'stone'],
  // ゴール台
  [3, -47, 4.4, 4.4, 4.2, 1.2, 'goal'],
];

const COLORS = {
  grass: 0x7fcf5a,
  step: 0xf2b84b,
  wall: 0xe76f51,
  crate: 0xc98f4e,
  stone: 0x9ab3c9,
  goal: 0xffe066,
};

export const SPAWN = new THREE.Vector3(0, 0.01, 3.5);

// 敵: 中心・徘徊半径・上面の高さ
export const ENEMY_SPAWNS = [
  { x: -3, z: -8, range: 2.6, y: 0 },
  { x: 0, z: -31, range: 3.2, y: 0 },
  { x: 4, z: -37, range: 1.6, y: 1.8 },
];

export const GOAL = { x: 3, z: -47, y: 4.2, radius: 1.1 };

export class Stage {
  constructor(scene) {
    this.boxes = []; // {min:{x,y,z}, max:{x,y,z}}
    this.group = new THREE.Group();
    scene.add(this.group);

    const mats = {};
    for (const k in COLORS) mats[k] = new THREE.MeshLambertMaterial({ color: COLORS[k] });
    const edgeMat = new THREE.MeshLambertMaterial({ color: 0x5a3d2b });

    for (const [cx, cz, sx, sz, top, th, key] of BLOCKS) {
      const box = {
        min: { x: cx - sx / 2, y: top - th, z: cz - sz / 2 },
        max: { x: cx + sx / 2, y: top, z: cz + sz / 2 },
      };
      this.boxes.push(box);
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, th, sz), mats[key]);
      m.position.set(cx, top - th / 2, cz);
      m.castShadow = key !== 'grass';
      m.receiveShadow = true;
      this.group.add(m);
      if (key === 'grass') {
        // 地面の側面は土色にして「端」が分かるようにする
        const side = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, th * 0.85, sz + 0.02), edgeMat);
        side.position.set(cx, top - th / 2 - th * 0.08, cz);
        this.group.add(side);
      }
    }

    // 地面の格子模様(移動速度を感じやすくする)
    const tiles = new THREE.GridHelper(60, 60, 0x6ab84a, 0x6ab84a);
    tiles.position.set(0, 0.005, -20);
    tiles.material.transparent = true; tiles.material.opacity = 0.35;
    this.group.add(tiles);

    // 奈落の目印(はるか下の水面)
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x4aa8d8 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -8;
    this.group.add(sea);

    this._buildGoal();
    this._buildDeco();
  }

  _buildGoal() {
    const g = new THREE.Group();
    g.position.set(GOAL.x, GOAL.y, GOAL.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    pole.position.y = 1.3;
    g.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.04), new THREE.MeshLambertMaterial({ color: 0xff3b6b }));
    flag.position.set(0.48, 2.25, 0);
    g.add(flag);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(GOAL.radius, 0.07, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);
    this.goalFlag = flag;
    this.goalRing = ring;
    this.group.add(g);
  }

  _buildDeco() {
    // 地面の外に浮かぶ雲(背景)
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Group();
      for (let j = 0; j < 3; j++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random(), 10, 8), cloudMat);
        s.position.set(j * 1.4, Math.random() * 0.5, Math.random() * 0.6);
        c.add(s);
      }
      const a = Math.random() * Math.PI * 2;
      c.position.set(Math.cos(a) * (30 + Math.random() * 15), 4 + Math.random() * 10, -20 + Math.sin(a) * (30 + Math.random() * 15));
      this.group.add(c);
    }
  }

  update(t) {
    this.goalFlag.rotation.y = Math.sin(t * 3) * 0.25;
    this.goalRing.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
  }

  /** 点 (x,z) 直下で y 以下にある最も高い床の高さ(影・高さ判定用)。無ければ -Infinity */
  groundBelow(x, z, y, r = 0) {
    let best = -Infinity;
    for (const b of this.boxes) {
      if (x + r < b.min.x || x - r > b.max.x || z + r < b.min.z || z - r > b.max.z) continue;
      if (b.max.y <= y + 1e-3 && b.max.y > best) best = b.max.y;
    }
    return best;
  }
}
