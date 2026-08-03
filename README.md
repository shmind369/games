# games

いろいろなゲームの作成・挙動検証をするためのリポジトリです。`games/` 配下にゲームごとにフォルダを分けて追加していきます。

## 収録ゲーム

- [maze-runner-3d](games/maze-runner-3d) — Three.js製の3D迷路アクションゲーム
- [pinball-3d](games/pinball-3d) — Three.js製の3Dピンボール
- [shogi](games/shogi) — CPU対戦の将棋(2D)
- [batting-center-3d](games/batting-center-3d) — Three.js製の3Dバッティングセンター
- [bump-combat-prototype](games/bump-combat-prototype) — イース風体当たり戦闘の操作感検証プロトタイプ(2D)

## 公開ページ

GitHub Pages でホストしています: https://shmind369.github.io/games/

main への push で GitHub Actions が自動的にビルド・デプロイします。

**初回のみ手動設定が必要です**(GitHub側の権限仕様により、ワークフローからはPagesの初回有効化ができません):
リポジトリの Settings → Pages → Build and deployment → Source を「GitHub Actions」に設定してください。
設定後は再度 push するか、Actions タブから "Deploy Pages" ワークフローを再実行すると公開されます。
