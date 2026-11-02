## FBX モーションの中身を表示: godot --headless --path godot-fight --script res://tests/test_fbx.gd -- <fbx>
extends SceneTree


func _init() -> void:
	for p in OS.get_cmdline_user_args():
		var doc := FBXDocument.new()
		var st := FBXState.new()
		var err := doc.append_from_file(p, st)
		print("load ", p.get_file(), " err=", err)
		if err != OK:
			continue
		var scene := doc.generate_scene(st)
		_dump(scene, 0)
		var ap := _find(scene, "AnimationPlayer") as AnimationPlayer
		if ap:
			for n in ap.get_animation_list():
				var a := ap.get_animation(n)
				print("anim ", n, " len=", a.length, " tracks=", a.get_track_count(), " ", a.track_get_path(0), " ", a.track_get_path(1))
		var sk := _find(scene, "Skeleton3D") as Skeleton3D
		if sk:
			print("bones ", sk.get_bone_count(), " ", range(min(12, sk.get_bone_count())).map(func(i): return sk.get_bone_name(i)))
			var hips := 0
			print("rest hips ", sk.get_bone_global_rest(hips).origin, " scale ", sk.global_transform.basis.get_scale())
			for nm in ["mixamorig_LeftArm", "mixamorig_LeftForeArm", "mixamorig_LeftHand", "mixamorig_Head"]:
				var i := sk.find_bone(nm)
				if i >= 0:
					print(nm, " ", sk.get_bone_global_rest(i).origin)
		scene.free()
	quit()


func _dump(n: Node, d: int) -> void:
	if d < 4:
		print("  ".repeat(d), n.name, " (", n.get_class(), ")")
		for c in n.get_children():
			_dump(c, d + 1)


func _find(n: Node, cls: String) -> Node:
	if n.get_class() == cls:
		return n
	for c in n.get_children():
		var r := _find(c, cls)
		if r:
			return r
	return null
