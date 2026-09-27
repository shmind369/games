'use strict';

function CountryList()
{
	const toggleButton = document.getElementById('country-list-toggle');
	const panel = document.getElementById('country-list-panel');
	const closeButton = document.getElementById('country-list-close');
	const titleEl = document.getElementById('country-list-title');
	const bodyEl = document.getElementById('country-list-body');

	const TITLE_TEXT = { ja: 'その年の国と元首', en: 'Countries & rulers', zh: '当年的国家与元首' };
	const COUNT_UNIT_TEXT = { ja: '件', en: '', zh: '个' };
	const NO_PERSON_TEXT = { ja: '(元首データなし)', en: '(no ruler data)', zh: '(无元首数据)' };

	let is_open = false;

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
		let i;
		for (i = 3; i < a.length && a[i].length > 3; i++) {
			let b = a[i];
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
		return { name: region_name, people: person_list, pos_x: pos_x, pos_y: pos_y, name_start_year: name_start_year };
	}

	function escape_html(s)
	{
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	function render()
	{
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
					return '<div class="country-list-person">' + label + escape_html(person) +
						'<span class="country-list-years">' + personYears + '</span></div>';
				}).join('');
			} else {
				peopleHtml = '<div class="country-list-person country-list-noperson">' + NO_PERSON_TEXT[data.lang] + '</div>';
			}

			let nameYears = r.name_start_year !== null ? nth_year_text(year - r.name_start_year + 1) : '';
			html += '<div class="country-list-item" data-x="' + r.pos_x + '" data-y="' + r.pos_y + '">' +
				'<div class="country-list-name">' + escape_html(name) +
				'<span class="country-list-years">' + nameYears + '</span></div>' + peopleHtml + '</div>';
		}

		titleEl.innerText = TITLE_TEXT[data.lang] + '(' + count + COUNT_UNIT_TEXT[data.lang] + ')';
		bodyEl.innerHTML = html;
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

	let on_jump_handler = null;
	this.onjump = function(f)
	{
		on_jump_handler = f;
	};

	// リスト本体はスクロールもできるため、スクロール操作の指離しを誤って
	// ジャンプと判定しないよう、タップ確定後にのみ発火する'click'を使う
	// (mousedown/touchstartだとスクロール開始の指下ろしにも反応してしまう)
	bodyEl.addEventListener('click', function(e)
	{
		let item = e.target.closest('.country-list-item');
		if (!item) {
			return;
		}
		if (on_jump_handler) {
			on_jump_handler(Number(item.dataset.x), Number(item.dataset.y));
		}
		close();
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
	closeButton.addEventListener('mousedown', function(e)
	{
		close();
		e.preventDefault();
	});
	closeButton.addEventListener('touchstart', function(e)
	{
		close();
		e.preventDefault();
	}, { passive: false });
}
