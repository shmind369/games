'use strict';

// 画面下部に常時表示する、年号ジャンプ入力欄と◀/▶早送りボタン。
// 以前は国・元首一覧パネルの中だけにあったが、パネルを開かなくても
// いつでも年を操作できるよう、独立した常設コントロールにした。
function YearControls()
{
	const yearEl = document.getElementById('year-controls-year');
	const yearInputEl = document.getElementById('year-controls-year-input');
	const prevButton = document.getElementById('year-controls-prev');
	const nextButton = document.getElementById('year-controls-next');

	let on_changed_handler = null;
	this.onchanged = function(f)
	{
		on_changed_handler = f;
	};

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
	this.update = update_year_display;

	function notify()
	{
		update_year_display();
		if (on_changed_handler) {
			on_changed_handler();
		}
	}

	// タップして数値入力で直接ジャンプする(-?で始まる最大4桁の数値。
	// 西暦0年は存在しない)
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
			notify();
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
	// 指を離すと止まる(その年に達すると自動的に停止する)。
	// 1〜2秒ほど押し続けるとさらに速い間隔に切り替わる(2段階加速)
	const HOLD_INITIAL_DELAY_MS = 400;
	const HOLD_REPEAT_INTERVAL_MS = 120;
	const HOLD_ACCEL_DELAY_MS = 1200;
	const HOLD_FAST_INTERVAL_MS = 35;

	function bind_hold_button(el, delta)
	{
		let initial_timer = null;
		let accel_timer = null;
		let repeat_timer = null;

		function step()
		{
			let before = data.year;
			data.year += delta;
			data.year_clamp();
			notify();
			if (data.year === before) {
				stop();
			}
		}
		function start()
		{
			stop();
			step();
			initial_timer = setTimeout(function() {
				repeat_timer = setInterval(step, HOLD_REPEAT_INTERVAL_MS);
				accel_timer = setTimeout(function() {
					clearInterval(repeat_timer);
					repeat_timer = setInterval(step, HOLD_FAST_INTERVAL_MS);
				}, HOLD_ACCEL_DELAY_MS);
			}, HOLD_INITIAL_DELAY_MS);
		}
		function stop()
		{
			if (initial_timer) {
				clearTimeout(initial_timer);
				initial_timer = null;
			}
			if (accel_timer) {
				clearTimeout(accel_timer);
				accel_timer = null;
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
	}
	bind_hold_button(prevButton, -1);
	bind_hold_button(nextButton, 1);

	update_year_display();
}
