// HIP DROP! ver.0.1 — ゲーム全体の進行(固定時間刻みループ・戦闘判定・UI)
import * as THREE from 'three';
import { PHYS, PLAYER as PC, CAMERA as CC } from './config.js';
import { Input } from './input.js';
import { Stage, SPAWN, ENEMY_SPAWNS, GOAL } from './stage.js';
import { Player } from './player.js';
import { Enemy } from './enemies.js';
import { Effects } from './effects.js';
import { ThirdPersonCamera } from './camera.js';

// ------------------------------------------------------------
//  レンダラ・シーン
// ------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 30, 75);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6a8f5a, 1.05));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
const sc = sun.shadow.camera;
sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 60;
scene.add(sun, sun.target);

const stage = new Stage(scene);
const player = new Player(scene);
const fx = new Effects(scene);
const tpc = new ThirdPersonCamera(camera);
const input = new Input(document.getElementById('touch'));
input.canHipFromPad = () => !player.grounded && player.state === 'normal';
input.canVerticalJump = () => player.isStopped();
let enemies = [];

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? CC.fovPortrait : CC.fovLandscape;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------
//  ゲーム状態
// ------------------------------------------------------------
const game = { mode: 'title', time: 0, defeated: 0, clearTime: 0 };
const ui = {
  hp: document.getElementById('hp'),
  enemy: document.getElementById('enemyCount'),
  timer: document.getElementById('timer'),
  overlay: document.getElementById('overlay'),
  ovTitle: document.getElementById('ovTitle'),
  ovText: document.getElementById('ovText'),
  ovBtn: document.getElementById('ovBtn'),
  toast: document.getElementById('toast'),
  hud: document.getElementById('hud'),
};

function startGame() {
  for (const e of enemies) scene.remove(e.group);
  enemies = ENEMY_SPAWNS.map((s) => new Enemy(scene, s));
  player.hp = PC.maxHp;
  player.reset(SPAWN);
  prevPlayerPos.copy(player.pos);
  tpc.snap(player.pos, player.yaw);
  game.mode = 'play';
  game.time = 0;
  game.defeated = 0;
  ui.overlay.classList.add('hidden');
  updateHud();
  toast({ release: '倒しきって離す=ジャンプ / 中心タップ=その場ジャンプ', dynamic: '移動中に出るボタンでジャンプ・空中で↓スワイプ!', gesture: 'スライドで移動・タップでジャンプ・空中で↓スワイプ!', center: 'パッド中央タップでジャンプ → 下へはらってヒップ!' }[input.layout] || 'ジャンプ中に ↓スワイプ で ヒップアタック!', 2.6);
}

function respawn() {
  player.reset(SPAWN);
  prevPlayerPos.copy(player.pos);
  player.invincible = 1.2;
  tpc.snap(player.pos, player.yaw);
}

function showOverlay(title, text, btn) {
  ui.ovTitle.innerHTML = title;
  ui.ovText.innerHTML = text;
  ui.ovBtn.textContent = btn;
  ui.overlay.classList.remove('hidden');
}

ui.ovBtn.addEventListener('click', () => {
  fx.unlockAudio();
  startGame();
});

let toastTimer = 0;
function toast(msg, sec = 1.4) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  toastTimer = sec;
}

function updateHud() {
  ui.hp.innerHTML = '<span class="heart">♥</span>'.repeat(Math.max(0, player.hp)) +
    '<span class="heart empty">♥</span>'.repeat(Math.max(0, PC.maxHp - player.hp));
  ui.enemy.textContent = `👾 ${game.defeated} / ${enemies.length}`;
}

// ------------------------------------------------------------
//  戦闘・ゴール判定(固定ステップごと)
// ------------------------------------------------------------
function combat() {
  const p = player.pos;
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = p.x - e.pos.x, dz = p.z - e.pos.z;
    const hd = Math.hypot(dx, dz);
    const touchR = player.radius + e.radius;
    if (hd > touchR) continue;
    // 縦方向の重なり
    const pBottom = p.y, pTop = p.y + player.height;
    const eBottom = e.pos.y, eTop = e.pos.y + e.height;
    if (pBottom > eTop || pTop < eBottom) continue;

    if (player.state === 'hipFall' || player.state === 'hipWindup') {
      // ヒップアタック命中!
      defeatEnemy(e, p.x, p.z, 1.2);
      player.bounceFromHit();
      fx.hitStop = 0.07;
      fx.addShake(0.35);
      fx.shockwave(e.pos.x, e.pos.y + 0.3, e.pos.z, 1.6, 0xffe066);
      fx.sound('hipImpact');
    } else if (player.vel.y < 0 && pBottom > eBottom + e.height * 0.55) {
      // 普通に上から踏んだ: トゲで倒せない。跳ね返るだけ(ダメージなし)
      player.smallBounce();
      e.squish = 1;
      fx.sound('bump');
      toast('トゲがあって踏めない! ヒップアタックで倒そう');
    } else if (player.hurt(e.pos.x, e.pos.z)) {
      fx.addShake(0.25);
      fx.sound('hurt');
      updateHud();
      if (player.hp <= 0) gameOver();
    }
  }
}

function defeatEnemy(e, fromX, fromZ, power) {
  e.kill(fromX, fromZ, power);
  game.defeated++;
  fx.burst(e.pos.x, e.pos.y + 0.4, e.pos.z, 0xc39bd3, 16);
  fx.sound('defeat');
  updateHud();
}

function handlePlayerEvents() {
  for (const ev of player.events) {
    switch (ev.type) {
      case 'jump': fx.sound('jump'); break;
      case 'superJump':
        fx.sound('superJump');
        fx.burst(player.pos.x, player.pos.y + 0.1, player.pos.z, 0xffffff, 10);
        break;
      case 'land':
        if (ev.speed > 6) { fx.sound('land'); fx.burst(player.pos.x, player.pos.y + 0.05, player.pos.z, 0xf3e3c3, 5); }
        break;
      case 'hipStart': fx.sound('hipStart'); break;
      case 'hipImpact': {
        fx.shockwave(ev.x, ev.y, ev.z, PC.shockRadius);
        fx.addShake(0.45);
        fx.hitStop = 0.04;
        fx.sound('hipImpact');
        // 衝撃波: 同じ高さの近くの敵を倒す
        for (const e of enemies) {
          if (!e.alive) continue;
          const d = Math.hypot(e.pos.x - ev.x, e.pos.z - ev.z);
          if (d < PC.shockRadius && Math.abs(e.pos.y - ev.y) < 0.6) defeatEnemy(e, ev.x, ev.z, 0.9);
        }
        break;
      }
    }
  }
}

function checkGoalAndFall() {
  const p = player.pos;
  if (Math.hypot(p.x - GOAL.x, p.z - GOAL.z) < GOAL.radius && Math.abs(p.y - GOAL.y) < 0.3) {
    stageClear();
    return;
  }
  if (p.y < PC.fallY) {
    player.hp--;
    fx.sound('hurt');
    updateHud();
    if (player.hp <= 0) gameOver();
    else { respawn(); toast('落ちた!'); }
  }
}

function stageClear() {
  game.mode = 'clear';
  game.clearTime = game.time;
  fx.sound('clear');
  fx.burst(player.pos.x, player.pos.y + 1, player.pos.z, 0xffe066, 30);
  setTimeout(() => {
    showOverlay('STAGE CLEAR!',
      `タイム <b>${game.time.toFixed(2)}</b> 秒<br>撃破 <b>${game.defeated} / ${enemies.length}</b>`,
      'もう一度');
  }, 900);
}

function gameOver() {
  game.mode = 'over';
  setTimeout(() => showOverlay('GAME OVER', 'ジャンプ中に下スワイプでヒップアタック!', 'リトライ'), 600);
}

// ------------------------------------------------------------
//  メインループ(固定時間刻み + 描画補間)
// ------------------------------------------------------------
const prevPlayerPos = new THREE.Vector3();
const renderPos = new THREE.Vector3();
let acc = 0;
let last = performance.now();
let elapsed = 0;

function tick(now) {
  requestAnimationFrame(tick);
  const frameDt = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += frameDt;

  // 入力(フレーム単位で受け取り、物理ステップへ渡す)
  if (input.consumeJump()) { player.pressJump(input.jumpKeepsMomentum, input.consumeJumpDir()); fx.unlockAudio(); }
  if (input.consumeStop()) player.stopNow();
  if (input.consumeHip()) player.pressHip();
  input.update(frameDt);
  const drag = input.consumeCamDrag();
  if (drag) tpc.addYaw(drag * CC.dragYawSpeed);

  // ヒットストップ中は時間を止める(手応え)
  let simDt = frameDt;
  if (fx.hitStop > 0) { fx.hitStop -= frameDt; simDt = 0; }

  if (game.mode === 'play' || game.mode === 'clear') {
    if (game.mode === 'play') game.time += simDt;
    acc += simDt;
    let n = 0;
    while (acc >= PHYS.dt && n < PHYS.maxSubSteps) {
      prevPlayerPos.copy(player.pos);
      const move = game.mode === 'play' ? input.getMove() : { x: 0, y: 0 };
      player.step(PHYS.dt, move, tpc.yaw, input.jumpHeld || input.fullJumpOnTap, stage);
      handlePlayerEvents();
      for (const e of enemies) e.step(PHYS.dt);
      if (game.mode === 'play') { combat(); checkGoalAndFall(); }
      acc -= PHYS.dt;
      n++;
    }
    if (n === PHYS.maxSubSteps) acc = 0;
  }

  const alpha = acc / PHYS.dt;
  renderPos.lerpVectors(prevPlayerPos, player.pos, alpha);
  player.render(frameDt, renderPos, elapsed);
  for (const e of enemies) e.render(alpha);
  stage.update(elapsed);
  fx.update(frameDt);

  tpc.update(frameDt, renderPos, player, fx.shake, stage);

  // 影用ライトはプレイヤーに追従
  sun.position.set(renderPos.x + 6, renderPos.y + 14, renderPos.z + 8);
  sun.target.position.copy(renderPos);

  if (game.mode === 'play') ui.timer.textContent = game.time.toFixed(1);
  if (toastTimer > 0) { toastTimer -= frameDt; if (toastTimer <= 0) ui.toast.classList.remove('show'); }

  renderer.render(scene, camera);
}

// タイトル画面
enemies = ENEMY_SPAWNS.map((s) => new Enemy(scene, s));
player.reset(SPAWN);
prevPlayerPos.copy(player.pos);
tpc.snap(player.pos, player.yaw);
updateHud();
function titleScreen() {
  const L = input.layout;
  const howto = {
    release:
      '<div><b>下のパッド</b> ドラッグで移動</div>' +
      '<div><b>パッドを最大まで倒して指を離す</b><br>→ その方向へジャンプ</div>' +
      '<div><b>途中で指を離す</b> → その場で止まる</div>' +
      '<div><b>止まっているときにパッドの中心をタップ</b><br>→ その場ジャンプ</div>' +
      '<div><b>ジャンプ中に下へスワイプ</b> → ヒップアタック!</div>',
    dynamic:
      '<div><b>下のパッド</b> ドラッグで移動</div>' +
      '<div><b>移動中だけ</b> 進む方向側に<br>ジャンプボタンが出る → タップでジャンプ</div>' +
      '<div><b>ジャンプ中に下へスワイプ</b><br>→ ヒップアタック!</div>' +
      '<div class="sub">パッドから親指を離しても、少しの間ボタンは<br>その場に残るので押しに行けます</div>',
    gesture:
      '<div><b>指をスライド</b> → 移動</div>' +
      '<div><b>短くタップ</b> → ジャンプ</div>' +
      '<div><b>ジャンプ中にすばやく下へスワイプ</b><br>→ ヒップアタック!</div>' +
      '<div class="sub">画面のどこでもOK・指1本で遊べます</div>',
    center:
      '<div><b>下のパッド</b> ドラッグで移動</div>' +
      '<div><b>パッドの真ん中</b> タップでジャンプ</div>' +
      '<div><b>ジャンプ中にパッドを下へはらう</b><br>→ ヒップアタック!</div>',
    classic:
      '<div><b>左下</b> ドラッグで移動</div>' +
      '<div><b>右下</b> タップでジャンプ</div>' +
      '<div><b>ジャンプ中に下スワイプ</b><br>→ ヒップアタック!</div>',
  }[L];
  const btn = (k, label) => `<button data-layout="${k}" class="${L === k ? 'sel' : ''}">${label}</button>`;
  showOverlay('HIP DROP!',
    '<div class="howto">' + howto +
    '<div class="sub">トゲの敵はヒップアタックでしか倒せない<br>旗のゴールを目指そう</div>' +
    '<div class="sub pc">PC: WASD移動 / Space ジャンプ / Shift ヒップアタック</div>' +
    '<div class="layoutSel">操作タイプ<br>' +
    btn('release', '離してジャンプ') + btn('dynamic', '動的ボタン') + btn('gesture', 'ジェスチャー') + btn('center', 'センターパッド') + btn('classic', '左パッド+ボタン') +
    '</div></div>',
    'スタート');
  ui.ovText.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => {
    input.setLayout(b.dataset.layout);
    titleScreen();
  }));
}
titleScreen();
requestAnimationFrame((t) => { last = t; tick(t); });

window.__hipdrop = { player, enemies: () => enemies, game, stage, tpc, input };
