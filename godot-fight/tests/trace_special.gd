## 必殺ワザをくり返させて 1P の状態を表示（ワザ作りのデバッグ用）
## godot --headless --path godot-fight --script res://tests/trace_special.gd -- <ワザ> [キャラ番号]
extends SceneTree
func _init() -> void:
	var a := OS.get_cmdline_user_args()
	var mv: String = a[0]
	var ci := int(a[1]) if a.size() > 1 else 5
	var roster := Chars.all()
	var rng := RandomNumberGenerator.new()
	var c1 := CpuController.new(0, rng)
	var dir: Dictionary = {"nspecial": {}, "sspecial": {"x": 1.0}, "uspecial": {"y": -1.0}, "dspecial": {"y": 1.0}}.get(mv, {})
	var st := dir.duplicate()
	st.special = true
	c1.loop_seq = [CpuController.S(st)] + range(6).map(func(_i): return CpuController.S(dir)) + range(90).map(func(_i): return CpuController.S({}))
	var w := World.new("battlefield", [[roster[ci], c1, true], [roster[ci], CpuController.new(0, rng), true]], 3, 1, true)
	var f: Fighter = w.fighters[0]
	for i in range(260):
		w.step()
		if i >= 165 and i % 2 == 0:
			print(i, " ", f.state, " mv=", (f.move.d.key + ":" + str(f.move.f)) if f.move != null and f.state == "move" else "", " x=%.0f y=%.0f vx=%.1f vy=%.1f" % [f.x, f.y, f.vx, f.vy])
	quit()
