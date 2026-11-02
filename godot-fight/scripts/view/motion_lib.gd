## Mixamo などのモーション（.fbx / .glb）を読み、どのモデルにも使える形（骨の向きの列）にしておく。
## 付け替え方: 元の骨の「向き」を毎フレーム取り出し、モデル側の同じ部位をその向きに向ける。
## T字（Mixamo）とA字（MMD）の初期姿勢の違いは、向きで合わせるので気にしなくてよい。
class_name MotionLib
extends RefCounted

const FPS := 30.0

# [元の骨, 元の子の骨, モデル側の役割, モデル側の子の役割]
const SEGMENTS := [
	["Spine", "Neck", "upper", "neck"],
	["Neck", "Head", "neck", "head"],
	["LeftShoulder", "LeftArm", "l_shoulder", "l_arm"],
	["LeftArm", "LeftForeArm", "l_arm", "l_elbow"],
	["LeftForeArm", "LeftHand", "l_elbow", "l_wrist"],
	["RightShoulder", "RightArm", "r_shoulder", "r_arm"],
	["RightArm", "RightForeArm", "r_arm", "r_elbow"],
	["RightForeArm", "RightHand", "r_elbow", "r_wrist"],
	["LeftUpLeg", "LeftLeg", "l_leg", "l_knee"],
	["LeftLeg", "LeftFoot", "l_knee", "l_ankle"],
	["LeftFoot", "LeftToeBase", "l_ankle", "l_toe"],
	["RightUpLeg", "RightLeg", "r_leg", "r_knee"],
	["RightLeg", "RightFoot", "r_knee", "r_ankle"],
	["RightFoot", "RightToeBase", "r_ankle", "r_toe"],
]

# ファイル名 → 使い道（上から順に判定。ファイル名がそのまま使い道の名前ならそれを優先）
const SLOT_KEYWORDS := [
	["land", ["landing", "land"]], ["fall", ["falling", "fall"]], ["hang", ["hang"]], ["climb", ["climb"]],
	["crouch", ["crouch"]], ["block", ["block", "guard"]], ["getup", ["gettingup", "standup", "getup"]],
	["knockdown", ["knock", "death"]], ["hit", ["hit", "reaction"]], ["roll", ["roll", "dodg"]],
	["uppercut", ["uppercut"]], ["sweep", ["sweep"]], ["flykick", ["flyingkick", "flykick"]], ["flip", ["flip"]],
	["kick", ["kick"]], ["jab", ["jab"]], ["smash", ["hook", "cross", "smash"]], ["jab", ["punch"]],
	["throw", ["throw"]], ["magic", ["magic", "fireball", "spell"]], ["victory", ["victory", "taunt", "cheer"]],
	["jump", ["jump"]], ["run", ["run"]], ["walk", ["walk"]], ["idle", ["idle"]],
]

static var _clips = null   # 使い道 -> クリップ


static func motion_dir() -> String:
	return Chars.model_dir().path_join("_motions")


static func clips() -> Dictionary:
	if _clips != null:
		return _clips
	_clips = {}
	var dir := motion_dir()
	if not DirAccess.dir_exists_absolute(dir):
		return _clips
	var files := Array(DirAccess.get_files_at(dir))
	files.sort()
	for fn in files:
		var ext: String = fn.get_extension().to_lower()
		if ext != "fbx" and ext != "glb" and ext != "gltf":
			continue
		var slot := slot_for(fn.get_basename())
		if slot == "" or (_clips.has(slot) and _clips[slot].exact):
			continue
		var c := load_clip(dir.path_join(fn))
		if c.is_empty():
			continue
		c.exact = fn.get_basename().to_lower() == slot
		c.file = fn
		_clips[slot] = c
	return _clips


static func slot_for(base: String) -> String:
	var key := base.to_lower().replace(" ", "").replace("_", "").replace("-", "")
	for sk in SLOT_KEYWORDS:
		if key == sk[0]:
			return sk[0]
	for sk in SLOT_KEYWORDS:
		for kw in sk[1]:
			if key.contains(kw):
				return sk[0]
	return ""


static func _short(bone: String) -> String:
	var n := bone.get_slice(":", bone.get_slice_count(":") - 1)
	if n.begins_with("mixamorig_"):
		n = n.substr(10)
	elif n.begins_with("mixamorig"):
		n = n.substr(9)
	return n


static func load_clip(path: String) -> Dictionary:
	var scene: Node = null
	if path.get_extension().to_lower() == "fbx":
		var doc := FBXDocument.new()
		var st := FBXState.new()
		if doc.append_from_file(path, st) != OK:
			return {}
		scene = doc.generate_scene(st)
	else:
		var doc := GLTFDocument.new()
		var st := GLTFState.new()
		if doc.append_from_file(path, st) != OK:
			return {}
		scene = doc.generate_scene(st)
	if scene == null:
		return {}
	var sk := _find(scene, "Skeleton3D") as Skeleton3D
	var ap := _find(scene, "AnimationPlayer") as AnimationPlayer
	if sk == null or ap == null:
		scene.free()
		return {}
	var anim: Animation = null
	for n in ap.get_animation_list():
		var a := ap.get_animation(n)
		if a.get_track_count() > 0 and (anim == null or a.get_track_count() > anim.get_track_count()):
			anim = a
	if anim == null:
		scene.free()
		return {}
	# 骨: 短い名前 -> 番号
	var ix := {}
	for i in range(sk.get_bone_count()):
		ix[_short(sk.get_bone_name(i))] = i
	# トラック: 骨番号 -> [回転トラック, 位置トラック]
	var tr := {}
	for t in range(anim.get_track_count()):
		var p := String(anim.track_get_path(t))
		var bone := _short(p.get_slice(":", p.get_slice_count(":") - 1))
		if not ix.has(bone):
			continue
		var b: int = ix[bone]
		if not tr.has(b):
			tr[b] = [-1, -1]
		match anim.track_get_type(t):
			Animation.TYPE_ROTATION_3D:
				tr[b][0] = t
			Animation.TYPE_POSITION_3D:
				tr[b][1] = t
	var hips: int = ix.get("Hips", 0)
	var rest_g := _globals(sk, anim, tr, -1.0)
	var hips_h: float = max(0.01, rest_g[hips].origin.y)
	var frames := []
	var n := int(ceil(anim.length * FPS))
	for k in range(max(1, n)):
		var g := _globals(sk, anim, tr, k / FPS)
		var fr := {"dirs": {}}
		for seg in SEGMENTS:
			if ix.has(seg[0]) and ix.has(seg[1]):
				var d: Vector3 = g[ix[seg[1]]].origin - g[ix[seg[0]]].origin
				if d.length() > 0.0001:
					fr.dirs[seg[2]] = d.normalized()
		fr.hips_rot = (g[hips].basis * rest_g[hips].basis.inverse()).get_rotation_quaternion()
		fr.hips_off = (g[hips].origin - rest_g[hips].origin) / hips_h
		if ix.has("Head"):
			var hb: int = ix["Head"]
			fr.head_rot = (g[hb].basis * rest_g[hb].basis.inverse()).get_rotation_quaternion()
		frames.append(fr)
	scene.free()
	return {"frames": frames, "length": anim.length, "loop": anim.loop_mode != Animation.LOOP_NONE}


static func _globals(sk: Skeleton3D, anim: Animation, tr: Dictionary, t: float) -> Array:
	## t < 0 なら初期姿勢（レスト）
	var g := []
	g.resize(sk.get_bone_count())
	for i in _order(sk):
		var rest := sk.get_bone_rest(i)
		var q := rest.basis.get_rotation_quaternion()
		var o := rest.origin
		if t >= 0 and tr.has(i):
			if tr[i][0] >= 0:
				q = anim.rotation_track_interpolate(tr[i][0], t)
			if tr[i][1] >= 0:
				o = anim.position_track_interpolate(tr[i][1], t)
		var local := Transform3D(Basis(q), o)
		var p := sk.get_bone_parent(i)
		g[i] = (g[p] * local) if p >= 0 else local
	return g


static func _order(sk: Skeleton3D) -> Array:
	## 親が先に来る順番
	var out := []
	var todo := Array(sk.get_parentless_bones())
	while not todo.is_empty():
		var b: int = todo.pop_front()
		out.append(b)
		todo.append_array(Array(sk.get_bone_children(b)))
	return out


static func _find(n: Node, cls: String) -> Node:
	if n.get_class() == cls:
		return n
	for c in n.get_children():
		var r := _find(c, cls)
		if r != null:
			return r
	return null
