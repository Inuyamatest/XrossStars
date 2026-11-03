## MUGEN キャラの表示: ドット絵をステージ上に立たせる（Sprite3D）。アニメと当たり判定は .air のまま。
## 声・効果音は .snd を .cns の PlaySnd どおりに鳴らす。
class_name SpriteView
extends Puppet

var mg: Dictionary
var sff: Mugen.Sff
var spr: Sprite3D
var cur_key := ""
var cur_start := 0
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
func _state_key() -> String:
	var s := f.state
	if s == "stand" or s == "respawn":
		if s == "stand" and f.crouch:
			return "crouch"
		var sp: float = abs(f.vx)
		if s == "stand" and sp > f.st.walk + 0.5:
			return "run"
		if s == "stand" and sp > 0.6:
			return "walk"
		return "stand"
	if s == "lag":
		return "land"
	if s == "jumpsquat":
		return "jumpsquat"
	if s == "air" or s == "walltech":
		return "rise" if f.vy < 0 else "fall"
	if s == "dodge":
		var k: String = f.dodge.kind if f.dodge != null else ""
		return {"roll": "roll", "spot": "spot", "tech": "land"}.get(k, "airdodge")
	if s == "hitstun":
		return "tumble" if f.tumble and f.ground == null else "hit"
	if s == "knockdown":
		return "getup" if f.timer > 20 and mg.state_map.has("getup") else "down"
	return s


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
		return [d.spr, idx, d.spr_flip, tick]
	var key := _state_key()
	var an = mg.state_map.get(key, mg.state_map.get("stand"))
	if an == null:
		return []
	if key != cur_key:
		cur_key = key
		cur_start = f.anim
	var loop := not (key in ["rise", "land", "jumpsquat", "hit", "down", "getup", "roll", "climb"])
	var t := f.anim - cur_start
	if key == "ledge":
		t = 0
	return [an, Mugen.frame_at(mg.air[an], t, loop), false, -1]


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
		"hit":
			if e.get("who") == f:
				var d: float = e.dmg
				var g := 5000 if d < 5 else (5001 if d < 12 else 5002)
				if not voice.playing or d >= 5:
					_play_group(g)
			elif e.get("by") == f and f.state == "move" and f.move != null and f.move.d.spr != null:
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
