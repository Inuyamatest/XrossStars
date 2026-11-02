## ステージ: 本体（すり抜け不可・崖下がえぐれた形）とすり抜け足場、場外ライン。
class_name Stage
extends RefCounted

const LIP := 26.0      # 崖の縁の厚み（ここまでは壁がまっすぐ）
const SLICE := 12.0    # 当たり判定の輪切りの厚み


class Platform:
	extends RefCounted
	var x1: float
	var x2: float
	var y: float
	var bx1: float
	var bx2: float
	var by: float
	var solid := false
	var depth := 0.0
	var move = null  # [dx振幅, dy振幅, 周期]
	var dx := 0.0
	var dy := 0.0
	var solids: Array = []   # 輪切り矩形 [x1, y1, x2, y2]
	var outline: PackedVector2Array

	func _init(a: float, b: float, yy: float, is_solid := false, d := 0.0, mv = null) -> void:
		x1 = a; x2 = b; y = yy; bx1 = a; bx2 = b; by = yy
		solid = is_solid; depth = d; move = mv

	func update(frame: int) -> void:
		if move == null:
			return
		var t: float = TAU * frame / move[2]
		var nx: float = move[0] * sin(t)
		var ny: float = move[1] * sin(t)
		dx = nx - (x1 - bx1)
		dy = ny - (y - by)
		x1 = bx1 + nx; x2 = bx2 + nx; y = by + ny


class Ledge:
	extends RefCounted
	var x: float
	var y: float
	var dir: int   # ステージの外側方向
	var holder = null

	func _init(xx: float, yy: float, d: int) -> void:
		x = xx; y = yy; dir = d


var key := ""
var label := ""
var main: Platform
var plats: Array = []
var blast := [0.0, 0.0, 0.0, 0.0]  # 左, 右, 上, 下
var spawns: Array = []
var ledges: Array = []
var shape := "bowl"
var rows: Array = []   # shape="blocks" のとき: 上の段から順に、横に並ぶブロックの数（1ブロック=100）

const TILE := 100.0     # ブロック1個の大きさ（素材の 2m 四方）
const TILE_EDGE := 45.0 # 端のブロックは外側が少し細い


static func row_half(n: int) -> float:
	return (n - 1) * TILE / 2.0 + TILE_EDGE


static func half_width(shp: String, w: float, depth: float, d: float) -> float:
	if d <= LIP:
		return w
	var t: float = min(1.0, (d - LIP) / max(1.0, depth - LIP))
	if shp == "wedge":
		return w * (1.0 - 0.92 * t) if t > 0.08 else w * (1.0 - t * 0.5)
	return w * sqrt(max(0.0, 1.0 - t * t)) * 0.96 + w * 0.04 * (1.0 - t)


func _build() -> void:
	var cx := (main.x1 + main.x2) / 2.0
	var w := (main.x2 - main.x1) / 2.0
	main.solids = []
	if shape == "blocks":
		# ブロックを積んだ浮島: 段ごとの矩形がそのまま当たり判定
		for r in range(rows.size()):
			var hw := row_half(rows[r])
			main.solids.append([cx - hw, main.y + TILE * r, cx + hw, main.y + TILE * (r + 1)])
		var opts := PackedVector2Array()
		for r in range(rows.size()):
			var hw2 := row_half(rows[r])
			opts.append(Vector2(cx + hw2, main.y + TILE * r))
			opts.append(Vector2(cx + hw2, main.y + TILE * (r + 1)))
		main.outline = opts
		ledges = [Ledge.new(main.x1, main.y, -1), Ledge.new(main.x2, main.y, 1)]
		return
	var d := 0.0
	while d < main.depth:
		var d2: float = min(main.depth, d + (LIP if d == 0.0 else SLICE))
		var hw: float = max(half_width(shape, w, main.depth, d), half_width(shape, w, main.depth, d2))
		if hw > 4.0:
			main.solids.append([cx - hw, main.y + d, cx + hw, main.y + d2])
		d = d2
	# 輪郭（右回り。3Dではこれを押し出してステージの形にする）
	var pts := PackedVector2Array()
	var steps := 28
	pts.append(Vector2(cx - w, main.y))
	pts.append(Vector2(cx + w, main.y))
	for i in range(steps + 1):
		var dd := LIP + (main.depth - LIP) * i / steps
		pts.append(Vector2(cx + half_width(shape, w, main.depth, dd), main.y + dd))
	for i in range(steps, -1, -1):
		var dd := LIP + (main.depth - LIP) * i / steps
		pts.append(Vector2(cx - half_width(shape, w, main.depth, dd), main.y + dd))
	main.outline = pts
	ledges = [Ledge.new(main.x1, main.y, -1), Ledge.new(main.x2, main.y, 1)]


func update(frame: int) -> void:
	for p in plats:
		p.update(frame)


func surfaces() -> Array:
	return [main] + plats


static func make(k: String) -> Stage:
	var s := Stage.new()
	s.key = k
	match k:
		"final":
			s.label = "終点"
			s.shape = "blocks"
			s.rows = [10, 8, 6]
			var hw := row_half(10)
			s.main = Platform.new(-hw, hw, 0, true, TILE * 3)
			s.blast = [-1400.0, 1400.0, -1400.0, 720.0]
			s.spawns = [-330.0, 330.0, -110.0, 110.0]
		_:
			s.key = "battlefield"
			s.label = "戦場"
			s.shape = "blocks"
			s.rows = [8, 6, 4]
			var hw := row_half(8)
			s.main = Platform.new(-hw, hw, 0, true, TILE * 3)
			# すり抜け足場は素材の黄色い足場（幅 4.27m ≒ 213）に合わせる
			s.plats = [Platform.new(-316, -104, -140), Platform.new(104, 316, -140), Platform.new(-106, 106, -275)]
			s.blast = [-1350.0, 1350.0, -1400.0, 720.0]
			s.spawns = [-280.0, 280.0, -110.0, 110.0]
	s._build()
	return s
