## キャラ定義。model は characters/<id>/ に VRoid モデル（.glb/.vrm）を置くと使われる。
class_name Chars


static func stats(weight, walk, run, air, airacc, grav, fall, ffall, jump, short, djump, extra := {}) -> Dictionary:
	var d := {"weight": weight, "walk": walk, "run": run, "air": air, "airacc": airacc, "grav": grav, "fall": fall,
		"ffall": ffall, "jump": jump, "short": short, "djump": djump, "friction": 0.6, "jumps": 1, "hw": 22.0, "h": 84.0}
	d.merge(extra, true)
	return d


static func blaze() -> Dictionary:
	return {
		"id": "blaze", "name": "ブレイズ", "title": "炎の拳士",
		"stats": stats(100, 4.5, 8.6, 6.0, 0.45, 0.55, 9.5, 14.0, 14.6, 9.6, 14.0),
		"power": 1.0, "side_recover": true, "awaken": "インフェルノ・ノヴァ",
		"colors": {"body": Color(0.84, 0.23, 0.19), "accent": Color(1.0, 0.67, 0.24), "skin": Color(1.0, 0.84, 0.71),
			"hair": Color(0.59, 0.12, 0.12)},
		"specials": Moves.blaze_specials,
	}


static func build_moves(ch: Dictionary) -> Dictionary:
	var mv := Moves.common(ch.power)
	mv.merge(ch.specials.call(), true)
	return mv


## characters/<フォルダ>/ に置いたモデル（いまは .pmx）をキャラとして追加する。
## 性能はブレイズと同じで、見た目だけモデルになる。
static func model_dir() -> String:
	if OS.has_feature("editor"):
		return ProjectSettings.globalize_path("res://characters")
	return OS.get_executable_path().get_base_dir().path_join("characters")


static func model_chars() -> Array:
	var out := []
	var base := model_dir()
	var d := DirAccess.open(base)
	if d == null:
		return out
	for sub in d.get_directories():
		var dir := base.path_join(sub)
		var files := Array(DirAccess.get_files_at(dir)).filter(func(n): return n.get_extension().to_lower() == "pmx")
		if files.is_empty():
			continue
		files.sort_custom(func(a, b): return a.length() < b.length())
		var ch := blaze()
		ch.id = "model_" + sub
		ch.name = files[0].get_basename()
		ch.title = "モデル"
		ch.model = dir.path_join(files[0])
		ch.stats.h = 88.0
		out.append(ch)
	return out


static func all() -> Array:
	return [blaze()] + model_chars()
