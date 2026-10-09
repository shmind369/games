import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

// ============================================================
// Side Fighter 3D — 鉄拳のようなサイドビュー視点の3D格闘ゲーム(第1段階)
//  ・左: 中華娘(プレイヤー) / 右: USAボクサー(CPU) が向かい合って立つ
//  ・スマホ縦画面。画面の左右スワイプ(ドラッグ)で横(X軸)、上下スワイプで奥(上)・手前(下)(Z軸)へ移動する
//  ・画面の右半分をタップで攻撃。タップした高さで、上段(左ジャブ)・中段(右ストレート)・下段(右ローキック)を使い分ける
//  ・まだダメージ・CPUの動きはない(CPUは構えのアイドルのみ)
// 座標: X軸が左右(右が+)。カメラは+Z側から、ステージを真横に見る。Y軸が上
// ============================================================

// ---------- 設定 ----------
const RING_HALF = 3.4;        // リング(四角い台)の一辺の半分(m)。一辺 6.8m。中心はXZの原点
const RING_OUT_MARGIN = 0.1;  // 足元(体の中心)がリングの縁からこれだけ外へ出たら「リングアウト」
const WORLD_LIM = 9;        // 場外へ落ちる前に、これ以上は遠くへ行けない(安全装置)
const BODY_GAP = 0.7;         // 2人の体が重ならない最小距離(m)
const WALK_SPEED = 2.38;       // 最大の移動速度 (m/s)
const BACK_SPEED_SCALE = 0.85; // 後ろへ下がるときは少し遅い
const SWIPE_DEADZONE_PX = 6;  // これ以下の動きは無視
const SWIPE_FULL_PX = 55;     // これだけ動かすと最大速度
const VISIBLE_WIDTH_MIN = 3.5; // 画面に映す幅(m)の最小。2人が近いときの、寄った画面
const VISIBLE_WIDTH_MAX = 10;  // 同じく最大(離れたときに、ここまで引く)
const CAM_MARGIN = 2.4;        // 2人の間隔に足す余白(m)。映す幅 = 間隔 + 余白
const VFOV = 40;
const ATTACK_SPEED = 1.3;     // 攻撃モーションの再生速度(1.0=ファイルのまま。大きいほどキビキビ)
const ATTACK_BLEND_IN_MS = 60, ATTACK_BLEND_OUT_MS = 150; // 構えとの、なじませ
const TAP_MAX_MOVE_PX = 12, TAP_MAX_MS = 320;            // これ以内の動き・時間で離したら「タップ」

// ---------- レンダラー・シーン・カメラ ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VFOV, 1, 0.1, 100);
const CAM_LOOK = new THREE.Vector3(0, 0.85, 0);
let camDist = 8;
// カメラ: 真横から。x は2人の中間を追う
let aspectNow = 0.46, camWidth = VISIBLE_WIDTH_MIN;
// 映したい幅(m)が、縦画面でも横画面でも収まる距離にカメラを置く(2人が離れるほど、遠く・広く映す)
function placeCamera(x, width = camWidth) {
  const t = Math.tan(THREE.MathUtils.degToRad(VFOV / 2));
  camDist = Math.max(width / 2 / (t * aspectNow), 1.7 / t);
  CAM_LOOK.x = x; camera.position.set(x, 1.45, camDist); camera.lookAt(CAM_LOOK);
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
  renderer.setSize(w, h);
  camera.aspect = aspect; camera.updateProjectionMatrix();
  aspectNow = aspect; placeCamera(CAM_LOOK.x);
}
window.addEventListener("resize", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

// ---------- ステージ(簡易): 夜のアリーナ風。床・奥の壁・柱とライト ----------
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
scene.background = new THREE.Color(0x0b0d18);
scene.fog = new THREE.Fog(0x0b0d18, 14, 40);
// リング(円形の台): 上面は暗い石畳。縁の外は深い闇(落ちたらリングアウト)
const topTex = canvasTex(1024, 1024, (ctx, w, h) => {
  ctx.fillStyle = "#2c2d36"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 2;
  for (let x = 0; x <= w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  for (let i = 0; i < 500; i++) { ctx.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},255,${Math.random() * 0.04})`; ctx.fillRect(Math.random() * w, Math.random() * h, 6 + Math.random() * 30, 6 + Math.random() * 30); }
}, 1, 1);
const sideMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.55, metalness: 0.4 });
const platform = new THREE.Mesh(new THREE.BoxGeometry((RING_HALF + 0.12) * 2, 0.9, (RING_HALF + 0.12) * 2), [
  sideMat, sideMat,                                                                  // +X, -X 側面
  new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.75, metalness: 0.1 }),  // 上面
  new THREE.MeshStandardMaterial({ color: 0x111116 }),                               // 底
  sideMat, sideMat,                                                                  // +Z, -Z 側面
]);
platform.position.y = -0.45; platform.receiveShadow = true; scene.add(platform);
// 縁のライン(これより外へ出るとリングアウト)と、中央の線
const rimMat = new THREE.MeshBasicMaterial({ color: 0xffc860 });
for (const [w, h, x, z] of [[RING_HALF * 2 + 0.11, 0.11, 0, -RING_HALF], [RING_HALF * 2 + 0.11, 0.11, 0, RING_HALF], [0.11, RING_HALF * 2 + 0.11, -RING_HALF, 0], [0.11, RING_HALF * 2 + 0.11, RING_HALF, 0]]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), rimMat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); scene.add(m);
}
const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(0.05, RING_HALF * 2 - 0.2), new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.55 }));
centerLine.rotation.x = -Math.PI / 2; centerLine.position.y = 0.011; scene.add(centerLine);
// 下の闇の床(落ちたあとの地面)
const pit = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshStandardMaterial({ color: 0x141a30, emissive: 0x0a1230, roughness: 1 }));
pit.rotation.x = -Math.PI / 2; pit.position.set(0, -4, 0); scene.add(pit);
// 奥の壁: 暗い赤の布と金のライン(下まで届く)
const wallTex = canvasTex(512, 512, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#1a0f18"); g.addColorStop(0.55, "#3a1520"); g.addColorStop(1, "#1d1018");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,190,80,0.18)"; ctx.lineWidth = 2;
  for (let x = 0; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.fillStyle = "rgba(255,190,80,0.35)"; ctx.fillRect(0, h * 0.78, w, 4);
}, 8, 1);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }));
wall.position.set(0, 4, -5.2); wall.receiveShadow = true; scene.add(wall);
// 柱(装飾。当たり判定なし。リングの外側)
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3b2a2a, roughness: 0.8 });
for (const x of [-4.2, 4.2, -9, 9]) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 14, 20), pillarMat); p.position.set(x, 1, -4.4); p.castShadow = true; scene.add(p);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb860 })); lamp.position.set(x, 2.6, -4.0); scene.add(lamp);
  if (Math.abs(x) < 6) { const l = new THREE.PointLight(0xffa850, 9, 7, 1.8); l.position.set(x * 0.9, 2.6, -3.4); scene.add(l); }
}
// ライト
scene.add(new THREE.HemisphereLight(0x8090c8, 0x1a1418, 0.7));
const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
key.position.set(-2.5, 6, 5); key.target.position.set(0, 0.8, 0); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -4; key.shadow.camera.right = 4; key.shadow.camera.top = 4; key.shadow.camera.bottom = -2; key.shadow.camera.near = 1; key.shadow.camera.far = 16; key.shadow.bias = -0.0005;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x6f8cff, 0.9); rim.position.set(3, 3, -4); scene.add(rim);

// ---------- キャラクターとモーション ----------
const loader = new GLTFLoader();
const [chinaGltf, usaGltf, stepFJson, stepSJson, idleJson, jabJson, kickJson, straightJson, cpuJabJson, cpuBodyJson, cpuHookJson, spinJson, flySpinJson, sideKickJson, slideKickJson] = await Promise.all([
  loader.loadAsync("./assets/china_rigged.glb"),
  loader.loadAsync("./assets/box_usa_rigged.glb"),
  fetch("./assets/stepForward.json").then((r) => r.json()),
  fetch("./assets/stepSide.json").then((r) => r.json()),
  fetch("./assets/fightIdleUsa.json").then((r) => r.json()),
  fetch("./assets/leftPunch1.json").then((r) => r.json()),
  fetch("./assets/rightLowKick.json").then((r) => r.json()),
  fetch("./assets/rightStraight.json").then((r) => r.json()),
  fetch("./assets/cpuJab.json").then((r) => r.json()),
  fetch("./assets/cpuBodyStraight.json").then((r) => r.json()),
  fetch("./assets/cpuLowHook.json").then((r) => r.json()),
  fetch("./assets/rightBackSpinKick.json").then((r) => r.json()),
  fetch("./assets/rightFlyingBackSpinKick.json").then((r) => r.json()),
  fetch("./assets/leftLungeSideKick.json").then((r) => r.json()),
  fetch("./assets/leftSlideLowKick.json").then((r) => r.json()),
]);
function makeFighter(gltf, facing) {
  const root = new THREE.Group(); // 位置(X)と向き(yaw)
  const model = gltf.scene; root.add(model);
  const bones = {};
  model.traverse((o) => { if (o.isBone) { bones[o.name] = o; o.quaternion.identity(); } if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const yaw = facing > 0 ? Math.PI / 2 : -Math.PI / 2; // モデルは+Zを向いている。+X(右)を向く=+90°
  root.rotation.y = yaw;
  scene.add(root);
  return { root, bones, facing, yaw, z: 0 };
}
const player = makeFighter(chinaGltf, +1); // 左で、右(CPU)を向く
const cpu = makeFighter(usaGltf, -1);      // 右で、左(プレイヤー)を向く
player.x = -0.8; cpu.x = 0.8; player.z = 0; cpu.z = 0;
player.root.position.set(player.x, 0, 0); cpu.root.position.set(cpu.x, 0, 0);

const stepFDur = stepFJson.keyframes[stepFJson.keyframes.length - 1].time, stepSDur = stepSJson.keyframes[stepSJson.keyframes.length - 1].time;
const idleDur = idleJson.keyframes[idleJson.keyframes.length - 1].time || 2;
function toQ(arr) { return new THREE.Quaternion(arr[0], arr[1], arr[2], arr[3]); }
const _q = new THREE.Quaternion();
// クリップ(keyframes: time, pose{bone:[x,y,z,w]}, modelPosition)をループでサンプルする
function sampleClip(clip, dur, t) {
  const keys = clip.keyframes, tt = ((t % dur) + dur) % dur;
  let i = 0; while (i < keys.length - 2 && keys[i + 1].time <= tt) i++;
  const a = keys[i], b = keys[i + 1], span = b.time - a.time, f = span > 0 ? (tt - a.time) / span : 0;
  const pose = {};
  for (const n of Object.keys(a.pose)) pose[n] = toQ(a.pose[n]).slerp(_q.set(...b.pose[n]), f);
  const ay = (a.modelPosition || [0, 0, 0])[1], by = (b.modelPosition || [0, 0, 0])[1];
  return { pose, y: ay + (by - ay) * f };
}

// ---------- フットワーク(ファイティングポーズを保ったまま、ステップで移動) ----------
// 上半身(構え・腕・ガード)はアイドルのまま。脚だけを、ボクサーのシャッフル(軽いステップ)に差し替える。
//  ・前後(相手に近づく/離れる): stepForward.json(順再生=近づく、逆再生=下がる)
//  ・横(奥・手前): stepSide.json(キャラの右へ=そのまま、左へ=左右を反転)
//  どちらも、動いた距離に合わせて再生するので、足が滑らない
const LEG_BONES = ["LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "RightUpperLeg", "RightLowerLeg", "RightFoot"];
const STRIDE_F = 0.8, STRIDE_S = 0.6; // 1サイクル(左右1歩ずつ)で進む距離(m)
const mirrorName = (n) => (n.startsWith("Left") ? "Right" + n.slice(4) : n.startsWith("Right") ? "Left" + n.slice(5) : n);
function mirrorPose(pose) { const o = {}; for (const n of Object.keys(pose)) { const q = pose[n]; o[mirrorName(n)] = new THREE.Quaternion(q.x, -q.y, -q.z, q.w); } return o; }
// st: { vx, vz, w, pf, ps }(動いている速さ・ステップの強さ・再生位置)。f: 向いている方向。gate=0なら、ステップしない(攻撃中など)
function footwork(st, idleP, fx, fz, dt, gate = 1) {
  const along = st.vx * fx + st.vz * fz, lat = st.vx * -fz + st.vz * fx, spd = Math.hypot(st.vx, st.vz);
  st.w += ((gate ? Math.min(1, spd / (WALK_SPEED * 0.5)) : 0) - st.w) * Math.min(1, 12 * dt);
  st.pf = (st.pf || 0) + (along / STRIDE_F) * dt; st.ps = (st.ps || 0) + (Math.abs(lat) / STRIDE_S) * dt;
  const F = sampleClip(stepFJson, stepFDur, st.pf * stepFDur), S = sampleClip(stepSJson, stepSDur, st.ps * stepSDur);
  const ws = Math.abs(lat) / (Math.abs(along) + Math.abs(lat) + 1e-4), Sp = lat < 0 ? mirrorPose(S.pose) : S.pose;
  const pose = {};
  for (const n of Object.keys(idleP.pose)) pose[n] = idleP.pose[n].clone();
  for (const n of LEG_BONES) { const comb = F.pose[n].clone().slerp(Sp[n], ws); pose[n].slerp(comb, st.w); }
  const y = idleP.y + ((F.y + (S.y - F.y) * ws) + 0.056) * st.w; // 上下の揺れ(クリップの基準の高さ -0.056 からの差)
  return { pose, y };
}

// ---------- 攻撃モーション ----------
// 動きのあるキーだけを使う(最後の「構えに戻って止まっている」部分は切り捨てる)
function activeRange(clip) {
  const keys = clip.keyframes, same = (a, b) => Object.keys(a).every((n) => b[n] && a[n].every((v, i) => Math.abs(v - b[n][i]) < 1e-3));
  let end = keys.length - 1; while (end - 1 > 0 && same(keys[end - 1].pose, keys[keys.length - 1].pose)) end--;
  return { start: keys[0].time, end: keys[end].time };
}
// 画面右側をタップした高さで 上段/中段/下段 を選び、さらに「相手との距離」で近接/遠間の技に切り替える
//  zone: 当たったときのリアクション(head/body/legs) / hit: 技の長さの何割〜何割の間だけ当たる / lunge: 前へ踏み込む(開始・終了の割合, 距離m)
const NEAR_DIST = 1.4; // これより近い(2人の中心の距離, m) = 近接 / 以上 = 遠間
const ATTACKS = {
  high_near: { zone: "head", label: "上段(近接) 右後ろ回し蹴り", clip: spinJson, hit: [0.4, 0.62], lunge: null },
  mid_near: { zone: "body", label: "中段(近接) 右ストレート", clip: straightJson },
  low_near: { zone: "legs", label: "下段(近接) 右ローキック", clip: kickJson },
  high_far: { zone: "head", label: "上段(遠間) 右飛び後ろ回し蹴り", clip: flySpinJson, hit: [0.4, 0.62], lunge: [0.1, 0.5, 1.4] },
  mid_far: { zone: "body", label: "中段(遠間) 飛び込み左サイドキック", clip: sideKickJson, hit: [0.33, 0.6], lunge: [0.06, 0.38, 1.2] },
  low_far: { zone: "legs", label: "下段(遠間) 左スライドローキック", clip: slideKickJson, hit: [0.45, 0.72], lunge: [0.05, 0.48, 1.2] },
};
for (const a of Object.values(ATTACKS)) a.range = activeRange(a.clip);
for (const a of Object.values(ATTACKS)) a.durMs = ((a.range.end - a.range.start) * 1000) / ATTACK_SPEED;
// クリップを時刻t(秒, ループしない)でサンプル。modelPosition(前進・沈み込み)も返す
function sampleOnce(clip, t) {
  const keys = clip.keyframes; t = Math.max(keys[0].time, Math.min(keys[keys.length - 1].time, t));
  let i = 0; while (i < keys.length - 2 && keys[i + 1].time <= t) i++;
  const a = keys[i], b = keys[i + 1], span = b.time - a.time, f = span > 0 ? (t - a.time) / span : 0;
  const pose = {};
  for (const n of Object.keys(a.pose)) pose[n] = toQ(a.pose[n]).slerp(_q.set(...b.pose[n]), f);
  const am = a.modelPosition || [0, 0, 0], bm = b.modelPosition || [0, 0, 0];
  return { pose, mp: [0, 1, 2].map((k) => am[k] + (bm[k] - am[k]) * f) };
}
let attack = null; // { kind(=ATTACKSのキー), startAt, hit, lunged }
const attackLog = [];
function attackIdFor(zone) { // 高さ(zone)と、相手との距離から、使う技を決める
  if (ATTACKS[zone]) return zone;
  return zone + (Math.hypot(cpu.x - player.x, cpu.z - player.z) < NEAR_DIST ? "_near" : "_far");
}
function startAttack(zone, now) {
  const kind = attackIdFor(zone);
  if (attack || match.over || performance.now() < playerState.stunUntil) return false; // 攻撃中・のけぞり中・試合終了後は受け付けない
  attack = { kind, startAt: now, hit: false, lunged: 0 }; attackLog.push(ATTACKS[kind].label); console.log("[Player] " + ATTACKS[kind].label);
  return true;
}

// ---------- 攻撃の高さ(上段・中段・下段)を決める: タップした画面の高さを、プレイヤーの体の位置と比べる ----------
//  上段: キャラの頭より上(頭の上端から体の高さの20%より上) / 下段: 足元より下(足元から体の高さの10%より上は中段) / 中段: その間(体のあたり)
const _v = new THREE.Vector3();
function playerScreenY() { // プレイヤーの頭の上端・足元の、画面上のy(CSSピクセル)
  const H = canvas.clientHeight, at = (y) => { _v.set(player.root.position.x, y, player.root.position.z).project(camera); return (1 - _v.y) / 2 * H; };
  return { head: at(1.8), feet: at(0) };
}
function zoneBounds() { const { head, feet } = playerScreenY(), h = feet - head; return { up: head - 0.2 * h, low: feet - 0.1 * h, head, feet, h }; }
function zoneForY(y) { const b = zoneBounds(); return y < b.up ? "high" : y > b.low ? "low" : "mid"; }
// 画面の左側に、3つの高さの目印(うすい線と「上段/中段/下段」)を出す。タップしたゾーンは一瞬光る
const zonesEl = document.createElement("div");
zonesEl.style.cssText = "position:fixed;left:50%;top:0;width:50%;height:100%;z-index:6;pointer-events:none;";
zonesEl.innerHTML = ["up", "low"].map((k) => `<div id="zl_${k}" style="position:absolute;left:0;right:0;height:0;border-top:1px dashed rgba(255,255,255,0.28)"></div>`).join("") +
  [["high", "上段"], ["mid", "中段"], ["low", "下段"]].map(([k, t]) => `<div id="zt_${k}" style="position:absolute;right:8px;font:700 13px system-ui,sans-serif;color:#fff;opacity:0.4;text-shadow:0 1px 3px #000;transition:opacity .2s,color .2s">${t}</div>`).join("");
document.body.appendChild(zonesEl);
const zoneEls = { up: zonesEl.querySelector("#zl_up"), low: zonesEl.querySelector("#zl_low"), high: zonesEl.querySelector("#zt_high"), mid: zonesEl.querySelector("#zt_mid"), lowT: zonesEl.querySelector("#zt_low") };
function updateZoneOverlay() {
  const b = zoneBounds(), H = canvas.clientHeight;
  zoneEls.up.style.top = `${b.up}px`; zoneEls.low.style.top = `${b.low}px`;
  zoneEls.high.style.top = `${Math.max(8, b.up / 2 - 8)}px`;
  zoneEls.mid.style.top = `${(b.up + b.low) / 2 - 8}px`;
  zoneEls.lowT.style.top = `${Math.min(H - 70, (b.low + H) / 2 - 8)}px`;
}
function flashZone(z) { const el = z === "low" ? zoneEls.lowT : zoneEls[z]; el.style.opacity = 1; el.style.color = "#ffd060"; setTimeout(() => { el.style.opacity = 0.4; el.style.color = "#fff"; }, 250); }

// ---------- 入力: 画面の左右スワイプ(ドラッグ)で横移動 ----------
// 押した位置から横へ動かした量で、移動の向きと速さが決まる(離すと止まる)。縦の動きは無視
const input = { x: 0, z: 0, id: null, ox: 0, oy: 0, t0: 0, maxMove: 0 }; // x: -1(左)〜+1(右)、z: -1(奥)〜+1(手前)
const keys = new Set();
const axis = (d, dead, full) => { const a = Math.abs(d); return a < dead ? 0 : Math.sign(d) * Math.min(1, (a - dead) / (full - dead)); };
canvas.addEventListener("pointerdown", (e) => { if (input.id === null) { input.id = e.pointerId; input.ox = e.clientX; input.oy = e.clientY; input.t0 = performance.now(); input.maxMove = 0; input.x = input.z = 0; canvas.setPointerCapture(e.pointerId); document.getElementById("hint").style.opacity = 0; } });
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== input.id) return;
  const dx = e.clientX - input.ox, dy = e.clientY - input.oy;
  input.maxMove = Math.max(input.maxMove, Math.hypot(dx, dy));
  input.x = axis(dx, SWIPE_DEADZONE_PX, SWIPE_FULL_PX);
  input.z = axis(dy, SWIPE_DEADZONE_PX, SWIPE_FULL_PX); // 上へ=奥、下へ=手前
});
const endPtr = (e) => {
  if (e.pointerId !== input.id) return;
  // ほとんど動かさず、すぐ離した = タップ → 攻撃(画面の左半分=左ジャブ、右半分=右ローキック)
  const isTap = e.type === "pointerup" && input.maxMove <= TAP_MAX_MOVE_PX && performance.now() - input.t0 <= TAP_MAX_MS;
  // 右半分をタップ = 攻撃。タップした高さで、上段・中段・下段を使い分ける(左半分は今のところ何もしない)
  if (isTap && e.clientX >= window.innerWidth / 2) { const z = zoneForY(e.clientY); if (startAttack(z, performance.now())) flashZone(z); }
  input.id = null; input.x = input.z = 0;
};
canvas.addEventListener("pointerup", endPtr); canvas.addEventListener("pointercancel", endPtr);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => { keys.add(e.code); if (e.code === "KeyJ") startAttack("high", performance.now()); if (e.code === "KeyK") startAttack("mid", performance.now()); if (e.code === "KeyL") startAttack("low", performance.now()); }); window.addEventListener("keyup", (e) => keys.delete(e.code));
const readDir = () => {
  const kx = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const kz = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
  return kx || kz ? { x: kx, z: kz } : { x: input.x, z: input.z };
};

// ---------- 毎フレーム ----------
const state = { phase: 0, w: 0, vx: 0, vz: 0, lastX: null, lastZ: null };
const clock = new THREE.Clock();
// ---------- CPUのAIと攻撃(飛び込み) ----------
// 状態: idle(構えて様子見) → approach(間合いまで歩いて近づく) → windup(予備動作。ここで攻撃の種類が分かる) →
//        attack(飛び込み。向きと距離は予備動作の終わりで決まる=その後は動けないので、よけられる) → recover(隙) → idle/retreat
//  ・上段: 飛び込み左リードジャブ / 中段: 飛び込み右ボディストレート(低く沈んで胴へ) / 下段: 飛び込み右フック(足を刈る)
//  ・飛び込みは、CPUの位置そのものを前へ動かす(攻撃が終わっても元に戻らない)。リングの外へは自分から飛び出さない
const CPU_ATTACKS = {
  high: { label: "上段 飛び込み左リードジャブ", clip: cpuJabJson, speed: 1.35, windupMs: 420, lunge: [0.04, 0.42], hit: [0.28, 0.7], limb: ["LeftHand", "LeftForearm", 0.15], kb: 0.5,
    tell: { y: 0.02, bones: { Spine: [-0.2, 0, 0], Head: [-0.1, 0, 0], LeftShoulder: [-0.15, 0, 0], LeftUpperArm: [-0.35, 0, 0.15], RightUpperLeg: [0.2, 0, 0] } } },
  mid: { label: "中段 飛び込み右ボディストレート", clip: cpuBodyJson, speed: 1.3, windupMs: 480, lunge: [0.0, 0.5], hit: [0.4, 0.8], limb: ["RightHand", "RightForearm", 0.16], kb: 0.7,
    tell: { y: 0.16, bones: { Spine: [0.4, 0, 0], Chest: [0.15, 0, 0], Head: [-0.25, 0, 0], LeftUpperLeg: [-0.35, 0, 0], RightUpperLeg: [-0.35, 0, 0], LeftLowerLeg: [0.65, 0, 0], RightLowerLeg: [0.65, 0, 0], RightUpperArm: [-0.3, 0, -0.2] } } },
  low: { label: "下段 飛び込み右フック(足狩り)", clip: cpuHookJson, speed: 1.2, windupMs: 540, lunge: [0.0, 0.45], hit: [0.28, 0.62], limb: ["RightHand", "RightForearm", 0.3], kb: 0.55,
    tell: { y: 0.3, bones: { Spine: [0.5, 0.2, 0], Chest: [0, 0.35, 0], LeftUpperLeg: [-0.55, 0, 0], RightUpperLeg: [-0.55, 0, 0], LeftLowerLeg: [1.0, 0, 0], RightLowerLeg: [1.0, 0, 0], RightUpperArm: [-0.2, 0, 1.0] } } },
};
for (const a of Object.values(CPU_ATTACKS)) { a.range = activeRange(a.clip); a.durMs = ((a.range.end - a.range.start) * 1000) / a.speed; }
const CPU_APPROACH_SPEED = 2.1, CPU_RETREAT_SPEED = 1.82;
const cpuAI = { enabled: true, auto: true, mode: "idle", t0: 0, until: 800, kind: null, dir: [-1, 0], lungeDist: 0, lunged: 0, hit: false, log: [], recent: [], range: 1.7, retreatLeft: 0, lastX: null, lastZ: null, vx: 0, vz: 0, w: 0, phase: 0 };
if (new URLSearchParams(location.search).get("ai") === "0") cpuAI.auto = false; // ?ai=0 でCPUが自分からは攻撃しない(練習・動作確認用)
const smooth01 = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const cpuRand = (a, b) => a + Math.random() * (b - a);
function cpuPickKind() { // 同じ技が3回続かないように、重み付きで選ぶ(上段40・中段35・下段25)
  const w = { high: 40, mid: 35, low: 25 }; const rc = cpuAI.recent; if (rc.length >= 2 && rc[0] === rc[1]) w[rc[0]] = 0;
  let r = Math.random() * Object.values(w).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(w)) { if ((r -= w[k]) < 0) return k; } return "high";
}
function cpuStartWindup(kind, now) {
  cpuAI.mode = "windup"; cpuAI.kind = kind; cpuAI.t0 = now; cpuAI.hit = false; cpuAI.until = now + CPU_ATTACKS[kind].windupMs;
  // 飛び込みの向きと距離は、予備動作の「はじめ」に確定する(狙った位置へ飛び込む)。予備動作の間にプレイヤーが動けば、かわせる
  { const ex = player.x - cpu.x, ez = player.z - cpu.z, d = Math.hypot(ex, ez) || 1e-6; cpuAI.dir = [ex / d, ez / d]; cpuAI.lungeDist = Math.max(0.35, Math.min(1.5, d - 0.62)); }
  cpuAI.recent.unshift(kind); cpuAI.recent.length = Math.min(cpuAI.recent.length, 3);
  cpuAI.log.push(CPU_ATTACKS[kind].label); console.log("[CPU] " + CPU_ATTACKS[kind].label + " (windup)");
}
function cpuMoveTo(dx, dz, dt) { // CPUを移動(リングの外へは出ない)。プレイヤーに食い込まない
  cpu.x += dx; cpu.z += dz;
  const lim = RING_HALF - 0.2; if (!cpuState.kb || cpuState.kb < 1e-3) { cpu.x = Math.max(-lim, Math.min(lim, cpu.x)); cpu.z = Math.max(-lim, Math.min(lim, cpu.z)); }
  const ex = cpu.x - player.x, ez = cpu.z - player.z, d = Math.hypot(ex, ez) || 1e-6, min = cpuAI.mode === "attack" ? 0.6 : BODY_GAP;
  if (d < min) { cpu.x = player.x + (ex / d) * min; cpu.z = player.z + (ez / d) * min; }
}
function updateCpuAI(dt, now) {
  if (!cpuAI.enabled || match.over) return;
  const ex = player.x - cpu.x, ez = player.z - cpu.z, dist = Math.hypot(ex, ez) || 1e-6, ux = ex / dist, uz = ez / dist;
  const stunned = now < cpuState.stunUntil;
  if (stunned) return; // 攻撃を受けた直後は、動けない
  switch (cpuAI.mode) {
    case "idle":
      if (cpuAI.auto && now >= cpuAI.until) { cpuAI.mode = dist > cpuAI.range + 0.25 ? "approach" : "decide"; }
      break;
    case "approach": { // 間合いまで歩く(Zもプレイヤーに合わせる)
      cpuMoveTo(ux * CPU_APPROACH_SPEED * dt, uz * CPU_APPROACH_SPEED * dt, dt);
      if (dist <= cpuAI.range) cpuAI.mode = "decide";
      break; }
    case "retreat": {
      cpuMoveTo(-ux * CPU_RETREAT_SPEED * dt, -uz * CPU_RETREAT_SPEED * dt, dt); cpuAI.retreatLeft -= CPU_RETREAT_SPEED * dt;
      if (cpuAI.retreatLeft <= 0) { cpuAI.mode = "idle"; cpuAI.until = now + cpuRand(250, 700); }
      break; }
    case "decide":
      cpuAI.range = cpuRand(1.5, 1.95); cpuStartWindup(cpuPickKind(), now); break;
    case "windup": // 予備動作(その場で構えを変える)。終わりに、飛び込みの向きと距離を確定する
      if (now >= cpuAI.until) {
        const A = CPU_ATTACKS[cpuAI.kind];
        cpuAI.mode = "attack"; cpuAI.t0 = now; cpuAI.lunged = 0; cpuAI.hit = false;
        console.log("[CPU] " + A.label + " (lunge " + cpuAI.lungeDist.toFixed(2) + "m)");
      }
      break;
    case "attack": {
      const A = CPU_ATTACKS[cpuAI.kind], f = (now - cpuAI.t0) / A.durMs;
      const p = smooth01((f - A.lunge[0]) / (A.lunge[1] - A.lunge[0])), target = cpuAI.lungeDist * p, step = target - cpuAI.lunged;
      if (step > 0) { cpuMoveTo(cpuAI.dir[0] * step, cpuAI.dir[1] * step, dt); cpuAI.lunged = target; }
      if (f >= 1) { cpuAI.mode = "recover"; cpuAI.until = now + cpuRand(450, 800); }
      break; }
    case "recover":
      if (now >= cpuAI.until) { if (Math.random() < 0.4) { cpuAI.mode = "retreat"; cpuAI.retreatLeft = cpuRand(0.6, 1.1); } else { cpuAI.mode = "idle"; cpuAI.until = now + cpuRand(300, 900); } }
      break;
  }
}
// CPUの姿勢: 構え⇔歩き(近づく/下がる) → 予備動作の姿勢 → 攻撃のクリップ。戻り値は体の高さ(y)
const _cq = new THREE.Quaternion(), _ce = new THREE.Euler();
function updateCpuPose(dt, now) {
  // 実際に動いた速さから、歩きアニメの強さ・再生を決める(プレイヤーと同じ)
  const mx = (cpu.x - (cpuAI.lastX ?? cpu.x)) / Math.max(dt, 1e-4), mz = (cpu.z - (cpuAI.lastZ ?? cpu.z)) / Math.max(dt, 1e-4); cpuAI.lastX = cpu.x; cpuAI.lastZ = cpu.z;
  cpuAI.vx += (mx - cpuAI.vx) * Math.min(1, 12 * dt); cpuAI.vz += (mz - cpuAI.vz) * Math.min(1, 12 * dt);
  let fx = player.x - cpu.x, fz = player.z - cpu.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
  const idleP = sampleClip(idleJson, idleDur, now / 1000 + 0.7);
  const fwk = footwork(cpuAI, idleP, fx, fz, dt, cpuAI.mode === "attack" || cpuAI.mode === "windup" ? 0 : 1);
  const pose = fwk.pose; let y = fwk.y;
  if (cpuAI.mode === "windup" || cpuAI.mode === "attack") {
    const A = CPU_ATTACKS[cpuAI.kind], el = now - cpuAI.t0;
    if (cpuAI.mode === "windup") { // 予備動作: その技の構えへ、すばやく(攻撃の種類が一目で分かる)
      const k = smooth01(el / (A.windupMs * 0.8));
      for (const n of Object.keys(A.tell.bones)) if (pose[n]) { const [x, yy, z] = A.tell.bones[n]; pose[n].premultiply(_cq.setFromEuler(_ce.set(x * k, yy * k, z * k))); }
      y -= A.tell.y * k;
    } else {
      const c = sampleOnce(A.clip, A.range.start + (el * A.speed) / 1000), w = Math.min(1, el / 70, (A.durMs - el) / 120);
      for (const n of Object.keys(c.pose)) if (pose[n]) pose[n].slerp(c.pose[n], Math.max(0, w));
      y += (c.mp[1] - y) * Math.max(0, w);
    }
  }
  for (const n of Object.keys(pose)) { const b = cpu.bones[n]; if (b) b.quaternion.copy(pose[n]); }
  return y;
}
// CPUの攻撃がプレイヤーに当たったか(手足の球 × プレイヤーの体の球)
// プレイヤー側の体の球は、CPU側よりひとまわり小さい(CPUの攻撃は、動けばよけられるように)
const PLAYER_HURT = [{ bone: "Head", r: 0.17 }, { bone: "Chest", r: 0.24 }, { bone: "Hips", r: 0.22 }, { bone: "LeftUpperLeg", r: 0.17 }, { bone: "RightUpperLeg", r: 0.17 }, { bone: "LeftLowerLeg", r: 0.16 }, { bone: "RightLowerLeg", r: 0.16 }];
const playerState = { react: null, kb: 0, kbDir: [-1, 0], stunUntil: 0, flashUntil: 0, hits: 0 };
const PLAYER_STUN_MS = 480;
function checkCpuHit(now) {
  if (cpuAI.mode !== "attack" || cpuAI.hit || match.over) return;
  const A = CPU_ATTACKS[cpuAI.kind], f = (now - cpuAI.t0) / A.durMs;
  if (f < A.hit[0] || f > A.hit[1]) return;
  const hand = cpu.bones[A.limb[0]], fore = cpu.bones[A.limb[1]]; if (!hand) return;
  hand.getWorldPosition(_w1); if (fore) { fore.getWorldPosition(_w2); _w1.add(_w3.copy(_w1).sub(_w2).normalize().multiplyScalar(0.1)); }
  let best = null;
  for (const h of PLAYER_HURT) { const b = player.bones[h.bone]; if (!b) continue; b.getWorldPosition(_w3); const d = _w1.distanceTo(_w3); if (d <= A.limb[2] + h.r && (!best || d < best.d)) best = { d, bone: h.bone }; }
  if (!best) return;
  cpuAI.hit = true; playerState.hits++;
  const zone = { high: "head", mid: "body", low: "legs" }[cpuAI.kind];
  playerState.react = { zone, at: now }; playerState.stunUntil = now + PLAYER_STUN_MS; playerState.flashUntil = now + 110;
  const dx = player.x - cpu.x, dz = player.z - cpu.z, l = Math.hypot(dx, dz) || 1; playerState.kbDir = [dx / l, dz / l]; playerState.kb += A.kb;
  attack = null; // 攻撃中だったら中断
  const msg = `${A.label} HIT player ${best.bone} -> reaction ${zone}`; cpuAI.log.push(msg); console.log("[CPU-Hit] " + msg);
}
let playerMats = null;
function applyPlayerReaction(dt, now) {
  if (playerState.kb > 1e-4 && !match.over) { const step = playerState.kb * Math.min(1, 14 * dt); player.x += playerState.kbDir[0] * step; player.z += playerState.kbDir[1] * step; playerState.kb -= step; const r = Math.hypot(player.x, player.z); if (r > WORLD_LIM) { player.x *= WORLD_LIM / r; player.z *= WORLD_LIM / r; } }
  const k = reactAmountOf(playerState.react, now);
  if (k > 0 && !match.over) {
    const R = REACT[playerState.react.zone];
    for (const n of Object.keys(R.bones)) { const b = player.bones[n]; if (!b) continue; const [x, y, z] = R.bones[n]; b.quaternion.premultiply(_hQ.setFromEuler(_hE.set(x * k, y * k, z * k))); }
    player.root.position.y -= R.drop * k;
  }
  if (!playerMats) { const l = []; player.root.traverse((o) => { if (o.isMesh && o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.emissive && !l.includes(m)) l.push(m); }); if (l.length) playerMats = l; }
  if (playerMats) { const f = now < playerState.flashUntil ? 0.7 : 0; for (const m of playerMats) m.emissive.setRGB(f, f * 0.4, f * 0.4); }
}

// ---------- 攻撃の当たり判定と、CPUのリアクション ----------
// 攻撃中(HIT_WINDOW の間)、攻撃している手足の球と、CPUの体の球(頭・胸・腹・すね)が重なったら「ヒット」(1回の攻撃で1回)。
//  ・当たった場所で、リアクションが変わる: 頭=のけぞる(上段) / 胸・腹=体がくの字に折れる(中段) / すね=膝が崩れる(下段)
//  ・CPUは、攻撃の向きへノックバックする(場外まで押し出せばリングアウト)
const HIT_WINDOW = [0.15, 0.72]; // 攻撃の長さの何割〜何割の間だけ当たる(振り出し〜伸びきり)
const LIMBS = {
  high_near: { bone: "RightFoot", fore: null, r: 0.24, kb: 0.8 }, mid_near: { bone: "RightHand", fore: "RightForearm", r: 0.17, kb: 0.7 }, low_near: { bone: "RightFoot", fore: null, r: 0.2, kb: 0.55 },
  high_far: { bone: "RightFoot", fore: null, r: 0.26, kb: 0.9 }, mid_far: { bone: "LeftFoot", fore: null, r: 0.22, kb: 0.9 }, low_far: { bone: "LeftFoot", fore: null, r: 0.22, kb: 0.6 },
};
const HURTBOXES = [{ bone: "Head", r: 0.2, zone: "head" }, { bone: "Chest", r: 0.3, zone: "body" }, { bone: "Hips", r: 0.27, zone: "body" }, { bone: "LeftUpperLeg", r: 0.2, zone: "legs" }, { bone: "RightUpperLeg", r: 0.2, zone: "legs" }, { bone: "LeftLowerLeg", r: 0.19, zone: "legs" }, { bone: "RightLowerLeg", r: 0.19, zone: "legs" }];
const REACT = {
  head: { in: 60, hold: 70, out: 300, drop: 0.02, bones: { Head: [-0.75, 0, 0], Neck: [-0.5, 0, 0], Spine: [-0.35, 0, 0], Chest: [-0.2, 0, 0], LeftUpperArm: [-0.4, 0, 0.3], RightUpperArm: [-0.4, 0, -0.3] } },
  body: { in: 60, hold: 80, out: 320, drop: 0.05, bones: { Spine: [0.55, 0, 0], Chest: [0.35, 0, 0], Head: [0.35, 0, 0], Neck: [0.2, 0, 0], Hips: [0.15, 0, 0] } },
  legs: { in: 60, hold: 90, out: 340, drop: 0.2, bones: { LeftUpperLeg: [-0.5, 0, 0], RightUpperLeg: [-0.5, 0, 0], LeftLowerLeg: [0.9, 0, 0], RightLowerLeg: [0.9, 0, 0], Spine: [0.25, 0, 0], Head: [0.2, 0, 0] } },
};
const cpuState = { react: null, kb: 0, kbDir: [1, 0], hits: 0, flashUntil: 0, stunUntil: 0 };
const hitLog = [];
const _w1 = new THREE.Vector3(), _w2 = new THREE.Vector3(), _w3 = new THREE.Vector3();
function limbCenter(kind) {
  const L = LIMBS[kind], b = player.bones[L.bone]; if (!b) return null;
  b.getWorldPosition(_w1);
  if (L.fore && player.bones[L.fore]) { player.bones[L.fore].getWorldPosition(_w2); _w1.add(_w3.copy(_w1).sub(_w2).normalize().multiplyScalar(0.1)); } // 拳は手首から腕の向きへ少し先
  return _w1;
}
function checkHit(now) {
  if (!attack || attack.hit || match.over) return;
  const A = ATTACKS[attack.kind], f = (now - attack.startAt) / A.durMs;
  const hw = A.hit || HIT_WINDOW; if (f < hw[0] || f > hw[1]) return;
  const c = limbCenter(attack.kind); if (!c) return;
  const L = LIMBS[attack.kind];
  let best = null;
  for (const h of HURTBOXES) {
    const hb = cpu.bones[h.bone]; if (!hb) continue;
    hb.getWorldPosition(_w3);
    const d = c.distanceTo(_w3);
    if (d <= L.r + h.r && (!best || d < best.d)) best = { d, zone: h.zone, bone: h.bone };
  }
  if (!best) return;
  attack.hit = true; cpuState.hits++;
  // リアクションは、攻撃の高さに合わせる(上段=頭がのけぞる / 中段=体が折れる / 下段=膝が崩れる)。どこに当たっても、その高さの反応
  const zone = A.zone;
  cpuState.react = { zone, at: now };
  cpuState.flashUntil = now + 110;
  cpuState.stunUntil = now + 450; if (cpuAI.mode === "windup" || cpuAI.mode === "attack") { cpuAI.mode = "recover"; cpuAI.until = now + 450; } // CPUの攻撃は、当てられたら中断
  // ノックバック: プレイヤーからCPUへの向きへ
  const dx = cpu.x - player.x, dz = cpu.z - player.z, l = Math.hypot(dx, dz) || 1;
  cpuState.kbDir = [dx / l, dz / l]; cpuState.kb += L.kb;
  const msg = `${A.label} HIT cpu ${best.bone} -> reaction ${zone}`; hitLog.push(msg); console.log("[Hit] " + msg);
}
const _hQ = new THREE.Quaternion(), _hE = new THREE.Euler();
const reactAmount = (now) => reactAmountOf(cpuState.react, now);
function reactAmountOf(r, now) {
  if (!r) return 0;
  const R = REACT[r.zone], e = now - r.at;
  if (e < 0 || e >= R.in + R.hold + R.out) return 0;
  if (e < R.in) { const t = e / R.in; return 1 - (1 - t) ** 3; }
  if (e < R.in + R.hold) return 1;
  const t = (e - R.in - R.hold) / R.out; return 1 - t * t * (3 - 2 * t);
}
let cpuMats = null;
function applyCpuReaction(dt, now) {
  // ノックバック(残りの距離を、すばやく消化)
  if (cpuState.kb > 1e-4 && !match.over) {
    const step = cpuState.kb * Math.min(1, 14 * dt);
    cpu.x += cpuState.kbDir[0] * step; cpu.z += cpuState.kbDir[1] * step; cpuState.kb -= step;
    const r = Math.hypot(cpu.x, cpu.z); if (r > WORLD_LIM) { cpu.x *= WORLD_LIM / r; cpu.z *= WORLD_LIM / r; }
  }
  const k = reactAmount(now);
  if (k > 0 && !match.over) {
    const R = REACT[cpuState.react.zone];
    for (const n of Object.keys(R.bones)) { const b = cpu.bones[n]; if (!b) continue; const [x, y, z] = R.bones[n]; b.quaternion.premultiply(_hQ.setFromEuler(_hE.set(x * k, y * k, z * k))); }
    cpu.root.position.y -= R.drop * k;
  }
  // ヒットの瞬間、CPUを一瞬白く光らせる
  if (!cpuMats) { const l = []; cpu.root.traverse((o) => { if (o.isMesh && o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.emissive && !l.includes(m)) l.push(m); }); if (l.length) cpuMats = l; }
  if (cpuMats) { const f = now < cpuState.flashUntil ? 0.7 : 0; for (const m of cpuMats) m.emissive.setRGB(f, f, f); }
}

// ---------- リングアウト ----------
const match = { over: false, loser: null, fall: null };
const resultEl = document.createElement("div");
resultEl.style.cssText = "position:fixed;inset:0;z-index:8;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(0,0,0,0.35);font-family:system-ui,sans-serif;text-align:center;";
resultEl.innerHTML = '<div id="roTitle" style="font-weight:900;font-size:44px;letter-spacing:3px;color:#fff;-webkit-text-stroke:2px #000;paint-order:stroke fill;text-shadow:0 4px 10px rgba(0,0,0,0.6)">RING OUT!</div><div id="roResult" style="font-weight:900;font-size:34px;letter-spacing:2px;-webkit-text-stroke:2px #000;paint-order:stroke fill"></div><button id="roRetry" style="margin-top:10px;font:700 18px system-ui,sans-serif;padding:10px 28px;border-radius:24px;border:none;background:#fff;color:#222">もう一度</button>';
resultEl.querySelector("#roRetry").addEventListener("click", () => location.reload());
document.body.appendChild(resultEl);
function ringOut(who, now) {
  if (match.over) return;
  const f = who === "player" ? player : cpu, r = Math.hypot(f.x, f.z) || 1;
  match.over = true; match.loser = who;
  match.fall = { who, x: f.x, z: f.z, y: 0, vx: (f.x / r) * 1.4, vz: (f.z / r) * 1.4, vy: 1.2, tx: (Math.random() - 0.5) * 3, tz: 2.5 + Math.random() };
  attack = null; input.x = input.z = 0;
  console.log("[Match] RING OUT: " + who + " loses");
  resultEl.querySelector("#roResult").textContent = who === "player" ? "YOU LOSE" : "YOU WIN!";
  resultEl.querySelector("#roResult").style.color = who === "player" ? "#ff6a6a" : "#ffe14a";
  setTimeout(() => { resultEl.style.display = "flex"; }, 1400);
}
// 毎フレーム: 場外に出たらリングアウト。負けた側は縁から外へ放り出されて落ちる(重力+回転)
function updateRingOut(dt, now) {
  if (!match.over) {
    const out = (f) => Math.max(Math.abs(f.x), Math.abs(f.z)) > RING_HALF + RING_OUT_MARGIN; // 四角の縁(いちばん外へ出ている軸で判定)
    if (out(player)) ringOut("player", now);
    else if (out(cpu)) ringOut("cpu", now);
    return;
  }
  const F = match.fall, f = F.who === "player" ? player : cpu;
  if (F.y < -6) return; // 落ちきったら止める
  F.vy -= 14 * dt; F.y += F.vy * dt; F.x += F.vx * dt; F.z += F.vz * dt;
  f.x = F.x; f.z = F.z;
  f.root.position.set(F.x, F.y, F.z);
  f.root.rotation.x += F.tx * dt; f.root.rotation.z += F.tz * dt; // 倒れながら落ちる
}
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
function update(dt, now) {
  // CPUのほうを向く(向いている方向 f)。移動の前進/後退は、この向きが基準
  let fx = cpu.x - player.x, fz = cpu.z - player.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
  // 移動(X・Z軸)。攻撃中は移動できない
  const stunned = now < playerState.stunUntil;
  const mv = attack || match.over || stunned ? { x: 0, z: 0 } : readDir();
  const mag = Math.min(1, Math.hypot(mv.x, mv.z));
  const back = mv.x * fx + mv.z * fz < -0.3 ? BACK_SPEED_SCALE : 1; // CPUから離れる向きは、少し遅い
  const dist = mag * WALK_SPEED * back * dt, steps = Math.max(1, Math.ceil(dist / 0.05));
  const ux = mag > 0 ? mv.x / Math.hypot(mv.x, mv.z) : 0, uz = mag > 0 ? mv.z / Math.hypot(mv.x, mv.z) : 0;
  for (let i = 0; i < steps; i++) {
    player.x += (ux * dist) / steps; player.z += (uz * dist) / steps;
    // CPUに食い込まない(円どうし)。リングの外へも出られる(出たらリングアウト)が、遠くへは行きすぎない
    let dx = player.x - cpu.x, dz = player.z - cpu.z, d = Math.hypot(dx, dz) || 1e-6;
    if (d < BODY_GAP) { player.x = cpu.x + (dx / d) * BODY_GAP; player.z = cpu.z + (dz / d) * BODY_GAP; }
    const pr = Math.hypot(player.x, player.z); if (pr > WORLD_LIM) { player.x *= WORLD_LIM / pr; player.z *= WORLD_LIM / pr; }
  }
  // 実際に動けた速さ(壁・CPUに当たって止まっているときは歩きアニメも止める)
  const mx = (player.x - (state.lastX ?? player.x)) / Math.max(dt, 1e-4), mz = (player.z - (state.lastZ ?? player.z)) / Math.max(dt, 1e-4);
  state.lastX = player.x; state.lastZ = player.z;
  state.vx += (mx - state.vx) * Math.min(1, 14 * dt); state.vz += (mz - state.vz) * Math.min(1, 14 * dt);
  // 体の向き: お互いを向く(なめらかに)
  player.yaw += angleDiff(player.yaw, Math.atan2(fx, fz)) * Math.min(1, 12 * dt);
  // CPUの向き: ふだんはプレイヤーを向く。予備動作〜攻撃中は、確定した飛び込みの向きに固定する(横へよけられる)
  const cpuCommitted = cpuAI.mode === "windup" || cpuAI.mode === "attack";
  cpu.yaw += angleDiff(cpu.yaw, cpuCommitted ? Math.atan2(cpuAI.dir[0], cpuAI.dir[1]) : Math.atan2(-fx, -fz)) * Math.min(1, 12 * dt);
  if (!match.over) { player.root.rotation.y = player.yaw; cpu.root.rotation.y = cpu.yaw; }

  // プレイヤーのポーズ: 構え(アイドル)のまま、脚だけステップ
  const idleP = sampleClip(idleJson, idleDur, now / 1000);
  const fwk = footwork(state, idleP, fx, fz, dt, 1);
  for (const n of Object.keys(fwk.pose)) { const b = player.bones[n]; if (b) b.quaternion.copy(fwk.pose[n]); }
  player.root.position.y = fwk.y;
  // 攻撃: 構えの上にクリップを重ねる(頭と終わりでなじませる)。踏み込み(modelPosition)は、向いている方向へ
  let step = 0;
  if (attack) {
    const A = ATTACKS[attack.kind], el = now - attack.startAt;
    if (el >= A.durMs) { attack = null; }
    else {
      const w = Math.max(0, Math.min(1, Math.min(el / ATTACK_BLEND_IN_MS, (A.durMs - el) / ATTACK_BLEND_OUT_MS)));
      const c = sampleOnce(A.clip, A.range.start + (el * ATTACK_SPEED) / 1000);
      for (const n of Object.keys(c.pose)) { const b = player.bones[n]; if (b) b.quaternion.copy(idleP.pose[n] || c.pose[n]).slerp(c.pose[n], w); }
      step = c.mp[2] * w; // モデルの前方(+Z) = CPUのいる方向
      if (A.lunge) { // 遠間の技: 本当に前へ踏み込む(CPUの手前で止まる。技のあとも、その位置のまま)
        const [l0, l1, dist] = A.lunge, u = Math.max(0, Math.min(1, (el / A.durMs - l0) / (l1 - l0))), want = dist * u * u * (3 - 2 * u);
        const inc = Math.max(0, Math.min(want - attack.lunged, Math.hypot(cpu.x - player.x, cpu.z - player.z) - BODY_GAP - 0.1));
        attack.lunged += inc; player.x += fx * inc; player.z += fz * inc;
        const pr = Math.hypot(player.x, player.z); if (pr > WORLD_LIM) { player.x *= WORLD_LIM / pr; player.z *= WORLD_LIM / pr; }
      }
      player.root.position.y = idleP.y + (c.mp[1] - idleP.y) * w;
    }
  }
  applyPlayerReaction(dt, now); // CPUの攻撃を受けたときの、ノックバックと体の反応
  let rx = player.x + fx * step, rz = player.z + fz * step;
  { const dx = rx - cpu.x, dz = rz - cpu.z, d = Math.hypot(dx, dz) || 1e-6; if (d < 0.55) { rx = cpu.x + (dx / d) * 0.55; rz = cpu.z + (dz / d) * 0.55; } } // 踏み込みでも、CPUに食い込まない
  player.root.position.x = rx; player.root.position.z = rz;
  // CPU: AI(近づく・予備動作・飛び込み攻撃・隙・下がる)で動かす
  updateCpuAI(dt, now);
  const cpuY = updateCpuPose(dt, now);
  applyCpuReaction(dt, now); // ノックバック(位置)と、ヒットしたときの体の反応
  cpu.root.position.set(cpu.x, cpuY - (cpuState.react && !match.over ? REACT[cpuState.react.zone].drop * reactAmount(now) : 0), cpu.z);
  // 攻撃の当たり判定(両者のポーズが決まったあとに、手足と体の位置で調べる)
  scene.updateMatrixWorld(true);
  checkHit(now);
  checkCpuHit(now);
  // リングアウト: 判定 → 負けた側が場外へ落ちる
  updateRingOut(dt, now);
  // カメラ: 2人の中間(X)を追い、2人が離れるほど自然に引く(寄る/引くはなめらかに)
  const mid = (player.x + cpu.x) / 2, sep = Math.hypot(player.x - cpu.x, (player.z - cpu.z) * 0.5);
  const wantW = Math.max(VISIBLE_WIDTH_MIN, Math.min(VISIBLE_WIDTH_MAX, sep + CAM_MARGIN));
  camWidth += (wantW - camWidth) * Math.min(1, 3.5 * dt);
  placeCamera(CAM_LOOK.x + (Math.max(-RING_HALF, Math.min(RING_HALF, mid)) - CAM_LOOK.x) * Math.min(1, 6 * dt), camWidth);
}
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  update(dt, performance.now());
  updateZoneOverlay();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
document.getElementById("loading").style.display = "none";
update(0.016, performance.now());
requestAnimationFrame(frame);

// テスト用
window.__fight = {
  debugPos: () => { const g = (b) => { const v = new THREE.Vector3(); b.getWorldPosition(v); return v.toArray().map((x) => +x.toFixed(2)); }; return { hand: g(cpu.bones.RightHand), fore: g(cpu.bones.RightForearm), cpuHips: g(cpu.bones.Hips), pHead: g(player.bones.Head), pChest: g(player.bones.Chest), pHips: g(player.bones.Hips), pLL: g(player.bones.LeftLowerLeg), pRL: g(player.bones.RightLowerLeg), pLF: g(player.bones.LeftFoot) }; },
  cpuAI, playerState, CPU_ATTACKS, cpuAttack: (k) => { cpuStartWindup(k, performance.now()); },
  hitLog, cpuState, setCpu: (x, z = 0) => { cpu.x = x; cpu.z = z; }, LIMBS,
  zoneForY, zoneBounds,
  startAttack: (k) => startAttack(k, performance.now()), attackLog, ATTACKS,
  player, cpu, RING_HALF, BODY_GAP, camera, ringOut: (w) => ringOut(w, performance.now()),
  setDir: (x, z = 0) => { input.x = x; input.z = z; },
  teleport: (x, z = 0) => { player.x = x; player.z = z; player.root.position.x = x; player.root.position.z = z; },
  getState: () => ({ attack: attack && attack.kind, px: player.x, pz: player.z, cx: cpu.x, cz: cpu.z, vx: state.vx, vz: state.vz, w: state.w, pf: state.pf, ps: state.ps, dir: readDir(), yaw: player.yaw, camWidth, camDist, camX: CAM_LOOK.x, over: match.over, loser: match.loser, fy: match.fall ? match.fall.y : 0 }),
};
