"""効果音（その場で波形を合成。音声ファイル不要）。"""
import math
import random
from array import array

import pygame

VOICE_CHANNELS = 4

RATE = 22050


class Audio:
    def __init__(self):
        self.ok = False
        self.sounds = {}
        self.muted = False
        self._played = {}
        try:
            if not pygame.mixer.get_init():
                pygame.mixer.init(RATE, -16, 1, 512)
            pygame.mixer.set_num_channels(32)
            pygame.mixer.set_reserved(VOICE_CHANNELS)
            self.ok = True
        except pygame.error:
            return
        rnd = random.Random(3)
        self.sounds['hit_s'] = self.make(0.09, lambda t, k: (rnd.uniform(-1, 1) * 0.6 + math.sin(t * 900) * 0.5) * (1 - k) ** 2)
        self.sounds['hit_m'] = self.make(0.16, lambda t, k: (rnd.uniform(-1, 1) * 0.6 + math.sin(t * 2 * math.pi * (220 - 120 * k)) * 0.7) * (1 - k) ** 2)
        self.sounds['hit_l'] = self.make(0.32, lambda t, k: (rnd.uniform(-1, 1) * 0.7 * (1 - k) + math.sin(t * 2 * math.pi * (140 - 90 * k)) * 0.9) * (1 - k) ** 1.5)
        self.sounds['swing'] = self.make(0.1, lambda t, k: rnd.uniform(-1, 1) * 0.25 * math.sin(k * math.pi))
        self.sounds['jump'] = self.make(0.12, lambda t, k: math.sin(t * 2 * math.pi * (300 + 500 * k)) * 0.3 * (1 - k))
        self.sounds['land'] = self.make(0.06, lambda t, k: rnd.uniform(-1, 1) * 0.25 * (1 - k))
        self.sounds['block'] = self.make(0.12, lambda t, k: math.sin(t * 2 * math.pi * 1400) * 0.35 * (1 - k) ** 2)
        self.sounds['grab'] = self.make(0.1, lambda t, k: math.sin(t * 2 * math.pi * (500 - 200 * k)) * 0.4 * (1 - k))
        self.sounds['ko'] = self.make(0.9, lambda t, k: (rnd.uniform(-1, 1) * 0.8 * (1 - k) ** 2 + math.sin(t * 2 * math.pi * (90 - 50 * k)) * (1 - k)) * 0.9)
        self.sounds['break'] = self.make(0.5, lambda t, k: (math.sin(t * 2 * math.pi * 1800 * (1 - k * 0.5)) * 0.3 + rnd.uniform(-1, 1) * 0.3) * (1 - k))
        self.sounds['awaken'] = self.make(0.8, lambda t, k: (math.sin(t * 2 * math.pi * (200 + 600 * k)) * 0.4 + math.sin(t * 2 * math.pi * (300 + 900 * k)) * 0.2) * min(1, (1 - k) * 3))
        self.sounds['blast'] = self.make(1.0, lambda t, k: (rnd.uniform(-1, 1) * (1 - k) ** 1.5 + math.sin(t * 2 * math.pi * 60) * (1 - k)) * 0.9)
        self.sounds['proj'] = self.make(0.12, lambda t, k: math.sin(t * 2 * math.pi * (700 - 400 * k)) * 0.25 * (1 - k))
        self.sounds['count'] = self.make(0.2, lambda t, k: math.sin(t * 2 * math.pi * 660) * 0.4 * (1 - k))
        self.sounds['go'] = self.make(0.45, lambda t, k: (math.sin(t * 2 * math.pi * 880) + math.sin(t * 2 * math.pi * 1320) * 0.5) * 0.3 * (1 - k))
        self.sounds['select'] = self.make(0.05, lambda t, k: math.sin(t * 2 * math.pi * 900) * 0.25 * (1 - k))
        self.sounds['ok'] = self.make(0.18, lambda t, k: math.sin(t * 2 * math.pi * (600 if k < 0.4 else 900)) * 0.3 * (1 - k))
        self.sounds['game'] = self.make(0.9, lambda t, k: (math.sin(t * 2 * math.pi * 523) + math.sin(t * 2 * math.pi * 659) + math.sin(t * 2 * math.pi * 784)) * 0.15 * (1 - k))

    def make(self, dur, fn):
        n = int(RATE * dur)
        buf = array('h', [0]) * n
        for i in range(n):
            t = i / RATE
            v = fn(t, i / n)
            buf[i] = int(max(-1.0, min(1.0, v)) * 30000)
        return pygame.mixer.Sound(buffer=buf.tobytes())

    def play(self, name, vol=1.0):
        if not self.ok or self.muted:
            return
        s = self.sounds.get(name)
        if s:
            s.set_volume(vol)
            s.play()

    # ------------------------------------------------------------ 画像キャラの声・効果音
    def play_char(self, f, key, voice=None, vol=0.9, skip_if_busy=False):
        bank = getattr(f.char, 'voices', None)
        if not self.ok or self.muted or bank is None or key is None:
            return
        snd = bank.sound(key)
        if snd is None:
            return
        snd.set_volume(vol)
        if voice is None:
            voice = not isinstance(key, tuple) or key[0] >= 100
        if voice:
            ch = pygame.mixer.Channel(f.idx % VOICE_CHANNELS)
            if skip_if_busy and ch.get_busy():
                return
            ch.play(snd)
        else:
            snd.play()

    def play_char_event(self, f, kind, **kw):
        bank = getattr(f.char, 'voices', None)
        if bank is None:
            return
        keys = bank.event_keys(kind)
        if keys:
            self.play_char(f, random.choice(keys), **kw)

    def _cue_key(self, bank, c):
        if c.s is None:
            return random.choice(c.g) if isinstance(c.g, tuple) else c.g
        return bank.pick(c.g, c.s, c.rnd)

    def tick(self, world):
        """ワザのフレームに合わせて、キャラの PlaySnd を鳴らす。"""
        for f in world.fighters:
            bank = getattr(f.char, 'voices', None)
            if bank is None or f.state != 'move' or f.move is None:
                continue
            m = f.move
            d = m.d
            ref = getattr(d, 'spr', None)
            cl = bank.cues.get(ref)
            if not cl:
                continue
            st = self._played.get(f.idx)
            if st is None or st[0] is not m:
                st = [m, set()]
                self._played[f.idx] = st
            if getattr(d, 'spr_mode', 'warp') == 'direct':
                tick = m.f - 1 - getattr(d, 'spr_delay', 0)
            else:
                anim = f.char.sprites.anim(ref) if f.char.sprites else None
                ln = anim.length if anim else d.total
                tick = int((m.f - 1) / max(1, d.total) * ln)
            for i, c in enumerate(cl):
                if c.on_hit or i in st[1] or tick < c.tick:
                    continue
                st[1].add(i)
                if c.prob < 1 and random.random() > c.prob:
                    continue
                self.play_char(f, self._cue_key(bank, c))

    def on_hit_voices(self, e):
        t, a = e.get('who'), e.get('by')
        if t is not None:
            d = e.get('dmg', 0)
            kind = 'hurt_s' if d < 5 else ('hurt_m' if d < 12 else 'hurt_l')
            self.play_char_event(t, kind, skip_if_busy=d < 5)
        bank = getattr(a.char, 'voices', None) if a is not None else None
        if bank is not None and a.state == 'move' and a.move is not None:
            for c in bank.cues.get(getattr(a.move.d, 'spr', None), ()):
                if c.on_hit:
                    self.play_char(a, self._cue_key(bank, c))

    def on_event(self, e):
        k = e['kind']
        if k == 'hit':
            self.on_hit_voices(e)
        elif k == 'ko':
            self.play_char_event(e['who'], 'ko')
        elif k == 'awaken':
            self.play_char_event(e['who'], 'awaken')
        elif k == 'respawn':
            self.play_char_event(e['who'], 'respawn')
        elif k in ('jump', 'djump') and e.get('who') is not None:
            self.play_char_event(e['who'], 'jump', voice=False, vol=0.6)
        if k == 'hit':
            d = e['dmg']
            self.play('hit_l' if d >= 12 or e['kb'] > 140 else ('hit_m' if d >= 5 else 'hit_s'))
        elif k == 'swing':
            self.play('swing', 0.5)
        elif k in ('jump', 'djump'):
            self.play('jump', 0.6)
        elif k == 'land':
            self.play('land', 0.5)
        elif k in ('block', 'counter', 'reflect', 'armor', 'tech'):
            self.play('block')
        elif k == 'grab':
            self.play('grab')
        elif k == 'ko':
            self.play('ko')
        elif k == 'shieldbreak':
            self.play('break')
        elif k == 'awaken':
            self.play('awaken')
        elif k == 'awaken_blast':
            self.play('blast')
        elif k == 'proj':
            self.play('proj', 0.6)
        elif k == 'count':
            self.play('count')
        elif k == 'go':
            self.play('go')
        elif k == 'game':
            self.play('game')
