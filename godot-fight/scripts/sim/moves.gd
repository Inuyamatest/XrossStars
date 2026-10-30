## 共通ワザ（弱・強・スマッシュ・空中・つかみ・投げ）と、キャラの必殺ワザ。
class_name Moves

# 投げ: [離すフレーム, ふっとばし]
const THROWS := {
	"fthrow": [10, {"dmg": 8.0, "ang": 45.0, "bkb": 60.0, "kbg": 62.0}],
	"bthrow": [14, {"dmg": 10.0, "ang": 135.0, "bkb": 60.0, "kbg": 72.0}],
	"uthrow": [12, {"dmg": 7.0, "ang": 90.0, "bkb": 70.0, "kbg": 64.0}],
	"dthrow": [12, {"dmg": 6.0, "ang": 78.0, "bkb": 50.0, "kbg": 42.0}],
}


static func common(p: float) -> Dictionary:
	var mv := {}
	var slow_dash := func(_w, f, _m): f.vx *= 0.94
	var slow_grab := func(_w, f, _m): f.vx *= 0.85
	mv.jab = MoveDef.make("jab", 18, [MoveDef.H(3, 5, 34, -50, 22, 3 * p, 70, 15, 25, {"limb": "hand"})],
		{"chain": [7, "jab2"], "label": "弱1", "pose": "punch"})
	mv.jab2 = MoveDef.make("jab2", 18, [MoveDef.H(3, 5, 38, -48, 22, 3 * p, 70, 15, 25, {"limb": "hand"})],
		{"chain": [7, "jab3"], "label": "弱2", "pose": "punch2"})
	mv.jab3 = MoveDef.make("jab3", 30, [MoveDef.H(5, 8, 44, -44, 28, 5 * p, 40, 40, 80, {"limb": "foot"})],
		{"label": "弱3", "pose": "kick"})
	mv.ftilt = MoveDef.make("ftilt", 28, [MoveDef.H(6, 9, 52, -40, 27, 9 * p, 30, 30, 95, {"limb": "foot"})],
		{"label": "横強", "pose": "kick"})
	mv.utilt = MoveDef.make("utilt", 26, [MoveDef.H(5, 7, 30, -80, 28, 7 * p, 92, 40, 110, {"limb": "hand"}),
		MoveDef.H(8, 10, -10, -100, 28, 7 * p, 92, 40, 110, {"limb": "hand"})], {"label": "上強", "pose": "upswing"})
	mv.dtilt = MoveDef.make("dtilt", 22, [MoveDef.H(5, 7, 50, -10, 24, 6 * p, 75, 45, 55, {"limb": "foot"})],
		{"label": "下強", "pose": "lowkick"})
	mv.dash = MoveDef.make("dash", 34, [MoveDef.H(6, 12, 36, -40, 30, 10 * p, 55, 55, 70, {"limb": "foot"}),
		MoveDef.H(13, 20, 30, -40, 24, 6 * p, 55, 40, 60, {"limb": "foot"})],
		{"keep_vx": true, "label": "ダッシュ攻撃", "pose": "dashkick",
		 "on_frame": slow_dash})
	mv.fsmash = MoveDef.make("fsmash", 48, [MoveDef.H(14, 17, 60, -44, 33, 16 * p, 40, 35, 100, {"limb": "hand", "fx": "big"})],
		{"charge_at": 9, "label": "横スマッシュ", "pose": "bigpunch"})
	mv.usmash = MoveDef.make("usmash", 46, [MoveDef.H(11, 15, 6, -104, 36, 15 * p, 88, 35, 98, {"limb": "hand", "fx": "big"})],
		{"charge_at": 7, "label": "上スマッシュ", "pose": "upswing"})
	mv.dsmash = MoveDef.make("dsmash", 46, [MoveDef.H(10, 12, 48, -12, 28, 13 * p, 30, 30, 95, {"both": true, "limb": "foot", "fx": "big"})],
		{"charge_at": 5, "label": "下スマッシュ", "pose": "split"})
	mv.nair = MoveDef.make("nair", 36, [MoveDef.H(5, 10, 0, -42, 44, 9 * p, 45, 25, 85, {"fx": "ring"}),
		MoveDef.H(11, 22, 0, -42, 40, 5 * p, 45, 20, 70, {"fx": "ring"})],
		{"air": true, "landlag": 7, "label": "空N", "pose": "spin"})
	mv.fair = MoveDef.make("fair", 40, [MoveDef.H(12, 15, 46, -46, 32, 13 * p, 45, 30, 95, {"limb": "hand", "fx": "big"})],
		{"air": true, "landlag": 14, "label": "空前", "pose": "bigpunch"})
	mv.bair = MoveDef.make("bair", 34, [MoveDef.H(7, 10, -48, -42, 29, 12 * p, 140, 30, 100, {"limb": "foot"})],
		{"air": true, "landlag": 9, "label": "空後", "pose": "backkick"})
	mv.uair = MoveDef.make("uair", 30, [MoveDef.H(5, 9, 6, -106, 32, 9 * p, 85, 30, 105, {"limb": "foot"})],
		{"air": true, "landlag": 7, "label": "空上", "pose": "flipkick"})
	mv.dair = MoveDef.make("dair", 44, [MoveDef.H(14, 17, 4, 2, 30, 13 * p, 270, 25, 85, {"limb": "foot", "fx": "big"})],
		{"air": true, "landlag": 16, "label": "空下", "pose": "stomp"})
	mv.grab = MoveDef.make("grab", 32, [MoveDef.H(6, 8, 40, -46, 26, 0, 0, 0, 0, {"grab": true, "limb": "hand"})],
		{"label": "つかみ", "pose": "grab"})
	mv.dashgrab = MoveDef.make("dashgrab", 38, [MoveDef.H(8, 10, 52, -46, 28, 0, 0, 0, 0, {"grab": true, "limb": "hand"})],
		{"keep_vx": true, "label": "ダッシュつかみ", "pose": "grab", "on_frame": slow_grab})
	mv.ledgeatk = MoveDef.make("ledgeatk", 32, [MoveDef.H(10, 14, 44, -30, 32, 8, 35, 60, 30, {"limb": "foot"})],
		{"inv": [1, 10], "label": "崖上がり攻撃", "pose": "kick"})
	mv.getupatk = MoveDef.make("getupatk", 32, [MoveDef.H(9, 13, 46, -16, 30, 7, 30, 60, 30, {"both": true, "limb": "foot"})],
		{"inv": [1, 12], "label": "起き上がり攻撃", "pose": "split"})
	mv.fthrow = MoveDef.make("fthrow", 28, [], {"label": "前投げ", "pose": "throwf"})
	mv.bthrow = MoveDef.make("bthrow", 32, [], {"label": "後投げ", "pose": "throwb"})
	mv.uthrow = MoveDef.make("uthrow", 30, [], {"label": "上投げ", "pose": "throwu"})
	mv.dthrow = MoveDef.make("dthrow", 30, [], {"label": "下投げ", "pose": "throwd"})
	return mv


## ブレイズ（炎・バランス型）の必殺ワザ
static func blaze_specials() -> Dictionary:
	var fire_n := func(w, f, m):
		if m.f == 12:
			w.spawn_proj(f, "fire", f.x + f.face * 36, f.y - 50, 7.5 * f.face, -2.0,
				{"r": 13.0, "dmg": 5.0, "ang": 40.0, "bkb": 25.0, "kbg": 35.0, "life": 110, "grav": 0.32, "bounce": 3})
	var rush := func(_w, f, m):
		if m.f >= 8 and m.f <= 22:
			f.vx = 12.5 * f.face
			f.vy = 0.0
		elif m.f > 22:
			f.vx *= 0.8
	var rise := func(_w, f, m):
		if m.f == 3:
			f.vy = -19.5
			f.vx = f.inp.x * 4.0
			f.ground = null
	var dive := func(_w, f, m):
		if m.f == 8:
			f.ground = null
		if m.f >= 8:
			f.vy = 22.0
			f.vx = 0.0
	var dive_land := func(w, f, _m):
		f.start_move(w, "d_land")
		return true
	var sp := {}
	sp.nspecial = MoveDef.make("nspecial", 36, [], {"label": "ファイアボール", "pose": "cast", "on_frame": fire_n})
	sp.sspecial = MoveDef.make("sspecial", 42, [MoveDef.H(8, 22, 30, -44, 30, 12, 38, 50, 80, {"fx": "fire", "limb": "hand"})],
		{"label": "フレイムラッシュ", "pose": "dash", "nograv": [6, 24], "keep_vx": true, "once": "side", "on_frame": rush})
	sp.uspecial = MoveDef.make("uspecial", 46, [MoveDef.H(3, 8, 22, -56, 32, 10, 80, 50, 85, {"fx": "fire", "limb": "hand"}),
		MoveDef.H(9, 20, 10, -76, 26, 5, 80, 40, 60, {"fx": "fire", "group": 1, "limb": "hand"})],
		{"label": "ライジングフレア", "pose": "uppercut", "helpless": true, "once": "up", "ledge_ok": true, "keep_vx": true,
		 "on_frame": rise})
	sp.dspecial = MoveDef.make("dspecial", 40, [MoveDef.H(10, 14, 44, -20, 42, 12, 70, 55, 80, {"both": true, "fx": "fire"})],
		{"label": "イラプション", "pose": "stomp"})
	sp.dspecial_air = MoveDef.make("dspecial_air", 80, [MoveDef.H(8, 80, 0, -10, 30, 11, 280, 30, 70, {"fx": "fire"})],
		{"label": "メテオクラッシュ", "pose": "stomp", "nograv": [1, 7], "no_drift": true, "on_frame": dive,
		 "on_land": dive_land})
	sp.d_land = MoveDef.make("d_land", 24, [MoveDef.H(1, 4, 44, -20, 46, 10, 65, 60, 70, {"both": true, "fx": "fire"})],
		{"label": "メテオクラッシュ", "pose": "stomp"})
	return sp
