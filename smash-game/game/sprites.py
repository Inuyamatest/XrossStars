"""画像キャラの読み込み。

2種類に対応する:
  * MUGEN キャラ（mugen/<フォルダ>/*.def）… .sff(v1/v2) のドット絵と .air のアニメ・当たり判定(Clsn)を使う
  * 連番画像キャラ（charpacks/<フォルダ>/char.json）… BMP/PNG の連番とモーション割り当て表

どちらも「アニメ（フレームの並び）」と「スプライト（画像＋基準点）」に変換し、
ワザの動きや性能は既存キャラのものを土台にする。
"""
import io
import json
import math
import os
import re
import struct

import pygame

import sys

# exe 化したときは exe と同じ場所の mugen/・charpacks/ を見る
ROOT = (os.path.dirname(sys.executable) if getattr(sys, 'frozen', False)
        else os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MUGEN_DIR = os.path.join(ROOT, 'mugen')
PACK_DIR = os.path.join(ROOT, 'charpacks')


# ================================================================ アニメ

class Frame:
    __slots__ = ('key', 'time', 'ox', 'oy', 'flip', 'clsn1', 'clsn2')

    def __init__(self, key, time, ox=0, oy=0, flip=False, clsn1=None, clsn2=None):
        self.key, self.time, self.ox, self.oy, self.flip = key, time, ox, oy, flip
        self.clsn1 = clsn1 or []
        self.clsn2 = clsn2 or []


class Anim:
    def __init__(self, frames=None, loopstart=0):
        self.frames = frames or []
        self.loopstart = loopstart

    @property
    def length(self):
        return sum(max(1, f.time) for f in self.frames)

    def index_at(self, t, loop=True):
        """t ティック目に表示するフレーム番号。"""
        fr = self.frames
        if not fr:
            return 0
        acc = 0
        for i, f in enumerate(fr):
            if f.time < 0:
                return i
            acc += f.time
            if t < acc:
                return i
        if not loop:
            return len(fr) - 1
        ls = min(self.loopstart, len(fr) - 1)
        loop_len = sum(max(1, f.time) for f in fr[ls:])
        t = (t - acc) % max(1, loop_len)
        acc = 0
        for i in range(ls, len(fr)):
            acc += max(1, fr[i].time)
            if t < acc:
                return i
        return len(fr) - 1


def _rect(vals):
    x1, y1, x2, y2 = vals
    return (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))


def parse_air(text):
    anims = {}
    cur = None
    def1 = def2 = None
    pend1 = pend2 = None
    target = None
    for raw in text.splitlines():
        line = raw.split(';', 1)[0].strip()
        if not line:
            continue
        low = line.lower()
        m = re.match(r'\[\s*begin\s+action\s+(-?\d+)\s*\]', low)
        if m:
            cur = Anim()
            anims[int(m.group(1))] = cur
            def1 = def2 = pend1 = pend2 = None
            continue
        if cur is None:
            continue
        if low.startswith('loopstart'):
            cur.loopstart = len(cur.frames)
            continue
        m = re.match(r'clsn([12])(default)?\s*:\s*(\d+)', low)
        if m:
            lst = []
            if m.group(1) == '1':
                if m.group(2):
                    def1 = lst
                else:
                    pend1 = lst
            else:
                if m.group(2):
                    def2 = lst
                else:
                    pend2 = lst
            target = lst
            continue
        m = re.match(r'clsn[12]\s*\[\s*\d+\s*\]\s*=\s*(.+)', low)
        if m:
            nums = [int(float(v)) for v in re.findall(r'-?\d+(?:\.\d+)?', m.group(1))[:4]]
            if target is not None and len(nums) == 4:
                target.append(_rect(nums))
            continue
        if re.match(r'^-?\d', line):
            parts = [p.strip() for p in line.split(',')]
            try:
                g, i, ox, oy, t = (int(float(parts[k])) for k in range(5))
            except (ValueError, IndexError):
                continue
            flip = len(parts) > 5 and 'h' in parts[5].lower()
            c1 = pend1 if pend1 is not None else (def1 or [])
            c2 = pend2 if pend2 is not None else (def2 or [])
            cur.frames.append(Frame((g, i), t, ox, oy, flip, list(c1), list(c2)))
            pend1 = pend2 = None
    return anims


# ================================================================ SFF

def _rle8(data, size):
    out = bytearray(size)
    i = j = 0
    n = len(data)
    while j < size and i < n:
        d = data[i]
        i += 1
        if d & 0xC0 == 0x40:
            run = d & 0x3F
            v = data[i] if i < n else 0
            i += 1
            out[j:j + run] = bytes([v]) * min(run, size - j)
            j += run
        else:
            out[j] = d
            j += 1
    return bytes(out)


def _rle5(data, size):
    out = bytearray(size)
    i = j = 0
    n = len(data)
    while j < size and i < n:
        rl = data[i]
        i += 1
        if i >= n:
            break
        dl = data[i] & 0x7F
        c = 0
        if data[i] >> 7:
            i += 1
            c = data[i] if i < n else 0
        i += 1
        while True:
            if j < size:
                out[j] = c
                j += 1
            rl -= 1
            if rl < 0:
                dl -= 1
                if dl < 0 or i >= n:
                    break
                c = data[i] & 0x1F
                rl = data[i] >> 5
                i += 1
    return bytes(out)


def _lz5(data, size):
    out = bytearray(size)
    n = len(data)
    if n == 0:
        return bytes(out)
    i = j = 0

    def nxt():
        nonlocal i
        if i < n - 1:
            i += 1
    ct, cts, rb, rbc = data[i], 0, 0, 0
    nxt()
    while j < size:
        d = data[i]
        nxt()
        if ct & (1 << cts):
            if d & 0x3F == 0:
                d = ((d << 2) | data[i]) + 1
                nxt()
                cnt = data[i] + 2
                nxt()
            else:
                rb |= (d & 0xC0) >> rbc
                rbc += 2
                cnt = d & 0x3F
                if rbc < 8:
                    d = data[i] + 1
                    nxt()
                else:
                    d = rb + 1
                    rb = rbc = 0
            while True:
                if j < size:
                    out[j] = out[j - d] if j - d >= 0 else 0
                    j += 1
                cnt -= 1
                if cnt < 0:
                    break
        else:
            if d & 0xE0 == 0:
                cnt = data[i] + 8
                nxt()
            else:
                cnt = d >> 5
                d &= 0x1F
            while cnt > 0:
                if j < size:
                    out[j] = d
                    j += 1
                cnt -= 1
        cts += 1
        if cts >= 8:
            ct, cts = data[i], 0
            nxt()
    return bytes(out)


def _indexed_surface(pix, w, h, pal):
    try:
        surf = pygame.image.frombytes(pix, (w, h), 'P')
    except AttributeError:
        surf = pygame.image.fromstring(pix, (w, h), 'P')
    pal = list(pal) + [(0, 0, 0)] * (256 - len(pal))
    surf.set_palette(pal[:256])
    surf.set_colorkey(0)
    return surf


def _pcx_decode(data, pal_prev):
    xmin, ymin, xmax, ymax = struct.unpack('<HHHH', data[4:12])
    w, h = xmax - xmin + 1, ymax - ymin + 1
    bpl = struct.unpack('<H', data[66:68])[0] or w
    raw = bytearray()
    i = 128
    need = bpl * h
    while len(raw) < need and i < len(data):
        b = data[i]
        i += 1
        if b >= 0xC0:
            raw += bytes([data[i] if i < len(data) else 0]) * (b & 0x3F)
            i += 1
        else:
            raw.append(b)
    pix = bytearray(w * h)
    for y in range(h):
        pix[y * w:(y + 1) * w] = raw[y * bpl:y * bpl + w]
    pal = pal_prev
    if len(data) >= 769 and data[-769] == 0x0C:
        p = data[-768:]
        pal = [(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]) for k in range(256)]
    return bytes(pix), w, h, pal


class Sff:
    """SFF を読み、(group, image) -> (Surface, 基準点x, 基準点y) を返す。デコードは必要になった時だけ。"""

    def __init__(self, path, act_palette=None):
        self.data = open(path, 'rb').read()
        if self.data[:11] != b'ElecbyteSpr':
            raise ValueError('SFF ではありません: %s' % path)
        self.ver = self.data[15]
        self.nodes = {}
        self.cache = {}
        self.act = act_palette
        if self.ver == 2:
            self._index_v2()
        else:
            self._index_v1()

    # ---- v2
    def _index_v2(self):
        d = self.data
        so, ns, po, npal, lo, ll, to, tl = struct.unpack('<8I', d[0x24:0x44])
        self.ldata, self.tdata = lo, to
        self.pals = []
        for i in range(npal):
            g, it, ncol, link, off, ln = struct.unpack('<HHHHII', d[po + i * 16:po + i * 16 + 16])
            self.pals.append((ncol, link, off, ln))
        self.v2 = []
        for i in range(ns):
            node = struct.unpack('<HHHHhhHBBIIHH', d[so + i * 28:so + i * 28 + 28])
            self.v2.append(node)
            g, it = node[0], node[1]
            if (g, it) not in self.nodes:
                self.nodes[(g, it)] = i

    def _palette_v2(self, idx, depth=0):
        if idx >= len(self.pals) or depth > 8:
            return [(0, 0, 0)] * 256
        ncol, link, off, ln = self.pals[idx]
        if ln == 0:
            return self._palette_v2(link, depth + 1)
        raw = self.data[self.ldata + off:self.ldata + off + ln]
        return [(raw[k * 4], raw[k * 4 + 1], raw[k * 4 + 2]) for k in range(min(ncol, ln // 4))]

    def _decode_v2(self, i, depth=0):
        g, it, w, h, ax, ay, link, fmt, cdepth, off, ln, pal, flags = self.v2[i]
        if (ln == 0 or fmt == 1) and depth < 16 and link != i:
            surf, _, _ = self._decode_v2(link, depth + 1)
            return surf, ax, ay
        base = self.tdata if flags & 1 else self.ldata
        raw = self.data[base + off:base + off + ln]
        if w == 0 or h == 0:
            return pygame.Surface((1, 1), pygame.SRCALPHA), ax, ay
        if fmt in (10, 11, 12):
            surf = pygame.image.load(io.BytesIO(raw[4:]), 'x.png')
            if fmt == 10:
                surf.set_palette(self.palette_for(pal))
                surf.set_colorkey(0)
            return surf, ax, ay
        size = w * h
        if fmt == 0:
            pix = bytes(raw[:size]).ljust(size, b'\0')
        elif fmt == 2:
            pix = _rle8(raw[4:], size)
        elif fmt == 3:
            pix = _rle5(raw[4:], size)
        elif fmt == 4:
            pix = _lz5(raw[4:], size)
        else:
            pix = bytes(size)
        return _indexed_surface(pix, w, h, self.palette_for(pal)), ax, ay

    def palette_for(self, pal_idx):
        if self.act is not None:
            return self.act
        if self.ver == 2:
            # キャラの色は基本パレット(1,1)=0番を使う
            return self._palette_v2(0 if pal_idx == 0 else pal_idx)
        return self.act or [(0, 0, 0)] * 256

    # ---- v1
    def _index_v1(self):
        d = self.data
        nimg = struct.unpack('<I', d[20:24])[0]
        off = struct.unpack('<I', d[24:28])[0]
        self.v1 = []
        for k in range(nimg):
            if off + 32 > len(d):
                break
            nxt, ln, x, y, g, it, link, same = struct.unpack('<IIhhHHHB', d[off:off + 19])
            self.v1.append((off + 32, ln, x, y, g, it, link, same))
            if (g, it) not in self.nodes:
                self.nodes[(g, it)] = k
            if nxt == 0:
                break
            off = nxt
        self._v1_pal = {}

    def _decode_v1(self, k, depth=0):
        start, ln, x, y, g, it, link, same = self.v1[k]
        if ln == 0 and depth < 16:
            surf, _, _ = self._decode_v1(link, depth + 1)
            return surf, x, y
        prev = self._v1_pal.get(k - 1) if same else None
        pix, w, h, pal = _pcx_decode(self.data[start:start + ln], prev or self.act or [(0, 0, 0)] * 256)
        self._v1_pal[k] = pal
        if self.act is not None and g != 9000:
            pal = self.act
        return _indexed_surface(pix, w, h, pal), x, y

    def get(self, key):
        if key in self.cache:
            return self.cache[key]
        i = self.nodes.get(key)
        if i is None:
            self.cache[key] = None
            return None
        try:
            res = self._decode_v2(i) if self.ver == 2 else self._decode_v1(i)
        except Exception:
            res = None
        self.cache[key] = res
        return res


def load_act(path):
    raw = open(path, 'rb').read()[:768]
    # MUGEN の .act は色の並びが逆順
    cols = [(raw[k * 3], raw[k * 3 + 1], raw[k * 3 + 2]) for k in range(len(raw) // 3)]
    return list(reversed(cols))


def parse_def(path):
    info, files, sec = {}, {}, None
    for raw in open(path, 'r', encoding='utf-8', errors='replace').read().splitlines():
        line = raw.split(';', 1)[0].strip()
        if not line:
            continue
        m = re.match(r'\[(.+)\]', line)
        if m:
            sec = m.group(1).strip().lower()
            continue
        if '=' in line:
            k, v = line.split('=', 1)
            k, v = k.strip().lower(), v.strip().strip('"')
            if sec == 'info':
                info[k] = v
            elif sec == 'files':
                files[k] = v
    return info, files


def _find(folder, name):
    """大文字小文字を区別しないファイル探し（Windows 用に作られたキャラ対策）。"""
    if not name:
        return None
    p = os.path.join(folder, name)
    if os.path.exists(p):
        return p
    d, base = os.path.split(p)
    if os.path.isdir(d):
        for f in os.listdir(d):
            if f.lower() == base.lower():
                return os.path.join(d, f)
    return None


# ================================================================ キャラ用データ

def to_rgba(surf):
    out = pygame.Surface(surf.get_size(), pygame.SRCALPHA)
    out.blit(surf, (0, 0))
    return out


class SpriteSet:
    """描画に必要なもの一式。key -> (Surface, ax, ay)。"""

    def __init__(self, getter, anims, scale, state_map, portrait=None):
        self.getter = getter
        self.anims = anims
        self.scale = scale
        self.state_map = state_map
        self.portrait_src = portrait
        self._scaled = {}
        self._portraits = {}

    def sprite(self, key):
        return self.getter(key)

    def anim(self, ref):
        return self.anims.get(ref)

    def scaled(self, key, k, flip):
        q = round(k, 3)
        ck = (key, q, flip)
        s = self._scaled.get(ck)
        if s is not None:
            return s
        sp = self.sprite(key)
        if sp is None:
            return None
        surf, ax, ay = sp
        w, h = surf.get_size()
        nw, nh = max(1, int(w * q)), max(1, int(h * q))
        img = pygame.transform.smoothscale(to_rgba(surf), (nw, nh))
        if flip:
            img = pygame.transform.flip(img, True, False)
            ax = w - ax
        res = (img, ax * q, ay * q)
        if len(self._scaled) > 1500:
            self._scaled.clear()
        self._scaled[ck] = res
        return res

    def portrait(self, size):
        p = self._portraits.get(size)
        if p is not None:
            return p
        src = self.portrait_src() if callable(self.portrait_src) else None
        if src is None:
            return None
        surf = to_rgba(src)
        w, h = surf.get_size()
        k = size / max(1, min(w, h))
        img = pygame.transform.smoothscale(surf, (max(1, int(w * k)), max(1, int(h * k))))
        out = pygame.Surface((size, size), pygame.SRCALPHA)
        mask = pygame.Surface((size, size), pygame.SRCALPHA)
        pygame.draw.circle(mask, (255, 255, 255, 255), (size // 2, size // 2), size // 2)
        out.blit(img, ((size - img.get_width()) // 2, 0))
        out.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MIN)
        self._portraits[size] = out
        return out


# 状態キー → MUGEN の標準アニメ番号（候補を順に試す）
MUGEN_STATE_ANIMS = {
    'stand': [0], 'walk': [20], 'run': [100, 20], 'crouch': [11, 10], 'jumpsquat': [40, 10],
    'rise': [41, 42], 'fall': [44, 41], 'land': [47, 10], 'shield': [130, 120], 'crouchguard': [131],
    'roll': [105, 100], 'spot': [130], 'airdodge': [132, 41], 'hit': [5000, 5010], 'tumble': [5050, 5030],
    'down': [5110, 5100, 5050], 'grabbed': [5000], 'hold': [800], 'ledge': [41], 'climb': [40, 10],
    'dizzy': [5300, 5000], 'helpless': [41], 'awaken': [3000, 195, 181], 'respawn': [0], 'win': [181, 180, 0],
}

# ワザ → MUGEN のアニメ番号の候補（攻撃判定 Clsn1 を持つものを優先）
MUGEN_MOVE_ANIMS = {
    'jab': [200, 201, 400], 'jab2': [201, 202, 210], 'jab3': [202, 203, 211, 220], 'ftilt': [210, 220, 211],
    'utilt': [230, 203, 212, 220], 'dtilt': [400, 410, 430], 'dash': [240, 230, 211, 210],
    'fsmash': [220, 212, 240, 211, 210], 'usmash': [420, 230, 203], 'dsmash': [440, 430, 420, 410],
    'nair': [600, 601], 'fair': [610, 620, 601], 'bair': [630, 640, 620, 610], 'uair': [620, 630, 601, 600],
    'dair': [640, 650, 630, 620, 600], 'grab': [800], 'dashgrab': [800],
    'fthrow': [810, 820], 'bthrow': [820, 810], 'uthrow': [830, 810], 'dthrow': [840, 810],
    'ledgeatk': [400, 200], 'getupatk': [430, 400, 200],
}


def _has_clsn1(anim):
    return anim is not None and any(f.clsn1 for f in anim.frames)


def clsn_windows(anim, scale):
    """Clsn1 が出ているフレームを、(開始, 終了, 矩形) のまとまりにする（ワザのフレーム番号＝ティック+1）。"""
    wins = []
    t = 0
    cur = None
    for f in anim.frames:
        tm = max(1, f.time) if f.time >= 0 else 30
        if f.clsn1:
            r = [min(b[0] for b in f.clsn1), min(b[1] for b in f.clsn1),
                 max(b[2] for b in f.clsn1), max(b[3] for b in f.clsn1)]
            r = [v * scale for v in r]
            if cur is not None and cur[1] == t:
                cur[1] = t + tm
                cur[2] = [min(cur[2][0], r[0]), min(cur[2][1], r[1]), max(cur[2][2], r[2]), max(cur[2][3], r[3])]
            else:
                cur = [t, t + tm, r]
                wins.append(cur)
        else:
            cur = None
        t += tm
    return [(a + 1, b, tuple(r)) for a, b, r in wins]
