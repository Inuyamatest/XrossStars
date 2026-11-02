extends SceneTree
func _init() -> void:
	for f in DirAccess.get_files_at("res://assets/platformer"):
		if not f.ends_with(".fbx"):
			continue
		var ps: PackedScene = load("res://assets/platformer/" + f)
		var n := ps.instantiate()
		var aabb := AABB()
		var first := true
		var mats := []
		for mi in n.find_children("*", "MeshInstance3D", true, false):
			var a: AABB = mi.global_transform * mi.mesh.get_aabb() if mi.is_inside_tree() else mi.transform * mi.mesh.get_aabb()
			var p = mi.get_parent()
			while p != null and p != n:
				a = p.transform * a
				p = p.get_parent()
			a = n.transform * a
			aabb = a if first else aabb.merge(a)
			first = false
			for s in range(mi.mesh.get_surface_count()):
				var m = mi.mesh.surface_get_material(s)
				if m is StandardMaterial3D:
					mats.append(m.albedo_color.to_html(false))
		print(f, " pos=", aabb.position.snapped(Vector3.ONE*0.01), " size=", aabb.size.snapped(Vector3.ONE*0.01), " ", mats)
		n.free()
	quit()
