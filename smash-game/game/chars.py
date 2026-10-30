"""ファイター定義（ステータス・見た目・必殺ワザ）。"""
import math
from .moves import Move, H, common_moves


def _stick_dir(f, default=(0.0, -1.0)):
    x, y = f.inp.x, f.inp.y
    n = math.hypot(x, y)
    if n < 0.3:
        return default
    return x / n, y / n


def _once(m, f, frames):
    return m.f == frames


# ================================================================ ブレイズ（炎・バランス）

def blaze_specials():
    def fire_n(w, f, m):
        if m.f == 12:
            w.spawn_proj(f, 'fire', f.x + f.face * 36, f.y - 50, 7.5 * f.face, -2.0, r=13, dmg=5, ang=40,
                         bkb=25, kbg=35, life=110, grav=0.32, bounce=3, color=(255, 120, 40))

    def rush(w, f, m):
        if 8 <= m.f <= 22:
            f.vx = 12.5 * f.face
            f.vy = 0
        elif m.f > 22:
            f.vx *= 0.8

    def rise(w, f, m):
        if m.f == 3:
            f.vy = -19.5
            f.vx = f.inp.x * 4
            f.ground = None

    def dive(w, f, m):
        if m.f == 8:
            f.ground = None
        if m.f >= 8:
            f.vy = 22
            f.vx = 0

    def dive_land(w, f, m):
        f.start_move(w, 'd_land')
        return True

    return {
        'nspecial': Move('nspecial', 36, on_frame=fire_n, name='ファイアボール', pose='cast'),
        'sspecial': Move('sspecial', 42, [H(8, 22, 30, -44, 30, 12, 38, 50, 80, fx='fire', limb='hand')],
                         on_frame=rush, nograv=(6, 24), keep_vx=True, once='side', name='フレイムラッシュ', pose='dash'),
        'uspecial': Move('uspecial', 46, [H(3, 8, 22, -56, 32, 10, 80, 50, 85, fx='fire', limb='hand'),
                                          H(9, 20, 10, -76, 26, 5, 80, 40, 60, fx='fire', group=1, limb='hand')],
                         on_frame=rise, helpless=True, once='up', ledge_ok=True, keep_vx=True,
                         name='ライジングフレア', pose='uppercut'),
        'dspecial': Move('dspecial', 40, [H(10, 14, 44, -20, 42, 12, 70, 55, 80, both=True, fx='fire')],
                         name='イラプション', pose='stomp'),
        'dspecial_air': Move('dspecial_air', 80, [H(8, 80, 0, -10, 30, 11, 280, 30, 70, fx='fire')],
                             on_frame=dive, on_land=dive_land, nograv=(1, 7), no_drift=True,
                             name='メテオクラッシュ', pose='stomp'),
        'd_land': Move('d_land', 24, [H(1, 4, 44, -20, 46, 10, 65, 60, 70, both=True, fx='fire')],
                       name='メテオクラッシュ', pose='stomp'),
    }


# ================================================================ アクア（水・テクニック）

def aqua_specials():
    def shot(w, f, m):
        if m.f == 8:
            c = m.charge / 60.0
            w.spawn_proj(f, 'shot', f.x + f.face * 40, f.y - 48, (11 + 3 * c) * f.face, 0, r=9 + 15 * c,
                         dmg=4 + 18 * c, ang=40, bkb=25 + 30 * c, kbg=40 + 55 * c, life=90, color=(90, 220, 255))

    def slash(w, f, m):
        if 6 <= m.f <= 12:
            f.vx = 20 * f.face
            f.vy = 0
        elif m.f > 12:
            f.vx *= 0.6

    def warp(w, f, m):
        if m.f <= 12:
            f.vx = f.vy = 0
            f.hidden = True
        if m.f == 1:
            m.data['dir'] = _stick_dir(f)
        if m.f == 12:
            dx, dy = _stick_dir(f, m.data['dir'])
            f.x += dx * 240
            f.y += dy * 240
            f.ground = None
            f.hidden = False
            if dx:
                f.face = 1 if dx > 0 else -1
            w.event('warp', f.x, f.y - 40, color=(90, 220, 255))

    return {
        'nspecial': Move('nspecial', 30, on_frame=shot, charge_at=4, charge_btn='special', charge_max=60,
                         name='チャージショット', pose='cast'),
        'sspecial': Move('sspecial', 36, [H(6, 12, 20, -44, 32, 9, 45, 45, 75, fx='water', limb='hand')],
                         on_frame=slash, inv=(6, 12), nograv=(5, 14), keep_vx=True, once='side',
                         name='アクアスラッシュ', pose='dash'),
        'uspecial': Move('uspecial', 36, [H(13, 18, 0, -44, 38, 6, 80, 50, 50, fx='water')],
                         on_frame=warp, inv=(1, 14), nograv=(1, 14), helpless=True, once='up', ledge_ok=True,
                         keep_vx=True, name='ワープ', pose='cast'),
        'dspecial': Move('dspecial', 40, counter=(4, 24), reflect=True, nograv=(1, 30), name='ミラーカウンター',
                         pose='counter'),
        'd_hit': Move('d_hit', 30, inv=(1, 22), name='ミラーカウンター', pose='bigpunch'),
    }


# ================================================================ ガイア（大地・重量級）

def gaia_specials():
    def leaf(w, f, m):
        if m.f == 14:
            if any(p.owner is f and p.kind == 'leaf' for p in w.projs):
                return
            w.spawn_proj(f, 'leaf', f.x + f.face * 40, f.y - 50, 12 * f.face, 0, r=16, dmg=6, ang=50,
                         bkb=30, kbg=50, life=140, ax=-0.38 * f.face, ret=True, color=(120, 230, 110))

    def bash(w, f, m):
        if 8 <= m.f <= 20:
            f.vx = 8.5 * f.face
            if not f.ground:
                f.vy = 0
        elif m.f > 20:
            f.vx *= 0.8

    def copter(w, f, m):
        if 4 <= m.f <= 38:
            f.vy = -9 + (m.f - 4) * 0.17
            f.vx = f.inp.x * 4.5
            f.ground = None

    def fall(w, f, m):
        if m.f >= 8:
            f.vy = 16
            f.vx *= 0.9

    def fall_land(w, f, m):
        f.start_move(w, 'd_land')
        return True

    return {
        'nspecial': Move('nspecial', 40, on_frame=leaf, name='リーフブーメラン', pose='throwf'),
        'sspecial': Move('sspecial', 46, [H(10, 20, 38, -44, 34, 14, 40, 60, 85, fx='big', shieldmul=2.0, limb='hand')],
                         on_frame=bash, armor=(6, 22), keep_vx=True, once='side', name='シールドバッシュ',
                         pose='dash'),
        'uspecial': Move('uspecial', 64, [H(4, 38, 0, -50, 46, 1.5, 85, 28, 0, rehit=6, fx='ring'),
                                          H(40, 44, 0, -50, 52, 6, 80, 60, 70, group=1, fx='ring')],
                         on_frame=copter, nograv=(4, 38), helpless=True, once='up', ledge_ok=True, keep_vx=True,
                         name='スピンコプター', pose='spin'),
        'dspecial': Move('dspecial', 44, [H(14, 18, 64, -16, 44, 13, 80, 60, 85, both=True, fx='quake', shieldmul=1.5)],
                         name='アースクエイク', pose='stomp'),
        'dspecial_air': Move('dspecial_air', 80, [H(8, 80, 0, -10, 32, 10, 280, 30, 70)], on_frame=fall,
                             on_land=fall_land, no_drift=True, name='アースクエイク', pose='stomp'),
        'd_land': Move('d_land', 30, [H(1, 5, 64, -16, 48, 12, 80, 60, 80, both=True, fx='quake')],
                       name='アースクエイク', pose='stomp'),
    }


# ================================================================ ボルト（雷・スピード）

def volt_specials():
    def bolt(w, f, m):
        if m.f == 14:
            tx = f.x + f.face * 190
            gy = w.ground_below(tx, f.y - 20)
            if gy is None:
                gy = f.y + 120
            w.spawn_proj(f, 'bolt', tx, gy, 0, 0, r=0, rect=(46, 340), dmg=9, ang=80, bkb=50, kbg=72,
                         life=16, reflectable=False, pierce=True, color=(255, 235, 90))

    def sdash(w, f, m):
        if 8 <= m.f <= 26 and not m.data.get('hit'):
            f.vx = 16 * f.face
            f.vy = 0
        elif m.f > 26:
            f.vx *= 0.8

    def sdash_hit(w, f, m, t):
        m.data['hit'] = True
        f.vx = -4 * f.face
        f.vy = -6

    def zip_(w, f, m):
        if m.f == 3:
            m.data['d1'] = _stick_dir(f)
        if 3 <= m.f <= 11:
            dx, dy = m.data['d1']
            f.vx, f.vy = dx * 21, dy * 21
            f.ground = None if dy < 0.2 else f.ground
        elif 12 <= m.f <= 15:
            f.vx *= 0.3
            f.vy *= 0.3
        if m.f == 16:
            n = math.hypot(f.inp.x, f.inp.y)
            m.data['d2'] = (f.inp.x / n, f.inp.y / n) if n > 0.3 else None
        if 16 <= m.f <= 23 and m.data.get('d2'):
            dx, dy = m.data['d2']
            f.vx, f.vy = dx * 21, dy * 21
        if m.f == 24:
            f.vx *= 0.5
            f.vy *= 0.3

    def thunder(w, f, m):
        if not f.ground and m.f < 30:
            f.vy = min(f.vy, 1.5)

    return {
        'nspecial': Move('nspecial', 40, on_frame=bolt, name='サンダーピラー', pose='cast'),
        'sspecial': Move('sspecial', 44, [H(8, 26, 24, -42, 30, 11, 45, 40, 85, fx='elec')],
                         on_frame=sdash, nograv=(8, 26), keep_vx=True, once='side', name='スパークダッシュ',
                         pose='dash', on_hit=sdash_hit),
        'uspecial': Move('uspecial', 40, [H(3, 11, 0, -40, 30, 3, 80, 40, 30, fx='elec'),
                                          H(16, 23, 0, -40, 30, 4, 80, 40, 40, group=1, fx='elec')],
                         on_frame=zip_, nograv=(3, 26), helpless=True, once='up', ledge_ok=True, keep_vx=True,
                         no_drift=True, name='電光石火', pose='spin'),
        'dspecial': Move('dspecial', 52, [H(12, 30, 0, -42, 76, 12, 70, 60, 80, fx='elec', radial=True)],
                         on_frame=thunder, name='かみなり', pose='cast'),
    }


# ================================================================ タイタン（投げキャラ・超重量級）

def titan_specials():
    def wave(w, f, m):
        if m.f == 16:
            w.spawn_proj(f, 'wave', f.x + f.face * 40, f.y - 22, 9 * f.face, 0, r=22, dmg=8, ang=60,
                         bkb=45, kbg=60, life=50, grav=0.6, color=(200, 140, 255), ground_wave=True)

    def lunge(w, f, m):
        if 6 <= m.f <= 20:
            f.vx = 9 * f.face
        elif m.f > 20:
            f.vx *= 0.7

    def slam(w, f, m):
        t = f.grab_target
        if t is None:
            return
        if m.f < 26:
            t.x = f.x + f.face * 6
            t.y = f.y - f.h + 10 - min(m.f, 14) * 3
        if m.f == 14:
            f.vy = -11
            f.ground = None
        if m.f == 28:
            w.throw_release(f, dict(dmg=14, ang=75, bkb=75, kbg=75), dirsign=f.face)

    def upper(w, f, m):
        if m.f == 5:
            f.vy = -18
            f.vx = f.inp.x * 3
            f.ground = None

    def press(w, f, m):
        if m.f == 4 and f.ground:
            f.vy = -9
            f.ground = None
        if m.f >= 12:
            f.vy = 18

    def press_land(w, f, m):
        if m.f < 6:
            return False
        f.start_move(w, 'd_land')
        return True

    return {
        'nspecial': Move('nspecial', 44, on_frame=wave, name='ショックウェーブ', pose='stomp'),
        'sspecial': Move('sspecial', 50, [H(8, 20, 42, -46, 32, 0, 0, 0, 0, grab=True, cmd=True, limb='hand')],
                         on_frame=lunge, keep_vx=True, once='side', name='ギガントキャッチ', pose='grab'),
        's_throw': Move('s_throw', 46, on_frame=slam, keep_vx=True, nograv=(1, 13), name='ギガントスラム',
                        pose='throwu'),
        'uspecial': Move('uspecial', 50, [H(5, 14, 24, -70, 36, 12, 85, 55, 80, fx='big', limb='hand')],
                         on_frame=upper, armor=(4, 14), helpless=True, once='up', ledge_ok=True, keep_vx=True,
                         name='タイタンアッパー', pose='uppercut'),
        'dspecial': Move('dspecial', 90, [H(12, 90, 0, 0, 36, 12, 280, 30, 70)], on_frame=press,
                         on_land=press_land, no_drift=True, name='ボディプレス', pose='stomp'),
        'd_land': Move('d_land', 28, [H(1, 4, 56, -18, 50, 12, 60, 60, 85, both=True, fx='quake')],
                       name='ボディプレス', pose='stomp'),
    }


class CharDef:
    def __init__(self, key, name, title, desc, look, stats, specials_fn, awaken, power=1.0):
        self.key, self.name, self.title, self.desc = key, name, title, desc
        self.look = look
        self.stats = stats
        self.specials_fn = specials_fn
        self.awaken = awaken
        self.power = power
        self.hw = stats.get('hw', 22)
        self.side_recover = key in ('blaze', 'aqua', 'volt')
        self.sprites = None
        self.voices = None
        self.h = stats.get('h', 84)

    def build_moves(self):
        mv = common_moves(self.power)
        mv.update(self.specials_fn())
        return mv


def _st(weight, walk, run, air, airacc, grav, fall, ffall, jump, short, djump, friction=0.6, jumps=1, **kw):
    d = dict(weight=weight, walk=walk, run=run, air=air, airacc=airacc, grav=grav, fall=fall, ffall=ffall,
             jump=jump, short=short, djump=djump, friction=friction, jumps=jumps)
    d.update(kw)
    return d


CHARS = [
    CharDef('blaze', 'ブレイズ', '炎の拳士', '何でもこなすバランス型。飛び道具も復帰もそろった初心者向け。',
            dict(body=(214, 58, 48), accent=(255, 170, 60), skin=(255, 214, 180), hair=(150, 30, 30),
                 eye=(60, 20, 10), style='spiky'),
            _st(100, 4.5, 8.6, 6.0, 0.45, 0.55, 9.5, 14.0, 14.6, 9.6, 14.0),
            blaze_specials, 'インフェルノ・ノヴァ'),
    CharDef('aqua', 'アクア', '水の魔導士', 'ためショットとワープで戦うテクニック型。カウンターで飛び道具も返す。',
            dict(body=(40, 120, 220), accent=(120, 230, 255), skin=(255, 222, 196), hair=(30, 70, 160),
                 eye=(20, 60, 140), style='long'),
            _st(92, 4.2, 8.0, 6.4, 0.5, 0.5, 9.0, 13.5, 15.0, 9.8, 14.4),
            aqua_specials, 'タイダル・レクイエム', power=0.95),
    CharDef('gaia', 'ガイア', '大地の守護者', 'ふっとびにくい重量級。アーマー付きの突進で強引に攻める。',
            dict(body=(60, 150, 70), accent=(200, 230, 120), skin=(230, 190, 150), hair=(70, 50, 30),
                 eye=(30, 40, 20), style='bandana'),
            _st(118, 3.6, 7.0, 5.0, 0.36, 0.62, 10.5, 15.0, 14.2, 9.4, 13.0, hw=25, h=88),
            gaia_specials, 'ガイア・カタストロフ', power=1.1),
    CharDef('volt', 'ボルト', '雷の疾風', '超スピードの軽量級。手数で押すがふっとびやすい。',
            dict(body=(240, 200, 40), accent=(255, 255, 160), skin=(255, 220, 190), hair=(250, 230, 90),
                 eye=(140, 90, 0), style='ears'),
            _st(84, 5.2, 10.6, 7.0, 0.56, 0.62, 10.5, 16.0, 15.6, 10.2, 14.6, hw=20, h=76),
            volt_specials, 'ライトニング・ストーム', power=0.9),
    CharDef('titan', 'タイタン', '鋼の投げ師', '投げが強力な超重量級。横必殺ワザはガード不能のつかみ。',
            dict(body=(120, 70, 170), accent=(220, 180, 255), skin=(210, 160, 120), hair=(40, 30, 40),
                 eye=(30, 10, 40), style='bald'),
            _st(126, 3.3, 6.6, 4.8, 0.32, 0.6, 10.5, 15.0, 13.8, 9.0, 12.6, hw=28, h=96),
            titan_specials, 'タイタン・メテオドライバー', power=1.15),
]

CHAR_BY_KEY = {c.key: c for c in CHARS}
