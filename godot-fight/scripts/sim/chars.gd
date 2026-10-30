## キャラ定義。model は characters/<id>/ に VRoid モデル（.glb/.vrm）を置くと使われる。
class_name Chars


static func stats(weight, walk, run, air, airacc, grav, fall, ffall, jump, short, djump, extra := {}) -> Dictionary:
	var d := {"weight": weight, "walk": walk, "run": run, "air": air, "airacc": airacc, "grav": grav, "fall": fall,
		"ffall": ffall, "jump": jump, "short": short, "djump": djump, "friction": 0.6, "jumps": 1, "hw": 22.0, "h": 84.0}
	d.merge(extra, true)
	return d


static func blaze() -> Dictionary:
	return {
		"id": "blaze", "name": "ブレイズ", "title": "炎の拳士",
		"stats": stats(100, 4.5, 8.6, 6.0, 0.45, 0.55, 9.5, 14.0, 14.6, 9.6, 14.0),
		"power": 1.0, "side_recover": true, "awaken": "インフェルノ・ノヴァ",
		"colors": {"body": Color(0.84, 0.23, 0.19), "accent": Color(1.0, 0.67, 0.24), "skin": Color(1.0, 0.84, 0.71),
			"hair": Color(0.59, 0.12, 0.12)},
		"specials": Moves.blaze_specials,
	}


static func build_moves(ch: Dictionary) -> Dictionary:
	var mv := Moves.common(ch.power)
	mv.merge(ch.specials.call(), true)
	return mv


static func all() -> Array:
	return [blaze()]
