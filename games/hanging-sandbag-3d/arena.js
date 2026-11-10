// ボクシングリングの会場(見た目)。すべて箱・円柱と画面上で描いた模様で作る(外部ファイルなし・軽量)
//  - リング: ロープの内側 6m 四方、高さ 1m の台(マットの上面 = 床 y=0)、エプロン、コーナーポストとパッド、ロープ4段
//  - 頭上: 照明トラス(四角い枠と4本の脚)。中央の梁からサンドバッグを吊る(吊り位置の高さは物理と同じ)
//  - まわり: 暗い会場、スポットライト、客席の人影
import * as THREE from 'three';

export const RING = {
  half: 3.05,          // コーナーポストの位置(リング中心から)[m]
  // ロープの高さ(下から)。最上段を自機の脇の下(構えたときの高さ 約1.15m)に合わせ、残り3本をマットとの間に等間隔で配置
  //  (変更履歴: 0.45/0.8/1.15/1.5 → 0.2/0.4/0.6/0.8 → 今: 0.29/0.58/0.86/1.15)
  ropeHeights: [0.2875, 0.575, 0.8625, 1.15],
  ropeColors: [0xd63031, 0xf2f2f2, 0x2a62d6, 0xf2f2f2],
  platformH: 1.0,      // 台の高さ(会場の床はマットの 1m 下)
  apron: 0.6,          // ロープの外側のエプロンの幅 [m]
  trussHalf: 4.3,      // 照明トラスの大きさ(中心から)[m]
};

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 会場を作って scene に加える。ceilingY: サンドバッグの吊り位置の高さ */
export function buildArena(scene, ceilingY) {
  const R = RING, size = 2 * (R.half + R.apron), floorY = -R.platformH;
  const group = new THREE.Group();
  scene.add(group);

  // ---- 会場の床 ----
  const venue = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 1 }));
  venue.rotation.x = -Math.PI / 2; venue.position.y = floorY; venue.receiveShadow = true;
  group.add(venue);

  // ---- リングの台(側面はエプロンの布)----
  const skirt = canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = '#16255a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d63031'; g.fillRect(0, 10, w, 8);
    g.fillStyle = '#f2f2f2'; g.fillRect(0, h - 18, w, 6);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = 'bold 54px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('HEAVY BAG ARENA', w / 2, h / 2 + 20);
  });
  const skirtMat = new THREE.MeshStandardMaterial({ map: skirt, roughness: 0.85 });
  const platform = new THREE.Mesh(new THREE.BoxGeometry(size, R.platformH, size),
    [skirtMat, skirtMat, new THREE.MeshStandardMaterial({ color: 0x1b2340 }), skirtMat, skirtMat, skirtMat]);
  platform.position.y = floorY + R.platformH / 2 - 0.002;
  platform.receiveShadow = true;
  group.add(platform);

  // ---- マット(上面)----
  const matTex = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#a3a9b3'; g.fillRect(0, 0, w, h); // 照明で白飛びしないよう少し暗め
    for (let i = 0; i < 9000; i++) { // 布のムラ
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 2 + Math.random() * 5);
    }
    const inner = (R.half / (size / 2)) * (w / 2); // ロープの位置
    g.strokeStyle = '#2a62d6'; g.lineWidth = 10;
    g.strokeRect(w / 2 - inner, h / 2 - inner, inner * 2, inner * 2);
    g.fillStyle = '#1b2f73'; // エプロン部分
    g.fillRect(0, 0, w, h / 2 - inner - 5); g.fillRect(0, h / 2 + inner + 5, w, h / 2 - inner);
    g.fillRect(0, 0, w / 2 - inner - 5, h); g.fillRect(w / 2 + inner + 5, 0, w / 2 - inner, h);
    g.strokeStyle = 'rgba(42,98,214,0.55)'; g.lineWidth = 8;
    g.beginPath(); g.arc(w / 2, h / 2, w * 0.16, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(27,47,115,0.55)'; g.font = 'bold 64px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('HEAVY BAG', w / 2, h / 2 - w * 0.2); g.fillText('ARENA', w / 2, h / 2 + w * 0.24);
  });
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.9 }));
  mat.rotation.x = -Math.PI / 2; mat.position.y = 0.001; mat.receiveShadow = true;
  group.add(mat);

  // ---- コーナーポスト・パッド・ロープ ----
  const postMat = new THREE.MeshStandardMaterial({ color: 0xb8c0c9, metalness: 0.8, roughness: 0.35 });
  const padColors = [0xd63031, 0xf2f2f2, 0x2a62d6, 0xf2f2f2]; // 赤コーナー・白・青コーナー・白
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  // ポストとパッドはロープの高さに合わせる(最上段の少し上まで / パッドは最下段の少し下から最上段の上まで)
  const top = R.ropeHeights[R.ropeHeights.length - 1] + 0.12;
  const padBottom = Math.max(0.05, R.ropeHeights[0] - 0.1);
  const occluders = []; // カメラと自機の間に入ったら半透明にするもの { mesh, a, b }(a-b: 判定に使う線分)
  corners.forEach(([sx, sz], i) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, top, 14), postMat.clone());
    post.position.set(sx * R.half, top / 2, sz * R.half); post.castShadow = true;
    group.add(post);
    occluders.push({ mesh: post, a: new THREE.Vector3(sx * R.half, 0, sz * R.half), b: new THREE.Vector3(sx * R.half, top, sz * R.half), r: 0.07 });
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2, top - padBottom, 0.2),
      new THREE.MeshStandardMaterial({ color: padColors[i], roughness: 0.7 }));
    const px = sx * (R.half - 0.08), pz = sz * (R.half - 0.08);
    pad.position.set(px, (top + padBottom) / 2, pz); pad.rotation.y = Math.PI / 4; pad.castShadow = true;
    group.add(pad);
    occluders.push({ mesh: pad, a: new THREE.Vector3(px, padBottom, pz), b: new THREE.Vector3(px, top, pz), r: 0.14 });
  });
  R.ropeHeights.forEach((y, li) => {
    const ropeMat = new THREE.MeshStandardMaterial({ color: R.ropeColors[li], roughness: 0.55 });
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az) * R.half;
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 8), ropeMat.clone()); // 1本ずつ透明度を変えられるよう別マテリアル
      rope.position.set((ax + bx) / 2 * R.half, y, (az + bz) / 2 * R.half);
      rope.rotation.z = Math.PI / 2;
      rope.rotation.y = Math.atan2(-(bz - az), bx - ax);
      rope.castShadow = true;
      group.add(rope);
      occluders.push({ mesh: rope, a: new THREE.Vector3(ax * R.half, y, az * R.half), b: new THREE.Vector3(bx * R.half, y, bz * R.half), r: 0.03 });
    }
  });

  // ---- 頭上の照明トラス(中央の梁からサンドバッグを吊る)----
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.5 });
  const T = R.trussHalf, beamY = ceilingY + 0.11, beamS = 0.2;
  const beam = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, beamS, d), trussMat);
    m.position.set(x, beamY, z); group.add(m);
  };
  beam(2 * T + beamS, beamS, 0, T); beam(2 * T + beamS, beamS, 0, -T);
  beam(beamS, 2 * T, T, 0); beam(beamS, 2 * T, -T, 0);
  beam(2 * T, beamS, 0, 0);                      // 中央の梁(ここにバッグを吊る)
  for (const [sx, sz] of corners) {
    const legH = beamY - floorY;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(beamS, legH, beamS), trussMat);
    leg.position.set(sx * T, floorY + legH / 2, sz * T); group.add(leg);
  }
  // 吊り金具
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 16), postMat);
  hook.position.set(0, ceilingY - 0.03, 0); group.add(hook);

  // ---- スポットライト(トラスの四隅からリングを照らす。影は主光源だけ)----
  for (const [sx, sz] of corners) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.22, 14), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.5, roughness: 0.4 }));
    lamp.position.set(sx * (T - 0.3), beamY - 0.2, sz * (T - 0.3)); group.add(lamp);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshBasicMaterial({ color: 0xfff2cc }));
    lens.position.set(lamp.position.x, beamY - 0.315, lamp.position.z); lens.rotation.x = Math.PI / 2; group.add(lens);
    const spot = new THREE.SpotLight(0xfff1d6, 1.3, 14, Math.PI / 5, 0.5, 0);
    spot.position.copy(lamp.position);
    spot.target.position.set(sx * 0.8, 0, sz * 0.8);
    group.add(spot, spot.target);
  }

  // ---- 客席の人影(暗がりにうっすら)----
  const crowdN = 160;
  const crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.22, 0.45, 2, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 1 }), crowdN);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  for (let i = 0; i < crowdN; i++) {
    const row = i % 3, side = Math.floor(i / 3) % 4, k = Math.floor(i / 12);
    const along = -6.5 + (k / Math.ceil(crowdN / 12)) * 13 + (Math.random() - 0.5) * 0.4;
    const dist = 6.8 + row * 0.9;
    const x = side === 0 ? along : side === 1 ? dist : side === 2 ? -along : -dist;
    const z = side === 0 ? dist : side === 1 ? along : side === 2 ? -dist : -along;
    const y = floorY + 0.55 + row * 0.45;
    const s = 0.85 + Math.random() * 0.3;
    m4.compose(new THREE.Vector3(x, y, z), q.identity(), sc.set(s, s, s));
    crowd.setMatrixAt(i, m4);
  }
  group.add(crowd);

  return { group, floorY, fader: new OccluderFader(occluders) };
}

/**
 * 自機を隠しているリングのロープ・コーナーポスト・パッドを、滑らかに半透明にする(見た目だけ。当たり判定は変えない)
 *  - 自機の画面上の範囲(頭・胴・手足の点を投影した四角)と、各物体の線分を投影したものが重なり、
 *    かつその重なった点が自機よりカメラに近いときだけ「隠している」とみなす(ロープに触れているだけ・後ろにあるだけでは透過しない)
 *  - 不透明度は 100% ⇄ 25% の間を補間で滑らかに変化させる。戻ったら元のマテリアル設定に復元する
 */
export const FADE = {
  minOpacity: 0.22,   // 隠している間の不透明度
  fadeIn: 7,          // 薄くなる速さ(補間)
  fadeOut: 4,         // 元に戻る速さ(補間。ゆっくり戻す)
  samples: 28,        // ロープ1本あたりの判定点の数
  screenPad: 14,      // 自機の画面上の範囲を広げる量 [px]
};
class OccluderFader {
  constructor(list) {
    this.list = list.map((o) => {
      const m = o.mesh.material;
      return { ...o, mat: m, orig: { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }, op: 1 };
    });
    this._v = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  /**
   * camera: カメラ / points: 自機の点(ワールド)の配列 / dt: 秒 / W, H: 画面の大きさ [px]
   */
  update(camera, points, dt, W, H) {
    // 自機の画面上の範囲と、カメラからの距離
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, near = Infinity;
    for (const p of points) {
      this._v.copy(p).project(camera);
      const sx = (this._v.x + 1) / 2 * W, sy = (1 - this._v.y) / 2 * H;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      near = Math.min(near, camera.position.distanceTo(p));
    }
    x0 -= FADE.screenPad; x1 += FADE.screenPad; y0 -= FADE.screenPad; y1 += FADE.screenPad;
    for (const o of this.list) {
      let hide = false;
      const n = o.mesh.geometry.type === 'CylinderGeometry' && o.r < 0.05 && o.a.y === o.b.y ? FADE.samples : 10;
      for (let i = 0; i <= n && !hide; i++) {
        this._p.lerpVectors(o.a, o.b, i / n);
        const d = camera.position.distanceTo(this._p);
        if (d >= near - o.r) continue;                 // 自機より奥(または同じ深さ)なら隠していない
        this._v.copy(this._p).project(camera);
        if (this._v.z > 1) continue;
        const sx = (this._v.x + 1) / 2 * W, sy = (1 - this._v.y) / 2 * H;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) hide = true;
      }
      const target = hide ? FADE.minOpacity : 1;
      o.op += (target - o.op) * Math.min(1, (target < o.op ? FADE.fadeIn : FADE.fadeOut) * dt);
      if (o.op > 0.995) o.op = 1;
      const m = o.mat;
      if (o.op < 1) {
        if (!m.transparent || m.depthWrite) { m.transparent = true; m.depthWrite = false; m.needsUpdate = true; }
        m.opacity = o.op;
      } else if (m.transparent !== o.orig.transparent || m.opacity !== o.orig.opacity) {
        // 完全に戻ったら元の設定に復元
        m.transparent = o.orig.transparent; m.opacity = o.orig.opacity; m.depthWrite = o.orig.depthWrite; m.needsUpdate = true;
      }
    }
  }
}
