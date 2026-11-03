## 大河専用の必殺ワザ・エフェクトの確認
extends SceneTree
func _init() -> void:
	for ch in Chars.model_chars():
		if not ch.has("mugen"):
			continue
		var mv := Chars.build_moves(ch)
		for k in ["nspecial", "sspecial", "uspecial", "uspecial_air", "dspecial"]:
			if not mv.has(k):
				print(k, " なし")
				continue
			var m: MoveDef = mv[k]
			print("%-13s %s anim=%s %s total=%d hits=%s" % [k, m.label, m.spr, m.spr_mode, m.total,
				m.hits.map(func(h): return [h.f0, h.f1, h.dmg, h.ang, h.get("rehit", 0), (h.get("rect", []) as Array).map(func(v): return int(v))])])
		var fx := {}
		var mg: Dictionary = ch.mugen
		var paths := []
		for kk in ["cns", "st", "stcommon", "st0", "st1", "st2", "st3", "st4"]:
			var p := Mugen.find_file(mg.folder, mg.files.get(kk, ""))
			if p != "" and not p in paths:
				paths.append(p)
		Mugen.parse_cns_cues(paths, mg.air, fx)
		print("エフェクトのあるアニメ ", fx.size())
		for an in [1000, 1300, 1105, 1106, 1200, 210, 2000]:
			print("  ", an, " ", fx.get(an, []))
	quit()
