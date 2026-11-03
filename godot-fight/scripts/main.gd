## 試作版のメイン: ステージ・カメラ・キャラ・エフェクト・HUD を組み立て、World を 60fps で進める。
extends Node3D

const K := 0.02

var world: World
var puppets: Array = []
var stage_key := "battlefield"
var cpu_level := 0         # 0 = 動かない（サンドバッグ）。F2 で 1〜9 に上げられる
var p2_human := false
var roster: Array = []
var p1_char := -1
var p2_char := 0
var p1_do := ""            # 確認用: --p1do=nspecial などで 1P がそのワザをくり返す
var paused := false

var cam: Camera3D
var cam_pos := Vector3(0, 2.5, 18)
var cam_look := Vector3(0, 1.5, 0)
var shake := 0.0
var stage_root: Node3D
var proj_nodes := {}
var fx: Array = []   # [node, life, max, vel, kind]

var hud: CanvasLayer
var panels: Array = []
var banner: Label
var banner_t := 0
var info: Label
var flash: ColorRect
var flash_t := 0
var font: SystemFont
var lit: Lighting
var sfx: Sfx
var quality := 2
var shadows := []
var demo := false          # --demo: 1P も CPU にする（確認用）
var shots: Array = []      # --shot=フレーム,フレーム,...: そのフレームでスクショを保存して終了
var shot_dir := "user://"
var frame_count := 0


func _ready() -> void:
	font = SystemFont.new()
	font.font_names = PackedStringArray(["Yu Gothic UI", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", "IPAGothic", "IPAexGothic", "sans-serif"])
	for a in OS.get_cmdline_user_args():
		if a == "--demo":
			demo = true
		elif a.begins_with("--shot="):
			for v in a.substr(7).split(","):
				shots.append(int(v))
		elif a.begins_with("--shotdir="):
			shot_dir = a.substr(10)
		elif a.begins_with("--stage="):
			stage_key = a.substr(8)
		elif a.begins_with("--p1do="):
			p1_do = a.substr(7)
		elif a.begins_with("--p1="):
			p1_char = int(a.substr(5))
		elif a.begins_with("--p2="):
			p2_char = int(a.substr(5))
	if not shots.is_empty():
		Engine.max_physics_steps_per_frame = 1   # スクショ時は描画が遅くても 1 描画 = 1 フレームにそろえる
	sfx = Sfx.new()
	add_child(sfx)
	_build_env()
	_build_hud()
	start_match()


# ------------------------------------------------------------ 試合の開始
func start_match() -> void:
	if stage_root != null:
		stage_root.queue_free()
	for p in puppets:
		p.queue_free()
	puppets.clear()
	for k in proj_nodes:
		proj_nodes[k].queue_free()
	proj_nodes.clear()
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	roster = Chars.all()
	if p1_char < 0:
		p1_char = 1 if roster.size() > 1 else 0   # モデルがあれば1Pはモデルキャラ
	p1_char %= roster.size()
	p2_char %= roster.size()
	var a: Dictionary = roster[p1_char].duplicate(true)
	var b: Dictionary = roster[p2_char].duplicate(true)
	if not b.has("model"):
		b.colors = {"body": Color(0.2, 0.42, 0.85), "accent": Color(0.55, 0.9, 1.0), "skin": Color(1.0, 0.86, 0.76), "hair": Color(0.12, 0.2, 0.45)}
	var c2 = HumanController.new(1) if p2_human else CpuController.new(cpu_level, rng)
	var c1 = CpuController.new(7, rng) if demo else HumanController.new(0)
	if p1_do != "":
		c1 = CpuController.new(0, rng)
		var dir: Dictionary = {"nspecial": {}, "sspecial": {"x": 1.0}, "uspecial": {"y": -1.0}, "dspecial": {"y": 1.0}}.get(p1_do, {})
		var st: Dictionary = dir.duplicate()
		st.special = true
		c1.loop_seq = [CpuController.S(st)] + range(6).map(func(_i): return CpuController.S(dir)) + range(90).map(func(_i): return CpuController.S({}))
	if demo:
		c2 = CpuController.new(7, rng)
	world = World.new(stage_key, [[a, c1, demo], [b, c2, demo or not p2_human]], 3, rng.randi(), true)
	_build_stage()
	for f in world.fighters:
		var pp: Puppet
		if f.ch.has("mugen"):
			pp = SpriteView.new()
		elif f.ch.has("model"):
			pp = ModelView.new()
		else:
			pp = Puppet.new()
		add_child(pp)
		pp.setup(f)
		puppets.append(pp)
	_update_info()


func _physics_process(_delta: float) -> void:
	if paused or world == null:
		return
	if world.over:
		return
	world.step()
	_handle_events(world.events)
	world.events.clear()


func _process(delta: float) -> void:
	if world == null:
		return
	for p in puppets:
		p.refresh()
	_update_projs()
	_update_fx()
	lit.step()
	_update_shadows()
	_update_camera(delta)
	_update_hud()
	frame_count += 1
	if frame_count in shots:
		var img := get_viewport().get_texture().get_image()
		img.save_png("%s/shot_%04d.png" % [shot_dir, frame_count])
		if frame_count == shots.max():
			get_tree().quit()


func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and not e.echo:
		match e.physical_keycode:
			KEY_ESCAPE:
				paused = not paused
				_show_banner("PAUSE" if paused else "", 99999 if paused else 0)
			KEY_ENTER, KEY_KP_ENTER:
				if world.over or paused:
					paused = false
					_show_banner("", 0)
					start_match()
			KEY_TAB:
				stage_key = "final" if stage_key == "battlefield" else "battlefield"
				start_match()
			KEY_F2:
				cpu_level = (cpu_level + 1) % 10
				start_match()
			KEY_F3:
				p2_human = not p2_human
				start_match()
			KEY_F4:
				p1_char += 1
				start_match()
			KEY_F6:
				quality = (quality + 2) % 3
				lit.set_quality(quality)
				_update_info()
			KEY_F5:
				p2_char += 1
				start_match()
			KEY_F11:
				var full := DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN
				DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if full else DisplayServer.WINDOW_MODE_FULLSCREEN)
	elif e is InputEventJoypadButton and e.pressed and e.button_index == JOY_BUTTON_START:
		if world.over:
			start_match()
		else:
			paused = not paused
			_show_banner("PAUSE" if paused else "", 99999 if paused else 0)


# ------------------------------------------------------------ 背景・ライト
func _build_env() -> void:
	cam = Camera3D.new()
	cam.fov = 30
	cam.near = 0.5
	cam.far = 800
	add_child(cam)
	cam.position = cam_pos
	lit = Lighting.new()
	add_child(lit)
	lit.build(cam, quality)


func _stone_mat(c: Color, rough_var := 0.1) -> StandardMaterial3D:
	## ノイズで色むらと凹凸をつけた石の材質
	var m := StandardMaterial3D.new()
	var nz := FastNoiseLite.new()
	nz.frequency = 0.04
	nz.fractal_octaves = 4
	var alb := NoiseTexture2D.new()
	alb.noise = nz
	alb.seamless = true
	alb.width = 256
	alb.height = 256
	var grad := Gradient.new()
	grad.set_color(0, c.darkened(0.25))
	grad.set_color(1, c.lightened(0.18 + rough_var))
	alb.color_ramp = grad
	m.albedo_texture = alb
	var nrm := NoiseTexture2D.new()
	nrm.noise = nz
	nrm.seamless = true
	nrm.as_normal_map = true
	nrm.bump_strength = 6.0
	nrm.width = 256
	nrm.height = 256
	m.normal_enabled = true
	m.normal_texture = nrm
	m.normal_scale = 0.8
	m.uv1_triplanar = true
	m.uv1_scale = Vector3(0.35, 0.35, 0.35)
	m.roughness = 0.88
	return m


func _polished_mat(c: Color) -> StandardMaterial3D:
	## ステージ上面: 磨いた石（映り込みが出る）
	var m := _stone_mat(c, 0.02)
	m.roughness = 0.22
	m.metallic = 0.15
	m.metallic_specular = 0.7
	m.normal_scale = 0.15
	m.uv1_scale = Vector3(0.18, 0.18, 0.18)
	return m


func _mat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = 0.85
	return m


func _unshaded(c: Color, energy := 1.0, alpha := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(c.r, c.g, c.b, alpha)
	if alpha < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.emission_enabled = true
	m.emission = c
	m.emission_energy_multiplier = energy
	return m


# ------------------------------------------------------------ ステージ
func _build_stage() -> void:
	## アニメ調の浮島ステージ: 芝の上面・白い石のふち・土の本体・光る結晶
	stage_root = Node3D.new()
	add_child(stage_root)
	if world.stage.shape == "blocks":
		_build_block_stage()
		return
	var m = world.stage.main
	var poly := PackedVector2Array()
	for p in m.outline:
		poly.append(Vector2(p.x * K, -p.y * K))
	var depth := 3.2
	var body := CSGPolygon3D.new()
	body.polygon = poly
	body.depth = depth
	body.position.z = depth / 2
	body.material = Toon.material(Color(0.74, 0.54, 0.4), null, false, false, Color(0.48, 0.38, 0.62))
	stage_root.add_child(body)
	var cx: float = (m.x1 + m.x2) / 2.0
	var w: float = (m.x2 - m.x1) / 2.0
	# 縁: 白い石の帯（輪郭線つき）
	var lip := MeshInstance3D.new()
	var lb := BoxMesh.new()
	lb.size = Vector3(w * 2 * K + 0.1, Stage.LIP * K, depth + 0.3)
	lip.mesh = lb
	lip.position = Vector3(cx * K, -Stage.LIP * K / 2, 0)
	lip.material_override = Toon.material(Color(0.96, 0.93, 0.86), null, false, true, Color(0.66, 0.66, 0.86))
	stage_root.add_child(lip)
	# 上面: 芝生
	var top := MeshInstance3D.new()
	var tb := BoxMesh.new()
	tb.size = Vector3(w * 2 * K - 0.1, 0.06, depth + 0.1)
	top.mesh = tb
	top.position = Vector3(cx * K, 0.0, 0)
	top.material_override = Toon.material(Color(0.42, 0.8, 0.38), null, false, false, Color(0.3, 0.55, 0.6))
	stage_root.add_child(top)
	# 本体の模様（地層の線）
	for k in range(1, 4):
		var dd: float = m.depth * k / 4.5
		var hw: float = Stage.half_width(world.stage.shape, w, m.depth, dd) * K
		var band := MeshInstance3D.new()
		var bb := BoxMesh.new()
		bb.size = Vector3(hw * 2 * 0.97, 0.06, 0.02)
		band.mesh = bb
		band.position = Vector3(cx * K, -dd * K, depth / 2 + 0.01)
		band.material_override = Toon.material(Color(0.6, 0.42, 0.33), null, false, false)
		stage_root.add_child(band)
	# 底の光る結晶
	var crystal_mat := _unshaded(Color(0.45, 0.95, 1.0), 2.5)
	for k in range(-2, 3):
		var cr := MeshInstance3D.new()
		var pm := PrismMesh.new()
		pm.size = Vector3(0.45, 1.5 - abs(k) * 0.3, 0.45)
		cr.mesh = pm
		cr.rotation_degrees = Vector3(180, 0, 0)
		var hw2 := Stage.half_width(world.stage.shape, w, m.depth, m.depth * 0.7) * K
		cr.position = Vector3(cx * K + k * hw2 * 0.35, -m.depth * K * (0.78 + abs(k) * 0.05) - 0.5, 0.9)
		cr.material_override = crystal_mat
		stage_root.add_child(cr)
	for p in world.stage.plats:
		var pm := MeshInstance3D.new()
		var bx := BoxMesh.new()
		bx.size = Vector3((p.x2 - p.x1) * K, 0.24, 2.6)
		pm.mesh = bx
		pm.position = Vector3((p.x1 + p.x2) / 2 * K, -p.y * K - 0.12, 0)
		pm.material_override = Toon.material(Color(0.96, 0.93, 0.86), null, false, true, Color(0.66, 0.66, 0.86))
		stage_root.add_child(pm)
		var grass := MeshInstance3D.new()
		var gb := BoxMesh.new()
		gb.size = Vector3((p.x2 - p.x1) * K - 0.08, 0.05, 2.5)
		grass.mesh = gb
		grass.position = pm.position + Vector3(0, 0.13, 0)
		grass.material_override = Toon.material(Color(0.42, 0.8, 0.38), null, false, false, Color(0.3, 0.55, 0.6))
		stage_root.add_child(grass)


# ------------------------------------------------------------ 素材（Quaternius Free Platformer Pack, CC0）で組むステージ
const ASSET_DIR := "res://assets/platformer/"
var _toon_cache := {}


func _prop(parent: Node3D, name: String, pos: Vector3, rot_y := 0.0, scl := 1.0, outline := false) -> Node3D:
	## 素材を置き、材質をアニメ調（セル画風）に差し替える。
	## ローポリ素材は面ごとに法線が割れているので、反転法の輪郭線は付けない（破片状のノイズになる）
	var ps: PackedScene = load(ASSET_DIR + name + ".fbx")
	if ps == null:
		return null
	var n: Node3D = ps.instantiate()
	n.position = pos
	n.rotation.y = rot_y
	n.scale = Vector3.ONE * scl
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		for si in range(mi.mesh.get_surface_count()):
			var src = mi.mesh.surface_get_material(si)
			var c: Color = src.albedo_color if src is BaseMaterial3D else Color(0.8, 0.8, 0.8)
			var key := c.to_html() + str(outline)
			if not _toon_cache.has(key):
				var shade := Color(c.r * 0.55 + 0.12, c.g * 0.5 + 0.1, c.b * 0.6 + 0.22)
				_toon_cache[key] = Toon.material(c.lightened(0.06), null, false, outline, shade)
			mi.set_surface_override_material(si, _toon_cache[key])
	parent.add_child(n)
	return n


func _block_island(parent: Node3D, rows: Array, origin: Vector3, scl := 1.0) -> void:
	## ブロックを段々に積んだ浮島。origin は上面の中心（ワールド座標）
	var t := 2.0 * scl
	for r in range(rows.size()):
		var n: int = rows[r]
		var kind := "Top" if r == 0 else ("Bottom" if r == rows.size() - 1 else "Center")
		for i in range(n):
			var side := "Left" if i == 0 else ("Right" if i == n - 1 else "Middle")
			var x := (i - (n - 1) / 2.0) * t
			_prop(parent, "Platform_%s%s" % [kind, side], origin + Vector3(x, -t * 0.5 - t * r, 0), 0.0, scl)


func _build_block_stage() -> void:
	var st := world.stage
	_block_island(stage_root, st.rows, Vector3.ZERO)
	var top_w: float = (st.main.x2 - st.main.x1) * K
	# すり抜け足場 = 黄色い足場
	for p in st.plats:
		var w: float = (p.x2 - p.x1) * K
		var name := "MovingPlatform" if w < 5.0 else "MovingPlatform_Long"
		var pf := _prop(stage_root, name, Vector3((p.x1 + p.x2) / 2 * K, -p.y * K - 0.3, 0), 0.0, 1.0)
		if pf != null:
			pf.scale = Vector3(w / (4.27 if w < 5.0 else 7.29), 0.45, 0.6)
	# 上面の奥に飾り（戦う面より奥に置いて邪魔にしない）
	var hw := top_w / 2
	_prop(stage_root, "Tree1", Vector3(-hw + 1.4, 0.0, -1.1), 0.3, 0.75)
	_prop(stage_root, "Tree4", Vector3(hw - 1.6, 0.0, -1.2), -0.4, 0.7)
	_prop(stage_root, "Rock1", Vector3(-hw + 3.2, 0.0, -1.3), 0.5, 0.8)
	_prop(stage_root, "Rock4", Vector3(hw - 3.4, 0.0, -1.35), 1.2, 0.8)
	_prop(stage_root, "Mushroom", Vector3(-1.2, 0.0, -1.45), 0.0, 0.7)
	_prop(stage_root, "Sign_Right", Vector3(hw - 0.9, 0.0, 1.25), -0.2, 0.55)
	_prop(stage_root, "Sign_Left", Vector3(-hw + 0.9, 0.0, 1.25), 0.2, 0.55)
	var rng := RandomNumberGenerator.new()
	rng.seed = 3
	for i in range(16):
		var gx := rng.randf_range(-hw + 0.5, hw - 0.5)
		var gz := rng.randf_range(-1.5, -0.6) if i % 2 == 0 else rng.randf_range(0.9, 1.5)
		_prop(stage_root, ["Grass", "Grass1", "Grass2"][i % 3], Vector3(gx, 0.0, gz), rng.randf() * TAU, 0.9, false)
	# 背景: 遠くの浮島と雲
	var bg := Node3D.new()
	stage_root.add_child(bg)
	var isles := [[Vector3(-34, -2, -42), [5, 3], 1.4], [Vector3(30, 4, -50), [4, 2], 1.5], [Vector3(4, 12, -70), [3, 1], 1.6],
		[Vector3(-60, 10, -80), [4, 2], 1.8], [Vector3(62, -6, -75), [6, 4, 2], 1.6]]
	for isl in isles:
		var o: Vector3 = isl[0]
		var sc: float = isl[2]
		_block_island(bg, isl[1], o, sc)
		_prop(bg, ["Tree1", "Tree2", "Tree4"][int(abs(o.x)) % 3], o + Vector3(-1.5 * sc, 0, -0.5), 0.0, sc * 0.9)
	for i in range(14):
		var cpos := Vector3(rng.randf_range(-90, 90), rng.randf_range(-16, 26), rng.randf_range(-110, -30))
		_prop(bg, "Cloud%d" % (i % 5 + 1), cpos, rng.randf_range(-0.3, 0.3), rng.randf_range(2.0, 4.0), false)


# ------------------------------------------------------------ カメラ
func _update_camera(delta: float) -> void:
	var xs := []
	var ys := []
	var target_dist := 0.0
	if world.cinema != null:
		var cf: Fighter = world.cinema[0]
		cam_look = cam_look.lerp(Vector3(cf.x * K, -(cf.y - cf.h / 2) * K, 0), 0.1)
		target_dist = 7.0
	else:
		for f in world.fighters:
			if f.alive():
				xs.append(f.x)
				ys.append(f.y - f.h / 2)
		if xs.is_empty():
			xs = [0.0]
			ys = [-100.0]
		xs.append(world.stage.main.x1 * 0.4)
		xs.append(world.stage.main.x2 * 0.4)
		ys.append(-60.0)
		var b: Array = world.stage.blast
		var minx: float = max(xs.min(), b[0] + 200)
		var maxx: float = min(xs.max(), b[1] - 200)
		var miny: float = max(ys.min(), b[2] + 200)
		var maxy: float = min(ys.max(), b[3] - 100)
		var bw: float = max(maxx - minx + 420, 660) * K
		var bh: float = max(maxy - miny + 340, 400) * K
		var tanv := tan(deg_to_rad(cam.fov / 2))
		var aspect := get_viewport().get_visible_rect().size.aspect()
		target_dist = clamp(max(bh / (2 * tanv), bw / (2 * tanv * aspect)), 9.0, 34.0)
		var c := Vector3((minx + maxx) / 2 * K, -((miny + maxy) / 2) * K - 0.6, 0)
		cam_look = cam_look.lerp(c, 0.08)
	var want := cam_look + Vector3(0, target_dist * 0.07, target_dist)
	cam_pos = cam_pos.lerp(want, 0.08)
	var off := Vector3.ZERO
	if shake > 0.02:
		off = Vector3(randf_range(-1, 1), randf_range(-1, 1), 0) * shake * 0.03
		shake *= 0.86
	cam.position = cam_pos + off
	cam.look_at(cam_look + off, Vector3.UP)


# ------------------------------------------------------------ 足元の丸い影（空中でも位置がわかるように）
func _update_shadows() -> void:
	while shadows.size() < world.fighters.size():
		var mi := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2(1.1, 0.55)
		q.orientation = PlaneMesh.FACE_Y
		mi.mesh = q
		var g := Gradient.new()
		g.set_color(0, Color(0, 0, 0, 0.55))
		g.set_color(1, Color(0, 0, 0, 0))
		var gt := GradientTexture2D.new()
		gt.gradient = g
		gt.fill = GradientTexture2D.FILL_RADIAL
		gt.fill_from = Vector2(0.5, 0.5)
		gt.fill_to = Vector2(1.0, 0.5)
		var m := StandardMaterial3D.new()
		m.albedo_texture = gt
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		shadows.append(mi)
	for i in range(world.fighters.size()):
		var f: Fighter = world.fighters[i]
		var mi: MeshInstance3D = shadows[i]
		var gy = null
		for g in world.stage.surfaces():
			if f.x >= g.x1 and f.x <= g.x2 and g.y >= f.y - 1 and (gy == null or g.y < gy):
				gy = g.y
		mi.visible = f.alive() and gy != null and f.state != "ledge"
		if mi.visible:
			var hgt: float = (gy - f.y) * K
			var s: float = clamp(1.0 - hgt / 8.0, 0.25, 1.0)
			mi.position = Vector3(f.x * K, -gy * K + 0.012, 0.0)
			mi.scale = Vector3(s, 1, s)


# ------------------------------------------------------------ 飛び道具・エフェクト
func _update_projs() -> void:
	var alive := {}
	for p in world.projs:
		alive[p] = true
		if not proj_nodes.has(p):
			proj_nodes[p] = _make_proj_node(p)
		var n: Node3D = proj_nodes[p]
		n.position = Vector3(p.x * K, -p.y * K, 0)
		match p.kind:
			"spear":
				n.rotation.z = atan2(-p.vy, p.vx)
				n.scale = Vector3.ONE
			"slash":
				n.rotation.z = 0.0 if p.vx > 0 else PI
				n.scale = Vector3(1.0, 1.0 + 0.1 * sin(world.frame * 0.9), 1.0) * p.r * 2 * K
			"wave":
				n.scale = Vector3(1.4, 0.8 + 0.2 * sin(world.frame * 0.7), 1.0) * p.r * 2 * K
			_:
				n.rotation.z += 0.2
				n.scale = Vector3.ONE * p.r * 2 * K * (1.0 + 0.12 * sin(world.frame * 0.8))
	for p in proj_nodes.keys():
		if not alive.has(p):
			proj_nodes[p].queue_free()
			proj_nodes.erase(p)


func _make_proj_node(p) -> Node3D:
	var c: Color = p.color
	var mi := MeshInstance3D.new()
	match p.kind:
		"spear":
			# 投げた槍: 細長い柄と穂先
			var root := Node3D.new()
			var shaft := MeshInstance3D.new()
			var b := BoxMesh.new()
			b.size = Vector3(1.6, 0.06, 0.06)
			shaft.mesh = b
			shaft.material_override = Toon.material(Color(0.55, 0.38, 0.22), null, false, false)
			root.add_child(shaft)
			var tip := MeshInstance3D.new()
			var pm := PrismMesh.new()
			pm.size = Vector3(0.2, 0.36, 0.08)
			tip.mesh = pm
			tip.rotation_degrees = Vector3(0, 0, -90)
			tip.position = Vector3(0.95, 0, 0)
			tip.material_override = _unshaded(c, 3.0)
			root.add_child(tip)
			add_child(root)
			return root
		"slash":
			# 三日月形の斬撃（平たい半透明の輪）
			var tm := TorusMesh.new()
			tm.inner_radius = 0.38
			tm.outer_radius = 0.5
			tm.rings = 24
			mi.mesh = tm
			mi.rotation_degrees = Vector3(90, 0, 0)
			mi.material_override = _unshaded(c, 4.0, 0.85)
			var holder := Node3D.new()
			holder.add_child(mi)
			add_child(holder)
			return holder
		"snow":
			mi.mesh = SphereMesh.new()
			mi.material_override = Toon.material(c, null, false, true, Color(0.7, 0.8, 1.0))
		"wave":
			mi.mesh = SphereMesh.new()
			mi.material_override = _unshaded(c, 2.5, 0.8)
		_:
			mi.mesh = SphereMesh.new()
			mi.material_override = _unshaded(c, 6.0)
	var pl := OmniLight3D.new()
	pl.light_color = c
	pl.light_energy = 2.0
	pl.omni_range = 3.0
	mi.add_child(pl)
	add_child(mi)
	return mi


func _spawn_fx(kind: String, pos: Vector3, color: Color, size: float, life: int, vel := Vector3.ZERO) -> void:
	var mi := MeshInstance3D.new()
	match kind:
		"ring":
			var tm := TorusMesh.new()
			tm.inner_radius = 0.42
			tm.outer_radius = 0.5
			mi.mesh = tm
			mi.rotation_degrees = Vector3(90, 0, 0)
		"beam":
			mi.mesh = BoxMesh.new()
		_:
			mi.mesh = SphereMesh.new()
	mi.material_override = _unshaded(color, 3.0, 0.9)
	mi.position = pos
	mi.scale = Vector3.ONE * size
	add_child(mi)
	fx.append([mi, life, life, vel, kind, size])


func _update_fx() -> void:
	var keep := []
	for e in fx:
		var mi: MeshInstance3D = e[0]
		e[1] -= 1
		var k: float = float(e[1]) / e[2]
		match e[4]:
			"spark":
				mi.position += e[3]
				e[3] *= 0.86
				mi.scale = Vector3.ONE * e[5] * k
			"ring":
				var s: float = e[5] * (1.6 - k)
				mi.scale = Vector3(s, s, s)
			"flash":
				mi.scale = Vector3.ONE * e[5] * (0.6 + (1 - k) * 0.8)
			"puff":
				mi.position += e[3]
				mi.scale = Vector3.ONE * e[5] * (1.4 - k * 0.4)
			"beam":
				pass
		var mat: StandardMaterial3D = mi.material_override
		mat.albedo_color.a = k * 0.9
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		if e[1] > 0:
			keep.append(e)
		else:
			mi.queue_free()
	fx = keep


func _wpos(x: float, y: float) -> Vector3:
	return Vector3(x * K, -y * K, 0.3)


func _handle_events(events: Array) -> void:
	for e in events:
		sfx.on_event(e)
		for pp in puppets:
			if pp is SpriteView:
				pp.on_event(e)
		var pos := _wpos(e.x, e.y)
		match e.kind:
			"hit":
				var dmg: float = e.dmg
				var by: Fighter = e.by
				var col: Color = by.ch.colors.accent if by != null else Color.WHITE
				for i in range(6 + int(dmg)):
					var a := randf() * TAU
					var sp := randf_range(0.05, 0.12 + dmg * 0.01)
					_spawn_fx("spark", pos, col.lightened(0.3), 0.12 + dmg * 0.006, 14, Vector3(cos(a), sin(a), randf_range(-0.3, 0.3)) * sp)
				_spawn_fx("flash", pos, Color.WHITE, 0.4 + dmg * 0.04, 8)
				lit.flash(pos + Vector3(0, 0, 0.8), col.lightened(0.4), 1.5 + dmg * 0.35, 2.5 + dmg * 0.12, 10)
				_spawn_fx("ring", pos, col.lightened(0.5), 0.6 + dmg * 0.05, 14)
				shake = max(shake, min(22.0, dmg * 0.7 + e.kb * 0.06))
				if e.kb > 150:
					_flash(Color(1, 1, 1, 0.5), 6)
			"block", "tech", "counter":
				_spawn_fx("ring", pos, Color(0.7, 0.9, 1.0), 1.0, 14)
			"jump", "land", "djump":
				for i in [-1, 1]:
					_spawn_fx("puff", pos + Vector3(i * 0.15, 0.05, 0), Color(0.92, 0.92, 0.95), 0.25, 18, Vector3(i * 0.02, 0.005, 0))
			"ko":
				var b: Array = world.stage.blast
				var dir := Vector3.ZERO
				if e.x <= b[0] + 1: dir = Vector3.RIGHT
				elif e.x >= b[1] - 1: dir = Vector3.LEFT
				elif e.y <= b[2] + 1: dir = Vector3.DOWN
				else: dir = Vector3.UP
				var who: Fighter = e.who
				for i in range(10):
					_spawn_fx("spark", pos + dir * i * 1.2, who.color.lightened(0.3), 2.2 - i * 0.15, 50, dir * 0.05)
				shake = 26.0
				_flash(Color(who.color.r, who.color.g, who.color.b, 0.45), 8)
				lit.flash(pos + dir * 3.0, who.color.lightened(0.3), 12.0, 25.0, 50)
			"shieldbreak":
				_show_banner("SHIELD BREAK!", 60)
			"awaken":
				var who: Fighter = e.who
				_flash(Color(1, 0.8, 0.4, 0.5), 10)
				lit.flash(pos + Vector3(0, 0, 1.2), Color(1.0, 0.7, 0.4), 6.0, 8.0, 70)
				_show_banner("覚醒  " + who.ch.awaken, 70)
			"awaken_blast":
				_flash(Color(1, 1, 1, 0.8), 18)
				shake = 30.0
				lit.flash(pos + Vector3(0, 0, 1.5), Color(1.0, 0.65, 0.35), 18.0, 22.0, 45)
				for r in range(3):
					_spawn_fx("ring", pos, Color(1.0, 0.6, 0.3), 10.0 + r * 4, 30 + r * 8)
			"go":
				_show_banner("GO!", 50)
			"count":
				_show_banner(str(e.n), 45)
			"game":
				_show_banner("GAME!", 99999)


# ------------------------------------------------------------ HUD
func _build_hud() -> void:
	hud = CanvasLayer.new()
	add_child(hud)
	var theme := Theme.new()
	theme.default_font = font
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = theme
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(root)
	flash = ColorRect.new()
	flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	flash.color = Color(1, 1, 1, 0)
	flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(flash)
	banner = Label.new()
	banner.set_anchors_preset(Control.PRESET_CENTER)
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.add_theme_font_size_override("font_size", 110)
	banner.add_theme_color_override("font_color", Color(1.0, 0.9, 0.35))
	banner.add_theme_color_override("font_outline_color", Color(0.15, 0.05, 0.1))
	banner.add_theme_constant_override("outline_size", 18)
	banner.grow_horizontal = Control.GROW_DIRECTION_BOTH
	banner.grow_vertical = Control.GROW_DIRECTION_BOTH
	root.add_child(banner)
	info = Label.new()
	info.position = Vector2(14, 10)
	info.add_theme_font_size_override("font_size", 15)
	info.add_theme_color_override("font_outline_color", Color.BLACK)
	info.add_theme_constant_override("outline_size", 5)
	root.add_child(info)
	var box := HBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	box.grow_vertical = Control.GROW_DIRECTION_BEGIN
	box.position.y -= 14
	box.add_theme_constant_override("separation", 24)
	root.add_child(box)
	for i in range(2):
		var pc := PanelContainer.new()
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0.05, 0.05, 0.1, 0.75)
		sb.border_color = C.PLAYER_COLORS[i]
		sb.set_border_width_all(3)
		sb.set_corner_radius_all(14)
		sb.content_margin_left = 16
		sb.content_margin_right = 16
		sb.content_margin_top = 6
		sb.content_margin_bottom = 8
		pc.add_theme_stylebox_override("panel", sb)
		pc.custom_minimum_size = Vector2(250, 0)
		var v := VBoxContainer.new()
		pc.add_child(v)
		var name := Label.new()
		name.add_theme_font_size_override("font_size", 16)
		v.add_child(name)
		var pct := Label.new()
		pct.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		pct.add_theme_font_size_override("font_size", 52)
		pct.add_theme_color_override("font_outline_color", Color(0.12, 0.04, 0.04))
		pct.add_theme_constant_override("outline_size", 8)
		v.add_child(pct)
		var stock := Label.new()
		stock.add_theme_font_size_override("font_size", 14)
		v.add_child(stock)
		var bar := ProgressBar.new()
		bar.max_value = 100
		bar.show_percentage = false
		bar.custom_minimum_size = Vector2(0, 8)
		bar.visible = Fighter.AWAKEN_ENABLED
		v.add_child(bar)
		box.add_child(pc)
		panels.append({"name": name, "pct": pct, "stock": stock, "bar": bar})


func _update_info() -> void:
	info.text = "1P: WASD移動 / Space ジャンプ / J 攻撃 / K 必殺 / L ガード / U つかみ / O スマッシュ\n" + \
		"2P: %s　F3: 2P切替　F2: CPUレベル %s　Tab: ステージ切替（%s）　F4/F5: キャラ切替　F6: 画質（%s）　Esc: ポーズ　Enter: やり直し" % [
		"人間（矢印キー＋テンキー）" if p2_human else "CPU", ("0（停止）" if cpu_level == 0 else str(cpu_level)), world.stage.label, Lighting.QUALITY_NAMES[quality]]


static func damage_color(p: float) -> Color:
	var stops := [[0.0, Color(1, 1, 1)], [40.0, Color(1, 0.94, 0.6)], [80.0, Color(1, 0.67, 0.24)],
		[120.0, Color(1, 0.31, 0.2)], [180.0, Color(0.78, 0.08, 0.12)], [300.0, Color(0.47, 0, 0.04)]]
	for i in range(stops.size() - 1):
		var a: Array = stops[i]
		var b: Array = stops[i + 1]
		if p <= b[0]:
			return a[1].lerp(b[1], (p - a[0]) / (b[0] - a[0]))
	return stops[-1][1]


func _update_hud() -> void:
	for i in range(min(panels.size(), world.fighters.size())):
		var f: Fighter = world.fighters[i]
		var pn: Dictionary = panels[i]
		pn.name.text = "%s  %s" % [f.tag, f.ch.name]
		pn.name.add_theme_color_override("font_color", f.color.lightened(0.3))
		if f.out:
			pn.pct.text = "%d位" % f.place
			pn.pct.add_theme_color_override("font_color", Color(0.6, 0.6, 0.65))
		else:
			pn.pct.text = "%d%%" % int(f.damage)
			pn.pct.add_theme_color_override("font_color", damage_color(f.damage))
		pn.stock.text = "●".repeat(max(0, f.stocks)) + ("　覚醒OK! (P)" if f.can_awaken() else "")
		pn.bar.value = f.meter
	if banner_t > 0:
		banner_t -= 1
		if banner_t == 0:
			banner.text = ""
	if world.over and banner.text == "GAME!":
		var w := world.winner
		banner.text = "%s の勝ち！\nEnter でもう一度" % (w.tag + " " + w.ch.name if w != null else "")
	if flash_t > 0:
		flash_t -= 1
		flash.color.a *= 0.8
	else:
		flash.color.a = 0.0


func _show_banner(text: String, frames: int) -> void:
	banner.text = text
	banner_t = frames
	banner.add_theme_font_size_override("font_size", 110 if text.length() <= 6 else 64)


func _flash(c: Color, frames: int) -> void:
	flash.color = c
	flash_t = frames
