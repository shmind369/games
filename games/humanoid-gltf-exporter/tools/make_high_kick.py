# 使い方: python3 tools/make_high_kick.py assets/animations/rightLowKick.json assets/china_rigged.glb assets/china_rigged_highkick.glb assets/animations/rightHighKick.json
# chinaモデル用の右ハイキック(回し蹴り)を生成し、JSON(このアプリの形式)と
# アニメーション「HighKick」を埋め込んだGLBを書き出す。構えはrightLowKickの0フレーム目を流用。
import json, struct, math, sys
import numpy as np
BASE_JSON, IN_GLB, OUT_GLB, OUT_JSON = sys.argv[1:5]
base = json.load(open(BASE_JSON))
BONES = base['boneNames']
stance = base['keyframes'][0]['pose']
STANCE_POS = np.array(base['keyframes'][0]['modelPosition'], float)
FPS = 30

def qmul(a, b):
    x1,y1,z1,w1 = a; x2,y2,z2,w2 = b
    return np.array([w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2,
                     w1*z2+x1*y2-y1*x2+z1*w2, w1*w2-x1*x2-y1*y2-z1*z2])
def axq(ax, deg):
    h = math.radians(deg)/2; v = np.zeros(3); v['xyz'.index(ax)] = math.sin(h)
    return np.array([*v, math.cos(h)])
def euler(x, y, z):  # three.js 'XYZ'
    return qmul(qmul(axq('x', x), axq('y', y)), axq('z', z))
def qrot(q, v):
    u = q[:3]; w = q[3]
    return 2*np.dot(u, v)*u + (w*w-np.dot(u, u))*v + 2*w*np.cross(u, v)
def slerp(a, b, t):
    a = np.array(a, float); b = np.array(b, float)
    d = np.dot(a, b)
    if d < 0: b = -b; d = -d
    if d > 0.9995:
        r = a + t*(b-a); return r/np.linalg.norm(r)
    th = math.acos(d)
    return (math.sin((1-t)*th)*a + math.sin(t*th)*b)/math.sin(th)

# ---- keyframes (euler degrees, XYZ). Unlisted bones keep the stance pose.
# Model faces +Z, its left side is +X. Hips +Y turns the body to the left.
K = [
 (0,  {}),
 # chamber: knee up high in front, hips start opening
 (10, {'Hips': (0, 40, -12), 'Spine': (0, 0, -8), 'Chest': (0, 5, -6), 'Head': (0, -35, 18),
       'RightUpperLeg': (-100, 0, -40), 'RightLowerLeg': (125, 0, 0), 'RightFoot': (35, 0, 0),
       'LeftUpperLeg': (-12, 0, 12), 'LeftLowerLeg': (20, 0, 0),
       'RightUpperArm': (-20, 0, -25), 'RightForearm': (-90, 0, 0)}),
 # pivot: hips turned sideways, thigh horizontal-up, shin still folded
 (13, {'Hips': (0, 80, -25), 'Spine': (0, 0, -12), 'Chest': (0, 0, -10), 'Head': (0, -70, 35),
       'RightUpperLeg': (-10, 0, -100), 'RightLowerLeg': (100, 0, 0), 'RightFoot': (40, 0, 0),
       'LeftUpperLeg': (0, 0, 25), 'LeftLowerLeg': (12, 0, 0),
       'RightUpperArm': (0, -20, 35), 'RightForearm': (-35, 0, 0),
       'LeftUpperArm': (-70, 0, 20), 'LeftForearm': (-100, 0, 0)}),
 # impact: knee snaps straight, foot at head height
 (16, {'Hips': (0, 90, -30), 'Spine': (0, 0, -14), 'Chest': (0, 0, -12), 'Head': (0, -80, 42),
       'RightUpperLeg': (0, 0, -100), 'RightLowerLeg': (5, 0, 0), 'RightFoot': (45, 0, 0),
       'LeftUpperLeg': (0, 0, 28), 'LeftLowerLeg': (8, 0, 0),
       'RightUpperArm': (0, -35, 65), 'RightForearm': (-20, 0, 0),
       'LeftUpperArm': (-75, 0, 20), 'LeftForearm': (-120, 0, 0)}),
 # hold
 (20, {'Hips': (0, 92, -30), 'Spine': (0, 0, -14), 'Chest': (0, 0, -12), 'Head': (0, -82, 42),
       'RightUpperLeg': (0, 0, -98), 'RightLowerLeg': (8, 0, 0), 'RightFoot': (45, 0, 0),
       'LeftUpperLeg': (0, 0, 28), 'LeftLowerLeg': (8, 0, 0),
       'RightUpperArm': (0, -35, 65), 'RightForearm': (-20, 0, 0),
       'LeftUpperArm': (-75, 0, 20), 'LeftForearm': (-120, 0, 0)}),
 # recoil: re-chamber the shin
 (25, {'Hips': (0, 70, -20), 'Spine': (0, 0, -10), 'Chest': (0, 0, -8), 'Head': (0, -60, 30),
       'RightUpperLeg': (-30, 0, -85), 'RightLowerLeg': (115, 0, 0), 'RightFoot': (35, 0, 0),
       'LeftUpperLeg': (-5, 0, 20), 'LeftLowerLeg': (18, 0, 0),
       'RightUpperArm': (0, -20, 30), 'RightForearm': (-60, 0, 0),
       'LeftUpperArm': (-70, 0, 15), 'LeftForearm': (-100, 0, 0)}),
 # leg coming down, body turning back
 (31, {'Hips': (0, 15, -5), 'Spine': (3, 0, -4), 'Head': (0, -12, 6),
       'RightUpperLeg': (-55, 0, -20), 'RightLowerLeg': (95, 0, 0), 'RightFoot': (20, 0, 0),
       'LeftUpperLeg': (-28, -5, 6), 'LeftLowerLeg': (40, 0, 0)}),
 # back to stance
 (40, {}),
]
TOTAL = K[-1][0]

def full_pose(over):
    p = {b: np.array(stance[b], float) for b in BONES}
    for b, e in over.items():
        p[b] = euler(*e)
    return p
KP = [(f, full_pose(o)) for f, o in K]

def ease(t):  # smooth in/out
    return t*t*(3-2*t)

# 書き出すのはキーフレームの時点だけ(エディタ同様、間は線形補間で再生される)
KEYS = [f for f, _ in K]
frames = []
for f in range(TOTAL+1):
    for i in range(len(KP)-1):
        if KP[i][0] <= f <= KP[i+1][0]:
            a, b = KP[i], KP[i+1]; break
    t = ease((f-a[0])/(b[0]-a[0]))
    frames.append({bn: slerp(a[1][bn], b[1][bn], t) for bn in BONES})

# ---- skeleton for FK (rest translations from the GLB)
raw = open(IN_GLB, 'rb').read()
jlen = struct.unpack('<I', raw[12:16])[0]
gj = json.loads(raw[20:20+jlen])
binoff = 20+jlen
blen = struct.unpack('<I', raw[binoff:binoff+4])[0]
binchunk = bytearray(raw[binoff+8:binoff+8+blen])
name2idx = {n['name']: i for i, n in enumerate(gj['nodes'])}
parent = {}
for i, n in enumerate(gj['nodes']):
    for c in n.get('children', []): parent[c] = i
HIPS_REST = np.array(gj['nodes'][name2idx['Hips']]['translation'], float)

def world(pose, bone):
    chain = []; i = name2idx[bone]
    while i in parent or gj['nodes'][i]['name'] == 'Hips':
        chain.append(i)
        if gj['nodes'][i]['name'] == 'Hips': break
        i = parent[i]
    pos = np.zeros(3); rot = np.array([0, 0, 0, 1.0])
    for i in reversed(chain):
        n = gj['nodes'][i]
        pos = pos + qrot(rot, np.array(n['translation'], float))
        rot = qmul(rot, pose[n['name']])
    return pos
# pin the support (left) foot at its stance position
anchor = world(frames[0], 'LeftFoot') + STANCE_POS
mpos = [anchor - world(fr, 'LeftFoot') for fr in frames]

# ---- JSON (same format as humanoid-gltf-exporter animations)
r = lambda v: [round(float(x), 5) for x in v]
out = {'formatVersion': 1, 'type': 'humanoid-pose-animation', 'name': 'rightHighKick',
       'fps': FPS, 'totalFrames': TOTAL, 'durationSeconds': round(TOTAL/FPS, 5), 'boneNames': BONES,
       'keyframes': [{'frame': f, 'time': round(f/FPS, 5), 'pose': {b: r(frames[f][b]) for b in BONES},
                      'modelPosition': r(mpos[f])} for f in KEYS]}
json.dump(out, open(OUT_JSON, 'w'), indent=2)

# ---- embed glTF animation
def add(data, comp, typ, count, mn=None, mx=None):
    global binchunk
    while len(binchunk) % 4: binchunk.append(0)
    off = len(binchunk); binchunk += data
    gj['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
    acc = {'bufferView': len(gj['bufferViews'])-1, 'componentType': 5126, 'count': count, 'type': typ}
    if mn is not None: acc['min'] = mn; acc['max'] = mx
    gj['accessors'].append(acc); return len(gj['accessors'])-1
times = np.array(KEYS, dtype=np.float32)/FPS
tacc = add(times.tobytes(), 5126, 'SCALAR', len(times), [0.0], [float(times[-1])])
samplers, channels = [], []
for b in BONES:
    arr = np.array([frames[f][b] for f in KEYS], np.float32)
    for f in range(1, len(arr)):  # keep hemisphere continuity
        if np.dot(arr[f], arr[f-1]) < 0: arr[f] = -arr[f]
    a = add(arr.tobytes(), 5126, 'VEC4', len(arr))
    samplers.append({'input': tacc, 'output': a, 'interpolation': 'LINEAR'})
    channels.append({'sampler': len(samplers)-1, 'target': {'node': name2idx[b], 'path': 'rotation'}})
tr = np.array([HIPS_REST + mpos[f] for f in KEYS], np.float32)
a = add(tr.tobytes(), 5126, 'VEC3', len(tr))
samplers.append({'input': tacc, 'output': a, 'interpolation': 'LINEAR'})
channels.append({'sampler': len(samplers)-1, 'target': {'node': name2idx['Hips'], 'path': 'translation'}})
gj['animations'] = [{'name': 'HighKick', 'samplers': samplers, 'channels': channels}]
while len(binchunk) % 4: binchunk.append(0)
gj['buffers'][0]['byteLength'] = len(binchunk)
js = json.dumps(gj, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
total = 12 + 8 + len(js) + 8 + len(binchunk)
with open(OUT_GLB, 'wb') as fo:
    fo.write(struct.pack('<III', 0x46546C67, 2, total))
    fo.write(struct.pack('<II', len(js), 0x4E4F534A)); fo.write(js)
    fo.write(struct.pack('<II', len(binchunk), 0x004E4942)); fo.write(binchunk)
rf = world(frames[16], 'RightFoot') + mpos[16]
print('keyframes', KEYS, 'impact right foot world', rf.round(3), 'head', (world(frames[16], 'Head')+mpos[16]).round(3))
