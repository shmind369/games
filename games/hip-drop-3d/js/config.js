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

  // 空中
  airAccel: 34,
  airDecel: 8,

  // ジャンプ
  jumpVelocity: 12.2,
  gravityUp: 30,            // 上昇中の重力
  gravityDown: 46,          // 落下中の重力(早めに落ちてキビキビ)
  jumpCutMul: 0.45,         // ボタンを早く離したときの上昇速度の残り割合(小ジャンプ)
  maxFall: 26,
  coyoteTime: 0.1,          // 足場から落ちた直後でもジャンプできる猶予
  jumpBuffer: 0.13,         // 着地直前の入力を覚えておく時間

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

  // センターパッド(操作タイプ 'center')
  centerJumpRadius: 34,     // パッド中心からこの半径 [px] 以内を押したらジャンプ
  padGrabMargin: 36,        // パッドの外周からこの距離までの指もパッド操作として拾う [px]
  padFlickDy: 30,           // 空中でパッドを下へはらってヒップアタックとみなす移動量 [px]
};
