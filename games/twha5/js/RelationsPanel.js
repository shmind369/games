'use strict';

// 「国際関係」モード用のパネル。国際関係モード中に国名をタップすると、
// その国のその年における関係(js/relations.jsのrelation_list)だけを
// 検索して一覧表示する(WikiPanelと同じ配置・開閉方式の別パネル)。
//
// パフォーマンス方針(要望より):
// - 国際関係モードがOFFの間は一切の計算を行わない(このパネル自体が
//   閉じたままで、update()もis_openがfalseなら即return)
// - 全ての国同士の関係を常に描画するのではなく、タップされた国に
//   関係するものだけをrelation_listから検索する(relation_listは
//   war_listと同様に手動で増やしていく想定のリストなので、
//   region_list(数千行)そのものを毎回全走査するわけではない)
// - 関係する相手国の表示名/国旗を得るためにregion_listを検索する処理は、
//   タップ時と年が変わった時(パネルが開いている間だけ)のみ、
//   実際にヒットした関係の数(通常ごく少数)だけ行う
function RelationsPanel()
{
	const panel = document.getElementById('relations-panel');
	const headbarEl = document.getElementById('relations-panel-headbar');
	const titleEl = document.getElementById('relations-panel-title');
	const bodyEl = document.getElementById('relations-panel-body');

	const NO_RELATIONS_TEXT = {
		ja: 'この年に記録されている関係はありません',
		en: 'No recorded relations this year',
		zh: '这一年没有记录的关系',
	};

	let is_open = false;
	// 現在表示中の国(ja名)。年が変わった時の再計算に使う。
	// パネルを閉じるとnullに戻し、それ以上の計算が起きないようにする
	let current_name = null;

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
	function escape_html(s)
	{
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	// region_listから、指定した年にjaNameという名前(ja表記)を持つ
	// 国・勢力を探し、表示名(3言語)と国旗アイコンだけを返す。
	// CountryList.jsのevaluate_regionと同じ手順だが、関係一覧の表示に
	// 必要な最小限の情報(名前・国旗)だけを求める簡易版
	function find_region_snapshot(year, jaName)
	{
		if (!jaName) {
			return null;
		}
		for (let i = 0; i < region_list.length; i++) {
			let a = region_list[i];
			if (!(year >= a[1] && year < a[2])) {
				continue;
			}
			let region_name = [null, null, null];
			let flag = null;
			let i2;
			for (i2 = 3; i2 < a.length && a[i2].length > 3; i2++) {
				let b = a[i2];
				flag = b[2];
				if (b[3]) {
					set_default_name(b, 3);
					region_name[0] = b[3];
					region_name[1] = b[4];
					region_name[2] = b[5];
				}
				if (year < b[1]) {
					break;
				}
			}
			if (region_name[0] === jaName) {
				return { name: region_name, flag: flag };
			}
		}
		return null;
	}

	function name_html(snapshot, fallbackJaName, lang)
	{
		let flagImg = snapshot && snapshot.flag ?
			'<img class="relations-panel-flag" src="sym/' + escape_html(snapshot.flag) + '.png" alt="">' : '';
		let text = snapshot ? (snapshot.name[lang] || snapshot.name[0]) : fallbackJaName;
		return flagImg + escape_html(text);
	}

	function render()
	{
		if (!current_name) {
			return;
		}
		let lang = lang_name_to_id(data.lang);
		let year = data.year;
		let selfSnap = find_region_snapshot(year, current_name);

		titleEl.innerHTML = name_html(selfSnap, current_name, lang);

		// relation_list(手動で蓄積する小規模なリスト)だけを検索する。
		// region_list全体を毎回総なめするわけではない
		let matches = relation_list.filter(function(r)
		{
			return year >= r.start && year < r.end && (r.a === current_name || r.b === current_name);
		});

		if (matches.length === 0) {
			bodyEl.innerHTML = '<div class="relations-panel-none">' +
				escape_html(NO_RELATIONS_TEXT[data.lang]) + '</div>';
			return;
		}

		let html = matches.map(function(r)
		{
			let otherName = r.a === current_name ? r.b : r.a;
			let otherSnap = find_region_snapshot(year, otherName);
			let icon = RELATION_TYPE_ICON[r.type] || RELATION_TYPE_ICON.diplomatic;
			let labelText = (r.label && (r.label[data.lang] || r.label.ja)) ||
				(RELATION_TYPE_LABEL[r.type] && (RELATION_TYPE_LABEL[r.type][data.lang] || RELATION_TYPE_LABEL[r.type].ja)) || '';
			return '<div class="relations-panel-item">' +
				'<div class="relations-panel-other">' + name_html(otherSnap, otherName, lang) + '</div>' +
				'<div class="relations-panel-type">' + escape_html(icon + ' ' + labelText) + '</div>' +
				'</div>';
		}).join('');

		bodyEl.innerHTML = '<div class="relations-panel-list">' + html + '</div>';
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
		// 閉じたら年変更時の再計算対象からも外す
		current_name = null;
	}

	// 国際関係モード中に国名がタップされた時に呼ばれる(ja名を受け取る)
	this.show = function(jaName)
	{
		if (!jaName) {
			return;
		}
		current_name = jaName;
		open_panel();
		render();
	};
	// 国際関係モードがOFFに切り替わった時、twha.js側から呼ばれる
	this.close = close_panel;

	// 年・言語が変わった時に呼ばれる。パネルが閉じている間は何もしない
	// (国際関係モードOFF・パネル未表示の間は計算コストがゼロになる)
	this.update = function()
	{
		if (is_open) {
			render();
		}
	};

	// ヘッダーを下にスワイプするとパネルを閉じる(他の2パネルと同じ操作感)
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
