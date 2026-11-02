## PMX 読み込みの確認: godot --headless --path godot-fight --script res://tests/test_pmx.gd -- <pmxのパス>
extends SceneTree


func _init() -> void:
	var ok := true
	for p in OS.get_cmdline_user_args():
		var t := Time.get_ticks_msec()
		var r := PmxLoader.load_model(p)
		if r.has("error"):
			print("NG ", r.error)
			ok = false
			continue
		print(r.info, "  高さ %.2fm  %dms" % [r.height, Time.get_ticks_msec() - t])
		var names: Array = r.bones.keys()
		print("  ボーン例: ", names.slice(0, 30))
		var mi: MeshInstance3D = r.skeleton.get_node("Mesh")
		var aabb := mi.mesh.get_aabb()
		print("  大きさ ", aabb.position, " ", aabb.size)
		print("  右手系: ", names.filter(func(n): return n.begins_with("右手") or n.begins_with("右ひじ") or n.contains("槍") or n.contains("剣")))
		r.root.free()
	quit(0 if ok else 1)
