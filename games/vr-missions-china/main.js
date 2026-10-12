import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

// 元: ver.html (VR MISSIONS 3D // SNEAKING)。プレイヤーを中華娘のモデルに、敵(歩哨)を中華娘に合わせて作り直した「護衛兵」のモデルにした。ゲームの中身(ステージ・視界・射撃・パンチ)はそのまま
const loadErr=e=>{ console.error(e); const h=document.getElementById("loadH"); if(h){ h.style.color="#ff2b2b"; h.textContent="LOAD ERROR"; document.getElementById("loadP").textContent="モデルの読み込みに失敗しました。通信環境をご確認のうえ再読み込みしてください。"; } };
let chinaBuf,guardBuf,walkJson,punchJson;
try{
  [chinaBuf,guardBuf,walkJson,punchJson]=await Promise.all([
    fetch("./assets/china_rigged.glb").then(r=>r.arrayBuffer()),
    fetch("./assets/guard_china_rigged.glb").then(r=>r.arrayBuffer()),
    fetch("./assets/walk.json").then(r=>r.json()),
    fetch("./assets/punch.json").then(r=>r.json()),
  ]);
}catch(e){ loadErr(e); throw e; }

//============================ LEVEL DATA ============================
const LEVELS = [
 { name:"01 // INFILTRATION",
   grid:[
    "##############","#S...........#","#............#","#....####....#","#....#..#....#",
    "#....#..#....#","#....####....#","#............#","#...........G#","##############",
   ],
   guards:[ {path:[[2.5,7.5],[11.5,7.5]], spd:1.8, range:5.0, fov:72, scan:0} ],
   ammo:3,
 },
 { name:"02 // TWIN WATCH",
   grid:[
    "################","#S......#......#","#.......#......#","#.......#......#","#.......#......#",
    "#..............#","#.......#......#","#.......#......#","#.......#......#","#.......#.....G#","################",
   ],
   guards:[ {path:[[4.0,1.5],[4.0,8.5]], spd:1.9, range:5.2, fov:70, scan:0},
            {path:[[11.0,8.5],[11.0,1.5]], spd:1.9, range:5.2, fov:70, scan:0} ],
   ammo:4,
 },
 { name:"03 // PILLAR FIELD",
   grid:[
    "################","#..............#","#..##....##....#","#..##....##....#","#.....##.......#",
    "#.....##.......#","#..##....##....#","#..##....##....#","#.....##.......#","#.....##......G#","#S.............#","################",
   ],
   guards:[ {path:[[1.5,1.5],[14.5,1.5]], spd:2.1, range:5.5, fov:74, scan:0.5},
            {path:[[5.5,2.0],[5.5,9.0]],  spd:1.8, range:5.0, fov:70, scan:0},
            {path:[[12.5,1.5],[12.5,9.5]],spd:2.0, range:5.2, fov:72, scan:0} ],
   ammo:6,
 },
];

//============================ THREE SETUP ============================
const cv=document.getElementById("cv"), stage=document.getElementById("stage");
const renderer=new THREE.WebGLRenderer({canvas:cv, antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.setClearColor(0x010402,1);
const scene=new THREE.Scene();
scene.fog=new THREE.FogExp2(0x010703,0.04);
// キャラクター(textureつきGLB)用の明かり。ワイヤーフレームの背景は明かりの影響を受けない
scene.add(new THREE.HemisphereLight(0xcfffe0,0x1a3322,1.7));
const sun=new THREE.DirectionalLight(0xffffff,2.0); sun.position.set(3,6,4); scene.add(sun);
const camera=new THREE.PerspectiveCamera(55,1,0.1,200);
let VW=0,VH=0;
function resize(){
  const r=stage.getBoundingClientRect(); VW=r.width; VH=r.height;
  renderer.setSize(VW,VH,false);
  camera.aspect=VW/VH; camera.updateProjectionMatrix();
  layoutMirror();
}
window.addEventListener("resize",resize);

//============================ REAR MIRROR (first-person, rear-facing) ============================
const mirrorCanvas=document.getElementById("mirror"), mirrorWrap=document.getElementById("mirrorWrap");
let mirrorRenderer=null, mirrorCam=null, mirrorReady=false;
try{
  mirrorRenderer=new THREE.WebGLRenderer({canvas:mirrorCanvas, antialias:true});
  mirrorRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  mirrorRenderer.setClearColor(0x010402,1);
  mirrorCam=new THREE.PerspectiveCamera(72,3,0.05,200);
  mirrorReady=true;
}catch(e){ mirrorReady=false; if(mirrorWrap) mirrorWrap.style.display="none"; }
function layoutMirror(){
  if(!mirrorReady) return;
  const Wp=Math.min(VW*0.58,250), Hp=Math.max(46,Math.round(Wp*0.30));
  mirrorCanvas.style.width=Wp+"px"; mirrorCanvas.style.height=Hp+"px";
  mirrorRenderer.setSize(Wp,Hp,false);
  mirrorCam.aspect=Wp/Hp; mirrorCam.updateProjectionMatrix();
}
function renderMirror(){
  if(!mirrorReady||!root) return;
  mirrorCam.position.set(player.x,1.5,player.y);
  mirrorCam.lookAt(player.x-Math.sin(heading)*3, 1.15, player.y-Math.cos(heading)*3);
  const prevVis=playerFig.group.visible;
  playerFig.group.visible=false;
  mirrorRenderer.render(scene,mirrorCam);
  playerFig.group.visible=prevVis;
}

//============================ GAME STATE ============================
let stateName="title", li=0;
let G=null, COLS=0, ROWS=0;
let player={x:0,y:0,r:0.30}, goal={x:0,y:0};
let guards=[];
let input={x:0,y:0};
let alertMeter=0, timeMs=0, lastT=0;
let best=[null,null,null], totalMs=0;
const PSPD=3.6, STICK_DEAD=0.12; // 歩く速さ / スティックの遊び(これ以下は動かない)
// weapon
const HIT_RADIUS=0.4, MAX_RANGE=22, FIRE_COOLDOWN=0.35, NOISE_ALERT=0.16, FLASH_TIME=0.08, GUARD_HEIGHT=1.5;
let ammo=0, fireCooldown=0, flashT=0;
let tracers=[];
// melee
const PUNCH_RANGE=1.1, PUNCH_ANGLE=Math.PI/3, PUNCH_COOLDOWN=0.45, PUNCH_ANIM_TIME=0.25;
let punchCooldown=0, punchT=0;
let impacts=[];
// 視点: 三人称のみ(自機の全身が常に見える)。カメラは、自機が向いている方向の後ろから肩越しについてくる(前方も見渡せる)
//  操作は片手のスティックだけ: 左右 = 旋回 / 上下 = 前進・後退。heading = 自機の向き(FIRE/PUNCH は、この向きの敵を自動で狙う)
let heading=0, curSpeed=0, moving=false, moveSign=1, camYaw=0;
const TURN_SPEED=2.2, BACK_SCALE=0.6; // 旋回の速さ(ラジアン/秒) / 後退の速さの倍率
// カメラの設定(すべてここ。自機の位置・移動には影響しない): back = 自機の後ろへ(m) / up = カメラの高さ(m) / shoulder = 右肩のほうへずらす(m。0 = 自機が画面の左右中央) / pitch = 下向きの角度(ラジアン。大きいほど下を向く) / follow = 向きへの追従の速さ
const CAM={back:3.6, up:3.2, shoulder:0, pitch:0.53, follow:9};
const WALL_H=2.0, EYE_H=0.9;
const desired=new THREE.Vector3(), lookAt=new THREE.Vector3();
// カメラを置く: 自機の後ろ・上・右肩側。向きは自機の向きについてくる。壁は半透明なので、壁の中・外にカメラがあっても自機は見える
function placeCamera(dt,snap){
  if(snap) camYaw=heading; else camYaw+=angDiff(heading,camYaw)*Math.min(1,dt*CAM.follow);
  const fx=Math.sin(camYaw), fz=Math.cos(camYaw), rx=-Math.cos(camYaw), rz=Math.sin(camYaw);
  camera.position.set(player.x-fx*CAM.back+rx*CAM.shoulder, CAM.up, player.y-fz*CAM.back+rz*CAM.shoulder); // 位置は自機にぴったり(向きだけ、なめらかに追従)
  const c=Math.cos(CAM.pitch), sn=Math.sin(CAM.pitch);
  lookAt.set(camera.position.x+fx*c*10, camera.position.y-sn*10, camera.position.z+fz*c*10); // 注視点: カメラの向き(自機の向き)へ、pitch だけ下向き
  camera.lookAt(lookAt);
}


function isWall(cx,cy){ if(cx<0||cy<0||cx>=COLS||cy>=ROWS) return true; return G[cy][cx]==="#"; }


//============================ SCENE BUILD ============================
let root=null, playerFig=null, guardFigs=[], guardCones=[], guardMarks=[], goalObj=null;
function disposeObj(o){ o.traverse(n=>{ if(n.geometry)n.geometry.dispose();
  if(n.material){ Array.isArray(n.material)?n.material.forEach(m=>m.dispose()):n.material.dispose(); } }); }

// ---- キャラクター: 中華娘(プレイヤー) / 護衛兵(敵) のスキン付きGLB。同じ骨格なので、同じモーション(walk.json など)を使える
const CHAR_SCALE=0.82; // 通路の幅(1マス=1m)に合わせて、少し小さく
const REST_KEYS=(()=>{ const k=walkJson.keyframes.find(k=>k.frame===7)||walkJson.keyframes[0]; return k; })(); // 立ち姿: 歩きの「両足がそろう」姿勢
const toQuats=pose=>{ const o={}; for(const n of Object.keys(pose)) o[n]=new THREE.Quaternion(...pose[n]); return o; };
const IDLE_POSE=toQuats(REST_KEYS.pose), IDLE_Y=(REST_KEYS.modelPosition||[0,0,0])[1];
const walkDur=walkJson.keyframes[walkJson.keyframes.length-1].time||1, walkStride=walkJson.strideLengthPerCycle||0.9;
const PUNCH_BONES=["Spine","Chest","Neck","Head","LeftShoulder","LeftUpperArm","LeftForearm","LeftHand","RightShoulder","RightUpperArm","RightForearm","RightHand"]; // パンチは上半身だけ(足は歩き/立ちのまま)
const _qa=new THREE.Quaternion(), _qb=new THREE.Quaternion();
function sampleClip(clip,t,loop){
  const keys=clip.keyframes, end=keys[keys.length-1].time||1; let tt=loop?((t%end)+end)%end:Math.max(0,Math.min(end,t));
  let i=0; while(i<keys.length-2&&keys[i+1].time<=tt) i++;
  const A=keys[i],B=keys[i+1],span=B.time-A.time,f=span>0?(tt-A.time)/span:0, pose={};
  for(const n of Object.keys(A.pose)) pose[n]=new THREE.Quaternion(...A.pose[n]).slerp(_qa.set(...B.pose[n]),f);
  const ay=(A.modelPosition||[0,0,0])[1], by=(B.modelPosition||[0,0,0])[1];
  return {pose,y:ay+(by-ay)*f};
}
const gltfLoader=new GLTFLoader();
async function makeModel(buf,flat){
  const g=await gltfLoader.parseAsync(buf.slice(0),"./assets/"), model=g.scene, bones={};
  model.traverse(o=>{ if(o.isBone) bones[o.name]=o; if(o.isMesh){ o.frustumCulled=false; if(flat&&o.material){ o.material.flatShading=true; o.material.needsUpdate=true; } } });
  const group=new THREE.Group(); group.rotation.order="YXZ"; group.scale.setScalar(CHAR_SCALE); group.add(model);
  return {group,model,bones,mark:null};
}
// 姿勢: 立ち姿 ⇄ 歩き(cycles=歩数, amp=歩きの強さ0〜1)。punch>=0 のとき、パンチ(0〜1の進み具合)を上半身に重ねる
function poseFig(f,cycles,amp,punch){
  const w=sampleClip(walkJson,cycles*walkDur,true), pc=punch>=0?sampleClip(punchJson,punch*punchJson.keyframes[punchJson.keyframes.length-1].time,false):null;
  const pw=pc?Math.min(1,Math.sin(punch*Math.PI)*2.2):0;
  for(const n of Object.keys(w.pose)){
    const b=f.bones[n]; if(!b) continue;
    b.quaternion.copy(IDLE_POSE[n]||w.pose[n]).slerp(w.pose[n],amp);
    if(pc&&pw>0&&PUNCH_BONES.includes(n)&&pc.pose[n]) b.quaternion.slerp(pc.pose[n],pw);
  }
  f.model.position.y=IDLE_Y+(w.y-IDLE_Y)*amp;
}
function makeCone(N){
  const verts=new Float32Array((N+2)*3);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.BufferAttribute(verts,3));
  const idx=[]; for(let i=1;i<=N;i++) idx.push(0,i,i+1); geo.setIndex(idx);
  const mat=new THREE.MeshBasicMaterial({color:0xff5a5a,transparent:true,opacity:0.2,side:THREE.DoubleSide,depthWrite:false});
  const mesh=new THREE.Mesh(geo,mat); mesh.frustumCulled=false; mesh.renderOrder=2; mesh.userData={verts,N};
  return mesh;
}
function updateCone(mesh,g,now){
  const v=mesh.userData.verts, N=mesh.userData.N, va=visionAngle(g,now);
  v[0]=g.x; v[1]=0.05; v[2]=g.y;
  const a0=va-g.fov/2, a1=va+g.fov/2;
  for(let i=0;i<=N;i++){ const a=a0+(a1-a0)*i/N; let rr=g.range;
    for(let d=0.2; d<g.range; d+=0.2){ if(isWall(Math.floor(g.x+Math.cos(a)*d),Math.floor(g.y+Math.sin(a)*d))){rr=d;break;} }
    const k=(i+1)*3; v[k]=g.x+Math.cos(a)*rr; v[k+1]=0.05; v[k+2]=g.y+Math.sin(a)*rr;
  }
  mesh.geometry.attributes.position.needsUpdate=true;
}
function makeMark(){
  const c=document.createElement("canvas"); c.width=c.height=64;
  const x=c.getContext("2d"); x.fillStyle="#ff2b2b"; x.font="bold 56px monospace";
  x.textAlign="center"; x.textBaseline="middle"; x.fillText("!",32,36);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true}));
  sp.scale.set(0.55/CHAR_SCALE,0.55/CHAR_SCALE,0.55/CHAR_SCALE); sp.position.y=1.75/CHAR_SCALE+0.1; sp.visible=false; return sp;
}
function makeGoal(){
  const grp=new THREE.Group();
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,2.2,12,1,true),
    new THREE.MeshBasicMaterial({color:0x39ff14,transparent:true,opacity:0.5,side:THREE.DoubleSide}));
  beam.position.y=1.1; grp.add(beam);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(0.45,0.03,6,24),new THREE.MeshBasicMaterial({color:0x39ff14}));
  ring.rotation.x=Math.PI/2; ring.position.y=0.05; grp.add(ring);
  grp.userData.ring=ring; return grp;
}

// ---- モデルを作る(プレイヤー1 + 護衛兵 最大3)。ステージを作り直しても使い回す
let playerModel=null; const guardPool=[];
try{
  playerModel=await makeModel(chinaBuf,false);
  for(let i=0;i<3;i++){ const f=await makeModel(guardBuf,true); f.mark=makeMark(); f.group.add(f.mark); guardPool.push(f); }
}catch(e){ loadErr(e); throw e; }
function buildFloor(parent){
  const pos=[];
  for(let x=0;x<=COLS;x++) pos.push(x,0,0, x,0,ROWS);
  for(let y=0;y<=ROWS;y++) pos.push(0,0,y, COLS,0,y);
  const gg=new THREE.BufferGeometry(); gg.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  parent.add(new THREE.LineSegments(gg,new THREE.LineBasicMaterial({color:0x1faa3a,transparent:true,opacity:0.28})));
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(COLS,ROWS),new THREE.MeshBasicMaterial({color:0x010503}));
  plane.rotation.x=-Math.PI/2; plane.position.set(COLS/2,-0.02,ROWS/2); parent.add(plane);
}
function buildWalls(parent){
  const H=2.0;
  const cells=[];
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) if(G[y][x]==="#") cells.push([x,y]);
  const inst=new THREE.InstancedMesh(new THREE.BoxGeometry(1,H,1),
    new THREE.MeshBasicMaterial({color:0x0a3318,transparent:true,opacity:0.42,depthWrite:false}), cells.length); // 半透明: 壁ごしでも自機が見える
  inst.renderOrder=1;
  const m=new THREE.Matrix4();
  cells.forEach((c,i)=>{ m.makeTranslation(c[0]+0.5,H/2,c[1]+0.5); inst.setMatrixAt(i,m); });
  inst.instanceMatrix.needsUpdate=true; parent.add(inst);
  const pos=[]; const E=(a,b,c,d,e,f)=>pos.push(a,b,c,d,e,f);
  cells.forEach(c=>{ const x=c[0],z=c[1],X=x+1,Z=z+1,y0=0,y1=H;
    E(x,y0,z,X,y0,z);E(X,y0,z,X,y0,Z);E(X,y0,Z,x,y0,Z);E(x,y0,Z,x,y0,z);
    E(x,y1,z,X,y1,z);E(X,y1,z,X,y1,Z);E(X,y1,Z,x,y1,Z);E(x,y1,Z,x,y1,z);
    E(x,y0,z,x,y1,z);E(X,y0,z,X,y1,z);E(X,y0,Z,X,y1,Z);E(x,y0,Z,x,y1,Z); });
  const eg=new THREE.BufferGeometry(); eg.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  parent.add(new THREE.LineSegments(eg,new THREE.LineBasicMaterial({color:0x39ff14,transparent:true,opacity:0.55})));
}
function buildScene(){
  if(root){ if(playerFig) root.remove(playerFig.group); guardFigs.forEach(f=>root.remove(f.group)); scene.remove(root); disposeObj(root); } // キャラはプールで使い回すので、disposeしない
  root=new THREE.Group(); scene.add(root);
  buildFloor(root); buildWalls(root);
  goalObj=makeGoal(); goalObj.position.set(goal.x,0,goal.y); root.add(goalObj);
  playerFig=playerModel; playerFig.group.rotation.x=0; playerFig.group.position.y=0; root.add(playerFig.group);
  guardFigs=[]; guardCones=[]; guardMarks=[];
  guards.forEach(g=>{
    const f=guardPool[guardFigs.length]; f.group.rotation.set(0,0,0); f.group.position.y=0; root.add(f.group); guardFigs.push(f);
    const cone=makeCone(18); root.add(cone); guardCones.push(cone);
    const mk=f.mark; mk.visible=false; guardMarks.push(mk);
  });
}

//============================ LOAD LEVEL ============================
function loadLevel(i){
  const L=LEVELS[i];
  G=L.grid.map(r=>r.replace("S",".").replace("G","."));
  ROWS=L.grid.length; COLS=L.grid[0].length;
  L.grid.forEach((row,y)=>{ for(let x=0;x<row.length;x++){
    if(row[x]==="S"){player.x=x+0.5;player.y=y+0.5;}
    if(row[x]==="G"){goal.x=x+0.5;goal.y=y+0.5;}
  }});
  guards=L.guards.map(g=>({ path:g.path, seg:0, t:0, spd:g.spd, range:g.range,
    fov:g.fov*Math.PI/180, scan:g.scan||0, x:g.path[0][0], y:g.path[0][1], ang:0, sees:false, phase:Math.random()*6,
    dead:false, fallT:0 }));
  alertMeter=0; timeMs=0; input.x=0; input.y=0;
  ammo=L.ammo||4; fireCooldown=0; flashT=0;
  tracers.forEach(tr=>{ scene.remove(tr.line); tr.line.geometry.dispose(); tr.line.material.dispose(); });
  tracers=[];
  punchCooldown=0; punchT=0;
  impacts.forEach(im=>{ scene.remove(im.mesh); im.mesh.geometry.dispose(); im.mesh.material.dispose(); });
  impacts=[];
  heading=0; curSpeed=0; moving=false; moveSign=1;
  document.getElementById("mTag").textContent="MISSION "+L.name.slice(0,2);
  buildScene(); layoutMirror();
  placeCamera(0,true);
}

//============================ COLLISION ============================
function resolve(p){
  for(let it=0;it<3;it++){
    const minX=Math.floor(p.x-p.r),maxX=Math.floor(p.x+p.r),minY=Math.floor(p.y-p.r),maxY=Math.floor(p.y+p.r);
    let hit=false;
    for(let cy=minY;cy<=maxY;cy++) for(let cx=minX;cx<=maxX;cx++){
      if(!isWall(cx,cy)) continue;
      const nx=Math.max(cx,Math.min(p.x,cx+1)), ny=Math.max(cy,Math.min(p.y,cy+1));
      let dx=p.x-nx, dy=p.y-ny, d=Math.hypot(dx,dy);
      if(d<p.r){
        if(d===0){ const ox=p.x-(cx+0.5),oy=p.y-(cy+0.5);
          if(Math.abs(ox)>Math.abs(oy)) p.x+=(ox>0?1:-1)*p.r; else p.y+=(oy>0?1:-1)*p.r; }
        else { const push=p.r-d; p.x+=dx/d*push; p.y+=dy/d*push; }
        hit=true;
      }
    }
    if(!hit) break;
  }
}

//============================ VISION ============================
function angDiff(a,b){ let d=a-b; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI; return d; }
function lineBlocked(x0,y0,x1,y1){
  const dx=x1-x0,dy=y1-y0,dist=Math.hypot(dx,dy),steps=Math.ceil(dist/0.12);
  for(let i=1;i<steps;i++){ const t=i/steps; if(isWall(Math.floor(x0+dx*t),Math.floor(y0+dy*t))) return true; }
  return false;
}
function visionAngle(g,now){ return g.ang + (g.scan? Math.sin(now*0.0016)*g.scan : 0); }

//============================ UPDATE ============================
function update(dt,now){
  // 移動: スティックの左右 = 旋回(右へ倒すと右へ向きを変える) / 上下 = 前進・後退。カメラは自機の向きについてくる
  let fwd = usingStick ? -Math.max(-1,Math.min(1,input.y)) : ((keys.u?1:0)-(keys.d?1:0));
  let trn = usingStick ?  Math.max(-1,Math.min(1,input.x)) : ((keys.sr||keys.tr?1:0)-(keys.sl||keys.tl?1:0));
  if(Math.abs(fwd)<STICK_DEAD) fwd=0; if(Math.abs(trn)<STICK_DEAD) trn=0;
  heading-=trn*TURN_SPEED*dt; // headingが増える = 左へ向く(右 = -X方向)なので、右へ倒すと減らす
  const sp=fwd>0?fwd:fwd*BACK_SCALE;
  player.x+=Math.sin(heading)*sp*PSPD*dt; player.y+=Math.cos(heading)*sp*PSPD*dt; resolve(player);
  curSpeed=Math.abs(sp); moving=curSpeed>0.06||Math.abs(trn)>0;
  if(Math.abs(trn)>0&&curSpeed<0.3) curSpeed=0.3; // その場で旋回するときも、足を少し動かす(歩く距離には入れない)
  if(Math.abs(fwd)>0.05) moveSign=fwd<0?-1:1;
  if(fireCooldown>0) fireCooldown=Math.max(0,fireCooldown-dt);
  if(flashT>0) flashT=Math.max(0,flashT-dt);
  if(punchCooldown>0) punchCooldown=Math.max(0,punchCooldown-dt);
  if(punchT>0) punchT=Math.max(0,punchT-dt/PUNCH_ANIM_TIME);

  // guards
  guards.forEach(g=>{
    if(g.dead){ g.fallT=Math.min(1,g.fallT+dt*3); g.sees=false; return; }
    const a=g.path[g.seg], b=g.path[(g.seg+1)%g.path.length];
    const len=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
    g.t+=g.spd*dt/len; if(g.t>=1){ g.t-=1; g.seg=(g.seg+1)%g.path.length; }
    const a2=g.path[g.seg], b2=g.path[(g.seg+1)%g.path.length];
    const ddx=b2[0]-a2[0], ddy=b2[1]-a2[1];
    g.x=a2[0]+ddx*g.t; g.y=a2[1]+ddy*g.t;
    g.ang+=angDiff(Math.atan2(ddy,ddx),g.ang)*Math.min(1,dt*8);
  });

  // detection
  let detRate=0;
  guards.forEach(g=>{
    if(g.dead) return;
    g.sees=false;
    const dx=player.x-g.x, dy=player.y-g.y, dist=Math.hypot(dx,dy);
    if(dist<=g.range && Math.abs(angDiff(Math.atan2(dy,dx),visionAngle(g,now)))<=g.fov/2){
      if(!lineBlocked(g.x,g.y,player.x,player.y)){ g.sees=true; detRate=Math.max(detRate,0.55+(1-dist/g.range)*0.75); }
    }
  });
  if(detRate>0) alertMeter=Math.min(1,alertMeter+detRate*dt);
  else alertMeter=Math.max(0,alertMeter-0.7*dt);
  if(alertMeter>=1){ fail(); return; }

  timeMs+=dt*1000;
  if(Math.hypot(player.x-goal.x,player.y-goal.y)<0.55) clear();
}

//============================ WEAPON ============================
// FIRE: 自機の向きの前方(±AUTO_AIM_ANGLE)にいる、いちばん近い敵を自動で狙う。壁ごしには狙わない。いなければ、まっすぐ前へ撃つ
const AUTO_AIM_ANGLE=Math.PI/4;
function fire(){
  if(stateName!=="play") return;
  if(ammo<=0 || fireCooldown>0) return;
  ammo--; fireCooldown=FIRE_COOLDOWN; flashT=FLASH_TIME;
  let tgt=null, td=Infinity;
  guards.forEach(g=>{
    if(g.dead) return;
    const gx=g.x-player.x, gz=g.y-player.y, dist=Math.hypot(gx,gz);
    if(dist>MAX_RANGE||dist>=td) return;
    if(Math.abs(angDiff(Math.atan2(gx,gz),heading))>AUTO_AIM_ANGLE) return;
    if(lineBlocked(player.x,player.y,g.x,g.y)) return;
    tgt=g; td=dist;
  });
  if(tgt) heading=Math.atan2(tgt.x-player.x,tgt.y-player.y); // 敵のほうを向く
  const dx=Math.sin(heading), dy=0, dz=Math.cos(heading);
  let travelled=MAX_RANGE, hitGuard=null;
  const step=0.05;
  outer:
  for(let d=step; d<=MAX_RANGE; d+=step){
    const x=player.x+dx*d, y=EYE_H+dy*d, z=player.y+dz*d;
    if(isWall(Math.floor(x),Math.floor(z))){ travelled=d; break; }
    for(const g of guards){
      if(g.dead) continue;
      if(y<=GUARD_HEIGHT && Math.hypot(g.x-x,g.y-z)<=HIT_RADIUS){ hitGuard=g; travelled=d; break outer; }
    }
  }
  if(hitGuard){ hitGuard.dead=true; hitGuard.fallT=0; }
  alertMeter=Math.min(1,alertMeter+NOISE_ALERT);
  spawnTracer(dx,dy,dz,travelled);
}
function spawnTracer(dx,dy,dz,dist){
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.Float32BufferAttribute(
    [player.x+dx*0.35, EYE_H+dy*0.35, player.y+dz*0.35, player.x+dx*dist, EYE_H+dy*dist, player.y+dz*dist], 3));
  const mat=new THREE.LineBasicMaterial({color:0xfff2a0,transparent:true,opacity:1});
  const line=new THREE.Line(geo,mat);
  scene.add(line);
  tracers.push({line,life:0.09,maxLife:0.09});
}

//============================ MELEE ============================
function punch(){
  if(stateName!=="play"||punchCooldown>0) return;
  punchCooldown=PUNCH_COOLDOWN; punchT=1;
  let hitGuard=null, hitDist=Infinity;
  guards.forEach(g=>{ // 近くの敵(向きは問わない。壁ごしは不可)。いちばん近い敵のほうを自動で向く
    if(g.dead) return;
    const gx=g.x-player.x, gz=g.y-player.y, dist=Math.hypot(gx,gz);
    if(dist>PUNCH_RANGE) return;
    if(lineBlocked(player.x,player.y,g.x,g.y)) return;
    if(dist<hitDist){ hitDist=dist; hitGuard=g; }
  });
  if(hitGuard){ heading=Math.atan2(hitGuard.x-player.x,hitGuard.y-player.y); hitGuard.dead=true; hitGuard.fallT=0; spawnImpact(hitGuard.x,hitGuard.y); }
  // 無音で倒す: 警報は上がらない
}
function makeImpactBurst(){
  const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
    [0.7,0.7,0],[-0.7,-0.7,0],[0.7,-0.7,0],[-0.7,0.7,0],[0.7,0,0.7],[-0.7,0,-0.7]];
  const pos=[];
  dirs.forEach(d=>pos.push(0,0,0, d[0]*0.4,d[1]*0.4,d[2]*0.4));
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  const mat=new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:1});
  return new THREE.LineSegments(geo,mat);
}
function spawnImpact(x,y){
  const mesh=makeImpactBurst();
  mesh.position.set(x,1.0,y);
  scene.add(mesh);
  impacts.push({mesh,life:0.26,maxLife:0.26});
}

//============================ RENDER ============================
let playerPhase=0, ampEase=0;
function render3D(now,dt){
  // player figure
  playerFig.group.position.set(player.x,0,player.y);
  playerFig.group.rotation.y=heading;
  playerFig.group.visible=true; // 三人称のみ: 自機はいつも見える
  ampEase+=((moving?1:0)-ampEase)*Math.min(1,dt*8);
  playerPhase+=moveSign*curSpeed*PSPD*dt/walkStride; poseFig(playerFig,playerPhase,ampEase,punchT>0?1-punchT:-1);
  // guards
  guards.forEach((g,i)=>{
    const f=guardFigs[i]; f.group.position.set(g.x,0,g.y);
    const cone=guardCones[i];
    if(g.dead){
      const e=1-Math.pow(1-g.fallT,3); // ease-out
      f.group.rotation.y=Math.PI/2-g.ang;
      f.group.rotation.x=e*(Math.PI/2); // 前へ倒れる(うつぶせ)
      f.group.position.y=e*0.13;
      poseFig(f,0,0,-1);
      cone.visible=false; guardMarks[i].visible=false;
      return;
    }
    f.group.rotation.x=0;
    f.group.rotation.y=Math.PI/2-g.ang;
    g.phase+=g.spd*dt/walkStride; poseFig(f,g.phase,1,-1);
    cone.visible=true; updateCone(cone,g,now);
    const col=g.sees?0xff2b2b:(alertMeter>0.02?0xffb300:0xff5a5a);
    cone.material.color.setHex(col); cone.material.opacity=g.sees?0.34:0.2;
    guardMarks[i].visible=g.sees;
  });
  // tracers (brief muzzle-to-impact flash lines)
  for(let i=tracers.length-1;i>=0;i--){
    const tr=tracers[i]; tr.life-=dt;
    if(tr.life<=0){ scene.remove(tr.line); tr.line.geometry.dispose(); tr.line.material.dispose(); tracers.splice(i,1); continue; }
    tr.line.material.opacity=Math.max(0,tr.life/tr.maxLife);
  }
  // melee impact bursts (brief expanding flash on a successful punch)
  for(let i=impacts.length-1;i>=0;i--){
    const im=impacts[i]; im.life-=dt;
    if(im.life<=0){ scene.remove(im.mesh); im.mesh.geometry.dispose(); im.mesh.material.dispose(); impacts.splice(i,1); continue; }
    const t=1-im.life/im.maxLife;
    im.mesh.scale.setScalar(0.5+t*1.6);
    im.mesh.material.opacity=Math.max(0,1-t);
  }
  // goal
  goalObj.userData.ring.rotation.z+=dt*1.5;
  const p=0.5+0.5*Math.sin(now*0.004); goalObj.scale.setScalar(1+p*0.06);
  placeCamera(dt,false); // カメラ: 自機の向きに合わせて、肩越しについてくる
  renderer.render(scene,camera);
}

//============================ LOOP ============================
function frame(now){
  if(!lastT) lastT=now;
  let dt=(now-lastT)/1000; lastT=now; if(dt>0.05) dt=0.05;
  if(stateName==="play") update(dt,now);
  if(root) render3D(now,dt);
  renderMirror();
  document.getElementById("timer").textContent=fmt(timeMs);
  const ammoEl=document.getElementById("ammoTxt");
  ammoEl.textContent="AMMO "+ammo;
  ammoEl.style.color = ammo>0 ? "#ffb300" : "#5a4520";
  document.getElementById("muzzleFlash").style.opacity = flashT>0 ? (flashT/FLASH_TIME)*0.35 : 0;
  const af=document.getElementById("alertFill"), at=document.getElementById("alertTxt");
  af.style.width=(alertMeter*100)+"%";
  if(alertMeter>=0.66){ af.style.background="#ff2b2b"; at.textContent="ALERT"; at.style.color="#ff2b2b"; }
  else if(alertMeter>0.02){ af.style.background="#ffb300"; at.textContent="CAUTION"; at.style.color="#ffb300"; }
  else { af.style.background="#39ff14"; at.textContent="CLEAR"; at.style.color="#39ff14"; }
  requestAnimationFrame(frame);
}
function fmt(ms){ const t=Math.max(0,ms)/1000, m=Math.floor(t/60), s=Math.floor(t%60), d=Math.floor((t*10)%10);
  return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")+"."+d; }

//============================ FLOW ============================
function show(id){ document.querySelectorAll(".ov").forEach(o=>o.classList.remove("show")); if(id) document.getElementById(id).classList.add("show"); }
function startGame(){ const hn=document.getElementById("hint"); hn.style.opacity=1; clearTimeout(startGame.t); startGame.t=setTimeout(()=>{ hn.style.opacity=0; },7000); li=0; totalMs=0; loadLevel(0); stateName="play"; show(null); }
function clear(){
  stateName="clear"; totalMs+=timeMs;
  if(best[li]==null||timeMs<best[li]) best[li]=timeMs;
  document.getElementById("clearTime").textContent=fmt(timeMs);
  document.getElementById("bestTime").textContent=fmt(best[li]);
  document.getElementById("nextBtn").textContent=(li>=LEVELS.length-1)?"FINISH":"NEXT";
  show("ovClear");
}
function fail(){ stateName="fail"; show("ovFail"); }
function nextLevel(){
  if(li>=LEVELS.length-1){ document.getElementById("totalTime").textContent=fmt(totalMs); stateName="all"; show("ovAll"); return; }
  li++; loadLevel(li); stateName="play"; show(null);
}
function retry(){ loadLevel(li); stateName="play"; show(null); }
document.getElementById("startBtn").onclick=startGame;
document.getElementById("nextBtn").onclick=nextLevel;
document.getElementById("retryClearBtn").onclick=retry;
document.getElementById("retryBtn").onclick=retry;
document.getElementById("againBtn").onclick=startGame;

//============================ INPUT: keyboard ============================
const keys={};
const KMAP={ArrowUp:"u",ArrowDown:"d",ArrowLeft:"sl",ArrowRight:"sr",
  w:"u",s:"d",a:"sl",d:"sr",W:"u",S:"d",A:"sl",D:"sr",q:"tl",e:"tr",Q:"tl",E:"tr"};
window.addEventListener("keydown",e=>{ if(KMAP[e.key]){keys[KMAP[e.key]]=1;e.preventDefault();}
  if(e.key==="Enter"&&stateName==="title") startGame();
  if(e.code==="Space"){ e.preventDefault(); fire(); }
  if(e.key==="f"||e.key==="F"){ e.preventDefault(); punch(); } });
window.addEventListener("keyup",e=>{ if(KMAP[e.key]) keys[KMAP[e.key]]=0; });

//============================ INPUT: fire / punch buttons ============================
const fireBtn=document.getElementById("fireBtn");
function fireBtnHandler(e){ e.preventDefault(); e.stopPropagation(); fire(); }
fireBtn.addEventListener("touchstart",fireBtnHandler,{passive:false});
fireBtn.addEventListener("mousedown",fireBtnHandler);

const punchBtn=document.getElementById("punchBtn");
function punchBtnHandler(e){ e.preventDefault(); e.stopPropagation(); punch(); }
punchBtn.addEventListener("touchstart",punchBtnHandler,{passive:false});
punchBtn.addEventListener("mousedown",punchBtnHandler);

//============================ INPUT: joystick ============================
const stick=document.getElementById("stick"), nub=document.getElementById("nub");
let stId=null, usingStick=false, sc={x:0,y:0}; const SR=52;
function stickStart(e){ const t=e.changedTouches?e.changedTouches[0]:e; stId=t.identifier??"m";
  const r=stick.getBoundingClientRect(); sc.x=r.left+r.width/2; sc.y=r.top+r.height/2; usingStick=true; stickMove(e); }
function stickMove(e){ if(!usingStick) return; let t;
  if(e.changedTouches){ for(const c of e.changedTouches) if((c.identifier??"m")===stId){t=c;break;} if(!t) return; } else t=e;
  let dx=t.clientX-sc.x, dy=t.clientY-sc.y, d=Math.hypot(dx,dy);
  if(d>SR){ dx=dx/d*SR; dy=dy/d*SR; }
  nub.style.transform="translate("+dx+"px,"+dy+"px)"; input.x=dx/SR; input.y=dy/SR; }
function stickEnd(){ usingStick=false; stId=null; input.x=0; input.y=0; nub.style.transform="translate(0,0)"; }
stick.addEventListener("touchstart",e=>{e.preventDefault();stickStart(e);},{passive:false});
stick.addEventListener("touchmove",e=>{e.preventDefault();stickMove(e);},{passive:false});
stick.addEventListener("touchend",e=>{e.preventDefault();stickEnd();},{passive:false});
stick.addEventListener("touchcancel",stickEnd);
stick.addEventListener("mousedown",stickStart);
window.addEventListener("mousemove",e=>{ if(usingStick&&stId==="m") stickMove(e); });
window.addEventListener("mouseup",()=>{ if(stId==="m") stickEnd(); });

//============================ BOOT ============================
resize();
requestAnimationFrame(frame);
show("ovTitle");
window.__vm={ CAM, camera,  get player(){return player;}, get guards(){return guards;}, setHeading:h=>{heading=h;}, heading:()=>heading, punch, fire, startGame, get state(){return stateName;}, get alert(){return alertMeter;}, get ammo(){return ammo;} }; // テスト用

