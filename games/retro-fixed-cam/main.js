import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

// 初代バイオハザード風: 写真を背景にした「固定カメラ」の上を、中華娘(3Dモデル)が「ラジコン操作」で歩く。
//  ・写真の床と壁の線から、カメラの向き・高さ・画角を求めてある(tools/calibrate.py → assets/scene.json)。写真の1画素 ⇔ 床の1点(メートル)
//  ・3Dのカメラを、写真のカメラに合わせてある → キャラの大きさと遠近が、写真と矛盾しない
//  ・歩ける範囲(床)と障害物は、床のメートル座標の多角形/円で持ち、当たり判定に使う。手前の物(親柱)は、写真を切り抜いて上に重ねて、キャラを隠す
//  ・操作: ▲前進 ▼後退 ◀左旋回 ▶右旋回(その場で回る)。走る = 押しながら前進
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function showLoadError(what, err) {
  console.error(what, err); const el = $("loading"); el.classList.add("err");
  el.innerHTML = `<div>読み込みに失敗しました</div><pre>${what}\n${String((err && (err.stack || err.message)) || err)}</pre><button onclick="location.reload()">再読み込み</button>`;
}

// ---------- 読み込み ----------
const SCENE_FILES = ["./assets/scene1.json", "./assets/scene2.json"]; // 廊下の手前(階段) → 廊下の奥
let SCENES = [], SC, walkJson, glbBuf, curIdx = 0;
try {
  const get = async (u, kind) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return kind === "json" ? r.json() : r.arrayBuffer(); };
  [SCENES, walkJson, glbBuf] = await Promise.all([Promise.all(SCENE_FILES.map((f) => get(f, "json"))), get("./assets/walk.json", "json"), get("./assets/china_rigged.glb", "buf")]);
  await Promise.all(SCENES.map((sc) => new Promise((res, rej) => { const im = new Image(); im.onload = res; im.onerror = () => rej(new Error("写真 " + sc.image + " を読み込めません")); im.src = "./" + sc.image; }))); // 先に読み込んでおく(切り替えでちらつかない)
  SC = SCENES[0];
} catch (e) { showLoadError("ファイルの取得に失敗", e); throw e; }

// ---------- 画面の配置: 写真を画面の上にぴったり置き(写真の縦横比のまま)、下を操作エリアにする ----------
const stage = $("stage"), photo = $("photo"), glCanvas = $("gl"), dbg = $("dbg");
const IMG_ASPECT = SC.imageW / SC.imageH;
let SW = 0, SH = 0;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const camera = new THREE.PerspectiveCamera(SC.camera.fovDeg, IMG_ASPECT, 0.05, 50);
function applyCamera() { // 3Dカメラを、写真のカメラに合わせる(位置・向き・画角)。シーンごとに違う
  const c = SC.camera, m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...c.xAxis), new THREE.Vector3(...c.yAxis), new THREE.Vector3(...c.zAxis));
  camera.position.set(...c.pos); camera.quaternion.setFromRotationMatrix(m); camera.fov = c.fovDeg; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
}
applyCamera();
function layout() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const controlsH = Math.min(260, vh * 0.34);          // 下の操作エリア
  let w = vw, h = w / IMG_ASPECT; if (h > vh - controlsH) { h = vh - controlsH; w = h * IMG_ASPECT; }
  SW = Math.round(w); SH = Math.round(h);
  stage.style.width = SW + "px"; stage.style.height = SH + "px"; stage.style.left = Math.round((vw - SW) / 2) + "px"; stage.style.top = "0px";
  renderer.setSize(SW, SH, false); glCanvas.style.width = SW + "px"; glCanvas.style.height = SH + "px";
  document.body.style.background = "#050505";
}
window.addEventListener("resize", layout); if (window.visualViewport) window.visualViewport.addEventListener("resize", layout); layout();

// 床の座標(X: 左の壁から右へ, Z: 奥へ) → 3D世界の座標 (x = X, z = -Z)
const toWorld = (X, Z) => new THREE.Vector3(X, 0, -Z);
// 床の点 → 写真の画素(1080x1440) : デバッグ表示とオクルージョン判定に使う
const _v = new THREE.Vector3();
function floorToImage(X, Z, y = 0) { _v.set(X, y, -Z).project(camera); return [(_v.x + 1) / 2 * SC.imageW, (1 - _v.y) / 2 * SC.imageH]; }

// ---------- 床・障害物の当たり判定(床のメートル座標) ----------
function inPoly(x, z, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
const R_BODY = 0.2; // キャラの体の半径(m)
const _samples = [...Array(8)].map((_, i) => [Math.cos((i / 8) * Math.PI * 2), Math.sin((i / 8) * Math.PI * 2)]);
function isFree(X, Z) {
  for (const [dx, dz] of _samples) {
    const x = X + dx * R_BODY, z = Z + dz * R_BODY;
    if (!inPoly(x, z, SC.walkable)) return false;
    for (const p of Object.values(SC.obstaclePolys)) if (inPoly(x, z, p)) return false;
  }
  for (const c of Object.values(SC.obstacleCircles)) if (Math.hypot(X - c.c[0], Z - c.c[1]) < c.r + R_BODY * 0.8) return false;
  return true;
}
// 動かす: そのまま進めなければ、X方向だけ・Z方向だけに分けて試す(壁にそって滑る)
function tryMove(dx, dz) {
  if (isFree(player.X + dx, player.Z + dz)) { player.X += dx; player.Z += dz; return true; }
  if (dx && isFree(player.X + dx, player.Z)) { player.X += dx; return true; }
  if (dz && isFree(player.X, player.Z + dz)) { player.Z += dz; return true; }
  return false;
}

// ---------- 中華娘 ----------
const world = new THREE.Scene();
world.add(new THREE.HemisphereLight(0xfff0dc, 0x6b4a2a, 1.25));
const sun = new THREE.DirectionalLight(0xffe2b8, 1.9); sun.position.set(-1.5, 3.5, 1.2); world.add(sun); // 天井の明かりのあたり(写真の暖色に合わせる)
const bones = {}; let character, model, IDLE, IDLE_Y = 0, walkDur = 1, walkStride = 0.9;
try {
  const gltf = await new GLTFLoader().parseAsync(glbBuf, "./assets/");
  model = gltf.scene; character = new THREE.Group(); character.add(model); character.scale.setScalar(SC.charScale); world.add(character);
  model.traverse((o) => { if (o.isBone) bones[o.name] = o; if (o.isMesh) o.frustumCulled = false; });
  walkDur = walkJson.keyframes[walkJson.keyframes.length - 1].time || 1; walkStride = walkJson.strideLengthPerCycle || 0.9;
  const pass = walkJson.keyframes.find((k) => k.frame === 7) || walkJson.keyframes[0];
  IDLE = {}; for (const n of Object.keys(pass.pose)) IDLE[n] = new THREE.Quaternion(...pass.pose[n]); IDLE_Y = (pass.modelPosition || [0, 0, 0])[1];
} catch (e) { showLoadError("中華娘モデル(GLB)の解析に失敗", e); throw e; }
const _qa = new THREE.Quaternion();
function sampleWalk(t) {
  const keys = walkJson.keyframes, tt = ((t % walkDur) + walkDur) % walkDur; let i = 0; while (i < keys.length - 2 && keys[i + 1].time <= tt) i++;
  const a = keys[i], b = keys[i + 1], span = b.time - a.time, f = span > 0 ? (tt - a.time) / span : 0, pose = {};
  for (const n of Object.keys(a.pose)) pose[n] = new THREE.Quaternion(...a.pose[n]).slerp(_qa.set(...b.pose[n]), f);
  const ay = (a.modelPosition || [0, 0, 0])[1], by = (b.modelPosition || [0, 0, 0])[1]; return { pose, y: ay + (by - ay) * f };
}
function poseChar(cycles, amp) {
  const w = sampleWalk(cycles * walkDur);
  for (const n of Object.keys(w.pose)) { const b = bones[n]; if (b) b.quaternion.copy(IDLE[n] || w.pose[n]).slerp(w.pose[n], amp); }
  model.position.y = IDLE_Y + (w.y - IDLE_Y) * amp;
}
const blob = new THREE.Mesh(new THREE.CircleGeometry(0.36, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false }));
blob.rotation.x = -Math.PI / 2; blob.position.y = 0.01; world.add(blob);

// ---------- 手前に来る物(親柱)のオクルージョン: 写真を輪郭で切り抜いて、キャラの上に重ねる。キャラが物より奥にいるときだけ見せる ----------
let occ = [];
function buildOccluders() {
  for (const o of occ) o.el.remove(); occ = [];
  for (const [name, o] of Object.entries(SC.occluders)) {
    const d = document.createElement("div"); d.className = "occ"; d.style.backgroundImage = `url(./${SC.image})`;
    d.style.clipPath = `polygon(${o.poly.map(([x, y]) => `${(x / SC.imageW * 100).toFixed(2)}% ${(y / SC.imageH * 100).toFixed(2)}%`).join(",")})`;
    stage.insertBefore(d, dbg); occ.push({ name, el: d, anchor: o.anchor });
  }
}
// ---------- 検出結果の表示(写真の上に、床の範囲・障害物・0.5m格子を重ねる。床の情報が写真と合っているかの確認用) ----------
dbg.setAttribute("viewBox", `0 0 ${SC.imageW} ${SC.imageH}`); dbg.setAttribute("preserveAspectRatio", "none");
function buildDebug() {
  const P = (poly) => poly.map(([X, Z]) => floorToImage(X, Z).map((v) => v.toFixed(1)).join(",")).join(" ");
  let h = ""; const w = SC.walkable, xs = w.map((p) => p[0]), zs = w.map((p) => p[1]);
  for (let Z = Math.ceil(Math.min(...zs) * 2) / 2; Z <= Math.max(...zs); Z += 0.5) h += `<polyline points="${P([[Math.min(...xs), Z], [Math.max(...xs), Z]])}" fill="none" stroke="rgba(0,255,255,.45)" stroke-width="2"/>`;
  for (let X = 0; X <= 1.8; X += 0.5) h += `<polyline points="${P([[X, Math.min(...zs)], [X, Math.max(...zs)]])}" fill="none" stroke="rgba(255,0,255,.4)" stroke-width="2"/>`;
  h += `<polygon points="${P(w)}" fill="rgba(60,255,90,.18)" stroke="#3cff5a" stroke-width="4"/>`;
  for (const p of Object.values(SC.obstaclePolys)) h += `<polygon points="${P(p)}" fill="rgba(255,60,60,.35)" stroke="#ff4040" stroke-width="4"/>`;
  for (const c of Object.values(SC.obstacleCircles)) { const pts = [...Array(24)].map((_, i) => [c.c[0] + Math.cos(i / 24 * 6.2832) * c.r, c.c[1] + Math.sin(i / 24 * 6.2832) * c.r]); h += `<polygon points="${P(pts)}" fill="rgba(255,60,60,.35)" stroke="#ff4040" stroke-width="4"/>`; }
  for (const o of Object.values(SC.occluders)) h += `<polygon points="${o.poly.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#ffd040" stroke-width="3" stroke-dasharray="10 6"/>`;
  for (const g of SC.gates) h += `<polygon points="${P(g.poly)}" fill="rgba(80,160,255,.25)" stroke="#58a6ff" stroke-width="4" stroke-dasharray="14 8"/>`; // 青 = 別のシーンへのゲート
  h += `<circle id="dbgPlayer" r="12" fill="#fff" stroke="#000" stroke-width="3"/>`;
  dbg.innerHTML = h;
}
let dbgOn = false;
$("bDbg").addEventListener("click", () => { dbgOn = !dbgOn; dbg.style.display = dbgOn ? "block" : "none"; $("bDbg").classList.toggle("on", dbgOn); });

// ---------- 状態・入力(ラジコン操作) ----------
const player = { X: SC.start[0], Z: SC.start[1], theta: SC.startHeading }; // theta: 向き。0 = 奥(+Z)、増えると右(+X)へ回る
const hold = { u: false, d: false, l: false, r: false, run: false };
// ---------- シーンの切り替え(固定カメラのカット) ----------
// 床の上のゲートに入ると、別のシーン(別の写真・別のカメラ)へ切り替わる。キャラの向き θ はそのまま(奥へ向かって歩いていれば、切り替わったあとも奥へ進む)。黒いフェードを挟む
const fade = document.createElement("div"); fade.style.cssText = "position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:9;transition:opacity .14s"; document.body.appendChild(fade);
let transitioning = false, gateCooldownUntil = 0;
function setScene(i) {
  curIdx = i; SC = SCENES[i]; photo.style.backgroundImage = `url(./${SC.image})`; applyCamera(); buildOccluders(); buildDebug();
  dbg.setAttribute("viewBox", `0 0 ${SC.imageW} ${SC.imageH}`);
}
function goScene(gate) {
  if (transitioning) return; transitioning = true; fade.style.opacity = 1;
  setTimeout(() => {
    setScene(gate.to); player.X = gate.enter[0]; player.Z = gate.enter[1]; gateCooldownUntil = performance.now() + 500;
    requestAnimationFrame(() => { fade.style.opacity = 0; transitioning = false; });
  }, 160);
}
setScene(0);
const WALK = 1.35, RUN = 3.0, BACK = 0.9, TURN = 2.0, TURN_RUN = 2.6; // m/s, m/s, m/s, rad/s
function bindBtn(id, key) {
  const el = $(id);
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); hold[key] = true; el.classList.add("on"); try { el.setPointerCapture(e.pointerId); } catch (_) {} });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(t, () => { hold[key] = false; el.classList.remove("on"); });
}
bindBtn("bU", "u"); bindBtn("bD", "d"); bindBtn("bL", "l"); bindBtn("bR", "r"); bindBtn("run", "run");
const KEY = { ArrowUp: "u", ArrowDown: "d", ArrowLeft: "l", ArrowRight: "r", ShiftLeft: "run", ShiftRight: "run", KeyW: "u", KeyS: "d", KeyA: "l", KeyD: "r" };
window.addEventListener("keydown", (e) => { if (KEY[e.code]) { hold[KEY[e.code]] = true; e.preventDefault(); } });
window.addEventListener("keyup", (e) => { if (KEY[e.code]) { hold[KEY[e.code]] = false; } });
let cycles = 0, ampE = 0, speedNow = 0;
const clock = new THREE.Clock(), infoEl = $("info");
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  // ラジコン: 旋回はその場で / 前後はキャラの向きへ
  if (transitioning) { requestAnimationFrame(frame); return; }
  const turn = (hold.r ? 1 : 0) - (hold.l ? 1 : 0), fwd = (hold.u ? 1 : 0) - (hold.d ? 1 : 0);
  player.theta += turn * (hold.run ? TURN_RUN : TURN) * dt;
  let v = 0; if (fwd > 0) v = hold.run ? RUN : WALK; else if (fwd < 0) v = -BACK;
  let moved = 0;
  if (v) { const dx = Math.sin(player.theta) * v * dt, dz = Math.cos(player.theta) * v * dt, bx = player.X, bz = player.Z; tryMove(dx, dz); moved = Math.hypot(player.X - bx, player.Z - bz) * Math.sign(v); }
  speedNow += ((Math.abs(moved) / Math.max(dt, 1e-4)) - speedNow) * Math.min(1, dt * 10);
  // 足の動き: 進んだ距離に合わせる(壁にぶつかって進めないときは止まる)。その場で旋回するときは、ゆっくり足踏み
  const stepSpeed = Math.abs(moved) / Math.max(dt, 1e-4);
  const turning = turn !== 0 && !v;
  cycles += (moved / Math.max(dt, 1e-4)) * dt / walkStride + (turning ? turn * dt * 0.55 : 0);
  ampE += ((turning ? 0.55 : clamp(stepSpeed / 1.0, 0, 1)) - ampE) * Math.min(1, dt * 10);
  poseChar(cycles, ampE);
  character.position.copy(toWorld(player.X, player.Z)); character.rotation.y = Math.PI - player.theta;
  blob.position.set(player.X, 0.01, -player.Z);
  // ゲート: 床の上のゲートに入ったら、別のシーンへ
  if (performance.now() > gateCooldownUntil) for (const g of SC.gates) if (inPoly(player.X, player.Z, g.poly)) { goScene(g); break; }
  // オクルージョン: キャラが物(親柱)の足元より奥(Zが大きい)で、横にも近いときだけ、写真の切り抜きを上に重ねる
  for (const o of occ) o.el.style.display = player.Z > o.anchor[1] - 0.05 && Math.abs(player.X - o.anchor[0]) < 1.1 ? "block" : "none";
  if (dbgOn) { const [px, py] = floorToImage(player.X, player.Z); const c = $("dbgPlayer"); if (c) { c.setAttribute("cx", px); c.setAttribute("cy", py); } }
  infoEl.textContent = `シーン ${curIdx + 1}/${SCENES.length}  位置 X ${player.X.toFixed(2)}m  Z ${player.Z.toFixed(2)}m\n向き ${(((player.theta * 180 / Math.PI) % 360) + 360) % 360 | 0}°${hold.run ? "  [走る]" : ""}`;
  renderer.render(world, camera);
  requestAnimationFrame(frame);
}
$("loading").style.display = "none";
window.__fc = { player, hold, get SC() { return SC; }, get curIdx() { return curIdx; }, SCENES, goScene, camera, isFree, tryMove, floorToImage, inPoly, occ, get dbgOn() { return dbgOn; } };
requestAnimationFrame(frame);
