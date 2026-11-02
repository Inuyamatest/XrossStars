## glb のアニメ一覧: godot --headless --path godot-fight --script res://tests/list_anims.gd -- <glb>
extends SceneTree
func _init() -> void:
	for p in OS.get_cmdline_user_args():
		var doc := GLTFDocument.new()
		var st := GLTFState.new()
		var err := doc.append_from_file(p, st)
		print(p.get_file(), " err=", err)
		var scene := doc.generate_scene(st)
		var ap := MotionLib._find(scene, "AnimationPlayer") as AnimationPlayer
		var sk := MotionLib._find(scene, "Skeleton3D") as Skeleton3D
		if sk:
			print("bones ", sk.get_bone_count(), " ", range(min(25, sk.get_bone_count())).map(func(i): return sk.get_bone_name(i)))
		if ap:
			var names := ap.get_animation_list()
			print("anims ", names.size())
			var out := []
			for n in names:
				out.append("%s(%.1f)" % [n, ap.get_animation(n).length])
			print(", ".join(out))
		scene.free()
	quit()
