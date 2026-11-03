## タイプ別の必殺ワザ（通常・横・上・下）。2D版の各キャラの必殺ワザを移植・アレンジしたもの。
class_name Specials


static func _dir(f, def := Vector2(0, -1)) -> Vector2:
	var v := Vector2(f.inp.x, f.inp.y)
	return v.normalized() if v.length() > 0.3 else def


# ================================================================ 剣（居合・飛ぶ斬撃・見切り）
static func sword() -> Dictionary:
	var wave := func(w, f, m):
		if m.f == 10:
			w.spawn_proj(f, "slash", f.x + f.face * 40, f.y - 46, 11.0 * f.face, 0.0,
				{"r": 20.0, "dmg": 7.0, "ang": 40.0, "bkb": 35.0, "kbg": 45.0, "life": 38, "color": Color(0.7, 0.95, 1.0)})
	var dash := func(_w, f, m):
		if m.f >= 6 and m.f <= 13:
			f.vx = 19.0 * f.face
			f.vy = 0.0
		elif m.f > 13:
			f.vx *= 0.6
	var rise := func(_w, f, m):
		if m.f == 4:
			f.vy = -18.5
			f.vx = f.inp.x * 3.5
			f.ground = null
	return {
		"nspecial": MoveDef.make("nspecial", 34, [], {"label": "飛燕斬", "pose": "cast", "on_frame": wave}),
		"sspecial": MoveDef.make("sspecial", 34, [MoveDef.H(6, 13, 34, -46, 32, 11, 40, 50, 80, {"fx": "slash", "limb": "hand"})],
			{"label": "居合突進", "pose": "dash", "inv": [6, 9], "nograv": [5, 15], "keep_vx": true, "once": "side", "on_frame": dash}),
		"uspecial": MoveDef.make("uspecial", 44, [MoveDef.H(4, 9, 30, -80, 34, 9, 80, 50, 85, {"fx": "slash", "limb": "hand"}),
			MoveDef.H(10, 18, 14, -96, 28, 4, 80, 40, 60, {"fx": "slash", "group": 1, "limb": "hand"})],
			{"label": "昇り斬り", "pose": "uppercut", "helpless": true, "once": "up", "ledge_ok": true, "keep_vx": true, "on_frame": rise}),
		"dspecial": MoveDef.make("dspecial", 38, [], {"label": "見切り", "pose": "counter", "counter": [4, 22], "nograv": [1, 26]}),
		"d_hit": MoveDef.make("d_hit", 28, [], {"label": "見切り", "pose": "bigpunch", "inv": [1, 20]}),
	}


# ================================================================ 槍（槍投げ・突撃・跳躍突き・転倒）
static func spear() -> Dictionary:
	var throw_ := func(w, f, m):
		if m.f == 16:
			w.spawn_proj(f, "spear", f.x + f.face * 44, f.y - 52, 13.5 * f.face, -1.5,
				{"r": 16.0, "dmg": 10.0, "ang": 35.0, "bkb": 40.0, "kbg": 70.0, "life": 70, "grav": 0.12, "color": Color(1.0, 0.85, 0.4)})
	var charge := func(_w, f, m):
		if m.f >= 8 and m.f <= 22:
			f.vx = 9.0 * f.face
			if f.ground == null:
				f.vy = 0.0
		elif m.f > 22:
			f.vx *= 0.75
	var vault := func(_w, f, m):
		if m.f == 5:
			f.vy = -20.5
			f.vx = f.inp.x * 3.0
			f.ground = null
	return {
		"nspecial": MoveDef.make("nspecial", 42, [], {"label": "槍投げ", "pose": "throwf", "on_frame": throw_}),
		"sspecial": MoveDef.make("sspecial", 46, [MoveDef.H(10, 22, 64, -46, 30, 14, 40, 60, 85, {"fx": "big", "shieldmul": 1.6, "limb": "hand"})],
			{"label": "騎士の突撃", "pose": "dash", "armor": [6, 22], "keep_vx": true, "once": "side", "on_frame": charge}),
		"uspecial": MoveDef.make("uspecial", 46, [MoveDef.H(5, 12, 14, -118, 30, 11, 88, 50, 85, {"fx": "big", "limb": "hand"})],
			{"label": "跳躍突き", "pose": "uppercut", "helpless": true, "once": "up", "ledge_ok": true, "keep_vx": true, "on_frame": vault}),
		# 低く当たって転ばせる（ふっとばしは弱いが、相手は寝転がる）
		"dspecial": MoveDef.make("dspecial", 40, [MoveDef.H(12, 16, 70, -10, 30, 8, 10, 70, 15, {"both": true, "fx": "slash", "limb": "foot"})],
			{"label": "触れれば転倒！", "pose": "split"}),
	}


# ================================================================ 格闘（衝撃波・コマンドつかみ・アーマーアッパー・ボディプレス）
static func brawler() -> Dictionary:
	var wave := func(w, f, m):
		if m.f == 16:
			w.spawn_proj(f, "wave", f.x + f.face * 40, f.y - 22, 9.0 * f.face, 0.0,
				{"r": 22.0, "dmg": 8.0, "ang": 60.0, "bkb": 45.0, "kbg": 60.0, "life": 50, "grav": 0.6, "ground_wave": true,
				 "color": Color(0.85, 0.2, 0.3)})
	var lunge := func(_w, f, m):
		if m.f >= 6 and m.f <= 20:
			f.vx = 9.0 * f.face
		elif m.f > 20:
			f.vx *= 0.7
	var slam := func(w, f, m):
		var t = f.grab_target
		if t == null:
			return
		if m.f < 26:
			t.x = f.x + f.face * 6
			t.y = f.y - f.h + 10 - min(m.f, 14) * 3
		if m.f == 14:
			f.vy = -11.0
			f.ground = null
		if m.f == 28:
			w.throw_release(f, {"dmg": 14.0, "ang": 75.0, "bkb": 75.0, "kbg": 75.0}, f.face)
	var upper := func(_w, f, m):
		if m.f == 5:
			f.vy = -18.0
			f.vx = f.inp.x * 3.0
			f.ground = null
	var press := func(_w, f, m):
		if m.f == 4 and f.ground != null:
			f.vy = -9.0
			f.ground = null
		if m.f >= 12:
			f.vy = 18.0
	var press_land := func(w, f, m):
		if m.f < 6:
			return false
		f.start_move(w, "d_land")
		return true
	return {
		"nspecial": MoveDef.make("nspecial", 44, [], {"label": "衝撃波", "pose": "stomp", "on_frame": wave}),
		"sspecial": MoveDef.make("sspecial", 50, [MoveDef.H(8, 20, 42, -46, 32, 0, 0, 0, 0, {"grab": true, "cmd": true, "limb": "hand"})],
			{"label": "わしづかみ", "pose": "grab", "keep_vx": true, "once": "side", "on_frame": lunge}),
		"s_throw": MoveDef.make("s_throw", 46, [], {"label": "叩きつけ", "pose": "throwu", "keep_vx": true, "nograv": [1, 13], "on_frame": slam}),
		"uspecial": MoveDef.make("uspecial", 50, [MoveDef.H(5, 14, 24, -70, 36, 12, 85, 55, 80, {"fx": "big", "limb": "hand"})],
			{"label": "剛拳アッパー", "pose": "uppercut", "armor": [4, 14], "helpless": true, "once": "up", "ledge_ok": true,
			 "keep_vx": true, "on_frame": upper}),
		"dspecial": MoveDef.make("dspecial", 90, [MoveDef.H(12, 90, 0, 0, 36, 12, 280, 30, 70)],
			{"label": "ボディプレス", "pose": "stomp", "no_drift": true, "on_frame": press, "on_land": press_land}),
		"d_land": MoveDef.make("d_land", 28, [MoveDef.H(1, 4, 56, -18, 50, 12, 60, 60, 85, {"both": true, "fx": "big"})],
			{"label": "ボディプレス", "pose": "stomp"}),
	}


# ================================================================ スピード（雪玉・高速ダッシュ・2段ワープ・ふぶき）
static func speed() -> Dictionary:
	var snow := func(w, f, m):
		if m.f == 9:
			w.spawn_proj(f, "snow", f.x + f.face * 34, f.y - 52, 9.5 * f.face, -3.0,
				{"r": 11.0, "dmg": 4.0, "ang": 50.0, "bkb": 25.0, "kbg": 30.0, "life": 80, "grav": 0.35, "color": Color(0.92, 0.97, 1.0)})
	var sdash := func(_w, f, m):
		if m.f >= 8 and m.f <= 24 and not m.data.get("hit", false):
			f.vx = 16.0 * f.face
			f.vy = 0.0
		elif m.f > 24:
			f.vx *= 0.8
	var sdash_hit := func(_w, f, m, _t):
		m.data["hit"] = true
		f.vx = -4.0 * f.face
		f.vy = -6.0
	var zip := func(_w, f, m):
		if m.f == 3:
			m.data["d1"] = _dir(f)
		if m.f >= 3 and m.f <= 11:
			var d: Vector2 = m.data["d1"]
			f.vx = d.x * 21.0
			f.vy = d.y * 21.0
			if d.y < 0.2:
				f.ground = null
		elif m.f >= 12 and m.f <= 15:
			f.vx *= 0.3
			f.vy *= 0.3
		if m.f == 16:
			var v := Vector2(f.inp.x, f.inp.y)
			m.data["d2"] = v.normalized() if v.length() > 0.3 else Vector2.ZERO
		if m.f >= 16 and m.f <= 23 and m.data.get("d2", Vector2.ZERO) != Vector2.ZERO:
			var d2: Vector2 = m.data["d2"]
			f.vx = d2.x * 21.0
			f.vy = d2.y * 21.0
		if m.f == 24:
			f.vx *= 0.5
			f.vy *= 0.3
	var storm := func(_w, f, m):
		if f.ground == null and m.f < 30:
			f.vy = min(f.vy, 1.5)
	return {
		"nspecial": MoveDef.make("nspecial", 30, [], {"label": "雪玉", "pose": "throwf", "on_frame": snow}),
		"sspecial": MoveDef.make("sspecial", 44, [MoveDef.H(8, 24, 24, -42, 30, 10, 45, 40, 85, {"fx": "slash"})],
			{"label": "疾風ダッシュ", "pose": "dash", "nograv": [8, 24], "keep_vx": true, "once": "side", "on_frame": sdash, "on_hit": sdash_hit}),
		"uspecial": MoveDef.make("uspecial", 40, [MoveDef.H(3, 11, 0, -40, 30, 3, 80, 40, 30), MoveDef.H(16, 23, 0, -40, 30, 4, 80, 40, 40, {"group": 1})],
			{"label": "電光石火", "pose": "spin", "nograv": [3, 26], "helpless": true, "once": "up", "ledge_ok": true, "keep_vx": true,
			 "no_drift": true, "on_frame": zip}),
		"dspecial": MoveDef.make("dspecial", 48, [MoveDef.H(12, 28, 0, -42, 72, 11, 70, 60, 80, {"radial": true, "fx": "ring"})],
			{"label": "ふぶき", "pose": "cast", "on_frame": storm}),
	}


# ================================================================ 魔法（ため撃ち・瞬間移動斬り・ワープ・反射）
static func magic() -> Dictionary:
	var shot := func(w, f, m):
		if m.f == 8:
			var c: float = m.charge / 60.0
			w.spawn_proj(f, "shot", f.x + f.face * 40, f.y - 50, (11.0 + 3.0 * c) * f.face, 0.0,
				{"r": 9.0 + 15.0 * c, "dmg": 4.0 + 18.0 * c, "ang": 40.0, "bkb": 25.0 + 30.0 * c, "kbg": 40.0 + 55.0 * c, "life": 90,
				 "color": Color(0.8, 0.5, 1.0)})
	var slide := func(_w, f, m):
		if m.f >= 6 and m.f <= 12:
			f.vx = 20.0 * f.face
			f.vy = 0.0
		elif m.f > 12:
			f.vx *= 0.6
	var warp := func(w, f, m):
		if m.f <= 12:
			f.vx = 0.0
			f.vy = 0.0
			f.hidden = true
		if m.f == 1:
			m.data["dir"] = _dir(f)
		if m.f == 12:
			var d := _dir(f, m.data["dir"])
			f.x += d.x * 240.0
			f.y += d.y * 240.0
			f.ground = null
			f.hidden = false
			if d.x != 0:
				f.face = 1 if d.x > 0 else -1
			w.event("warp", f.x, f.y - 40, {"who": f})
	return {
		"nspecial": MoveDef.make("nspecial", 30, [], {"label": "チャージショット", "pose": "cast", "on_frame": shot,
			"charge_at": 4, "charge_btn": "special", "charge_max": 60}),
		"sspecial": MoveDef.make("sspecial", 36, [MoveDef.H(6, 12, 20, -44, 32, 9, 45, 45, 75, {"fx": "ring"})],
			{"label": "瞬間移動斬り", "pose": "dash", "inv": [6, 12], "nograv": [5, 14], "keep_vx": true, "once": "side", "on_frame": slide}),
		"uspecial": MoveDef.make("uspecial", 36, [MoveDef.H(13, 18, 0, -44, 38, 6, 80, 50, 50, {"fx": "ring"})],
			{"label": "ワープ", "pose": "cast", "inv": [1, 14], "nograv": [1, 14], "helpless": true, "once": "up", "ledge_ok": true,
			 "keep_vx": true, "on_frame": warp}),
		"dspecial": MoveDef.make("dspecial", 40, [], {"label": "リフレクター", "pose": "counter", "counter": [4, 24], "reflect": true, "nograv": [1, 30]}),
		"d_hit": MoveDef.make("d_hit", 30, [], {"label": "リフレクター", "pose": "bigpunch", "inv": [1, 22]}),
	}


# ================================================================ 逢坂大河（MUGEN 版の必殺ワザをそのまま使う）
# アニメ番号は Taiga.air の番号。ワザのフレームは アニメのティック+1（spr_mode "direct"）
static func taiga() -> Dictionary:
	# ヘルスラスト: 一気に踏み込んで木刀で突く
	var thrust := func(w, f, m):
		# 目の前（木刀が届く距離）に相手がいたら踏み込みを止める。止めないと突きが出る前に相手をすり抜ける
		if not m.data.has("stop") and m.f >= 6 and m.f <= 19:
			for t in w.fighters:
				if t == f or not t.alive() or t.team == f.team:
					continue
				var hb := World.hurtbox(t)
				var front: float = (hb[0] - f.x) if f.face > 0 else (f.x - hb[2])
				if front < 70.0 and front > -f.hw - 10.0 and f.y - 80.0 < hb[3] and f.y + 10.0 > hb[1]:
					m.data["stop"] = true
		if m.data.has("stop"):
			f.vx *= 0.3
		elif m.f >= 8 and m.f <= 19:
			f.vx = 12.0 * f.face
		elif m.f > 19:
			f.vx *= 0.6
	# 大河ニークラッシュ: 斜め上に跳びひざ（復帰ワザ）
	var knee := func(_w, f, m):
		if m.f == 7:
			f.vy = -17.0
			f.vx = 4.0 * f.face
			f.ground = null
		elif m.f > 7 and m.f < 22:
			f.vx = lerp(f.vx, 4.0 * f.face, 0.2)
	# ウザいのよ！: 空中なら急降下してから地面をたたく
	var stomp := func(_w, f, m):
		if f.ground == null and m.f >= 9:
			f.vy = 15.0
			f.vx *= 0.8
	# M-Morgue: その場でマイクを振り回す（空中ではゆっくり落ちる）
	var morgue := func(_w, f, m):
		if f.ground == null and m.f < 50:
			f.vy = min(f.vy, 1.5)
			f.vx *= 0.92
	var multi := MoveDef.H(0, 0, 0, 0, 10, 1.5, 30, 20, 0, {"rehit": 5, "fx": "hit", "shieldmul": 0.5})
	var finish := MoveDef.H(0, 0, 0, 0, 10, 7.0, 40, 55, 70, {"fx": "big"})
	return {
		"nspecial": MoveDef.make("nspecial", 72, [multi, finish],
			{"label": "M-Morgue", "spr": 1000, "mugen_hits": true, "on_frame": morgue}),
		"sspecial": MoveDef.make("sspecial", 44, [MoveDef.H(0, 0, 0, 0, 10, 13.0, 35, 50, 85, {"fx": "big", "shieldmul": 1.4})],
			{"label": "ヘルスラスト", "spr": 1300, "mugen_hits": true, "keep_vx": true, "nograv": [1, 26], "once": "side",
			 "on_frame": thrust}),
		"uspecial": MoveDef.make("uspecial", 40, [MoveDef.H(0, 0, 0, 0, 10, 11.0, 80, 55, 75, {"fx": "big"})],
			{"label": "大河ニークラッシュ", "spr": 1100, "mugen_hits": true, "helpless": true, "once": "up", "ledge_ok": true,
			 "keep_vx": true, "on_frame": knee}),
		"uspecial_air": MoveDef.make("uspecial_air", 40, [MoveDef.H(0, 0, 0, 0, 10, 11.0, 80, 55, 75, {"fx": "big"})],
			{"label": "大河ニークラッシュ", "spr": 1101, "mugen_hits": true, "helpless": true, "once": "up", "ledge_ok": true,
			 "keep_vx": true, "on_frame": knee}),
		# 地面をたたいて左右の相手を真上に打ち上げる（元は画面全体に届くので、届く範囲を絞っている）
		"dspecial": MoveDef.make("dspecial", 46, [MoveDef.H(26, 28, 0, -10, 40, 12.0, 90, 60, 75,
			{"rect": [-125.0, -26.0, 125.0, 4.0], "fx": "big"})],
			{"label": "ウザいのよ！", "spr": 1200, "mugen_hits": true, "no_drift": true, "on_frame": stomp}),
	}
