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
	const year_controls = new YearControls();

	let screen_width = 0;
	let screen_height = 0;
	let resize_timer = -1;

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
		year_controls.update();
	});
	lang_button.onchanged(function()
	{
		year_text.update();
		map.update_style();
		country_list.update();
		year_controls.update();
	});
	year_text.onchanged(function()
	{
		year_bar.update();
		map.update();
		country_list.update();
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
	Region.onInfoTap(function(query)
	{
		wiki_panel.show(query);
	});
	year_controls.onchanged(function()
	{
		year_text.update();
		year_bar.update();
		map.update();
		country_list.update();
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
		if (delta > 0) {
			if (data.zoom < 4) {
				data.zoom++;
				zoom_bar.update();
				map.update();
			}
		} else if (delta < 0) {
			if (data.zoom > 0) {
				data.zoom--;
				zoom_bar.update();
				map.update();
			}
		}
	});

	resize();
});
