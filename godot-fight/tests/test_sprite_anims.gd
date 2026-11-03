## MUGEN キャラの見た目（状態→アニメの並び）を CPU 同士の試合で確認する。描画はしない
extends SceneTree
func _init() -> void:
	var roster := Chars.all()
	var ci := -1
	for i in range(roster.size()):
		if roster[i].has("mugen"):
			ci = i
	if ci < 0:
		print("RESULT skip")
		quit()
		return
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	var w := World.new("battlefield", [[roster[ci], CpuController.new(9, rng), true], [roster[ci], CpuController.new(9, rng), true]], 3, 7, false)
	var views := []
	for f in w.fighters:
		var v := SpriteView.new()
		root.add_child(v)
		v.setup(f)
		views.append(v)
	var keys := {}
	var anims := {}
	var bad := 0
	var hits := 0
	var ko_flag := 0
	var kos := 0
	for i in range(5000):
		w.step()
		for e in w.events:
			if e.kind == "hit":
				hits += 1
				if e.get("ko", false):
					ko_flag += 1
			if e.kind == "ko":
				kos += 1
			for v in views:
				v.on_event(e)
		w.events.clear()
		for v in views:
			if not v.f.alive() or v.f.hidden:
				continue
			var fr: Array = v._frame()
			if fr.is_empty():
				bad += 1
				continue
			keys[v.cur_key] = keys.get(v.cur_key, 0) + 1
			anims[fr[0]] = true
		if w.over:
			break
	var ks := keys.keys()
	ks.sort()
	print("状態の並び: ", ks.map(func(k): return "%s(%d)" % [k, keys[k]]))
	var an := anims.keys()
	an.sort()
	print("使ったアニメ: ", an)
	print("絵が決まらなかったフレーム: ", bad)
	print("ヒット %d  撃墜予測 %d  実際の撃墜 %d" % [hits, ko_flag, kos])
	print("RESULT ", "ok" if bad == 0 else "NG")
	quit()
