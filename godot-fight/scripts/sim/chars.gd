## キャラ定義。model は characters/<id>/ に VRoid モデル（.glb/.vrm）を置くと使われる。
class_name Chars


static func stats(weight, walk, run, air, airacc, grav, fall, ffall, jump, short, djump, extra := {}) -> Dictionary:
	var d := {"weight": weight, "walk": walk, "run": run, "air": air, "airacc": airacc, "grav": grav, "fall": fall,
		"ffall": ffall, "jump": jump, "short": short, "djump": djump, "friction": 0.6, "jumps": 1, "hw": 22.0, "h": 84.0}
	d.merge(extra, true)
	return d


static func blaze() -> Dictionary:
	return {
		"id": "blaze", "name": "ブレイズ", "title": "炎の拳士",
		"stats": stats(100, 4.5, 8.6, 6.0, 0.45, 0.55, 9.5, 14.0, 14.6, 9.6, 14.0),
		"power": 1.0, "side_recover": true, "awaken": "インフェルノ・ノヴァ",
		"colors": {"body": Color(0.84, 0.23, 0.19), "accent": Color(1.0, 0.67, 0.24), "skin": Color(1.0, 0.84, 0.71),
			"hair": Color(0.59, 0.12, 0.12)},
		"specials": Moves.blaze_specials,
	}


# ================================================================ タイプ（武器・戦い方）
# reach: 前方向の攻撃（手・武器）がどれだけ長いか / slow: 前方向の強攻撃・スマッシュの発生の遅さ
const TYPES := {
	"brawler": {"label": "格闘", "stats": [112, 4.0, 8.0, 5.6, 0.4, 0.6, 10.0, 14.5, 14.0, 9.2, 13.2], "power": 1.1, "reach": 0.0, "slow": 0,
		"specials": "brawler", "side_recover": false, "awaken": "鬼神覚醒"},
	"speed": {"label": "スピード", "stats": [86, 5.2, 10.4, 7.0, 0.55, 0.62, 10.5, 16.0, 15.6, 10.2, 14.6], "power": 0.9, "reach": 0.0, "slow": 0,
		"specials": "speed", "side_recover": true, "awaken": "ブリザード・ラッシュ"},
	"sword": {"label": "剣", "stats": [98, 4.4, 8.6, 6.0, 0.45, 0.55, 9.6, 14.2, 14.8, 9.7, 14.0], "power": 1.0, "reach": 26.0, "slow": 1,
		"specials": "sword", "side_recover": true, "awaken": "奥義・一閃"},
	"spear": {"label": "槍", "stats": [106, 4.0, 7.8, 5.4, 0.4, 0.58, 10.0, 14.5, 14.2, 9.4, 13.4], "power": 1.08, "reach": 46.0, "slow": 3,
		"specials": "spear", "side_recover": false, "awaken": "騎士の大突撃"},
	"magic": {"label": "魔法", "stats": [90, 4.2, 8.0, 6.4, 0.5, 0.48, 8.6, 13.0, 15.0, 9.8, 14.4], "power": 0.95, "reach": 0.0, "slow": 0,
		"specials": "magic", "side_recover": true, "awaken": "マジカル・バースト"},
}

# 前方向にリーチが伸びるワザ（手・武器で攻撃するもの）
const REACH_MOVES := ["jab", "jab2", "jab3", "ftilt", "fsmash", "dash", "fair", "utilt", "usmash", "ledgeatk"]


static func typed(type_key: String, name: String) -> Dictionary:
	var t: Dictionary = TYPES.get(type_key, TYPES.brawler)
	var a: Array = t.stats
	var ch := blaze()
	ch.id = type_key
	ch.name = name
	ch.type = type_key
	ch.title = t.label
	ch.stats = stats(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], {"h": 88.0})
	ch.power = t.power
	ch.reach = t.reach
	ch.slow = t.slow
	ch.side_recover = t.side_recover
	ch.awaken = t.awaken
	ch.specials = Callable(Specials, t.specials)
	return ch


static func build_moves(ch: Dictionary) -> Dictionary:
	var mv := Moves.common(ch.power)
	mv.merge(ch.specials.call(), true)
	var reach: float = ch.get("reach", 0.0)
	var slow: int = ch.get("slow", 0)
	if reach > 0 or slow > 0:
		for k in REACH_MOVES:
			var m: MoveDef = mv.get(k)
			if m == null:
				continue
			for h in m.hits:
				if h.limb == "hand" or k in ["fsmash", "dash", "fair", "jab3", "ftilt"]:
					if h.x > 0:
						h.x += reach
						h.r += reach * 0.2
					h.fx = "slash"
				if slow > 0 and k in ["ftilt", "fsmash", "dash", "fair"]:
					h.f0 += slow
					h.f1 += slow
			if slow > 0 and k in ["ftilt", "fsmash", "dash", "fair"]:
				m.total += slow
				if m.charge_at != null:
					m.charge_at += slow
	return mv


## characters/roster.json: フォルダ名 → {"name", "type", "pmx"(省略可), "weapon": {...}}
static func roster() -> Dictionary:
	# exe の横の characters/roster.json を優先し、無ければ同梱の設定を使う
	var p := model_dir().path_join("roster.json")
	if not FileAccess.file_exists(p):
		p = "res://characters/roster.json"
	if not FileAccess.file_exists(p):
		return {}
	var j = JSON.parse_string(FileAccess.get_file_as_string(p))
	return j if j is Dictionary else {}


## characters/<フォルダ>/ に置いたモデル（いまは .pmx）をキャラとして追加する。
## 性能はブレイズと同じで、見た目だけモデルになる。
static func model_dir() -> String:
	if OS.has_feature("editor"):
		return ProjectSettings.globalize_path("res://characters")
	return OS.get_executable_path().get_base_dir().path_join("characters")


static func model_chars() -> Array:
	var out := []
	var base := model_dir()
	var d := DirAccess.open(base)
	if d == null:
		return out
	var ros := roster()
	var subs := Array(d.get_directories())
	subs.sort()
	for sub in subs:
		var dir := base.path_join(sub)
		var conf: Dictionary = ros.get(sub, {})
		var files := Array(DirAccess.get_files_at(dir)).filter(func(n): return n.get_extension().to_lower() == "pmx")
		if files.is_empty():
			continue
		files.sort_custom(func(a, b): return a.length() < b.length())
		var pmx: String = conf.get("pmx", files[0])
		var ch := typed(conf.get("type", "brawler"), conf.get("name", pmx.get_basename()))
		ch.id = "model_" + sub
		ch.model = dir.path_join(pmx)
		ch.weapon = conf.get("weapon", {})
		ch.folder = dir
		out.append(ch)
	return out


static func all() -> Array:
	return [blaze()] + model_chars()
