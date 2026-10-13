#!/usr/bin/env python3
"""写真(assets/hall.jpg, 1080x1440)から、固定カメラのゲーム用データ(assets/scene.json)を作る。
  やること:
   1) 床と壁の境目の線(2本)の交点 = 廊下の奥行き方向の消失点 から、カメラの向き(上下の傾き・横の向き)を求める
   2) 画角(焦点距離)は iPhone の標準カメラ(35mm換算26mm)を仮定。廊下の幅(WIDTH_M)から、カメラの高さを求める → 写真の1画素 ⇔ 床の1点(メートル) が相互に変換できる
   3) 床(歩ける範囲)と障害物の輪郭を、写真の画素で指定 → 床のメートル座標に直す
   4) 手前に来る物(親柱)の輪郭を切り抜くための多角形と、「キャラがこの物より奥にいるときだけ手前に重ねる」ための基準点を求める
  ※ 線・輪郭の点は、この写真を見て指定したもの(下の定数)。別の写真で使うときは、定数を書き換えて実行する(自動検出ではない)
  使い方: python3 tools/calibrate.py  → assets/scene.json
"""
import json, os, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
W_IMG, H_IMG = 1080, 1440
F = 1080.0                      # 焦点距離(画素)。iPhone標準カメラ(26mm相当)なら約 1.0 × 画像の幅
CX, CY = W_IMG / 2, H_IMG / 2   # 主点は画像の中心
WIDTH_M = 1.8                   # 左の壁の線〜右の壁の線の距離(m)。廊下の幅の見積もり
CHAR_SCALE = 0.92               # キャラの大きさ(元の約1.74m → 約1.6m)
S = 1080 / 1352                 # 点を指定した確認用の画像(幅1352)の座標 → hall.jpg の座標
def G(x, y): return np.array([x * S, y * S])

# --- 1) 壁と床の境目の線 ---
LEFT_LINE = (G(430, 1050), G(265, 1260))     # 左: ふすまの下の線
RIGHT_LINE = (G(1150, 1390), G(1230, 1700))  # 右: 右の壁の巾木の線
# --- 3) 床と障害物(確認用画像の座標) ---
WALKABLE = [(540, 930), (705, 950), (742, 1392), (1150, 1392), (1245, 1760), (300, 1762), (355, 1720), (345, 1415), (203, 1335)]
OBSTACLES = {
  "scratcher": [(1055, 1412), (1165, 1412), (1222, 1690), (1085, 1722)],   # 右の爪とぎ
}
CIRCLES = {"newel_post": ((687, 1342), 0.2)}   # 親柱(階段の手すりの柱): 足元の点・半径(m)
# 手前に来る物の輪郭(親柱と段ボールの巻きつき)。キャラが奥にいるとき、この形で写真を上に重ねて、キャラを隠す
OCCLUDERS = {
  "newel_post": {"poly": [(646, 690), (695, 690), (700, 800), (742, 930), (745, 1250), (735, 1347), (668, 1352), (645, 1240), (645, 935), (648, 800)], "anchor": (687, 1342)},
}
START_FLOOR = (0.5, 2.4)   # はじめの位置(床の座標 m): 左の壁ぞいの通路、カメラから少し離れたところ

K = np.array([[F, 0, CX], [0, F, CY], [0, 0, 1]]); Ki = np.linalg.inv(K)
def line(a, b): return np.cross([*a, 1], [*b, 1])
vp = np.cross(line(*LEFT_LINE), line(*RIGHT_LINE)); vp = vp[:2] / vp[2]
D = Ki @ np.array([*vp, 1]); D /= np.linalg.norm(D)
if D[2] < 0: D = -D
up = np.array([0, -D[2], D[1]]); up /= np.linalg.norm(up)
if up[1] > 0: up = -up
right = np.cross(D, up)
if right[0] < 0: right = -right
def ray(p): r = Ki @ np.array([p[0], p[1], 1]); return r / np.linalg.norm(r)
def floor_rel(p, h):
    r = ray(p); t = -h / np.dot(up, r); Xc = r * t; return np.array([np.dot(Xc, right), np.dot(Xc, D)])
w1 = abs(floor_rel(RIGHT_LINE[0], 1.0)[0] - floor_rel(LEFT_LINE[0], 1.0)[0])
h = WIDTH_M / w1
x0 = floor_rel(LEFT_LINE[0], h)[0]
def to_floor(p):  # 画素 → 床の座標(X: 左の壁から右へ(m), Z: 奥へ(m)。カメラの真下が Z=0)
    q = floor_rel(p, h); return [float(q[0] - x0), float(q[1])]
cam_X = -x0
# --- Three.js 用のカメラ: 世界座標 x = X(右)、y = 上、z = -Z(奥が -z) ---
def basis(a):  # カメラ座標(x右 y下 z前)のベクトル a を、世界座標へ
    return [float(np.dot(a, right)), float(np.dot(a, up)), float(-np.dot(a, D))]
x3 = basis(np.array([1, 0, 0])); y3 = basis(np.array([0, -1, 0])); z3 = basis(np.array([0, 0, -1]))
def poly(pts): return [to_floor(G(*p)) for p in pts]
scene = {
  "image": "assets/hall.jpg", "imageW": W_IMG, "imageH": H_IMG, "focalPx": F, "charScale": CHAR_SCALE,
  "camera": {"pos": [float(cam_X), float(h), 0.0], "xAxis": x3, "yAxis": y3, "zAxis": z3, "fovDeg": float(2 * np.degrees(np.arctan((H_IMG / 2) / F)))},
  "vanishingPoint": [float(vp[0]), float(vp[1])], "widthM": WIDTH_M,
  "walkable": poly(WALKABLE),
  "obstaclePolys": {k: poly(v) for k, v in OBSTACLES.items()},
  "obstacleCircles": {k: {"c": to_floor(G(*c)), "r": r} for k, (c, r) in CIRCLES.items()},
  "occluders": {k: {"poly": [[float(G(*p)[0]), float(G(*p)[1])] for p in v["poly"]], "anchor": to_floor(G(*v["anchor"]))} for k, v in OCCLUDERS.items()},
  "start": list(START_FLOOR), "startHeading": 0.0,
}
# 階段の側面(右の境界)は、床の上では壁と平行(X が一定)なので、写真の斜めの線ではなく、手前の角(C)の X に揃える
scene["walkable"][1][0] = scene["walkable"][2][0]; scene["walkable"][0][0] = max(0.0, scene["walkable"][0][0])
open(os.path.join(HERE, "..", "assets", "scene.json"), "w").write(json.dumps(scene, ensure_ascii=False, indent=1))
print("camera height %.2fm, camera X %.2fm, vanishing point (%.0f,%.0f), fov %.1f deg" % (h, cam_X, vp[0], vp[1], scene["camera"]["fovDeg"]))
print("walkable (X,Z):", [[round(a, 2), round(b, 2)] for a, b in scene["walkable"]])
print("start", [round(v, 2) for v in scene["start"]], "post", [round(v, 2) for v in scene["obstacleCircles"]["newel_post"]["c"]])
