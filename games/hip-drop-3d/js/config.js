// 調整用パラメータを1か所に集約(操作感のチューニングはここだけ触ればよい)
export const PHYS = {
  dt: 1 / 120,              // 固定時間刻み [s](フレームレート非依存)
  maxSubSteps: 12,
};

export const PLAYER = {
  radius: 0.38,
  height: 1.1,

  // 地上移動
  runSpeed: 7.2,            // 最高速 [m/s]
  groundAccel: 60,          // 加速 [m/s^2]
  groundDecel: 70,          // 入力なし時の減速
  turnRate: 16,             // 向きの追従速度 [rad/s 相当の係数]

  // ---- 空中制御(勢いを保ったまま、地上より緩やかに向きを変える) ----
  airAccel: 22,             // 走行速度より遅いときの加速 [m/s^2]
  airDecel: 3,              // 入力なしのときの減速(ゆるやか。急停止しない)
  airBrake: 16,             // 進行方向と逆に入力したときの減速
  airTurnRate: 3.2,         // 空中で進行方向を回せる速さ [rad/s](地上はほぼ即時)
  airOverspeedDecel: 1.2,   // 走行速度を超えている分(走り幅跳びの勢い)の空中での目減り [m/s^2]
  groundOverspeedDecel: 12, // 着地後、走行速度を超えている分を落とす速さ(急減速しない)

  // ---- 通常ジャンプ(静止・歩行からのタップ / Space) ----
  jumpHeight: 2.5,          // 最高到達点の高さ [m](水平速度はそのまま引き継ぐ)
  gravityUp: 30,            // 上昇中の重力
  gravityDown: 46,          // 落下中の重力(早めに落ちてキビキビ)
  jumpCutMul: 0.45,         // ボタンを早く離したときの上昇速度の残り割合(小ジャンプ。従来操作のみ)
  maxFall: 26,
  coyoteTime: 0.1,          // 足場から落ちた直後でもジャンプできる猶予
  jumpBuffer: 0.13,         // 着地直前の入力を覚えておく時間

  // ---- 走り幅跳び(走行中の上フリック / L キー) ----
  longJumpHeight: 1.9,      // 最高到達点の高さ [m](通常より低く、長く飛ぶ)
  longJumpGravityMul: 0.65, // 走り幅跳び中の重力倍率(ふわっと伸びる)
  longJumpSpeedMul: 1.45,   // 直前の走行速度に掛ける水平初速の倍率
  longJumpMinSpeed: 6.5,    // 水平初速の下限 [m/s]
  longJumpMaxSpeed: 11,     // 水平初速の上限 [m/s]
  longJumpMinRunFrac: 0.45, // 走行速度が runSpeed のこの割合以上のときだけ受け付ける
  speedMemory: 0.18,        // 入力判定にかかった時間で速度が落ちても、直近この秒数の最高速度で踏み切る

  // ヒップアタック
  hipMinHeight: 0.6,        // 地面からこの高さ未満では発動しない(低すぎると空振りになるため)
  hipWindup: 0.16,          // 空中で一瞬止まって回転する溜め [s]
  hipFallSpeed: 32,         // 急降下速度 [m/s]
  hipLandStun: 0.22,        // 着地後の硬直 [s]
  hipBounce: 13.5,          // 敵に命中したときの跳ね返り
  shockRadius: 2.4,         // 着地衝撃波で敵を倒す半径
  hipBuffer: 0.18,          // スワイプ入力を覚えておく時間

  // 被ダメージ
  maxHp: 3,
  hurtKnock: 9,
  hurtUp: 8,
  invincible: 1.4,
  fallY: -12,               // これより下に落ちたらミス
};

export const CAMERA = {
  distance: 7.2,
  height: 3.6,              // プレイヤー頭上からの高さ
  lookAhead: 1.2,           // 注視点を進行方向に少しずらす
  lookHeight: 1.0,
  posLerp: 7,               // 位置の追従の速さ
  yawFollow: 1.6,           // 移動中、カメラがプレイヤーの背後へ回り込む速さ
  dragYawSpeed: 0.009,      // 画面ドラッグでの回転量
  fovPortrait: 64,
  fovLandscape: 52,
  minDistance: 1.6,
};

export const ENEMY = {
  radius: 0.5,
  height: 0.8,
  speed: 2.0,
};

export const INPUT = {
  stickRadius: 56,          // 仮想スティックの可動半径 [px]
  deadZone: 0.12,
  swipeMinDy: 36,           // 下スワイプとみなす移動量 [px]
  swipeMaxTime: 0.35,       // この時間内に動かしたものだけスワイプ扱い [s]

  // 走り幅跳びの上フリック(全操作タイプのスティック共通)
  upFlickMinDist: 34,       // 上方向の移動量 [px]
  upFlickMinSpeed: 450,     // 速さ [px/s](ゆっくり上へドラッグ=前進、とは区別)
  upFlickMaxAngle: 35,      // 真上からのずれの許容角 [度]
  upFlickTime: 0.14,        // この時間内の動きで判定 [s]
  upFlickArmTime: 0.15,     // 移動を始めてからこの時間は判定しない(歩き出しの勢いと区別)[s]
  upFlickRearm: 0.35,       // 一度発動したら次に受け付けるまでの時間 [s]

  // ジェスチャー(操作タイプ 'gesture')
  moveThreshold: 15,        // 指の移動量がこれ以上で「移動」、未満なら「タップ」候補 [px]
  tapMaxTime: 0.28,         // これより長く触れていたらタップ(ジャンプ)にしない [s]

  // センターパッド(操作タイプ 'center')
  centerJumpRadius: 34,     // パッド中心からこの半径 [px] 以内を押したらジャンプ
  padGrabMargin: 36,        // パッドの外周からこの距離までの指もパッド操作として拾う [px]
  padFlickDy: 30,           // 空中でパッドを下へはらってヒップアタックとみなす移動量 [px]
};
