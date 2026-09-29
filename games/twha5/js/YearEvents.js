'use strict';

// 国一覧パネルの見出し(「〇〇年の国と元首」)をタップした時に表示する、
// その年の一般的な出来事一覧。js/wars.jsのように手動でデータを蓄積するの
// ではなく、日本語版Wikipediaの年別記事(例:「800年」「紀元前753年」)を
// タップされた年についてだけその場で取得し、記事内の「できごと」節の
// 箇条書きをそのまま一覧として表示する(自前のデータは持たない)

// 西暦から日本語版Wikipediaの年別記事タイトルを求める(0年は存在しない)
function year_to_wiki_title(year)
{
	return year < 0 ? '紀元前' + (-year) + '年' : year + '年';
}

// wikitext中の簡単なマークアップ([[リンク]]・'''強調'''・<ref>脚注</ref>・
// {{テンプレート}}など)を人が読める平文に近い形へ変換する。年別記事の
// 「できごと」節はほとんどが入れ子の無いリンク/テンプレートなので、
// 完全なwikitextパーサーではなく実用上十分な範囲の置換のみ行っている
function clean_wikitext_line(s)
{
	s = s.replace(/<ref[^>]*\/>/g, '');
	s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
	// {{...}}を中身ごと除去(浅いネストにも数回繰り返して対応する)
	for (let i = 0; i < 3; i++) {
		s = s.replace(/\{\{[^{}]*\}\}/g, '');
	}
	s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');
	s = s.replace(/\[\[([^\]]*)\]\]/g, '$1');
	s = s.replace(/'''''/g, '').replace(/'''/g, '').replace(/''/g, '');
	s = s.replace(/<[^>]+>/g, '');
	s = s.replace(/\s+/g, ' ').trim();
	return s;
}

// 記事全文のwikitextから「== できごと ==」節の箇条書き行だけを取り出す。
// 節自体が見つからなければnullを返す(項目0件の配列と区別するため)。
// 「できごと」節は年によって以下のようにさまざまな書式のバリエーションが
// あるため、できるだけ多くの年で項目を取りこぼさないよう複数のパターンに
// 対応している:
// - 見出し表記が「できごと」(ひらがな)ではなく「出来事」(漢字)の年がある
// - 現代に近い年ほど「=== 1月 === / === 2月 === ...」のように月ごとの
//   小見出し(レベル3以降)で分割されており、その配下に箇条書きが並ぶ
//   (小見出し自体はレベル2の次の見出しではないため、節の終端としては
//   扱わない)
// - 箇条書きの記号が「*」ではなく「#」(番号付き)になっている年がある
function parse_year_events_wikitext(wikitext)
{
	let heading = wikitext.match(/^==\s*(?:できごと|出来事)\s*==\s*$/m);
	if (!heading) {
		return null;
	}
	let rest = wikitext.slice(heading.index + heading[0].length);
	let nextHeading = rest.match(/^==[^=].*$/m);
	let section = nextHeading ? rest.slice(0, nextHeading.index) : rest;

	let items = [];
	let lines = section.split('\n');
	for (let i = 0; i < lines.length; i++) {
		let m = lines[i].match(/^\s*[*#]+\s*/);
		if (!m) {
			continue;
		}
		let text = clean_wikitext_line(lines[i].slice(m[0].length));
		if (text) {
			items.push(text);
		}
	}
	return items;
}

// その年の日本語版Wikipedia記事を取得し、「できごと」節を解析する。
// action=parseでページ全体のwikitextを1回のリクエストで取得している
// (origin=*により、APIキーもサーバーも無しでブラウザから直接呼べる)。
// 結果はcallback(result)で通知する:
//   {items: [...]}  取得・解析に成功(0件になることもある)
//   {notfound: true, title} 記事または「できごと」節が見つからない
//   {error: true, title}    通信または解析に失敗
function fetch_year_events(year, callback)
{
	let title = year_to_wiki_title(year);
	let url = 'https://ja.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&' +
		'prop=wikitext&redirects=1&page=' + encodeURIComponent(title) + '&origin=*';

	fetch(url).then(function(res)
	{
		if (!res.ok) {
			throw new Error('HTTP ' + res.status);
		}
		return res.json();
	}).then(function(json)
	{
		if (json.error || !json.parse || typeof json.parse.wikitext !== 'string') {
			callback({ notfound: true, title: title });
			return;
		}
		let items = parse_year_events_wikitext(json.parse.wikitext);
		if (!items) {
			callback({ notfound: true, title: title });
			return;
		}
		callback({ items: items, title: title });
	}).catch(function()
	{
		callback({ error: true, title: title });
	});
}
