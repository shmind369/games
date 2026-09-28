'use strict';

// 画面上部の横向き年表バー。右端の縦年表バーと同じ考え方(中心が
// 西暦元年になる2区間の線形マッピング)を横方向に使い、現在の年を
// 赤い縦線で示す。線はつかんで直接ドラッグできる操作用のつまみとして
// 機能し、バーのどこを押してもその位置の年へジャンプ・追従できるよう、
// バー全体を触れる領域にしてある(細い線をピンポイントで掴む必要はない)。
function TopYearBar()
{
	const bar = document.getElementById('top-year-bar');
	const scale = document.getElementById('top-year-bar-scale');
	const cursor = document.getElementById('top-year-bar-cursor');
	let scale_width = 1;
	let on_changed_handler = null;

	const MIN_YEAR = -4000;

	// 年→バー上の位置(0〜1)。右端の縦年表バーと同じ式
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
		let w = scale_width;
		let h = 30;
		scale.setAttribute('width', w);
		scale.setAttribute('height', h);

		let ctx = scale.getContext('2d');
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = '#e0e0e0';
		ctx.fillRect(0, 0, w, h);

		// 100年単位の目盛り線と年号。横書きなので詰まりすぎないよう、
		// 直前のラベルから一定間隔空いている時だけ文字を描く
		const LABEL_MIN_GAP_PX = 34;
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
		ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
		ctx.font = '9px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		let last_label_x = -Infinity;
		for (let year = MIN_YEAR; year <= 2000; year += 100) {
			// 西暦0年は存在しない
			if (year === 0) {
				continue;
			}
			let x = year_to_frac(year) * w;

			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, 6);
			ctx.stroke();

			if (x - last_label_x >= LABEL_MIN_GAP_PX) {
				ctx.fillText(String(year), x, 8);
				last_label_x = x;
			}
		}
	}
	function update_cursor()
	{
		data.year_clamp();

		let x = year_to_frac(data.year) * scale_width;
		cursor.style.left = x + 'px';
	}
	this.update = update_cursor;

	this.onchanged = function(f)
	{
		on_changed_handler = f;
	};

	// 表示領域のサイズが変わった時(初回・画面回転・リサイズ)に呼ぶ
	this.resize = function()
	{
		scale_width = Math.max(1, bar.clientWidth);
		draw_scale();
		update_cursor();
	};

	function set_year_from_x(xpos)
	{
		let frac = xpos / scale_width;
		data.year = Math.round(frac_to_year(frac));
		update_cursor();
		if (on_changed_handler) {
			on_changed_handler();
		}
	}
	function bar_relative_x(clientX)
	{
		return clientX - bar.getBoundingClientRect().left;
	}

	bar.addEventListener('mousedown', e =>
	{
		set_year_from_x(bar_relative_x(e.clientX));
	});
	bar.addEventListener('touchstart', e =>
	{
		set_year_from_x(bar_relative_x(e.touches[0].clientX));
		e.preventDefault();
	}, { passive: false });
	bar.addEventListener('touchmove', e =>
	{
		set_year_from_x(bar_relative_x(e.touches[0].clientX));
		e.preventDefault();
	}, { passive: false });
}
