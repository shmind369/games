#!/usr/bin/env python3
"""敵(護衛兵)のモデルを作る: 中華娘(china_rigged.glb)と同じ骨格(19ボーン・同じ初期姿勢)に合わせた、スキン付きGLB。
  使い方: python3 tools/make_guard.py  → assets/guard_china_rigged.glb
  骨格・バインド姿勢は china_rigged.glb のものをそのまま使うので、中華娘用のモーションJSON(walk.json など)がそのまま使える。
  見た目: 濃紺の長衣(金の縁どり)・赤い帯と房・黒いズボンと布靴・黒髪の一つ団子に赤い鉢巻・つり目。
  色は頂点カラー(COLOR_0)。パーツの色・大きさ・位置は下の PARTS を書き換えれば変えられる。
"""
import json, math, struct, sys, os
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'assets', 'china_rigged.glb')
OUT = os.path.join(HERE, '..', 'assets', 'guard_china_rigged.glb')

# ---- 元のGLB(中華娘)から、骨格と逆バインド行列を取る
d = open(SRC, 'rb').read()
jl = struct.unpack('<I', d[12:16])[0]; J = json.loads(d[20:20 + jl]); BIN0 = 20 + jl + 8
acc = J['accessors'][J['skins'][0]['inverseBindMatrices']]; bv = J['bufferViews'][acc['bufferView']]
ibm_bytes = d[BIN0 + bv.get('byteOffset', 0): BIN0 + bv.get('byteOffset', 0) + acc['count'] * 64]
ibm = np.frombuffer(ibm_bytes, dtype='<f4').reshape(-1, 4, 4)
JOINT_NODES = J['skins'][0]['joints']
NAMES = [J['nodes'][i]['name'] for i in JOINT_NODES]
BONE = {n: i for i, n in enumerate(NAMES)}
BIND = {n: np.linalg.inv(m.T)[:3, 3] for n, m in zip(NAMES, ibm)}  # バインド姿勢のワールド位置

# ---- 色
NAVY = (0.10, 0.16, 0.34); NAVY2 = (0.07, 0.11, 0.26); GOLD = (0.92, 0.70, 0.22); RED = (0.80, 0.12, 0.12)
BLACK = (0.06, 0.06, 0.08); SKIN = (0.96, 0.79, 0.66); WHITE = (0.93, 0.93, 0.90); HAIR = (0.07, 0.06, 0.08); EYE = (0.05, 0.05, 0.07)

V = []; N = []; C = []; JI = []; W = []; IDX = []  # 頂点データ

def rot_from_euler(rx, ry, rz):
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]]); Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]); Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rx @ Ry @ Rz

def rot_y_to(dirv):  # 単位球のY軸を dirv に向ける回転
    y = np.array([0, 1.0, 0]); t = np.asarray(dirv, float); t = t / np.linalg.norm(t)
    v = np.cross(y, t); s = np.linalg.norm(v); c = float(np.dot(y, t))
    if s < 1e-8: return np.eye(3) if c > 0 else np.diag([1, -1, -1.0])
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k * ((1 - c) / (s * s))

def smooth(x): x = min(1, max(0, x)); return x * x * (3 - 2 * x)

def add_mesh(pos, nrm, idx, color, bone, blend=None):
    """blend=(別のボーン, 軸の始点, 軸の終点, 混ぜ始める位置0-1, 最大の混ぜ具合)"""
    base = len(V)
    for p, n in zip(pos, nrm):
        V.append(p); N.append(n / (np.linalg.norm(n) + 1e-9)); C.append(color)
        if blend:
            ob, a, b, t0, mx = blend; a = np.asarray(a, float); b = np.asarray(b, float)
            t = float(np.dot(p - a, b - a) / np.dot(b - a, b - a)); w = mx * smooth((t - t0) / (1 - t0 + 1e-9))
            JI.append((BONE[bone], BONE[ob], 0, 0)); W.append((1 - w, w, 0, 0))
        else:
            JI.append((BONE[bone], 0, 0, 0)); W.append((1, 0, 0, 0))
    IDX.extend(int(base + i) for i in idx)

def ellipsoid(center, radii, color, bone, rot=None, axis=None, seg=(12, 8), keep=None, blend=None):
    """楕円体。axis を渡すと、その向きが楕円体の長い軸(Y)になる。keep(頂点のローカル座標)がFalseの三角形は捨てる"""
    nu, nv = seg; R = np.eye(3)
    if axis is not None: R = rot_y_to(axis)
    if rot is not None: R = R @ rot_from_euler(*[math.radians(a) for a in rot])
    pos = []; nrm = []; loc = []
    for j in range(nv + 1):
        th = math.pi * j / nv
        for i in range(nu + 1):
            ph = 2 * math.pi * i / nu
            u = np.array([math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)])
            pos.append(np.asarray(center, float) + R @ (u * np.asarray(radii, float))); nrm.append(R @ (u / np.asarray(radii, float))); loc.append(u * np.asarray(radii, float))
    idx = []
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i; b = a + nu + 1
            for tri in ((a, b, a + 1), (a + 1, b, b + 1)):
                if keep is not None and not keep(sum(loc[k] for k in tri) / 3): continue
                idx.extend(tri)
    # 法線の向きに合わせて巻き順を揃える(外向き)
    fixed = []
    for k in range(0, len(idx), 3):
        a, b, c = idx[k:k + 3]; n = np.cross(pos[b] - pos[a], pos[c] - pos[a]); cen = (pos[a] + pos[b] + pos[c]) / 3
        fixed.extend((a, c, b) if np.dot(n, cen - np.asarray(center, float)) < 0 else (a, b, c))
    add_mesh(pos, nrm, fixed, color, bone, blend)

def torus(center, rx, rz, tube, color, bone, rot=None, seg=(24, 8)):
    """楕円の輪(帯・鉢巻など)。Y軸まわり"""
    nu, nv = seg; R = np.eye(3) if rot is None else rot_from_euler(*[math.radians(a) for a in rot]); pos = []; nrm = []
    for i in range(nu + 1):
        ph = 2 * math.pi * i / nu; c = np.array([rx * math.cos(ph), 0, rz * math.sin(ph)]); radial = np.array([math.cos(ph) / 1, 0, math.sin(ph)])
        for j in range(nv + 1):
            th = 2 * math.pi * j / nv; n = radial * math.cos(th) + np.array([0, math.sin(th), 0])
            pos.append(np.asarray(center, float) + R @ (c + n * tube)); nrm.append(R @ n)
    idx = []
    for i in range(nu):
        for j in range(nv):
            a = i * (nv + 1) + j; b = a + nv + 1; idx.extend((a, a + 1, b, a + 1, b + 1, b))
    # 外向きに
    fixed = []
    for k in range(0, len(idx), 3):
        a, b, c = idx[k:k + 3]; n = np.cross(pos[b] - pos[a], pos[c] - pos[a])
        fixed.extend((a, c, b) if np.dot(n, nrm[a]) < 0 else (a, b, c))
    add_mesh(pos, nrm, fixed, color, bone)

def tube(p0, p1, r, color, bone, blend_to=None, stretch=1.12, **kw):  # 2点の間の、細長い楕円体(腕・脚)
    p0 = np.asarray(p0, float); p1 = np.asarray(p1, float); mid = (p0 + p1) / 2; L = np.linalg.norm(p1 - p0)
    blend = (blend_to, p0, p1, 0.55, 0.5) if blend_to else None
    ellipsoid(mid, (r, L / 2 * stretch, r), color, bone, axis=p1 - p0, blend=blend, **kw)

B = BIND
# ================= パーツ(バインド姿勢の座標。y上、+Zが前) =================
# 胴・長衣
ellipsoid((0, 0.93, 0), (0.19, 0.15, 0.14), BLACK, 'Hips')                       # 腰(ズボン)
ellipsoid((0, 1.10, 0), (0.165, 0.14, 0.115), NAVY, 'Spine')                     # 腹(上着)
ellipsoid((0, 1.245, 0.0), (0.205, 0.16, 0.125), NAVY, 'Chest')                  # 胸(上着)
ellipsoid((0, 1.235, 0.105), (0.022, 0.16, 0.03), GOLD, 'Chest')                 # 合わせ目の金の縁どり
ellipsoid((0, 1.33, 0.07), (0.075, 0.035, 0.06), GOLD, 'Chest')                  # 立て襟の金
torus((0, 1.0, 0), 0.175, 0.125, 0.032, RED, 'Spine')                            # 赤い帯
ellipsoid((0.0, 0.99, 0.135), (0.04, 0.03, 0.02), GOLD, 'Spine')                 # 帯のバックル
ellipsoid((0.11, 0.88, 0.12), (0.025, 0.1, 0.02), RED, 'Hips', rot=(0, 0, -6))   # 帯の房
ellipsoid((0, 0.79, 0.125), (0.15, 0.19, 0.04), NAVY2, 'Hips')                 # 長衣のすそ(前)
ellipsoid((0, 0.79, -0.125), (0.15, 0.19, 0.04), NAVY2, 'Hips')                # 長衣のすそ(後)
ellipsoid((0, 0.615, 0.125), (0.14, 0.018, 0.045), GOLD, 'Hips')                 # すその金のふち(前)
ellipsoid((0, 0.615, -0.125), (0.14, 0.018, 0.045), GOLD, 'Hips')                # すその金のふち(後)
# 首・頭
ellipsoid((0, 1.355, 0), (0.05, 0.05, 0.05), SKIN, 'Neck')
ellipsoid((0, 1.55, 0.012), (0.138, 0.165, 0.14), SKIN, 'Head', seg=(18, 12))    # 顔
for s in (-1, 1):
    ellipsoid((s * 0.142, 1.545, 0.0), (0.03, 0.04, 0.025), SKIN, 'Head')        # 耳
    ellipsoid((s * 0.058, 1.553, 0.133), (0.024, 0.034, 0.012), EYE, 'Head')     # 目
    ellipsoid((s * 0.062, 1.562, 0.141), (0.008, 0.012, 0.006), WHITE, 'Head')   # 目のハイライト
    ellipsoid((s * 0.06, 1.598, 0.128), (0.042, 0.009, 0.012), HAIR, 'Head', rot=(0, 0, s * -22))  # つり眉(外側が上がる)
ellipsoid((0, 1.488, 0.135), (0.022, 0.008, 0.01), (0.55, 0.22, 0.20), 'Head')   # 口
# 髪(頭の上と後ろだけ) + 一つ団子 + 赤い鉢巻
ellipsoid((0, 1.58, -0.012), (0.15, 0.17, 0.155), HAIR, 'Head', seg=(24, 16), keep=lambda p: (p[1] > 0.045 + 0.1 * max(0, p[2])) or (p[2] < -0.035))
ellipsoid((0, 1.765, -0.035), (0.062, 0.06, 0.062), HAIR, 'Head')                # 団子
ellipsoid((0, 1.715, -0.03), (0.04, 0.016, 0.04), RED, 'Head')                   # 髪留め
torus((0, 1.625, -0.005), 0.148, 0.152, 0.014, RED, 'Head')                      # 鉢巻
for s in (-1, 1): ellipsoid((s * 0.03, 1.55, -0.175), (0.016, 0.13, 0.006), RED, 'Head', rot=(12, 0, s * 6))  # 鉢巻のリボン
# 腕(左 = +X 側 / 右 = -X 側)
for s, side in ((1, 'Left'), (-1, 'Right')):
    sh = B[side + 'UpperArm']; el = B[side + 'Forearm']; wr = B[side + 'Hand']
    ellipsoid(sh + np.array([0.0, 0.015, 0]), (0.085, 0.06, 0.085), GOLD, side + 'UpperArm')            # 金の肩当て
    tube(sh, el, 0.058, NAVY, side + 'UpperArm', blend_to=side + 'Forearm')                              # 二の腕(袖)
    tube(el, wr, 0.05, NAVY, side + 'Forearm', blend_to=side + 'Hand')                                   # 前腕(袖)
    ellipsoid(wr + np.array([0.0, 0.035, 0]), (0.056, 0.02, 0.056), GOLD, side + 'Forearm')              # 金のカフス
    ellipsoid(wr + np.array([s * 0.004, -0.035, 0.005]), (0.045, 0.05, 0.04), SKIN, side + 'Hand')       # 手
# 脚
for s, side in ((1, 'Left'), (-1, 'Right')):
    hp = B[side + 'UpperLeg']; kn = B[side + 'LowerLeg']; an = B[side + 'Foot']
    tube(hp, kn, 0.112, BLACK, side + 'UpperLeg', blend_to=side + 'LowerLeg')                            # 太もも(ズボン)
    tube(kn, an, 0.086, BLACK, side + 'LowerLeg', blend_to=side + 'Foot', stretch=1.04)                  # すね
    ellipsoid(an + np.array([0, 0.06, 0.0]), (0.085, 0.032, 0.085), WHITE, side + 'LowerLeg')               # 足首の白い脚絆
    ellipsoid(an + np.array([0, -0.06, 0.06]), (0.07, 0.07, 0.16), BLACK, side + 'Foot')              # 布靴
    ellipsoid(an + np.array([0, -0.125, 0.06]), (0.074, 0.024, 0.17), WHITE, side + 'Foot')            # 白い靴底

# ================= GLB を書き出す =================
pos = np.array(V, '<f4'); nrm = np.array(N, '<f4'); col = np.array(C, '<f4'); ji = np.array(JI, '<u1'); wt = np.array(W, '<f4'); idx = np.array(IDX, '<u4')
# 頂点カラーは sRGB → three.js は COLOR_0 を線形として扱うので、sRGBっぽく見える値を線形に直して入れる
col = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4).astype('<f4')
chunks = [pos.tobytes(), nrm.tobytes(), col.tobytes(), ji.tobytes(), wt.tobytes(), idx.tobytes(), bytes(ibm_bytes)]
views = []; blob = b''
for c in chunks:
    while len(blob) % 4: blob += b'\0'
    views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(c)}); blob += c
while len(blob) % 4: blob += b'\0'
n = len(V)
accs = [
    {'bufferView': 0, 'componentType': 5126, 'count': n, 'type': 'VEC3', 'min': pos.min(0).tolist(), 'max': pos.max(0).tolist()},
    {'bufferView': 1, 'componentType': 5126, 'count': n, 'type': 'VEC3'},
    {'bufferView': 2, 'componentType': 5126, 'count': n, 'type': 'VEC3'},
    {'bufferView': 3, 'componentType': 5121, 'count': n, 'type': 'VEC4'},
    {'bufferView': 4, 'componentType': 5126, 'count': n, 'type': 'VEC4'},
    {'bufferView': 5, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'},
    {'bufferView': 6, 'componentType': 5126, 'count': 19, 'type': 'MAT4'},
]
nodes = json.loads(json.dumps(J['nodes'])); nodes[0] = {'name': 'guard', 'mesh': 0, 'skin': 0}
out = {
    'asset': {'version': '2.0', 'generator': 'vr-missions-china/tools/make_guard.py'},
    'scene': 0, 'scenes': [{'nodes': J['scenes'][0]['nodes']}],
    'nodes': nodes,
    'meshes': [{'name': 'guard', 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'COLOR_0': 2, 'JOINTS_0': 3, 'WEIGHTS_0': 4}, 'indices': 5, 'material': 0}]}],
    'materials': [{'name': 'guard', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 0.72}}],
    'skins': [{'name': 'Armature', 'joints': JOINT_NODES, 'skeleton': J['skins'][0].get('skeleton', 1), 'inverseBindMatrices': 6}],
    'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}],
}
js = json.dumps(out, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + blob
open(OUT, 'wb').write(glb)
print('wrote', OUT, len(glb) // 1024, 'KB', 'vertices', n, 'triangles', len(idx) // 3)
