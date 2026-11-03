## 横必殺（ヘルスラスト）が近距離でもすり抜けずに当たるか
extends SceneTree
func _init() -> void:
	var roster := Chars.all()
	var taiga = null
	for c in roster:
		if c.get("kit", "") == "taiga" or (c.has("mugen") and c.id == "mugen_taiga"):
			taiga = c
	if taiga == null:
		print("RESULT skip（大河なし）")
		quit()
		return
	var ok := true
	for dist in [30, 50, 80, 120, 160]:
		var rng := RandomNumberGenerator.new()
		var c1 := CpuController.new(0, rng)
		c1.loop_seq = [CpuController.S({"x": 1.0, "special": true})] + range(6).map(func(_i): return CpuController.S({"x": 1.0}))
		var w := World.new("battlefield", [[taiga, c1, true], [taiga, CpuController.new(0, rng), true]], 3, 1, false)
		var a: Fighter = w.fighters[0]
		var b: Fighter = w.fighters[1]
		a.x = -40.0
		b.x = a.x + dist
		a.face = 1
		for i in range(40):
			w.step()
		var hit := b.damage > 0
		print("距離 %d: %s  相手 %.0f%%  位置 %.0f→相手 %.0f" % [dist, "当たり" if hit else "すり抜け", b.damage, a.x, b.x])
		ok = ok and hit
	print("RESULT ", "ok" if ok else "NG")
	quit()
