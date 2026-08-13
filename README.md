# games

いろいろなゲームの作成・挙動検証をするためのリポジトリです。`games/` 配下にゲームごとにフォルダを分けて追加していきます。

## 収録ゲーム

- [maze-runner-3d](games/maze-runner-3d) — Three.js製の3D迷路アクションゲーム
- [pinball-3d](games/pinball-3d) — Three.js製の3Dピンボール
- [shogi](games/shogi) — CPU対戦の将棋(2D)
- [batting-center-3d](games/batting-center-3d) — Three.js製の3Dバッティングセンター
- [bump-combat-prototype](games/bump-combat-prototype) — イース風体当たり戦闘の操作感検証プロトタイプ(2D)
- [rail-shooter-3d](games/rail-shooter-3d) — Three.js製の疑似3D奥スクロールガンシューティング
- [konbini-cashier](games/konbini-cashier) — コンビニレジ打ちシミュレーション(2D)
- [sling-battle-3d](games/sling-battle-3d) — Three.js製、自キャラを引っ張って発射するアリーナバトル
- [street-duel-prototype](games/street-duel-prototype) — 上段/下段パンチとガードで押し合う路上デュエルプロトタイプ(2D)
- [yamanote-loop-map](games/yamanote-loop-map) — 山手線30駅をループ状の壁にしたRPGフィールドマップ(2D)
- [whip-physics-3d](games/whip-physics-3d) — Three.js製、質量テーパリングVerletチェーンによる鞭打ち効果の物理シミュレーション
- [world-rogue](games/world-rogue) — シームレスオープンフィールド型ターン制ローグライクRPG(第1弾: ワールド+8方向移動+戦闘+レベルアップ、2D)
- [ship-it-sim](games/ship-it-sim) — HTML/CSS/JS/PHPでWebサービスを作りiOSアプリとして リリースするまでの開発工程を6つのミニゲームで駆け抜ける開発工程ミニゲー集(2D)
- [counter-punch-3d](games/counter-punch-3d) — Three.js製、左右スワイプでパンチを躱しタップで反撃する一人称ボクシングアクション
- [photo-spin-3d](games/photo-spin-3d) — 1枚の写真から簡易な奥行きを推測し、ドラッグ&ピンチで360度グルグル回して見られる疑似3Dビューア(Three.js製)
- [kanegasaki-retreat](games/kanegasaki-retreat) — 「金ヶ崎の戦い」を題材にしたマス目移動のターン制戦術SRPG。敵の全滅ではなく織田軍の撤退が目的(2D)
- [corridor-walk-3d](games/corridor-walk-3d) — 1枚の廊下の写真を固定背景に、ラジコン操作で3Dキャラを歩かせる初代バイオハザード風プロトタイプ(Three.js製)
- [midnight-rooftop-3d](games/midnight-rooftop-3d) — 深夜のビルに侵入し、合鍵を集めて屋上へ脱出する一人称視点の3D迷路探索ゲーム(Three.js製)

## 公開ページ

GitHub Pages でホストしています: https://shmind369.github.io/games/

main への push で GitHub Actions が自動的にビルド・デプロイします。

**初回のみ手動設定が必要です**(GitHub側の権限仕様により、ワークフローからはPagesの初回有効化ができません):
リポジトリの Settings → Pages → Build and deployment → Source を「GitHub Actions」に設定してください。
設定後は再度 push するか、Actions タブから "Deploy Pages" ワークフローを再実行すると公開されます。
