'use strict';

function CountryList()
{
	const toggleButton = document.getElementById('country-list-toggle');
	const panel = document.getElementById('country-list-panel');
	const headbarEl = document.getElementById('country-list-headbar');
	const titleEl = document.getElementById('country-list-title');
	const bodyEl = document.getElementById('country-list-body');

	const COUNT_UNIT_TEXT = { ja: '件', en: '', zh: '个' };
	const NO_PERSON_TEXT = { ja: '(元首データなし)', en: '(no ruler data)', zh: '(无元首数据)' };

	let is_open = false;

	// 見出しに使う現在の西暦表示(#year-textやYearControls.jsの
	// format_yearと同じ書式)
	function format_year(year, lang)
	{
		if (lang === 'en') {
			return year < 0 ? (-year) + ' BC' : 'AD ' + year;
		}
		return year < 0 ? '前' + (-year) + '年' : year + '年';
	}
	// 見出し全体(「1600年の国と元首(129件)」のように、「その年」の
	// 部分を実際の西暦に置き換えた表現にする)
	function build_title(yearText, countText)
	{
		switch (data.lang) {
		case 'en':
			return 'Countries & rulers in ' + yearText + ' (' + countText + ')';
		case 'zh':
			return yearText + '的国家与元首(' + countText + ')';
		default:
			return yearText + 'の国と元首(' + countText + ')';
		}
	}

	// 「(年数)年目」のような経過年数の表示(1年目=最初の年)
	function nth_year_text(n)
	{
		switch (data.lang) {
		case 'en':
			return ' (year ' + n + ')';
		case 'zh':
			return '(第' + n + '年)';
		default:
			return '(' + n + '年目)';
		}
	}

	function lang_name_to_id(lang)
	{
		switch (lang) {
		case 'ja':
			return 0;
		case 'en':
			return 1;
		case 'zh':
			return 2;
		}
	}
	function set_default_name(a, offset)
	{
		if (a[offset + 0] === '$') {
			a[offset + 0] = a[offset + 1];
		}
		if (a[offset + 1] === '@') {
			a[offset + 1] = a[offset + 0];
		}
		if (a[offset + 2] === '$') {
			a[offset + 2] = a[offset + 1];
		}
		if (a[offset + 2] === '@') {
			a[offset + 2] = a[offset + 0];
		}
	}

	// Region.js の update_year と同じ手順で、指定した年の地域名・元首・
	// 地図上の位置(pos_x, pos_y)を求める(Map/Region側は画面に表示中の
	// 地域しか保持しないため、地図の表示範囲に依存しない一覧を作るために
	// region_list から直接再計算している)
	function evaluate_region(a, year)
	{
		if (!(year >= a[1] && year < a[2])) {
			return null;
		}

		let region_name = [null, null, null];
		let pos_x = 0;
		let pos_y = 0;
		let name_start_year = null;
		let flag = null;
		let i;
		for (i = 3; i < a.length && a[i].length > 3; i++) {
			let b = a[i];
			// 国旗・紋章アイコン(sym/*.png)は名前の有無に関わらず毎行更新される
			flag = b[2];
			if (b[3]) {
				set_default_name(b, 3);
				region_name[0] = b[3];
				region_name[1] = b[4];
				region_name[2] = b[5];
				// この国名(表記)になったのはこの行が開始した年
				name_start_year = b[0];
			}
			if (b.length >= 12) {
				pos_x = b[9];
				pos_y = b[10];
			}
			if (year < b[1]) {
				break;
			}
		}
		for (; i < a.length && a[i].length > 3; i++) {
		}

		let title = null;
		let person_list = [];
		for (; i < a.length; i++) {
			let b = a[i];
			if (b.length == 3) {
				set_default_name(b, 0);
				title = b;
			} else if (year >= b[0] && year < b[1]) {
				set_default_name(b, 3);
				// b[0] = この元首の就任年
				person_list.push([title, b, b[0]]);
			}
		}

		if (!region_name[0]) {
			return null;
		}
		return { name: region_name, people: person_list, pos_x: pos_x, pos_y: pos_y, name_start_year: name_start_year, flag: flag };
	}

	function escape_html(s)
	{
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}
	// data-*属性の値として埋め込むための、ダブルクオートも含めたエスケープ
	function escape_attr(s)
	{
		return escape_html(s).replace(/"/g, '&quot;');
	}

	// 再描画前に、現在の表示範囲の一番上に見えている項目(のregion_list
	// 上のインデックス)と、その項目がスクロール位置に対してどれだけ
	// ずれた位置にあるかを記録しておく。年を進めて新しい国が追加/削除
	// されても、この項目を再び同じ相対位置に来るようスクロール位置を
	// 復元することで、ユーザーが見ていた表示範囲が勝手にズレないようにする
	function capture_scroll_anchor()
	{
		let items = bodyEl.querySelectorAll('.country-list-item');
		for (let i = 0; i < items.length; i++) {
			let item = items[i];
			if (item.offsetTop + item.offsetHeight > bodyEl.scrollTop) {
				return {
					regionIndex: item.dataset.regionIndex,
					offset: item.offsetTop - bodyEl.scrollTop,
				};
			}
		}
		return null;
	}
	function restore_scroll_anchor(anchor)
	{
		if (!anchor) {
			return;
		}
		let item = bodyEl.querySelector('.country-list-item[data-region-index="' + anchor.regionIndex + '"]');
		if (item) {
			bodyEl.scrollTop = item.offsetTop - anchor.offset;
		}
	}

	function render()
	{
		let anchor = capture_scroll_anchor();

		let lang = lang_name_to_id(data.lang);
		let year = data.year;
		let seen = new Set();
		let html = '';
		let count = 0;

		for (let i = 0; i < region_list.length; i++) {
			let r = evaluate_region(region_list[i], year);
			if (!r) {
				continue;
			}

			let name = r.name[lang];
			let key = name + '|' + r.people.map(function(p) { return p[1][3 + lang]; }).join(',');
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			count++;

			let peopleHtml;
			if (r.people.length > 0) {
				peopleHtml = r.people.map(function(p) {
					let title = p[0] ? p[0][lang] : '';
					let person = p[1][3 + lang];
					let label = title ? escape_html(title) + ': ' : '';
					let personYears = nth_year_text(year - p[2] + 1);
					// 地図上の元首名タップ(Region.js)と同じクエリ形式
					// (「人物名 称号」)にして、Wikipedia要約パネルの
					// 検索結果が地図側から開いた時と揃うようにする
					let personQuery = title ? (person + ' ' + title) : person;
					return '<div class="country-list-person">' + label +
						'<span class="country-list-person-name" data-info-query="' + escape_attr(personQuery) + '">' +
						escape_html(person) + '</span>' +
						'<span class="country-list-years">' + personYears + '</span></div>';
				}).join('');
			} else {
				peopleHtml = '<div class="country-list-person country-list-noperson">' + NO_PERSON_TEXT[data.lang] + '</div>';
			}

			let nameYears = r.name_start_year !== null ? nth_year_text(year - r.name_start_year + 1) : '';
			let flagImg = r.flag ? '<img class="country-list-flag" src="sym/' + escape_html(r.flag) + '.png" alt="">' : '';
			html += '<div class="country-list-item" data-x="' + r.pos_x + '" data-y="' + r.pos_y +
				'" data-region-index="' + i + '">' +
				'<div class="country-list-name">' + flagImg +
				'<span class="country-list-name-text" data-info-query="' + escape_attr(name) + '">' + escape_html(name) + '</span>' +
				'<span class="country-list-years">' + nameYears + '</span></div>' + peopleHtml + '</div>';
		}

		let yearText = format_year(data.year, data.lang);
		let countText = count + COUNT_UNIT_TEXT[data.lang];
		titleEl.innerText = build_title(yearText, countText);
		bodyEl.innerHTML = html;

		restore_scroll_anchor(anchor);
	}

	function open()
	{
		is_open = true;
		panel.classList.add('open');
		render();
	}
	function close()
	{
		is_open = false;
		panel.classList.remove('open');
	}

	// 年・言語が変わった時に呼ばれる。パネルが閉じている間は再計算しない
	this.update = function()
	{
		if (is_open) {
			render();
		}
	};

	// on_jump_handler(x, y, regionIndex): regionIndexはregion_list内の
	// インデックスで、地図側でジャンプ先の地域名を赤くハイライトするために使う
	let on_jump_handler = null;
	this.onjump = function(f)
	{
		on_jump_handler = f;
	};

	// on_info_tap_handler(query): 国名・元首名の文字部分がタップされた時に
	// 呼ばれる(実体はWikiPanel.show()。js/twha.js側で配線する)
	let on_info_tap_handler = null;
	this.oninfotap = function(f)
	{
		on_info_tap_handler = f;
	};

	// リスト本体はスクロールもできるため、スクロール操作の指離しを誤って
	// ジャンプと判定しないよう、タップ確定後にのみ発火する'click'を使う
	// (mousedown/touchstartだとスクロール開始の指下ろしにも反応してしまう)。
	// パネルの背景は透過度が高く地図が透けて見えるため、ジャンプしても
	// パネルは閉じず、開いたまま連続して別の国へジャンプできるようにする。
	// ただし国名・元首名の文字部分がタップされた場合は、地図上の同じ名前を
	// タップした時と同様にWikipedia要約パネルを開き、ジャンプはしない
	// (地図ジャンプとの誤操作を避けるため、行のそれ以外の部分をタップした
	// 場合のみジャンプする)
	bodyEl.addEventListener('click', function(e)
	{
		let infoEl = e.target.closest('[data-info-query]');
		if (infoEl) {
			if (on_info_tap_handler) {
				on_info_tap_handler(infoEl.dataset.infoQuery);
			}
			return;
		}
		let item = e.target.closest('.country-list-item');
		if (!item) {
			return;
		}
		if (on_jump_handler) {
			on_jump_handler(Number(item.dataset.x), Number(item.dataset.y), Number(item.dataset.regionIndex));
		}
	});

	toggleButton.addEventListener('mousedown', function(e)
	{
		if (is_open) {
			close();
		} else {
			open();
		}
		e.preventDefault();
	});
	toggleButton.addEventListener('touchstart', function(e)
	{
		if (is_open) {
			close();
		} else {
			open();
		}
		e.preventDefault();
	}, { passive: false });

	// ヘッダーを下にスワイプするとパネルを閉じる(×ボタンは廃止)。
	// 一定距離を超えるまでは指の動きにそのまま追従させ、離した時に
	// 閾値を超えていれば閉じる・超えていなければ元の位置へ戻す
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
			close();
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
