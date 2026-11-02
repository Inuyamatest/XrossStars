## 読み込んだモデル（いまは PMX）を表示し、仮人形と同じ手続きアニメのポーズで骨を動かす。
## Mixamo のモーションを入れたら、ここをモーション再生に置き換える（骨の対応付けはそのまま使う）。
class_name ModelView
extends Puppet

# MMD の標準ボーン名
const B := {
	"center": "センター", "upper": "上半身", "upper2": "上半身2", "lower": "下半身", "neck": "首", "head": "頭",
	"l_arm": "左腕", "l_elbow": "左ひじ", "l_wrist": "左手首", "r_arm": "右腕", "r_elbow": "右ひじ", "r_wrist": "右手首",
	"l_leg": "左足", "l_knee": "左ひざ", "l_ankle": "左足首", "r_leg": "右足", "r_knee": "右ひざ", "r_ankle": "右足首",
	"l_shoulder": "左肩", "r_shoulder": "右肩", "l_toe": "左つま先", "r_toe": "右つま先",
}

# ワザ → モーションの使い道（左から順に、あるものを使う。無ければ手続きアニメ）
const MOVE_SLOTS := {
	"jab": ["jab"], "jab2": ["jab2", "jab"], "jab3": ["hook", "kick"], "ftilt": ["kick", "hook", "swing"],
	"utilt": ["uppercut", "swing2"], "dtilt": ["sweep"], "dash": ["flykick"], "fsmash": ["heavy", "hook"],
	"usmash": ["uppercut", "swing2"], "dsmash": ["sweep"], "nair": ["flip"], "fair": ["flykick", "hook"],
	"bair": ["kick"], "uair": ["flip", "swing2"], "dair": ["kick"], "grab": ["jab2"], "dashgrab": ["jab2"],
	"fthrow": ["throw"], "bthrow": ["throw"], "uthrow": ["throw"], "dthrow": ["throw"],
	"ledgeatk": ["kick", "swing"], "getupatk": ["sweep"], "nspecial": ["magic"], "sspecial": ["flykick"],
	"uspecial": ["uppercut", "swing2"], "dspecial": ["heavy"], "dspecial_air": ["kick"], "d_land": ["heavy"],
}
const STATE_SLOTS := {
	"stand": ["idle"], "walk": ["walk"], "run": ["run"], "crouch": ["crouch"], "jumpsquat": ["crouch"],
	"rise": ["jump"], "fall": ["fall"], "land": ["land"], "shield": ["block"], "hit": ["hit", "hit2"],
	"tumble": ["knockback"], "down": ["knockdown"], "ledge": ["hang"], "climb": ["climb"], "roll": ["roll"],
	"awaken": ["awaken"], "respawn": ["idle"], "grabbed": ["hit"], "hold": ["carry"], "dizzy": ["shieldbreak", "hit"],
}


var model := {}
var skel: Skeleton3D
var root3d: Node3D
var bi := {}         # 役割 -> ボーン番号
var rest_pos := []   # ボーン番号 -> 初期位置（モデル座標）
var mscale := 1.0
var mesh_inst: MeshInstance3D
var _overlay: StandardMaterial3D
var cur_key := ""
var cur_start := 0
var hip_h := 1.0


func setup(fighter: Fighter) -> void:
	f = fighter
	model = PmxLoader.load_model(f.ch.model)
	if model.has("error"):
		push_error(model.error)
		super.setup(fighter)   # 読めなければ仮人形で出す
		return
	root3d = model.root
	add_child(root3d)
	skel = model.skeleton
	rest_pos = model.bone_pos
	mesh_inst = skel.get_node("Mesh")
	for k in B:
		bi[k] = model.bones.get(B[k], -1)
	mscale = (f.h * K * 1.08) / max(0.1, model.height)
	if bi.l_leg >= 0:
		hip_h = max(0.1, rest_pos[bi.l_leg].y)
	root3d.scale = Vector3.ONE * mscale
	_build_overlays()


func refresh() -> void:
	if root3d == null:
		super.refresh()
		return
	visible = f.alive() and not f.hidden
	if not visible:
		return
	var p := compute_pose()
	var sc := f.h / 84.0
	var face := f.face
	# 体の向き: 進行方向を向きつつ、少しカメラ側へ
	var yaw := deg_to_rad(68.0) * face
	var rot: float = p.rot
	var pv: Vector2 = p.pivot
	var pivot := Vector3(0, -pv.y * sc * K, 0)
	var shake := 0.0
	if f.shake > 0:
		shake = (1 if f.anim % 2 == 0 else -1) * min(6, f.shake) * K
	var t := Transform3D(Basis(), Vector3(f.x * K + shake, -f.y * K, 0))
	t = t * Transform3D(Basis(), pivot) * Transform3D(Basis(Vector3.BACK, -rot * face), Vector3.ZERO) * Transform3D(Basis(), -pivot)
	t = t * Transform3D(Basis(Vector3.UP, yaw).scaled(Vector3.ONE * mscale), Vector3.ZERO)
	root3d.transform = t

	skel.reset_bone_poses()
	if _play_motion():
		_finish(p)
		return
	# 沈み込み（しゃがみ・着地など）はセンターを下げる
	if bi.center >= 0:
		var drop: float = p.drop * sc * K / mscale
		skel.set_bone_pose_position(bi.center, skel.get_bone_rest(bi.center).origin + Vector3(0, -drop, 0))
	if bi.upper >= 0:
		skel.set_bone_pose_rotation(bi.upper, Quaternion(Vector3.RIGHT, atan2(p.lean, 22.0)))
	# 手前の手足 = カメラ側（右を向いているときは右手足）
	var front := "r" if face > 0 else "l"
	var back := "l" if face > 0 else "r"
	var shoulder := Vector2(p.lean, -46)
	var hip := Vector2(p.lean * 0.3, -26)
	_aim_limb(front + "_arm", front + "_elbow", front + "_wrist", shoulder, p.hf, 24.0, 1)
	_aim_limb(back + "_arm", back + "_elbow", back + "_wrist", shoulder, p.hb, 24.0, 1)
	_aim_limb(front + "_leg", front + "_knee", front + "_ankle", hip, p.ff, 28.0, -1)
	_aim_limb(back + "_leg", back + "_knee", back + "_ankle", hip, p.fb, 28.0, -1)
	_finish(p)


func _finish(p: Dictionary) -> void:
	# 回転付与（足D・腕捩など）
	for inh in model.inherits:
		var q := skel.get_bone_pose_rotation(inh[1])
		skel.set_bone_pose_rotation(inh[0], Quaternion.IDENTITY.slerp(q, inh[2]))
	var alpha := 0.45 if p.fade else 1.0
	mesh_inst.transparency = 1.0 - alpha
	mesh_inst.material_overlay = _flash_mat() if p.flash else null
	_update_overlays()


func _global_rot(b: int) -> Quaternion:
	var q := Quaternion.IDENTITY
	var chain := []
	var i := b
	while i >= 0:
		chain.push_front(i)
		i = skel.get_bone_parent(i)
	for c in chain:
		q = q * skel.get_bone_pose_rotation(c)
	return q


func _aim(b: int, child: int, want: Vector3) -> void:
	## ボーン b を、子ボーンへの向きが want（モデル座標）になるように回す
	if b < 0 or child < 0 or want.length() < 0.0001:
		return
	var rest_dir: Vector3 = (rest_pos[child] - rest_pos[b]).normalized()
	var parent := skel.get_bone_parent(b)
	var gp := _global_rot(parent) if parent >= 0 else Quaternion.IDENTITY
	var g := Quaternion(rest_dir, want.normalized())
	skel.set_bone_pose_rotation(b, gp.inverse() * g)


func _to_model(d: Vector2, lateral: float) -> Vector3:
	## 仮人形の2D方向（x=前, y=下）→ モデル座標（+Z が前, +Y が上, X が横）
	return Vector3(lateral, -d.y, d.x)


func _aim_limb(r1: String, r2: String, r3: String, root2d: Vector2, end2d: Vector2, length: float, bend: int) -> void:
	var a: int = bi[r1]
	var b: int = bi[r2]
	var c: int = bi[r3]
	if a < 0 or b < 0 or c < 0:
		return
	var d := end2d - root2d
	var dist := d.length()
	if dist > length:
		end2d = root2d + d / dist * length
		dist = length
	var mid := (root2d + end2d) / 2
	var off := sqrt(max(0.0, (length / 2) * (length / 2) - (dist / 2) * (dist / 2))) * bend
	var n := Vector2(-d.y, d.x).normalized() if dist > 0.001 else Vector2.RIGHT
	var elbow := mid + n * off
	# 横方向は初期姿勢の開き具合を少し残す
	var lat1: float = (rest_pos[b] - rest_pos[a]).normalized().x * 0.35 * length
	var lat2: float = (rest_pos[c] - rest_pos[b]).normalized().x * 0.2 * length
	_aim(a, b, _to_model(elbow - root2d, lat1))
	_aim(b, c, _to_model(end2d - elbow, lat2))


# ------------------------------------------------------------ モーション再生
func _pick(slots: Array) -> Dictionary:
	for sl in slots:
		var c := MotionLib.clip(sl)
		if not c.is_empty():
			return c
	return {}


func _slot_now() -> Array:
	## [クリップ, 経過秒, ループするか]
	if f.state == "move" and f.move != null:
		var c := _pick(MOVE_SLOTS.get(f.move.d.key, []))
		if c.is_empty():
			return [null, 0.0, false]
		var prog: float = float(f.move.f) / max(1, f.move.d.total)
		return [c, prog * c.length, false]
	var key := sprite_key()
	var c2 := _pick(STATE_SLOTS.get(key, []))
	if c2.is_empty():
		return [null, 0.0, false]
	if key != cur_key:
		cur_key = key
		cur_start = f.anim
	var loop := not (key in ["rise", "land", "jumpsquat", "climb", "down", "hit", "tumble", "roll"])
	return [c2, (f.anim - cur_start) / 60.0, loop]


func sprite_key() -> String:
	var s := f.state
	if s == "stand" or s == "respawn":
		if s == "stand" and f.crouch:
			return "crouch"
		var sp: float = abs(f.vx)
		if s == "stand" and sp > f.st.walk + 0.5:
			return "run"
		if s == "stand" and sp > 0.6:
			return "walk"
		return s
	if s == "lag":
		return "land"
	if s == "air" or s == "helpless" or s == "walltech":
		return "rise" if f.vy < 0 else "fall"
	if s == "dodge":
		return "roll" if f.dodge != null and f.dodge.kind == "roll" else "shield"
	if s == "hitstun":
		return "tumble" if f.tumble and f.ground == null else "hit"
	if s == "knockdown":
		return "down"
	return s


func _play_motion() -> bool:
	var sl := _slot_now()
	if sl[0] == null:
		return false
	var c: Dictionary = sl[0]
	var frames: Array = c.frames
	var t: float = sl[1]
	var k := int(t * MotionLib.FPS)
	if sl[2]:
		k = k % frames.size()
	else:
		k = clamp(k, 0, frames.size() - 1)
	var fr: Dictionary = frames[k]
	if bi.center >= 0:
		skel.set_bone_pose_rotation(bi.center, fr.hips_rot)
		var off: Vector3 = fr.hips_off * hip_h
		skel.set_bone_pose_position(bi.center, skel.get_bone_rest(bi.center).origin + Vector3(off.x * 0.3, off.y, off.z * 0.3))
	for seg in MotionLib.SEGMENTS:
		var role: String = seg[2]
		if fr.dirs.has(role) and bi.get(role, -1) >= 0 and bi.get(seg[3], -1) >= 0:
			_aim(bi[role], bi[seg[3]], fr.dirs[role])
	if fr.has("head_rot") and bi.head >= 0:
		var par := skel.get_bone_parent(bi.head)
		var gp := _global_rot(par) if par >= 0 else Quaternion.IDENTITY
		skel.set_bone_pose_rotation(bi.head, gp.inverse() * fr.head_rot)
	return true
