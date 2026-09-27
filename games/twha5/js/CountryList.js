'use strict';

function CountryList()
{
	const toggleButton = document.getElementById('country-list-toggle');
	const panel = document.getElementById('country-list-panel');
	const closeButton = document.getElementById('country-list-close');
	const titleEl = document.getElementById('country-list-title');
	const bodyEl = document.getElementById('country-list-body');
	const yearEl = document.getElementById('country-list-year');
	const yearInputEl = document.getElementById('country-list-year-input');
	const yearPrevButton = document.getElementById('country-list-year-prev');
	const yearNextButton = document.getElementById('country-list-year-next');

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

	// 画面上部の#year-textと同じ書式(YearText.jsのupdate_textと同じ規則)
	function format_year(year, lang)
	{
		if (lang === 'en') {
			return year < 0 ? (-year) + ' BC' : 'AD ' + year;
		}
		return year < 0 ? '前' + (-year) + '年' : year + '年';
	}
	function update_year_display()
	{
		yearEl.innerText = format_year(data.year, data.lang);
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
		update_year_display();
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
		stop_year_hold_all();
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

	// 年表示をタップして数値入力で直接ジャンプする(画面上部の#year-textと
	// 同じ入力規則: -?で始まる最大4桁の数値。西暦0年は存在しない)
	let on_year_change_handler = null;
	this.onyearchange = function(f)
	{
		on_year_change_handler = f;
	};

	function enter_year_input()
	{
		yearEl.style.display = 'none';
		yearInputEl.style.display = 'inline-block';
		// あらかじめ入力欄を空にしておく(現在の年はplaceholderで示す)。
		// 値を全選択した状態でフォーカスすると、iOS等で範囲選択ハンドルが
		// 表示されてしまうため、それを避けつつ入力し直しやすくしている
		yearInputEl.value = '';
		yearInputEl.placeholder = String(data.year);
		setTimeout(function() {
			yearInputEl.focus();
		}, 50);
	}
	function commit_year_input()
	{
		yearEl.style.display = '';
		yearInputEl.style.display = 'none';

		let text = yearInputEl.value;
		if (text.match(/^-?\d{1,4}$/)) {
			data.year = Number(text);
			data.year_clamp();
			render();
			if (on_year_change_handler) {
				on_year_change_handler();
			}
		} else {
			update_year_display();
		}
	}
	yearEl.addEventListener('click', enter_year_input);
	yearInputEl.addEventListener('blur', commit_year_input);
	yearInputEl.addEventListener('keydown', function(e)
	{
		if (e.key === 'Enter') {
			e.preventDefault();
			yearInputEl.blur();
		}
	});

	// ◀/▶ボタン: タップで1年、押し続けると一定間隔で自動的に進み続け、
	// 指を離すと止まる(その年に達すると自動的に停止する)
	const YEAR_HOLD_INITIAL_DELAY_MS = 400;
	const YEAR_HOLD_REPEAT_INTERVAL_MS = 120;
	const year_hold_stoppers = [];

	function stop_year_hold_all()
	{
		for (let i = 0; i < year_hold_stoppers.length; i++) {
			year_hold_stoppers[i]();
		}
	}
	function bind_year_hold_button(el, delta)
	{
		let initial_timer = null;
		let repeat_timer = null;

		function step()
		{
			let before = data.year;
			data.year += delta;
			data.year_clamp();
			render();
			if (on_year_change_handler) {
				on_year_change_handler();
			}
			if (data.year === before) {
				stop();
			}
		}
		function start()
		{
			stop();
			step();
			initial_timer = setTimeout(function() {
				repeat_timer = setInterval(step, YEAR_HOLD_REPEAT_INTERVAL_MS);
			}, YEAR_HOLD_INITIAL_DELAY_MS);
		}
		function stop()
		{
			if (initial_timer) {
				clearTimeout(initial_timer);
				initial_timer = null;
			}
			if (repeat_timer) {
				clearInterval(repeat_timer);
				repeat_timer = null;
			}
		}

		el.addEventListener('mousedown', function(e) { start(); e.preventDefault(); });
		el.addEventListener('touchstart', function(e) { start(); e.preventDefault(); }, { passive: false });
		el.addEventListener('mouseup', stop);
		el.addEventListener('mouseleave', stop);
		el.addEventListener('touchend', stop);
		el.addEventListener('touchcancel', stop);

		year_hold_stoppers.push(stop);
	}
	bind_year_hold_button(yearPrevButton, -1);
	bind_year_hold_button(yearNextButton, 1);

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
