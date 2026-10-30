## ワザ1つ分のデータ。ヒットボックスは足元基準（x は向いている方向が正、y は上がマイナス）。
## ang は向き基準の角度（0=前、90=真上、140=後ろ上、270=真下メテオ）。
class_name MoveDef
extends RefCounted

var key := ""
var label := ""
var total := 20
var hits: Array = []
var air := false          # 空中攻撃（着地で着地スキ）
var landlag := 8
var helpless := false     # 終了後しりもち落下
var on_frame = null       # Callable(w, f, m)
var on_land = null        # Callable(w, f, m) -> bool
var on_hit = null         # Callable(w, f, m, t)
var armor = null          # [開始, 終了]
var inv = null
var counter = null
var reflect := false
var charge_at = null
var charge_btn := "attack"
var charge_max := 60
var chain = null          # [受付開始, 次のワザ]
var keep_vx := false
var nograv = null
var no_drift := false
var ledge_ok := false
var once := ""            # "up" / "side"
var pose := "strike"


static func make(k: String, t: int, h: Array = [], opts := {}) -> MoveDef:
	var m := MoveDef.new()
	m.key = k
	m.label = k
	m.total = t
	m.hits = h
	for o in opts:
		m.set(o, opts[o])
	return m


static func H(f0: int, f1: int, x: float, y: float, r: float, dmg: float, ang: float, bkb: float, kbg: float, opts := {}) -> Dictionary:
	var h := {"f0": f0, "f1": f1, "x": x, "y": y, "r": r, "dmg": dmg, "ang": ang, "bkb": bkb, "kbg": kbg,
		"both": false, "grab": false, "cmd": false, "group": 0, "rehit": 0, "radial": false, "shieldmul": 1.0,
		"fx": "slash", "limb": ""}
	h.merge(opts, true)
	return h


func active(f: int) -> Array:
	var out := []
	for h in hits:
		if h.f0 <= f and f <= h.f1:
			out.append(h)
	return out


func in_window(attr: String, f: int) -> bool:
	var w = get(attr)
	return w != null and w[0] <= f and f <= w[1]


func first_hit_frame() -> int:
	var s := 9999
	for h in hits:
		s = min(s, h.f0)
	return s if s < 9999 else total / 2
