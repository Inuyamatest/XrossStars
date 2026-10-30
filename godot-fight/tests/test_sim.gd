## ヘッドレスでCPU同士を戦わせ、エラー・NaN・終わらない試合がないか確かめる。
##   godot --headless --path godot-fight --script res://tests/test_sim.gd
extends SceneTree


func _init() -> void:
	var ok := true
	var kb := World.calc_kb(116, 16, 100, 35, 100)
	if kb < 160 or kb > 200:
		print("NG kb ", kb)
		ok = false
	var states := {}
	var total_frames := 0
	var events := {}
	var ko_pcts := []
	for seed in range(8):
		var rng := RandomNumberGenerator.new()
		rng.seed = seed
		var ch := Chars.blaze()
		var stage_key := "battlefield" if seed % 2 == 0 else "final"
		var w := World.new(stage_key, [[ch, CpuController.new(7, rng), true], [ch, CpuController.new(7, rng), true]], 2, seed, false)
		while not w.over and w.frame < 60 * 60 * 6:
			w.step()
			for e in w.events:
				events[e.kind] = events.get(e.kind, 0) + 1
				if e.kind == "ko":
					ko_pcts.append(e.who.damage)
			w.events.clear()
			for f in w.fighters:
				for v in [f.x, f.y, f.vx, f.vy, f.kx, f.ky, f.damage]:
					if is_nan(v) or is_inf(v):
						print("NG nan ", f.state)
						ok = false
				states[f.state] = true
		total_frames += w.frame
		print("  seed %d @%s %.1fs over=%s  %s" % [seed, stage_key, w.frame / 60.0, w.over,
			", ".join(w.fighters.map(func(f): return "%s ko%d/fall%d" % [f.tag, f.kos, f.falls]))])
		if not w.over:
			ok = false
	var avg := 0.0
	for p in ko_pcts:
		avg += p
	print("  平均 %.1f秒 / 撃墜%%平均 %.0f / 状態 %s" % [total_frames / 8.0 / 60.0, avg / max(1, ko_pcts.size()), states.keys()])
	print("  イベント ", events)
	for s in ["hitstun", "shield", "hold", "grabbed", "ledge", "move", "dodge"]:
		if not states.has(s):
			print("NG state missing ", s)
			ok = false
	print("RESULT ", "ok" if ok else "NG")
	quit(0 if ok else 1)
