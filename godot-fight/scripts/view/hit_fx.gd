## 打撃の手ごたえ用のエフェクト: アニメ調のヒット火花（とげとげの閃光）と、ふっとぶ方向への斬撃・衝撃の線。
## 絵は起動時にプログラムで作る（画像ファイル不要）。キャラより手前に描く。
class_name HitFx
extends Node3D

const K := 0.02

var tex_burst: ImageTexture
var tex_core: ImageTexture
var tex_slash: ImageTexture
var tex_line: ImageTexture
var live: Array = []   # {node, life, max, kind, size, vel, rot_v}


func _ready() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 11
	tex_burst = _make_burst(rng)
	tex_core = _make_core()
	tex_slash = _make_slash()
	tex_line = _make_line()


# ------------------------------------------------------------ 絵を作る
func _make_burst(rng: RandomNumberGenerator) -> ImageTexture:
	## とげとげの閃光（中心は白、ふちに色がつくのは modulate で）
	var n := 192
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var spikes := 14
	var lens := []
	for i in range(spikes):
		lens.append(rng.randf_range(0.55, 1.0) if i % 2 == 0 else rng.randf_range(0.25, 0.5))
	for y in range(n):
		for x in range(n):
			var dx := (x + 0.5) / n * 2.0 - 1.0
			var dy := (y + 0.5) / n * 2.0 - 1.0
			var r := sqrt(dx * dx + dy * dy)
			var a := fposmod(atan2(dy, dx), TAU) / TAU * spikes
			var i0 := int(a) % spikes
			var i1 := (i0 + 1) % spikes
			var fr: float = a - floor(a)
			# とげ: 角度の真ん中で尖る
			var tip: float = lerp(lens[i0], lens[i1], fr)
			var sharp: float = 1.0 - abs(fr - 0.5) * 2.0
			var edge: float = tip * (0.35 + 0.65 * pow(sharp, 1.6))
			edge = max(edge, 0.22)
			var al: float = clamp((edge - r) / 0.04, 0.0, 1.0)
			if al <= 0.0:
				img.set_pixel(x, y, Color(0, 0, 0, 0))
				continue
			var w: float = clamp(1.0 - r / max(0.01, edge) * 0.9, 0.0, 1.0)
			var c := Color(1, 1, 1).lerp(Color(1, 1, 1, 1), w)
			c.a = al * (0.75 + 0.25 * w)
			# 中心ほど白、ふちは少し暗く（modulate の色が出る）
			var v: float = 0.6 + 0.4 * w
			img.set_pixel(x, y, Color(v, v, v, c.a))
	return ImageTexture.create_from_image(img)


func _make_core() -> ImageTexture:
	var n := 96
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	for y in range(n):
		for x in range(n):
			var dx := (x + 0.5) / n * 2.0 - 1.0
			var dy := (y + 0.5) / n * 2.0 - 1.0
			var r := sqrt(dx * dx + dy * dy)
			var a: float = clamp(1.0 - r, 0.0, 1.0)
			img.set_pixel(x, y, Color(1, 1, 1, pow(a, 1.5)))
	return ImageTexture.create_from_image(img)


func _make_slash() -> ImageTexture:
	## 三日月形の斬撃（横長。両端が細い）
	var w := 256
	var h := 96
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	for y in range(h):
		for x in range(w):
			var u := (x + 0.5) / w * 2.0 - 1.0       # -1..1
			var v := (y + 0.5) / h * 2.0 - 1.0
			var center := -0.55 * (1.0 - u * u)        # 弧を描く
			var thick := 0.42 * pow(1.0 - u * u, 1.2)
			var d: float = abs(v - center)
			var al: float = clamp((thick - d) / 0.08, 0.0, 1.0)
			var core: float = clamp(1.0 - d / max(0.01, thick), 0.0, 1.0)
			var lv: float = 0.65 + 0.35 * core
			img.set_pixel(x, y, Color(lv, lv, lv, al))
	return ImageTexture.create_from_image(img)


func _make_line() -> ImageTexture:
	## 細長い衝撃線（先が細い）
	var w := 128
	var h := 16
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	for y in range(h):
		for x in range(w):
			var u := (x + 0.5) / w
			var v: float = abs((y + 0.5) / h * 2.0 - 1.0)
			var thick := 1.0 - u
			var al: float = clamp((thick - v) / 0.25, 0.0, 1.0)
			img.set_pixel(x, y, Color(1, 1, 1, al))
	return ImageTexture.create_from_image(img)


# ------------------------------------------------------------ 出す
func _sprite(tex: Texture2D, pos: Vector3, px_size: float, color: Color, rot: float) -> Sprite3D:
	var s := Sprite3D.new()
	s.texture = tex
	s.shaded = false
	s.no_depth_test = true
	s.render_priority = 10
	s.alpha_cut = SpriteBase3D.ALPHA_CUT_DISABLED
	s.double_sided = true
	s.pixel_size = px_size
	s.modulate = color
	s.position = pos
	s.rotation.z = rot
	add_child(s)
	return s


func spawn_hit(x: float, y: float, dmg: float, lx: float, ly: float, color: Color, kind: String) -> void:
	## x, y はゲームの座標。lx, ly はふっとぶ向き（長さ 1）
	var pos := Vector3(x * K, -y * K, 0.6)
	var power: float = clamp(dmg / 14.0, 0.25, 1.6)
	var ang := atan2(-ly, lx)   # 画面上の角度（上がプラス）
	var tint := color.lerp(Color(1, 1, 1), 0.35)
	# 白い芯（一瞬だけ大きく光る）
	var core := _sprite(tex_core, pos, 0.0045 * (0.8 + power), Color(1, 1, 1, 0.9), 0)
	live.append({"node": core, "life": 6, "max": 6, "kind": "core", "size": core.pixel_size, "vel": Vector3.ZERO, "rot_v": 0.0})
	# とげとげの閃光
	var b := _sprite(tex_burst, pos, 0.0048 * (0.7 + power), Color(tint.r * 1.6, tint.g * 1.6, tint.b * 1.6, 1), randf() * TAU)
	var bl := 9 + int(power * 4)
	live.append({"node": b, "life": bl, "max": bl, "kind": "burst", "size": b.pixel_size, "vel": Vector3.ZERO, "rot_v": randf_range(-0.05, 0.05)})
	if kind == "slash" or kind == "big":
		# 斬撃: ふっとぶ向きと直角に近い弧
		var sl := _sprite(tex_slash, pos, 0.0065 * (0.7 + power), Color(tint.r * 1.8, tint.g * 1.8, tint.b * 1.8, 1), ang + PI / 2 + randf_range(-0.4, 0.4))
		live.append({"node": sl, "life": 8, "max": 8, "kind": "slash", "size": sl.pixel_size, "vel": Vector3.ZERO, "rot_v": 0.0})
	# ふっとぶ向きに走る衝撃線
	var n := 3 + int(power * 4)
	for i in range(n):
		var a := ang + randf_range(-0.55, 0.55)
		var sp := randf_range(0.10, 0.22) * (0.6 + power)
		var ln := _sprite(tex_line, pos, 0.006 * (0.5 + power * 0.8) * randf_range(0.7, 1.2), Color(1.6, 1.6, 1.5, 1), a)
		ln.offset = Vector2(64, 0)   # 根元を中心に（外に向かって伸びる）
		var life := 7 + randi() % 4
		live.append({"node": ln, "life": life, "max": life, "kind": "line", "size": ln.pixel_size,
			"vel": Vector3(cos(a), sin(a), 0) * sp, "rot_v": 0.0})


func spawn_guard(x: float, y: float, dmg: float) -> void:
	var pos := Vector3(x * K, -y * K, 0.6)
	var power: float = clamp(dmg / 14.0, 0.25, 1.4)
	var b := _sprite(tex_burst, pos, 0.005 * (0.7 + power), Color(0.75, 0.95, 1.6, 1), randf() * TAU)
	live.append({"node": b, "life": 8, "max": 8, "kind": "burst", "size": b.pixel_size, "vel": Vector3.ZERO, "rot_v": 0.0})


func _process(_delta: float) -> void:
	var keep := []
	for e in live:
		var s: Sprite3D = e.node
		e.life -= 1
		if e.life <= 0:
			s.queue_free()
			continue
		var k: float = float(e.life) / e.max      # 1 → 0
		var t: float = 1.0 - k
		match e.kind:
			"core":
				s.pixel_size = e.size * (1.0 + t * 1.2)
				s.modulate.a = k * 0.9
			"burst":
				# 最初の 2 フレームでぱっと広がり、あとは縮みながら消える
				var grow: float = min(1.0, t * 4.0)
				s.pixel_size = e.size * (0.6 + 0.6 * grow) * (1.0 - max(0.0, t - 0.4) * 0.6)
				s.modulate.a = 1.0 if t < 0.35 else k / 0.65
				s.rotation.z += e.rot_v
			"slash":
				s.pixel_size = e.size * (0.8 + t * 0.5)
				s.modulate.a = k
			"line":
				s.position += e.vel
				e.vel *= 0.82
				s.scale = Vector3(1.0 + t * 0.8, max(0.2, k), 1)
				s.modulate.a = k
		keep.append(e)
	live = keep
