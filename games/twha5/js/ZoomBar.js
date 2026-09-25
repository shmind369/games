'use strict';

function ZoomBar()
{
	const zoom_bar = document.getElementById('scale-zoom');
	const cursor = document.getElementById('scale-zoom-cursor');
	let on_changed_handler = null;

	// 「つまみ」を動かす
	function update_cursor()
	{
		cursor.style.left = (101 - data.zoom * 16) + 'px';
	}
	function zoom_limit()
	{
		if (data.zoom < 0) {
			data.zoom = 0;
		} else if (data.zoom > 4) {
			data.zoom = 4;
		}
	}

	this.update = update_cursor;

	this.onchanged = function(f)
	{
		on_changed_handler = f;
	};

	function set_zoom_from_x(clientX)
	{
		// マウス/タッチ座標からつまみ位置を求める
		data.zoom = Math.floor((116 - clientX) / 16);
		zoom_limit();
		update_cursor();
		if (on_changed_handler) {
			on_changed_handler();
		}
	}

	zoom_bar.addEventListener('mousedown', function(e)
	{
		set_zoom_from_x(e.clientX);
	});
	zoom_bar.addEventListener('touchstart', function(e)
	{
		set_zoom_from_x(e.touches[0].clientX);
		e.preventDefault();
	}, { passive: false });

	update_cursor();
}
