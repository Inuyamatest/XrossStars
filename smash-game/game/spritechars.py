"""画像キャラ（MUGEN / 連番画像）を CharDef にする。

ワザの性能（ダメージ・ふっとばし・必殺ワザの動き）は既存キャラを土台にし、
見た目と当たり判定の位置を画像側から取る。
"""
import glob
import json
import os
import re

import pygame

from .chars import CharDef, CHAR_BY_KEY, _st
from .moves import common_moves
from . import sprites as S

TARGET_H = 92
SPECIAL_DEPS = {'nspecial': [], 'sspecial': ['s_throw'], 'uspecial': [], 'dspecial': ['d_land', 'd_hit']}
SPECIAL_SLOTS = ('nspecial', 'sspecial', 'uspecial', 'dspecial')
THROW_SLOTS = ('fthrow', 'bthrow', 'uthrow', 'dthrow')


def take_specials(plan):
    out = {}
    for slot, base in plan.items():
        src = CHAR_BY_KEY[base].specials_fn()
        for k in [slot, slot + '_air'] + SPECIAL_DEPS[slot]:
            if k in src:
                out[k] = src[k]
    return out


class SpriteCharDef(CharDef):
    def __init__(self, key, name, title, desc, look, stats, sprites, special_plan, move_hook, awaken,
                 power=1.0, side_recover=True, source=''):
        super().__init__(key, name, title, desc, look, stats, None, awaken, power)
        self.sprites = sprites
        self.special_plan = special_plan
        self.move_hook = move_hook
        self.side_recover = side_recover
        self.source = source

    def build_moves(self):
        mv = common_moves(self.power)
        mv.update(take_specials(self.special_plan))
        self.move_hook(mv)
        return mv


def _avg_color(surf):
    rgba = S.to_rgba(surf)
    w, h = rgba.get_size()
    tot = [0, 0, 0]
    n = 0
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            c = rgba.get_at((x, y))
            if c.a > 0:
                tot[0] += c.r
                tot[1] += c.g
                tot[2] += c.b
                n += 1
    if not n:
        return (200, 120, 160)
    return tuple(min(255, int(v / n)) for v in tot)


def _look_from(surf, accent=None):
    body = _avg_color(surf) if surf is not None else (200, 120, 160)
    acc = accent or tuple(min(255, int(v + (255 - v) * 0.5)) for v in body)
    return dict(body=body, accent=acc, skin=(255, 220, 200), hair=body, eye=(30, 30, 30), style='long')


# ================================================================ MUGEN

def _set_sprite_move(m, ref, mode='warp', hit=None, flip=False):
    m.spr_delay = getattr(m, 'spr_delay', 0)
    m.spr = ref
    m.spr_mode = mode
    m.spr_hit = hit
    m.spr_flip = flip


def _mugen_move(m, slot, anim, ref, scale):
    wins = S.clsn_windows(anim, scale)
    if not wins or slot in THROW_SLOTS:
        _set_sprite_move(m, ref)
        return
    tmpl = dict(m.hits[0]) if m.hits else None
    if tmpl is None:
        _set_sprite_move(m, ref)
        return
    n = len(wins)
    hits = []
    for gi, (a, b, r) in enumerate(wins):
        h = dict(tmpl)
        if slot == 'bair':
            r = (-r[2], r[1], -r[0], r[3])
        h['f'] = (a, b)
        h['rect'] = r
        h['x'] = (r[0] + r[2]) / 2
        h['y'] = (r[1] + r[3]) / 2
        h['r'] = max(8.0, min(r[2] - r[0], r[3] - r[1]) / 2)
        h['group'] = gi
        h['rehit'] = 0
        h['both'] = slot == 'dsmash'
        if n > 1 and gi < n - 1 and not tmpl.get('grab'):
            h['dmg'] = max(1.0, round(tmpl['dmg'] * 0.5 / (n - 1), 1))
            h['ang'], h['bkb'], h['kbg'] = 75, 25, 12
        elif n > 1 and not tmpl.get('grab'):
            h['dmg'] = round(tmpl['dmg'] * 0.6, 1)
        hits.append(h)
        if tmpl.get('grab'):
            break
    # 発生が早すぎる絵（1フレーム目から判定がある等）は、最初の絵を長めに見せて元のワザの発生に近づける
    want = max(1, int(tmpl['f'][0] * 0.6))
    delay = max(0, want - hits[0]['f'][0])
    for h in hits:
        h['f'] = (h['f'][0] + delay, h['f'][1] + delay)
    m.spr_delay = delay
    m.hits = hits
    m.total = min(max(anim.length + delay, hits[-1]['f'][1] + 4), 150)
    if m.charge_at is not None:
        m.charge_at = max(1, hits[0]['f'][0] - 2)
    if m.chain:
        m.chain = (min(m.total, hits[-1]['f'][1] + 1), m.chain[1])
    _set_sprite_move(m, ref, 'direct', flip=(slot == 'bair'))


def load_mugen(folder):
    defs = sorted(glob.glob(os.path.join(folder, '*.def')))
    for dp in defs:
        info, files = S.parse_def(dp)
        sffp = S._find(folder, files.get('sprite'))
        airp = S._find(folder, files.get('anim'))
        if sffp and airp:
            break
    else:
        raise ValueError('.def / .sff / .air が見つかりません')
    act = None
    palp = S._find(folder, files.get('pal1'))
    if palp and palp.lower().endswith('.act'):
        act = S.load_act(palp)
    sff = S.Sff(sffp, act if open(sffp, 'rb').read(16)[15] != 2 else None)
    air = S.parse_air(open(airp, 'r', encoding='latin-1').read())
    stand = air.get(0)
    if stand is None or not stand.frames:
        raise ValueError('立ちアニメ(0番)がありません')
    sp0 = sff.get(stand.frames[0].key)
    c2 = stand.frames[0].clsn2
    if c2:
        height = -min(b[1] for b in c2)
        width = max(b[2] for b in c2) - min(b[0] for b in c2)
    elif sp0:
        height, width = sp0[2], sp0[0].get_width() * 0.5
    else:
        height, width = 100, 40
    scale = TARGET_H / max(20, height)

    state_map = {}
    for k, cands in S.MUGEN_STATE_ANIMS.items():
        for c in cands:
            if c in air and air[c].frames:
                state_map[k] = c
                break
    move_plan = {}
    used = set()
    for slot, cands in S.MUGEN_MOVE_ANIMS.items():
        need_clsn = slot not in THROW_SLOTS
        ok = [c for c in cands if c in air and air[c].frames and (not need_clsn or S._has_clsn1(air[c]))]
        if not ok:
            continue
        fresh = [c for c in ok if c not in used]
        pick = fresh[0] if fresh else ok[0]
        move_plan[slot] = pick
        used.add(pick)
    specials = [n for n in sorted(air) if 1000 <= n < 3000 and air[n].frames]
    spec_anims = {}
    for slot, n in zip(SPECIAL_SLOTS, specials[:4] if len(specials) >= 4 else specials):
        spec_anims[slot] = n
    # 必殺ワザが足りなければ通常技で代用
    for slot, fb in zip(SPECIAL_SLOTS, ('fair', 'dash', 'uair', 'dsmash')):
        if slot not in spec_anims and fb in move_plan:
            spec_anims[slot] = move_plan[fb]

    def hook(mv):
        for slot, ref in move_plan.items():
            if slot in mv:
                _mugen_move(mv[slot], slot, air[ref], ref, scale)
        for slot, ref in spec_anims.items():
            for k in (slot, slot + '_air') + tuple(SPECIAL_DEPS[slot]):
                if k in mv:
                    _set_sprite_move(mv[k], ref)

    def portrait():
        for key in ((9000, 1), (9000, 0)):
            r = sff.get(key)
            if r is not None and r[0].get_width() > 8:
                return r[0]
        if sp0:
            s = sp0[0]
            w = s.get_width()
            return s.subsurface((0, 0, w, min(w, s.get_height())))
        return None

    sprites = S.SpriteSet(sff.get, air, scale, state_map, portrait)
    name = info.get('displayname') or info.get('name') or os.path.basename(folder)
    look = _look_from(sp0[0] if sp0 else None)
    hw = max(16, min(30, width * scale / 2))
    stats = _st(98, 4.4, 8.4, 6.0, 0.45, 0.56, 9.6, 14.2, 14.8, 9.7, 14.0, hw=hw, h=TARGET_H)
    key = 'mugen_' + re.sub(r'\W+', '_', os.path.basename(folder)).lower()
    return SpriteCharDef(key, name, 'MUGENキャラ', '%s（作者: %s）' % (name, info.get('author', '不明')), look, stats,
                         sprites, {s: 'blaze' for s in SPECIAL_SLOTS}, hook, '覚醒・%s' % name, source=folder)


# ================================================================ 連番画像

_ZEN = str.maketrans('０１２３４５６７８９', '0123456789')


def _motion_files(img_dir, prefix):
    res = []
    for p in os.listdir(img_dir):
        base, ext = os.path.splitext(p)
        if ext.lower() not in ('.bmp', '.png', '.gif', '.jpg'):
            continue
        if not base.startswith(prefix):
            continue
        rest = base[len(prefix):].translate(_ZEN).strip()
        if rest.isdigit():
            res.append((int(rest), p))
    return [p for _, p in sorted(res)]


class _PackImages:
    def __init__(self, img_dir, colorkey):
        self.dir = img_dir
        self.ck = tuple(colorkey) if colorkey else None
        self.cache = {}
        self.raw = {}

    def image(self, fname):
        s = self.raw.get(fname)
        if s is None:
            s = pygame.image.load(os.path.join(self.dir, fname))
            if self.ck is not None:
                s.set_colorkey(self.ck)
            s = S.to_rgba(s)
            self.raw[fname] = s
        return s

    def get(self, key):
        if key in self.cache:
            return self.cache[key]
        fname, anchor = key
        try:
            s = self.image(fname)
        except (pygame.error, FileNotFoundError):
            self.cache[key] = None
            return None
        w, h = s.get_size()
        m = pygame.mask.from_surface(s)
        rects = m.get_bounding_rects()
        if not rects:
            res = (s, w / 2, h)
        else:
            bb = rects[0].unionall(rects[1:]) if len(rects) > 1 else rects[0]
            if anchor == 'center':
                res = (s, bb.centerx, bb.centery)
            else:
                y0 = int(bb.bottom - max(2, bb.height * 0.12))
                sx = n = 0
                for y in range(max(0, y0), bb.bottom):
                    for x in range(bb.left, bb.right, 2):
                        if m.get_at((x, y)):
                            sx += x
                            n += 1
                res = (s, (sx / n) if n else bb.centerx, bb.bottom)
        self.cache[key] = res
        return res


def _reach(imgs, fname, direction, scale):
    """当たる絵のいちばん先（前/上/下/後ろ）を、足元基準のワールド座標で返す。"""
    s, ax, ay = imgs.get((fname, 'feet'))
    m = pygame.mask.from_surface(s)
    rects = m.get_bounding_rects()
    if not rects:
        return None
    bb = rects[0].unionall(rects[1:]) if len(rects) > 1 else rects[0]

    def avg(coords):
        return sum(coords) / len(coords) if coords else 0
    if direction in ('fwd', 'back'):
        xs = range(bb.right - 1, bb.right - 1 - max(2, bb.width // 10), -1)
        ys = [y for x in xs for y in range(bb.top, bb.bottom, 2) if m.get_at((x, y))]
        x = bb.right - ax
        y = avg(ys) - ay
        if direction == 'back':
            x = -x
    elif direction == 'up':
        yr = range(bb.top, bb.top + max(2, bb.height // 10))
        xs = [x for y in yr for x in range(bb.left, bb.right, 2) if m.get_at((x, y))]
        x, y = avg(xs) - ax, bb.top - ay
    else:
        yr = range(bb.bottom - 1, bb.bottom - 1 - max(2, bb.height // 10), -1)
        xs = [x for y in yr for x in range(bb.left, bb.right, 2) if m.get_at((x, y))]
        x, y = avg(xs) - ax, bb.bottom - ay
    return x * scale, y * scale


DEFAULT_DIR = {'utilt': 'up', 'usmash': 'up', 'uair': 'up', 'dair': 'down', 'bair': 'back', 'nair': None,
               'dsmash': 'fwd', 'grab': 'fwd', 'dashgrab': 'fwd'}


def load_pack(folder):
    cfg = json.load(open(os.path.join(folder, 'char.json'), encoding='utf-8'))
    img_dir = os.path.join(folder, cfg.get('image_dir', '.'))
    if not os.path.isdir(img_dir):
        raise ValueError('画像フォルダ %s がありません' % img_dir)
    imgs = _PackImages(img_dir, cfg.get('colorkey'))
    anims = {}

    def build(spec):
        files = _motion_files(img_dir, spec['motion'])
        if spec.get('pick'):
            files = [files[i - 1] for i in spec['pick'] if 0 < i <= len(files)]
        if not files:
            return None
        if spec.get('pingpong') and len(files) > 2:
            files = files + files[-2:0:-1]
        anchor = spec.get('anchor', 'feet')
        sp = int(spec.get('speed', 5))
        a = S.Anim([S.Frame((f, anchor), sp) for f in files])
        return a

    stand_spec = cfg['anims']['stand']
    stand_files = _motion_files(img_dir, stand_spec['motion'])
    if not stand_files:
        raise ValueError('立ちモーション %s の画像がありません' % stand_spec['motion'])
    s0, _, ay0 = imgs.get((stand_files[0], 'feet'))
    scale = cfg.get('height', TARGET_H) / max(20, ay0 - s0.get_bounding_rect().top)
    char_h = cfg.get('height', TARGET_H)

    state_map = {}
    for k, spec in cfg['anims'].items():
        a = build(spec)
        if a is None:
            continue
        if spec.get('anchor') == 'center':
            for fr in a.frames:
                fr.oy = -(char_h / 2) / scale
        ref = 'state:' + k
        anims[ref] = a
        state_map[k] = ref
    move_plan = {}
    for slot, spec in list(cfg.get('moves', {}).items()) + list(cfg.get('specials', {}).items()):
        a = build(spec)
        if a is None:
            continue
        ref = 'move:' + slot
        anims[ref] = a
        hit = spec.get('hit')
        hit0 = hit - 1 if hit else None
        reach = None
        d = spec.get('dir', DEFAULT_DIR.get(slot, 'fwd'))
        if hit0 is not None and d and slot not in SPECIAL_SLOTS:
            reach = _reach(imgs, a.frames[hit0].key[0], d, scale)
        move_plan[slot] = (ref, hit0, reach, bool(spec.get('flip')))

    def hook(mv):
        for slot, (ref, hit0, reach, flip) in move_plan.items():
            keys = [slot]
            if slot in SPECIAL_SLOTS:
                keys += [slot + '_air'] + SPECIAL_DEPS[slot]
            for k in keys:
                m = mv.get(k)
                if m is None:
                    continue
                _set_sprite_move(m, ref, 'warp', hit0, flip)
                if reach and k == slot and m.hits:
                    h = dict(m.hits[0])
                    rx, ry = reach
                    r = h['r']
                    if abs(rx) > 6:
                        h['x'] = rx - (r * 0.6 if rx > 0 else -r * 0.6)
                    else:
                        h['x'] = rx
                    if d_up(slot):
                        h['y'] = ry + r * 0.6
                    elif d_down(slot):
                        h['y'] = ry - r * 0.6
                    else:
                        h['y'] = ry
                    m.hits[0] = h

    def d_up(slot):
        return cfg.get('moves', {}).get(slot, {}).get('dir', DEFAULT_DIR.get(slot)) == 'up'

    def d_down(slot):
        return cfg.get('moves', {}).get(slot, {}).get('dir', DEFAULT_DIR.get(slot)) == 'down'

    def portrait():
        ps = cfg.get('portrait', {})
        files = _motion_files(img_dir, ps.get('motion', stand_spec['motion'])) or stand_files
        s = imgs.image(files[min(len(files), ps.get('frame', 1)) - 1])
        bb = s.get_bounding_rect()
        size = int(bb.width * ps.get('size', 0.55))
        cx = bb.left + bb.width * ps.get('x', 0.5)
        return s.subsurface(pygame.Rect(int(cx - size / 2), bb.top, size, size).clip(s.get_rect()))

    sprites = S.SpriteSet(imgs.get, anims, scale, state_map, portrait)
    base = cfg.get('stats_base', 'blaze')
    stats = dict(CHAR_BY_KEY[base].stats)
    stats.update(cfg.get('stats', {}))
    stats['h'] = char_h
    stats.setdefault('hw', 24)
    look = dict(_look_from(s0))
    for k, v in cfg.get('look', {}).items():
        look[k] = tuple(v) if isinstance(v, list) else v
    special_plan = {s: cfg.get('specials', {}).get(s, {}).get('base', 'blaze') for s in SPECIAL_SLOTS}
    key = 'pack_' + re.sub(r'\W+', '_', os.path.basename(folder)).lower()
    return SpriteCharDef(key, cfg.get('name', os.path.basename(folder)), cfg.get('title', ''), cfg.get('desc', ''),
                         look, stats, sprites, special_plan, hook, cfg.get('awaken', '覚醒'),
                         power=cfg.get('power', 1.0), source=folder)


# ================================================================ 探す

def discover():
    """mugen/ と charpacks/ にあるキャラを読み込む。失敗したものは (フォルダ, 理由) で返す。"""
    found, errors = [], []
    for base, fn, test in ((S.PACK_DIR, load_pack, lambda d: os.path.exists(os.path.join(d, 'char.json'))),
                           (S.MUGEN_DIR, load_mugen, lambda d: bool(glob.glob(os.path.join(d, '*.def'))))):
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            d = os.path.join(base, name)
            if not os.path.isdir(d) or not test(d):
                continue
            try:
                found.append(fn(d))
            except Exception as e:  # 1キャラ壊れていてもゲームは起動させる
                errors.append((d, str(e)))
    return found, errors
