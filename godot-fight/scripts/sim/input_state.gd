## 1フレーム分の入力。人間もCPUも同じ形で渡す。
class_name InputState
extends RefCounted

const BUTTONS := ["attack", "special", "jump", "shield", "grab", "smash", "awaken"]

var x := 0.0
var y := 0.0  # 上がマイナス
var attack := false
var special := false
var jump := false
var shield := false
var grab := false
var smash := false
var awaken := false


static func make(opts := {}) -> InputState:
	var s := InputState.new()
	for k in opts:
		s.set(k, opts[k])
	return s
