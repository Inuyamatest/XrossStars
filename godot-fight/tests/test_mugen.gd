## MUGEN キャラの読み込み確認: godot --headless --path godot-fight --script res://tests/test_mugen.gd
extends SceneTree
func _init() -> void:
	var ok := true
	for ch in Chars.model_chars():
		if not ch.has("mugen"):
			continue
		var mg: Dictionary = ch.mugen
		var t := Time.get_ticks_msec()
		print(ch.name, "  scale %.3f hw %.1f  アニメ%d  状態%d  ワザ%d  必殺%s" % [mg.scale, mg.hw, mg.air.size(), mg.state_map.size(), mg.move_plan.size(), mg.spec_anims])
		var mv := Chars.build_moves(ch)
		for k in ["jab", "ftilt", "fsmash", "nair", "bair", "grab"]:
			var m: MoveDef = mv[k]
			print("  %-7s anim=%s %s total=%d hits=%s" % [k, m.spr, m.spr_mode, m.total, m.hits.map(func(h): return [h.f0, h.f1, h.get("rect", null)])])
		# ドット絵のデコード
		var sff := Mugen.Sff.new(Mugen.find_file(mg.folder, mg.files.sprite))
		var cnt := 0
		var bad := 0
		for an in mg.state_map.values() + mg.move_plan.values():
			for f in mg.air[an].frames:
				var r = sff.get_sprite(f.g, f.i)
				cnt += 1
				if r == null:
					bad += 1
		print("  スプライト %d枚 失敗%d  %dms" % [cnt, bad, Time.get_ticks_msec() - t])
		var snd := Mugen.parse_snd(Mugen.find_file(mg.folder, mg.files.get("sound", "")))
		var paths := []
		for k in ["cns", "st", "stcommon", "st0", "st1", "st2", "st3"]:
			var p := Mugen.find_file(mg.folder, mg.files.get(k, ""))
			if p != "" and not p in paths:
				paths.append(p)
		var cues := Mugen.parse_cns_cues(paths, mg.air)
		print("  音 %d  合図のあるアニメ %d  例210=%s" % [snd.size(), cues.size(), cues.get(210, [])])
		print("  合計 %dms" % (Time.get_ticks_msec() - t))
	quit(0 if ok else 1)
