## 効果音（その場で波形を合成。音声ファイル不要）。2D版 audio.py の移植。
class_name Sfx
extends Node

const RATE := 22050

var sounds := {}
var players: Array = []
var next := 0
var muted := false


func _ready() -> void:
	for i in range(16):
		var p := AudioStreamPlayer.new()
		add_child(p)
		players.append(p)
	var rng := RandomNumberGenerator.new()
	rng.seed = 3
	sounds.hit_s = _make(0.09, func(t, k): return (rng.randf_range(-1, 1) * 0.6 + sin(t * 900.0) * 0.5) * pow(1 - k, 2))
	sounds.hit_m = _make(0.16, func(t, k): return (rng.randf_range(-1, 1) * 0.6 + sin(t * TAU * (220 - 120 * k)) * 0.7) * pow(1 - k, 2))
	sounds.hit_l = _make(0.34, func(t, k): return (rng.randf_range(-1, 1) * 0.7 * (1 - k) + sin(t * TAU * (140 - 90 * k)) * 0.95) * pow(1 - k, 1.5))
	sounds.swing = _make(0.11, func(t, k): return rng.randf_range(-1, 1) * 0.22 * sin(k * PI))
	sounds.jump = _make(0.12, func(t, k): return sin(t * TAU * (300 + 500 * k)) * 0.25 * (1 - k))
	sounds.land = _make(0.06, func(t, k): return rng.randf_range(-1, 1) * 0.22 * (1 - k))
	sounds.block = _make(0.12, func(t, k): return sin(t * TAU * 1400) * 0.32 * pow(1 - k, 2))
	sounds.grab = _make(0.1, func(t, k): return sin(t * TAU * (500 - 200 * k)) * 0.35 * (1 - k))
	sounds.ko = _make(0.9, func(t, k): return (rng.randf_range(-1, 1) * 0.8 * pow(1 - k, 2) + sin(t * TAU * (90 - 50 * k)) * (1 - k)) * 0.9)
	sounds.brk = _make(0.5, func(t, k): return (sin(t * TAU * 1800 * (1 - k * 0.5)) * 0.3 + rng.randf_range(-1, 1) * 0.3) * (1 - k))
	sounds.awaken = _make(0.8, func(t, k): return (sin(t * TAU * (200 + 600 * k)) * 0.4 + sin(t * TAU * (300 + 900 * k)) * 0.2) * min(1.0, (1 - k) * 3))
	sounds.blast = _make(1.0, func(t, k): return (rng.randf_range(-1, 1) * pow(1 - k, 1.5) + sin(t * TAU * 60) * (1 - k)) * 0.9)
	sounds.proj = _make(0.12, func(t, k): return sin(t * TAU * (700 - 400 * k)) * 0.22 * (1 - k))
	sounds.count = _make(0.2, func(t, k): return sin(t * TAU * 660) * 0.35 * (1 - k))
	sounds.go = _make(0.45, func(t, k): return (sin(t * TAU * 880) + sin(t * TAU * 1320) * 0.5) * 0.28 * (1 - k))
	sounds.game = _make(0.9, func(t, k): return (sin(t * TAU * 523) + sin(t * TAU * 659) + sin(t * TAU * 784)) * 0.14 * (1 - k))


func _make(dur: float, fn: Callable) -> AudioStreamWAV:
	var n := int(RATE * dur)
	var data := PackedByteArray()
	data.resize(n * 2)
	for i in range(n):
		var v: float = clamp(fn.call(float(i) / RATE, float(i) / n), -1.0, 1.0)
		data.encode_s16(i * 2, int(v * 30000))
	var st := AudioStreamWAV.new()
	st.format = AudioStreamWAV.FORMAT_16_BITS
	st.mix_rate = RATE
	st.data = data
	return st


func play(name: String, vol_db := 0.0) -> void:
	if muted or not sounds.has(name):
		return
	var p: AudioStreamPlayer = players[next]
	next = (next + 1) % players.size()
	p.stream = sounds[name]
	p.volume_db = vol_db
	p.play()


func on_event(e: Dictionary) -> void:
	match e.kind:
		"hit":
			var d: float = e.dmg
			play("hit_l" if d >= 12 or e.kb > 140 else ("hit_m" if d >= 5 else "hit_s"))
		"swing":
			play("swing", -6.0)
		"jump", "djump":
			play("jump", -5.0)
		"land":
			play("land", -6.0)
		"block", "counter", "reflect", "armor", "tech":
			play("block")
		"grab":
			play("grab")
		"ko":
			play("ko")
		"shieldbreak":
			play("brk")
		"awaken":
			play("awaken")
		"awaken_blast":
			play("blast")
		"proj":
			play("proj", -4.0)
		"count":
			play("count")
		"go":
			play("go")
		"game":
			play("game")
