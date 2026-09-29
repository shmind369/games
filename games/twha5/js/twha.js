(function(fn)
{
    if (document.readyState !== 'loading'){
        fn();
    } else {
        document.addEventListener('DOMContentLoaded', fn);
    }
})(function()
{
	const zoom_bar = new ZoomBar();
	const lang_button = new LangButton();
	const year_text = new YearText();
	const year_bar = new YearBar();
	const map = new Map();
	const country_list = new CountryList();
	const wiki_panel = new WikiPanel();
	const relations_panel = new RelationsPanel();
	const relations_toggle = new RelationsToggle();
	const year_controls = new YearControls();

	let screen_width = 0;
	let screen_height = 0;
	let resize_timer = -1;
	// マウスホイールでのズーム感度。ホイール1ノッチ(だいたい±100〜120)
	// あたりズーム段階のこの分の1だけ変化する(値が大きいほど鈍感になる)
	const WHEEL_ZOOM_SENSITIVITY = 300;

	data.year_clamp = function()
	{
		if (this.year < -4000) {
			this.year = -4000;
		} else if (this.year == 0) {
			this.year = 1;
		} else if (this.year > MAX_YEAR) {
			this.year = MAX_YEAR;
		}
	};

	function resize()
	{
		let body = document.getElementsByTagName('body')[0];

		screen_width = body.offsetWidth;
		screen_height = body.offsetHeight;
		let canvas_w = screen_width - year_bar.SIZE;

		map.set_size(canvas_w, screen_height);

		year_bar.resize();

		map.update();
	}

	year_bar.onchanged(function()
	{
		year_text.update();
		map.update();
		country_list.update();
		relations_panel.update();
		year_controls.update();
	});
	lang_button.onchanged(function()
	{
		year_text.update();
		map.update_style();
		country_list.update();
		relations_panel.update();
		year_controls.update();
	});
	year_text.onchanged(function()
	{
		year_bar.update();
		map.update();
		country_list.update();
		relations_panel.update();
		year_controls.update();
	});
	zoom_bar.onchanged(function()
	{
		map.update();
	});
	country_list.onjump(function(x, y, regionIndex)
	{
		map.jump_to(x, y);
		map.highlight_region(regionIndex);
	});
	country_list.oninfotap(function(query)
	{
		wiki_panel.show(query);
	});
	Region.onInfoTap(function(query)
	{
		wiki_panel.show(query);
	});
	country_list.onrelationtap(function(jaName)
	{
		relations_panel.show(jaName);
	});
	Region.onRelationTap(function(jaName)
	{
		relations_panel.show(jaName);
	});
	// 「国際関係」モードをOFFにした時点で、開いていれば関係性パネルを
	// 閉じ、それ以上の計算が走らないようにする(要望の「OFFの場合は
	// 関係性に関する計算・描画を可能な限り行わない」に対応)
	relations_toggle.onchanged(function(on)
	{
		if (!on) {
			relations_panel.close();
		}
	});
	year_controls.onchanged(function()
	{
		year_text.update();
		year_bar.update();
		map.update();
		country_list.update();
		relations_panel.update();
	});
	map.on_zoom_changed(function()
	{
		zoom_bar.update();
	});

	window.addEventListener('resize', function()
	{
        if (resize_timer !== -1) {
            clearTimeout(resize_timer);
        }

        resize_timer = setTimeout(function() {
            resize_timer = -1;
			resize();
        }, 250);
	});

	(function(callback)
	{
		if (window.addEventListener) {
			window.addEventListener('DOMMouseScroll', callback, false);
			window.addEventListener('mousewheel', callback, false);
		}
	})(function(e)
	{
		let delta = e.wheelDelta ? e.wheelDelta : e.deltaY ? -e.deltaY : -e.detail;
		// ホイール1ノッチ(だいたい±100〜120)でズーム1段階分の一部だけ
		// 連続的に変化させ、5段階のカクカクした切り替えではなく滑らかに
		// 拡大縮小できるようにする(zoom_bar.update()はmap側の
		// on_zoom_changedハンドラ経由で呼ばれる)
		map.adjust_zoom(delta / WHEEL_ZOOM_SENSITIVITY);
	});

	resize();
});
