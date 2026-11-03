## MUGEN キャラの読み込み（2D版 smash-game/game/sprites.py・voices.py の移植）。
## .def / .air（アニメと当たり判定 Clsn）/ .sff（ドット絵 v1・v2）/ .snd（声・効果音）/ .cns（PlaySnd の鳴らし方）
## ゲームの中身（sim）は .air と .def だけを使うので、画面なしのテストでも動く。
class_name Mugen
extends RefCounted


const TARGET_H := 92.0

# 状態 → MUGEN の標準アニメ番号（候補を順に試す）
const STATE_ANIMS := {
	"stand": [0], "walk": [20], "run": [100, 20], "crouch": [11, 10], "jumpsquat": [40, 10],
	"rise": [41, 42], "fall": [44, 41], "land": [47, 10], "shield": [130, 120],
	"roll": [105, 100], "spot": [130], "airdodge": [132, 41], "hit": [5000, 5010], "tumble": [5050, 5030],
	"down": [5110, 5100, 5050], "getup": [5120], "grabbed": [5000], "hold": [800], "ledge": [41], "climb": [40, 10],
	"dizzy": [5300, 5000], "helpless": [41], "awaken": [3000, 195, 181], "respawn": [0], "win": [181, 180, 0],
}
# ワザ → MUGEN のアニメ番号の候補（攻撃判定 Clsn1 を持つものを優先）
const MOVE_ANIMS := {
	"jab": [200, 201, 400], "jab2": [201, 202, 210], "jab3": [202, 203, 211, 220], "ftilt": [210, 220, 211],
	"utilt": [230, 203, 212, 220], "dtilt": [400, 410, 430], "dash": [240, 230, 211, 210],
	"fsmash": [220, 212, 240, 211, 210], "usmash": [420, 230, 203], "dsmash": [440, 430, 420, 410],
	"nair": [600, 601], "fair": [610, 620, 601], "bair": [630, 640, 620, 610], "uair": [620, 630, 601, 600],
	"dair": [640, 650, 630, 620, 600], "grab": [800], "dashgrab": [800],
	"fthrow": [810, 820], "bthrow": [820, 810], "uthrow": [830, 810], "dthrow": [840, 810],
	"ledgeatk": [400, 200], "getupatk": [430, 400, 200],
}
const THROW_SLOTS := ["fthrow", "bthrow", "uthrow", "dthrow"]
const SPECIAL_SLOTS := ["nspecial", "sspecial", "uspecial", "dspecial"]


## MUGEN キャラを読む（sim 用: .def と .air だけ）。戻り値はキャラ辞書に足す情報
static func load_char(folder: String) -> Dictionary:
	var dp := find_def(folder)
	if dp == "":
		return {}
	var r := parse_def(dp)
	var info: Dictionary = r[0]
	var files: Dictionary = r[1]
	var air := parse_air(find_file(folder, files.get("anim", "")))
	if not air.has(0) or air[0].frames.is_empty():
		return {}
	var c2: Array = air[0].frames[0].c2
	var height := 100.0
	var width := 40.0
	if not c2.is_empty():
		var top := 0.0
		var l := 1e9
		var rr := -1e9
		for b in c2:
			top = min(top, b[1])
			l = min(l, b[0])
			rr = max(rr, b[2])
		height = -top
		width = rr - l
	var scale: float = TARGET_H / max(20.0, height)
	var state_map := {}
	for k in STATE_ANIMS:
		for c in STATE_ANIMS[k]:
			if air.has(c) and not air[c].frames.is_empty():
				state_map[k] = c
				break
	var move_plan := {}
	var used := {}
	for slot in MOVE_ANIMS:
		var need: bool = not (slot in THROW_SLOTS)
		var ok := []
		for c in MOVE_ANIMS[slot]:
			if air.has(c) and not air[c].frames.is_empty() and (not need or has_clsn1(air[c])):
				ok.append(c)
		if ok.is_empty():
			continue
		var pick = ok[0]
		for c in ok:
			if not used.has(c):
				pick = c
				break
		move_plan[slot] = pick
		used[pick] = true
	var specials := []
	for n in air.keys():
		if n >= 1000 and n < 3000 and not air[n].frames.is_empty():
			specials.append(n)
	specials.sort()
	var spec := {}
	for k in range(min(4, specials.size())):
		spec[SPECIAL_SLOTS[k]] = specials[k]
	var fb := {"nspecial": "fair", "sspecial": "dash", "uspecial": "uair", "dspecial": "dsmash"}
	for sl in SPECIAL_SLOTS:
		if not spec.has(sl) and move_plan.has(fb[sl]):
			spec[sl] = move_plan[fb[sl]]
	return {"folder": folder, "def": dp, "files": files, "info": info, "air": air, "scale": scale,
		"hw": clamp(width * scale / 2.0, 16.0, 30.0), "state_map": state_map, "move_plan": move_plan, "spec_anims": spec}


static func apply_moves(mv: Dictionary, mg: Dictionary) -> void:
	## 共通ワザを、MUGEN のアニメと攻撃判定（Clsn1）に置き換える。性能（ダメージ・ふっとばし）は元のワザの値を使う
	var air: Dictionary = mg.air
	var scale: float = mg.scale
	for slot in mg.move_plan:
		var m: MoveDef = mv.get(slot)
		if m == null:
			continue
		var an: int = mg.move_plan[slot]
		m.spr = an
		m.spr_mode = "warp"
		var wins := clsn_windows(air[an], scale)
		if wins.is_empty() or slot in THROW_SLOTS or m.hits.is_empty():
			continue
		var tmpl: Dictionary = m.hits[0].duplicate()
		var n := wins.size()
		var hits := []
		for gi in range(n):
			var w: Array = wins[gi]
			var r: Array = w[2]
			if slot == "bair":
				r = [-r[2], r[1], -r[0], r[3]]
			var h := tmpl.duplicate()
			h.f0 = w[0]
			h.f1 = w[1]
			h.rect = r
			h.x = (r[0] + r[2]) / 2.0
			h.y = (r[1] + r[3]) / 2.0
			h.r = max(8.0, min(r[2] - r[0], r[3] - r[1]) / 2.0)
			h.group = gi
			h.rehit = 0
			h.both = slot == "dsmash"
			if n > 1 and gi < n - 1 and not tmpl.grab:
				h.dmg = max(1.0, snapped(tmpl.dmg * 0.5 / (n - 1), 0.1))
				h.ang = 75.0
				h.bkb = 25.0
				h.kbg = 12.0
			elif n > 1 and not tmpl.grab:
				h.dmg = snapped(tmpl.dmg * 0.6, 0.1)
			hits.append(h)
			if tmpl.grab:
				break
		# 発生が早すぎる絵（1コマ目から判定がある等）は、最初の絵を長めに見せて元のワザの発生に近づける
		var want: int = max(1, int(tmpl.f0 * 0.6))
		var delay: int = max(0, want - hits[0].f0)
		for h in hits:
			h.f0 += delay
			h.f1 += delay
		m.spr_delay = delay
		m.hits = hits
		m.total = min(max(anim_length(air[an]) + delay, hits[-1].f1 + 4), 150)
		if m.charge_at != null:
			m.charge_at = max(1, hits[0].f0 - 2)
		if m.chain != null:
			m.chain = [min(m.total, hits[-1].f1 + 1), m.chain[1]]
		m.spr_mode = "direct"
		m.spr_flip = slot == "bair"
	# キャラ専用の必殺ワザ（spr と mugen_hits を自分で決めているもの）
	for k in mv:
		var m: MoveDef = mv[k]
		if m.mugen_hits and m.spr != null and air.has(m.spr):
			_special_hits(m, air[m.spr], scale)
	for slot in mg.spec_anims:
		if mv.has(slot) and mv[slot].mugen_hits:
			continue
		for k in [slot, slot + "_air", "d_land", "d_hit", "s_throw"]:
			if k.begins_with(slot.substr(0, 1)) and mv.has(k):
				mv[k].spr = mg.spec_anims[slot]
				mv[k].spr_mode = "warp"


static func _special_hits(m: MoveDef, a: Dictionary, scale: float) -> void:
	## アニメのティックそのままで再生し、攻撃判定は Clsn1 の窓を使う。
	## hits[0] を途中の窓（多段なら rehit で何回も当たる）、hits[-1] を最後の窓の性能にする。
	## hits に rect を書いてあるワザは、その判定をそのまま使う（画面全体に届く判定などを抑えるため）
	m.spr_mode = "direct"
	m.spr_delay = 0
	if m.hits.is_empty() or m.hits[0].has("rect"):
		return
	var wins := clsn_windows(a, scale)
	if wins.is_empty():
		return
	var first: Dictionary = m.hits[0]
	var last: Dictionary = m.hits[-1]
	var hits := []
	for gi in range(wins.size()):
		var w: Array = wins[gi]
		var r: Array = w[2]
		var h: Dictionary = (last if gi == wins.size() - 1 else first).duplicate()
		h.f0 = w[0]
		h.f1 = w[1]
		h.rect = r
		h.x = (r[0] + r[2]) / 2.0
		h.y = (r[1] + r[3]) / 2.0
		h.r = max(8.0, min(r[2] - r[0], r[3] - r[1]) / 2.0)
		h.group = gi
		hits.append(h)
	m.hits = hits


# ================================================================ .def
static func parse_def(path: String) -> Array:
	var info := {}
	var files := {}
	var sec := ""
	for raw in FileAccess.get_file_as_string(path).split("\n"):
		var line: String = raw.get_slice(";", 0).strip_edges()
		if line == "":
			continue
		if line.begins_with("[") and line.ends_with("]"):
			sec = line.substr(1, line.length() - 2).strip_edges().to_lower()
			continue
		if "=" in line:
			var k := line.get_slice("=", 0).strip_edges().to_lower()
			var v := line.substr(line.find("=") + 1).strip_edges().trim_prefix("\"").trim_suffix("\"")
			if sec == "info":
				info[k] = v
			elif sec == "files":
				files[k] = v
	return [info, files]


static func find_file(folder: String, name: String) -> String:
	## 大文字小文字・\ と / の違いを吸収して探す（Windows 向けに作られたキャラ対策）
	if name == "":
		return ""
	var p := folder.path_join(name.replace("\\", "/"))
	if FileAccess.file_exists(p):
		return p
	var d := p.get_base_dir()
	if DirAccess.dir_exists_absolute(d):
		for f in DirAccess.get_files_at(d):
			if f.to_lower() == p.get_file().to_lower():
				return d.path_join(f)
	return ""


static func find_def(folder: String) -> String:
	var defs := Array(DirAccess.get_files_at(folder)).filter(func(n): return n.get_extension().to_lower() == "def")
	defs.sort()
	for d in defs:
		var r := parse_def(folder.path_join(d))
		if find_file(folder, r[1].get("sprite", "")) != "" and find_file(folder, r[1].get("anim", "")) != "":
			return folder.path_join(d)
	return ""


# ================================================================ .air（アニメ）
## 戻り値: アニメ番号 -> {"frames": [{g, i, ox, oy, t, flip, c1:[[x1,y1,x2,y2]...], c2:[...]}], "loopstart": n}
static func parse_air(path: String) -> Dictionary:
	var anims := {}
	var cur = null
	var def1 = null
	var def2 = null
	var pend1 = null
	var pend2 = null
	var target = null
	var re_action := RegEx.create_from_string("^\\[\\s*begin\\s+action\\s+(-?\\d+)\\s*\\]")
	var re_clsn := RegEx.create_from_string("^clsn([12])(default)?\\s*:\\s*(\\d+)")
	var re_box := RegEx.create_from_string("^clsn[12]\\s*\\[\\s*\\d+\\s*\\]\\s*=\\s*(.+)")
	var re_num := RegEx.create_from_string("-?\\d+(\\.\\d+)?")
	var text := FileAccess.get_file_as_bytes(path).get_string_from_ascii()
	for raw in text.split("\n"):
		var line: String = raw.get_slice(";", 0).strip_edges()
		if line == "":
			continue
		var low := line.to_lower()
		var m := re_action.search(low)
		if m:
			cur = {"frames": [], "loopstart": 0}
			anims[int(m.get_string(1))] = cur
			def1 = null; def2 = null; pend1 = null; pend2 = null
			continue
		if cur == null:
			continue
		if low.begins_with("loopstart"):
			cur.loopstart = cur.frames.size()
			continue
		m = re_clsn.search(low)
		if m:
			var lst := []
			if m.get_string(1) == "1":
				if m.get_string(2) != "":
					def1 = lst
				else:
					pend1 = lst
			else:
				if m.get_string(2) != "":
					def2 = lst
				else:
					pend2 = lst
			target = lst
			continue
		m = re_box.search(low)
		if m:
			var nums := []
			for nm in re_num.search_all(m.get_string(1)):
				nums.append(int(float(nm.get_string())))
			if target != null and nums.size() >= 4:
				target.append([min(nums[0], nums[2]), min(nums[1], nums[3]), max(nums[0], nums[2]), max(nums[1], nums[3])])
			continue
		var c0 := line.substr(0, 1)
		if c0.is_valid_int() or c0 == "-":
			var parts := line.split(",")
			if parts.size() < 5:
				continue
			var fr := {"g": int(float(parts[0])), "i": int(float(parts[1])), "ox": int(float(parts[2])),
				"oy": int(float(parts[3])), "t": int(float(parts[4])),
				"flip": parts.size() > 5 and parts[5].to_lower().contains("h"),
				"tr": parts[6].strip_edges().to_upper() if parts.size() > 6 else ""}
			fr.c1 = (pend1 if pend1 != null else (def1 if def1 != null else [])).duplicate()
			fr.c2 = (pend2 if pend2 != null else (def2 if def2 != null else [])).duplicate()
			cur.frames.append(fr)
			pend1 = null
			pend2 = null
	return anims


static func anim_length(a: Dictionary) -> int:
	var n := 0
	for f in a.frames:
		n += max(1, f.t) if f.t >= 0 else 30
	return n


static func frame_at(a: Dictionary, t: int, loop: bool) -> int:
	## t ティック目に表示するフレーム番号
	var fr: Array = a.frames
	if fr.is_empty():
		return 0
	var acc := 0
	for i in range(fr.size()):
		if fr[i].t < 0:
			return i
		acc += fr[i].t
		if t < acc:
			return i
	if not loop:
		return fr.size() - 1
	var ls: int = min(a.loopstart, fr.size() - 1)
	var loop_len := 0
	for i in range(ls, fr.size()):
		loop_len += max(1, fr[i].t)
	var tt: int = (t - acc) % max(1, loop_len)
	acc = 0
	for i in range(ls, fr.size()):
		acc += max(1, fr[i].t)
		if tt < acc:
			return i
	return fr.size() - 1


static func has_clsn1(a) -> bool:
	if a == null:
		return false
	for f in a.frames:
		if not f.c1.is_empty():
			return true
	return false


static func clsn_windows(a: Dictionary, scale: float) -> Array:
	## 攻撃判定 Clsn1 が出ているフレームを [開始, 終了, 矩形] のまとまりにする（ワザのフレーム番号 = ティック+1）
	var wins := []
	var t := 0
	var cur = null
	for f in a.frames:
		var tm: int = max(1, f.t) if f.t >= 0 else 30
		if not f.c1.is_empty():
			var r := [1e9, 1e9, -1e9, -1e9]
			for b in f.c1:
				r = [min(r[0], b[0]), min(r[1], b[1]), max(r[2], b[2]), max(r[3], b[3])]
			r = [r[0] * scale, r[1] * scale, r[2] * scale, r[3] * scale]
			if cur != null and cur[1] == t:
				cur[1] = t + tm
				cur[2] = [min(cur[2][0], r[0]), min(cur[2][1], r[1]), max(cur[2][2], r[2]), max(cur[2][3], r[3])]
			else:
				cur = [t, t + tm, r]
				wins.append(cur)
		else:
			cur = null
		t += tm
	var out := []
	for w in wins:
		out.append([w[0] + 1, w[1], w[2]])
	return out


# ================================================================ .sff（ドット絵）
class Sff:
	extends RefCounted
	var data: PackedByteArray
	var ver := 2
	var nodes := {}       # "g,i" -> 番号
	var v2 := []          # v2 のスプライト情報
	var pals := []        # v2 のパレット情報
	var ldata := 0
	var tdata := 0
	var v1 := []
	var v1_pal := {}
	var act = null        # v1 用の .act パレット
	var cache := {}

	func _init(path: String, act_pal = null) -> void:
		data = FileAccess.get_file_as_bytes(path)
		act = act_pal
		ver = data[15]
		if ver == 2:
			_index_v2()
		else:
			_index_v1()

	func _index_v2() -> void:
		var so := data.decode_u32(0x24)
		var ns := data.decode_u32(0x28)
		var po := data.decode_u32(0x2C)
		var np := data.decode_u32(0x30)
		ldata = data.decode_u32(0x34)
		tdata = data.decode_u32(0x3C)
		for i in range(np):
			var o := po + i * 16
			pals.append([data.decode_u16(o + 4), data.decode_u16(o + 6), data.decode_u32(o + 8), data.decode_u32(o + 12)])
		for i in range(ns):
			var o := so + i * 28
			var n := {"g": data.decode_u16(o), "i": data.decode_u16(o + 2), "w": data.decode_u16(o + 4), "h": data.decode_u16(o + 6),
				"ax": data.decode_s16(o + 8), "ay": data.decode_s16(o + 10), "link": data.decode_u16(o + 12),
				"fmt": data[o + 14], "off": data.decode_u32(o + 16), "len": data.decode_u32(o + 20),
				"pal": data.decode_u16(o + 24), "flags": data.decode_u16(o + 26)}
			v2.append(n)
			var key := "%d,%d" % [n.g, n.i]
			if not nodes.has(key):
				nodes[key] = i

	func _index_v1() -> void:
		var nimg := data.decode_u32(20)
		var off := data.decode_u32(24)
		for k in range(nimg):
			if off + 32 > data.size():
				break
			var n := {"start": off + 32, "len": data.decode_u32(off + 4), "x": data.decode_s16(off + 8),
				"y": data.decode_s16(off + 10), "g": data.decode_u16(off + 12), "i": data.decode_u16(off + 14),
				"link": data.decode_u16(off + 16), "same": data[off + 18]}
			v1.append(n)
			var key := "%d,%d" % [n.g, n.i]
			if not nodes.has(key):
				nodes[key] = k
			var nxt := data.decode_u32(off)
			if nxt == 0:
				break
			off = nxt

	func palette_v2(idx: int, depth := 0) -> PackedByteArray:
		## 256色 x RGBA
		var out := PackedByteArray()
		out.resize(1024)
		if idx >= pals.size() or depth > 8:
			return out
		var p: Array = pals[idx]
		if p[3] == 0:
			return palette_v2(p[1], depth + 1)
		var base: int = ldata + p[2]
		for k in range(min(p[0], 256)):
			out[k * 4] = data[base + k * 4]
			out[k * 4 + 1] = data[base + k * 4 + 1]
			out[k * 4 + 2] = data[base + k * 4 + 2]
			out[k * 4 + 3] = 255
		out[3] = 0   # 0番は透明
		return out

	func get_sprite(g: int, i: int):
		## [ImageTexture, 基準点x, 基準点y] または null
		var key := "%d,%d" % [g, i]
		if cache.has(key):
			return cache[key]
		var res = null
		if nodes.has(key):
			res = _decode_v2(nodes[key], 0) if ver == 2 else _decode_v1(nodes[key], 0)
		cache[key] = res
		return res

	func get_sprite_blend(g: int, i: int, tr: String):
		## 加算合成（AIR の A / AS..D.. や Explod の trans=add）の絵を、ふつうの半透明で近い見た目に直したもの
		if tr == "":
			return get_sprite(g, i)
		var key := "%d,%d,%s" % [g, i, tr]
		if cache.has(key):
			return cache[key]
		var base = get_sprite(g, i)
		var res = null
		if base != null:
			var src_k := 1.0
			var dst_k := 1.0
			var re := RegEx.create_from_string("AS(\\d+)D(\\d+)")
			var m := re.search(tr)
			if m:
				src_k = int(m.get_string(1)) / 256.0
				dst_k = int(m.get_string(2)) / 256.0
			elif tr.begins_with("A1"):
				src_k = 0.5
			var img: Image = base[0].get_image()
			if img != null:
				img = img.duplicate()
				img.convert(Image.FORMAT_RGBA8)
				for y in range(img.get_height()):
					for x in range(img.get_width()):
						var c := img.get_pixel(x, y)
						if c.a <= 0.0:
							continue
						var add := Color(c.r * src_k, c.g * src_k, c.b * src_k)
						var a: float = clamp(max(1.0 - dst_k, max(add.r, max(add.g, add.b))), 0.0, 1.0)
						if a <= 0.01:
							img.set_pixel(x, y, Color(0, 0, 0, 0))
						else:
							img.set_pixel(x, y, Color(min(1.0, add.r / a), min(1.0, add.g / a), min(1.0, add.b / a), a))
				res = [ImageTexture.create_from_image(img), base[1], base[2]]
		cache[key] = res
		return res

	func _decode_v2(idx: int, depth: int):
		var n: Dictionary = v2[idx]
		if (n.len == 0 or n.fmt == 1) and depth < 16 and n.link != idx:
			var r = _decode_v2(n.link, depth + 1)
			return null if r == null else [r[0], n.ax, n.ay]
		if n.w == 0 or n.h == 0:
			return null
		var base: int = tdata if (n.flags & 1) else ldata
		var raw := data.slice(base + n.off, base + n.off + n.len)
		var img: Image = null
		if n.fmt in [10, 11, 12]:
			img = Image.new()
			if img.load_png_from_buffer(raw.slice(4)) != OK:
				return null
			img.convert(Image.FORMAT_RGBA8)
		else:
			var size: int = n.w * n.h
			var pix: PackedByteArray
			match n.fmt:
				0:
					pix = raw.slice(0, size)
					pix.resize(size)
				2:
					pix = Mugen.rle8(raw.slice(4), size)
				3:
					pix = Mugen.rle5(raw.slice(4), size)
				4:
					pix = Mugen.lz5(raw.slice(4), size)
				_:
					return null
			img = Mugen.indexed_image(pix, n.w, n.h, palette_v2(n.pal))
		return [ImageTexture.create_from_image(img), n.ax, n.ay]

	func _decode_v1(k: int, depth: int):
		var n: Dictionary = v1[k]
		if n.len == 0 and depth < 16:
			var r = _decode_v1(n.link, depth + 1)
			return null if r == null else [r[0], n.x, n.y]
		var res := Mugen.pcx(data.slice(n.start, n.start + n.len), v1_pal.get(k - 1, act) if n.same else act)
		if res.is_empty():
			return null
		v1_pal[k] = res.pal
		var pal: PackedByteArray = act if (act != null and n.g != 9000) else res.pal
		return [ImageTexture.create_from_image(Mugen.indexed_image(res.pix, res.w, res.h, pal)), n.x, n.y]


static func indexed_image(pix: PackedByteArray, w: int, h: int, pal: PackedByteArray) -> Image:
	var rgba := PackedByteArray()
	rgba.resize(w * h * 4)
	for k in range(w * h):
		var c: int = pix[k]
		if c == 0:
			continue
		var o := k * 4
		rgba[o] = pal[c * 4]
		rgba[o + 1] = pal[c * 4 + 1]
		rgba[o + 2] = pal[c * 4 + 2]
		rgba[o + 3] = 255
	return Image.create_from_data(w, h, false, Image.FORMAT_RGBA8, rgba)


static func rle8(d: PackedByteArray, size: int) -> PackedByteArray:
	var out := PackedByteArray()
	out.resize(size)
	var i := 0
	var j := 0
	var n := d.size()
	while j < size and i < n:
		var b: int = d[i]
		i += 1
		if (b & 0xC0) == 0x40:
			var run := b & 0x3F
			var v: int = d[i] if i < n else 0
			i += 1
			for _k in range(run):
				if j < size:
					out[j] = v
					j += 1
		else:
			out[j] = b
			j += 1
	return out


static func rle5(d: PackedByteArray, size: int) -> PackedByteArray:
	var out := PackedByteArray()
	out.resize(size)
	var i := 0
	var j := 0
	var n := d.size()
	while j < size and i < n:
		var rl: int = d[i]
		i += 1
		if i >= n:
			break
		var dl: int = d[i] & 0x7F
		var c := 0
		if d[i] >> 7:
			i += 1
			c = d[i] if i < n else 0
		i += 1
		while true:
			if j < size:
				out[j] = c
				j += 1
			rl -= 1
			if rl < 0:
				dl -= 1
				if dl < 0 or i >= n:
					break
				c = d[i] & 0x1F
				rl = d[i] >> 5
				i += 1
	return out


static func lz5(d: PackedByteArray, size: int) -> PackedByteArray:
	var out := PackedByteArray()
	out.resize(size)
	var n := d.size()
	if n == 0:
		return out
	var i := 0
	var j := 0
	var ct: int = d[0]
	var cts := 0
	var rb := 0
	var rbc := 0
	i = 1 if n > 1 else 0
	while j < size:
		var b: int = d[i]
		if i < n - 1: i += 1
		if ct & (1 << cts):
			var cnt := 0
			var dist := 0
			if (b & 0x3F) == 0:
				dist = ((b << 2) | d[i]) + 1
				if i < n - 1: i += 1
				cnt = d[i] + 2
				if i < n - 1: i += 1
			else:
				rb |= (b & 0xC0) >> rbc
				rbc += 2
				cnt = b & 0x3F
				if rbc < 8:
					dist = d[i] + 1
					if i < n - 1: i += 1
				else:
					dist = rb + 1
					rb = 0
					rbc = 0
			while true:
				if j < size:
					out[j] = out[j - dist] if j - dist >= 0 else 0
					j += 1
				cnt -= 1
				if cnt < 0:
					break
		else:
			var cnt2 := 0
			var col := b
			if (b & 0xE0) == 0:
				cnt2 = d[i] + 8
				if i < n - 1: i += 1
			else:
				cnt2 = b >> 5
				col = b & 0x1F
			while cnt2 > 0:
				if j < size:
					out[j] = col
					j += 1
				cnt2 -= 1
		cts += 1
		if cts >= 8:
			ct = d[i]
			cts = 0
			if i < n - 1: i += 1
	return out


static func pcx(d: PackedByteArray, pal_prev) -> Dictionary:
	if d.size() < 128:
		return {}
	var w := d.decode_u16(8) - d.decode_u16(4) + 1
	var h := d.decode_u16(10) - d.decode_u16(6) + 1
	var bpl := d.decode_u16(66)
	if bpl == 0:
		bpl = w
	var raw := PackedByteArray()
	var need := bpl * h
	var i := 128
	while raw.size() < need and i < d.size():
		var b: int = d[i]
		i += 1
		if b >= 0xC0:
			var v: int = d[i] if i < d.size() else 0
			i += 1
			for _k in range(b & 0x3F):
				raw.append(v)
		else:
			raw.append(b)
	raw.resize(need)
	var pix := PackedByteArray()
	pix.resize(w * h)
	for y in range(h):
		for x in range(w):
			pix[y * w + x] = raw[y * bpl + x]
	var pal: PackedByteArray = pal_prev if pal_prev != null else PackedByteArray()
	if d.size() >= 769 and d[d.size() - 769] == 0x0C:
		pal = PackedByteArray()
		pal.resize(1024)
		var b0 := d.size() - 768
		for k in range(256):
			pal[k * 4] = d[b0 + k * 3]
			pal[k * 4 + 1] = d[b0 + k * 3 + 1]
			pal[k * 4 + 2] = d[b0 + k * 3 + 2]
			pal[k * 4 + 3] = 255
	if pal.size() < 1024:
		pal.resize(1024)
	return {"pix": pix, "w": w, "h": h, "pal": pal}


static func load_act(path: String) -> PackedByteArray:
	## MUGEN の .act は色の並びが逆順
	var raw := FileAccess.get_file_as_bytes(path)
	var pal := PackedByteArray()
	pal.resize(1024)
	for k in range(256):
		var s := (255 - k) * 3
		if s + 2 < raw.size():
			pal[k * 4] = raw[s]
			pal[k * 4 + 1] = raw[s + 1]
			pal[k * 4 + 2] = raw[s + 2]
			pal[k * 4 + 3] = 255
	return pal


# ================================================================ .snd（声・効果音）
static func parse_snd(path: String) -> Dictionary:
	## "g,s" -> AudioStreamWAV
	var d := FileAccess.get_file_as_bytes(path)
	var out := {}
	if d.size() < 24 or d.slice(0, 11).get_string_from_ascii() != "ElecbyteSnd":
		return out
	var off := d.decode_u32(20)
	var seen := 0
	while off > 0 and off + 16 <= d.size() and seen < 100000:
		var nxt := d.decode_u32(off)
		var ln := d.decode_u32(off + 4)
		var g := d.decode_u32(off + 8)
		var s := d.decode_u32(off + 12)
		var key := "%d,%d" % [g, s]
		if not out.has(key):
			var st := wav(d.slice(off + 16, off + 16 + ln))
			if st != null:
				out[key] = st
		seen += 1
		if nxt <= off:
			break
		off = nxt
	return out


static func wav(b: PackedByteArray) -> AudioStreamWAV:
	if b.size() < 44 or b.slice(0, 4).get_string_from_ascii() != "RIFF":
		return null
	var p := 12
	var ch := 1
	var rate := 22050
	var bits := 16
	var fmt := 1
	var data := PackedByteArray()
	while p + 8 <= b.size():
		var id := b.slice(p, p + 4).get_string_from_ascii()
		var sz := b.decode_u32(p + 4)
		if id == "fmt ":
			fmt = b.decode_u16(p + 8)
			ch = b.decode_u16(p + 10)
			rate = b.decode_u32(p + 12)
			bits = b.decode_u16(p + 22)
		elif id == "data":
			data = b.slice(p + 8, min(b.size(), p + 8 + sz))
		p += 8 + sz + (sz & 1)
	if fmt != 1 or data.is_empty():
		return null
	var st := AudioStreamWAV.new()
	st.mix_rate = rate
	st.stereo = ch == 2
	if bits == 8:
		for k in range(data.size()):
			data[k] = (data[k] ^ 0x80)   # WAV の 8bit は符号なし、Godot は符号つき
		st.format = AudioStreamWAV.FORMAT_8_BITS
	else:
		st.format = AudioStreamWAV.FORMAT_16_BITS
	st.data = data
	return st


# ================================================================ .cns（PlaySnd: どのアニメの何ティック目に何番の音）
static func parse_cns_cues(paths: Array, anims: Dictionary, fx_out = null) -> Dictionary:
	## アニメ番号 -> [{t, g, s, rnd, prob, on_hit}]
	## fx_out に辞書を渡すと、Explod（エフェクトの絵）も アニメ番号 -> [{t, anim, x, y, bind, keep} / {t, remove}] で入れる
	var by_state := {}
	var fx_state := {}
	var re_sd := RegEx.create_from_string("^\\[\\s*statedef\\s+(-?\\d+)")
	var re_anim := RegEx.create_from_string("^\\s*anim\\s*=\\s*(\\d+)\\s*$")
	var re_val := RegEx.create_from_string("^\\s*(s)?(\\d+)\\s*,\\s*(\\d+)\\s*(?:\\+\\s*random\\s*%\\s*(\\d+))?\\s*$")
	for p in paths:
		var txt := FileAccess.get_file_as_bytes(p).get_string_from_ascii()
		var sd := 0
		var sd_anim = null
		for block in ("\n" + txt).split("\n["):
			var lines := ("[" + block).split("\n")
			var head := lines[0].get_slice(";", 0).strip_edges().to_lower()
			var m := re_sd.search(head)
			if m:
				sd = int(m.get_string(1))
				sd_anim = sd
				for ln in lines.slice(1):
					var mm := re_anim.search(ln.get_slice(";", 0).to_lower())
					if mm:
						sd_anim = int(mm.get_string(1))
				continue
			if sd_anim == null or not head.begins_with("[state"):
				continue
			var kv := {}
			var trig := []
			for ln in lines.slice(1):
				var l2 := ln.get_slice(";", 0)
				if not "=" in l2:
					continue
				var k := l2.get_slice("=", 0).strip_edges().to_lower()
				var v := l2.substr(l2.find("=") + 1).strip_edges()
				if k == "triggerall" or k == "trigger1":
					trig.append(v)
				else:
					kv[k] = v
			var ty: String = kv.get("type", "").to_lower()
			if fx_out != null and (ty == "explod" or ty == "removeexplod"):
				var tke := _cue_tick(trig, sd_anim, anims)
				if tke.is_empty() or tke.on_hit:
					continue
				var e := {"t": tke.t}
				if ty == "removeexplod":
					e.remove = true
				else:
					var an_s: String = kv.get("anim", "").strip_edges()
					if not an_s.is_valid_int() or not anims.has(int(an_s)):
						continue   # F 付き（共通エフェクト）や式は使わない
					if not kv.get("postype", "p1").strip_edges().to_lower() in ["p1", ""]:
						continue
					var ps: PackedStringArray = str(kv.get("pos", "0,0")).split(",")
					e.anim = int(an_s)
					e.x = float(ps[0]) if ps.size() > 0 and ps[0].strip_edges().is_valid_float() else 0.0
					e.y = float(ps[1]) if ps.size() > 1 and ps[1].strip_edges().is_valid_float() else 0.0
					e.bind = kv.get("bindtime", "0").strip_edges() == "-1"
					e.keep = kv.get("removetime", "").strip_edges() == "-1"
					var tr: String = kv.get("trans", "").strip_edges().to_lower()
					e.add = tr.begins_with("add")
				if not fx_state.has(sd_anim):
					fx_state[sd_anim] = {}
				if not fx_state[sd_anim].has(sd):
					fx_state[sd_anim][sd] = []
				fx_state[sd_anim][sd].append(e)
				continue
			if ty != "playsnd":
				continue
			var mv := re_val.search(kv.get("value", "").to_lower())
			if mv == null:
				continue
			var tk := _cue_tick(trig, sd_anim, anims)
			if tk.is_empty():
				continue
			var cue := {"t": tk.t, "g": int(mv.get_string(2)), "s": int(mv.get_string(3)),
				"rnd": int(mv.get_string(4)) if mv.get_string(4) != "" else 0, "prob": tk.prob, "on_hit": tk.on_hit}
			if not by_state.has(sd_anim):
				by_state[sd_anim] = {}
			if not by_state[sd_anim].has(sd):
				by_state[sd_anim][sd] = []
			by_state[sd_anim][sd].append(cue)
	if fx_out != null:
		for an in fx_state:
			var sts: Dictionary = fx_state[an]
			fx_out[an] = sts.get(an, sts[sts.keys().min()])
	var cues := {}
	for an in by_state:
		var states: Dictionary = by_state[an]
		cues[an] = states.get(an, states[states.keys().min()])
	return cues


static func _frame_start(a, n: int) -> int:
	if a == null:
		return -1
	var t := 0
	for i in range(a.frames.size()):
		if i == n - 1:
			return t
		t += max(1, a.frames[i].t) if a.frames[i].t >= 0 else 0
	return -1


static func _cue_tick(conds: Array, anim_no: int, anims: Dictionary) -> Dictionary:
	var tick := -9999
	var prob := 1.0
	var on_hit := false
	var a = anims.get(anim_no)
	for c0 in conds:
		var c: String = c0.strip_edges().to_lower().replace(" ", "")
		if c == "!time" or c == "time=0":
			tick = 0
		elif c.begins_with("time=") and c.substr(5).is_valid_int():
			tick = int(c.substr(5))
		elif c.begins_with("animelem=") and c.substr(9).is_valid_int():
			tick = _frame_start(a, int(c.substr(9)))
			if tick < 0:
				return {}
		elif c.begins_with("animelemtime("):
			var nums := c.replace("animelemtime(", "").replace(")=", ",").split(",")
			if nums.size() != 2 or not nums[0].is_valid_int() or not nums[1].is_valid_int():
				return {}
			var st := _frame_start(a, int(nums[0]))
			if st < 0:
				return {}
			tick = st + int(nums[1])
		elif c.begins_with("anim=") and c.substr(5).is_valid_int():
			if int(c.substr(5)) != anim_no:
				return {}
		elif c.begins_with("random<=") and c.substr(8).is_valid_int():
			prob = (int(c.substr(8)) + 1) / 1000.0
		elif c in ["movehit", "movecontact", "movehit=1", "movecontact=1"]:
			on_hit = true
		elif c in ["1", "alive", "alive=1"]:
			pass
		else:
			return {}
	if on_hit and tick == -9999:
		tick = -1
	if tick == -9999:
		return {}
	return {"t": tick, "prob": prob, "on_hit": on_hit}
