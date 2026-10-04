#!/usr/bin/env python3
"""ボクサーモデルを関節位置で切断して assets/boxer_parts.json / boxer_joints.json を作る前処理。

アプリ本体には含まれない、一度だけ実行するオフライン処理(要 numpy)。
入力は ../third-person-boxer-3d/assets/boxer.glb (Tripo製・Tポーズ・骨格なしの静的メッシュ)。

    python3 tools/build_boxer_parts.py

以前の前処理は、三角形を3頂点の多数決でパーツへ丸ごと割り当てていたうえ、
切れ目の位置とボーンの回転中心(関節)が一致していなかったため、関節を曲げると
パーツの一部が関節から大きく離れた位置で振り回され、メッシュが千切れたトゲの
ように見えていた。ここでは
  1. メッシュの断面から実際の肩・肘・手首・股関節・膝・足首などの中心を測り、
     その位置をそのままボーンの回転中心(main.js の buildBoxerBoneHierarchy)にする
  2. 各パーツの境界を「その関節を通る平面」とし、平面をまたぐ三角形は平面で
     切断して両側へ分ける(多数決をやめる)
ことで、各パーツが必ず自分の関節のところで切れているようにしている。
"""
import json, math, os, struct
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "..", "third-person-boxer-3d", "assets", "boxer.glb")
OUT_PARTS = os.path.join(HERE, "..", "assets", "boxer_parts.json")
OUT_JOINTS = os.path.join(HERE, "..", "assets", "boxer_joints.json")
HEIGHT = 1.738  # 以前のパーツ版と同じ身長(頭頂のY)

# ---------- glbの読み込み ----------
def load_glb(path):
    f = open(path, "rb").read()
    jl = struct.unpack("<I", f[12:16])[0]
    j = json.loads(f[20:20 + jl])
    b = f[20 + jl + 8:]
    prim = j["meshes"][0]["primitives"][0]

    def acc(i, dt, n):
        a = j["accessors"][i]
        bv = j["bufferViews"][a["bufferView"]]
        o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.frombuffer(b, dtype=dt, count=a["count"] * n, offset=o).reshape(-1, n).astype(float)

    P = acc(prim["attributes"]["POSITION"], np.float32, 3)
    N = acc(prim["attributes"]["NORMAL"], np.float32, 3)
    U = acc(prim["attributes"]["TEXCOORD_0"], np.float32, 2)
    I = acc(prim["indices"], np.uint16, 1).astype(int).reshape(-1, 3)
    return P, N, U, I

P, N, U, I = load_glb(SRC)
# バウンディングボックスで正規化(左右・前後の中心を原点、足裏をY=0、頭頂をHEIGHT)
lo, hi = P.min(0), P.max(0)
P = P - np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
P *= HEIGHT / P[:, 1].max()
V = np.hstack([P, N, U])  # 1頂点 = [x,y,z, nx,ny,nz, u,v]
TRIS = [V[t] for t in I]

# ---------- 断面から関節の中心を測る ----------
def section_center(axis, val, filt):
    pts = []
    for t in I:
        for a, c in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            da, dc = P[a][axis] - val, P[c][axis] - val
            if da * dc < 0:
                p = P[a] + (P[c] - P[a]) * (da / (da - dc))
                if filt(p):
                    pts.append(p)
    pts = np.array(pts)
    return (pts.min(0) + pts.max(0)) / 2, (pts.max(0) - pts.min(0))

def sym(axis, val, filt_l, filt_r):
    """左右の断面中心を平均して左右対称な関節位置(左側, +X)を返す"""
    (cl, el), (cr, er) = section_center(axis, val, filt_l), section_center(axis, val * (-1 if axis == 0 else 1), filt_r)
    c = np.array([(cl[0] - cr[0]) / 2, (cl[1] + cr[1]) / 2, (cl[2] + cr[2]) / 2])
    return c, (el + er) / 2

# 切断位置(Tポーズ時の座標)。ワイヤーフレームを目視して、くびれている位置を選んだ
SHOULDER_X, ELBOW_X, WRIST_X = 0.22, 0.44, 0.61
HIP_Y, KNEE_Y, ANKLE_Y = 0.84, 0.45, 0.13
SPINE_Y, CHEST_Y, NECK_Y, HEAD_Y = 1.00, 1.15, 1.33, 1.38
NECK_HALF_W = 0.10  # 首パーツの左右幅(これより外側の肩の上面は胸パーツ)
MARGIN = 0.02       # 子パーツを親側へはみ出させる重なり幅(曲げたときの隙間対策)
ARM_DOWN_DEG = 80   # Tポーズの腕を肩中心に下げる角度(90°だと胴体にめり込むため少し開く)

up = lambda p: p[1] > 1.1
shoulder, shoulder_e = sym(0, SHOULDER_X, up, up)
elbow, elbow_e = sym(0, ELBOW_X, up, up)
wrist, _ = sym(0, WRIST_X, up, up)
hip, _ = sym(1, HIP_Y, lambda p: p[0] > 0, lambda p: p[0] < 0)
knee, knee_e = sym(1, KNEE_Y, lambda p: p[0] > 0, lambda p: p[0] < 0)
ankle, _ = sym(1, ANKLE_Y, lambda p: p[0] > 0, lambda p: p[0] < 0)
neck_c, _ = section_center(1, NECK_Y, lambda p: abs(p[0]) < NECK_HALF_W)

# ---------- 半空間による凸領域での切断 ----------
# 半空間は (法線n, d) で n·p >= d の側を残す
def clip(poly, n, d):
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        da, db = np.dot(n, a[:3]) - d, np.dot(n, b[:3]) - d
        if da >= 0:
            out.append(a)
        if (da >= 0) != (db >= 0):
            out.append(a + (b - a) * (da / (da - db)))
    return out

def extract(region):
    """region: 凸領域(半空間のリスト)のリスト。和集合に含まれる三角形片を返す"""
    tris = []
    for convex in region:
        for t in TRIS:
            poly = list(t)
            for n, d in convex:
                poly = clip(poly, np.array(n, float), d)
                if len(poly) < 3:
                    break
            if len(poly) < 3:
                continue
            for k in range(1, len(poly) - 1):
                tri = np.array([poly[0], poly[k], poly[k + 1]])
                if np.linalg.norm(np.cross(tri[1, :3] - tri[0, :3], tri[2, :3] - tri[0, :3])) > 1e-10:
                    tris.append(tri)
    return tris

X, Y = (1, 0, 0), (0, 1, 0)
nX, nY = (-1, 0, 0), (0, -1, 0)
def above(y, m=0): return (Y, y - m)
def below(y, m=0): return (nY, -(y + m))
def right_of(x, m=0): return (X, x - m)   # x >= x0
def left_of(x, m=0): return (nX, -(x + m))  # x <= x0
M = MARGIN

regions = {
    "Hips": [[above(HIP_Y), below(SPINE_Y), right_of(-SHOULDER_X), left_of(SHOULDER_X)]],
    "Spine": [[above(SPINE_Y, M), below(CHEST_Y), right_of(-SHOULDER_X), left_of(SHOULDER_X)]],
    "Chest": [[above(CHEST_Y, M), below(NECK_Y), right_of(-SHOULDER_X), left_of(SHOULDER_X)],
              [above(NECK_Y), below(HEAD_Y), right_of(NECK_HALF_W), left_of(SHOULDER_X)],
              [above(NECK_Y), below(HEAD_Y), right_of(-SHOULDER_X), left_of(-NECK_HALF_W)]],
    "Neck": [[above(NECK_Y, M), below(HEAD_Y), right_of(-NECK_HALF_W), left_of(NECK_HALF_W)]],
    "Head": [[above(HEAD_Y, M), right_of(-SHOULDER_X), left_of(SHOULDER_X)]],
    "LeftUpperArm": [[above(HIP_Y), right_of(SHOULDER_X, M), left_of(ELBOW_X)]],
    "LeftForearm": [[above(HIP_Y), right_of(ELBOW_X, M), left_of(WRIST_X)]],
    "LeftHand": [[above(HIP_Y), right_of(WRIST_X, M)]],
    "RightUpperArm": [[above(HIP_Y), left_of(-SHOULDER_X, M), right_of(-ELBOW_X)]],
    "RightForearm": [[above(HIP_Y), left_of(-ELBOW_X, M), right_of(-WRIST_X)]],
    "RightHand": [[above(HIP_Y), left_of(-WRIST_X, M)]],
    "LeftUpperLeg": [[below(HIP_Y, M), above(KNEE_Y), right_of(0)]],
    "LeftLowerLeg": [[below(KNEE_Y, M), above(ANKLE_Y), right_of(0)]],
    "LeftFoot": [[below(ANKLE_Y, M), right_of(0)]],
    "RightUpperLeg": [[below(HIP_Y, M), above(KNEE_Y), left_of(0)]],
    "RightLowerLeg": [[below(KNEE_Y, M), above(ANKLE_Y), left_of(0)]],
    "RightFoot": [[below(ANKLE_Y, M), left_of(0)]],
}
parts = {name: extract(r) for name, r in regions.items()}

# ---------- 腕をTポーズから体側へ下げる(肩中心の剛体回転) ----------
def rot_z(deg):
    r = math.radians(deg)
    return np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])

def mirror(p): return np.array([-p[0], p[1], p[2]])

R_L, R_R = rot_z(-ARM_DOWN_DEG), rot_z(ARM_DOWN_DEG)
S_L, S_R = shoulder, mirror(shoulder)
for side, R, S in (("Left", R_L, S_L), ("Right", R_R, S_R)):
    for seg in ("UpperArm", "Forearm", "Hand"):
        for tri in parts[side + seg]:
            tri[:, :3] = (tri[:, :3] - S) @ R.T + S
            tri[:, 3:6] = tri[:, 3:6] @ R.T

elbow_rest = (elbow - shoulder) @ R_L.T + shoulder
wrist_rest = (wrist - shoulder) @ R_L.T + shoulder

# ---------- 書き出し ----------
def r5(a): return [round(float(x), 5) for x in a]
out = {}
for name, tris in parts.items():
    arr = np.array(tris).reshape(-1, 8) if tris else np.zeros((0, 8))
    nrm = arr[:, 3:6] / np.maximum(np.linalg.norm(arr[:, 3:6], axis=1, keepdims=True), 1e-9)
    out[name] = {"positions": r5(arr[:, :3].ravel()), "normals": r5(nrm.ravel()), "uvs": r5(arr[:, 6:8].ravel())}
    print(f"{name:14s} {len(tris):4d} tris")
json.dump(out, open(OUT_PARTS, "w"), separators=(",", ":"))

def c3(p): return [round(float(x), 4) for x in p]
joints = {
    "LeftShoulder": {"bone": "LeftUpperArm", "radius": round(float(shoulder_e[1]) / 2 * 0.85, 3), "center": c3(S_L)},
    "RightShoulder": {"bone": "RightUpperArm", "radius": round(float(shoulder_e[1]) / 2 * 0.85, 3), "center": c3(S_R)},
    "LeftElbow": {"bone": "LeftForearm", "radius": round(float(elbow_e[1]) / 2 * 0.85, 3), "center": c3(elbow_rest)},
    "RightElbow": {"bone": "RightForearm", "radius": round(float(elbow_e[1]) / 2 * 0.85, 3), "center": c3(mirror(elbow_rest))},
    "LeftHip": {"bone": "LeftUpperLeg", "radius": 0.07, "center": c3(hip)},
    "RightHip": {"bone": "RightUpperLeg", "radius": 0.07, "center": c3(mirror(hip))},
    "LeftKnee": {"bone": "LeftLowerLeg", "radius": round(float(knee_e[0]) / 2 * 0.85, 3), "center": c3(knee)},
    "RightKnee": {"bone": "RightLowerLeg", "radius": round(float(knee_e[0]) / 2 * 0.85, 3), "center": c3(mirror(knee))},
}
json.dump({"joints": joints, "skinColor": [217, 160, 102]}, open(OUT_JOINTS, "w"), separators=(",", ":"))

# main.js の buildBoxerBoneHierarchy に書き写すボーンのワールド位置(左側)
print("\n# bone world positions (left side; right = mirrored X)")
for k, v in [("Spine", (0, SPINE_Y, 0)), ("Chest", (0, CHEST_Y, 0)), ("Neck", (0, NECK_Y, neck_c[2])), ("Head", (0, HEAD_Y, 0)),
             ("UpperArm", shoulder), ("Forearm", elbow_rest), ("Hand", wrist_rest),
             ("UpperLeg", hip), ("LowerLeg", knee), ("Foot", ankle)]:
    print(f"{k:10s} {c3(v)}")
