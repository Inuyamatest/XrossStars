## モーションの割り当て確認: godot --headless --path godot-fight --script res://tests/test_motions.gd
extends SceneTree
func _init() -> void:
	var t := Time.get_ticks_msec()
	print("アニメ数 ", MotionLib.available().size(), "  索引 %dms" % (Time.get_ticks_msec() - t))
	var miss := []
	for slot in MotionLib.SLOT_CLIPS:
		t = Time.get_ticks_msec()
		var c := MotionLib.clip(slot)
		if c.is_empty():
			miss.append(slot)
		else:
			print("  %-12s ← %-22s %.1f秒 %dフレーム  %dms" % [slot, c.name, c.length, c.frames.size(), Time.get_ticks_msec() - t])
	print("無し: ", miss)
	quit()
