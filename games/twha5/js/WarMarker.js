'use strict';

// 出来事の種類ごとのアイコン(絵文字。新しい画像アセットを増やさずに
// 済ませている)
const WAR_TYPE_ICON = { war: '⚔', coup: '🏛', riot: '🔥', unrest: '⚡' };

// 地図上に表示する戦争・クーデター・暴動・騒動などのイベントマーカー。
// js/wars.jsのwar_list内の1件に対応する。国名パネル(Region.js)と同じ
// 「タップで名前を検索してWikipedia要約を開く」しくみ
// (attach_tap_search/trigger_info_tap、Region.jsで定義)をそのまま
// 再利用している
function WarMarker(w)
{
	this.pos_x = w.x;
	this.pos_y = w.y;
	// Region.jsのdisp_levelと同じ意味(この値未満のズームでは表示しない)。
	// 既定は0(常に表示)
	this.disp_level = (typeof w.disp_level === 'number') ? w.disp_level : 0;

	function localized(text_map)
	{
		if (!text_map) {
			return '';
		}
		return text_map[data.lang] || text_map.ja || '';
	}

	function create_node()
	{
		let node = document.createElement('div');
		node.classList.add('war-marker');

		let title = document.createElement('div');
		title.classList.add('war-marker-title');
		node.appendChild(title);

		let sides = document.createElement('div');
		sides.classList.add('war-marker-sides');
		node.appendChild(sides);

		attach_tap_search(title, function()
		{
			return localized(w.name);
		});

		return node;
	}

	this.node = create_node();
	this.node.style.zIndex = this.pos_y + 500;

	this.update = function(x, y)
	{
		this.node.style.left = x + 'px';
		this.node.style.top = (y - 8) + 'px';

		let icon = WAR_TYPE_ICON[w.type] || WAR_TYPE_ICON.war;
		this.node.childNodes[0].innerText = icon + ' ' + localized(w.name);

		// ズームが小さいうちは当事者(sides)までは表示しない
		let sidesText = localized(w.sides);
		if (data.zoom >= 2 && sidesText) {
			this.node.childNodes[1].innerText = sidesText;
			this.node.childNodes[1].style.display = '';
		} else {
			this.node.childNodes[1].style.display = 'none';
		}
	};
}
