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

## 公開ページ

GitHub Pages でホストしています: https://shmind369.github.io/games/

main への push で GitHub Actions が自動的にビルド・デプロイします。

**初回のみ手動設定が必要です**(GitHub側の権限仕様により、ワークフローからはPagesの初回有効化ができません):
リポジトリの Settings → Pages → Build and deployment → Source を「GitHub Actions」に設定してください。
設定後は再度 push するか、Actions タブから "Deploy Pages" ワークフローを再実行すると公開されます。
