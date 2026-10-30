## 試合の進行: 当たり判定・ふっとばし・飛び道具・撃墜・勝敗（2D版 world.py の移植）。
## 描画とは完全に分かれていて、ヘッドレスでも動く。
class_name World
extends RefCounted


class Proj:
	extends RefCounted
	var owner: Fighter
	var kind := ""
	var x := 0.0
	var y := 0.0
	var vx := 0.0
	var vy := 0.0
	var r := 12.0
	var dmg := 5.0
	var ang := 40.0
	var bkb := 30.0
	var kbg := 40.0
	var life := 90
	var grav := 0.0
	var bounce := 0
	var hit := {}
	var dead := false
	var t := 0


var rng := RandomNumberGenerator.new()
var stage: Stage
var fighters: Array = []
var projs: Array = []
var events: Array = []
var frame := 0
var cinema = null          # [fighter, 残りフレーム]
var countdown := 0
var go_t := 0
var over := false
var ending := 0
var winner: Fighter = null
var stocks := 3


static func calc_kb(p: float, d: float, w: float, bkb: float, kbg: float) -> float:
	## スマブラ式のふっとばし力（p は被弾後の%）
	return ((((p / 10.0 + p * d / 20.0) * 200.0 / (w + 100.0) * 1.4) + 18.0) * kbg / 100.0) + bkb


static func circle_rect(cx: float, cy: float, r: float, rc: Array) -> bool:
	var nx: float = clamp(cx, rc[0], rc[2])
	var ny: float = clamp(cy, rc[1], rc[3])
	return (cx - nx) * (cx - nx) + (cy - ny) * (cy - ny) <= r * r


static func hurtbox(f: Fighter) -> Array:
	var hh := f.h * (0.62 if f.crouch else 1.0)
	if f.state == "knockdown":
		hh = f.h * 0.4
	return [f.x - f.hw, f.y - hh, f.x + f.hw, f.y]


func _init(stage_key: String, entries: Array, stock_count := 3, seed := 0, with_countdown := true) -> void:
	## entries: [[キャラ辞書, コントローラ, CPUか], ...]
	rng.seed = seed
	stage = Stage.make(stage_key)
	stocks = stock_count
	for i in range(entries.size()):
		var e: Array = entries[i]
		fighters.append(Fighter.new(i, e[0], e[1], stock_count, e[2]))
	for i in range(fighters.size()):
		var f: Fighter = fighters[i]
		f.x = stage.spawns[i % stage.spawns.size()]
		f.y = stage.main.y
		f.ground = stage.main
		f.face = 1 if f.x < 0 else -1
	countdown = 170 if with_countdown else 0


func event(kind: String, ex: float, ey: float, extra := {}) -> void:
	var e := {"kind": kind, "x": ex, "y": ey}
	e.merge(extra, true)
	events.append(e)


func opponents(f: Fighter) -> Array:
	var out := []
	for o in fighters:
		if o != f and o.team != f.team and not o.out:
			out.append(o)
	return out


func spawn_proj(owner: Fighter, kind: String, px: float, py: float, pvx: float, pvy: float, opts := {}) -> Proj:
	var p := Proj.new()
	p.owner = owner; p.kind = kind; p.x = px; p.y = py; p.vx = pvx; p.vy = pvy
	for k in opts:
		p.set(k, opts[k])
	projs.append(p)
	event("proj", px, py, {"proj": kind})
	return p


# ------------------------------------------------------------ 1フレーム
func step() -> void:
	if over:
		return
	frame += 1
	if countdown > 0:
		countdown -= 1
		if countdown == 0:
			go_t = 50
			event("go", 0, 0)
		elif countdown % 50 == 20 and countdown < 160:
			event("count", 0, 0, {"n": countdown / 50 + 1})
		for f in fighters:
			f.read_input(self)
		return
	if go_t > 0:
		go_t -= 1
	if cinema != null:
		var cf: Fighter = cinema[0]
		cf.update(self)
		cinema[1] -= 1
		if cinema[1] <= 0:
			cinema = null
		return
	stage.update(frame)
	for f in fighters:
		var g = f.ground
		if g != null and (g.dx != 0 or g.dy != 0) and f.state != "dead" and f.state != "ledge":
			f.x += g.dx
			f.y = g.y
	for f in fighters:
		f.update(self)
	resolve_hits()
	update_projs()
	push_apart()
	check_blast()
	check_end()


# ------------------------------------------------------------ 地形
func collide(f: Fighter, ox: float, oy: float) -> void:
	var m := stage.main
	if f.ground != null:
		var g = f.ground
		if f.ky < -0.5 or f.vy < -0.5:
			f.ground = null
		elif f.x < g.x1 or f.x > g.x2:
			var clampit: bool = f.state in ["dodge", "shield", "lag", "hold", "jumpsquat", "grabbed", "climb", "dizzy"]
			if f.state == "move" and not f.move.d.keep_vx:
				clampit = true
			if clampit:
				f.x = clamp(f.x, g.x1, g.x2)
				f.vx = 0
				f.y = g.y
			else:
				f.ground = null
				if f.state == "stand" or f.state == "knockdown":
					f.set_state("air")
		else:
			f.y = g.y
			f.vy = 0
			if f.ky > 0:
				f.ky = 0
	if f.ground != null:
		return
	if f.y - oy >= 0 and f.state != "grabbed":
		for g in stage.surfaces():
			if not g.solid and (f.drop_t > 0 or (f.state == "helpless" and f.inp.y > 0.7)):
				continue
			if oy - g.dy <= g.y + 1 and f.y >= g.y and f.x >= g.x1 and f.x <= g.x2:
				land(f, g)
				return
	for _i in range(3):
		if not collide_solids(f, m):
			break


func collide_solids(f: Fighter, m) -> bool:
	## ステージ本体（輪切りの矩形の列）との押し出し。押し出したら true。
	var l := f.x - f.hw
	var r := f.x + f.hw
	var top := f.y - f.h
	var bot := f.y
	for k in range(m.solids.size()):
		var s: Array = m.solids[k]
		if not (r > s[0] and l < s[2] and bot > s[1] + 1 and top < s[3]):
			continue
		var pen := {"left": r - s[0], "right": s[2] - l, "down": s[3] - top}
		if k == 0:
			pen["up"] = bot - s[1]
		var side := "left"
		for key in pen:
			if pen[key] < pen[side]:
				side = key
		if side == "up":
			f.x = clamp(f.x, m.x1, m.x2)
			land(f, m)
			return true
		if side == "left":
			f.x = s[0] - f.hw
			wall(f, 1)
		elif side == "right":
			f.x = s[2] + f.hw
			wall(f, -1)
		else:
			f.y = s[3] + f.h
			if f.can_tech():
				f.tech_wall(self, 0, true)
				return true
			if f.vy < 0:
				f.vy = 0
			if f.ky < 0:
				f.ky = -f.ky * 0.5
		return true
	return false


func land(f: Fighter, g) -> void:
	f.y = g.y
	f.vy = 0
	f.ground = g
	f.on_land(self)
	if f.ground != null and f.ky > 0:
		f.ky = 0


func wall(f: Fighter, side := 0) -> void:
	if f.can_tech():
		f.tech_wall(self, side)
		return
	if f.state == "hitstun" and abs(f.kx) > 6:
		f.kx = -f.kx * 0.5
		event("bounce", f.x, f.y - f.h / 2, {"who": f})
	else:
		f.kx = 0
	f.vx = 0


func push_apart() -> void:
	var fs := []
	for f in fighters:
		if f.alive() and f.ground != null and f.state != "grabbed" and f.state != "hold":
			fs.append(f)
	for i in range(fs.size()):
		for j in range(i + 1, fs.size()):
			var a: Fighter = fs[i]
			var b: Fighter = fs[j]
			if a.ground != b.ground:
				continue
			var d := b.x - a.x
			var minv := (a.hw + b.hw) * 0.7
			if abs(d) < minv:
				var s := 1 if d >= 0 else -1
				var push: float = min(1.2, (minv - abs(d)) * 0.15)
				a.x -= s * push
				b.x += s * push


# ------------------------------------------------------------ 当たり判定
func resolve_hits() -> void:
	for a in fighters:
		if a.state != "move" or not a.alive() or a.hitlag > 0:
			continue
		var m: Fighter.MoveInst = a.move
		for h in m.d.active(m.f):
			var boxes := [[a.x + h.x * a.face, a.y + h.y, a.face]]
			if h.both:
				boxes.append([a.x - h.x * a.face, a.y + h.y, -a.face])
			for t in fighters:
				if t == a or not t.alive() or t.team == a.team or t.grabbed_by == a or t.state == "respawn":
					continue
				var key := "%d_%d" % [t.idx, h.group]
				if m.hitlog.has(key) and (h.rehit == 0 or m.f - m.hitlog[key] < h.rehit):
					continue
				var hb := hurtbox(t)
				for b in boxes:
					if circle_rect(b[0], b[1], h.r, hb):
						var dsg: int = b[2]
						if h.radial:
							dsg = Fighter.sgn(t.x - a.x) if t.x != a.x else a.face
						if apply_hit(a, t, h, dsg, m):
							m.hitlog[key] = m.f
						break
				if a.state != "move" or a.move != m:
					break
			if a.state != "move" or a.move != m:
				break


func apply_hit(a: Fighter, t: Fighter, h: Dictionary, dsg: int, m = null, proj = null) -> bool:
	if t.invincible() or t.state == "respawn":
		return false
	if t.state == "move" and t.move.d.in_window("counter", t.move.f) and not h.get("grab", false) and proj == null:
		counter(t, a, h)
		return true
	if h.get("grab", false):
		if a.grab_target != null or (t.ground == null and t.state != "shield") or t.grabbed_by != null:
			return false
		grab(a, t, h.get("cmd", false))
		return true
	var dmg: float = h.dmg
	if m != null and m.d.charge_at != null and m.d.charge_btn != "special":
		dmg *= 1.0 + 0.4 * m.charge / 60.0
	if a.awakened > 0:
		dmg *= 1.2
	dmg = snapped(dmg, 0.1)
	var hl := int(min(20.0, dmg * 0.65 + 4.0))
	if t.state == "shield":
		t.shield_hp -= dmg * 1.2 * h.get("shieldmul", 1.0)
		t.shieldstun = int(dmg * 0.8) + 3
		t.vx = dsg * min(9.0, 2.0 + dmg * 0.45)
		t.hitlag = hl / 2
		if proj == null:
			a.hitlag = hl / 2
		event("block", t.x - dsg * t.hw, t.y - t.h / 2, {"dmg": dmg, "who": t})
		if t.shield_hp <= 0:
			shield_break(t)
		return true
	t.damage = min(999.0, t.damage + dmg)
	a.dmg_dealt += dmg
	a.meter = min(100.0, a.meter + dmg)
	t.meter = min(100.0, t.meter + dmg * 0.6)
	var kb := calc_kb(t.damage, dmg, t.weight, h.bkb, h.kbg)
	if t.state == "move" and t.move.d.in_window("armor", t.move.f) and kb < 230:
		t.hitlag = hl
		if proj == null:
			a.hitlag = hl
		t.dmg_flash = 8
		event("armor", t.x, t.y - t.h / 2, {"dmg": dmg})
		return true
	if t.crouch:
		kb *= 0.85
	if t.grab_target != null:
		grab_release(t, true)
	if t.grabbed_by != null:
		var hd: Fighter = t.grabbed_by
		hd.grab_target = null
		t.grabbed_by = null
		hd.to_neutral()
	if t.ledge != null:
		t.leave_ledge()
	launch(t, kb, h.ang, dsg)
	t.last_hit_by = a
	t.last_hit_frame = frame
	t.dmg_flash = 10
	t.hitlag = hl
	t.shake = hl
	if proj == null:
		a.hitlag = hl
	if m != null and m.d.on_hit != null:
		m.d.on_hit.call(self, a, m, t)
	var hx: float = (a.x + t.x) / 2.0 if proj == null else proj.x
	event("hit", hx, t.y - t.h * 0.55, {"dmg": dmg, "kb": kb, "who": t, "by": a, "fx": h.get("fx", "slash")})
	return true


func launch(t: Fighter, kb: float, ang: float, dsg: int) -> void:
	var rad := deg_to_rad(ang)
	var l := Vector2(cos(rad) * dsg, -sin(rad))
	# ずらし（DI）: スティックの横成分で最大15度
	var perp := Vector2(-l.y, l.x)
	var dot: float = clamp(t.inp.x * perp.x + t.inp.y * perp.y, -1.0, 1.0)
	if kb > 60:
		l = l.rotated(dot * deg_to_rad(15))
	if t.ground != null and l.y > 0:
		l.y = -l.y * 0.8
	var speed := kb * C.LAUNCH_SCALE
	t.set_state("hitstun")
	t.kx = l.x * speed
	t.ky = l.y * speed
	t.vx = 0
	t.vy = 0
	t.hitstun = int(kb * C.HITSTUN_MUL)
	t.tumble = kb > 80
	t.fastfall = false
	t.shieldstun = 0
	if t.ky < -1:
		t.ground = null


func counter(t: Fighter, a: Fighter, h: Dictionary) -> void:
	t.start_move(self, "d_hit")
	var dsg := Fighter.sgn(a.x - t.x) if a.x != t.x else t.face
	t.face = dsg
	event("counter", t.x, t.y - t.h / 2, {"who": t})
	apply_hit(t, a, {"dmg": max(8.0, h.dmg * 1.3), "ang": 40.0, "bkb": 60.0, "kbg": 85.0, "fx": "big"}, dsg)


# ------------------------------------------------------------ つかみ・投げ
func grab(a: Fighter, t: Fighter, cmd := false) -> void:
	a.grab_target = t
	t.grabbed_by = a
	t.set_state("grabbed")
	t.vx = 0; t.vy = 0; t.kx = 0; t.ky = 0
	t.shieldstun = 0
	t.ground = a.ground
	event("grab", t.x, t.y - t.h / 2, {"who": t, "by": a})
	if cmd:
		a.start_move(self, "s_throw")
	else:
		a.set_state("hold", 0)
		a.grab_timer = 50.0 + t.damage * 0.7
	a.hold_position()


func grab_release(a: Fighter, quiet := false) -> void:
	var t := a.grab_target
	a.grab_target = null
	if t != null and t.grabbed_by == a:
		t.grabbed_by = null
		t.kx = a.face * 5
		if t.ground != null:
			t.set_state("lag", 12)
		else:
			t.set_state("air")
	if not quiet:
		a.kx = -a.face * 3
		a.set_state("lag", 14)


func throw_release(a: Fighter, params: Dictionary, dirsign: int) -> void:
	var t := a.grab_target
	if t == null:
		return
	a.grab_target = null
	t.grabbed_by = null
	t.inv = 0
	t.set_state("air")
	var h := {"dmg": params.dmg, "ang": params.ang, "bkb": params.bkb, "kbg": params.kbg, "fx": "big"}
	apply_hit(a, t, h, dirsign)
	a.hitlag = 0


func pummel(a: Fighter, t: Fighter) -> void:
	var d := 1.6
	t.damage = min(999.0, t.damage + d)
	a.dmg_dealt += d
	a.meter = min(100.0, a.meter + d)
	t.hitlag = 6
	t.shake = 6
	t.dmg_flash = 6
	event("hit", t.x, t.y - t.h / 2, {"dmg": d, "kb": 0.0, "who": t, "by": a, "fx": "small"})


func shield_break(f: Fighter) -> void:
	f.set_state("dizzy", 220)
	f.vy = -11
	f.ground = null
	f.shield_hp = C.SHIELD_MAX * 0.4
	event("shieldbreak", f.x, f.y - f.h / 2, {"who": f})


# ------------------------------------------------------------ 覚醒（切りふだ）
func start_awaken(f: Fighter) -> void:
	f.meter = 0
	f.set_state("awaken", 0)
	f.vx = 0; f.vy = 0; f.kx = 0; f.ky = 0
	cinema = [f, 70]
	event("awaken", f.x, f.y - f.h / 2, {"who": f})


func awaken_blast(f: Fighter) -> void:
	event("awaken_blast", f.x, f.y - f.h / 2, {"who": f})
	for t in opponents(f):
		if not t.alive() or t.state == "respawn":
			continue
		if abs(t.x - f.x) < 720 and abs(t.y - f.y) < 520:
			if t.state == "shield":
				t.set_state("stand")
			t.inv = 0
			if t.state == "move" and t.move.d.inv != null:
				t.to_neutral()
			var h := {"dmg": snapped(26.0 * f.ch.power, 0.1), "ang": 50.0, "bkb": 95.0, "kbg": 92.0, "fx": "big"}
			apply_hit(f, t, h, Fighter.sgn(t.x - f.x) if t.x != f.x else f.face)
	f.awakened = 600
	f.hitlag = 0


# ------------------------------------------------------------ 飛び道具
func update_projs() -> void:
	var m := stage.main
	for p in projs:
		p.t += 1
		p.life -= 1
		p.vy += p.grav
		var oy: float = p.y
		p.x += p.vx
		p.y += p.vy
		if p.grav > 0:
			for g in stage.surfaces():
				if p.vy > 0 and oy + p.r <= g.y + 1 and g.y + 1 <= p.y + p.r + 1 and p.x >= g.x1 and p.x <= g.x2:
					p.y = g.y - p.r
					if p.bounce > 0:
						p.vy = -6
						p.bounce -= 1
					else:
						p.dead = true
					break
		for s in m.solids:
			if p.x > s[0] and p.x < s[2] and p.y > s[1] and p.y < s[3]:
				p.dead = true
		if p.life <= 0 or p.x < stage.blast[0] or p.x > stage.blast[1] or p.y < stage.blast[2] or p.y > stage.blast[3]:
			p.dead = true
		if p.dead:
			continue
		for t in fighters:
			if t == p.owner or not t.alive() or t.team == p.owner.team or p.hit.has(t.idx) or t.state == "respawn":
				continue
			if not circle_rect(p.x, p.y, p.r, hurtbox(t)) or t.invincible():
				continue
			var h := {"dmg": p.dmg, "ang": p.ang, "bkb": p.bkb, "kbg": p.kbg, "fx": p.kind}
			var dsg := Fighter.sgn(p.vx)
			if dsg == 0:
				dsg = 1 if t.x >= p.x else -1
			apply_hit(p.owner, t, h, dsg, null, p)
			p.hit[t.idx] = true
			p.dead = true
			break
	projs = projs.filter(func(p): return not p.dead)


# ------------------------------------------------------------ 撃墜・勝敗
func check_blast() -> void:
	var b := stage.blast
	for f in fighters:
		if not f.alive() or f.state == "respawn":
			continue
		if f.x < b[0] or f.x > b[1] or f.y < b[2] or f.y > b[3]:
			ko(f)


func ko(f: Fighter) -> void:
	var b := stage.blast
	event("ko", clamp(f.x, b[0], b[1]), clamp(f.y - f.h / 2, b[2], b[3]), {"who": f})
	if f.grab_target != null:
		grab_release(f, true)
	if f.grabbed_by != null:
		f.grabbed_by.grab_target = null
		f.grabbed_by.to_neutral()
		f.grabbed_by = null
	if f.ledge != null:
		f.leave_ledge()
	var killer := f.last_hit_by
	if killer != null and frame - f.last_hit_frame < 600 and killer != f:
		killer.kos += 1
	f.falls += 1
	f.stocks -= 1
	f.set_state("dead", C.RESPAWN_WAIT)
	f.kx = 0; f.ky = 0; f.vx = 0; f.vy = 0
	f.ground = null
	if stocks > 0 and f.stocks <= 0:
		f.out = true
		var remain := 0
		for o in fighters:
			if not o.out:
				remain += 1
		f.place = remain + 1


func respawn(f: Fighter) -> void:
	f.damage = 0.0
	f.x = 0.0
	f.y = -330.0
	f.vx = 0; f.vy = 0; f.kx = 0; f.ky = 0
	f.ground = null
	f.jumps = f.st.jumps
	f.used_up = false; f.used_side = false; f.used_dodge = false
	f.shield_hp = C.SHIELD_MAX
	f.last_hit_by = null
	f.set_state("respawn", 0)
	f.inv = 0
	event("respawn", f.x, f.y, {"who": f})


func check_end() -> void:
	if ending > 0:
		ending -= 1
		if ending == 0:
			over = true
		return
	var teams := {}
	for f in fighters:
		if not f.out:
			teams[f.team] = true
	if teams.size() <= 1:
		for f in fighters:
			if not f.out:
				f.place = 1
		for f in fighters:
			if winner == null or f.place < winner.place:
				winner = f
		ending = 100
		event("game", 0, 0)
