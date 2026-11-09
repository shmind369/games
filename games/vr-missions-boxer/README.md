# VR MISSIONS 3D（ボクサー ver）

`ver.html`（VR MISSIONS 3D // SNEAKING）の **プレイヤーの針金の人形を、ボクサーのモデルに置き換えた版**。
ステージ・視界コーン・警報・構え（一人称）視点・射撃・パンチ・バックミラーなど、ゲームの中身と操作は元のまま。

- 開く: `index.html`（three.js は `vendor/` のものを使う。ネット接続は不要。元の CDN 版 r128 からモジュール版に変更）
- 遊び方: 元のゲームと同じ（左スティック = 前後＋左右、右ドラッグ上 = 構え / 下 = 俯瞰、FIRE / PUNCH。PC は WASD・Q/E・Space・F）

## モデルと動き
- モデル: `assets/boxer_rigged.glb`（19ボーンのボクサー。`third-person-boxer-3d` / `humanoid-gltf-exporter` と同じもの）
- 立っているとき: **構えのアイドル**（`assets/fightIdleUsa.json`、ガードを上げて小さく揺れる2秒ループ）
- 歩くとき: 上半身は構えのまま、**下半身だけ歩き**（`assets/walk.json`）。後ろ歩きは逆再生
- PUNCH: 上半身に **右ストレート**（`assets/rightStraight.json`）を重ねる
- 通路（1マス=1m）・壁（2m）に合わせて 0.8 倍（身長 約1.4m。`CHAR_SCALE`）
- キャラ用のライトを追加（背景・敵は元のワイヤーフレームのまま、ライトの影響を受けない）
- 壁際でカメラが自機に近づきすぎたときは、ボクサーを半透明→非表示にして視界をふさがない（元の細い針金人形より太いため）
