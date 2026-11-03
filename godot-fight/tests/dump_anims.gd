## アニメの各コマの長さと攻撃判定のあるティックを表示（ワザ作りの下調べ用）
## godot --headless --path godot-fight --script res://tests/dump_anims.gd -- <フォルダ> <アニメ番号,...>
extends SceneTree
func _init() -> void:
	var a := OS.get_cmdline_user_args()
	var mg := Mugen.load_char(a[0])
	for s in a[1].split(","):
		var an := int(s)
		if not mg.air.has(an):
			print(an, " なし")
			continue
		var fr: Array = mg.air[an].frames
		var t := 0
		var line := []
		for i in range(fr.size()):
			var d: int = fr[i].t
			line.append("%d:%s%s@%d" % [i + 1, str(d), "*" if not fr[i].c1.is_empty() else "", t])
			t += max(0, d)
		print(an, " len=", Mugen.anim_length(mg.air[an]), " loop=", mg.air[an].loopstart, "  ", " ".join(line))
		print("   clsn窓=", Mugen.clsn_windows(mg.air[an], mg.scale).map(func(w): return [w[0], w[1], (w[2] as Array).map(func(v): return int(v))]))
	quit()
