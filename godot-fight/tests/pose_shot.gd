## モデルのポーズ確認用（画面が必要）: xvfb-run godot --path godot-fight --script res://tests/pose_shot.gd -- 出力.png
extends SceneTree

var frames := 0
var out := "user://poses.png"


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	var root := Node3D.new()
	get_root().add_child(root)
	var cam := Camera3D.new()
	cam.fov = 30
	cam.position = Vector3(0, 1.1, 9.5)
	root.add_child(cam)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, 30, 0)
	root.add_child(sun)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color(0.35, 0.35, 0.45)
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color(0.8, 0.8, 0.85)
	root.add_child(env)
	var chars := Chars.model_chars()
	if chars.is_empty():
		print("モデルなし")
		quit(1)
		return
	var poses := [["stand", 0], ["run", null], ["move", "jab"], ["move", "jab2"], ["move", "ftilt"], ["move", "fsmash"],
		["move", "dsmash"], ["move", "nspecial"], ["shield", null], ["hitstun", null], ["dodge", null], ["move", "fthrow"]]
	for i in range(poses.size()):
		var f := Fighter.new(0, chars[0], null, 3, true)
		f.x = (i - (poses.size() - 1) / 2.0) * 44.0
		f.y = 40.0
		f.face = 1 if i % 2 == 0 else -1
		var st: String = poses[i][0]
		if st == "run":
			f.state = "stand"
			f.vx = 8.0
			f.anim = 20
		elif st == "move":
			f.start_move(DummyW.new(), poses[i][1])
			var d: MoveDef = f.moves[poses[i][1]]
			f.move.f = d.first_hit_frame()
		elif st == "hitstun":
			f.state = "hitstun"
			f.tumble = false
		elif st == "dodge":
			f.state = "dodge"
			f.dodge = {"kind": "roll", "total": 30, "inv": [0, 0], "dir": 1, "dy": 0.0}
			f.timer = 10
		elif st == "ledge":
			f.state = "stand"
			f.crouch = true
		else:
			f.state = st
		var v := ModelView.new()
		root.add_child(v)
		v.setup(f)
		v.refresh()
		if st == "stand" and poses[i][1] != null:
			f.anim += int(poses[i][1])
			v.refresh()
	cam.position = Vector3(0, 0.0, 15.5)
	if OS.get_cmdline_user_args().size() > 1:
		cam.position = Vector3(-2.2, -0.3, 4.0)


class DummyW:
	extends RefCounted
	func event(_a, _b, _c, _d := {}) -> void:
		pass


func _process(_d: float) -> bool:
	frames += 1
	if frames == 5:
		get_root().get_texture().get_image().save_png(out)
		return true
	return false
