## MUGEN キャラのアニメ一覧画像（ワザの割り当てを決める用）。攻撃判定 Clsn1 を赤枠で描く。
## xvfb-run godot --path godot-fight --rendering-driver vulkan --script res://tests/sheet_mugen.gd -- <フォルダ> <出力.png> <アニメ番号,...>
extends SceneTree

const CW := 150
const CH := 170
const COLS := 8


func _init() -> void:
	var a := OS.get_cmdline_user_args()
	var folder: String = a[0]
	var out: String = a[1]
	var ids := Array(a[2].split(",")).map(func(s): return int(s))
	var mg := Mugen.load_char(folder)
	var sff := Mugen.Sff.new(Mugen.find_file(folder, mg.files.sprite))
	var img := Image.create(CW * COLS, CH * ids.size(), false, Image.FORMAT_RGBA8)
	img.fill(Color(0.22, 0.22, 0.3))
	for row in range(ids.size()):
		var an: int = ids[row]
		if not mg.air.has(an):
			continue
		var fr: Array = mg.air[an].frames
		# 代表コマ: 均等に COLS-1 枚 + 最初の判定コマ
		var pick := []
		var first_hit := -1
		for i in range(fr.size()):
			if not fr[i].c1.is_empty():
				first_hit = i
				break
		var n: int = min(COLS, fr.size())
		for k in range(n):
			pick.append(int(float(k) / max(1, n - 1) * (fr.size() - 1)) if n > 1 else 0)
		if first_hit >= 0 and not first_hit in pick:
			pick[min(pick.size() - 1, 3)] = first_hit
			pick.sort()
		for col in range(pick.size()):
			var fd: Dictionary = fr[pick[col]]
			var s = sff.get_sprite(fd.g, fd.i)
			var ox := col * CW + CW / 2
			var oy := row * CH + CH - 12
			var sc := 0.42
			if s != null:
				var src: Image = s[0].get_image()
				var w := int(src.get_width() * sc)
				var h := int(src.get_height() * sc)
				if w > 0 and h > 0:
					src.resize(w, h)
					var px := ox + int((-s[1] + fd.ox) * sc)
					var py := oy + int((-s[2] + fd.oy) * sc)
					img.blend_rect(src, Rect2i(0, 0, w, h), Vector2i(px, py))
			for b in fd.c1:
				_rect(img, ox + int(b[0] * sc), oy + int(b[1] * sc), ox + int(b[2] * sc), oy + int(b[3] * sc), Color(1, 0.2, 0.2), Rect2i(col * CW, row * CH, CW, CH))
			# 判定コマは上に赤い帯
			if not fd.c1.is_empty():
				img.fill_rect(Rect2i(col * CW + 2, row * CH + 2, CW - 4, 4), Color(1, 0.2, 0.2))
			img.fill_rect(Rect2i(col * CW, row * CH + CH - 1, CW, 1), Color(0.4, 0.4, 0.5))
	img.save_png(out)
	print("saved ", out)
	quit()


func _rect(img: Image, x1: int, y1: int, x2: int, y2: int, c: Color, clip: Rect2i) -> void:
	var l: int = min(x1, x2)
	var r: int = max(x1, x2)
	var t: int = min(y1, y2)
	var b: int = max(y1, y2)
	for x in range(l, r + 1):
		for y in [t, b]:
			if clip.has_point(Vector2i(x, y)):
				img.set_pixel(x, y, c)
	for y in range(t, b + 1):
		for x in [l, r]:
			if clip.has_point(Vector2i(x, y)):
				img.set_pixel(x, y, c)
