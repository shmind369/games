'use strict';

// 国名・元首名タップで開く、Wikipediaの要約をその場に表示するパネル。
// 別タブに離脱させたくないという要望から、Google検索への新規タブ遷移を
// やめてこちらに置き換えた
function WikiPanel()
{
	const panel = document.getElementById('wiki-panel');
	const headbarEl = document.getElementById('wiki-panel-headbar');
	const titleEl = document.getElementById('wiki-panel-title');
	const bodyEl = document.getElementById('wiki-panel-body');

	const LOADING_TEXT = { ja: '読み込み中…', en: 'Loading…', zh: '加载中…' };
	const NOTFOUND_TEXT = { ja: '該当する記事が見つかりませんでした。', en: 'No matching article was found.', zh: '未找到匹配的条目。' };
	const ERROR_TEXT = { ja: '読み込みに失敗しました。', en: 'Failed to load.', zh: '加载失败。' };
	const READMORE_TEXT = { ja: 'Wikipediaで見る', en: 'View on Wikipedia', zh: '在维基百科上查看' };

	let is_open = false;
	// 連続タップで新しいリクエストが来たら、古いリクエストの結果は
	// 表示に反映しない(取得順の逆転による誤表示を防ぐ)
	let request_seq = 0;

	function wiki_lang()
	{
		switch (data.lang) {
		case 'en':
			return 'en';
		case 'zh':
			return 'zh';
		default:
			return 'ja';
		}
	}
	function escape_html(s)
	{
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}
	function wiki_search_url(lang, query)
	{
		return 'https://' + lang + '.wikipedia.org/w/index.php?search=' + encodeURIComponent(query);
	}

	function open_panel()
	{
		is_open = true;
		panel.classList.add('open');
	}
	function close_panel()
	{
		is_open = false;
		panel.classList.remove('open');
	}

	function render_loading(query)
	{
		titleEl.innerText = query;
		bodyEl.innerHTML = '<div class="wiki-panel-status">' + LOADING_TEXT[data.lang] + '</div>';
	}
	function render_notfound(query, lang)
	{
		titleEl.innerText = query;
		bodyEl.innerHTML = '<div class="wiki-panel-status">' + NOTFOUND_TEXT[data.lang] + '</div>' +
			'<a class="wiki-panel-link" href="' + wiki_search_url(lang, query) + '" target="_blank" rel="noopener">' +
			escape_html(READMORE_TEXT[data.lang]) + '</a>';
	}
	function render_error(query, lang)
	{
		titleEl.innerText = query;
		bodyEl.innerHTML = '<div class="wiki-panel-status">' + ERROR_TEXT[data.lang] + '</div>' +
			'<a class="wiki-panel-link" href="' + wiki_search_url(lang, query) + '" target="_blank" rel="noopener">' +
			escape_html(READMORE_TEXT[data.lang]) + '</a>';
	}
	function render_article(page)
	{
		titleEl.innerText = page.title;
		let html = '';
		if (page.thumbnail && page.thumbnail.source) {
			html += '<img class="wiki-panel-thumb" src="' + page.thumbnail.source + '" alt="">';
		}
		html += '<div class="wiki-panel-extract">' + escape_html(page.extract) + '</div>';
		html += '<a class="wiki-panel-link" href="' + page.fullurl + '" target="_blank" rel="noopener">' +
			escape_html(READMORE_TEXT[data.lang]) + '</a>';
		bodyEl.innerHTML = html;
	}

	// MediaWiki APIのgenerator=searchで全文検索し、ヒットした先頭記事の
	// 冒頭要約(extract)・サムネイル・URLを1回のリクエストでまとめて取る。
	// タイトル完全一致が不要なため、国名の表記ゆれ(括弧書きなど)にも強い。
	// origin=*を付けることで、APIキーもサーバーも無しでブラウザから直接
	// CORS越しに呼び出せる(MediaWiki API側の仕様)
	function fetch_summary(query, lang, seq)
	{
		let url = 'https://' + lang + '.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=' +
			encodeURIComponent(query) + '&gsrlimit=1&prop=extracts%7Cpageimages%7Cinfo&exintro=1&explaintext=1&' +
			'piprop=thumbnail&pithumbsize=300&inprop=url&format=json&origin=*';

		fetch(url).then(function(res)
		{
			if (!res.ok) {
				throw new Error('HTTP ' + res.status);
			}
			return res.json();
		}).then(function(json)
		{
			if (seq !== request_seq) {
				return;
			}
			let pages = json.query && json.query.pages;
			let page = pages ? Object.values(pages)[0] : null;
			if (!page || !page.extract) {
				render_notfound(query, lang);
				return;
			}
			render_article(page);
		}).catch(function()
		{
			if (seq !== request_seq) {
				return;
			}
			render_error(query, lang);
		});
	}

	this.show = function(query)
	{
		if (!query) {
			return;
		}
		request_seq++;
		let seq = request_seq;
		let lang = wiki_lang();
		open_panel();
		render_loading(query);
		fetch_summary(query, lang, seq);
	};

	// ヘッダーを下にスワイプするとパネルを閉じる(国・元首一覧パネルと同じ操作感)
	const DRAG_CLOSE_THRESHOLD_PX = 60;
	let drag_start_y = null;
	let drag_current_y = 0;

	function drag_start(y)
	{
		drag_start_y = y;
		drag_current_y = 0;
		panel.style.transition = 'none';
	}
	function drag_move(y)
	{
		if (drag_start_y === null) {
			return;
		}
		let dy = y - drag_start_y;
		if (dy < 0) {
			dy = 0;
		}
		drag_current_y = dy;
		panel.style.transform = 'translateY(' + dy + 'px)';
	}
	function drag_end()
	{
		if (drag_start_y === null) {
			return;
		}
		panel.style.transition = '';
		panel.style.transform = '';
		if (drag_current_y > DRAG_CLOSE_THRESHOLD_PX) {
			close_panel();
		}
		drag_start_y = null;
		drag_current_y = 0;
	}

	headbarEl.addEventListener('touchstart', function(e)
	{
		drag_start(e.touches[0].clientY);
	});
	headbarEl.addEventListener('touchmove', function(e)
	{
		drag_move(e.touches[0].clientY);
		e.preventDefault();
	}, { passive: false });
	headbarEl.addEventListener('touchend', drag_end);
	headbarEl.addEventListener('touchcancel', drag_end);
}
