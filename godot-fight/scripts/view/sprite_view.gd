## MUGEN キャラの表示: ドット絵をステージ上に立たせる（Sprite3D）。アニメと当たり判定は .air のまま。
## 声・効果音は .snd を .cns の PlaySnd どおりに鳴らす。
class_name SpriteView
extends Puppet

var mg: Dictionary
var sff: Mugen.Sff
var spr: Sprite3D
var cur_key := ""
var prev_key := ""
var cur_seq: Array = []
var seq_t := 0.0
var last_anim := 0
var last_face := 1
var turn_an := -1
var turn_t := 0.0
var hit_size := 0.0       # 最後に受けたダメージ（やられアニメの大きさ）
var walk_ref := 1.0       # MUGEN 側の歩き・走りの速さ（ゲームの px/フレーム）
var run_ref := 3.0
var snd := {}
var cues := {}
var voice: AudioStreamPlayer
var fx: AudioStreamPlayer
var played := {}
var played_move = null
var ps := 0.01
var fx_defs := {}          # アニメ番号 -> Explod の一覧（.cns から）
var fx_live: Array = []    # 出ているエフェクト {node, anim, start, x, y, face, bind, keep, move}
var fx_done := {}
var fx_move = null


func setup(fighter: Fighter) -> void:
	f = fighter
	mg = f.ch.mugen
	var act = null
	var palp := Mugen.find_file(mg.folder, mg.files.get("pal1", ""))
	if palp.to_lower().ends_with(".act"):
		act = Mugen.load_act(palp)
	sff = Mugen.Sff.new(Mugen.find_file(mg.folder, mg.files.get("sprite", "")), act if act != null else null)
	spr = Sprite3D.new()
	spr.shaded = false
	spr.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
	spr.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	spr.double_sided = true
	ps = mg.scale * K
	spr.pixel_size = ps
	add_child(spr)
	# 試合中に止まらないよう、使うアニメの絵を先に読んでおく
	for an in mg.state_map.values() + mg.move_plan.values() + mg.spec_anims.values():
		for fr in mg.air[an].frames:
			sff.get_sprite(fr.g, fr.i)
	# 声・効果音
	snd = Mugen.parse_snd(Mugen.find_file(mg.folder, mg.files.get("sound", "")))
	var paths := []
	for k in ["cns", "st", "stcommon", "st0", "st1", "st2", "st3", "st4"]:
		var p := Mugen.find_file(mg.folder, mg.files.get(k, ""))
		if p != "" and not p in paths:
			paths.append(p)
	cues = Mugen.parse_cns_cues(paths, mg.air, fx_defs)
	# 歩き・走りの足の速さを、MUGEN 側の移動速度と比べて合わせる
	for p in paths:
		for ln in FileAccess.get_file_as_string(p).split("\n"):
			var l := ln.get_slice(";", 0).strip_edges().to_lower().replace(" ", "")
			if l.begins_with("walk.fwd="):
				walk_ref = max(0.2, abs(float(l.substr(9).get_slice(",", 0))) * mg.scale)
			elif l.begins_with("run.fwd="):
				run_ref = max(0.5, abs(float(l.substr(8).get_slice(",", 0))) * mg.scale)
	for an in mg.move_plan.values() + mg.spec_anims.values() + _kit_anims():
		for e in fx_defs.get(an, []):
			if e.has("anim"):
				for fr in mg.air[e.anim].frames:
					var tr: String = fr.get("tr", "")
					sff.get_sprite_blend(fr.g, fr.i, "A" if tr == "" and e.get("add", false) else tr)
	voice = AudioStreamPlayer.new()
	add_child(voice)
	fx = AudioStreamPlayer.new()
	fx.max_polyphony = 4
	add_child(fx)
	_build_overlays()


# ------------------------------------------------------------ どの絵を出すか
# 状態ごとのアニメの並び（つなぎ → 本体）。数字は MUGEN の標準アニメ番号。無い番号は飛ばす
func _has(an: int) -> bool:
	return mg.air.has(an) and not mg.air[an].frames.is_empty()


func _seq(lst: Array) -> Array:
	return lst.filter(func(an): return _has(an))


func _pick(cands: Array) -> Array:
	## 候補のうち最初にあるアニメ 1 つ（代わりの候補。続けて流すのは _seq）
	for an in cands:
		if _has(an):
			return [an]
	return []


func _choose() -> Array:
	## [並びの名前, アニメ番号の並び, 最後をループするか, 再生速度]
	var s := f.state
	var pk := prev_key
	var spd: float = abs(f.vx)
	match s:
		"stand", "respawn":
			if s == "stand" and f.crouch:
				return ["crouch", _seq([10, 11]) if pk != "crouch" and pk != "crouch_in" else _seq([11]), true, 1.0]
			if s == "stand" and spd > f.st.walk + 0.5:
				return ["run", _pick([100, 20]), true, clamp(spd / max(0.1, run_ref), 0.8, 3.0)]
			if s == "stand" and spd > 0.6:
				var back: bool = f.vx * f.face < 0 and _has(21)
				return ["walkb" if back else "walk", _seq([21] if back else [20]), true, clamp(spd / max(0.1, walk_ref), 0.7, 2.2)]
			if pk == "crouch":
				return ["stand_up", _seq([12, 0]), true, 1.0]
			if pk == "run":
				return ["run_stop", _seq([101, 0]), true, 1.0]
			return ["stand", _seq([0]), true, 1.0]
		"jumpsquat":
			return ["jumpsquat", _pick([40, 10]), false, 1.0]
		"air", "walltech":
			if f.vy < 0:
				if cur_key.begins_with("rise"):
					return [cur_key, cur_seq, false, 1.0]   # 跳んだ瞬間の向きで決めたまま
				var dirv: float = f.vx * f.face
				if dirv > 1.5 and _has(42):
					return ["rise_f", _seq([42]), false, 1.0]
				if dirv < -1.5 and _has(43):
					return ["rise_b", _seq([43]), false, 1.0]
				return ["rise", _seq([41]), false, 1.0]
			return ["fall", _pick([44, 46, 41]), true, 1.0]
		"helpless":
			return ["fall", _pick([44, 46, 41]), true, 1.0]
		"lag":
			if cur_key in ["shield_end", "getup", "lag_long", "land"]:
				return [cur_key, cur_seq, false, 1.0]   # 入った瞬間に決めたまま
			if cur_key == "shield" or cur_key == "shield_hit":
				return ["shield_end", _seq([140, 0]), true, 1.0]
			if pk == "down" or cur_key == "down":
				return ["getup", _seq([5120, 0]), true, 1.0]
			if f.timer >= 8:
				return ["lag_long", _pick([48, 47]), false, 1.0]
			return ["land", _pick([47, 10]), false, 1.0]
		"shield":
			if f.shieldstun > 0:
				return ["shield_hit", _seq([150, 130]), false, 1.0]
			if pk == "shield" or pk == "shield_hit":
				return ["shield", _pick([130, 120]), true, 1.0]
			return ["shield", _seq([120, 130]), true, 1.0]
		"dodge":
			var kind: String = f.dodge.kind if f.dodge != null else ""
			if kind == "roll":
				if f.dodge.dir * f.face < 0 and _has(105):
					return ["roll_b", _seq([105, 106]), false, 1.0]
				return ["roll_f", _pick([161, 105]), false, 1.0]
			if kind == "spot":
				return ["spot", _pick([160, 130]), false, 1.0]
			if kind == "tech":
				return ["tech", _pick([5200, 47]), false, 1.0]
			return ["airdodge", _pick([162, 132, 41]), false, 1.0]
		"hitstun":
			if f.tumble and f.ground == null:
				if f.vy + f.ky < 0:
					return ["tumble_up", _pick([5050, 5030]), true, 1.0]
				return ["tumble_down", _pick([5061, 5050]), true, 1.0]
			if f.ground == null:
				return ["hit_air", _pick([5030, 5000]), false, 1.0]
			var g := 5000 if hit_size < 12 else (5001 if hit_size < 25 else 5002)
			return ["hit%d" % g, _pick([g, 5000]), false, 1.0]
		"knockdown":
			return ["down", _seq([5100, 5110]) if pk != "down" else cur_seq, true, 1.0]
		"grabbed":
			return ["grabbed", _seq([5000]), true, 1.0]
		"hold":
			return ["hold", _pick([810, 800, 0]), false, 1.0]
		"dizzy":
			return ["dizzy", _pick([5300, 5000]), true, 1.0]
		"ledge":
			return ["ledge", _seq([41]), false, 0.0]
		"climb":
			return ["climb", _seq([40, 47]), false, 1.0]
	var an = mg.state_map.get(s, mg.state_map.get("stand"))
	return [s, [an] if an != null else [], true, 1.0]


func _warp_index(d: MoveDef, mf: int, a: Dictionary) -> int:
	var n: int = a.frames.size()
	if n <= 1:
		return 0
	var total: int = max(1, d.total)
	if d.hits.is_empty():
		return min(n - 1, int(float(mf) / total * n))
	var s := 999
	var e := 0
	for h in d.hits:
		s = min(s, h.f0)
		e = max(e, h.f1)
	var k := n / 2
	for i in range(n):
		if not a.frames[i].c1.is_empty():
			k = i
			break
	if mf < s:
		return min(k, int(float(mf) / max(1, s) * k)) if k > 0 else 0
	if mf <= e:
		return k
	var rest := n - k - 1
	if rest <= 0:
		return k
	return min(n - 1, k + 1 + int(float(mf - e - 1) / max(1, total - e) * rest))


func _frame() -> Array:
	## [アニメ番号, フレーム番号, 反転するか, ワザ中のティック]
	var dt: int = max(0, f.anim - last_anim)
	last_anim = f.anim
	if f.state == "move" and f.move != null and f.move.d.spr != null and mg.air.has(f.move.d.spr):
		var d := f.move.d
		var a: Dictionary = mg.air[d.spr]
		var tick := 0
		var idx := 0
		if d.spr_mode == "direct":
			tick = max(0, f.move.f - 1 - d.spr_delay)
			idx = Mugen.frame_at(a, tick, false)
		else:
			idx = _warp_index(d, f.move.f, a)
			tick = int(float(f.move.f) / max(1, d.total) * Mugen.anim_length(a))
		prev_key = "move"
		cur_key = "move"
		last_face = f.face
		return [d.spr, idx, d.spr_flip, tick]
	var c := _choose()
	var key: String = c[0]
	if key != cur_key or c[1] != cur_seq:
		if key != cur_key:
			prev_key = cur_key
		cur_key = key
		cur_seq = c[1]
		seq_t = 0.0
	else:
		seq_t += dt * float(c[3])
	if cur_seq.is_empty():
		return []
	# 振り向き（立ち・歩き・しゃがみで向きが変わったとき）
	if f.face != last_face:
		if key in ["stand", "walk", "walkb", "run_stop", "stand_up"] and _has(5):
			turn_an = 5
			turn_t = 0.0
		elif key == "crouch" and _has(6):
			turn_an = 6
			turn_t = 0.0
		last_face = f.face
	if turn_an >= 0:
		var ta: Dictionary = mg.air[turn_an]
		turn_t += dt
		if turn_t < Mugen.anim_length(ta) and key in ["stand", "walk", "walkb", "crouch", "run_stop", "stand_up"]:
			return [turn_an, Mugen.frame_at(ta, int(turn_t), false), false, -1]
		turn_an = -1
	# 並びの中のどのアニメの何ティック目か
	var t := int(seq_t)
	var loop: bool = c[2]
	for n in range(cur_seq.size()):
		var an: int = cur_seq[n]
		var a2: Dictionary = mg.air[an]
		var ln := Mugen.anim_length(a2)
		var last := n == cur_seq.size() - 1
		if last:
			return [an, Mugen.frame_at(a2, t, loop), false, -1]
		if t < ln:
			return [an, Mugen.frame_at(a2, t, false), false, -1]
		t -= ln
	return []


# ------------------------------------------------------------ 表示
func refresh() -> void:
	visible = f.alive() and not f.hidden
	if not visible:
		return
	var fr := _frame()
	if fr.is_empty():
		return
	var a: Dictionary = mg.air[fr[0]]
	var fd: Dictionary = a.frames[fr[1]]
	var s = sff.get_sprite(fd.g, fd.i)
	if s == null:
		return
	var shake := 0.0
	if f.shake > 0:
		shake = (1 if f.anim % 2 == 0 else -1) * min(6, f.shake)
	_place(spr, s, fd, f.face < 0, fr[2], f.x + shake, f.y, 0.05)
	var m := Color(1, 1, 1, 1)
	if f.dmg_flash > 6:
		m = Color(2.2, 2.2, 2.2, 1)
	elif f.state == "helpless":
		m = Color(0.55, 0.55, 0.7, 1)
	if f.state == "dodge" and f.dodge != null and f.dodge.inv[0] <= f.timer and f.timer <= f.dodge.inv[1]:
		m.a = 0.5
	if f.state == "move" and f.move.d.charge_at != null and f.move.f == f.move.d.charge_at and f.move.charge > 0 and (f.anim / 4) % 2 == 0:
		m = Color(1.8, 1.8, 1.2, 1)
	spr.modulate = m
	_play_cues(fr)
	_update_fx(fr)
	_update_overlays()


func _place(node: Sprite3D, s: Array, fd: Dictionary, face_left: bool, extra_flip: bool, px: float, py: float, z: float) -> void:
	## MUGEN の絵を 足元 (px, py) 基準で置く（基準点 axis とコマのずれ ox/oy を反映）
	var tex: ImageTexture = s[0]
	node.texture = tex
	var flip: bool = ((1 if face_left else 0) + (1 if fd.flip else 0) + (1 if extra_flip else 0)) % 2 == 1
	node.flip_h = flip
	var sgn := -1.0 if flip else 1.0
	var dx: float = (tex.get_width() / 2.0 - float(s[1]) + fd.ox) * sgn
	var dy: float = -(tex.get_height() / 2.0 - float(s[2]) + fd.oy)
	node.position = Vector3(px * K + dx * ps, -py * K + dy * ps, z)


# ------------------------------------------------------------ エフェクト（Explod）
func _kit_anims() -> Array:
	var out := []
	for k in f.moves:
		var d: MoveDef = f.moves[k]
		if d.spr != null and mg.air.has(d.spr):
			out.append(d.spr)
	return out


func _update_fx(fr: Array) -> void:
	var cur_move = f.move if f.state == "move" else null
	if cur_move != fx_move:
		fx_move = cur_move
		fx_done = {}
		for e in fx_live:
			if e.keep:
				e.dead = true
	# 新しく出すエフェクト
	if cur_move != null and fr[3] >= 0:
		var lst: Array = fx_defs.get(fr[0], [])
		for i in range(lst.size()):
			var d: Dictionary = lst[i]
			if fx_done.has(i) or fr[3] < d.t:
				continue
			fx_done[i] = true
			if d.has("remove"):
				for e in fx_live:
					if e.keep:
						e.dead = true
				continue
			var node := Sprite3D.new()
			node.shaded = false
			node.alpha_cut = SpriteBase3D.ALPHA_CUT_DISABLED
			node.texture_filter = spr.texture_filter
			node.double_sided = true
			node.pixel_size = ps
			add_child(node)
			fx_live.append({"node": node, "anim": d.anim, "start": f.anim, "x": f.x, "y": f.y, "face": f.face,
				"ox": d.x * mg.scale, "oy": d.y * mg.scale, "bind": d.bind, "keep": d.keep, "add": d.get("add", false), "dead": false})
	# 動かす・消す
	var keep_list := []
	for e in fx_live:
		var a: Dictionary = mg.air[e.anim]
		var t: int = f.anim - e.start
		if e.dead or (not e.keep and t >= Mugen.anim_length(a)) or not visible:
			e.node.queue_free()
			continue
		var fd: Dictionary = a.frames[Mugen.frame_at(a, t, e.keep)]
		var tr: String = fd.get("tr", "")
		if tr == "" and e.add:
			tr = "A"
		var s = sff.get_sprite_blend(fd.g, fd.i, tr)
		if s == null:
			e.node.visible = false
		else:
			e.node.visible = true
			var bx: float = f.x if e.bind else e.x
			var by: float = f.y if e.bind else e.y
			var face: int = f.face if e.bind else e.face
			_place(e.node, s, fd, face < 0, false, bx + e.ox * face, by + e.oy, 0.07)
		keep_list.append(e)
	fx_live = keep_list


# ------------------------------------------------------------ 声・効果音
func _play_key(g: int, s: int, rnd := 0) -> void:
	var ss := s + (randi() % rnd if rnd > 0 else 0)
	var key := "%d,%d" % [g, ss]
	if not snd.has(key):
		key = "%d,%d" % [g, s]
		if not snd.has(key):
			return
	var p: AudioStreamPlayer = voice if g >= 100 else fx
	p.stream = snd[key]
	p.play()


func _play_cues(fr: Array) -> void:
	if f.state != "move" or f.move == null or fr[3] < 0:
		return
	if played_move != f.move:
		played_move = f.move
		played = {}
	for i in range(cues.get(fr[0], []).size()):
		var c: Dictionary = cues[fr[0]][i]
		if c.on_hit or played.has(i) or fr[3] < c.t:
			continue
		played[i] = true
		if c.prob < 1.0 and randf() > c.prob:
			continue
		_play_key(c.g, c.s, c.rnd)


func on_event(e: Dictionary) -> void:
	## main から: このキャラが関わるイベント
	match e.kind:
		"block":
			if e.get("by") == f and snd.has("6,0"):
				fx.stream = snd["6,0"]
				fx.play()
		"djump":
			if e.get("who") == f:
				cur_key = ""   # 2段ジャンプは跳び直しの絵から
		"hit":
			if e.get("who") == f:
				hit_size = float(e.dmg) * 2.0
				var d: float = e.dmg
				var g := 5000 if d < 5 else (5001 if d < 12 else 5002)
				if not voice.playing or d >= 5:
					_play_group(g)
			elif e.get("by") == f:
				# 自分の攻撃が当たった音（.cns の hitsound と同じ S5,1〜4 を強さで選ぶ）
				var dd: float = e.dmg
				var n := 1 if dd < 4 else (2 if dd < 8 else (3 if dd < 12 else 4))
				if snd.has("5,%d" % n):
					fx.stream = snd["5,%d" % n]
					fx.play()
				if f.state != "move" or f.move == null or f.move.d.spr == null:
					return
				for c in cues.get(f.move.d.spr, []):
					if c.on_hit:
						_play_key(c.g, c.s, c.rnd)
		"ko":
			if e.get("who") == f:
				_play_group(11)
		"awaken":
			if e.get("who") == f:
				_play_group(3000)


func _play_group(g: int) -> void:
	var keys := []
	for k in snd:
		if k.begins_with("%d," % g):
			keys.append(k)
	if keys.is_empty():
		return
	voice.stream = snd[keys[randi() % keys.size()]]
	voice.play()
