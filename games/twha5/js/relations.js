'use strict';

// 「国際関係」モード用の、国・勢力同士の関係性データ。js/wars.jsと同じ
// 方針で、自動生成ではなく手動で少しずつ蓄積していく想定。
//
// region_list(js/regions.js)のインデックスではなく、その年に地図上に
// 実際に表示される国名(ja表記。CountryList.js/Region.jsのregion_name[0]
// と同じもの)を文字列でそのまま指定する。理由: region_listは数千行に
// およぶ位置ベースの配列で、インデックスを直接指定するのは人間が手で
// データを追加していく上で非現実的なため。名前が変わる国をまたいで
// 関係が続く場合は、war_listの個々のエントリと同様に、名前が変わる
// タイミングでエントリを分けて追加する
//
// フィールド:
//   start, end: この関係が有効な年の範囲 [start, end)
//   a, b: 関係する双方の国・勢力の名前(ja表記。順不同)
//   type: 関係の種類。RELATION_TYPE_ICON/RELATION_TYPE_LABELのキーに
//         対応させる(war/alliance/hostile/diplomatic)。将来的に
//         同盟・属国・宗主国・朝貢・条約・貿易・婚姻関係など細分化
//         できるよう、この文字列を増やすだけで拡張できる作りにしている
//   label: (任意)関係の具体的な内容。{ja,en,zh}。省略時は
//          RELATION_TYPE_LABEL[type]の汎用的な文言を使う

// 関係の種類ごとのアイコン(js/WarMarker.jsのWAR_TYPE_ICONと同じ考え方)
const RELATION_TYPE_ICON = {
	war: '⚔',
	alliance: '🤝',
	hostile: '⚡',
	diplomatic: '🕊',
};
// 関係の種類ごとの汎用ラベル(labelが省略された場合に使う)
const RELATION_TYPE_LABEL = {
	war: { ja: '戦争', en: 'War', zh: '战争' },
	alliance: { ja: '同盟・協力', en: 'Alliance / cooperation', zh: '同盟·合作' },
	hostile: { ja: '敵対・緊張', en: 'Hostile / tension', zh: '敌对·紧张' },
	diplomatic: { ja: '外交・その他', en: 'Diplomatic / other', zh: '外交·其他' },
};

// まずは要望文中の例(エジプト・ローマの関係推移)をサンプルとして
// 少数だけ収録している。今後はこの配列に少しずつ追加していく。
//
// 注意: a/bには、その年にjs/regions.js側で実際に表示される名前
// (evaluate_region()が返すname[0]=ja表記。国名タップ時にdata-ja-name
// 属性として埋め込まれるのと同じもの)を正確に指定する必要がある。
// この期間(紀元前49〜30年)では、regions.js上でエジプトは
// 「プトレマイオス朝エジプト」、ローマは「ローマ共和国」という表記に
// なっている(地図上の縮小表示や一覧の見出しに出る「エジプト」
// 「ローマ」は、region_abbr(短縮表記)であり検索キーにはならない点に
// 注意)
const relation_list = [
	{ start: -49, end: -48, a: 'プトレマイオス朝エジプト', b: 'ローマ共和国', type: 'diplomatic',
		label: { ja: '外交・緊張(プトレマイオス朝の後継争いにローマが介入)' } },
	{ start: -48, end: -47, a: 'プトレマイオス朝エジプト', b: 'ローマ共和国', type: 'war',
		label: { ja: 'アレクサンドリア戦争' } },
	{ start: -47, end: -30, a: 'プトレマイオス朝エジプト', b: 'ローマ共和国', type: 'diplomatic',
		label: { ja: '外交・協力(クレオパトラとカエサル・アントニウス)' } },

	// --- 2010年の世界情勢スナップショット ---
	// 「2010年の世界の相関関係を収録してほしい」という要望に応え、主要国・
	// 主要な地域組織(NATO/EU/ASEAN等)を中心に85件を追加した。全ての
	// 国同士の組み合わせを網羅しているわけではなく、その年に特に注目
	// された関係(同盟・紛争・外交上の出来事など)を選んで収録した
	// スナップショットである。start=2010, end=2011で統一している
	//
	// a/bの表記は、js/regions.jsから2010年時点で実際に表示される名前
	// (フル名称)をスクリプトで抽出し、既存の関係(エジプト・ローマ)と
	// 同様に正確に一致させた上で追加している(例:
	// 「大ブリテンおよび北部アイルランド連合王国」「中華民國（台湾）」
	// 「(南部スーダン自治政府)」のように、括弧まで含めて正式表記通りに
	// 指定する必要がある地域もある)
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: '大ブリテンおよび北部アイルランド連合王国', type: 'alliance',
		label: { ja: '特別な関係(NATO・英米同盟)' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'フランス共和国', type: 'alliance',
		label: { ja: 'NATO加盟国' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'ドイツ連邦共和国', type: 'alliance',
		label: { ja: 'NATO加盟国' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'イタリア共和国', type: 'alliance',
		label: { ja: 'NATO加盟国' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'カナダ', type: 'alliance',
		label: { ja: 'NATO・NORAD' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'トルコ共和国', type: 'alliance',
		label: { ja: 'NATO加盟国' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'ポーランド共和国', type: 'alliance',
		label: { ja: 'NATO加盟国(ミサイル防衛配備合意)' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'オランダ王国', type: 'alliance',
		label: { ja: 'NATO加盟国' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'ノルウェー王国', type: 'alliance',
		label: { ja: 'NATO加盟国' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'スペイン', type: 'alliance',
		label: { ja: 'NATO加盟国' } },
	{ start: 2010, end: 2011, a: '大ブリテンおよび北部アイルランド連合王国', b: 'フランス共和国', type: 'alliance',
		label: { ja: 'NATO・英仏協力(ランカスターハウス条約へ)' } },
	{ start: 2010, end: 2011, a: 'ドイツ連邦共和国', b: 'フランス共和国', type: 'alliance',
		label: { ja: 'EU独仏枢軸' } },
	{ start: 2010, end: 2011, a: 'ドイツ連邦共和国', b: 'ポーランド共和国', type: 'diplomatic',
		label: { ja: 'EU加盟国・友好関係' } },
	{ start: 2010, end: 2011, a: 'フランス共和国', b: 'スペイン', type: 'alliance',
		label: { ja: 'EU加盟国' } },
	{ start: 2010, end: 2011, a: 'イタリア共和国', b: 'ドイツ連邦共和国', type: 'alliance',
		label: { ja: 'NATO・EU加盟国' } },
	{ start: 2010, end: 2011, a: '日本国', b: 'アメリカ合衆国', type: 'alliance',
		label: { ja: '日米安全保障条約' } },
	{ start: 2010, end: 2011, a: '大韓民国', b: 'アメリカ合衆国', type: 'alliance',
		label: { ja: '米韓相互防衛条約' } },
	{ start: 2010, end: 2011, a: '大韓民国', b: '日本国', type: 'diplomatic',
		label: { ja: '日韓併合100年(2010年)を巡る緊張と協力' } },
	{ start: 2010, end: 2011, a: '大韓民国', b: '朝鮮民主主義人民共和国', type: 'hostile',
		label: { ja: '天安沈没事件(3月)・延坪島砲撃事件(11月)' } },
	{ start: 2010, end: 2011, a: '朝鮮民主主義人民共和国', b: '中華人民共和国', type: 'alliance',
		label: { ja: '中朝友好協力相互援助条約' } },
	{ start: 2010, end: 2011, a: '中華人民共和国', b: '中華民國（台湾）', type: 'diplomatic',
		label: { ja: '両岸経済協力枠組協議(ECFA)締結(6月)で関係改善' } },
	{ start: 2010, end: 2011, a: '中華人民共和国', b: '日本国', type: 'hostile',
		label: { ja: '尖閣諸島中国漁船衝突事件(9月)' } },
	{ start: 2010, end: 2011, a: '中華人民共和国', b: 'アメリカ合衆国', type: 'diplomatic',
		label: { ja: '台湾への武器売却・通貨政策等を巡る緊張と経済的相互依存' } },
	{ start: 2010, end: 2011, a: 'ロシア連邦', b: '中華人民共和国', type: 'diplomatic',
		label: { ja: '上海協力機構(SCO)・戦略的協力' } },
	{ start: 2010, end: 2011, a: '中華人民共和国', b: 'ベトナム社会主義共和国', type: 'hostile',
		label: { ja: '南シナ海(西沙・南沙諸島)領有権問題' } },
	{ start: 2010, end: 2011, a: '中華人民共和国', b: 'フィリピン共和国', type: 'hostile',
		label: { ja: '南シナ海領有権問題' } },
	{ start: 2010, end: 2011, a: 'インド', b: 'パキスタン・イスラム共和国', type: 'hostile',
		label: { ja: 'カシミール問題・2008年ムンバイ同時多発テロ後の緊張' } },
	{ start: 2010, end: 2011, a: 'インド', b: '中華人民共和国', type: 'diplomatic',
		label: { ja: '国境問題(アクサイチン・アルナーチャル・プラデーシュ)を抱えつつ経済協力' } },
	{ start: 2010, end: 2011, a: 'アフガニスタン・イスラム国', b: 'アメリカ合衆国', type: 'war',
		label: { ja: 'アフガニスタン戦争(米軍増派中)' } },
	{ start: 2010, end: 2011, a: 'パキスタン・イスラム共和国', b: 'アメリカ合衆国', type: 'diplomatic',
		label: { ja: '対テロ協力と無人機空爆を巡る緊張' } },
	{ start: 2010, end: 2011, a: 'イスラエル国', b: 'パレスチナ暫定自治政府', type: 'hostile',
		label: { ja: 'ヨルダン川西岸の和平交渉停滞・入植問題' } },
	{ start: 2010, end: 2011, a: 'イスラエル国', b: 'ガザ政府', type: 'war',
		label: { ja: 'ガザ封鎖・ガザ支援船団襲撃事件(5月)' } },
	{ start: 2010, end: 2011, a: 'イスラエル国', b: 'レバノン共和国', type: 'hostile',
		label: { ja: '2006年レバノン侵攻後の緊張継続' } },
	{ start: 2010, end: 2011, a: 'イスラエル国', b: 'シリア・アラブ共和国', type: 'hostile',
		label: { ja: 'ゴラン高原を巡る対立' } },
	{ start: 2010, end: 2011, a: 'イスラエル国', b: 'イラン・イスラム共和国', type: 'hostile',
		label: { ja: '核開発を巡る対立(スタックスネット事案等)' } },
	{ start: 2010, end: 2011, a: 'イスラエル国', b: 'エジプト・アラブ共和国', type: 'diplomatic',
		label: { ja: '1979年エジプト・イスラエル平和条約' } },
	{ start: 2010, end: 2011, a: 'イスラエル国', b: 'トルコ共和国', type: 'hostile',
		label: { ja: 'ガザ支援船団襲撃事件(マヴィ・マルマラ号)を機に関係悪化' } },
	{ start: 2010, end: 2011, a: 'イラン・イスラム共和国', b: 'アメリカ合衆国', type: 'hostile',
		label: { ja: '核開発問題を巡る対立・追加制裁' } },
	{ start: 2010, end: 2011, a: 'イラク共和国', b: 'アメリカ合衆国', type: 'war',
		label: { ja: 'イラク戦争(8月に米軍戦闘任務終了、治安権限委譲は継続中)' } },
	{ start: 2010, end: 2011, a: 'サウジアラビア王国', b: 'イラン・イスラム共和国', type: 'hostile',
		label: { ja: '地域覇権を巡るスンニ派・シーア派対立' } },
	{ start: 2010, end: 2011, a: 'シリア・アラブ共和国', b: 'レバノン共和国', type: 'diplomatic',
		label: { ja: '2008年国交樹立後も影響力行使を巡り緊張' } },
	{ start: 2010, end: 2011, a: 'サウジアラビア王国', b: 'アメリカ合衆国', type: 'alliance',
		label: { ja: '戦略的同盟関係(大型武器売却合意)' } },
	{ start: 2010, end: 2011, a: 'カタール国', b: 'アメリカ合衆国', type: 'alliance',
		label: { ja: '米軍基地(アル・ウデイド空軍基地)受け入れ' } },
	{ start: 2010, end: 2011, a: 'ロシア連邦', b: 'グルジア', type: 'hostile',
		label: { ja: '2008年南オセチア紛争後、国交断絶状態' } },
	{ start: 2010, end: 2011, a: 'ロシア連邦', b: 'ウクライナ', type: 'diplomatic',
		label: { ja: '天然ガス供給契約・ハリコフ協定(黒海艦隊駐留延長)' } },
	{ start: 2010, end: 2011, a: 'ロシア連邦', b: 'アメリカ合衆国', type: 'diplomatic',
		label: { ja: '新戦略兵器削減条約(新START)調印(4月)' } },
	{ start: 2010, end: 2011, a: 'ロシア連邦', b: 'ベラルーシ共和国', type: 'alliance',
		label: { ja: '連合国家条約' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'キューバ共和国', type: 'hostile',
		label: { ja: '経済封鎖継続' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'ベネズエラ・ボリバル共和国', type: 'hostile',
		label: { ja: 'チャベス政権下での対立継続' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'ボリビア多民族国', type: 'hostile',
		label: { ja: '2008年米大使追放以降、関係悪化継続' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'メキシコ合衆国', type: 'diplomatic',
		label: { ja: '麻薬戦争を巡る協力(メリダ・イニシアチブ)' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'ブラジル連邦共和国', type: 'diplomatic',
		label: { ja: '経済協力関係' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'ホンジュラス共和国', type: 'diplomatic',
		label: { ja: '2009年クーデター後の新政権承認を巡る対米州機構との温度差' } },
	{ start: 2010, end: 2011, a: 'ベネズエラ・ボリバル共和国', b: 'コロンビア共和国', type: 'hostile',
		label: { ja: '国交断絶(7月)' } },
	{ start: 2010, end: 2011, a: 'アルゼンチン共和国', b: '大ブリテンおよび北部アイルランド連合王国', type: 'hostile',
		label: { ja: 'フォークランド(マルビナス)諸島沖油田開発を巡る緊張再燃' } },
	{ start: 2010, end: 2011, a: 'スーダン共和国', b: '(南部スーダン自治政府)', type: 'diplomatic',
		label: { ja: '包括和平合意(CPA)履行・南部独立住民投票(2011年1月)準備' } },
	{ start: 2010, end: 2011, a: 'スーダン共和国', b: 'チャド共和国', type: 'diplomatic',
		label: { ja: '国交正常化(1月)によるダルフール紛争を巡る緊張緩和' } },
	{ start: 2010, end: 2011, a: 'エチオピア連邦民主共和国', b: 'エリトリア国', type: 'hostile',
		label: { ja: '2000年国境紛争後の凍結状態が継続' } },
	{ start: 2010, end: 2011, a: 'ルワンダ共和国', b: 'コンゴ民主共和国', type: 'hostile',
		label: { ja: '東部コンゴの武装勢力を巡る緊張' } },
	{ start: 2010, end: 2011, a: '南アフリカ共和国', b: 'ジンバブエ共和国', type: 'diplomatic',
		label: { ja: '南部アフリカ開発共同体(SADC)による仲介外交' } },
	{ start: 2010, end: 2011, a: 'モロッコ王国（アラウィー朝）', b: 'サハラ・アラブ民主共和国', type: 'hostile',
		label: { ja: '西サハラ領有権問題' } },
	{ start: 2010, end: 2011, a: 'モロッコ王国（アラウィー朝）', b: 'アルジェリア民主人民共和国', type: 'hostile',
		label: { ja: '西サハラ問題により国境閉鎖状態(1994年以降)' } },
	{ start: 2010, end: 2011, a: 'ナイジェリア連邦共和国', b: 'カメルーン共和国', type: 'diplomatic',
		label: { ja: 'バカシ半島帰属問題解決(2008年)後の関係改善' } },
	{ start: 2010, end: 2011, a: 'ソマリア暫定連邦政府', b: 'ソマリランド共和国', type: 'diplomatic',
		label: { ja: '未承認国家ソマリランドの事実上の独立状態' } },
	{ start: 2010, end: 2011, a: 'ケニア共和国', b: 'ソマリア暫定連邦政府', type: 'diplomatic',
		label: { ja: 'アル・シャバーブ対策を巡る協力' } },
	{ start: 2010, end: 2011, a: 'タイ王国', b: 'カンボジア王国', type: 'hostile',
		label: { ja: 'プレアビヒア寺院国境問題を巡る緊張' } },
	{ start: 2010, end: 2011, a: 'インドネシア共和国', b: 'マレーシア', type: 'diplomatic',
		label: { ja: 'ASEAN加盟国、アンバラット海域を巡る緊張も' } },
	{ start: 2010, end: 2011, a: 'インドネシア共和国', b: 'フィリピン共和国', type: 'diplomatic',
		label: { ja: 'ASEAN加盟国' } },
	{ start: 2010, end: 2011, a: 'シンガポール共和国', b: 'マレーシア', type: 'diplomatic',
		label: { ja: 'ASEAN加盟国・経済的相互依存' } },
	{ start: 2010, end: 2011, a: 'アメリカ合衆国', b: 'オーストラリア連邦', type: 'alliance',
		label: { ja: 'ANZUS条約' } },
	{ start: 2010, end: 2011, a: '日本国', b: 'オーストラリア連邦', type: 'diplomatic',
		label: { ja: '戦略的パートナーシップ' } },
	{ start: 2010, end: 2011, a: 'カザフスタン共和国', b: 'ロシア連邦', type: 'alliance',
		label: { ja: 'CIS・集団安全保障条約機構(CSTO)加盟国' } },
	{ start: 2010, end: 2011, a: 'ウズベキスタン共和国', b: 'キルギス共和国', type: 'hostile',
		label: { ja: 'キルギス南部民族衝突(6月)でウズベク系住民迫害、関係悪化' } },
	{ start: 2010, end: 2011, a: 'トルクメニスタン', b: 'ロシア連邦', type: 'diplomatic',
		label: { ja: '天然ガス輸出を巡るエネルギー協力' } },
	{ start: 2010, end: 2011, a: 'カナダ', b: '大ブリテンおよび北部アイルランド連合王国', type: 'alliance',
		label: { ja: '英連邦(コモンウェルス)' } },
	{ start: 2010, end: 2011, a: 'チリ共和国', b: 'ボリビア多民族国', type: 'hostile',
		label: { ja: '太平洋戦争(1879年)以来の海への出口問題' } },
	{ start: 2010, end: 2011, a: 'ペルー共和国', b: 'チリ共和国', type: 'hostile',
		label: { ja: '海洋境界を巡り国際司法裁判所へ提訴中(2008年提訴)' } },
	{ start: 2010, end: 2011, a: 'エクアドル共和国', b: 'コロンビア共和国', type: 'diplomatic',
		label: { ja: '2008年越境空爆事件後、国交回復(2010年)' } },
	{ start: 2010, end: 2011, a: 'ドミニカ共和国', b: 'ハイチ共和国', type: 'diplomatic',
		label: { ja: '同じイスパニョーラ島を分け合う隣国関係' } },
	{ start: 2010, end: 2011, a: 'キプロス共和国', b: '北キプロス・トルコ共和国', type: 'hostile',
		label: { ja: '1974年分断以来の南北対立継続' } },
	{ start: 2010, end: 2011, a: 'トルコ共和国', b: 'アルメニア共和国', type: 'hostile',
		label: { ja: '国交無し(アルメニア人虐殺の認識問題等)' } },
	{ start: 2010, end: 2011, a: 'アゼルバイジャン共和国', b: 'アルメニア共和国', type: 'hostile',
		label: { ja: 'ナゴルノ・カラバフ紛争(停戦中も緊張継続)' } },
	{ start: 2010, end: 2011, a: 'ポーランド共和国', b: 'ロシア連邦', type: 'diplomatic',
		label: { ja: 'スモレンスク航空機墜落事故(4月、ポーランド大統領死去)を機に一時的に関係改善' } },
	{ start: 2010, end: 2011, a: 'モンテネグロ', b: 'セルビア共和国', type: 'diplomatic',
		label: { ja: '2006年モンテネグロ独立後の隣国関係' } },
	{ start: 2010, end: 2011, a: 'ボスニア・ヘルツェゴビナ', b: 'セルビア共和国', type: 'diplomatic',
		label: { ja: '1990年代紛争後の緊張を残しつつ関係正常化' } },
];
