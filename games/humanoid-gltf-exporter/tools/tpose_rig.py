#!/usr/bin/env python3
"""Tポーズの静的メッシュ(Tripo製など、骨格なし)を関節位置で切断し、
このアプリの19本のヒューマノイドボーンに1パーツ=1ボーン(100%ウェイト)で
結びつけるオフライン前処理(要 numpy)。アプリ本体には含まれない。

    # ボクサー(アプリ内蔵モデル): assets/boxer_parts.json / boxer_joints.json を作る
    python3 tools/tpose_rig.py boxer

    # box_usa: ボーン・スキン入りのGLBを書き出す(アプリの📥で読み込める)
    python3 tools/tpose_rig.py box_usa path/to/box_usa.glb assets/box_usa_rigged.glb

以前の前処理は、三角形を3頂点の多数決でパーツへ丸ごと割り当てていたうえ、
切れ目の位置とボーンの回転中心(関節)が一致していなかったため、関節を曲げると
パーツの一部が関節から大きく離れた位置で振り回され、メッシュが千切れたトゲの
ように見えていた。ここでは
  1. メッシュの断面から実際の肩・肘・手首・股関節・膝・足首などの中心を測り、
     その位置をそのままボーンの回転中心にする
  2. 各パーツの境界を「その関節を通る平面」とし、平面をまたぐ三角形は平面で
     切断して両側へ分ける(多数決をやめる)
ことで、各パーツが必ず自分の関節のところで切れているようにしている。
切断位置(くびれの位置)はモデルごとに異なるため、PRESETS にモデルごとの
値を持たせている(ワイヤーフレームと断面の太さの変化を見て決めた)。
"""
import json, math, os, struct, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..")
HEIGHT = 1.738  # 頭頂のY(ボクサーと同じ身長にそろえ、アニメーションを流用しやすくする)

PRESETS = {
    # 切断位置はすべてTポーズ・身長HEIGHTに正規化した座標
    "boxer": dict(
        SHOULDER_X=0.22, ELBOW_X=0.44, WRIST_X=0.61,
        HIP_Y=0.84, KNEE_Y=0.45, ANKLE_Y=0.13,
        SPINE_Y=1.00, CHEST_Y=1.15, NECK_Y=1.33, HEAD_Y=1.38,
        NECK_HALF_W=0.10, ARM_MIN_Y=0.84, HIPS_Y=0.92,
    ),
    "box_usa": dict(
        SHOULDER_X=0.24, ELBOW_X=0.44, WRIST_X=0.665,
        HIP_Y=0.85, KNEE_Y=0.50, ANKLE_Y=0.14,
        SPINE_Y=1.05, CHEST_Y=1.20, NECK_Y=1.42, HEAD_Y=1.48,
        NECK_HALF_W=0.10, ARM_MIN_Y=1.10, HIPS_Y=0.95,
    ),
}
MARGIN = 0.02       # 子パーツを親側へはみ出させる重なり幅(曲げたときの隙間対策)
ARM_DOWN_DEG = 80   # Tポーズの腕を肩中心に下げる角度(90°だと胴体にめり込むため少し開く)
SKIN_COLOR = [217, 160, 102]  # 関節カバー球の色(初期のプリミティブ版と同じ肌色)


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
    ia = j["accessors"][prim["indices"]]
    I = acc(prim["indices"], np.uint32 if ia["componentType"] == 5125 else np.uint16, 1).astype(int).reshape(-1, 3)
    img = None
    if j.get("images"):
        bv = j["bufferViews"][j["images"][0]["bufferView"]]
        img = (b[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]], j["images"][0].get("mimeType", "image/jpeg"))
    # バウンディングボックスで正規化(左右・前後の中心を原点、足裏をY=0、頭頂をHEIGHT)
    lo, hi = P.min(0), P.max(0)
    P = P - np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    P *= HEIGHT / P[:, 1].max()
    return P, N, U, I, img


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


X, Y = (1, 0, 0), (0, 1, 0)
nX, nY = (-1, 0, 0), (0, -1, 0)
def above(y, m=0): return (Y, y - m)
def below(y, m=0): return (nY, -(y + m))
def right_of(x, m=0): return (X, x - m)    # x >= x0
def left_of(x, m=0): return (nX, -(x + m))  # x <= x0

def rot_z(deg):
    r = math.radians(deg)
    return np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])

def mirror(p): return np.array([-p[0], p[1], p[2]])


def rig(src, c):
    P, N, U, I, img = load_glb(src)
    V = np.hstack([P, N, U])  # 1頂点 = [x,y,z, nx,ny,nz, u,v]
    TRIS = [V[t] for t in I]

    # ---------- 断面から関節の中心を測る ----------
    def section_center(axis, val, filt):
        pts = []
        for t in I:
            for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                da, db = P[a][axis] - val, P[b][axis] - val
                if da * db < 0:
                    p = P[a] + (P[b] - P[a]) * (da / (da - db))
                    if filt(p):
                        pts.append(p)
        pts = np.array(pts)
        return (pts.min(0) + pts.max(0)) / 2, (pts.max(0) - pts.min(0))

    def sym(axis, val, filt_l, filt_r):
        """左右の断面中心を平均して左右対称な関節位置(左側, +X)を返す"""
        (cl, el), (cr, er) = section_center(axis, val, filt_l), section_center(axis, val * (-1 if axis == 0 else 1), filt_r)
        return np.array([(cl[0] - cr[0]) / 2, (cl[1] + cr[1]) / 2, (cl[2] + cr[2]) / 2]), (el + er) / 2

    up = lambda p: p[1] > 1.1
    L, R = (lambda p: p[0] > 0), (lambda p: p[0] < 0)
    shoulder, shoulder_e = sym(0, c["SHOULDER_X"], up, up)
    elbow, elbow_e = sym(0, c["ELBOW_X"], up, up)
    wrist, _ = sym(0, c["WRIST_X"], up, up)
    hip, _ = sym(1, c["HIP_Y"], L, R)
    knee, knee_e = sym(1, c["KNEE_Y"], L, R)
    ankle, _ = sym(1, c["ANKLE_Y"], L, R)
    neck_c, _ = section_center(1, c["NECK_Y"], lambda p: abs(p[0]) < c["NECK_HALF_W"])

    # ---------- パーツ領域(凸領域の和集合)で切り出す ----------
    def extract(region):
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

    M = MARGIN
    SX, EX, WX = c["SHOULDER_X"], c["ELBOW_X"], c["WRIST_X"]
    HY, KY, AY = c["HIP_Y"], c["KNEE_Y"], c["ANKLE_Y"]
    SY, CY, NY, HDY, NW, AMY = c["SPINE_Y"], c["CHEST_Y"], c["NECK_Y"], c["HEAD_Y"], c["NECK_HALF_W"], c["ARM_MIN_Y"]
    regions = {
        "Hips": [[above(HY), below(SY), right_of(-SX), left_of(SX)]],
        "Spine": [[above(SY, M), below(CY), right_of(-SX), left_of(SX)]],
        "Chest": [[above(CY, M), below(NY), right_of(-SX), left_of(SX)],
                  [above(NY), below(HDY), right_of(NW), left_of(SX)],
                  [above(NY), below(HDY), right_of(-SX), left_of(-NW)]],
        "Neck": [[above(NY, M), below(HDY), right_of(-NW), left_of(NW)]],
        "Head": [[above(HDY, M), right_of(-SX), left_of(SX)]],
        "LeftUpperArm": [[above(AMY), right_of(SX, M), left_of(EX)]],
        "LeftForearm": [[above(AMY), right_of(EX, M), left_of(WX)]],
        "LeftHand": [[above(AMY), right_of(WX, M)]],
        "RightUpperArm": [[above(AMY), left_of(-SX, M), right_of(-EX)]],
        "RightForearm": [[above(AMY), left_of(-EX, M), right_of(-WX)]],
        "RightHand": [[above(AMY), left_of(-WX, M)]],
        "LeftUpperLeg": [[below(HY, M), above(KY), right_of(0)]],
        "LeftLowerLeg": [[below(KY, M), above(AY), right_of(0)]],
        "LeftFoot": [[below(AY, M), right_of(0)]],
        "RightUpperLeg": [[below(HY, M), above(KY), left_of(0)]],
        "RightLowerLeg": [[below(KY, M), above(AY), left_of(0)]],
        "RightFoot": [[below(AY, M), left_of(0)]],
    }
    parts = {name: extract(r) for name, r in regions.items()}

    # ---------- 腕をTポーズから体側へ下げる(肩中心の剛体回転) ----------
    R_L, R_R = rot_z(-ARM_DOWN_DEG), rot_z(ARM_DOWN_DEG)
    S_L, S_R = shoulder, mirror(shoulder)
    for side, Rm, S in (("Left", R_L, S_L), ("Right", R_R, S_R)):
        for seg in ("UpperArm", "Forearm", "Hand"):
            for tri in parts[side + seg]:
                tri[:, :3] = (tri[:, :3] - S) @ Rm.T + S
                tri[:, 3:6] = tri[:, 3:6] @ Rm.T
    elbow_rest = (elbow - shoulder) @ R_L.T + shoulder
    wrist_rest = (wrist - shoulder) @ R_L.T + shoulder

    # ---------- ボーン(すべて回転なし、ワールド位置で定義) ----------
    def lr(name, p):
        return [("Left" + name, np.asarray(p, float)), ("Right" + name, mirror(np.asarray(p, float)))]
    bone_world = dict([
        ("Hips", np.array([0, c["HIPS_Y"], 0.0])),
        ("Spine", np.array([0, SY, 0.0])),
        ("Chest", np.array([0, CY, 0.0])),
        ("Neck", np.array([0, NY, round(float(neck_c[2]), 2)])),
        ("Head", np.array([0, HDY, 0.0])),
        *lr("Shoulder", [round(SX * 0.4, 3), shoulder[1], shoulder[2]]),
        *lr("UpperArm", shoulder), *lr("Forearm", elbow_rest), *lr("Hand", wrist_rest),
        *lr("UpperLeg", hip), *lr("LowerLeg", knee), *lr("Foot", ankle),
    ])
    joints = {
        "LeftShoulder": {"bone": "LeftUpperArm", "radius": round(float(shoulder_e[1]) / 2 * 0.85, 3), "center": S_L},
        "RightShoulder": {"bone": "RightUpperArm", "radius": round(float(shoulder_e[1]) / 2 * 0.85, 3), "center": S_R},
        "LeftElbow": {"bone": "LeftForearm", "radius": round(float(elbow_e[1]) / 2 * 0.85, 3), "center": elbow_rest},
        "RightElbow": {"bone": "RightForearm", "radius": round(float(elbow_e[1]) / 2 * 0.85, 3), "center": mirror(elbow_rest)},
        "LeftHip": {"bone": "LeftUpperLeg", "radius": 0.07, "center": hip},
        "RightHip": {"bone": "RightUpperLeg", "radius": 0.07, "center": mirror(hip)},
        "LeftKnee": {"bone": "LeftLowerLeg", "radius": round(float(knee_e[0]) / 2 * 0.85, 3), "center": knee},
        "RightKnee": {"bone": "RightLowerLeg", "radius": round(float(knee_e[0]) / 2 * 0.85, 3), "center": mirror(knee)},
    }
    return parts, joints, bone_world, img


PARENT = {
    "Hips": None, "Spine": "Hips", "Chest": "Spine", "Neck": "Chest", "Head": "Neck",
    "LeftShoulder": "Chest", "LeftUpperArm": "LeftShoulder", "LeftForearm": "LeftUpperArm", "LeftHand": "LeftForearm",
    "RightShoulder": "Chest", "RightUpperArm": "RightShoulder", "RightForearm": "RightUpperArm", "RightHand": "RightForearm",
    "LeftUpperLeg": "Hips", "LeftLowerLeg": "LeftUpperLeg", "LeftFoot": "LeftLowerLeg",
    "RightUpperLeg": "Hips", "RightLowerLeg": "RightUpperLeg", "RightFoot": "RightLowerLeg",
}


def part_arrays(tris):
    arr = np.array(tris).reshape(-1, 8) if tris else np.zeros((0, 8))
    arr[:, 3:6] /= np.maximum(np.linalg.norm(arr[:, 3:6], axis=1, keepdims=True), 1e-9)
    return arr


# ---------- 出力1: アプリ内蔵ボクサー用のJSON ----------
def write_app_json(parts, joints, bone_world):
    def r5(a): return [round(float(x), 5) for x in a]
    def c3(p): return [round(float(x), 4) for x in p]
    out = {}
    for name, tris in parts.items():
        arr = part_arrays(tris)
        out[name] = {"positions": r5(arr[:, :3].ravel()), "normals": r5(arr[:, 3:6].ravel()), "uvs": r5(arr[:, 6:8].ravel())}
        print(f"{name:14s} {len(tris):4d} tris")
    json.dump(out, open(os.path.join(APP, "assets", "boxer_parts.json"), "w"), separators=(",", ":"))
    js = {k: {"bone": v["bone"], "radius": v["radius"], "center": c3(v["center"])} for k, v in joints.items()}
    json.dump({"joints": js, "skinColor": SKIN_COLOR}, open(os.path.join(APP, "assets", "boxer_joints.json"), "w"), separators=(",", ":"))
    # main.js の buildBoxerBoneHierarchy に書き写すボーンのワールド位置
    print("\n# bone world positions")
    for k, v in bone_world.items():
        print(f"{k:14s} {c3(v)}")


# ---------- 出力2: ボーン・スキン入りGLB ----------
def sphere(center, radius, w=14, h=12):
    pos, nrm, idx = [], [], []
    for iy in range(h + 1):
        v = iy / h
        for ix in range(w + 1):
            u = ix / w
            n = np.array([-math.cos(u * 2 * math.pi) * math.sin(v * math.pi), math.cos(v * math.pi), math.sin(u * 2 * math.pi) * math.sin(v * math.pi)])
            pos.append(center + n * radius)
            nrm.append(n)
    for iy in range(h):
        for ix in range(w):
            a, b = iy * (w + 1) + ix + 1, iy * (w + 1) + ix
            c_, d = (iy + 1) * (w + 1) + ix, (iy + 1) * (w + 1) + ix + 1
            if iy != 0:
                idx.append((a, b, d))
            if iy != h - 1:
                idx.append((b, c_, d))
    return np.array(pos), np.array(nrm), np.array(idx)


def write_glb(parts, joints, bone_world, img, out_path, name):
    bones = list(PARENT.keys())
    bidx = {b: i for i, b in enumerate(bones)}
    # 身体パーツ: パーツごとに頂点を重複除去してインデックス化
    pos, nrm, uv, jnt, idx = [], [], [], [], []
    for pname, tris in parts.items():
        arr = part_arrays(tris)
        key = {}
        for row in np.round(arr, 6):
            k = tuple(row)
            if k not in key:
                key[k] = len(pos)
                pos.append(row[:3]); nrm.append(row[3:6]); uv.append(row[6:8]); jnt.append(bidx[pname])
            idx.append(key[k])
    # 関節カバー球(テクスチャなしの肌色マテリアル、別プリミティブ)
    spos, snrm, sjnt, sidx = [], [], [], []
    for jv in joints.values():
        p, n_, t = sphere(np.asarray(jv["center"], float), jv["radius"])
        sidx.extend((t + len(spos)).ravel().tolist())
        spos.extend(p); snrm.extend(n_); sjnt.extend([bidx[jv["bone"]]] * len(p))

    bin_ = bytearray()
    views, accs = [], []
    def add(data, comp, typ, target=None, minmax=False):
        while len(bin_) % 4:
            bin_.append(0)
        raw = data.tobytes()
        v = {"buffer": 0, "byteOffset": len(bin_), "byteLength": len(raw)}
        if target:
            v["target"] = target
        views.append(v)
        bin_.extend(raw)
        count = data.shape[0]
        a = {"bufferView": len(views) - 1, "componentType": comp, "count": count, "type": typ}
        if minmax:
            a["min"] = data.min(0).tolist(); a["max"] = data.max(0).tolist()
        accs.append(a)
        return len(accs) - 1

    def prim(P_, N_, J_, I_, U_=None, material=0):
        J4 = np.zeros((len(J_), 4), np.uint8); J4[:, 0] = J_
        W4 = np.zeros((len(J_), 4), np.float32); W4[:, 0] = 1
        attrs = {
            "POSITION": add(np.asarray(P_, np.float32), 5126, "VEC3", 34962, True),
            "NORMAL": add(np.asarray(N_, np.float32), 5126, "VEC3", 34962),
            "JOINTS_0": add(J4, 5121, "VEC4", 34962),
            "WEIGHTS_0": add(W4, 5126, "VEC4", 34962),
        }
        if U_ is not None:
            attrs["TEXCOORD_0"] = add(np.asarray(U_, np.float32), 5126, "VEC2", 34962)
        return {"attributes": attrs, "indices": add(np.asarray(I_, np.uint32), 5125, "SCALAR", 34963), "material": material}

    prims = [prim(pos, nrm, jnt, idx, uv, 0), prim(spos, snrm, sjnt, sidx, None, 1)]
    # inverseBindMatrices: 全ボーンが回転なしなので「ワールド位置の逆平行移動」になる(列優先)
    ibm = np.zeros((len(bones), 16), np.float32)
    for i, b in enumerate(bones):
        m = np.eye(4); m[:3, 3] = -bone_world[b]
        ibm[i] = m.T.ravel()
    ibm_acc = add(ibm, 5126, "MAT4")
    img_view = None
    if img:
        while len(bin_) % 4:
            bin_.append(0)
        views.append({"buffer": 0, "byteOffset": len(bin_), "byteLength": len(img[0])})
        bin_.extend(img[0]); img_view = len(views) - 1
    while len(bin_) % 4:
        bin_.append(0)

    nodes = [{"name": name, "mesh": 0, "skin": 0}]
    for b in bones:
        p = PARENT[b]
        local = bone_world[b] - (bone_world[p] if p else 0)
        nodes.append({"name": b, "translation": [round(float(x), 5) for x in local]})
    for b in bones:
        kids = [1 + bidx[k] for k, p in PARENT.items() if p == b]
        if kids:
            nodes[1 + bidx[b]]["children"] = kids
    srgb_to_lin = lambda c_: ((c_ / 255 + 0.055) / 1.055) ** 2.4
    gltf = {
        "asset": {"version": "2.0", "generator": "humanoid-gltf-exporter tools/tpose_rig.py"},
        "scene": 0,
        "scenes": [{"name": "Scene", "nodes": [0, 1 + bidx["Hips"]]}],
        "nodes": nodes,
        "meshes": [{"name": name, "primitives": prims}],
        "skins": [{"name": "Armature", "joints": [1 + i for i in range(len(bones))], "skeleton": 1 + bidx["Hips"], "inverseBindMatrices": ibm_acc}],
        "materials": [
            {"name": "body", "pbrMetallicRoughness": ({"baseColorTexture": {"index": 0}} if img else {}) | {"metallicFactor": 0, "roughnessFactor": 0.9}},
            {"name": "joint", "pbrMetallicRoughness": {"baseColorFactor": [srgb_to_lin(x) for x in SKIN_COLOR] + [1], "metallicFactor": 0, "roughnessFactor": 0.6}},
        ],
        "accessors": accs,
        "bufferViews": views,
        "buffers": [{"byteLength": len(bin_)}],
    }
    if img:
        gltf["images"] = [{"bufferView": img_view, "mimeType": img[1]}]
        gltf["samplers"] = [{"magFilter": 9729, "minFilter": 9987}]
        gltf["textures"] = [{"sampler": 0, "source": 0}]
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(bin_), 0x004E4942)); f.write(bin_)
    for pname, tris in parts.items():
        print(f"{pname:14s} {len(tris):5d} tris")
    print(f"wrote {out_path} ({total} bytes, {len(pos)} verts, {len(idx)//3} tris, {len(bones)} bones)")


if __name__ == "__main__":
    model = sys.argv[1] if len(sys.argv) > 1 else "boxer"
    if model == "boxer":
        src = os.path.join(APP, "..", "third-person-boxer-3d", "assets", "boxer.glb")
        write_app_json(*rig(src, PRESETS["boxer"])[:3])
    else:
        src, out = sys.argv[2], sys.argv[3]
        parts, joints, bone_world, img = rig(src, PRESETS[model])
        write_glb(parts, joints, bone_world, img, out, model)
