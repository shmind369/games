'use strict';

// 「国際関係」モードのON/OFFを切り替える丸ボタン。ON/OFFの状態は
// data.relations_modeに保持し、Region.js/CountryList.jsの国名タップが
// この値を見て挙動を切り替える。ボタン自体は状態の表示・切り替えのみを
// 担当し、関係性の計算・描画には一切関与しない(それはRelationsPanel.js
// の役目。モードがOFFの間はそちら側の処理も一切走らない)
function RelationsToggle()
{
	const el = document.getElementById('relations-toggle');

	function update_style()
	{
		el.classList.toggle('active', !!data.relations_mode);
	}

	let on_changed_handler = null;
	this.onchanged = function(f)
	{
		on_changed_handler = f;
	};

	function toggle()
	{
		data.relations_mode = !data.relations_mode;
		update_style();
		if (on_changed_handler) {
			on_changed_handler(data.relations_mode);
		}
	}

	el.addEventListener('mousedown', function(e)
	{
		toggle();
		e.preventDefault();
	});
	el.addEventListener('touchstart', function(e)
	{
		toggle();
		e.preventDefault();
	}, { passive: false });

	update_style();
}
