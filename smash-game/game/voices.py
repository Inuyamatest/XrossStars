"""画像キャラの声・効果音。

* MUGEN キャラ: .snd の音を、.cns の PlaySnd（「何番のステートの何フレーム目に何番の音」）どおりに鳴らす
* 連番画像キャラ: char.json の "sounds" に書いた音ファイルを鳴らす
"""
import io
import os
import random
import re
import struct

import pygame

VOICE_GROUP_MIN = 100   # これ以上の番号のグループは声とみなして、キャラごとの声チャンネルで鳴らす（MUGENの慣習）


def parse_snd(path):
    """(group, sample) -> WAVのバイト列"""
    d = open(path, 'rb').read()
    if d[:11] != b'ElecbyteSnd':
        raise ValueError('SND ではありません')
    n, off = struct.unpack('<II', d[16:24])
    out = {}
    seen = 0
    while off and off + 16 <= len(d) and seen < 100000:
        nxt, ln, g, s = struct.unpack('<IIII', d[off:off + 16])
        out.setdefault((g, s), d[off + 16:off + 16 + ln])
        seen += 1
        if nxt <= off:
            break
        off = nxt
    return out


class Cue:
    __slots__ = ('tick', 'g', 's', 'rnd', 'prob', 'on_hit')

    def __init__(self, tick, g, s, rnd=0, prob=1.0, on_hit=False):
        self.tick, self.g, self.s, self.rnd, self.prob, self.on_hit = tick, g, s, rnd, prob, on_hit


_VALUE = re.compile(r'^\s*(s)?(\d+)\s*,\s*(\d+)\s*(?:\+\s*random\s*%\s*(\d+))?\s*$', re.I)


def _frame_start(anim, n):
    """アニメの n 枚目（1始まり）が出るティック。"""
    if anim is None:
        return None
    t = 0
    for i, f in enumerate(anim.frames):
        if i == n - 1:
            return t
        t += max(1, f.time) if f.time >= 0 else 0
    return None


def _cue_tick(conds, anim_no, anims):
    """トリガー条件からティックを出す。分からない条件があれば None。"""
    tick = None
    prob = 1.0
    on_hit = False
    anim = anims.get(anim_no)
    for c in conds:
        c = c.strip().lower().replace(' ', '')
        if c in ('!time', 'time=0'):
            tick = 0
        elif re.fullmatch(r'time=(\d+)', c):
            tick = int(c.split('=')[1])
        elif re.fullmatch(r'animelem=(\d+)', c):
            tick = _frame_start(anim, int(c.split('=')[1]))
            if tick is None:
                return None, 0, False
        elif re.fullmatch(r'animelemtime\((\d+)\)=(\d+)', c):
            a, b = re.findall(r'\d+', c)
            st = _frame_start(anim, int(a))
            if st is None:
                return None, 0, False
            tick = st + int(b)
        elif re.fullmatch(r'anim=(\d+)', c):
            if int(c.split('=')[1]) != anim_no:
                return None, 0, False
        elif re.fullmatch(r'random<=(\d+)', c):
            prob = (int(c.split('=')[1]) + 1) / 1000
        elif c in ('movehit', 'movecontact', 'movehit=1', 'movecontact=1'):
            on_hit = True
        elif c in ('1', 'alive', 'alive=1'):
            pass
        else:
            return None, 0, False
    if on_hit and tick is None:
        tick = -1
    return tick, prob, on_hit


def parse_cns_cues(paths, anims):
    """アニメ番号 -> [Cue]（そのアニメを使うステートの PlaySnd）"""
    by_state = {}
    sd = None
    for p in paths:
        try:
            txt = open(p, 'r', encoding='latin-1').read()
        except OSError:
            continue
        sd_anim = None
        for block in re.split(r'\n(?=\s*\[)', '\n' + txt):
            lines = [ln.split(';', 1)[0] for ln in block.strip().splitlines()]
            if not lines:
                continue
            head = lines[0].strip().lower()
            m = re.match(r'\[\s*statedef\s+(-?\d+)', head)
            if m:
                sd = int(m.group(1))
                sd_anim = sd
                for ln in lines[1:]:
                    mm = re.match(r'\s*anim\s*=\s*(\d+)\s*$', ln, re.I)
                    if mm:
                        sd_anim = int(mm.group(1))
                continue
            if sd_anim is None or not head.startswith('[state'):
                continue
            kv = {}
            trig = []
            for ln in lines[1:]:
                if '=' not in ln:
                    continue
                k, v = ln.split('=', 1)
                k = k.strip().lower()
                if k in ('triggerall', 'trigger1'):
                    trig.append(v)
                else:
                    kv[k] = v.strip()
            if kv.get('type', '').lower() != 'playsnd':
                continue
            mv = _VALUE.match(kv.get('value', ''))
            if not mv:
                continue  # F で始まる共通効果音や、式になっているものは鳴らさない
            tick, prob, on_hit = _cue_tick(trig, sd_anim, anims)
            if tick is None:
                continue
            by_state.setdefault(sd_anim, {}).setdefault(sd, []).append(
                Cue(tick, int(mv.group(2)), int(mv.group(3)), int(mv.group(4) or 0), prob, on_hit))
    # 同じアニメを使うステートが複数ある（EX版など）ときは、アニメと同じ番号のステートを優先
    cues = {}
    for anim_no, states in by_state.items():
        cues[anim_no] = states.get(anim_no) or states[min(states)]
    return cues


class VoiceBank:
    """キャラ1体分の音。get_sound はミキサーが無いときは None を返す。"""

    def __init__(self, raw, cues=None, events=None):
        self.raw = raw            # key -> bytes（WAV）または ファイルパス
        self.cues = cues or {}    # アニメ参照 -> [Cue]
        self.events = events or {}  # 'hurt_s'/'hurt_m'/'hurt_l'/'ko'/'win'/'awaken'/'jump'... -> [key, ...]
        self.cache = {}

    def sound(self, key):
        if key in self.cache:
            return self.cache[key]
        snd = None
        src = self.raw.get(key)
        if src is not None and pygame.mixer.get_init():
            try:
                snd = pygame.mixer.Sound(file=io.BytesIO(src)) if isinstance(src, bytes) else pygame.mixer.Sound(src)
            except pygame.error:
                snd = None
        self.cache[key] = snd
        return snd

    def pick(self, g, s, rnd=0):
        if rnd:
            s = s + random.randrange(rnd)
        if (g, s) in self.raw:
            return (g, s)
        return None

    def event_keys(self, kind):
        return self.events.get(kind) or []


def mugen_voices(folder, files, anims):
    sndp = None
    for k in ('sound',):
        if files.get(k):
            p = os.path.join(folder, files[k])
            if os.path.exists(p):
                sndp = p
    if sndp is None:
        return None
    raw = parse_snd(sndp)
    st_keys = ['cns', 'st', 'stcommon'] + ['st%d' % i for i in range(10)]
    paths = []
    for k in st_keys:
        if files.get(k):
            p = os.path.join(folder, files[k])
            if os.path.exists(p) and p not in paths:
                paths.append(p)
    cues = parse_cns_cues(paths, anims)

    def group(g):
        return sorted(k for k in raw if k[0] == g)
    events = {
        'hurt_s': group(5000), 'hurt_m': group(5001) or group(5000), 'hurt_l': group(5002) or group(5001),
        'ko': group(11) or group(5002), 'win': group(181) or group(180), 'awaken': group(3000) or group(3002),
        'jump': group(40), 'land': group(52), 'respawn': group(191) or group(190),
    }
    return VoiceBank(raw, cues, events)


def pack_voices(folder, cfg):
    """char.json の "sounds": {"jab": "a.wav", "hurt": ["b.wav", "c.wav"], "ko": ..., "win": ...}"""
    spec = cfg.get('sounds') or {}
    if not spec:
        return None
    raw, cues, events = {}, {}, {}
    for name, files in spec.items():
        if isinstance(files, str):
            files = [files]
        keys = []
        for fn in files:
            p = os.path.join(folder, fn)
            if os.path.exists(p):
                raw[fn] = p
                keys.append(fn)
        if not keys:
            continue
        if name == 'hurt':
            for k in ('hurt_s', 'hurt_m', 'hurt_l'):
                events.setdefault(k, keys)
        events[name] = keys
        cues['move:' + name] = [Cue(0, tuple(keys), None)]
    return VoiceBank(raw, cues, events)
