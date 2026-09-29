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
];
