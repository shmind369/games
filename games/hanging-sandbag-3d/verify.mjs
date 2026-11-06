// 完成条件のヘッドレス検証:  node games/hanging-sandbag-3d/verify.mjs
// 描画と同じ physics.js / Rapier を使い、物理挙動だけを数値で確認する。
import RAPIER from './vendor/rapier3d-compat.es.js';
import { CONFIG, createSim } from './physics.js';

await RAPIER.init();
const dt = CONFIG.dt;
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`); };
const run = (s, sec, cb) => { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) { s.step(); cb && cb(i); } };
const surface = (s, from, offset = 0, height = 0) => {
  const c = s.bag.translation(); const R = CONFIG.bagRadius;
  return from === 'front'
    ? { x: c.x + offset, y: c.y + height, z: c.z + Math.sqrt(R * R - offset * offset) }
    : { x: c.x + Math.sqrt(R * R - offset * offset), y: c.y + height, z: c.z - offset };
};
const maxErrOf = (s) => Math.max(...s.jointErrors());

// 1. 重力で自然に垂れ下がる(初期位置を少しずらしても鉛直に戻る)
{
  const s = createSim(RAPIER);
  s.hit(surface(s, 'front'), { x: 0, y: 0, z: -5 });
  run(s, 60);
  const p = s.bag.translation();
  check('重力で鉛直に垂れ下がる', Math.hypot(p.x, p.z) < 0.003 && Math.abs(p.y - s.bagCenterY) < 0.002,
    `水平ずれ ${(Math.hypot(p.x, p.z) * 1000).toFixed(2)} mm`);
}

// 2. 正面→前後、側面→左右
{
  const s = createSim(RAPIER);
  s.hit(surface(s, 'front'), { x: 0, y: 0, z: -35 });
  let mx = 0, mz = 0; run(s, 2, () => { const p = s.bag.translation(); mx = Math.max(mx, Math.abs(p.x)); mz = Math.max(mz, Math.abs(p.z)); });
  const s2 = createSim(RAPIER);
  s2.hit(surface(s2, 'side'), { x: -35, y: 0, z: 0 });
  let nx = 0, nz = 0; run(s2, 2, () => { const p = s2.bag.translation(); nx = Math.max(nx, Math.abs(p.x)); nz = Math.max(nz, Math.abs(p.z)); });
  check('正面衝撃→前後 / 側面衝撃→左右', mz > 0.2 && mx < 1e-3 && nx > 0.2 && nz < 1e-3,
    `正面: z振幅 ${mz.toFixed(3)}m x ${mx.toFixed(4)}m / 側面: x振幅 ${nx.toFixed(3)}m z ${nz.toFixed(4)}m`);
}

// 3. 衝撃位置で回転挙動が変わる
{
  const yawAfter = (off, h) => { const s = createSim(RAPIER); s.hit(surface(s, 'front', off, h), { x: 0, y: 0, z: -35 }); s.step(); const w = s.bag.angvel(); return w; };
  const c = yawAfter(0, 0), r = yawAfter(0.14, 0), l = yawAfter(-0.14, 0), up = yawAfter(0, 0.4), lo = yawAfter(0, -0.4);
  check('衝撃位置で回転が変わる',
    Math.abs(c.y) < 1e-3 && r.y > 1 && l.y < -1 && Math.sign(up.x) !== Math.sign(lo.x),
    `自転 中央 ${c.y.toFixed(2)} / 右 ${r.y.toFixed(2)} / 左 ${l.y.toFixed(2)} rad/s, 傾き 上 ${up.x.toFixed(2)} / 下 ${lo.x.toFixed(2)} rad/s`);
}

// 4. 揺れの最中の追加衝撃で運動方向・振幅が変わる
{
  const s = createSim(RAPIER);
  s.hit(surface(s, 'front'), { x: 0, y: 0, z: -35 });
  run(s, 0.4);
  s.hit(surface(s, 'side'), { x: -35, y: 0, z: 0 });
  let mx = 0; run(s, 2, () => { mx = Math.max(mx, Math.abs(s.bag.translation().x)); });
  const s2 = createSim(RAPIER);
  s2.hit(surface(s2, 'front'), { x: 0, y: 0, z: -35 }); run(s2, 0.4);
  // 最下点(速度最大)を通過する瞬間まで進め、運動と逆向きに打って止める
  let z0 = s2.bag.translation().z;
  for (let i = 0; i < 2000; i++) { s2.step(); const z = s2.bag.translation().z; if (Math.sign(z) !== Math.sign(z0)) break; z0 = z; }
  const before2 = s2.energy();
  const v = s2.bag.linvel(); s2.hit(surface(s2, 'front'), { x: 0, y: 0, z: -Math.sign(v.z) * 30 });
  s2.step();
  const after = s2.energy();
  check('追加衝撃で方向・振幅が変化', mx > 0.15 && after < before2 * 0.5,
    `前後揺れ中に側面打撃→x振幅 ${mx.toFixed(3)}m / 逆向き打撃でエネルギー ${before2.toFixed(1)}→${after.toFixed(1)} J`);
}

// 5. 放置で自然に静止 & エネルギーが増えない
{
  const s = createSim(RAPIER);
  s.hit(surface(s, 'front', 0.1, 0.2), { x: -15, y: 0, z: -50 });
  let prev = s.energy(), maxRise = 0;
  run(s, 90, () => { const e = s.energy(); maxRise = Math.max(maxRise, e - prev); prev = e; });
  const v = s.bag.linvel(), w = s.bag.angvel();
  check('放置で静止(エネルギー非増加)', Math.hypot(v.x, v.y, v.z) < 0.005 && Math.hypot(w.x, w.y, w.z) < 0.02 && maxRise < 1e-3,
    `90秒後 速度 ${(Math.hypot(v.x, v.y, v.z) * 1000).toFixed(2)} mm/s, 1ステップ最大エネルギー増 ${maxRise.toExponential(1)} J`);
}

// 6. 連打しても接続が外れない・ずれない
{
  const s = createSim(RAPIER);
  let mx = 0, seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 120; k++) {
    const off = (rnd() - 0.5) * 0.3, h = (rnd() - 0.5) * 0.8;
    s.hit(surface(s, k % 3 ? 'front' : 'side', off, h), k % 3 ? { x: 0, y: 0, z: -60 } : { x: -60, y: 0, z: 0 });
    run(s, 0.15, () => { mx = Math.max(mx, maxErrOf(s)); });
  }
  check('連打でも接続位置が維持される', mx < 0.002, `強さ60 N·s × 120回 連打中の最大ずれ ${(mx * 1000).toFixed(3)} mm`);
}

const ok = results.every(Boolean);
console.log(ok ? '\nすべての完成条件を満たしました' : '\n未達の条件があります');
process.exit(ok ? 0 : 1);
