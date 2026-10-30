## 試作版のメイン: ステージ・カメラ・キャラ・エフェクト・HUD を組み立て、World を 60fps で進める。
extends Node3D

const K := 0.02

var world: World
var puppets: Array = []
var stage_key := "battlefield"
var cpu_level := 5
var p2_human := false
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
	var a := Chars.blaze()
	var b := Chars.blaze()
	b.colors = {"body": Color(0.2, 0.42, 0.85), "accent": Color(0.55, 0.9, 1.0), "skin": Color(1.0, 0.86, 0.76), "hair": Color(0.12, 0.2, 0.45)}
	var c2 = HumanController.new(1) if p2_human else CpuController.new(cpu_level, rng)
	var c1 = CpuController.new(7, rng) if demo else HumanController.new(0)
	if demo:
		c2 = CpuController.new(7, rng)
	world = World.new(stage_key, [[a, c1, demo], [b, c2, demo or not p2_human]], 3, rng.randi(), true)
	_build_stage()
	for f in world.fighters:
		var pp := Puppet.new()
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
	var env := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.16, 0.12, 0.36)
	sm.sky_horizon_color = Color(0.98, 0.58, 0.42)
	sm.ground_horizon_color = Color(0.55, 0.3, 0.4)
	sm.ground_bottom_color = Color(0.12, 0.08, 0.16)
	sm.sun_angle_max = 20.0
	sky.sky_material = sm
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.9
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.glow_bloom = 0.1
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-38, 35, 0)
	sun.light_energy = 1.3
	sun.light_color = Color(1.0, 0.92, 0.82)
	sun.shadow_enabled = true
	add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-20, -140, 0)
	fill.light_energy = 0.35
	fill.light_color = Color(0.6, 0.6, 1.0)
	add_child(fill)
	cam = Camera3D.new()
	cam.fov = 30
	cam.near = 0.5
	cam.far = 800
	add_child(cam)
	cam.position = cam_pos
	# 遠景（山と夕日）
	var deco := Node3D.new()
	add_child(deco)
	var sunball := MeshInstance3D.new()
	var sb := SphereMesh.new()
	sunball.mesh = sb
	sunball.scale = Vector3.ONE * 40
	sunball.position = Vector3(0, 6, -320)
	sunball.material_override = _unshaded(Color(1.0, 0.82, 0.55), 2.0)
	deco.add_child(sunball)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for i in range(14):
		var mi := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.0
		cm.bottom_radius = rng.randf_range(30, 60)
		cm.height = rng.randf_range(30, 60)
		cm.radial_segments = 6
		mi.mesh = cm
		var z := rng.randf_range(-300, -180)
		mi.position = Vector3(rng.randf_range(-260, 260), -40 + cm.height / 2, z)
		var shade := 0.22 + (z + 300) / 120 * 0.1
		mi.material_override = _mat(Color(0.32 * shade * 2.2, 0.2 * shade * 2.2, 0.36 * shade * 2.2))
		deco.add_child(mi)


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
	stage_root = Node3D.new()
	add_child(stage_root)
	var m = world.stage.main
	var poly := PackedVector2Array()
	for p in m.outline:
		poly.append(Vector2(p.x * K, -p.y * K))
	var depth := 3.2
	var body := CSGPolygon3D.new()
	body.polygon = poly
	body.depth = depth
	body.position.z = depth / 2
	body.material = _mat(Color(0.26, 0.2, 0.32))
	stage_root.add_child(body)
	# 縁（リップ）: 上面から少し下まで別の色、少し張り出す
	var lip := CSGPolygon3D.new()
	var cx: float = (m.x1 + m.x2) / 2.0
	var w: float = (m.x2 - m.x1) / 2.0
	lip.polygon = PackedVector2Array([Vector2((cx - w) * K, 0), Vector2((cx + w) * K, 0),
		Vector2((cx + w) * K, -Stage.LIP * K), Vector2((cx - w) * K, -Stage.LIP * K)])
	lip.depth = depth + 0.3
	lip.position.z = (depth + 0.3) / 2
	lip.material = _mat(Color(0.36, 0.3, 0.42))
	stage_root.add_child(lip)
	var top := MeshInstance3D.new()
	var tb := BoxMesh.new()
	tb.size = Vector3(w * 2 * K, 0.05, depth + 0.32)
	top.mesh = tb
	top.position = Vector3(cx * K, 0.0, 0)
	top.material_override = _unshaded(Color(1.0, 0.78, 0.5), 0.6)
	stage_root.add_child(top)
	# 底の光
	var glow := MeshInstance3D.new()
	glow.mesh = SphereMesh.new()
	glow.scale = Vector3.ONE * 1.4
	glow.position = Vector3(cx * K, -m.depth * K, 0)
	glow.material_override = _unshaded(Color(1.0, 0.6, 0.45), 3.0)
	stage_root.add_child(glow)
	for p in world.stage.plats:
		var pm := MeshInstance3D.new()
		var bx := BoxMesh.new()
		bx.size = Vector3((p.x2 - p.x1) * K, 0.22, 3.2)
		pm.mesh = bx
		pm.position = Vector3((p.x1 + p.x2) / 2 * K, -p.y * K - 0.11, 0)
		pm.material_override = _mat(Color(0.4, 0.32, 0.44))
		stage_root.add_child(pm)
		var line := MeshInstance3D.new()
		var lb := BoxMesh.new()
		lb.size = Vector3((p.x2 - p.x1) * K, 0.04, 3.22)
		line.mesh = lb
		line.position = pm.position + Vector3(0, 0.11, 0)
		line.material_override = _unshaded(Color(1.0, 0.78, 0.5), 0.6)
		stage_root.add_child(line)


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


# ------------------------------------------------------------ 飛び道具・エフェクト
func _update_projs() -> void:
	var alive := {}
	for p in world.projs:
		alive[p] = true
		if not proj_nodes.has(p):
			var mi := MeshInstance3D.new()
			mi.mesh = SphereMesh.new()
			mi.material_override = _unshaded(Color(1.0, 0.5, 0.15), 4.0)
			add_child(mi)
			proj_nodes[p] = mi
		var n: MeshInstance3D = proj_nodes[p]
		n.position = Vector3(p.x * K, -p.y * K, 0)
		n.scale = Vector3.ONE * p.r * 2 * K * (1.0 + 0.15 * sin(world.frame * 0.8))
	for p in proj_nodes.keys():
		if not alive.has(p):
			proj_nodes[p].queue_free()
			proj_nodes.erase(p)


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
				_spawn_fx("ring", pos, col.lightened(0.5), 0.6 + dmg * 0.05, 14)
				shake = max(shake, min(22.0, dmg * 0.7 + e.kb * 0.06))
				if e.kb > 150:
					_flash(Color(1, 1, 1, 0.5), 6)
			"block", "tech", "counter":
				_spawn_fx("ring", pos, Color(0.7, 0.9, 1.0), 1.0, 14)
				if e.kind == "tech":
					_show_banner("受け身!", 30)
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
			"shieldbreak":
				_show_banner("SHIELD BREAK!", 60)
			"awaken":
				var who: Fighter = e.who
				_flash(Color(1, 0.8, 0.4, 0.5), 10)
				_show_banner("覚醒  " + who.ch.awaken, 70)
			"awaken_blast":
				_flash(Color(1, 1, 1, 0.8), 18)
				shake = 30.0
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
		v.add_child(bar)
		box.add_child(pc)
		panels.append({"name": name, "pct": pct, "stock": stock, "bar": bar})


func _update_info() -> void:
	info.text = "1P: WASD移動 / Space ジャンプ / J 攻撃 / K 必殺 / L ガード / U つかみ / O スマッシュ / P 覚醒\n" + \
		"2P: %s　F3: 2P切替　F2: CPUレベル %d　Tab: ステージ切替（%s）　Esc: ポーズ　Enter: やり直し" % [
		"人間（矢印キー＋テンキー）" if p2_human else "CPU", cpu_level, world.stage.label]


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
