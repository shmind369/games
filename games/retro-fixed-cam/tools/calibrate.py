#!/usr/bin/env python3
"""写真(1080x1440)から、固定カメラのゲーム用データ(assets/sceneN.json)を作る。シーンごとの設定は SCENES に書く。
  やること:
   1) 床と壁の境目の線(2本)の交点 = 廊下の奥行き方向の消失点 から、カメラの向き(上下の傾き・横の向き)を求める
   2) 画角(焦点距離)は iPhone の標準カメラ(35mm換算26mm)を仮定。廊下の幅(WIDTH_M)、またはカメラの高さ(CAM_HEIGHT)から、残りを求める
      → 写真の1画素 ⇔ 床の1点(メートル) が相互に変換できる
   3) 床(歩ける範囲)・障害物・シーンの出入口(ゲート)の輪郭を、写真の画素で指定 → 床のメートル座標に直す
   4) 手前に来る物の輪郭を切り抜くための多角形と、「キャラがこの物より奥にいるときだけ手前に重ねる」ための基準点を求める
  ※ 線・輪郭の点は、写真を見て指定したもの(下の設定)。別の写真で使うときは、設定を書き換えて実行する(自動検出ではない)
  使い方: python3 tools/calibrate.py  → assets/scene1.json, assets/scene2.json
"""
import json, os, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
W_IMG, H_IMG = 1080, 1440
F = 1080.0                      # 焦点距離(画素)。iPhone標準カメラ(26mm相当)なら約 1.0 × 画像の幅
CX, CY = W_IMG / 2, H_IMG / 2   # 主点は画像の中心
CHAR_SCALE = 0.92               # キャラの大きさ(元の約1.74m → 約1.6m)
S1 = 1080 / 1352                # シーン1: 点を指定した確認用の画像(幅1352)の座標 → 1080x1440 の座標

SCENES = [
  { "name": "scene1", "photo": "assets/hall1.jpg", "scale": S1,
    # 壁と床の境目の線: 左 = ふすまの下 / 右 = 右の壁の巾木
    "left_line": ((430, 1050), (265, 1260)), "right_line": ((1150, 1390), (1230, 1700)), "width_m": 1.8,
    "walkable": [(540, 930), (705, 950), (742, 1392), (1150, 1392), (1245, 1760), (300, 1762), (355, 1720), (345, 1415), (203, 1335)],
    "straighten_right": True,   # 階段の側面(右の境界)は、床の上では壁と平行 → 手前の角の X に揃える
    "obstacles": { "scratcher": [(1055, 1412), (1165, 1412), (1222, 1690), (1085, 1722)] },   # 右の爪とぎ
    "circles": { "newel_post": ((687, 1342), 0.2) },                                         # 親柱: 足元の点・半径(m)
    "occluders": { "newel_post": { "poly": [(646, 690), (695, 690), (700, 800), (742, 930), (745, 1250), (735, 1347), (668, 1352), (645, 1240), (645, 935), (648, 800)], "anchor": (687, 1342) } },
    "start_floor": (0.5, 2.4), "start_heading": 0.0,
    # ゲート: 廊下の奥の端(机のそば。Z 3.82m〜)まで歩くと、シーン2へ。出現位置・向きは、シーン2の右下の机のそば(床 X 1.11m, Z 2.19m)で、左(-X)向き(271°)
    "gates": [ { "name": "to_scene2", "floor_poly": [(-0.3, 3.82), (1.3, 3.82), (1.3, 5.0), (-0.3, 5.0)], "to": 1, "enter_floor": (1.11, 2.19), "enter_theta_deg": 271 } ] },
  { "name": "scene2", "photo": "assets/hall2.jpg", "scale": 1.0,
    # 奥の廊下の、左の壁の巾木の線と、右の壁の巾木の線
    "left_line": ((178, 1040), (258, 805)), "right_line": ((421, 1048), (395, 905)), "cam_height": 1.62,
    "walkable": [(249, 830), (382, 830), (421, 1048), (432, 1235), (505, 1222), (660, 1205), (700, 1300), (702, 1430), (110, 1430), (100, 1300), (165, 1090), (178, 1040)],
    "obstacles": {}, "circles": {}, "occluders": {},
    "start_floor": (1.11, 2.19), "start_heading": 271 * 3.141592653589793 / 180,
    # ゲート: 手前(カメラ側)の端まで来ると、シーン1へ(奥の端から、カメラのほうへ向かって入る)
    "gates": [ { "name": "to_scene1", "img_poly": [(0, 1340), (720, 1340), (720, 1440), (0, 1440)], "to": 0, "enter_floor": (0.50, 3.6), "enter_theta_deg": 180 } ] },
]

K = np.array([[F, 0, CX], [0, F, CY], [0, 0, 1]]); Ki = np.linalg.inv(K)
def line(a, b): return np.cross([*a, 1], [*b, 1])
def build(cfg):
    sc = cfg["scale"]; G = lambda x, y: np.array([x * sc, y * sc])
    L = [G(*p) for p in cfg["left_line"]]; R = [G(*p) for p in cfg["right_line"]]
    vp = np.cross(line(*L), line(*R)); vp = vp[:2] / vp[2]
    D = Ki @ np.array([*vp, 1]); D /= np.linalg.norm(D)
    if D[2] < 0: D = -D
    up = np.array([0, -D[2], D[1]]); up /= np.linalg.norm(up)
    if up[1] > 0: up = -up
    right = np.cross(D, up)
    if right[0] < 0: right = -right
    def ray(p): r = Ki @ np.array([p[0], p[1], 1]); return r / np.linalg.norm(r)
    def floor_rel(p, h):
        r = ray(p); t = -h / np.dot(up, r); Xc = r * t; return np.array([np.dot(Xc, right), np.dot(Xc, D)])
    w1 = abs(floor_rel(R[0], 1.0)[0] - floor_rel(L[0], 1.0)[0])
    if "cam_height" in cfg: h = cfg["cam_height"]; width = w1 * h
    else: width = cfg["width_m"]; h = width / w1
    x0 = floor_rel(L[0], h)[0]
    to_floor = lambda p: [float(v) for v in (floor_rel(p, h) - np.array([x0, 0]))]
    basis = lambda a: [float(np.dot(a, right)), float(np.dot(a, up)), float(-np.dot(a, D))]
    poly = lambda pts: [to_floor(G(*p)) for p in pts]
    walk = poly(cfg["walkable"])
    if cfg.get("straighten_right"): walk[1][0] = walk[2][0]; walk[0][0] = max(0.0, walk[0][0])
    gates = []
    for g in cfg["gates"]:
        gp = g["floor_poly"] if "floor_poly" in g else poly(g["img_poly"])
        gates.append({"name": g["name"], "poly": [list(p) for p in gp], "to": g["to"], "enter": list(g["enter_floor"]) if "enter_floor" in g else None, "enterTheta": (g["enter_theta_deg"] * np.pi / 180 if "enter_theta_deg" in g else None), "_enter_img": g.get("enter_img")})
    start = list(cfg["start_floor"]) if "start_floor" in cfg else to_floor(G(*cfg["start_img"]))
    scene = {
      "name": cfg["name"], "image": cfg["photo"], "imageW": W_IMG, "imageH": H_IMG, "focalPx": F, "charScale": CHAR_SCALE,
      "camera": {"pos": [float(-x0), float(h), 0.0], "xAxis": basis(np.array([1, 0, 0])), "yAxis": basis(np.array([0, -1, 0])), "zAxis": basis(np.array([0, 0, -1])), "fovDeg": float(2 * np.degrees(np.arctan((H_IMG / 2) / F)))},
      "vanishingPoint": [float(vp[0]), float(vp[1])], "widthM": float(width),
      "walkable": walk,
      "obstaclePolys": {k: poly(v) for k, v in cfg["obstacles"].items()},
      "obstacleCircles": {k: {"c": to_floor(G(*c)), "r": r} for k, (c, r) in cfg["circles"].items()},
      "occluders": {k: {"poly": [[float(G(*p)[0]), float(G(*p)[1])] for p in v["poly"]], "anchor": to_floor(G(*v["anchor"]))} for k, v in cfg["occluders"].items()},
      "gates": gates, "start": start, "startHeading": cfg["start_heading"],
    }
    return scene, h, vp, to_floor, G
built = [build(cfg) for cfg in SCENES]
# ゲートの出現位置: 「向こうのシーンの写真の画素」で指定してあるものは、向こうのシーンの校正で床の座標に直す
for scene, h, vp, tf, G in built:
    for g in scene["gates"]:
        if g["_enter_img"] is not None:
            _, _, _, tf2, G2 = built[g["to"]]; g["enter"] = tf2(G2(*g["_enter_img"]))
        del g["_enter_img"]
for i, cfg in enumerate(SCENES):
    scene, h, vp, _, _ = built[i]
    open(os.path.join(HERE, "..", "assets", "scene%d.json" % (i + 1)), "w").write(json.dumps(scene, ensure_ascii=False, indent=1))
    print("%s: camera height %.2fm, camera X %.2fm, width %.2fm, vanishing point (%.0f,%.0f)" % (cfg["name"], h, scene["camera"]["pos"][0], scene["widthM"], vp[0], vp[1]))
    print("  walkable (X,Z):", [[round(a, 2), round(b, 2)] for a, b in scene["walkable"]])
    print("  start", [round(v, 2) for v in scene["start"]], "gates:", [(g["name"], [round(v, 2) for v in g["enter"]]) for g in scene["gates"]])
