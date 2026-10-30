"""描画: カメラ・背景・ステージ・キャラ（手続き生成）・エフェクト・HUD。"""
import math
import random
import pygame
from . import config as C

W, H = C.W, C.H

# ---------------------------------------------------------------- フォント

_FONT_CANDIDATES = ['yugothicui', 'yugothic', 'meiryo', 'msgothic', 'hiraginosans', 'hiraginokakugothicpro',
                    'notosanscjkjp', 'notosansjp', 'ipagothic', 'ipaexgothic', 'takaogothic', 'wenquanyizenhei']
_font_path = None
_fonts = {}
_text_cache = {}


def font(size, bold=False):
    global _font_path
    key = (size, bold)
    if key in _fonts:
        return _fonts[key]
    if _font_path is None:
        _font_path = ''
        for name in _FONT_CANDIDATES:
            p = pygame.font.match_font(name)
            if p:
                _font_path = p
                break
    f = pygame.font.Font(_font_path or None, size)
    f.set_bold(bold)
    _fonts[key] = f
    return f


def text(s, size, color=(255, 255, 255), bold=False, outline=None, ow=2):
    key = (s, size, color, bold, outline, ow)
    surf = _text_cache.get(key)
    if surf is not None:
        return surf
    f = font(size, bold)
    base = f.render(s, True, color)
    if outline:
        o = f.render(s, True, outline)
        surf = pygame.Surface((base.get_width() + ow * 2, base.get_height() + ow * 2), pygame.SRCALPHA)
        for dx in range(-ow, ow + 1):
            for dy in range(-ow, ow + 1):
                if dx * dx + dy * dy <= ow * ow + 1:
                    surf.blit(o, (dx + ow, dy + ow))
        surf.blit(base, (ow, ow))
    else:
        surf = base
    if len(_text_cache) > 600:
        _text_cache.clear()
    _text_cache[key] = surf
    return surf


def blit_text(dst, s, size, pos, color=(255, 255, 255), anchor='topleft', bold=False, outline=None, ow=2):
    t = text(s, size, color, bold, outline, ow)
    r = t.get_rect(**{anchor: pos})
    dst.blit(t, r)
    return r


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(int(lerp(c1[i], c2[i], t)) for i in range(3))


def darker(c, k=0.55):
    return tuple(int(v * k) for v in c[:3])


def lighter(c, k=0.45):
    return tuple(int(v + (255 - v) * k) for v in c[:3])


def damage_color(p):
    stops = [(0, (255, 255, 255)), (40, (255, 240, 150)), (80, (255, 170, 60)), (120, (255, 80, 50)),
             (180, (200, 20, 30)), (300, (120, 0, 10))]
    for i in range(len(stops) - 1):
        a, b = stops[i], stops[i + 1]
        if p <= b[0]:
            return mix(a[1], b[1], (p - a[0]) / (b[0] - a[0]))
    return stops[-1][1]


# ---------------------------------------------------------------- キャラ描画

def limb_points(root, end, length, bend):
    rx, ry = root
    ex, ey = end
    dx, dy = ex - rx, ey - ry
    d = math.hypot(dx, dy) or 0.001
    if d > length:
        ex, ey = rx + dx / d * length, ry + dy / d * length
        d = length
    mx, my = (rx + ex) / 2, (ry + ey) / 2
    off = math.sqrt(max(0.0, (length / 2) ** 2 - (d / 2) ** 2)) * bend
    nx, ny = -dy / d, dx / d
    return (rx, ry), (mx + nx * off, my + ny * off), (ex, ey)


class Pose:
    __slots__ = ('hf', 'hb', 'ff', 'fb', 'lean', 'drop', 'rot', 'pivot', 'alpha', 'tint', 'eyes', 'headtilt')

    def __init__(self):
        self.hf = (12, -30)
        self.hb = (-10, -30)
        self.ff = (9, 0)
        self.fb = (-9, 0)
        self.lean = 0.0
        self.drop = 0.0
        self.rot = 0.0
        self.pivot = None
        self.alpha = 255
        self.tint = None
        self.eyes = 'open'
        self.headtilt = 0.0


def compute_pose(f):
    p = Pose()
    t = f.anim
    st = f.state
    hh = f.h
    if st in ('stand', 'respawn', 'dizzy'):
        sp = abs(f.vx)
        if f.crouch:
            p.drop = 16
            p.ff, p.fb = (13, 0), (-11, 0)
            p.hf, p.hb = (16, -22), (-6, -20)
        elif sp > 0.6 and st == 'stand':
            ph = t * (0.16 + sp * 0.028)
            amp = min(1.0, sp / 7.0)
            p.ff = (math.sin(ph) * 17 * amp, -max(0.0, math.cos(ph)) * 10 * amp)
            p.fb = (-math.sin(ph) * 17 * amp, -max(0.0, -math.cos(ph)) * 10 * amp)
            p.hf = (-math.sin(ph) * 14 * amp + 6, -30 + abs(math.cos(ph)) * 2)
            p.hb = (math.sin(ph) * 14 * amp - 4, -30)
            p.lean = 5 * amp
            p.drop = abs(math.sin(ph)) * 2 * amp
        else:
            b = math.sin(t * 0.08) * 1.4
            p.drop = b + 1
            p.hf, p.hb = (13, -29 + b), (-10, -30 + b)
        if st == 'dizzy':
            p.lean = math.sin(t * 0.1) * 6
            p.eyes = 'dizzy'
    elif st in ('jumpsquat', 'lag'):
        p.drop = 12
        p.ff, p.fb = (12, 0), (-10, 0)
        p.hf, p.hb = (14, -24), (-12, -24)
    elif st in ('air', 'helpless', 'walltech'):
        if f.vy < 0:
            p.ff, p.fb = (8, -14), (-7, -6)
            p.hf, p.hb = (12, -52), (-12, -46)
        else:
            p.ff, p.fb = (7, -2), (-9, -8)
            p.hf, p.hb = (17, -56), (-15, -54)
        if st == 'helpless':
            p.tint = (40, 40, 60)
            p.eyes = 'tired'
    elif st == 'shield':
        p.drop = 8
        p.ff, p.fb = (12, 0), (-10, 0)
        p.hf, p.hb = (16, -42), (10, -36)
    elif st == 'dodge':
        d = f.dodge or {}
        tt = f.timer / max(1, d.get('total', 30))
        if d.get('kind') == 'roll':
            p.rot = tt * math.pi * 2 * d.get('dir', 1) * f.face
            p.pivot = (0, -hh * 0.45)
            p.drop = 18
            p.ff, p.fb = (8, -12), (-6, -10)
            p.hf, p.hb = (8, -36), (-6, -36)
        elif d.get('kind') == 'tech':
            p.drop = 12
            p.ff, p.fb = (12, 0), (-10, 0)
            p.hf, p.hb = (14, -24), (-12, -24)
        else:
            p.ff, p.fb = (6, -4), (-8, -2)
        inv = d.get('inv', (0, 0))
        if inv[0] <= f.timer <= inv[1]:
            p.alpha = 120
            p.tint = (200, 230, 255)
    elif st == 'hitstun':
        if f.tumble:
            p.rot = t * 0.35 * (-1 if f.kx > 0 else 1)
            p.pivot = (0, -hh * 0.5)
            p.hf, p.hb = (18, -58), (-18, -56)
            p.ff, p.fb = (12, -4), (-12, -10)
        else:
            p.lean = -7
            p.hf, p.hb = (-4, -48), (-14, -44)
        p.eyes = 'hurt'
    elif st == 'knockdown':
        p.rot = -math.pi / 2
        p.pivot = (0, -hh * 0.5)
        p.drop = -hh * 0.5 + 14
        p.eyes = 'hurt'
    elif st == 'grabbed':
        p.hf, p.hb = (10, -54 + math.sin(t * 0.5) * 6), (-8, -52)
        p.ff, p.fb = (6, -2 + abs(math.sin(t * 0.4)) * 4), (-6, 0)
        p.eyes = 'hurt'
    elif st == 'hold':
        p.hf, p.hb = (26, -42), (22, -38)
        p.lean = 4
    elif st == 'ledge':
        p.hf, p.hb = (f.hw + 2, -hh * 0.72 - 2), (f.hw - 6, -hh * 0.72 - 4)
        p.ff, p.fb = (6, 6), (-4, 2)
    elif st == 'climb':
        k = min(1.0, f.timer / 22)
        p.drop = (1 - k) * hh * 0.7
        p.hf, p.hb = (16, -40), (10, -44)
        p.ff, p.fb = (14 * k, -8), (-4, 0)
    elif st == 'awaken':
        p.hf, p.hb = (16, -82), (-16, -82)
        p.ff, p.fb = (12, 0), (-12, 0)
        p.eyes = 'fierce'
    elif st == 'move':
        move_pose(f, p)
    return p


def move_pose(f, p):
    m = f.move
    d = m.d
    fr = m.f
    hits = d.hits
    name = d.pose
    p.eyes = 'fierce'
    if hits:
        s = min(h['f'][0] for h in hits)
        e = max(h['f'][1] for h in hits)
        h = next((h for h in hits if h['f'][0] <= fr <= h['f'][1]), hits[0])
    else:
        s, e, h = 6, 14, None
    if fr < s:
        k = -0.35 * (fr / max(1, s))
    elif fr <= e:
        k = 1.0
    else:
        k = max(0.0, 1.0 - (fr - e) / max(1, (d.total - e) * 0.6))
    if d.charge_at is not None and fr == d.charge_at and m.charge > 0:
        k = -0.45
        p.tint = (255, 255, 200) if (f.anim // 4) % 2 else None
    if name == 'spin' and s <= fr <= e:
        p.rot = fr * 0.6 * f.face
        p.pivot = (0, -f.h * 0.5)
        p.hf, p.hb = (22, -46), (-22, -46)
        p.ff, p.fb = (12, -10), (-12, -10)
        return
    if name == 'flipkick' and s <= fr <= e:
        p.rot = -(fr - s) / max(1, e - s + 1) * math.pi * 1.6 * f.face
        p.pivot = (0, -f.h * 0.5)
    if name == 'uppercut':
        p.hf = (10, -60 - 46 * max(0, k))
        p.hb = (-10, -34)
        p.ff, p.fb = (6, -6), (-6, 0)
        return
    if name == 'stomp':
        p.ff, p.fb = (14, 2), (-14, 2)
        p.hf, p.hb = (18, -60), (-18, -60)
        p.drop = 6 * max(0, k)
        return
    if name == 'cast':
        p.hf = (14 + 16 * max(0, k), -46)
        p.hb = (10 + 12 * max(0, k), -42)
        return
    if name == 'counter':
        p.hf, p.hb = (18, -48), (14, -36)
        p.drop = 6
        if d.in_window('counter', fr):
            p.tint = (160, 230, 255)
        return
    if name in ('throwf', 'throwb', 'throwu', 'throwd'):
        if name == 'throwu':
            p.hf, p.hb = (8, -86), (-4, -86)
        elif name == 'throwd':
            p.hf, p.hb = (24, -14), (18, -12)
            p.drop = 10
        elif name == 'throwb':
            p.hf, p.hb = (-24 * max(0.2, k), -48), (-18, -44)
            p.lean = -6
        else:
            p.hf, p.hb = (30 * max(0.3, k), -44), (24, -40)
            p.lean = 6
        return
    if name == 'dash':
        p.lean = 10
        p.drop = 4
        p.ff, p.fb = (16, -2), (-14, -6)
    if h is None:
        return
    tx, ty = h['x'], h['y']
    limb = h.get('limb') or ('foot' if ty > -34 else 'hand')
    kk = max(-0.4, k)
    if limb == 'hand' or name == 'grab':
        if tx >= 0:
            p.hf = (lerp(12, tx, kk) if kk > 0 else 12 + tx * kk, lerp(-30, ty, max(0, kk)))
        else:
            p.hb = (lerp(-10, tx, kk) if kk > 0 else -10 + tx * kk, lerp(-30, ty, max(0, kk)))
        if name == 'grab':
            p.hb = (p.hf[0] - 4, p.hf[1] + 4)
        if name == 'bigpunch':
            p.lean = 8 * kk
    else:
        if tx >= 0:
            p.ff = (lerp(9, tx, kk) if kk > 0 else 9 + tx * kk, lerp(0, ty, max(0, kk)))
            p.lean = -6 * max(0, kk)
        else:
            p.fb = (lerp(-9, tx, kk) if kk > 0 else -9 + tx * kk, lerp(0, ty, max(0, kk)))
            p.lean = 6 * max(0, kk)
        if h['both'] and kk > 0:
            p.fb = (-p.ff[0], p.ff[1])
    if name == 'backkick':
        p.hf, p.hb = (14, -40), (6, -44)


class FighterArt:
    """キャラ1体分の描画。ワールド→画面変換は呼び出し側から渡す。"""

    @staticmethod
    def draw(surf, f, to_screen, zoom, glow=False):
        if f.hidden or f.state == 'dead':
            return
        if getattr(f.char, 'sprites', None) is not None:
            SpriteArt.draw(surf, f, to_screen, zoom)
            FighterArt.overlays(surf, f, to_screen, zoom)
            return
        look = f.char.look
        p = compute_pose(f)
        s = f.h / 84.0
        face = f.face
        sx = f.shake and ((f.anim % 2) * 2 - 1) * min(6, f.shake) or 0
        rot = p.rot
        pv = p.pivot or (0, 0)
        cr, sr = math.cos(rot), math.sin(rot)

        def P(lx, ly):
            lx, ly = lx * s, ly * s + p.drop * s
            if rot:
                px, py = pv[0] * s, pv[1] * s
                dx, dy = lx - px, ly - py
                lx, ly = px + dx * cr - dy * sr, py + dx * sr + dy * cr
            return to_screen(f.x + lx * face + sx, f.y + ly)

        z = zoom * s
        tint = p.tint
        if f.dmg_flash > 6:
            tint = (255, 255, 255)

        def col(c):
            return mix(c, tint, 0.55) if tint else c

        body = col(look['body'])
        acc = col(look['accent'])
        skin = col(look['skin'])
        hair = col(look['hair'])
        dark = darker(look['body'], 0.35)
        outline = (18, 16, 26)

        target = surf
        layer = None
        if p.alpha < 255:
            layer = pygame.Surface(surf.get_size(), pygame.SRCALPHA)
            target = layer

        # 覚醒オーラ
        if f.awakened > 0 or f.state == 'awaken':
            cx, cy = P(0, -42)
            rr = int((52 + math.sin(f.anim * 0.3) * 6) * z)
            aura = pygame.Surface((rr * 2 + 4, rr * 2 + 4), pygame.SRCALPHA)
            pygame.draw.circle(aura, (*look['accent'], 70), (rr + 2, rr + 2), rr)
            pygame.draw.circle(aura, (*look['accent'], 150), (rr + 2, rr + 2), rr, max(1, int(3 * z)))
            target.blit(aura, (cx - rr - 2, cy - rr - 2))

        shoulder = (p.lean, -46 + 0)
        hip = (p.lean * 0.3, -26)
        lw = max(2, int(8 * z))
        ow = lw + max(2, int(4 * z))

        def limb(root, end, length, color, bendsign, end_color=None, end_r=5.0):
            a, b, c = limb_points(root, end, length, bendsign)
            pa, pb, pc = P(*a), P(*b), P(*c)
            pygame.draw.lines(target, outline, False, [pa, pb, pc], ow)
            for q in (pa, pb, pc):
                pygame.draw.circle(target, outline, q, ow // 2)
            pygame.draw.lines(target, color, False, [pa, pb, pc], lw)
            for q in (pa, pb):
                pygame.draw.circle(target, color, q, lw // 2)
            er = max(2, int(end_r * z))
            pygame.draw.circle(target, outline, pc, er + max(1, int(2 * z)))
            pygame.draw.circle(target, end_color or color, pc, er)

        # 奥の手足
        limb(hip, p.fb, 28, darker(body, 0.7), -1, darker(acc, 0.8), 6)
        limb(shoulder, p.hb, 24, darker(body, 0.75), 1, darker(skin, 0.85), 5)

        # 胴
        pts = [P(shoulder[0] - 11, shoulder[1] - 2), P(shoulder[0] + 11, shoulder[1] - 2),
               P(hip[0] + 10, hip[1] + 4), P(hip[0] - 10, hip[1] + 4)]
        pygame.draw.polygon(target, outline, pts)
        pygame.draw.lines(target, outline, True, pts, max(2, int(5 * z)))
        pygame.draw.polygon(target, body, pts)
        belt_a, belt_b = P(hip[0] - 10, hip[1] - 1), P(hip[0] + 10, hip[1] - 1)
        pygame.draw.line(target, acc, belt_a, belt_b, max(2, int(4 * z)))
        cx, cy = P(shoulder[0] + 2, shoulder[1] + 9)
        pygame.draw.circle(target, acc, (cx, cy), max(2, int(4 * z)))

        # 手前の手足
        limb(hip, p.ff, 28, body if look['style'] != 'bald' else darker(body, 0.85), -1, acc, 6)

        # 頭
        hx, hy = P(shoulder[0] + 1, -64)
        hr = max(4, int(18 * z))
        FighterArt.head(target, look, hx, hy, hr, face if not rot or abs(math.cos(rot)) > 0.3 else face,
                        p.eyes, outline, col)
        limb(shoulder, p.hf, 24, body, 1, skin, 5.5)

        if layer is not None:
            layer.set_alpha(p.alpha)
            surf.blit(layer, (0, 0))
        FighterArt.overlays(surf, f, to_screen, zoom)

    @staticmethod
    def overlays(surf, f, to_screen, zoom):
        # シールド
        if f.state == 'shield':
            cx, cy = to_screen(f.x, f.y - f.h * 0.5)
            k = max(0.25, f.shield_hp / C.SHIELD_MAX)
            rr = int((f.h * 0.62) * k * zoom + 8 * zoom)
            sh = pygame.Surface((rr * 2 + 4, rr * 2 + 4), pygame.SRCALPHA)
            c = f.color
            a = 90 + (60 if f.shieldstun > 0 else 0)
            pygame.draw.circle(sh, (*c, a), (rr + 2, rr + 2), rr)
            pygame.draw.circle(sh, (*lighter(c, 0.5), 220), (rr + 2, rr + 2), rr, max(2, int(3 * zoom)))
            pygame.draw.circle(sh, (255, 255, 255, 110), (rr + 2 - rr // 3, rr + 2 - rr // 3), max(2, rr // 5))
            surf.blit(sh, (cx - rr - 2, cy - rr - 2))
        if f.state == 'dizzy':
            cx, cy = to_screen(f.x, f.y - f.h - 8)
            for i in range(3):
                a = f.anim * 0.12 + i * 2.1
                star(surf, (cx + math.cos(a) * 22 * zoom, cy + math.sin(a) * 7 * zoom), 7 * zoom, (255, 230, 80))
        if f.state == 'respawn':
            cx, cy = to_screen(f.x, f.y + 4)
            rw = int(70 * zoom)
            pygame.draw.ellipse(surf, (255, 255, 255), (cx - rw, cy - 6 * zoom, rw * 2, 14 * zoom))
            pygame.draw.ellipse(surf, f.color, (cx - rw + 4, cy - 4 * zoom, rw * 2 - 8, 10 * zoom))

    @staticmethod
    def head(target, look, hx, hy, hr, face, eyes, outline, col=lambda c: c):
        skin = col(look['skin'])
        hair = col(look['hair'])
        acc = col(look['accent'])
        style = look['style']
        ow = max(2, hr // 6)
        # 後ろ髪
        if style == 'long':
            pts = [(hx - face * hr * 1.05, hy - hr * 0.3), (hx - face * hr * 1.3, hy + hr * 1.5),
                   (hx + face * hr * 0.1, hy + hr * 1.2), (hx + face * hr * 0.5, hy)]
            pygame.draw.polygon(target, outline, pts)
            pygame.draw.lines(target, outline, True, pts, ow * 2)
            pygame.draw.polygon(target, hair, pts)
        if style == 'bandana':
            for k in (0, 1):
                tail = [(hx - face * hr * 0.9, hy - hr * 0.35), (hx - face * hr * (1.9 + k * 0.3), hy - hr * (0.1 - k * 0.6)),
                        (hx - face * hr * (1.7 + k * 0.2), hy + hr * (0.25 + k * 0.4))]
                pygame.draw.polygon(target, outline, tail)
                pygame.draw.polygon(target, acc, tail)
        if style == 'ears':
            for side, ang in ((1, -0.35), (-1, -0.75)):
                bx = hx + face * side * hr * 0.45
                ex = bx + face * side * hr * 0.55
                pts = [(bx - hr * 0.35, hy - hr * 0.6), (ex, hy - hr * 2.0), (bx + hr * 0.35, hy - hr * 0.75)]
                pygame.draw.polygon(target, outline, pts)
                pygame.draw.lines(target, outline, True, pts, ow * 2)
                pygame.draw.polygon(target, hair, pts)
                tip = [(lerp(pts[0][0], pts[1][0], 0.65), lerp(pts[0][1], pts[1][1], 0.65)), pts[1],
                       (lerp(pts[2][0], pts[1][0], 0.65), lerp(pts[2][1], pts[1][1], 0.65))]
                pygame.draw.polygon(target, (30, 24, 20), tip)
        pygame.draw.circle(target, outline, (hx, hy), hr + ow)
        pygame.draw.circle(target, skin, (hx, hy), hr)
        # 前髪・頭
        if style == 'spiky':
            for i in range(5):
                a = math.pi * (1.05 + i * 0.2)
                bx, by = hx + math.cos(a) * hr * 0.8, hy + math.sin(a) * hr * 0.8
                tip = (hx + math.cos(a) * hr * 1.75 - face * hr * 0.35, hy + math.sin(a) * hr * 1.6)
                pts = [(bx - math.sin(a) * hr * 0.4, by + math.cos(a) * hr * 0.4), tip,
                       (bx + math.sin(a) * hr * 0.4, by - math.cos(a) * hr * 0.4)]
                pygame.draw.polygon(target, outline, pts)
                pygame.draw.lines(target, outline, True, pts, ow)
                pygame.draw.polygon(target, hair, pts)
            pygame.draw.circle(target, hair, (hx - face * hr * 0.15, hy - hr * 0.45), int(hr * 0.75))
        elif style in ('long', 'ears', 'bandana'):
            rect = pygame.Rect(0, 0, hr * 2 + 2, hr * 2 + 2)
            rect.center = (hx, hy)
            pygame.draw.circle(target, hair, (hx - face * hr * 0.1, hy - hr * 0.42), int(hr * 0.85))
            if style == 'long':
                pts = [(hx + face * hr * 0.9, hy - hr * 0.2), (hx + face * hr * 0.2, hy - hr * 0.55),
                       (hx + face * hr * 0.5, hy + hr * 0.05)]
                pygame.draw.polygon(target, hair, pts)
            if style == 'bandana':
                pygame.draw.line(target, acc, (hx - hr, hy - hr * 0.35), (hx + hr, hy - hr * 0.35), max(3, hr // 3))
        elif style == 'bald':
            pygame.draw.circle(target, lighter(skin, 0.5), (hx - face * hr * 0.3, hy - hr * 0.45), max(2, hr // 4))
            pygame.draw.line(target, acc, (hx - hr * 0.95, hy - hr * 0.2), (hx + hr * 0.95, hy - hr * 0.2), max(3, hr // 4))
        # 目
        ex = hx + face * hr * 0.38
        ey = hy + hr * 0.05
        er = max(1, hr // 6)
        eyec = look['eye']
        for k in (0, 1):
            x = ex + face * k * hr * 0.42 - face * hr * 0.12
            if eyes in ('hurt', 'dizzy'):
                d = er + 1
                pygame.draw.line(target, outline, (x - d, ey - d), (x + d, ey + d), max(1, er))
                pygame.draw.line(target, outline, (x - d, ey + d), (x + d, ey - d), max(1, er))
            elif eyes == 'tired':
                pygame.draw.line(target, outline, (x - er - 1, ey), (x + er + 1, ey), max(1, er))
            else:
                pygame.draw.ellipse(target, (255, 255, 255), (x - er - 1, ey - er * 2 - 1, er * 2 + 2, er * 3 + 2))
                pygame.draw.ellipse(target, eyec, (x - er + face * 1, ey - er * 2 + 1, er * 2, er * 3))
                if eyes == 'fierce':
                    pygame.draw.line(target, outline, (x - er - 2, ey - er * 2 - 3 - (face * k - 0.5) * 2),
                                     (x + er + 2, ey - er * 2 - 3 + (face * k - 0.5) * 2), max(1, er))


def star(surf, c, r, color):
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.45
        pts.append((c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr))
    pygame.draw.polygon(surf, color, pts)


def draw_portrait(surf, char, cx, cy, r, face=1, eyes='open'):
    sp = getattr(char, 'sprites', None)
    if sp is not None:
        img = sp.portrait(int(r * 2))
        if img is not None:
            pygame.draw.circle(surf, (18, 16, 26), (cx, cy), r + 3)
            surf.blit(img, (cx - r, cy - r))
            return
    FighterArt.head(surf, char.look, cx, cy, r, face, eyes, (18, 16, 26))


def sprite_state_key(f):
    st = f.state
    if st in ('stand', 'respawn'):
        if st == 'stand' and f.crouch:
            return 'crouch'
        sp = abs(f.vx)
        if st == 'stand' and sp > f.st['walk'] + 0.5:
            return 'run'
        if st == 'stand' and sp > 0.6:
            return 'walk'
        return 'stand' if st == 'stand' else 'respawn'
    if st == 'jumpsquat':
        return 'jumpsquat'
    if st == 'lag':
        return 'land'
    if st == 'air':
        return 'rise' if f.vy < 0 else 'fall'
    if st == 'dodge':
        k = (f.dodge or {}).get('kind')
        return {'roll': 'roll', 'spot': 'spot', 'tech': 'land'}.get(k, 'airdodge')
    if st == 'hitstun':
        return 'tumble' if f.tumble and f.ground is None else 'hit'
    if st == 'knockdown':
        return 'down'
    return {'shield': 'shield', 'grabbed': 'grabbed', 'hold': 'hold', 'ledge': 'ledge', 'climb': 'climb',
            'dizzy': 'dizzy', 'helpless': 'helpless', 'awaken': 'awaken', 'walltech': 'airdodge'}.get(st, 'stand')


class SpriteArt:
    track = {}

    @staticmethod
    def frame_for(f, sp):
        """いま表示する (Frame, 反転するか)。"""
        if f.state == 'move' and f.move is not None:
            d = f.move.d
            anim = sp.anim(getattr(d, 'spr', None))
            if anim is not None and anim.frames:
                if getattr(d, 'spr_mode', 'warp') == 'direct':
                    idx = anim.index_at(max(0, f.move.f - 1 - getattr(d, 'spr_delay', 0)), loop=False)
                else:
                    idx = warp_index(d, f.move.f, len(anim.frames), getattr(d, 'spr_hit', None))
                return anim.frames[idx], getattr(d, 'spr_flip', False)
        key = getattr(f, 'pose_override', None) or sprite_state_key(f)
        ref = sp.state_map.get(key) or sp.state_map.get('stand')
        anim = sp.anim(ref)
        if anim is None or not anim.frames:
            return None, False
        tid = getattr(f, 'track_id', None) or id(f)
        cur = SpriteArt.track.get(tid)
        if cur is None or cur[0] != key:
            cur = (key, f.anim)
            SpriteArt.track[tid] = cur
        t = f.anim - cur[1]
        loop = key in ('stand', 'walk', 'run', 'tumble', 'dizzy', 'respawn', 'shield', 'hold', 'grabbed', 'ledge',
                       'fall', 'awaken', 'win')
        return anim.frames[anim.index_at(t, loop=loop)], False

    @staticmethod
    def draw(surf, f, to_screen, zoom):
        sp = f.char.sprites
        fr, mflip = SpriteArt.frame_for(f, sp)
        if fr is None:
            return
        k = sp.scale * zoom
        flip = (f.face < 0) ^ bool(fr.flip) ^ bool(mflip)
        res = sp.scaled(fr.key, k, flip)
        if res is None:
            return
        img, ax, ay = res
        sx = f.shake and ((f.anim % 2) * 2 - 1) * min(6, f.shake) or 0
        px, py = to_screen(f.x + fr.ox * sp.scale * f.face + sx, f.y + fr.oy * sp.scale)
        # 覚醒オーラ
        if f.awakened > 0 or f.state == 'awaken':
            cx, cy = to_screen(f.x, f.y - f.h / 2)
            rr = int((f.h * 0.62 + math.sin(f.anim * 0.3) * 6) * zoom)
            aura = pygame.Surface((rr * 2 + 4, rr * 2 + 4), pygame.SRCALPHA)
            pygame.draw.circle(aura, (*f.char.look['accent'], 70), (rr + 2, rr + 2), rr)
            pygame.draw.circle(aura, (*f.char.look['accent'], 150), (rr + 2, rr + 2), rr, max(1, int(3 * zoom)))
            surf.blit(aura, (cx - rr - 2, cy - rr - 2))
        alpha = 255
        if f.state == 'dodge' and f.dodge and f.dodge['inv'][0] <= f.timer <= f.dodge['inv'][1]:
            alpha = 130
        tint = None
        if f.dmg_flash > 6:
            tint = (150, 150, 150)
        elif f.state == 'helpless':
            tint = 'dark'
        elif f.state == 'move' and f.move.d.charge_at is not None and f.move.f == f.move.d.charge_at \
                and f.move.charge > 0 and (f.anim // 4) % 2:
            tint = (90, 90, 40)
        if tint is not None or alpha < 255:
            img = img.copy()
            if tint == 'dark':
                img.fill((120, 120, 150), special_flags=pygame.BLEND_RGB_MULT)
            elif tint is not None:
                img.fill(tint, special_flags=pygame.BLEND_RGB_ADD)
            if alpha < 255:
                img.set_alpha(alpha)
        surf.blit(img, (px - ax, py - ay))


def warp_index(d, mf, n, hit_idx=None):
    """ワザの経過フレームを、画像の枚数に合わせて割り振る（攻撃判定の間は「当たる絵」を出す）。"""
    total = max(1, d.total)
    if n <= 1:
        return 0
    if not d.hits:
        return min(n - 1, int(mf / total * n))
    s = min(h['f'][0] for h in d.hits)
    e = max(h['f'][1] for h in d.hits)
    k = hit_idx if hit_idx is not None else n // 2
    k = max(0, min(n - 1, k))
    if mf < s:
        return min(k, int(mf / max(1, s) * k)) if k else 0
    if mf <= e:
        return k
    rest = n - k - 1
    if rest <= 0:
        return k
    return min(n - 1, k + 1 + int((mf - e - 1) / max(1, total - e) * rest))


def draw_full_body(surf, char, x, y, scale, face=1, anim=0, pose='idle'):
    """メニュー用の全身。ダミーの Fighter 風オブジェクトで描画する。"""
    class Dummy:
        pass
    d = Dummy()
    d.char, d.h, d.hw, d.face, d.anim = char, char.h, char.hw, face, anim
    d.state, d.vx, d.vy, d.crouch, d.hidden = 'stand', 0, 0, False, False
    d.shake = d.dmg_flash = d.awakened = 0
    d.x, d.y, d.shield_hp, d.shieldstun, d.color = 0, 0, 50, 0, (255, 255, 255)
    d.timer = 0
    d.move = None
    d.inv = 0
    d.dodge = None
    d.st = char.stats
    d.pose_override = None
    d.track_id = ('menu', char.key, int(x), int(y))
    if pose == 'win':
        d.state = 'awaken'
        d.pose_override = 'win'
    FighterArt.draw(surf, d, lambda wx, wy: (x + wx * scale, y + wy * scale), scale)


# ---------------------------------------------------------------- パーティクル

class Particle:
    __slots__ = ('kind', 'x', 'y', 'vx', 'vy', 'life', 'max', 'size', 'color', 'ang', 'data')

    def __init__(self, kind, x, y, vx=0.0, vy=0.0, life=20, size=10, color=(255, 255, 255), ang=0.0, data=None):
        self.kind, self.x, self.y, self.vx, self.vy = kind, x, y, vx, vy
        self.life = self.max = life
        self.size, self.color, self.ang, self.data = size, color, ang, data


# ---------------------------------------------------------------- 本体

class Renderer:
    def __init__(self, screen, world):
        self.screen = screen
        self.w = world
        self.cx, self.cy, self.zoom = 0.0, -150.0, 0.8
        self.shake = 0.0
        self.sx = self.sy = 0.0
        self.parts = []
        self.flash = 0
        self.flash_color = (255, 255, 255)
        self.banners = []
        self.cut_in = None
        self.rng = random.Random(1)
        self.bg = self.make_bg(world.stage.theme)
        self.stars = [(self.rng.uniform(-1, 1), self.rng.uniform(-1, 1), self.rng.uniform(0.5, 2.2)) for _ in range(120)]
        self.hud_shake = {}
        self.ko_lines = []

    # ------------------------------------------------------------ 背景
    def make_bg(self, theme):
        themes = {
            'dusk': [(30, 20, 60), (120, 60, 110), (250, 150, 90)],
            'space': [(4, 4, 18), (18, 12, 50), (60, 30, 90)],
            'sky': [(60, 140, 230), (130, 190, 250), (220, 240, 255)],
        }
        cols = themes.get(theme, themes['dusk'])
        bg = pygame.Surface((W, H))
        for y in range(H):
            t = y / H
            c = mix(cols[0], cols[1], t * 2) if t < 0.5 else mix(cols[1], cols[2], (t - 0.5) * 2)
            pygame.draw.line(bg, c, (0, y), (W, y))
        return bg

    def draw_bg(self):
        s = self.screen
        s.blit(self.bg, (0, 0))
        theme = self.w.stage.theme
        px, py = self.cx * 0.05, self.cy * 0.05
        if theme in ('space', 'dusk'):
            for i, (x, y, r) in enumerate(self.stars):
                sx = (x * W * 0.6 - px * r) % W
                sy = (y * H * 0.5 + H * 0.3 - py * r) % H
                if theme == 'dusk' and sy > H * 0.55:
                    continue
                tw = 150 + int(100 * math.sin(self.w.frame * 0.05 + i))
                pygame.draw.circle(s, (tw, tw, min(255, tw + 30)), (sx, sy), max(1, int(r * 0.8)))
        if theme == 'space':
            pygame.draw.circle(s, (90, 60, 140), (int(W * 0.78 - px * 2), int(H * 0.28 - py)), 90)
            pygame.draw.circle(s, (130, 90, 190), (int(W * 0.78 - px * 2 - 20), int(H * 0.28 - py - 20)), 60)
            g = pygame.Surface((W, H), pygame.SRCALPHA)
            pygame.draw.ellipse(g, (160, 100, 255, 30), (W * 0.1 - px, H * 0.35, W * 0.9, 160))
            s.blit(g, (0, 0))
        elif theme == 'dusk':
            pygame.draw.circle(s, (255, 210, 140), (int(W * 0.5 - px * 1.5), int(H * 0.62 - py)), 110)
            for layer, (col, base, amp) in enumerate([((80, 40, 80), 0.68, 60), ((50, 25, 60), 0.78, 40)]):
                pts = [(0, H)]
                off = px * (2 + layer * 2)
                for i in range(0, W + 41, 40):
                    xx = i
                    yy = H * base - py * (1 + layer) + math.sin((i + off) * 0.011 + layer) * amp + math.sin((i + off) * 0.031) * amp * 0.3
                    pts.append((xx, yy))
                pts.append((W, H))
                pygame.draw.polygon(s, col, pts)
        elif theme == 'sky':
            for i in range(7):
                cx = (i * 260 - px * (1 + i % 3) + self.w.frame * 0.2 * (1 + i % 2)) % (W + 300) - 150
                cy = 120 + (i * 97) % 260 - py
                for k in range(4):
                    pygame.draw.circle(s, (250, 252, 255), (int(cx + k * 34), int(cy + (k % 2) * 8)), 34 - (k % 2) * 6)

    # ------------------------------------------------------------ カメラ
    def to_screen(self, x, y):
        return ((x - self.cx) * self.zoom + W / 2 + self.sx, (y - self.cy) * self.zoom + H / 2 + self.sy)

    def update_camera(self):
        w = self.w
        pts = [(f.x, f.y - f.h / 2) for f in w.fighters if f.alive]
        if w.cinema:
            f = w.cinema[0]
            tz, tx, ty = 1.35, f.x, f.y - f.h / 2
        else:
            if not pts:
                pts = [(0, -100)]
            xs = [p[0] for p in pts] + [w.stage.main.x1 * 0.4, w.stage.main.x2 * 0.4]
            ys = [p[1] for p in pts] + [-60]
            bl, br, bt, bb = w.stage.blast
            minx, maxx = max(min(xs), bl + 200), min(max(xs), br - 200)
            miny, maxy = max(min(ys), bt + 200), min(max(ys), bb - 100)
            bw = max(maxx - minx + 420, 660)
            bh = max(maxy - miny + 340, 400)
            tz = max(0.42, min(1.3, min(W / bw, H / bh)))
            tx = (minx + maxx) / 2
            ty = (miny + maxy) / 2 + 50 / tz
        self.zoom += (tz - self.zoom) * 0.08
        self.cx += (tx - self.cx) * 0.1
        self.cy += (ty - self.cy) * 0.1
        if self.shake > 0.3:
            self.sx = self.rng.uniform(-1, 1) * self.shake
            self.sy = self.rng.uniform(-1, 1) * self.shake
            self.shake *= 0.86
        else:
            self.sx = self.sy = 0
            self.shake = 0

    # ------------------------------------------------------------ イベント→エフェクト
    def consume_events(self, events, audio=None):
        for e in events:
            k = e['kind']
            x, y = e['x'], e['y']
            if k == 'hit':
                dmg, kb = e['dmg'], e['kb']
                n = 6 + int(dmg)
                base = e.get('color', (255, 255, 255))
                for i in range(n):
                    a = self.rng.uniform(0, math.tau)
                    sp = self.rng.uniform(4, 10 + dmg * 0.6)
                    self.parts.append(Particle('spark', x, y, math.cos(a) * sp, math.sin(a) * sp, 14,
                                               4 + dmg * 0.4, lighter(base, 0.4), a))
                self.parts.append(Particle('ring', x, y, life=14, size=20 + dmg * 3, color=(255, 255, 255)))
                self.parts.append(Particle('burst', x, y, life=8, size=18 + dmg * 2.5, color=lighter(base, 0.6)))
                fx = e.get('fx')
                if fx in ('fire', 'elec', 'water', 'quake', 'shot', 'leaf', 'bolt', 'wave'):
                    col = {'fire': (255, 130, 40), 'elec': (255, 240, 90), 'water': (90, 220, 255),
                           'quake': (190, 140, 80), 'shot': (90, 220, 255), 'leaf': (120, 230, 110),
                           'bolt': (255, 240, 90), 'wave': (200, 140, 255)}[fx]
                    for i in range(10):
                        a = self.rng.uniform(0, math.tau)
                        self.parts.append(Particle('puff', x, y, math.cos(a) * 3, math.sin(a) * 3 - 1, 22,
                                                   10 + dmg * 0.5, col))
                self.shake = max(self.shake, min(22, dmg * 0.7 + kb * 0.06))
                who = e.get('who')
                if who is not None:
                    self.hud_shake[who.idx] = 14
                if kb > 150:
                    self.flash = 6
                    self.flash_color = (255, 255, 255)
                    for i in range(12):
                        a = self.rng.uniform(0, math.tau)
                        self.parts.append(Particle('line', x, y, math.cos(a) * 30, math.sin(a) * 30, 12, 60, (255, 255, 255), a))
            elif k == 'block':
                for i in range(6):
                    a = self.rng.uniform(0, math.tau)
                    self.parts.append(Particle('spark', x, y, math.cos(a) * 6, math.sin(a) * 6, 10, 5, lighter(e['color']), a))
                self.parts.append(Particle('hex', x, y, life=12, size=26, color=lighter(e['color'], 0.5)))
            elif k in ('jump', 'land'):
                for i in (-1, 1):
                    for j in range(3):
                        self.parts.append(Particle('puff', x + i * 10, y - 4, i * (1.5 + j), -0.5 - j * 0.3, 18,
                                                   8 + j * 2, (235, 235, 240)))
                if k == 'land' and e.get('heavy'):
                    self.shake = max(self.shake, 4)
            elif k == 'djump':
                self.parts.append(Particle('ring_flat', x, y, life=16, size=34, color=(255, 255, 255)))
            elif k == 'bounce':
                self.parts.append(Particle('ring', x, y, life=14, size=40, color=(255, 255, 255)))
                self.shake = max(self.shake, 6)
            elif k == 'ko':
                who = e['who']
                bl, br, bt, bb = self.w.stage.blast
                if x <= bl + 1:
                    ang = 0.0
                elif x >= br - 1:
                    ang = math.pi
                elif y <= bt + 1:
                    ang = math.pi / 2
                else:
                    ang = -math.pi / 2
                self.ko_lines.append([x, y, ang, 60, e['color']])
                self.shake = 26
                self.flash = 8
                self.flash_color = lighter(e['color'], 0.5)
            elif k == 'shieldbreak':
                for i in range(14):
                    a = self.rng.uniform(0, math.tau)
                    self.parts.append(Particle('shard', x, y, math.cos(a) * 8, math.sin(a) * 8 - 3, 30, 9, e['color'], a))
                self.shake = 14
                self.banner('SHIELD BREAK!', (255, 220, 80), 60, y_off=-120)
            elif k == 'grab':
                self.parts.append(Particle('ring', x, y, life=10, size=24, color=lighter(e['color'], 0.5)))
            elif k in ('counter', 'reflect'):
                self.parts.append(Particle('hex', x, y, life=18, size=46, color=(160, 240, 255)))
                self.banner('COUNTER!' if k == 'counter' else 'REFLECT!', (160, 240, 255), 40, y_off=-140)
            elif k == 'tech':
                self.parts.append(Particle('hex', x, y, life=16, size=40, color=(255, 255, 255)))
                self.parts.append(Particle('ring', x, y, life=14, size=60, color=lighter(e['color'], 0.5)))
                self.banner('受け身!', (255, 255, 255), 30, size=40, y_off=-150)
            elif k == 'armor':
                self.parts.append(Particle('ring', x, y, life=10, size=40, color=(255, 200, 120)))
            elif k == 'warp':
                for i in range(14):
                    a = self.rng.uniform(0, math.tau)
                    self.parts.append(Particle('spark', x, y, math.cos(a) * 7, math.sin(a) * 7, 16, 6, e['color'], a))
            elif k == 'awaken':
                f = e['who']
                self.cut_in = [f, 70]
                self.flash = 10
                self.flash_color = f.char.look['accent']
            elif k == 'awaken_blast':
                self.flash = 18
                self.flash_color = (255, 255, 255)
                self.shake = 30
                for r in range(3):
                    self.parts.append(Particle('ring', x, y, life=30 + r * 8, size=500 + r * 160, color=e['color']))
                for i in range(40):
                    a = self.rng.uniform(0, math.tau)
                    sp = self.rng.uniform(10, 30)
                    self.parts.append(Particle('spark', x, y, math.cos(a) * sp, math.sin(a) * sp, 30, 14, e['color'], a))
            elif k == 'go':
                self.banner('GO!', (255, 230, 90), 50, size=150)
            elif k == 'count':
                self.banner(str(e['n']), (255, 255, 255), 45, size=150)
            elif k == 'game':
                self.banner('GAME!', (255, 90, 70), 100, size=150)
            if audio is not None:
                audio.on_event(e)

    def banner(self, s, color, life, size=96, y_off=0):
        self.banners.append([s, color, life, life, size, y_off])

    # ------------------------------------------------------------ 描画
    def draw(self, paused=False):
        w = self.w
        s = self.screen
        if not paused:
            self.update_camera()
        self.draw_bg()
        if w.cinema:
            dim = pygame.Surface((W, H), pygame.SRCALPHA)
            dim.fill((0, 0, 10, 150))
            s.blit(dim, (0, 0))
        self.draw_stage()
        for f in w.fighters:
            if f.alive and not paused and (abs(f.kx) + abs(f.ky) > 11) and f.state == 'hitstun' and w.frame % 2 == 0:
                self.parts.append(Particle('trail', f.x, f.y - f.h / 2, 0, 0, 24, 14, (230, 230, 240)))
        self.draw_parts(back=True)
        for f in sorted(w.fighters, key=lambda f: f.state != 'move'):
            self.draw_fighter(f)
        self.draw_projs()
        self.draw_parts(back=False, step=not paused)
        self.draw_ko_lines(step=not paused)
        self.draw_offscreen()
        if self.flash > 0:
            fl = pygame.Surface((W, H), pygame.SRCALPHA)
            fl.fill((*self.flash_color, min(200, self.flash * 18)))
            s.blit(fl, (0, 0))
            if not paused:
                self.flash -= 1
        self.draw_hud()
        self.draw_cut_in(step=not paused)
        self.draw_banners(step=not paused)

    def draw_stage(self):
        s = self.screen
        st = self.w.stage
        m = st.main
        z = self.zoom
        theme = st.theme
        top_col = {'dusk': (250, 220, 170), 'space': (170, 140, 255), 'sky': (255, 255, 255)}[theme]
        body_col = {'dusk': (78, 58, 92), 'space': (44, 34, 86), 'sky': (120, 108, 96)}[theme]
        lip_col = {'dusk': (120, 96, 120), 'space': (70, 60, 130), 'sky': (90, 190, 90)}[theme]
        pts = [self.to_screen(x, y) for x, y in m.outline]
        # 本体（下がえぐれた形）
        pygame.draw.polygon(s, darker(body_col, 0.55), [(x, y + 6 * z) for x, y in pts])
        pygame.draw.polygon(s, body_col, pts)
        # 縦の陰影: 中心から外へ暗く
        cx = (m.x1 + m.x2) / 2
        w = (m.x2 - m.x1) / 2
        from .stage import half_width
        for k in range(1, 6):
            dd = m.depth * (0.2 + k * 0.13)
            hw = half_width(st.shape, w, m.depth, dd) * 0.92
            if hw < 8:
                continue
            a = self.to_screen(cx - hw, m.y + dd)
            b = self.to_screen(cx + hw, m.y + dd)
            pygame.draw.line(s, lighter(body_col, 0.05 * (6 - k) / 5 + 0.03), a, b, max(1, int(2 * z)))
        # 縁（リップ）: 上面から少し下まで色を変え、角は丸く
        from .stage import LIP
        lip = [p for p in m.outline if p[1] <= m.y + LIP + 0.1]
        lip_pts = [self.to_screen(x, y) for x, y in lip]
        bottom_r = self.to_screen(cx + w, m.y + LIP)
        bottom_l = self.to_screen(cx - w, m.y + LIP)
        band = lip_pts[:12] + [bottom_r, bottom_l]
        if len(band) >= 3:
            pygame.draw.polygon(s, lip_col, band)
            pygame.draw.line(s, darker(lip_col, 0.6), bottom_l, bottom_r, max(1, int(3 * z)))
        # 上面のハイライト（角の丸みに沿って）
        pygame.draw.lines(s, top_col, False, lip_pts[:12], max(2, int(5 * z)))
        # 崖の目印
        for L in st.ledges:
            lx, ly = self.to_screen(L.x, L.y)
            pygame.draw.circle(s, lighter(top_col, 0.3), (int(lx), int(ly + 3 * z)), max(2, int(3 * z)))
        # 底の飾り（戦場風は浮遊石の光、終点風は先端の光）
        tipx, tipy = self.to_screen(cx, m.y + m.depth)
        glow = {'dusk': (255, 170, 120), 'space': (190, 140, 255), 'sky': (160, 230, 255)}[theme]
        g = pygame.Surface((int(80 * z) + 4, int(80 * z) + 4), pygame.SRCALPHA)
        rr = int(40 * z)
        pygame.draw.circle(g, (*glow, 70), (rr + 2, rr + 2), rr)
        pygame.draw.circle(g, (*glow, 140), (rr + 2, rr + 2), max(2, rr // 3))
        s.blit(g, (tipx - rr - 2, tipy - rr - 2))
        for p in st.plats:
            p1 = self.to_screen(p.x1, p.y)
            p2 = self.to_screen(p.x2, p.y)
            th = max(4, int(12 * z))
            r = pygame.Rect(p1[0], p1[1], p2[0] - p1[0], th)
            pygame.draw.rect(s, darker(body_col, 0.8), r, border_radius=th // 2)
            pygame.draw.rect(s, lip_col, r.inflate(0, -th // 2).move(0, -th // 4), border_radius=th // 3)
            pygame.draw.line(s, top_col, p1, p2, max(2, int(3 * z)))
            if p.move:
                for k in range(3):
                    pygame.draw.circle(s, lighter(top_col), (int(lerp(p1[0], p2[0], 0.3 + k * 0.2)), int(p1[1] + th)),
                                       max(2, int(3 * z)))

    def draw_fighter(self, f):
        if not f.alive and f.state != 'dead':
            return
        if f.state == 'dead':
            return
        if f.inv > 0 and f.state not in ('respawn',) and (f.anim // 3) % 2 == 0:
            glow = True
        else:
            glow = False
        FighterArt.draw(self.screen, f, self.to_screen, self.zoom)
        if glow:
            cx, cy = self.to_screen(f.x, f.y - f.h / 2)
            r = int(f.h * 0.55 * self.zoom)
            g = pygame.Surface((r * 2 + 4, r * 2 + 4), pygame.SRCALPHA)
            pygame.draw.circle(g, (255, 255, 255, 60), (r + 2, r + 2), r)
            self.screen.blit(g, (cx - r - 2, cy - r - 2))
        # ワザの軌跡
        if f.state == 'move' and f.hitlag == 0 or (f.state == 'move' and f.hitlag > 0):
            m = f.move
            for h in (m.d.active(m.f) if f.char.sprites is None else ()):
                if h.get('grab'):
                    continue
                boxes = [(f.x + h['x'] * f.face, f.y + h['y'])]
                if h['both']:
                    boxes.append((f.x - h['x'] * f.face, f.y + h['y']))
                for bx, by in boxes:
                    self.slash(bx, by, h['r'], h.get('fx', 'slash'), f, m.f - h['f'][0])
        # プレイヤー表示
        if f.state != 'dead':
            cx, cy = self.to_screen(f.x, f.y - f.h - 26)
            tri = [(cx - 8, cy - 4), (cx + 8, cy - 4), (cx, cy + 6)]
            pygame.draw.polygon(self.screen, f.color, tri)
            blit_text(self.screen, f.tag, 16, (cx, cy - 4), f.color, 'midbottom', bold=True, outline=(10, 10, 20))

    def slash(self, x, y, r, fx, f, age):
        cols = {'fire': (255, 140, 50), 'water': (90, 220, 255), 'elec': (255, 240, 90), 'quake': (210, 160, 100),
                'ring': (255, 255, 255), 'big': lighter(f.char.look['accent'], 0.3), 'slash': (255, 255, 255)}
        c = cols.get(fx, (255, 255, 255))
        cx, cy = self.to_screen(x, y)
        rr = max(4, int(r * self.zoom))
        g = pygame.Surface((rr * 2 + 8, rr * 2 + 8), pygame.SRCALPHA)
        o = rr + 4
        alpha = max(40, 160 - age * 25)
        if fx == 'ring':
            pygame.draw.circle(g, (*c, alpha // 2), (o, o), rr, max(2, rr // 4))
        elif fx in ('fire', 'elec', 'water', 'quake'):
            pygame.draw.circle(g, (*c, alpha // 2), (o, o), rr)
            for i in range(5):
                a = self.rng.uniform(0, math.tau)
                pygame.draw.circle(g, (*lighter(c, 0.4), alpha), (o + math.cos(a) * rr * 0.6, o + math.sin(a) * rr * 0.6),
                                   max(2, rr // 3))
        else:
            start = math.pi * 0.25 if f.face > 0 else math.pi * 0.75
            rect = pygame.Rect(4, 4, rr * 2, rr * 2)
            pygame.draw.arc(g, (*c, alpha), rect, start - 1.6, start + 0.6, max(3, rr // 3))
            pygame.draw.circle(g, (*c, alpha // 4), (o, o), rr)
        self.screen.blit(g, (cx - o, cy - o))

    def draw_projs(self):
        s = self.screen
        z = self.zoom
        t = self.w.frame
        for p in self.w.projs:
            cx, cy = self.to_screen(p.x, p.y)
            if p.kind == 'bolt':
                w_, h_ = p.rect
                top = self.to_screen(p.x, p.y - h_)
                pts = []
                n = 9
                for i in range(n + 1):
                    yy = lerp(top[1], cy, i / n)
                    xx = cx + (self.rng.uniform(-1, 1) * w_ * 0.4 * z if 0 < i < n else 0)
                    pts.append((xx, yy))
                pygame.draw.lines(s, (255, 255, 200), False, pts, max(3, int(10 * z)))
                pygame.draw.lines(s, (255, 255, 255), False, pts, max(1, int(4 * z)))
                g = pygame.Surface((int(w_ * z * 2) + 4, int(h_ * z) + 4), pygame.SRCALPHA)
                g.fill((255, 240, 120, 50))
                s.blit(g, (cx - w_ * z, top[1]))
                continue
            r = max(3, int(p.r * z))
            if p.kind == 'fire':
                fl = r + int(math.sin(t * 0.8) * 2)
                pygame.draw.circle(s, (255, 90, 30), (cx, cy), fl + 3)
                pygame.draw.circle(s, (255, 190, 60), (cx, cy), fl)
                pygame.draw.circle(s, (255, 250, 200), (cx, cy), max(2, fl // 2))
                if t % 2 == 0:
                    self.parts.append(Particle('puff', p.x, p.y, -p.vx * 0.1, -0.8, 14, p.r * 0.8, (255, 140, 40)))
            elif p.kind == 'shot':
                g = pygame.Surface((r * 4, r * 4), pygame.SRCALPHA)
                pygame.draw.circle(g, (90, 220, 255, 80), (r * 2, r * 2), r * 2)
                s.blit(g, (cx - r * 2, cy - r * 2))
                pygame.draw.circle(s, (120, 230, 255), (cx, cy), r)
                pygame.draw.circle(s, (235, 255, 255), (cx, cy), max(2, r // 2))
            elif p.kind == 'leaf':
                a = t * 0.5
                pts = []
                for i in range(4):
                    aa = a + i * math.pi / 2
                    rr = r * (1.4 if i % 2 == 0 else 0.5)
                    pts.append((cx + math.cos(aa) * rr, cy + math.sin(aa) * rr))
                pygame.draw.polygon(s, (40, 120, 40), pts)
                pygame.draw.polygon(s, (130, 235, 110), pts, max(1, int(2 * z)))
            elif p.kind == 'wave':
                rect = pygame.Rect(cx - r * 1.4, cy - r, r * 2.8, r * 2)
                pygame.draw.ellipse(s, (150, 90, 220), rect)
                pygame.draw.ellipse(s, (230, 200, 255), rect, max(1, int(3 * z)))
            else:
                pygame.draw.circle(s, p.color, (cx, cy), r)

    def draw_parts(self, back=False, step=True):
        s = self.screen
        z = self.zoom
        alive = []
        for p in self.parts:
            is_back = p.kind in ('trail', 'puff')
            if is_back != back:
                alive.append(p)
                continue
            k = p.life / p.max
            cx, cy = self.to_screen(p.x, p.y)
            if p.kind == 'spark':
                ln = p.size * z * 1.6
                ex, ey = cx - math.cos(p.ang) * ln, cy - math.sin(p.ang) * ln
                pygame.draw.line(s, p.color, (cx, cy), (ex, ey), max(1, int(p.size * 0.4 * z * k + 1)))
            elif p.kind == 'line':
                ln = p.size * z
                ex, ey = cx - math.cos(p.ang) * ln, cy - math.sin(p.ang) * ln
                pygame.draw.line(s, p.color, (cx, cy), (ex, ey), max(1, int(3 * k)))
            elif p.kind == 'ring':
                r = int(p.size * (1 - k) * z) + 2
                pygame.draw.circle(s, p.color, (cx, cy), r, max(1, int(5 * k * max(z, 0.6))))
            elif p.kind == 'ring_flat':
                r = int(p.size * (1.2 - k) * z) + 2
                pygame.draw.ellipse(s, p.color, (cx - r, cy - r * 0.3, r * 2, r * 0.6), max(1, int(3 * k)))
            elif p.kind == 'burst':
                r = int(p.size * z * (0.6 + k * 0.6))
                star(s, (cx, cy), r, p.color)
            elif p.kind == 'hex':
                r = p.size * z * (1.3 - k * 0.3)
                pts = [(cx + math.cos(i * math.pi / 3) * r, cy + math.sin(i * math.pi / 3) * r) for i in range(6)]
                pygame.draw.polygon(s, p.color, pts, max(1, int(4 * k)))
            elif p.kind in ('puff', 'trail'):
                r = max(1, int(p.size * z * (1.2 - k * 0.4)))
                g = pygame.Surface((r * 2 + 2, r * 2 + 2), pygame.SRCALPHA)
                pygame.draw.circle(g, (*p.color, int(160 * k)), (r + 1, r + 1), r)
                s.blit(g, (cx - r - 1, cy - r - 1))
            elif p.kind == 'shard':
                r = p.size * z
                pts = [(cx + math.cos(p.ang + i * 2.1) * r, cy + math.sin(p.ang + i * 2.1) * r) for i in range(3)]
                pygame.draw.polygon(s, p.color, pts)
            if step:
                p.x += p.vx
                p.y += p.vy
                p.vx *= 0.88
                p.vy *= 0.88
                if p.kind == 'shard':
                    p.vy += 0.6
                    p.ang += 0.3
                p.life -= 1
            if p.life > 0:
                alive.append(p)
        self.parts = alive[-900:]

    def draw_ko_lines(self, step=True):
        s = self.screen
        keep = []
        for kl in self.ko_lines:
            x, y, ang, life, col = kl
            k = life / 60
            cx, cy = self.to_screen(x, y)
            cx = min(max(cx, 0), W)
            cy = min(max(cy, 0), H)
            ln = 900
            wdt = int(120 * k) + 4
            ex, ey = cx + math.cos(ang) * ln, cy + math.sin(ang) * ln
            nx, ny = -math.sin(ang), math.cos(ang)
            pts = [(cx + nx * wdt, cy + ny * wdt), (cx - nx * wdt, cy - ny * wdt), (ex, ey)]
            g = pygame.Surface((W, H), pygame.SRCALPHA)
            pygame.draw.polygon(g, (*col, int(220 * k)), pts)
            pts2 = [(cx + nx * wdt * 0.4, cy + ny * wdt * 0.4), (cx - nx * wdt * 0.4, cy - ny * wdt * 0.4), (ex, ey)]
            pygame.draw.polygon(g, (255, 255, 255, int(240 * k)), pts2)
            s.blit(g, (0, 0))
            if step:
                kl[3] -= 1
            if kl[3] > 0:
                keep.append(kl)
        self.ko_lines = keep

    def draw_offscreen(self):
        s = self.screen
        for f in self.w.fighters:
            if not f.alive:
                continue
            cx, cy = self.to_screen(f.x, f.y - f.h / 2)
            if -20 < cx < W + 20 and -20 < cy < H - 90:
                continue
            bx = min(max(cx, 50), W - 50)
            by = min(max(cy, 50), H - 150)
            pygame.draw.circle(s, (20, 20, 30), (bx, by), 36)
            pygame.draw.circle(s, f.color, (bx, by), 36, 4)
            a = math.atan2(cy - by, cx - bx)
            tip = (bx + math.cos(a) * 50, by + math.sin(a) * 50)
            l1 = (bx + math.cos(a + 0.4) * 36, by + math.sin(a + 0.4) * 36)
            l2 = (bx + math.cos(a - 0.4) * 36, by + math.sin(a - 0.4) * 36)
            pygame.draw.polygon(s, f.color, [tip, l1, l2])
            draw_portrait(s, f.char, bx, by + 4, 18, f.face)

    def draw_hud(self):
        s = self.screen
        w = self.w
        n = len(w.fighters)
        pw = 236
        gap = 18
        total = n * pw + (n - 1) * gap
        x0 = (W - total) // 2
        y0 = H - 100
        for i, f in enumerate(w.fighters):
            x = x0 + i * (pw + gap)
            panel = pygame.Surface((pw, 92), pygame.SRCALPHA)
            pygame.draw.rect(panel, (12, 12, 24, 190), (0, 0, pw, 92), border_radius=14)
            pygame.draw.rect(panel, (*f.color, 255), (0, 0, pw, 92), 3, border_radius=14)
            s.blit(panel, (x, y0))
            pygame.draw.circle(s, darker(f.color, 0.5), (x + 44, y0 + 44), 32)
            draw_portrait(s, f.char, x + 44, y0 + 50, 24, 1, 'hurt' if f.state == 'hitstun' else 'open')
            blit_text(s, f.char.name, 16, (x + 86, y0 + 6), (230, 230, 240), bold=True)
            blit_text(s, f.tag, 14, (x + pw - 12, y0 + 7), f.color, 'topright', bold=True)
            if f.out:
                blit_text(s, '%d位' % f.place if f.place else 'OUT', 44, (x + 150, y0 + 48), (150, 150, 160), 'center',
                          bold=True, outline=(0, 0, 0))
            else:
                sh = self.hud_shake.get(f.idx, 0)
                ox = self.rng.uniform(-1, 1) * sh * 0.6 if sh else 0
                oy = self.rng.uniform(-1, 1) * sh * 0.6 if sh else 0
                if sh:
                    self.hud_shake[f.idx] = sh - 1
                col = damage_color(f.damage)
                pct = '%d' % int(f.damage)
                r = blit_text(s, pct, 52, (x + 176 + ox, y0 + 54 + oy), col, 'midright', bold=True, outline=(20, 10, 10), ow=3)
                blit_text(s, '%', 26, (r.right + 2, r.bottom - 8), col, 'bottomleft', bold=True, outline=(20, 10, 10))
                if w.stocks:
                    for k in range(min(f.stocks, 6)):
                        pygame.draw.circle(s, f.char.look['body'], (x + 92 + k * 15, y0 + 80), 6)
                        pygame.draw.circle(s, (255, 255, 255), (x + 92 + k * 15, y0 + 80), 6, 1)
                    if f.stocks > 6:
                        blit_text(s, 'x%d' % f.stocks, 14, (x + 186, y0 + 80), (255, 255, 255), 'midleft')
            # 覚醒ゲージ
            gx, gy, gw = x + 12, y0 + 92 - 8, pw - 24
            pygame.draw.rect(s, (40, 40, 60), (gx, gy - 4, gw, 6), border_radius=3)
            k = f.meter / 100
            if k >= 1:
                c = f.char.look['accent'] if (w.frame // 6) % 2 else (255, 255, 255)
                pygame.draw.rect(s, c, (gx, gy - 4, gw, 6), border_radius=3)
                blit_text(s, '覚醒OK!', 14, (x + pw - 14, y0 + 26), c, 'topright', bold=True, outline=(0, 0, 0))
            elif k > 0:
                pygame.draw.rect(s, f.char.look['accent'], (gx, gy - 4, int(gw * k), 6), border_radius=3)
        tl = w.time_left()
        if tl is not None:
            m, sec = divmod(int(math.ceil(tl)), 60)
            blit_text(s, '%d:%02d' % (m, sec), 40, (W // 2, 10), (255, 255, 255), 'midtop', bold=True, outline=(0, 0, 0))

    def draw_cut_in(self, step=True):
        if not self.cut_in:
            return
        f, life = self.cut_in
        k = life / 70
        s = self.screen
        band_h = 170
        y = H // 2 - band_h // 2 - 40
        slide = min(1.0, (70 - life) / 10)
        g = pygame.Surface((W, band_h), pygame.SRCALPHA)
        g.fill((*darker(f.char.look['body'], 0.4), 230))
        for i in range(14):
            xx = (i * 120 + (70 - life) * 30) % (W + 200) - 100
            pygame.draw.line(g, (*f.char.look['accent'], 120), (xx, 0), (xx - 80, band_h), 6)
        s.blit(g, (int((1 - slide) * -W), y))
        draw_portrait(s, f.char, int(220 - (1 - slide) * W), y + band_h // 2, 64, 1, 'fierce')
        blit_text(s, '覚醒', 40, (int(330 - (1 - slide) * W), y + 22), f.char.look['accent'], bold=True, outline=(0, 0, 0))
        blit_text(s, f.char.awaken, 56, (int(330 - (1 - slide) * W), y + 70), (255, 255, 255), bold=True, outline=(0, 0, 0), ow=3)
        if step:
            self.cut_in[1] -= 1
            if self.cut_in[1] <= 30:
                self.cut_in = None

    def draw_banners(self, step=True):
        keep = []
        for b in self.banners:
            sstr, col, life, mx, size, yo = b
            k = life / mx
            scale = 1.0 + max(0.0, (k - 0.85)) * 4
            surf = text(sstr, size, col, True, (20, 10, 30), 5)
            if scale != 1.0:
                surf = pygame.transform.rotozoom(surf, 0, scale)
            if k < 0.25:
                surf = surf.copy()
                surf.set_alpha(int(255 * k / 0.25))
            r = surf.get_rect(center=(W // 2, H // 2 - 60 + yo))
            self.screen.blit(surf, r)
            if step:
                b[2] -= 1
            if b[2] > 0:
                keep.append(b)
        self.banners = keep
