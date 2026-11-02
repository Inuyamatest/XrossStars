## MMD の .pmx（2.0/2.1）を、Blender なしでそのまま読み込んで Godot のノードにする。
## 読むもの: 頂点・面・テクスチャ・材質・ボーン（スキニング込み）。物理・モーフはまだ読まない。
class_name PmxLoader
extends RefCounted

const SCALE := 0.08   # MMD の1単位 ≒ 8cm

var buf: PackedByteArray
var pos := 0
var utf16 := true
var add_vec4 := 0
var vsize := 4
var tsize := 4
var msize := 4
var bsize := 4
var error := ""


static func load_model(path: String) -> Dictionary:
	## 戻り値: {"root": Node3D, "skeleton": Skeleton3D, "bones": {名前: index}, "height": float, "info": String}
	var l := PmxLoader.new()
	return l._load(path)


# ------------------------------------------------------------ 低レベル読み取り
func u8() -> int:
	pos += 1
	return buf[pos - 1]


func i32() -> int:
	var v := buf.decode_s32(pos)
	pos += 4
	return v


func f32() -> float:
	var v := buf.decode_float(pos)
	pos += 4
	return v


func v2() -> Vector2:
	return Vector2(f32(), f32())


func v3() -> Vector3:
	return Vector3(f32(), f32(), f32())


func v4() -> Vector4:
	return Vector4(f32(), f32(), f32(), f32())


func text() -> String:
	var n := i32()
	var s := ""
	if n > 0:
		var b := buf.slice(pos, pos + n)
		s = b.get_string_from_utf16() if utf16 else b.get_string_from_utf8()
	pos += n
	return s


func idx(size: int, unsigned := false) -> int:
	## 頂点インデックスは符号なし、それ以外は符号つき（-1 = なし）
	var v := 0
	match size:
		1:
			v = buf.decode_u8(pos) if unsigned else buf.decode_s8(pos)
		2:
			v = buf.decode_u16(pos) if unsigned else buf.decode_s16(pos)
		_:
			v = buf.decode_s32(pos)
	pos += size
	return v


# ------------------------------------------------------------ 本体
func _load(path: String) -> Dictionary:
	buf = FileAccess.get_file_as_bytes(path)
	if buf.size() < 20 or buf.slice(0, 4).get_string_from_ascii() != "PMX ":
		return {"error": "PMX ファイルではありません: " + path}
	pos = 8
	var nglob := u8()
	var g := buf.slice(pos, pos + nglob)
	pos += nglob
	utf16 = g[0] == 0
	add_vec4 = g[1]
	vsize = g[2]
	tsize = g[3]
	msize = g[4]
	bsize = g[5]
	var name := text()
	text()
	var comment := text()
	text()

	# 頂点
	var nv := i32()
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var uvs := PackedVector2Array()
	var bones := PackedInt32Array()
	var weights := PackedFloat32Array()
	verts.resize(nv)
	norms.resize(nv)
	uvs.resize(nv)
	bones.resize(nv * 4)
	weights.resize(nv * 4)
	for i in range(nv):
		var p := v3()
		var n := v3()
		verts[i] = Vector3(p.x, p.y, -p.z) * SCALE   # 左手系 → 右手系（Z反転）
		norms[i] = Vector3(n.x, n.y, -n.z)
		uvs[i] = v2()
		pos += 16 * add_vec4
		var wt := u8()
		var bi := [0, 0, 0, 0]
		var bw := [0.0, 0.0, 0.0, 0.0]
		match wt:
			0:
				bi[0] = idx(bsize)
				bw[0] = 1.0
			1:
				bi[0] = idx(bsize)
				bi[1] = idx(bsize)
				bw[0] = f32()
				bw[1] = 1.0 - bw[0]
			2, 4:
				for k in range(4):
					bi[k] = idx(bsize)
				for k in range(4):
					bw[k] = f32()
			3:
				bi[0] = idx(bsize)
				bi[1] = idx(bsize)
				bw[0] = f32()
				bw[1] = 1.0 - bw[0]
				pos += 36   # SDEF の C, R0, R1 は使わない
		f32()  # エッジ倍率
		var tot := 0.0
		for k in range(4):
			if bi[k] < 0:
				bi[k] = 0
				bw[k] = 0.0
			tot += bw[k]
		for k in range(4):
			bones[i * 4 + k] = bi[k]
			weights[i * 4 + k] = bw[k] / tot if tot > 0 else (1.0 if k == 0 else 0.0)

	# 面（3つで1枚）
	var nf := i32()
	var faces := PackedInt32Array()
	faces.resize(nf)
	for i in range(nf):
		faces[i] = idx(vsize, true)

	# テクスチャ
	var nt := i32()
	var texpaths := []
	for i in range(nt):
		texpaths.append(text())

	# 材質
	var nm := i32()
	var mats := []
	for i in range(nm):
		var m := {}
		m.name = text()
		text()
		m.diffuse = v4()
		v3(); f32(); v3()   # スペキュラ・環境色（使わない）
		m.flags = u8()
		v4(); f32()         # エッジ色・太さ
		m.tex = idx(tsize)
		idx(tsize)          # スフィア
		u8()
		var shared_toon := u8()
		if shared_toon == 0:
			idx(tsize)
		else:
			u8()
		text()
		m.count = i32()
		mats.append(m)

	# ボーン
	var nb := i32()
	var bdefs := []
	for i in range(nb):
		var b := {}
		b.name = text()
		text()
		var bp := v3()
		b.pos = Vector3(bp.x, bp.y, -bp.z) * SCALE
		b.parent = idx(bsize)
		i32()
		var fl := buf.decode_u16(pos)
		pos += 2
		if fl & 0x0001:
			idx(bsize)
		else:
			v3()
		b.inherit = -1
		b.inherit_w = 0.0
		if fl & 0x0300:
			var src := idx(bsize)
			var wgt := f32()
			if fl & 0x0100:   # 回転付与（足D・腕捩などが元のボーンの回転をまねる）
				b.inherit = src
				b.inherit_w = wgt
		if fl & 0x0400:
			v3()
		if fl & 0x0800:
			v3(); v3()
		if fl & 0x2000:
			i32()
		if fl & 0x0020:
			idx(bsize)
			i32()
			f32()
			var nl := i32()
			for k in range(nl):
				idx(bsize)
				if u8() == 1:
					v3(); v3()
		bdefs.append(b)

	return _build(path, name, comment, verts, norms, uvs, bones, weights, faces, texpaths, mats, bdefs)


# ------------------------------------------------------------ Godot のノードに組み立て
func _build(path: String, name: String, comment: String, verts, norms, uvs, bones, weights, faces, texpaths, mats, bdefs) -> Dictionary:
	var root := Node3D.new()
	root.name = "PMX"
	var skel := Skeleton3D.new()
	skel.name = "Skeleton"
	root.add_child(skel)
	var bone_ix := {}
	for i in range(bdefs.size()):
		skel.add_bone(bdefs[i].name)
		bone_ix[bdefs[i].name] = i
	for i in range(bdefs.size()):
		var p: int = bdefs[i].parent
		var lp: Vector3 = bdefs[i].pos
		if p >= 0 and p < bdefs.size() and p != i:
			skel.set_bone_parent(i, p)
			lp = bdefs[i].pos - bdefs[p].pos
		skel.set_bone_rest(i, Transform3D(Basis(), lp))
	skel.reset_bone_poses()
	var skin := Skin.new()
	for i in range(bdefs.size()):
		skin.add_named_bind(bdefs[i].name, Transform3D(Basis(), -bdefs[i].pos))

	var dir := path.get_base_dir()
	var tex_cache := {}
	var mesh := ArrayMesh.new()
	var start := 0
	for m in mats:
		var cnt: int = m.count
		if cnt <= 0:
			continue
		var idxs := PackedInt32Array()
		idxs.resize(cnt)
		for k in range(0, cnt, 3):
			# MMD（左手系・時計回りが表）を Z 反転すると、Godot の表（時計回り）とそのまま一致する
			idxs[k] = faces[start + k]
			idxs[k + 1] = faces[start + k + 1]
			idxs[k + 2] = faces[start + k + 2]
		start += cnt
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = verts
		arr[Mesh.ARRAY_NORMAL] = norms
		arr[Mesh.ARRAY_TEX_UV] = uvs
		arr[Mesh.ARRAY_BONES] = bones
		arr[Mesh.ARRAY_WEIGHTS] = weights
		arr[Mesh.ARRAY_INDEX] = idxs
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		var dcol: Vector4 = m.diffuse
		var has_alpha := dcol.w < 0.999
		var tex: ImageTexture = null
		if m.tex >= 0 and m.tex < texpaths.size():
			var tp: String = texpaths[m.tex]
			if not tex_cache.has(tp):
				tex_cache[tp] = _load_tex(dir, tp)
			tex = tex_cache[tp]
			if tex != null and tex.get_image().detect_alpha() != Image.ALPHA_NONE:
				has_alpha = true
		var col := Color(1, 1, 1, dcol.w) if tex != null else Color(dcol.x, dcol.y, dcol.z, dcol.w)
		# 輪郭線は MMD の「エッジ」フラグ(0x10)がある材質だけ
		var mat := Toon.material(col, tex, has_alpha, (m.flags & 0x10) != 0)
		mesh.surface_set_material(mesh.get_surface_count() - 1, mat)
	var mi := MeshInstance3D.new()
	mi.name = "Mesh"
	mi.mesh = mesh
	skel.add_child(mi)
	mi.skin = skin
	mi.skeleton = NodePath("..")
	var top := 0.0
	for v in verts:
		top = max(top, v.y)
	var tris := 0
	for m in mats:
		tris += int(m.count) / 3
	var inherits := []
	for i in range(bdefs.size()):
		if bdefs[i].inherit >= 0 and bdefs[i].inherit < bdefs.size():
			inherits.append([i, bdefs[i].inherit, bdefs[i].inherit_w])
	return {"root": root, "skeleton": skel, "bones": bone_ix, "bone_pos": bdefs.map(func(b): return b.pos),
		"inherits": inherits,
		"height": top, "name": name, "info": "%s: 頂点%d / ポリゴン%d / 材質%d / ボーン%d / テクスチャ%d" % [
			name, verts.size(), tris, mats.size(), bdefs.size(), texpaths.size()]}


static func _load_tex(dir: String, rel: String) -> ImageTexture:
	var p := rel.replace("\\", "/")
	var full := dir.path_join(p)
	if not FileAccess.file_exists(full):
		# 大文字小文字違い対策
		var d := DirAccess.open(full.get_base_dir())
		if d == null:
			return null
		for f in d.get_files():
			if f.to_lower() == full.get_file().to_lower():
				full = full.get_base_dir().path_join(f)
				break
	var img := Image.load_from_file(full)
	if img == null or img.is_empty():
		return null
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)
