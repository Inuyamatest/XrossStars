## キーボード（1P/2P）とゲームパッドの入力。
class_name HumanController
extends RefCounted

const KEYMAPS := [
	{   # 1P
		"left": [KEY_A], "right": [KEY_D], "up": [KEY_W], "down": [KEY_S],
		"attack": [KEY_J], "special": [KEY_K], "shield": [KEY_L], "jump": [KEY_SPACE, KEY_I],
		"grab": [KEY_U], "smash": [KEY_O], "awaken": [KEY_P],
	},
	{   # 2P
		"left": [KEY_LEFT], "right": [KEY_RIGHT], "up": [KEY_UP], "down": [KEY_DOWN],
		"attack": [KEY_KP_1, KEY_COMMA], "special": [KEY_KP_2, KEY_PERIOD], "shield": [KEY_KP_3, KEY_SLASH],
		"jump": [KEY_KP_0, KEY_KP_5, KEY_SHIFT], "grab": [KEY_KP_4, KEY_SEMICOLON],
		"smash": [KEY_KP_6, KEY_APOSTROPHE], "awaken": [KEY_KP_7, KEY_BRACKETRIGHT],
	},
]

var km: Dictionary
var pad := 0


func _init(player: int) -> void:
	km = KEYMAPS[player]
	pad = player


func _held(n: String) -> bool:
	for k in km[n]:
		if Input.is_physical_key_pressed(k):
			return true
	return false


func get_input(_w, _f) -> InputState:
	var s := InputState.new()
	s.x = (1.0 if _held("right") else 0.0) - (1.0 if _held("left") else 0.0)
	s.y = (1.0 if _held("down") else 0.0) - (1.0 if _held("up") else 0.0)
	for b in ["attack", "special", "shield", "jump", "grab", "smash", "awaken"]:
		s.set(b, _held(b))
	if pad in Input.get_connected_joypads():
		var ax := Input.get_joy_axis(pad, JOY_AXIS_LEFT_X)
		var ay := Input.get_joy_axis(pad, JOY_AXIS_LEFT_Y)
		if Input.is_joy_button_pressed(pad, JOY_BUTTON_DPAD_LEFT): ax = -1.0
		if Input.is_joy_button_pressed(pad, JOY_BUTTON_DPAD_RIGHT): ax = 1.0
		if Input.is_joy_button_pressed(pad, JOY_BUTTON_DPAD_UP): ay = -1.0
		if Input.is_joy_button_pressed(pad, JOY_BUTTON_DPAD_DOWN): ay = 1.0
		if abs(ax) > 0.25: s.x = clamp(ax, -1.0, 1.0)
		if abs(ay) > 0.25: s.y = clamp(ay, -1.0, 1.0)
		s.attack = s.attack or Input.is_joy_button_pressed(pad, JOY_BUTTON_A)
		s.special = s.special or Input.is_joy_button_pressed(pad, JOY_BUTTON_B)
		s.jump = s.jump or Input.is_joy_button_pressed(pad, JOY_BUTTON_X) or Input.is_joy_button_pressed(pad, JOY_BUTTON_Y) or ay < -0.75
		s.shield = s.shield or Input.is_joy_button_pressed(pad, JOY_BUTTON_RIGHT_SHOULDER) or Input.get_joy_axis(pad, JOY_AXIS_TRIGGER_RIGHT) > 0.5
		s.grab = s.grab or Input.is_joy_button_pressed(pad, JOY_BUTTON_LEFT_SHOULDER) or Input.get_joy_axis(pad, JOY_AXIS_TRIGGER_LEFT) > 0.5
		s.awaken = s.awaken or Input.is_joy_button_pressed(pad, JOY_BUTTON_BACK)
		var rx := Input.get_joy_axis(pad, JOY_AXIS_RIGHT_X)
		var ry := Input.get_joy_axis(pad, JOY_AXIS_RIGHT_Y)
		if abs(rx) > 0.6 or abs(ry) > 0.6:   # 右スティック = スマッシュ
			s.smash = true
			if abs(rx) >= abs(ry):
				s.x = sign(rx); s.y = 0.0
			else:
				s.x = 0.0; s.y = sign(ry)
	return s
