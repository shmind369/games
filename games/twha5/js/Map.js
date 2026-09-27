'use strict';

function Map()
{
	const landLayer = document.getElementById('layer-land');
	const tertLayer = document.getElementById('layer-tert');
	const infoLayer = document.getElementById('layer-info');

	const MAP_SIZE = 450;
	const MAP_X = 8;
	const MAP_Y = 4;
	const SCALES = [0.5, 1, 2, 4, 8];

	const mpLandCache = new Array(MAP_X * MAP_Y);
	const mpTertCache = new Array(MAP_X * MAP_Y);
	// 指定した年のRegionパネル全て
	let regions_this_year = [];
	// 画面上に見えているRegionパネル全て
	let visible_regions = [];

	let curWidth, curHeight;
	let curWidth2, curHeight2;
	let mousedown_x = 0;
	let mousedown_y = 0;
	let prev_zoom = data.zoom;
	let prev_year = -9999;


	function getMapLandPart(i, j)
	{
		let idx = i + j * MAP_X;
		let ld = mpLandCache[idx];
		if (!ld){
			ld = document.createElement('img');
			ld.setAttribute('alt', '');
			ld.setAttribute('src', 'sf/' + i + j + '.png');
			mpLandCache[idx] = ld;
		}
		return ld;
	}
	function getMapTertYear(year, i, j)
	{
		let a = territory[i][j];
		let lb = 0, ub = a.length;
		while (lb < ub) {
			let m = Math.floor((lb + ub) / 2);
			if (year >= a[m]) {
				if (m + 1 == ub || year < a[m + 1]) {
					return a[m];
				}
				lb = m + 1;
			} else {
				ub = m;
			}
		}
		return -4000;
	}
	function getMapTertPart(i, j)
	{
		let idx = i + j * MAP_X;
		let mp = mpTertCache[idx];
		if (!mp){
			mp = document.createElement('img');
			mp.setAttribute('alt', '');
			mpTertCache[idx] = mp;
		}
		mp.setAttribute('src', 't/' + i + j + '/' + getMapTertYear(data.year, i, j) + '.png');
		return mp;
	}
	function update_map()
	{
		// zoomが変化している場合、座標中心も変化する
		if (prev_zoom !== data.zoom) {
			data.map_x = Math.round(data.map_x * SCALES[data.zoom] / SCALES[prev_zoom]);
			data.map_y = Math.round(data.map_y * SCALES[data.zoom] / SCALES[prev_zoom]);
			prev_zoom = data.zoom;
		}

		// マップの表示範囲を計算
		let curX = data.map_x;
		let curY = data.map_y;
		let mapSize = MAP_SIZE * SCALES[data.zoom];
		let maxW = Math.ceil(curWidth / mapSize);
		let maxH = Math.ceil(curHeight / mapSize);

		let rev = false;

		let ox = curX - curWidth2;
		if (ox < 0) {
			ox += mapSize * MAP_X;
		}
		let mx = ox % mapSize;
		let px = Math.floor(ox / mapSize);
		let ex = px + maxW;
		if (ex >= MAP_X) {
			ex -= MAP_X;
			rev = true;
		}

		let oy = curY - curHeight2;
		let my, py;
		if (oy < 0) {
			my = mapSize - (-oy % mapSize) - 1;
			py = -Math.floor(-oy / mapSize) - 1;
		} else {
			my = oy % mapSize;
			py = Math.floor(oy / mapSize);
		}
		let ey = py + maxH;

		// マップを表示
		for (let i = 0; i < MAP_X; i++) {
			let vi = (i >= px && i <= ex);
			if (rev) {
				vi = !vi;
			}
			for (let j = 0; j < MAP_Y; j++) {
				let idx = i + j * MAP_X;
				let mpLand;
				let mpTert;

				if (vi && j >= py && j <= ey) {
					mpLand = getMapLandPart(i, j);
					mpTert = getMapTertPart(i, j);

					if (!mpLand.parentNode) {
						landLayer.appendChild(mpLand);
					}
					if (!mpTert.parentNode) {
						tertLayer.appendChild(mpTert);
					}

					let dx = i - px;
					if (dx < 0) {
						dx += MAP_X;
					}
					let dy = j - py;

					mpLand.style.left = (dx * mapSize - mx) + 'px';
					mpLand.style.top = (dy * mapSize - my) + 'px';
					mpLand.setAttribute('width', mapSize);
					mpLand.setAttribute('height', mapSize);

					mpTert.style.left = (dx * mapSize - mx) + 'px';
					mpTert.style.top = (dy * mapSize - my) + 'px';
					mpTert.setAttribute('width', mapSize);
					mpTert.setAttribute('height', mapSize);
				} else {
					mpLand = mpLandCache[idx];
					mpTert = mpTertCache[idx];

					if (mpLand && mpLand.parentNode) {
						landLayer.removeChild(mpLand);
					}
					if (mpTert && mpTert.parentNode) {
						tertLayer.removeChild(mpTert);
					}
				}
			}
		}
	}

	// 全Regionから、指定した年に含まれるものだけを抽出
	function update_region_of_year(yr)
	{
		let ret = [];

		for (let i = 0; i < region_list.length; i++) {
			let a = region_list[i];
			let rg = a[0];
			if (rg) {
				if (rg.node && rg.node.parentNode) {
					infoLayer.removeChild(rg.node);
				}
				if (yr >= a[1] && yr < a[2]) {
					rg.update_year();
				} else {
					a[0] = rg = null;
				}
			} else {
				if (yr >= a[1] && yr < a[2]) {
					a[0] = rg = new Region(a);
					rg.update_year();
				}
			}
			if (rg) {
				ret.push(rg);
			}
		}

		return ret;
	}

	// infoLayerに追加
	function insert_visible_regions(nt)
	{
		visible_regions.push(nt);
		infoLayer.appendChild(nt.node);
	}
	// infoLayerから削除
	function remove_visible_region(rg)
	{
		infoLayer.removeChild(rg.node);
		let i = visible_regions.indexOf(rg);
		if (i >= 0) {
			visible_regions.splice(i, 1);
		}
	}

	function update_info()
	{
		if (prev_year !== data.year) {
			regions_this_year = update_region_of_year(data.year);
			visible_regions = [];
			prev_year = data.year;
		}
		let scale = SCALES[data.zoom];
		let mapSize = MAP_SIZE * scale;
		let curX = data.map_x;
		let curY = data.map_y;

		for (let i = 0; i < regions_this_year.length; i++) {
			let nt = regions_this_year[i];
			let px = nt.pos_x * scale - curX;
			let py = nt.pos_y * scale - curY;

			if (px > mapSize * 4) {
				px -= mapSize * 8;
			} else if (px < -mapSize * 4) {
				px += mapSize * 8;
			}

			if (px > -curWidth2 - REGION_WIDTH && px < curWidth2 + 20 &&
				py > -curHeight2 - 210 && py < curHeight2 + 15 && data.zoom >= nt.disp_level)
			{
				// 見えている
				nt.update(px + curWidth2, py + curHeight2);

				if (!nt.node.parentNode) {
					insert_visible_regions(nt);
				}
			} else {
				// 見えなくなった
				if (nt.node.parentNode) {
					remove_visible_region(nt);
				}
			}
		}
	}

	// スクロール位置を合わせる
	function limit_map_center()
	{
		let mapSize = MAP_SIZE * SCALES[data.zoom];
		let maxX = MAP_X * mapSize;
		let maxY = MAP_Y * mapSize;

		// 左右限度を超えた場合、1周回る
		if (data.map_x < 0) {
			data.map_x += maxX;
		} else if (data.map_x >= maxX) {
			data.map_x -= maxX;
		}

		// 上下限を超えないようにする
		if (data.map_y < 0) {
			data.map_y = 0;
		} else if (data.map_y > maxY) {
			data.map_y = maxY;
		}
	}

	this.set_size = function(width, height)
	{
		curWidth = width;
		curHeight = height;
		curWidth2 = Math.floor(width / 2);
		curHeight2 = Math.floor(height / 2);

		let w = width + 'px';
		let h = height + 'px';

		landLayer.style.width = w;
		landLayer.style.height = h;
		tertLayer.style.width = w;
		tertLayer.style.height = h;
		infoLayer.style.width = w;
		infoLayer.style.height = h;
	};
	this.update = function()
	{
		update_map();
		update_info();
	};
	// 指定した地域の座標(pos_x, pos_y。region_listのera行に入っている
	// 生の位置データと同じ単位)を画面中央に来るようパンする
	this.jump_to = function(x, y)
	{
		let scale = SCALES[data.zoom];
		data.map_x = Math.round(x * scale);
		data.map_y = Math.round(y * scale);
		limit_map_center();
		this.update();
	};
	this.update_style = function()
	{
		for (let i = 0; i < visible_regions.length; i++) {
			visible_regions[i].update();
		}
	};

	let on_zoom_changed_handler = null;
	this.on_zoom_changed = function(f)
	{
		on_zoom_changed_handler = f;
	};

	infoLayer.addEventListener('mousedown', function(e)
	{
		mousedown_x = e.clientX;
		mousedown_y = e.clientY;
        e.preventDefault();
	});
	infoLayer.addEventListener('mousemove', function(e)
	{
		if (e.buttons != 0 && (mousedown_x !== e.clientX || mousedown_y !== e.clientY)) {
			// マウスドラッグによるスクロール
			data.map_x += mousedown_x - e.clientX;
			data.map_y += mousedown_y - e.clientY;
			limit_map_center();
			mousedown_x = e.clientX;
			mousedown_y = e.clientY;
			update_map();
			update_info();
		}
        e.preventDefault();
	});

	// --- iPhone/iPad等のタッチ操作対応 ---
	let touch_pinch_dist = 0;

	// ダブルタップ後、指を離さず上下にドラッグして片手でズーム(Googleマップ風)
	const DOUBLE_TAP_INTERVAL_MS = 300;
	const DOUBLE_TAP_MOVE_PX = 30;
	const ZOOM_DRAG_STEP_PX = 28;
	let last_tap_time = 0;
	let last_tap_x = 0;
	let last_tap_y = 0;
	let zoom_drag_active = false;
	let zoom_drag_base_y = 0;

	function touch_dist(t0, t1)
	{
		let dx = t0.clientX - t1.clientX;
		let dy = t0.clientY - t1.clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}
	function touch_dist_xy(x0, y0, x1, y1)
	{
		let dx = x0 - x1;
		let dy = y0 - y1;
		return Math.sqrt(dx * dx + dy * dy);
	}

	infoLayer.addEventListener('touchstart', function(e)
	{
		if (e.touches.length == 1) {
			let x = e.touches[0].clientX;
			let y = e.touches[0].clientY;
			let now = Date.now();

			if (now - last_tap_time < DOUBLE_TAP_INTERVAL_MS &&
				touch_dist_xy(x, y, last_tap_x, last_tap_y) < DOUBLE_TAP_MOVE_PX)
			{
				// ダブルタップの2回目: このまま指を動かすとズームドラッグになる
				zoom_drag_active = true;
				zoom_drag_base_y = y;
			} else {
				zoom_drag_active = false;
			}
			last_tap_time = now;
			last_tap_x = x;
			last_tap_y = y;

			mousedown_x = x;
			mousedown_y = y;
		} else if (e.touches.length == 2) {
			zoom_drag_active = false;
			touch_pinch_dist = touch_dist(e.touches[0], e.touches[1]);
		}
		e.preventDefault();
	}, { passive: false });
	infoLayer.addEventListener('touchmove', function(e)
	{
		if (e.touches.length == 1) {
			let x = e.touches[0].clientX;
			let y = e.touches[0].clientY;

			if (zoom_drag_active) {
				// ダブルタップ長押しドラッグでズーム(上方向=拡大、下方向=縮小)
				let diff = zoom_drag_base_y - y;
				if (Math.abs(diff) > ZOOM_DRAG_STEP_PX) {
					if (diff > 0 && data.zoom < 4) {
						data.zoom++;
					} else if (diff < 0 && data.zoom > 0) {
						data.zoom--;
					}
					zoom_drag_base_y = y;
					if (on_zoom_changed_handler) {
						on_zoom_changed_handler();
					}
					update_map();
					update_info();
				}
			} else {
				// 1本指ドラッグでスクロール
				data.map_x += mousedown_x - x;
				data.map_y += mousedown_y - y;
				limit_map_center();
				update_map();
				update_info();
			}
			mousedown_x = x;
			mousedown_y = y;
		} else if (e.touches.length == 2) {
			zoom_drag_active = false;
			// 2本指ピンチでズーム
			let dist = touch_dist(e.touches[0], e.touches[1]);
			if (touch_pinch_dist > 0) {
				let diff = dist - touch_pinch_dist;
				if (Math.abs(diff) > 24) {
					if (diff > 0 && data.zoom < 4) {
						data.zoom++;
					} else if (diff < 0 && data.zoom > 0) {
						data.zoom--;
					}
					if (on_zoom_changed_handler) {
						on_zoom_changed_handler();
					}
					touch_pinch_dist = dist;
					update_map();
					update_info();
				}
			} else {
				touch_pinch_dist = dist;
			}
		}
		e.preventDefault();
	}, { passive: false });
	infoLayer.addEventListener('touchend', function(e)
	{
		if (e.touches.length == 1) {
			mousedown_x = e.touches[0].clientX;
			mousedown_y = e.touches[0].clientY;
		} else {
			touch_pinch_dist = 0;
		}
		if (e.touches.length == 0) {
			zoom_drag_active = false;
		}
		e.preventDefault();
	}, { passive: false });
}
