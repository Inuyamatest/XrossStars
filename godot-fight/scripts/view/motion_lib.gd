## モーション（Mixamo の .fbx、Quaternius Universal Animation Library の .glb など）を読み、
## どのモデルにも使える形（骨の向きの列）にしておく。
## 付け替え方: 元の骨の「向き」を毎フレーム取り出し、モデル側の同じ部位をその向きに向ける。
## T字（Mixamo）とA字（MMD）の初期姿勢の違いは、向きで合わせるので気にしなくてよい。
##
## 読む場所:
##   res://assets/animations/*.glb … 同梱の CC0 モーション集（1ファイルに複数のアニメ）
##   characters/_motions/*        … 各自で置くモーション（Mixamo など。gitには入れない）
class_name MotionLib
extends RefCounted

const FPS := 30.0
const BUILTIN_DIR := "res://assets/animations/"

# [元の骨, 元の子の骨, モデル側の役割, モデル側の子の役割]（骨の名前は Mixamo 式にそろえてから使う）
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

# Unreal マネキン式（Quaternius UAL など）→ Mixamo 式
const UE_BONES := {
	"pelvis": "Hips", "spine_01": "Spine", "spine_02": "Spine1", "spine_03": "Spine2", "neck_01": "Neck", "head": "Head",
	"clavicle_l": "LeftShoulder", "upperarm_l": "LeftArm", "lowerarm_l": "LeftForeArm", "hand_l": "LeftHand",
	"clavicle_r": "RightShoulder", "upperarm_r": "RightArm", "lowerarm_r": "RightForeArm", "hand_r": "RightHand",
	"thigh_l": "LeftUpLeg", "calf_l": "LeftLeg", "foot_l": "LeftFoot", "ball_l": "LeftToeBase",
	"thigh_r": "RightUpLeg", "calf_r": "RightLeg", "foot_r": "RightFoot", "ball_r": "RightToeBase",
}

# 使い道 → 候補のアニメ名（小文字。上から順に、あるものを使う）
const SLOT_CLIPS := {
	"idle": ["fighting idle", "idle", "idle_loop"],
	"walk": ["walk", "walk_loop"],
	"run": ["run", "sprint_loop", "jog_fwd_loop"],
	"crouch": ["crouch", "crouch_idle_loop"],
	"jump": ["ninjajump_start", "jump_start", "jump"],
	"fall": ["fall", "ninjajump_idle_loop", "jump_loop"],
	"land": ["land", "ninjajump_land", "jump_land"],
	"jab": ["jab", "punch_jab"],
	"jab2": ["punch_cross"],
	"hook": ["smash", "melee_hook"],
	"kick": ["kick"],
	"uppercut": ["uppercut"],
	"sweep": ["sweep", "slide_start"],
	"flykick": ["flykick", "shield_dash"],
	"flip": ["flip"],
	"swing": ["sword_regular_a"],
	"swing2": ["sword_regular_b"],
	"heavy": ["sword_attack", "sword_regular_c"],
	"throw": ["throw", "overhandthrow"],
	"magic": ["magic", "spell_simple_shoot"],
	"hit": ["hit", "hit_chest"],
	"hit2": ["hit_head"],
	"knockback": ["hit_knockback"],
	"knockdown": ["knockdown", "death01"],
	"getup": ["getup", "laytoidle"],
	"roll": ["roll"],
	"block": ["block", "sword_block", "idle_shield_loop"],
	"shieldbreak": ["idle_shield_break"],
	"climb": ["climb", "climbup_1m"],
	"hang": ["hang"],
	"victory": ["victory", "dance_loop", "yes"],
	"carry": ["walk_carry_loop"],
	"awaken": ["spell_simple_enter", "victory"],
}

# 1ファイル1アニメ（Mixamo など）は、ファイル名の単語から使い道を推測する
const SLOT_KEYWORDS := [
	["land", ["landing", "land"]], ["fall", ["falling", "fall"]], ["hang", ["hang"]], ["climb", ["climb"]],
	["crouch", ["crouch"]], ["block", ["block", "guard"]], ["getup", ["gettingup", "standup", "getup"]],
	["knockdown", ["knock", "death"]], ["hit", ["hit", "reaction"]], ["roll", ["roll", "dodg"]],
	["uppercut", ["uppercut"]], ["sweep", ["sweep"]], ["flykick", ["flyingkick", "flykick"]], ["flip", ["flip"]],
	["kick", ["kick"]], ["jab", ["jab"]], ["smash", ["hook", "cross", "smash"]], ["jab", ["punch"]],
	["throw", ["throw"]], ["magic", ["magic", "fireball", "spell"]], ["victory", ["victory", "taunt", "cheer"]],
	["jump", ["jump"]], ["run", ["run"]], ["walk", ["walk"]], ["idle", ["idle"]],
]

static var _index = null    # アニメ名(小文字) -> [Skeleton3D, Animation]
static var _keep: Array = []  # 読み込んだシーン（Skeleton を生かしておく）
static var _baked := {}     # アニメ名 -> クリップ
static var _slot_cache := {}


static func motion_dir() -> String:
	return Chars.model_dir().path_join("_motions")


# ------------------------------------------------------------ 読み込み・索引
static func _ensure_index() -> void:
	if _index != null:
		return
	_index = {}
	# 同梱（インポート済みのシーンとして読む。書き出した exe でも動く）
	if DirAccess.dir_exists_absolute(BUILTIN_DIR):
		for fn in DirAccess.get_files_at(BUILTIN_DIR):
			if fn.get_extension().to_lower() in ["glb", "gltf", "fbx"]:
				var ps = load(BUILTIN_DIR + fn)
				if ps is PackedScene:
					_add_scene(ps.instantiate(), fn.get_basename())
	# 各自のモーション（実行時に読む）
	var dir := motion_dir()
	if DirAccess.dir_exists_absolute(dir):
		var files := Array(DirAccess.get_files_at(dir))
		files.sort()
		for fn in files:
			var ext: String = fn.get_extension().to_lower()
			var scene: Node = null
			if ext == "fbx":
				var doc := FBXDocument.new()
				var st := FBXState.new()
				if doc.append_from_file(dir.path_join(fn), st) == OK:
					scene = doc.generate_scene(st)
			elif ext == "glb" or ext == "gltf":
				var doc2 := GLTFDocument.new()
				var st2 := GLTFState.new()
				if doc2.append_from_file(dir.path_join(fn), st2) == OK:
					scene = doc2.generate_scene(st2)
			if scene != null:
				_add_scene(scene, fn.get_basename())


static func _add_scene(scene: Node, file_base: String) -> void:
	var sk := _find(scene, "Skeleton3D") as Skeleton3D
	var ap := _find(scene, "AnimationPlayer") as AnimationPlayer
	if sk == null or ap == null:
		scene.free()
		return
	_keep.append(scene)
	var real := []
	for n in ap.get_animation_list():
		var a := ap.get_animation(n)
		if a.get_track_count() > 0:
			real.append([String(n), a])
	if real.size() == 1:
		# 1ファイル1アニメ: ファイル名で登録し、単語から使い道も推測
		var nm := file_base.to_lower()
		_index[nm] = [sk, real[0][1]]
		var slot := slot_for(file_base)
		if slot != "" and not _index.has(slot):
			_index[slot] = [sk, real[0][1]]
	else:
		for r in real:
			var nm2: String = r[0].get_slice("/", r[0].get_slice_count("/") - 1).to_lower()
			if not _index.has(nm2):
				_index[nm2] = [sk, r[1]]


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


static func clip(slot: String) -> Dictionary:
	## 使い道の名前から、使えるクリップを返す（無ければ空）
	if _slot_cache.has(slot):
		return _slot_cache[slot]
	_ensure_index()
	var res := {}
	var names := []
	for nm in SLOT_CLIPS.get(slot, [slot]):
		names.append(nm)
		# Godot はインポート時に「_Loop」で終わるアニメ名からその部分を外してループ扱いにする
		if nm.ends_with("_loop"):
			names.append(nm.trim_suffix("_loop"))
	for nm in names:
		if _index.has(nm):
			if not _baked.has(nm):
				_baked[nm] = _bake(_index[nm][0], _index[nm][1])
			res = _baked[nm]
			if not res.is_empty():
				res.name = nm
				break
	_slot_cache[slot] = res
	return res


static func available() -> Array:
	_ensure_index()
	return _index.keys()


static func canon(bone: String) -> String:
	var n := bone.get_slice(":", bone.get_slice_count(":") - 1)
	if n.begins_with("mixamorig_"):
		n = n.substr(10)
	elif n.begins_with("mixamorig"):
		n = n.substr(9)
	return UE_BONES.get(n.to_lower(), n)


# ------------------------------------------------------------ 焼き込み（毎フレームの骨の向き）
static func _bake(sk: Skeleton3D, anim: Animation) -> Dictionary:
	var ix := {}
	for i in range(sk.get_bone_count()):
		ix[canon(sk.get_bone_name(i))] = i
	if not ix.has("Hips"):
		return {}
	var tr := {}
	for t in range(anim.get_track_count()):
		var p := String(anim.track_get_path(t))
		var bone := canon(p.get_slice(":", p.get_slice_count(":") - 1))
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
	var order := _order(sk)
	var hips: int = ix["Hips"]
	var rest_g := _globals(sk, anim, tr, -1.0, order)
	var hips_h: float = max(0.01, rest_g[hips].origin.y)
	var frames := []
	var n := int(ceil(anim.length * FPS))
	for k in range(max(1, n)):
		var g := _globals(sk, anim, tr, k / FPS, order)
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
	return {"frames": frames, "length": anim.length, "loop": anim.loop_mode != Animation.LOOP_NONE}


static func _globals(sk: Skeleton3D, anim: Animation, tr: Dictionary, t: float, order: Array) -> Array:
	## t < 0 なら初期姿勢（レスト）
	var g := []
	g.resize(sk.get_bone_count())
	for i in order:
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
