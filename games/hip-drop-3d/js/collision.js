// 縦向き円柱(プレイヤー/敵)と AABB の衝突解決。水平→垂直の順に軸ごとに解決する。

const SKIN = 0.001;

/**
 * body: { pos:THREE.Vector3(足元), vel, radius, height, grounded }
 * 1ステップ分の移動と衝突解決を行い、結果のフラグを返す。
 */
export function moveAndCollide(body, boxes, dt) {
  const p = body.pos, v = body.vel, r = body.radius, h = body.height;
  const res = { landed: false, bonked: false, hitWall: false, groundY: -Infinity };

  // ---- 水平 ----
  p.x += v.x * dt;
  p.z += v.z * dt;
  for (let iter = 0; iter < 2; iter++) {
    for (const b of boxes) {
      // 縦方向に重なっていない箱は無視(足元ちょうどの床は除外)
      if (p.y >= b.max.y - 0.02 || p.y + h <= b.min.y) continue;
      const cx = clamp(p.x, b.min.x, b.max.x);
      const cz = clamp(p.z, b.min.z, b.max.z);
      let dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;

      // 段差の自動乗り上げ(小さな段差で引っかからないように)
      const stepH = b.max.y - p.y;
      if (body.grounded && stepH > 0 && stepH < 0.28) {
        p.y = b.max.y + SKIN;
        continue;
      }

      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        const push = r - d + SKIN;
        dx /= d; dz /= d;
        p.x += dx * push; p.z += dz * push;
        const vn = v.x * dx + v.z * dz;
        if (vn < 0) { v.x -= vn * dx; v.z -= vn * dz; }
      } else {
        // 中心が箱の内側: 最も近い面から押し出す
        const opts = [
          [b.min.x - r - p.x, 'x'], [b.max.x + r - p.x, 'x'],
          [b.min.z - r - p.z, 'z'], [b.max.z + r - p.z, 'z'],
        ];
        opts.sort((a, c) => Math.abs(a[0]) - Math.abs(c[0]));
        const [dd, ax] = opts[0];
        p[ax] += dd;
        v[ax] = 0;
      }
      res.hitWall = true;
    }
  }

  // ---- 垂直 ----
  const prevY = p.y;
  p.y += v.y * dt;
  // 端で引っかかりにくいよう、垂直判定の半径は少し小さく
  const rv = r * 0.82;
  for (const b of boxes) {
    if (!circleOverlapsRect(p.x, p.z, rv, b)) continue;
    if (v.y <= 0 && prevY >= b.max.y - 0.05 && p.y < b.max.y) {
      p.y = b.max.y;
      v.y = 0;
      res.landed = true;
      res.groundY = b.max.y;
    } else if (v.y > 0 && prevY + h <= b.min.y + 0.05 && p.y + h > b.min.y) {
      p.y = b.min.y - h - SKIN;
      v.y = 0;
      res.bonked = true;
    }
  }

  // 接地の維持: 足元すぐ下に床があるか
  if (!res.landed && v.y <= 0) {
    for (const b of boxes) {
      if (!circleOverlapsRect(p.x, p.z, rv, b)) continue;
      if (Math.abs(p.y - b.max.y) < 0.02) { res.landed = true; res.groundY = b.max.y; p.y = b.max.y; }
    }
  }
  return res;
}

export function circleOverlapsRect(x, z, r, b) {
  const cx = clamp(x, b.min.x, b.max.x);
  const cz = clamp(z, b.min.z, b.max.z);
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
