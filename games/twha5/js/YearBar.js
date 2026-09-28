'use strict';

function YearBar()
{
	const _SIZE = 32;

	const bar = document.getElementById('year-bar');
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

	const MIN_YEAR = -4000;

	// 年→バー上の位置(0〜1)。ちょうど中心(0.5)が西暦元年(1年)に
	// なるよう、紀元前パートと西暦パートをそれぞれ均等に割り当てる
	function year_to_frac(year)
	{
		if (year <= 1) {
			return (year - MIN_YEAR) / (1 - MIN_YEAR) * 0.5;
		}
		return 0.5 + (year - 1) / (MAX_YEAR - 1) * 0.5;
	}
	function frac_to_year(frac)
	{
		if (frac <= 0.5) {
			return MIN_YEAR + (frac / 0.5) * (1 - MIN_YEAR);
		}
		return 1 + ((frac - 0.5) / 0.5) * (MAX_YEAR - 1);
	}

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

		// 100年単位の目盛り線と年号。紀元前パートは年数が密集して
		// ラベル同士が重なるため、直近のラベルから一定間隔空いている
		// 時だけ文字を描く(目盛り線自体は100年ごとに必ず引く)。
		// 数字は縦書きではなく横書きで表示する
		const LABEL_MIN_GAP_PX = 9;
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
		ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
		ctx.font = '8px sans-serif';
		ctx.textAlign = 'right';
		ctx.textBaseline = 'middle';
		let last_label_y = -Infinity;
		for (let year = MIN_YEAR; year <= 2000; year += 100) {
			// 西暦0年は存在しない
			if (year === 0) {
				continue;
			}
			let y = year_to_frac(year) * h;

			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(5, y);
			ctx.stroke();

			if (y - last_label_y >= LABEL_MIN_GAP_PX) {
				ctx.fillText(String(year), _SIZE - 1, y);
				last_label_y = y;
			}
		}
	}
	function update_cursor()
	{
		data.year_clamp();

		let y = year_to_frac(data.year) * scale_height;
		cursor.style.top = (y - 1.5) + 'px'; // 高さ3pxの線を中央に合わせる
	}

	this.onchanged = function(f)
	{
		on_changed_handler = f;
	};
	this.update = update_cursor;

	// 表示領域のサイズが変わった時(初回・画面回転・リサイズ)に呼ぶ
	this.resize = function()
	{
		scale_height = Math.max(1, bar.clientHeight);
		draw_scale();
		update_cursor();
	};

	function set_year_from_y(ypos)
	{
		let frac = ypos / scale_height;
		data.year = Math.round(frac_to_year(frac));
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
