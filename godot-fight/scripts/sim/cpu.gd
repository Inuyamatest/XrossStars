## CPU。レベル 0（棒立ち）〜 9。InputState を返すだけなので人間と同じルールで動く（2D版 ai.py の移植）。
class_name CpuController
extends RefCounted

var level := 5
var rng: RandomNumberGenerator
var seq: Array = []
var wait := 0
var hold_x := 0.0
var hold_y := 0.0


func _init(lv: int, r: RandomNumberGenerator) -> void:
	level = lv
	rng = r


static func S(opts := {}) -> InputState:
	return InputState.make(opts)


static func sg(v: float) -> float:
	return 1.0 if v > 0 else -1.0


func push(frames: Array) -> void:
	seq.append_array(frames)


func press(opts: Dictionary) -> void:
	push([S(opts), S({"x": opts.get("x", 0.0)})])


func get_input(w, f) -> InputState:
	if not seq.is_empty():
		return seq.pop_front()
	if level <= 0 or w.countdown > 0 or f.state == "dead":
		return S()
	var st: String = f.state
	if st == "respawn":
		return S({"y": 1.0 if rng.randf() < 0.03 else 0.0})
	if st == "grabbed":
		if rng.randf() < 0.15 + level * 0.06:
			return S({"attack": f.anim % 4 < 2, "x": 1.0 if f.anim % 8 < 4 else -1.0})
		return S()
	if st == "ledge":
		return on_ledge(w, f)
	if st == "hold":
		return on_hold(w, f)
	if st == "hitstun":
		# 受け身: 床・壁・天井に当たりそうなら、レベルに応じた確率でガードを押す
		if f.tech_lock == 0 and near_surface(w, f) and rng.randf() < 0.09 * level:
			var d: float = [-1.0, 0.0, 0.0, 1.0][rng.randi() % 4] if level >= 4 else 0.0
			push([S({"x": d}), S({"x": d})])
			return S({"shield": true, "x": d})
		# ずらし: ステージ側へ
		return S({"x": -sg(f.kx) if abs(f.kx) > 3 else 0.0, "y": -1.0 if f.ky > 3 else 0.0})
	if offstage(w, f):
		return recover(w, f)
	if wait > 0:
		wait -= 1
		return S({"x": hold_x, "y": hold_y})
	wait = max(0, 10 - level) + rng.randi_range(0, max(0, 6 - level / 2))
	hold_y = 0.0
	return fight(w, f)


func near_surface(w, f) -> bool:
	var m = w.stage.main
	var vx: float = f.vx + f.kx
	var vy: float = f.vy + f.ky
	for k in [3, 6, 9]:
		var nx: float = f.x + vx * k
		var ny: float = f.y + vy * k
		if vy > 0:
			for g in w.stage.surfaces():
				if nx >= g.x1 and nx <= g.x2 and f.y <= g.y and g.y <= ny:
					return true
		if nx > m.x1 - f.hw and nx < m.x2 + f.hw and ny > m.y + 4 and ny - f.h < m.y + m.depth:
			return true
	return false


func offstage(w, f) -> bool:
	var m = w.stage.main
	if f.ground != null:
		return false
	return f.x < m.x1 - 4 or f.x > m.x2 + 4 or f.y > m.y + 10


func recover(w, f) -> InputState:
	var m = w.stage.main
	var L = w.stage.ledges[0] if abs(w.stage.ledges[0].x - f.x) < abs(w.stage.ledges[1].x - f.x) else w.stage.ledges[1]
	var under: bool = f.x >= m.x1 and f.x <= m.x2
	var tx: float = L.x + L.dir * 50 if under else L.x
	var dx: float = tx - f.x
	var dy: float = f.y - L.y
	var x := sg(dx)
	if f.state != "air":
		return S({"x": x})
	if f.vy > -3:
		if f.jumps > 0 and dy > -40 and (abs(dx) > 60 or dy > 20):
			push([S({"x": x, "jump": true}), S({"x": x}), S({"x": x})])
			return S({"x": x})
		if not f.used_up and (dy > 30 or abs(dx) > 230) and (f.jumps == 0 or dy > 120):
			var v := Vector2(dx, -abs(dy + 80)).normalized()
			var frames := [S({"x": v.x, "y": min(v.y, -0.6), "special": true}), S({"x": v.x, "y": min(v.y, -0.6)})]
			for _i in range(18):
				frames.append(S({"x": v.x, "y": v.y}))
			push(frames)
			return S({"x": v.x, "y": -1.0})
		if not f.used_side and abs(dx) > 260 and dy < 90 and f.ch.get("side_recover", false):
			push([S({"x": x, "special": true}), S({"x": x})])
			return S({"x": x})
	return S({"x": x})


func on_ledge(_w, f) -> InputState:
	if f.timer < 10 + rng.randi_range(0, 30):
		return S()
	var toward: float = -f.ledge.dir
	var r := rng.randf()
	if r < 0.4:
		return S({"x": toward})
	if r < 0.65:
		push([S({"jump": true}), S({"jump": true}), S({"x": toward}), S({"x": toward})])
		return S({"jump": true})
	if r < 0.82:
		press({"attack": true})
		return S()
	press({"shield": true})
	return S()


func on_hold(w, f) -> InputState:
	var t = f.grab_target
	if t == null or f.timer < 8:
		return S()
	if f.timer < 40 and t.damage < 60 and rng.randf() < 0.06 * level and f.pummel_cd <= 0:
		return S({"attack": f.anim % 2 == 0})
	var m = w.stage.main
	var front: float = (m.x2 - f.x) if f.face > 0 else (f.x - m.x1)
	var back: float = (f.x - m.x1) if f.face > 0 else (m.x2 - f.x)
	if t.damage < 50 and rng.randf() < 0.5:
		return S({"y": 1.0 if rng.randf() < 0.5 else -1.0})
	if back < front:
		return S({"x": -f.face})
	return S({"x": f.face})


func target(w, f):
	var best = null
	var bd := 1e9
	for o in w.opponents(f):
		if not o.alive() or o.state == "respawn":
			continue
		var d: float = abs(o.x - f.x) + abs(o.y - f.y) * 0.7 + (300.0 if o.inv > 0 else 0.0)
		if d < bd:
			best = o
			bd = d
	return best


func fight(w, f) -> InputState:
	var t = target(w, f)
	var m = w.stage.main
	if t == null:
		hold_x = -sg(f.x) if abs(f.x) > 100 else 0.0
		return S({"x": hold_x})
	var dx: float = t.x - f.x
	var dy: float = t.y - f.y
	var adx: float = abs(dx)
	var dirx := sg(dx)
	var st: String = f.state
	hold_x = 0.0

	if st == "shield":
		if t.state == "move" and adx < 140 and rng.randf() < 0.85:
			wait = 6
			return S({"shield": true})
		if adx < 70 and rng.randf() < 0.5:
			press({"shield": true, "attack": true})
			return S({"shield": true})
		return S()

	if f.can_awaken() and adx < 420 and abs(dy) < 260 and (st == "stand" or st == "air") and rng.randf() < 0.3:
		press({"awaken": true})
		return S()

	var threat: bool = t.state == "move" and adx < 130 and abs(dy) < 110 and not t.move.d.hits.is_empty() and t.move.f < 10
	for p in w.projs:
		if p.owner == t and abs(p.x - f.x) < 140 and abs(p.y - (f.y - 40)) < 80:
			threat = true
	if threat and st == "stand" and rng.randf() < 0.07 * level:
		var r := rng.randf()
		if r < 0.6:
			var frames := []
			for _i in range(10 + rng.randi_range(0, 8)):
				frames.append(S({"shield": true}))
			push(frames)
		elif r < 0.8:
			push([S({"shield": true}), S({"shield": true, "y": 1.0}), S()])
		else:
			var d := -dirx if rng.randf() < 0.5 else dirx
			push([S({"shield": true}), S({"shield": true, "x": d}), S()])
		return S({"shield": true})

	if st == "stand":
		var on_main: bool = f.ground == m
		if t.state == "shield" and adx < 80:
			push([S({"x": dirx * 0.2, "grab": true}), S()])
			return S({"x": dirx * 0.2})
		if adx < 80 and abs(dy) < 50:
			if f.face != int(dirx):
				push([S({"x": dirx * 0.4})])
			var kill_pct: float = 85 + (t.weight - 100) * 0.8
			var r := rng.randf()
			if t.damage > kill_pct and r < 0.55:
				var frames := [S({"smash": true, "x": dirx})]
				for _i in range(rng.randi_range(0, 25)):
					frames.append(S({"smash": true}))
				frames.append(S())
				push(frames)
			elif t.state == "shield" or r < 0.18:
				push([S({"x": dirx * 0.3, "grab": true}), S()])
			elif r < 0.4:
				push([S({"attack": true}), S(), S({"attack": true}), S(), S({"attack": true}), S()])
			elif r < 0.62:
				push([S({"x": dirx * 0.5, "attack": true}), S()])
			elif r < 0.78:
				push([S({"y": 0.6, "attack": true}), S()])
			elif r < 0.9:
				push([S({"x": dirx * 0.4, "special": true}), S()])
			else:
				push([S({"y": 1.0, "smash": true}), S()])
			return S({"x": dirx * 0.4})
		if dy < -90 and adx < 90:
			if rng.randf() < 0.45 and dy > -200:
				push([S({"y": -1.0, "smash": true}), S()])
				return S()
			push([S({"jump": true}), S({"jump": true}), S({"jump": true}), S()])
			return S({"jump": true})
		if adx > 280 and f.face == int(dirx) and rng.randf() < 0.03 * level:
			push([S({"special": true}), S()])
			return S()
		var nx: float = f.x + dirx * 60
		if on_main and (nx < m.x1 + 40 or nx > m.x2 - 40) and (t.x < m.x1 or t.x > m.x2):
			return S()
		if rng.randf() < 0.015 * level and adx < 260:
			push([S({"x": dirx, "jump": true}), S({"x": dirx}), S({"x": dirx})])
			return S({"x": dirx})
		hold_x = dirx
		return S({"x": dirx})

	if st == "air":
		var x := dirx
		if f.x < m.x1 + 20 and dirx < 0 and t.x < m.x1 - 80:
			x = 1.0
		if f.x > m.x2 - 20 and dirx > 0 and t.x > m.x2 + 80:
			x = -1.0
		if adx < 95 and abs(dy) < 100:
			if dy < -45:
				push([S({"y": -1.0, "attack": true}), S({"x": x})])
			elif dy > 45:
				push([S({"y": 1.0, "attack": true}), S({"x": x})])
			elif adx < 30:
				push([S({"attack": true}), S({"x": x})])
			else:
				push([S({"x": dirx, "attack": true}), S({"x": x})])
			return S({"x": x})
		if dy < -130 and f.jumps > 0 and f.vy > -2 and rng.randf() < 0.5:
			push([S({"x": x, "jump": true}), S({"x": x})])
			return S({"x": x})
		if dy > 80 and f.vy > 0 and rng.randf() < 0.3:
			push([S({"x": x, "y": 1.0}), S({"x": x})])
			return S({"x": x})
		hold_x = x
		return S({"x": x})
	return S({"x": dirx if st == "lag" else 0.0})
