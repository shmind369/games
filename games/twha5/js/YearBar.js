'use strict';

function YearBar()
{
	const _SIZE = 32;

	const bar = document.getElementById('year-bar');
	const arrow_up = document.getElementById('year-arrow-up');
	const arrow_down = document.getElementById('year-arrow-down');
	const scale = document.getElementById('year-bar-scale');
	const cursor = document.getElementById('year-bar-cursor');
	let scale_height = 1;
	let on_changed_handler = null;
	this.SIZE = _SIZE;

	// 目盛りの縞模様(元の横長バーと同じパターンを流用)
	const PATTERN = [
		0, 0,
		1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
		1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0,
		1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0,
		1, 1,
	];

	function draw_scale()
	{
		let h = scale_height;
		scale.setAttribute('width', _SIZE);
		scale.setAttribute('height', h);

		let ctx = scale.getContext('2d');
		ctx.clearRect(0, 0, _SIZE, h);
		ctx.fillStyle = '#e0e0e0';
		ctx.fillRect(0, 0, _SIZE, h);

		let length = PATTERN.length;
		ctx.fillStyle = '#c0c0c0';
		for (let i = 0; i < length; i++) {
			if (PATTERN[i]) {
				let y1 = h * i / length;
				let y2 = h * (i + 1) / length;
				ctx.fillRect(0, y1, _SIZE, y2 - y1);
			}
		}
	}
	function update_cursor()
	{
		data.year_clamp();

		let yr = data.year + 4000;
		if (yr > 3000) {
			yr = yr * 2 - 3000;
		}
		let y = (yr + 200) * scale_height / 9400 + _SIZE;
		cursor.style.top = (y - 6) + 'px';
	}

	this.onchanged = function(f)
	{
		on_changed_handler = f;
	};
	this.update = update_cursor;

	// 表示領域のサイズが変わった時(初回・画面回転・リサイズ)に呼ぶ
	this.resize = function()
	{
		scale_height = Math.max(1, bar.clientHeight - _SIZE * 2);
		draw_scale();
		update_cursor();
	};

	function set_year_from_y(ypos)
	{
		if (ypos < _SIZE) {
			data.year--;
		} else if (ypos > scale_height + _SIZE) {
			data.year++;
		} else {
			let yr = (ypos - _SIZE) * 9400 / scale_height - 200;
			if (yr > 3000) {
				yr = (yr + 3000) / 2;
			}
			yr -= 4000;
			data.year = Math.round(yr);
		}
		update_cursor();
		if (on_changed_handler) {
			on_changed_handler();
		}
	}
	function bar_relative_y(clientY)
	{
		return clientY - bar.getBoundingClientRect().top;
	}

	bar.addEventListener('mousedown', e =>
	{
		set_year_from_y(bar_relative_y(e.clientY));
	});
	bar.addEventListener('touchstart', e =>
	{
		set_year_from_y(bar_relative_y(e.touches[0].clientY));
		e.preventDefault();
	}, { passive: false });
	bar.addEventListener('touchmove', e =>
	{
		set_year_from_y(bar_relative_y(e.touches[0].clientY));
		e.preventDefault();
	}, { passive: false });
}
