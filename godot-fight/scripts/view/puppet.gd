## 仮の3D人形。VRoid モデルが無いキャラはこれで表示する。
## 関節の位置は 2D 版の手続きアニメ（render.py の compute_pose）を移植して計算し、カプセルと球でつなぐ。
class_name Puppet
extends Node3D

const K := 0.02   # ピクセル → メートル

var f: Fighter
var parts := {}
var mats := {}
var shield_mesh: MeshInstance3D
var aura_mesh: MeshInstance3D


func setup(fighter: Fighter) -> void:
	f = fighter
	var cols: Dictionary = f.ch.colors
	mats.body = _mat(cols.body)
	mats.dark = _mat(cols.body.darkened(0.3))
	mats.accent = _mat(cols.accent)
	mats.skin = _mat(cols.skin)
	mats.hair = _mat(cols.hair)
	mats.eye = _mat(Color(0.08, 0.06, 0.1))
	mats.white = _mat(Color.WHITE)
	for n in ["torso", "arm_f1", "arm_f2", "arm_b1", "arm_b2", "leg_f1", "leg_f2", "leg_b1", "leg_b2"]:
		var mi := MeshInstance3D.new()
		var cm := CapsuleMesh.new()
		cm.radial_segments = 12
		cm.rings = 4
		mi.mesh = cm
		add_child(mi)
		parts[n] = mi
	for n in ["hand_f", "hand_b", "foot_f", "foot_b", "head", "hair", "eye_l", "eye_r", "belt"]:
		var mi := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radial_segments = 16
		sm.rings = 8
		mi.mesh = sm
		add_child(mi)
		parts[n] = mi
	_set_mat(["torso", "arm_f1", "arm_b1", "leg_f1", "leg_f2"], mats.body)
	_set_mat(["arm_b2", "leg_b1", "leg_b2"], mats.dark)
	_set_mat(["arm_f2"], mats.body)
	_set_mat(["hand_f", "hand_b", "head"], mats.skin)
	_set_mat(["foot_f", "foot_b", "belt"], mats.accent)
	_set_mat(["hair"], mats.hair)
	_set_mat(["eye_l", "eye_r"], mats.eye)
	shield_mesh = MeshInstance3D.new()
	var s := SphereMesh.new()
	shield_mesh.mesh = s
	var sm := StandardMaterial3D.new()
	sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm.albedo_color = Color(f.color.r, f.color.g, f.color.b, 0.35)
	sm.emission_enabled = true
	sm.emission = f.color
	sm.emission_energy_multiplier = 0.6
	sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	shield_mesh.material_override = sm
	add_child(shield_mesh)
	aura_mesh = MeshInstance3D.new()
	aura_mesh.mesh = SphereMesh.new()
	var am := sm.duplicate()
	am.albedo_color = Color(cols.accent.r, cols.accent.g, cols.accent.b, 0.25)
	am.emission = cols.accent
	aura_mesh.material_override = am
	add_child(aura_mesh)


func _mat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = 0.6
	m.rim_enabled = true
	m.rim = 0.4
	return m


func _set_mat(names: Array, m: Material) -> void:
	for n in names:
		parts[n].material_override = m


# ------------------------------------------------------------ ポーズ（2D版の移植）
func compute_pose() -> Dictionary:
	var p := {"hf": Vector2(12, -30), "hb": Vector2(-10, -30), "ff": Vector2(9, 0), "fb": Vector2(-9, 0),
		"lean": 0.0, "drop": 0.0, "rot": 0.0, "pivot": Vector2.ZERO, "flash": false, "fade": false}
	var t := f.anim
	var s := f.state
	var hh := f.h
	match s:
		"stand", "respawn", "dizzy":
			var sp: float = abs(f.vx)
			if f.crouch:
				p.drop = 16.0
				p.ff = Vector2(13, 0); p.fb = Vector2(-11, 0)
				p.hf = Vector2(16, -22); p.hb = Vector2(-6, -20)
			elif sp > 0.6 and s == "stand":
				var ph := t * (0.16 + sp * 0.028)
				var amp: float = min(1.0, sp / 7.0)
				p.ff = Vector2(sin(ph) * 17 * amp, -max(0.0, cos(ph)) * 10 * amp)
				p.fb = Vector2(-sin(ph) * 17 * amp, -max(0.0, -cos(ph)) * 10 * amp)
				p.hf = Vector2(-sin(ph) * 14 * amp + 6, -30)
				p.hb = Vector2(sin(ph) * 14 * amp - 4, -30)
				p.lean = 5 * amp
				p.drop = abs(sin(ph)) * 2 * amp
			else:
				var b := sin(t * 0.08) * 1.4
				p.drop = b + 1
				p.hf = Vector2(13, -29 + b); p.hb = Vector2(-10, -30 + b)
			if s == "dizzy":
				p.lean = sin(t * 0.1) * 6
		"jumpsquat", "lag":
			p.drop = 12.0
			p.ff = Vector2(12, 0); p.fb = Vector2(-10, 0)
			p.hf = Vector2(14, -24); p.hb = Vector2(-12, -24)
		"air", "helpless", "walltech":
			if f.vy < 0:
				p.ff = Vector2(8, -14); p.fb = Vector2(-7, -6)
				p.hf = Vector2(12, -52); p.hb = Vector2(-12, -46)
			else:
				p.ff = Vector2(7, -2); p.fb = Vector2(-9, -8)
				p.hf = Vector2(17, -56); p.hb = Vector2(-15, -54)
			p.fade = s == "helpless"
		"shield":
			p.drop = 8.0
			p.ff = Vector2(12, 0); p.fb = Vector2(-10, 0)
			p.hf = Vector2(16, -42); p.hb = Vector2(10, -36)
		"dodge":
			var d: Dictionary = f.dodge if f.dodge != null else {"kind": "spot", "total": 30, "inv": [0, 0], "dir": 0}
			var tt: float = float(f.timer) / max(1, d.total)
			if d.kind == "roll":
				p.rot = tt * TAU * d.dir * f.face
				p.pivot = Vector2(0, -hh * 0.45)
				p.drop = 18.0
				p.ff = Vector2(8, -12); p.fb = Vector2(-6, -10)
				p.hf = Vector2(8, -36); p.hb = Vector2(-6, -36)
			elif d.kind == "tech":
				p.drop = 12.0
				p.hf = Vector2(14, -24); p.hb = Vector2(-12, -24)
			else:
				p.ff = Vector2(6, -4); p.fb = Vector2(-8, -2)
			p.fade = d.inv[0] <= f.timer and f.timer <= d.inv[1]
		"hitstun":
			if f.tumble:
				p.rot = t * 0.35 * (-1 if f.kx > 0 else 1)
				p.pivot = Vector2(0, -hh * 0.5)
				p.hf = Vector2(18, -58); p.hb = Vector2(-18, -56)
				p.ff = Vector2(12, -4); p.fb = Vector2(-12, -10)
			else:
				p.lean = -7.0
				p.hf = Vector2(-4, -48); p.hb = Vector2(-14, -44)
		"knockdown":
			p.rot = -PI / 2
			p.pivot = Vector2(0, -hh * 0.5)
			p.drop = -hh * 0.5 + 14
		"grabbed":
			p.hf = Vector2(10, -54 + sin(t * 0.5) * 6); p.hb = Vector2(-8, -52)
			p.ff = Vector2(6, -2 + abs(sin(t * 0.4)) * 4); p.fb = Vector2(-6, 0)
		"hold":
			p.hf = Vector2(26, -42); p.hb = Vector2(22, -38)
			p.lean = 4.0
		"ledge":
			p.hf = Vector2(f.hw + 2, -hh * 0.72 - 2); p.hb = Vector2(f.hw - 6, -hh * 0.72 - 4)
			p.ff = Vector2(6, 6); p.fb = Vector2(-4, 2)
		"climb":
			var k: float = min(1.0, f.timer / 22.0)
			p.drop = (1 - k) * hh * 0.7
			p.hf = Vector2(16, -40); p.hb = Vector2(10, -44)
			p.ff = Vector2(14 * k, -8); p.fb = Vector2(-4, 0)
		"awaken":
			p.hf = Vector2(16, -82); p.hb = Vector2(-16, -82)
			p.ff = Vector2(12, 0); p.fb = Vector2(-12, 0)
		"move":
			_move_pose(p)
	if f.dmg_flash > 6:
		p.flash = true
	return p


func _move_pose(p: Dictionary) -> void:
	var m := f.move
	var d := m.d
	var fr := m.f
	var s := 6
	var e := 14
	var h = null
	if not d.hits.is_empty():
		s = 999; e = 0
		for hh in d.hits:
			s = min(s, hh.f0); e = max(e, hh.f1)
		h = d.hits[0]
		for hh in d.hits:
			if hh.f0 <= fr and fr <= hh.f1:
				h = hh
	var k := 0.0
	if fr < s:
		k = -0.35 * fr / max(1, s)
	elif fr <= e:
		k = 1.0
	else:
		k = max(0.0, 1.0 - float(fr - e) / max(1.0, (d.total - e) * 0.6))
	if d.charge_at != null and fr == d.charge_at and m.charge > 0:
		k = -0.45
		p.flash = (f.anim / 4) % 2 == 0
	var name := d.pose
	if name == "spin" and fr >= s and fr <= e:
		p.rot = fr * 0.6 * f.face
		p.pivot = Vector2(0, -f.h * 0.5)
		p.hf = Vector2(22, -46); p.hb = Vector2(-22, -46)
		p.ff = Vector2(12, -10); p.fb = Vector2(-12, -10)
		return
	if name == "flipkick" and fr >= s and fr <= e:
		p.rot = -float(fr - s) / max(1, e - s + 1) * PI * 1.6 * f.face
		p.pivot = Vector2(0, -f.h * 0.5)
	match name:
		"uppercut":
			p.hf = Vector2(10, -60 - 46 * max(0.0, k)); p.hb = Vector2(-10, -34)
			p.ff = Vector2(6, -6); p.fb = Vector2(-6, 0)
			return
		"stomp":
			p.ff = Vector2(14, 2); p.fb = Vector2(-14, 2)
			p.hf = Vector2(18, -60); p.hb = Vector2(-18, -60)
			p.drop = 6 * max(0.0, k)
			return
		"cast":
			p.hf = Vector2(14 + 16 * max(0.0, k), -46); p.hb = Vector2(10 + 12 * max(0.0, k), -42)
			return
		"throwu":
			p.hf = Vector2(8, -86); p.hb = Vector2(-4, -86)
			return
		"throwd":
			p.hf = Vector2(24, -14); p.hb = Vector2(18, -12)
			p.drop = 10.0
			return
		"throwb":
			p.hf = Vector2(-24 * max(0.2, k), -48); p.hb = Vector2(-18, -44)
			p.lean = -6.0
			return
		"throwf":
			p.hf = Vector2(30 * max(0.3, k), -44); p.hb = Vector2(24, -40)
			p.lean = 6.0
			return
		"dash":
			p.lean = 10.0
			p.drop = 4.0
			p.ff = Vector2(16, -2); p.fb = Vector2(-14, -6)
	if h == null:
		return
	var tx: float = h.x
	var ty: float = h.y
	var limb: String = h.limb if h.limb != "" else ("foot" if ty > -34 else "hand")
	var kk: float = max(-0.4, k)
	if limb == "hand" or name == "grab":
		if tx >= 0:
			p.hf = Vector2(lerp(12.0, tx, kk) if kk > 0 else 12 + tx * kk, lerp(-30.0, ty, max(0.0, kk)))
		else:
			p.hb = Vector2(lerp(-10.0, tx, kk) if kk > 0 else -10 + tx * kk, lerp(-30.0, ty, max(0.0, kk)))
		if name == "grab":
			p.hb = p.hf + Vector2(-4, 4)
		if name == "bigpunch":
			p.lean = 8 * kk
	else:
		if tx >= 0:
			p.ff = Vector2(lerp(9.0, tx, kk) if kk > 0 else 9 + tx * kk, lerp(0.0, ty, max(0.0, kk)))
			p.lean = -6 * max(0.0, kk)
		else:
			p.fb = Vector2(lerp(-9.0, tx, kk) if kk > 0 else -9 + tx * kk, lerp(0.0, ty, max(0.0, kk)))
			p.lean = 6 * max(0.0, kk)
		if h.both and kk > 0:
			p.fb = Vector2(-p.ff.x, p.ff.y)


# ------------------------------------------------------------ 3Dに反映
func refresh() -> void:
	visible = f.alive() and not f.hidden
	if not visible:
		return
	var p := compute_pose()
	var sc := f.h / 84.0
	var shake := 0.0
	if f.shake > 0:
		shake = (1 if f.anim % 2 == 0 else -1) * min(6, f.shake)
	var rot: float = p.rot
	var pv: Vector2 = p.pivot
	var face := f.face

	# 足元基準のローカル座標(px) → ワールド(m)。z は手前(+)/奥(-)
	var P := func(l: Vector2, z: float) -> Vector3:
		var v := Vector2(l.x * sc, l.y * sc + p.drop * sc)
		if rot != 0.0:
			var pp := pv * sc
			v = pp + (v - pp).rotated(rot)
		return Vector3((f.x + v.x * face + shake) * K, -(f.y + v.y) * K, z)

	var shoulder := Vector2(p.lean, -46)
	var hip := Vector2(p.lean * 0.3, -26)
	var zn := 0.14 * sc
	_bone("torso", P.call(hip, 0.0), P.call(shoulder, 0.0), 0.2 * sc)
	_limb("arm_f1", "arm_f2", "hand_f", P.call(shoulder, zn), P.call(p.hf, zn), 24 * sc * K, 0.075 * sc, 1)
	_limb("arm_b1", "arm_b2", "hand_b", P.call(shoulder, -zn), P.call(p.hb, -zn), 24 * sc * K, 0.07 * sc, 1)
	_limb("leg_f1", "leg_f2", "foot_f", P.call(hip, zn * 0.6), P.call(p.ff, zn * 0.6), 28 * sc * K, 0.085 * sc, -1)
	_limb("leg_b1", "leg_b2", "foot_b", P.call(hip, -zn * 0.6), P.call(p.fb, -zn * 0.6), 28 * sc * K, 0.08 * sc, -1)
	var head: Vector3 = P.call(shoulder + Vector2(1, -18), 0.0)
	_ball("head", head, 0.36 * sc)
	_ball("hair", head + Vector3(-0.05 * face * sc, 0.09 * sc, -0.03), 0.34 * sc)
	_ball("belt", P.call(hip + Vector2(0, -1), 0.0), 0.2 * sc, Vector3(1.05, 0.35, 1.0))
	var ex := 0.12 * face * sc
	_ball("eye_l", head + Vector3(ex, 0.02 * sc, 0.13 * sc), 0.06 * sc, Vector3(0.7, 1.3, 0.7))
	_ball("eye_r", head + Vector3(ex * 0.4, 0.02 * sc, 0.17 * sc), 0.06 * sc, Vector3(0.7, 1.3, 0.7))
	parts.hand_f.scale = Vector3.ONE * 0.11 * sc
	parts.hand_b.scale = Vector3.ONE * 0.1 * sc
	parts.foot_f.scale = Vector3(0.16, 0.1, 0.12) * sc
	parts.foot_b.scale = Vector3(0.15, 0.1, 0.12) * sc

	var flash: bool = p.flash
	var alpha := 0.45 if p.fade else 1.0
	for n in parts:
		var mi: MeshInstance3D = parts[n]
		mi.transparency = 1.0 - alpha
		mi.material_overlay = _flash_mat() if flash else null

	shield_mesh.visible = f.state == "shield"
	if shield_mesh.visible:
		var r: float = (f.h * 0.62 * max(0.25, f.shield_hp / C.SHIELD_MAX) + 8) * K
		shield_mesh.position = Vector3(f.x * K, -(f.y - f.h * 0.5) * K, 0)
		shield_mesh.scale = Vector3.ONE * r * 2
	aura_mesh.visible = f.awakened > 0 or f.state == "awaken"
	if aura_mesh.visible:
		aura_mesh.position = Vector3(f.x * K, -(f.y - f.h * 0.5) * K, 0)
		aura_mesh.scale = Vector3.ONE * (f.h * 1.3 + sin(f.anim * 0.3) * 6) * K


var _fm: StandardMaterial3D


func _flash_mat() -> StandardMaterial3D:
	if _fm == null:
		_fm = StandardMaterial3D.new()
		_fm.albedo_color = Color(1, 1, 1, 0.7)
		_fm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_fm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return _fm


func _bone(n: String, a: Vector3, b: Vector3, radius: float) -> void:
	var mi: MeshInstance3D = parts[n]
	var cm: CapsuleMesh = mi.mesh
	var len := a.distance_to(b)
	cm.radius = radius
	cm.height = max(len + radius * 2, radius * 2.01)
	mi.position = (a + b) / 2
	var dirv := (b - a).normalized() if len > 0.0001 else Vector3.UP
	mi.basis = _basis_y(dirv)
	mi.scale = Vector3.ONE


func _limb(n1: String, n2: String, end: String, root: Vector3, target: Vector3, length: float, radius: float, bend: int) -> void:
	# 2関節の簡易IK（2D版の limb_points と同じ）
	var d := target - root
	var dist := d.length()
	if dist > length:
		target = root + d / dist * length
		dist = length
	var mid := (root + target) / 2
	var off := sqrt(max(0.0, (length / 2) * (length / 2) - (dist / 2) * (dist / 2))) * bend * f.face
	var n := Vector3(-d.y, d.x, 0).normalized() if dist > 0.0001 else Vector3.RIGHT
	var elbow := mid + n * off
	_bone(n1, root, elbow, radius)
	_bone(n2, elbow, target, radius * 0.92)
	parts[end].position = target


func _ball(n: String, pos: Vector3, size: float, stretch := Vector3.ONE) -> void:
	var mi: MeshInstance3D = parts[n]
	mi.position = pos
	mi.basis = Basis.IDENTITY
	mi.scale = stretch * size


static func _basis_y(dirv: Vector3) -> Basis:
	var y := dirv
	var x := Vector3(0, 0, 1).cross(y)
	if x.length() < 0.001:
		x = Vector3.RIGHT
	x = x.normalized()
	var z := x.cross(y).normalized()
	return Basis(x, y, z)
