// ボクシングリングの会場(見た目)。すべて箱・円柱と画面上で描いた模様で作る(外部ファイルなし・軽量)
//  - リング: ロープの内側 6m 四方、高さ 1m の台(マットの上面 = 床 y=0)、エプロン、コーナーポストとパッド、ロープ4段
//  - 頭上: 照明トラス(四角い枠と4本の脚)。中央の梁からサンドバッグを吊る(吊り位置の高さは物理と同じ)
//  - まわり: 暗い会場、スポットライト、客席の人影
import * as THREE from 'three';

export const RING = {
  half: 3.05,          // コーナーポストの位置(リング中心から)[m]
  ropeHeights: [0.45, 0.8, 1.15, 1.5],
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
  const top = R.ropeHeights[R.ropeHeights.length - 1] + 0.12;
  corners.forEach(([sx, sz], i) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, top, 14), postMat);
    post.position.set(sx * R.half, top / 2, sz * R.half); post.castShadow = true;
    group.add(post);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2, top - 0.3, 0.2),
      new THREE.MeshStandardMaterial({ color: padColors[i], roughness: 0.7 }));
    pad.position.set(sx * (R.half - 0.08), (top - 0.3) / 2 + 0.3, sz * (R.half - 0.08)); pad.rotation.y = Math.PI / 4; pad.castShadow = true;
    group.add(pad);
  });
  R.ropeHeights.forEach((y, li) => {
    const ropeMat = new THREE.MeshStandardMaterial({ color: R.ropeColors[li], roughness: 0.55 });
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az) * R.half;
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 8), ropeMat);
      rope.position.set((ax + bx) / 2 * R.half, y, (az + bz) / 2 * R.half);
      rope.rotation.z = Math.PI / 2;
      rope.rotation.y = Math.atan2(-(bz - az), bx - ax);
      rope.castShadow = true;
      group.add(rope);
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

  return { group, floorY };
}
