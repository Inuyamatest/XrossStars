## ファイターの状態遷移と物理（2D版 smash-game/game/fighter.py の移植）。
class_name Fighter
extends RefCounted


class MoveInst:
	extends RefCounted
	var d: MoveDef
	var f := 0
	var charge := 0
	var hitlog := {}
	var data := {}

	func _init(def: MoveDef) -> void:
		d = def


var idx := 0
var team := 0
var ch: Dictionary
var st: Dictionary
var moves: Dictionary
var ctrl = null
var is_cpu := false
var color: Color
var tag := ""
var stocks := 3
var hw := 22.0
var h := 84.0
var weight := 100.0
var damage := 0.0
var x := 0.0
var y := 0.0
var vx := 0.0
var vy := 0.0
var kx := 0.0
var ky := 0.0
var face := 1
var ground = null
var jumps := 1
var state := "stand"
var timer := 0
var move: MoveInst = null
var hitlag := 0
var hitstun := 0
var shieldstun := 0
var inv := 0
var shield_hp := C.SHIELD_MAX
var fastfall := false
var used_up := false
var used_side := false
var used_dodge := false
var ledge_inv_used := false
var ledge = null
var ledge_saved = null
var ledge_cd := 0
var drop_t := 0
var grab_target: Fighter = null
var grabbed_by: Fighter = null
var grab_timer := 0.0
var pummel_cd := 0
var meter := 0.0
var awakened := 0
var inp := InputState.new()
var prev := InputState.new()
var buf := {}
var tapx := 99
var tapy := 99
var last_hit_by: Fighter = null
var last_hit_frame := -9999
var kos := 0
var falls := 0
var dmg_dealt := 0.0
var anim := 0
var hidden := false
var out := false
var place := 0
var crouch := false
var dodge = null
var tumble := false
var shake := 0
var dmg_flash := 0
var tech_t := 0
var tech_lock := 0
var wall_side := 0


func _init(i: int, character: Dictionary, controller, stock_count: int, cpu := false) -> void:
	idx = i
	team = i
	ch = character
	st = character.stats
	moves = Chars.build_moves(character)
	ctrl = controller
	is_cpu = cpu
	color = C.PLAYER_COLORS[i % 4]
	tag = "CP" if cpu else C.PLAYER_TAGS[i % 4]
	stocks = stock_count
	hw = st.hw
	h = st.h
	weight = st.weight
	jumps = st.jumps
	for b in InputState.BUTTONS:
		buf[b] = 0


static func approach(v: float, target: float, step: float) -> float:
	return move_toward(v, target, step)


static func sgn(v: float) -> int:
	return 1 if v > 0 else (-1 if v < 0 else 0)


# ------------------------------------------------------------ 入力
func read_input(w) -> void:
	prev = inp
	inp = ctrl.get_input(w, self) if ctrl != null else InputState.new()
	for b in InputState.BUTTONS:
		if inp.get(b) and not prev.get(b):
			buf[b] = C.BUFFER
		elif buf[b] > 0:
			buf[b] -= 1
	tapx = 0 if (abs(inp.x) > 0.75 and (abs(prev.x) < 0.3 or sgn(inp.x) != sgn(prev.x))) else tapx + 1
	tapy = 0 if (abs(inp.y) > 0.75 and (abs(prev.y) < 0.3 or sgn(inp.y) != sgn(prev.y))) else tapy + 1


func consume(b: String) -> bool:
	if buf[b] > 0:
		buf[b] = 0
		return true
	return false


func pressed(b: String) -> bool:
	return buf[b] > 0


# ------------------------------------------------------------ 状態ヘルパ
func alive() -> bool:
	return not out and state != "dead"


func invincible() -> bool:
	if inv > 0 or hidden:
		return true
	if state == "dead" or state == "climb":
		return true
	if state == "dodge" and dodge != null and dodge.inv[0] <= timer and timer <= dodge.inv[1]:
		return true
	if state == "move" and move.d.in_window("inv", move.f):
		return true
	return false


func set_state(s: String, t := 0) -> void:
	state = s
	timer = t
	if s != "move":
		move = null
	hidden = false


func to_neutral() -> void:
	set_state("stand" if ground != null else "air")


func start_move(w, k: String) -> void:
	var d: MoveDef = moves[k]
	if d.once == "up":
		used_up = true
	elif d.once == "side" and ground == null:
		used_side = true
	set_state("move")
	move = MoveInst.new(d)
	w.event("swing", x, y - 40, {"who": self, "key": k})


func end_move(_w) -> void:
	if move.d.helpless and ground == null:
		set_state("helpless")
	else:
		to_neutral()


func can_awaken() -> bool:
	return meter >= 100.0


# ------------------------------------------------------------ メイン更新
func update(w) -> void:
	anim += 1
	if out:
		return
	if dmg_flash > 0:
		dmg_flash -= 1
	if state == "dead":
		timer -= 1
		if timer <= 0:
			w.respawn(self)
		return
	read_input(w)
	update_tech_input()
	if hitlag > 0:
		hitlag -= 1
		if shake > 0:
			shake -= 1
		return
	shake = 0
	if inv > 0: inv -= 1
	if ledge_cd > 0: ledge_cd -= 1
	if drop_t > 0: drop_t -= 1
	if pummel_cd > 0: pummel_cd -= 1
	if awakened > 0: awakened -= 1
	if state != "shield" and shield_hp < C.SHIELD_MAX:
		shield_hp = min(C.SHIELD_MAX, shield_hp + C.SHIELD_REGEN)
	crouch = false
	call("st_" + state, w)
	if not state in ["ledge", "climb", "grabbed", "dead", "respawn", "awaken"]:
		physics(w)
	if grab_target != null:
		hold_position()


# ------------------------------------------------------------ 地上
func try_awaken(w) -> bool:
	if can_awaken() and (consume("awaken") or (pressed("attack") and pressed("special"))):
		buf.attack = 0
		buf.special = 0
		w.start_awaken(self)
		return true
	return false


func ground_actions(w) -> bool:
	if try_awaken(w):
		return true
	if consume("jump"):
		set_state("jumpsquat", 3)
		return true
	if consume("grab") or (inp.shield and pressed("attack")):
		buf.attack = 0
		var dashing: bool = abs(vx) > st.walk + 0.5
		start_move(w, "dashgrab" if dashing else "grab")
		return true
	if inp.shield:
		set_state("shield")
		return true
	if consume("special"):
		start_special(w)
		return true
	if consume("smash"):
		start_smash(w)
		return true
	if consume("attack"):
		start_ground_attack(w)
		return true
	return false


func start_smash(w) -> void:
	if inp.y < -0.5:
		start_move(w, "usmash")
	elif inp.y > 0.5:
		start_move(w, "dsmash")
	else:
		if abs(inp.x) > 0.3:
			face = sgn(inp.x)
		start_move(w, "fsmash")


func start_ground_attack(w) -> void:
	var smash_x: bool = abs(inp.x) > 0.7 and tapx <= C.SMASH_TAP
	var smash_y: bool = abs(inp.y) > 0.7 and tapy <= C.SMASH_TAP
	var running: bool = abs(vx) > st.walk + 0.5
	if inp.y < -0.5:
		start_move(w, "usmash" if smash_y else "utilt")
	elif inp.y > 0.5:
		start_move(w, "dsmash" if smash_y else "dtilt")
	elif abs(inp.x) > 0.3:
		face = sgn(inp.x)
		if smash_x:
			start_move(w, "fsmash")
		elif running:
			start_move(w, "dash")
		else:
			start_move(w, "ftilt")
	else:
		start_move(w, "jab")


func start_special(w) -> void:
	var k := "nspecial"
	if inp.y < -0.5:
		k = "uspecial"
		if used_up:
			return
	elif abs(inp.x) > 0.5 and abs(inp.x) >= abs(inp.y):
		k = "sspecial"
		if used_side:
			return
		face = sgn(inp.x)
	elif inp.y > 0.5:
		k = "dspecial"
	if ground == null and moves.has(k + "_air"):
		k = k + "_air"
	start_move(w, k)


func st_stand(w) -> void:
	if ground_actions(w):
		return
	if inp.y > 0.5 and abs(inp.x) < 0.5:
		crouch = true
		vx = approach(vx, 0, st.friction * 2)
		if ground != w.stage.main and tapy <= 3:
			drop_t = 14
			ground = null
			y += 2
			set_state("air")
	elif abs(inp.x) > 0.2:
		face = sgn(inp.x)
		var target: float = (st.run if abs(inp.x) > 0.75 else st.walk) * sgn(inp.x)
		vx = approach(vx, target, 1.3)
	else:
		vx = approach(vx, 0, st.friction)


func st_jumpsquat(w) -> void:
	vx *= 0.9
	timer -= 1
	if timer <= 0:
		var full: bool = inp.jump or inp.y < -0.7
		vy = -(st.jump if full else st.short)
		vx += inp.x * 1.2
		ground = null
		set_state("air")
		w.event("jump", x, y, {"who": self})


func st_lag(_w) -> void:
	vx = approach(vx, 0, st.friction)
	timer -= 1
	if timer <= 0:
		to_neutral()


func st_knockdown(w) -> void:
	vx = approach(vx, 0, 0.8)
	timer += 1
	if ground == null:
		set_state("air")
		return
	var acted: bool = timer > 12 and (pressed("attack") or pressed("jump") or abs(inp.x) > 0.6 or inp.y < -0.6)
	if acted and consume("attack"):
		start_move(w, "getupatk")
		return
	if acted or timer > 60:
		if abs(inp.x) > 0.6:
			set_state("dodge")
			dodge = {"kind": "roll", "total": 30, "inv": [1, 20], "dir": sgn(inp.x), "dy": 0.0}
			return
		inv = 18
		set_state("lag", 18)


func st_dizzy(_w) -> void:
	timer -= 1
	vx = approach(vx, 0, 0.5)
	if timer <= 0:
		to_neutral()


# ------------------------------------------------------------ ガード・回避
func st_shield(w) -> void:
	vx = approach(vx, 0, st.friction)
	if ground == null:
		set_state("air")
		return
	if shieldstun > 0:
		shieldstun -= 1
		return
	shield_hp -= C.SHIELD_DRAIN
	if shield_hp <= 0:
		w.shield_break(self)
		return
	if consume("jump"):
		set_state("jumpsquat", 3)
		return
	if consume("attack") or consume("grab"):
		start_move(w, "grab")
		return
	if abs(inp.x) > 0.7 and tapx <= 3:
		start_dodge(w, "roll", sgn(inp.x))
		return
	if inp.y > 0.7 and tapy <= 3:
		start_dodge(w, "spot", 0)
		return
	if not inp.shield:
		set_state("lag", 6)


func start_dodge(w, kind: String, d: float, dy := 0.0) -> void:
	if kind == "roll":
		dodge = {"kind": kind, "total": 30, "inv": [4, 18], "dir": d, "dy": 0.0}
	elif kind == "spot":
		dodge = {"kind": kind, "total": 24, "inv": [3, 17], "dir": 0, "dy": 0.0}
	else:
		dodge = {"kind": kind, "total": 40, "inv": [3, 22], "dir": d, "dy": dy}
		used_dodge = true
		if d != 0 or dy != 0:
			vx = d * 11
			vy = dy * 11
		else:
			vx *= 0.5
			vy = min(vy, 2.0)
	set_state("dodge")
	timer = 0
	w.event("dodge", x, y - 40, {"who": self})


func st_dodge(_w) -> void:
	timer += 1
	var d: Dictionary = dodge
	if d.kind == "roll":
		vx = d.dir * 7.2 if (timer >= 3 and timer <= 22) else approach(vx, 0, 1.5)
		if timer >= d.total:
			face = -int(d.dir)
	elif d.kind == "spot" or d.kind == "tech":
		vx = approach(vx, 0, 1.5)
	else:
		if timer <= 16 and (d.dir != 0 or d.dy != 0):
			vx *= 0.88
			vy *= 0.88
	if timer >= d.total:
		dodge = null
		to_neutral()


# ------------------------------------------------------------ 受け身
func update_tech_input() -> void:
	if tech_t > 0: tech_t -= 1
	if tech_lock > 0: tech_lock -= 1
	if inp.shield and not prev.shield and tech_lock == 0:
		tech_t = C.TECH_WINDOW
		tech_lock = C.TECH_LOCK


func can_tech() -> bool:
	return state == "hitstun" and tech_t > 0


func tech_ground(w) -> void:
	tech_t = 0
	tech_lock = 0
	kx = 0; ky = 0; vx = 0; vy = 0
	hitstun = 0
	tumble = false
	var d := sgn(inp.x) if abs(inp.x) > 0.5 else 0
	if d != 0:
		dodge = {"kind": "roll", "total": 38, "inv": [0, 20], "dir": d, "dy": 0.0}
	else:
		dodge = {"kind": "tech", "total": 26, "inv": [0, 20], "dir": 0, "dy": 0.0}
	set_state("dodge")
	timer = 0
	w.event("tech", x, y - h * 0.3, {"who": self})


func tech_wall(w, side: int, ceiling := false) -> void:
	tech_t = 0
	tech_lock = 0
	kx = 0; ky = 0; vx = 0; vy = 0
	hitstun = 0
	tumble = false
	inv = max(inv, 20)
	set_state("walltech", 0)
	wall_side = 0 if ceiling else side
	w.event("tech", x + side * hw, y - h * 0.5, {"who": self})


func st_walltech(w) -> void:
	timer += 1
	vx = 0; vy = 0
	if wall_side != 0 and timer >= 4 and consume("jump"):
		vy = -st.djump * 0.95
		vx = -wall_side * st.air
		face = -wall_side
		set_state("air")
		w.event("djump", x, y, {"who": self})
		return
	if timer >= 12:
		set_state("air")


# ------------------------------------------------------------ 空中
func air_drift(mul := 1.0) -> void:
	if abs(inp.x) > 0.15:
		vx = approach(vx, inp.x * st.air * mul, st.airacc * mul)
	else:
		vx = approach(vx, 0, 0.06)


func st_air(w) -> void:
	air_drift()
	if vy > 0 and inp.y > 0.7 and tapy <= 4:
		fastfall = true
	if try_awaken(w):
		return
	if consume("jump") and jumps > 0:
		jumps -= 1
		vy = -st.djump
		vx = inp.x * st.air
		fastfall = false
		w.event("djump", x, y, {"who": self})
		return
	if consume("shield") and not used_dodge:
		var n := Vector2(inp.x, inp.y).length()
		if n > 0.4:
			start_dodge(w, "air", inp.x / n, inp.y / n)
		else:
			start_dodge(w, "air", 0, 0)
		return
	if consume("special"):
		start_special(w)
		return
	if consume("attack") or consume("smash") or consume("grab"):
		start_aerial(w)


func start_aerial(w) -> void:
	if inp.y < -0.5 and abs(inp.y) >= abs(inp.x):
		start_move(w, "uair")
	elif inp.y > 0.5 and abs(inp.y) >= abs(inp.x):
		start_move(w, "dair")
	elif inp.x * face > 0.3:
		start_move(w, "fair")
	elif inp.x * face < -0.3:
		start_move(w, "bair")
	else:
		start_move(w, "nair")


func st_helpless(_w) -> void:
	air_drift(0.6)


func st_hitstun(_w) -> void:
	hitstun -= 1
	if ground != null:
		vx = approach(vx, 0, 0.5)
	if hitstun <= 0:
		to_neutral()


# ------------------------------------------------------------ ワザ
func st_move(w) -> void:
	var m := move
	var d := m.d
	if d.charge_at != null and m.f == d.charge_at and m.charge < d.charge_max:
		var held: bool = inp.special if d.charge_btn == "special" else (inp.attack or inp.smash)
		if held:
			m.charge += 1
			if ground != null:
				vx = approach(vx, 0, st.friction)
			return
	m.f += 1
	if d.chain != null and m.f >= d.chain[0] and consume("attack"):
		start_move(w, d.chain[1])
		return
	if Moves.THROWS.has(d.key):
		var th: Array = Moves.THROWS[d.key]
		if m.f == th[0]:
			w.throw_release(self, th[1], face)
	if d.on_frame != null:
		d.on_frame.call(w, self, m)
	if state != "move" or move != m:
		return
	if ground != null:
		if not d.keep_vx:
			vx = approach(vx, 0, st.friction)
	elif not d.no_drift and not d.keep_vx:
		air_drift(0.8)
	if m.f >= d.total:
		end_move(w)


# ------------------------------------------------------------ つかみ・投げ
func hold_position() -> void:
	var t := grab_target
	if t == null or t.grabbed_by != self:
		grab_target = null
		return
	var side := face
	if state == "move" and move.d.key == "bthrow" and move.f >= 6:
		side = -face
	t.x = x + side * (hw + t.hw - 6)
	t.y = y
	t.face = -side


func st_hold(w) -> void:
	var t := grab_target
	vx = approach(vx, 0, 1)
	if t == null or t.grabbed_by != self:
		grab_target = null
		to_neutral()
		return
	timer += 1
	grab_timer -= 1
	if timer >= 8:
		if pressed("attack") and abs(inp.x) < 0.5 and abs(inp.y) < 0.5 and pummel_cd <= 0:
			consume("attack")
			pummel_cd = 16
			w.pummel(self, t)
			return
		var k := ""
		if inp.x * face > 0.6:
			k = "fthrow"
		elif inp.x * face < -0.6:
			k = "bthrow"
		elif inp.y < -0.6:
			k = "uthrow"
		elif inp.y > 0.6:
			k = "dthrow"
		if k != "":
			start_move(w, k)
			return
	if grab_timer <= 0:
		w.grab_release(self)


func st_grabbed(_w) -> void:
	var hd := grabbed_by
	if hd == null or hd.grab_target != self:
		grabbed_by = null
		to_neutral()
		return
	var mashed := tapx == 0 or tapy == 0
	for b in InputState.BUTTONS:
		if buf[b] == C.BUFFER:
			mashed = true
	if mashed:
		hd.grab_timer -= 4


# ------------------------------------------------------------ 崖
func st_ledge(w) -> void:
	var L = ledge
	x = L.x + L.dir * (hw + 2)
	y = L.y + h * 0.72
	vx = 0; vy = 0
	timer += 1
	var toward: int = -L.dir
	if timer < 8:
		return
	if consume("jump") or inp.y < -0.7:
		leave_ledge()
		y = L.y + 10
		vy = -15.5
		vx = toward * 2.6
		set_state("air")
		w.event("jump", x, y, {"who": self})
	elif consume("attack") or consume("smash"):
		leave_ledge()
		place_on_ledge_top(L)
		start_move(w, "ledgeatk")
	elif consume("shield"):
		leave_ledge()
		place_on_ledge_top(L)
		start_dodge(w, "roll", toward)
		dodge.inv = [1, 20]
	elif inp.x * toward > 0.5:
		leave_ledge()
		set_state("climb", 0)
	elif inp.x * L.dir > 0.5 or inp.y > 0.7 or timer > 300:
		leave_ledge()
		ledge_cd = 30
		set_state("air")


func place_on_ledge_top(L) -> void:
	x = L.x - L.dir * (hw + 4)
	y = L.y
	ground = null
	vy = 0


func leave_ledge() -> void:
	if ledge != null:
		ledge.holder = null
	ledge_saved = ledge
	ledge = null


func st_climb(w) -> void:
	timer += 1
	if timer >= 22:
		place_on_ledge_top(ledge_saved)
		vx = 0
		ground = w.stage.main
		set_state("stand")


func try_ledge(w) -> bool:
	if ledge_cd > 0 or ground != null:
		return false
	var ok: bool = (state == "air" or state == "helpless") and (vy >= 0 or state == "helpless")
	if state == "move" and move.d.ledge_ok and move.f > 6:
		ok = true
	if not ok or inp.y > 0.7:
		return false
	var hand_y := y - h * 0.85
	for L in w.stage.ledges:
		var dx: float = (x - L.x) * L.dir
		if dx >= -12 and dx <= hw + 36 and hand_y >= L.y - 30 and hand_y <= L.y + 40:
			if L.holder != null and L.holder != self:
				var other: Fighter = L.holder   # 崖奪い
				other.leave_ledge()
				other.ledge_cd = 40
				other.set_state("air")
				other.vx = L.dir * 4
			L.holder = self
			ledge = L
			face = -L.dir
			vx = 0; vy = 0; kx = 0; ky = 0
			jumps = st.jumps
			used_up = false; used_side = false; used_dodge = false
			fastfall = false
			if not ledge_inv_used:
				inv = max(inv, C.LEDGE_INV)
				ledge_inv_used = true
			set_state("ledge", 0)
			w.event("ledge", L.x, L.y, {"who": self})
			return true
	return false


# ------------------------------------------------------------ 覚醒・復活
func st_awaken(w) -> void:
	timer += 1
	if timer == 52:
		w.awaken_blast(self)
	if timer >= 70:
		to_neutral()


func st_respawn(_w) -> void:
	timer += 1
	vx = 0; vy = 0
	var moved: bool = abs(inp.x) > 0.5 or inp.y > 0.5
	for b in InputState.BUTTONS:
		if buf[b] > 0:
			moved = true
	if (moved and timer > 30) or timer > 240:
		set_state("air")
		inv = C.RESPAWN_INV


func st_dead(_w) -> void:
	pass


# ------------------------------------------------------------ 物理
func physics(w) -> void:
	var nograv := false
	if state == "move" and move.d.in_window("nograv", move.f):
		nograv = true
	if state == "dodge" and dodge.kind == "air" and timer <= 16 and (dodge.dir != 0 or dodge.dy != 0):
		nograv = true
	if state == "awaken" or state == "walltech":
		nograv = true
	if ground == null and not nograv:
		var maxf: float = st.ffall if fastfall else st.fall
		if fastfall:
			vy = max(vy, maxf)
		elif vy < maxf:
			vy = min(vy + st.grav, maxf)
	if kx != 0 or ky != 0:
		var mag := Vector2(kx, ky).length()
		if mag <= C.LAUNCH_DECAY:
			kx = 0; ky = 0
		else:
			var k := (mag - C.LAUNCH_DECAY) / mag
			kx *= k
			ky *= k
		if ground != null:
			kx *= 0.9
	var ox := x
	var oy := y
	x += vx + kx
	y += vy + ky
	w.collide(self, ox, oy)
	if ground == null:
		try_ledge(w)


func on_land(w) -> void:
	jumps = st.jumps
	fastfall = false
	used_up = false; used_side = false; used_dodge = false; ledge_inv_used = false
	var s := state
	if s == "hitstun":
		if can_tech():
			tech_ground(w)
			return
		if ky > 7 or (tumble and vy + ky > 9):
			ky = -abs(ky) * 0.6 - 2   # 叩きつけバウンド
			vy = 0
			ground = null
			w.event("bounce", x, y, {"who": self})
			return
		if tumble:
			kx *= 0.5
			ky = 0
			set_state("knockdown", 0)
			w.event("land", x, y, {"who": self, "heavy": true})
		return
	if s == "move":
		var d := move.d
		if d.on_land != null and d.on_land.call(w, self, move):
			return
		if d.air:
			set_state("lag", d.landlag)
		elif d.helpless:
			set_state("lag", 14)
		w.event("land", x, y, {"who": self})
		return
	if s == "helpless":
		set_state("lag", 14)
	elif s == "dodge" and dodge != null and dodge.kind == "air":
		dodge = null
		set_state("lag", 10)
	elif s == "air":
		set_state("lag", 3)
	w.event("land", x, y, {"who": self})
