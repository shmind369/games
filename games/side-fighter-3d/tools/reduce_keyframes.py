#!/usr/bin/env python3
"""モーションJSON(humanoid-pose-animation)のキーフレームを減らす(後で編集しやすくするため)。

使い方:
  python3 tools/reduce_keyframes.py assets/foo.json [--keys 5] [--max-keys 10] [--tol 0.06] [--trim-tail]

・元のフレームの中から、「間を補間(slerp/lerp)したときに元の動きからのずれが最も大きいフレーム」を
  1つずつ足していき、キーを選ぶ。まず --keys 個で試し、ずれが --tol(ラジアン)を超えていたら、
  --max-keys 個になるまで増やす。最初と最後のフレームは必ず残す(ループ素材は最初=最後のまま)
・ずれ = 全ボーンの回転のずれ(ラジアン)と、modelPosition のずれ(1m = 3rad 換算)の最大値
・--trim-tail: 最後に「構えに戻って止まっている」部分(同じ姿勢が続く末尾)を切り落とす
・結果は同じファイルに上書きする(元に戻すにはgitを使う)
"""
import json, math, sys, argparse

def slerp(a, b, t):
    dot = sum(x * y for x, y in zip(a, b))
    if dot < 0: b = [-x for x in b]; dot = -dot
    if dot > 0.9995:
        q = [x + (y - x) * t for x, y in zip(a, b)]
    else:
        th = math.acos(dot); s = math.sin(th)
        q = [(math.sin((1 - t) * th) * x + math.sin(t * th) * y) / s for x, y in zip(a, b)]
    n = math.sqrt(sum(x * x for x in q)); return [x / n for x in q]

def angle(a, b):
    return 2 * math.acos(min(1.0, abs(sum(x * y for x, y in zip(a, b)))))

def interp(keys, idx, t):
    # idx: 選んだキーの添字(昇順)。時刻tでの姿勢・位置
    lo = max(i for i in idx if keys[i]['time'] <= t + 1e-9)
    hi = min(i for i in idx if keys[i]['time'] >= t - 1e-9)
    a, b = keys[lo], keys[hi]
    f = 0 if hi == lo else (t - a['time']) / (b['time'] - a['time'])
    pose = {n: slerp(a['pose'][n], b['pose'][n], f) for n in a['pose']}
    am, bm = a.get('modelPosition', [0, 0, 0]), b.get('modelPosition', [0, 0, 0])
    return pose, [am[k] + (bm[k] - am[k]) * f for k in range(3)]

def frame_error(keys, idx, i):
    pose, mp = interp(keys, idx, keys[i]['time'])
    o = keys[i]
    e = max((angle(pose[n], o['pose'][n]) for n in pose), default=0)
    om = o.get('modelPosition', [0, 0, 0])
    return max(e, 3 * max(abs(mp[k] - om[k]) for k in range(3)))

def reduce(keys, n_keys, max_keys, tol):
    idx = [0, len(keys) - 1]
    def worst():
        errs = [(frame_error(keys, idx, i), i) for i in range(len(keys)) if i not in idx]
        return max(errs) if errs else (0, None)
    while True:
        e, i = worst()
        if i is None: break
        if len(idx) >= max_keys: break
        if len(idx) >= n_keys and e <= tol: break
        idx = sorted(idx + [i])
    errs = [frame_error(keys, idx, i) for i in range(len(keys))]
    return idx, max(errs), sum(errs) / len(errs)

def trim_tail(keys):
    last = keys[-1]['pose']
    def same(a, b): return all(angle(a[n], b[n]) < 1.5e-2 for n in a)
    end = len(keys) - 1
    while end - 1 > 0 and same(keys[end - 1]['pose'], last): end -= 1
    return keys[:end + 1]

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('file'); ap.add_argument('--keys', type=int, default=5); ap.add_argument('--max-keys', type=int, default=10)
    ap.add_argument('--tol', type=float, default=0.06); ap.add_argument('--trim-tail', action='store_true')
    a = ap.parse_args()
    d = json.load(open(a.file)); keys = d['keyframes']; n0 = len(keys)
    if a.trim_tail: keys = trim_tail(keys)
    idx, emax, emean = reduce(keys, a.keys, a.max_keys, a.tol)
    out = []
    for i in idx:
        k = dict(keys[i]); k['frame'] = int(round(k['time'] * d.get('fps', 30))); out.append(k)
    d['keyframes'] = out
    d['totalFrames'] = out[-1]['frame'] + 1 if a.trim_tail else d.get('totalFrames', out[-1]['frame'] + 1)
    d['durationSeconds'] = round(out[-1]['time'], 4) if a.trim_tail else d.get('durationSeconds')
    json.dump(d, open(a.file, 'w'), ensure_ascii=False, indent=1)
    print(f"{a.file}: {n0} -> {len(out)} keys  (最大ずれ {emax:.3f} rad = {math.degrees(emax):.1f}°, 平均 {emean:.3f} rad)  frames={[k['frame'] for k in out]}")
