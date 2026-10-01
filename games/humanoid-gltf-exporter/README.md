# HUMANOID GLTF EXPORTER

「iPhoneで3D人型モデルを簡単なアニメーションさせてGLTFやFBX形式に出力する
アプリを作れるか」という相談から、「まずHTMLで作れるか」という流れで
作成したプロトタイプです。ネイティブiOSアプリ(Swift)はこの環境では
ビルド・動作確認ができないため、まずブラウザで動作確認でき、かつ
Three.js公式の`GLTFExporter`がそのまま使えるWeb版として作成しました
(FBXは標準的な書き出し手段がなく対応困難なため、GLTF(.glb)のみに
絞っています)。

Three.js製。簡易的な人型スケルトン(19ボーン)に、各部位をプリミティブ
形状の`SkinnedMesh`として割り当て、簡単な「お辞儀をして手を振る」
アニメーションを再生する。ボタン一つで、再生中のアニメーションを
含んだ`.glb`(バイナリglTF)としてその場でダウンロードできる。

## 遊び方

`index.html` をブラウザで開くか、ローカルサーバーで配信してください。

```bash
cd games/humanoid-gltf-exporter
python3 -m http.server 8080
# http://localhost:8080 を開く
```

- ドラッグで視点を回転、ピンチ(またはホイール)でズームできる
  (OrbitControls)
- 「アニメーション停止/再生」ボタンでプレビューの再生・一時停止を
  切り替えられる
- 「GLTFを書き出す(.glb)」ボタンを押すと、現在のモデルとアニメーションを
  含んだ`humanoid.glb`がダウンロードされる(Blender・Unity・他のThree.js
  アプリ等、glTF 2.0に対応したツールで読み込み可能)

## 仕組みメモ

### スケルトンとSkinnedMesh

`THREE.Bone`で19個のボーン(Hips/Spine/Chest/Neck/Head、左右の肩・上腕・
前腕・手、左右の腿・すね・足)からなる簡易的な人型階層を構築し、
`THREE.Skeleton`にまとめている。

各部位の見た目(頭・胴体・腕・脚など、計18パーツ)は、カプセルや球などの
プリミティブ形状を`SkinnedMesh`として追加している。頂点はレストポーズの
時点での実際のワールド座標にそのまま配置し(`geometry.translate()`)、
各頂点を対応する1本のボーンに重み1.0で結びつけている
(`skinIndex`/`skinWeight`)。見た目は剛体パーツの組み合わせだが、
データとしては正式なスキン付きメッシュになっており、ボーンを動かせば
メッシュも追従し、そのままglTFのskin/jointsとして書き出せる。

**重要な実装上の注意**: `SkinnedMesh`はボーン(`THREE.Bone`)の子としてではなく、
スケルトンのルートと同じ`root`グループの子として追加する必要がある。
`GLTFExporter.parse(root, ...)`は`root`を起点にシーングラフを辿って
書き出すため、メッシュがこの階層の外(例えば`scene`に直接)に置かれていると
書き出し結果からメッシュが欠落してしまう(開発中に実際にこの不具合が
発生し、テストで検出・修正した)。

### アニメーション

`THREE.QuaternionKeyframeTrack`を3本(Spine・RightShoulder・RightForearm)
組み合わせた2秒間のループアニメーション(`THREE.AnimationClip`)を
「お辞儀をして手を振る」動きとして定義し、`THREE.AnimationMixer`で
プレビュー再生している。同じクリップを`GLTFExporter`の`animations`
オプションに渡すことで、書き出したglTFにもアニメーションが含まれる。

### ベンダーファイル

`vendor/three.module.min.js`は他のThree.js製ゲーム(`counter-punch-3d`等)
と同じrevision(r160)。`vendor/exporters/GLTFExporter.js`・
`vendor/controls/OrbitControls.js`・それらが依存する
`vendor/utils/TextureUtils.js`は、npm経由で取得した`three@0.160.0`
パッケージから同じrevisionのものを配置している(CDNへの直接アクセスは
環境上できなかったため)。

## テスト

Playwrightで以下を確認した。

- シーンが正しく初期化され、19本のボーンが構築されていること
- アニメーション(`RightForearm`ボーンの回転)が時間経過で実際に
  変化すること
- 「GLTFを書き出す」機能が、有効なGLTFバイナリ(glTF 2.0、ヘッダーの
  マジックナンバー・バージョン・ファイル長が正しい)を生成すること
- 書き出したglTFのJSONチャンクに、アニメーション(`Greeting`)・
  19ジョイントのskin・18個のメッシュが正しく含まれていること
- 書き出したglTFを`GLTFLoader`で実際に読み込み直し(ラウンドトリップ
  テスト)、アニメーション・スキンメッシュが揃っていること、頭と左足の
  ワールド座標の高低差が人間らしい身長(約1.3〜2.2m)に収まっていること

いずれもコンソールエラーなし(favicon 404を除く)で成功している。

## 今後について

これは「まずHTMLで動作確認する」ための試作のため、キャラクターの
見た目はプリミティブ形状のみ、アニメーションも1種類だけに留めている。
今後、より作り込んだモデル(カスタムジオメトリやテクスチャ)への
差し替えや、複数のアニメーションの切り替え、ネイティブiOSアプリ
(SceneKit/RealityKit)への移植などを検討する余地がある。
