"""画面遷移: タイトル → キャラ選択 → バトル → リザルト。"""
import math
import random
import pygame

from . import config as C
from .chars import CHARS
from .stage import STAGE_KEYS, make_stage
from .world import World
from .ai import CpuController
from .inputs import HumanController, KEY_HELP
from .render import (Renderer, blit_text, draw_full_body, draw_portrait, darker, lighter, mix, text, W, H)

ACCEPT = (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE, pygame.K_j)
BACK = (pygame.K_ESCAPE, pygame.K_BACKSPACE)
UP = (pygame.K_w, pygame.K_UP)
DOWN = (pygame.K_s, pygame.K_DOWN)
SLOT_TYPES = ['1P', '2P', 'CPU', 'なし']
TIME_OPTS = [0, 2, 3, 5]


def menu_bg(surf, t, tint=(30, 20, 70)):
    for y in range(0, H, 4):
        k = y / H
        c = mix(tint, (8, 6, 20), k)
        pygame.draw.rect(surf, c, (0, y, W, 4))
    for i in range(18):
        x = (i * 140 + t * 1.5) % (W + 300) - 150
        pygame.draw.line(surf, lighter(tint, 0.08), (x, 0), (x - 300, H), 3)
    g = pygame.Surface((W, H), pygame.SRCALPHA)
    pygame.draw.circle(g, (255, 120, 80, 24), (W // 2, H // 2), 380 + int(math.sin(t * 0.03) * 20))
    surf.blit(g, (0, 0))


class Button:
    def __init__(self, rect, label, cb, size=24, color=(60, 60, 100)):
        self.rect = pygame.Rect(rect)
        self.label = label
        self.cb = cb
        self.size = size
        self.color = color
        self.hover = False

    def draw(self, s):
        c = lighter(self.color, 0.25) if self.hover else self.color
        pygame.draw.rect(s, darker(c, 0.5), self.rect.move(0, 4), border_radius=12)
        pygame.draw.rect(s, c, self.rect, border_radius=12)
        pygame.draw.rect(s, lighter(c, 0.4), self.rect, 2, border_radius=12)
        blit_text(s, self.label, self.size, self.rect.center, (255, 255, 255), 'center', bold=True)

    def handle(self, e, app):
        if e.type == pygame.MOUSEMOTION:
            self.hover = self.rect.collidepoint(e.pos)
        elif e.type == pygame.MOUSEBUTTONDOWN and e.button == 1 and self.rect.collidepoint(e.pos):
            app.audio.play('select')
            self.cb()
            return True
        return False


class Settings:
    def __init__(self):
        self.slots = [dict(type='1P', char=0, level=5), dict(type='CPU', char=1, level=5),
                      dict(type='なし', char=2, level=5), dict(type='なし', char=3, level=5)]
        self.stocks = 3
        self.time_idx = 0
        self.stage_idx = 0
        self.training = False


# ================================================================ タイトル

class TitleScene:
    ITEMS = [('たいせん', 'versus'), ('トレーニング', 'training'), ('そうさ方法', 'help'), ('おわる', 'quit')]

    def __init__(self, app):
        self.app = app
        self.sel = 0
        self.t = 0
        self.buttons = []
        for i, (label, key) in enumerate(self.ITEMS):
            self.buttons.append(Button((W // 2 - 170, 360 + i * 74, 340, 58), label, lambda k=key: self.go(k), 28))

    def go(self, key):
        app = self.app
        app.audio.play('ok')
        if key == 'versus':
            app.settings.training = False
            app.scene = SelectScene(app)
        elif key == 'training':
            app.settings.training = True
            app.scene = SelectScene(app)
        elif key == 'help':
            app.scene = HelpScene(app, self)
        else:
            app.running = False

    def handle(self, e):
        for i, b in enumerate(self.buttons):
            if b.handle(e, self.app):
                return
            if b.hover:
                self.sel = i
        if e.type == pygame.KEYDOWN:
            if e.key in UP:
                self.sel = (self.sel - 1) % len(self.ITEMS)
                self.app.audio.play('select')
            elif e.key in DOWN:
                self.sel = (self.sel + 1) % len(self.ITEMS)
                self.app.audio.play('select')
            elif e.key in ACCEPT:
                self.go(self.ITEMS[self.sel][1])
            elif e.key in BACK:
                self.app.running = False
        elif e.type == pygame.JOYBUTTONDOWN and e.button in (0, 7):
            self.go(self.ITEMS[self.sel][1])
        elif e.type == pygame.JOYHATMOTION and e.value[1]:
            self.sel = (self.sel - e.value[1]) % len(self.ITEMS)

    def update(self):
        self.t += 1

    def draw(self, s):
        menu_bg(s, self.t)
        for i, (ch, x) in enumerate(zip(CHARS, (110, 250, 160, 1030, 1170))):
            y = 330 + math.sin(self.t * 0.04 + i) * 6
            draw_full_body(s, ch, x, y + (250 if i == 2 else 0), 1.5 if ch.key != 'titan' else 1.35,
                           1 if x < W // 2 else -1, self.t)
        bounce = math.sin(self.t * 0.05) * 4
        blit_text(s, 'CROSS FIGHT', 104, (W // 2, 120 + bounce), (255, 220, 90), 'center', bold=True,
                  outline=(80, 20, 20), ow=6)
        blit_text(s, 'クロスファイト ～大乱闘アリーナ～', 34, (W // 2, 205), (255, 255, 255), 'center', bold=True,
                  outline=(20, 10, 40), ow=3)
        for i, b in enumerate(self.buttons):
            b.hover = b.hover or i == self.sel
            b.color = (200, 70, 60) if i == self.sel else (60, 60, 110)
            b.draw(s)
            b.hover = False if i != self.sel else b.hover
        blit_text(s, 'W/S・↑↓で選んで Enter / クリック　　F11: 全画面　M: 消音', 18, (W // 2, H - 24),
                  (200, 200, 220), 'center')


# ================================================================ 操作説明

class HelpScene:
    def __init__(self, app, back):
        self.app = app
        self.back = back
        self.t = 0

    def handle(self, e):
        if (e.type == pygame.KEYDOWN and (e.key in BACK or e.key in ACCEPT)) or \
                (e.type == pygame.MOUSEBUTTONDOWN) or (e.type == pygame.JOYBUTTONDOWN):
            self.app.audio.play('ok')
            self.app.scene = self.back

    def update(self):
        self.t += 1

    def draw(self, s):
        menu_bg(s, self.t, (20, 40, 70))
        blit_text(s, 'そうさ方法', 48, (W // 2, 44), (255, 230, 120), 'center', bold=True, outline=(0, 0, 0))
        for p, rows in enumerate(KEY_HELP):
            x = 70 + p * 400
            blit_text(s, '%dP キーボード' % (p + 1), 28, (x, 100), C.PLAYER_COLORS[p], bold=True)
            for i, (a, b) in enumerate(rows):
                blit_text(s, a, 22, (x, 150 + i * 38), (220, 220, 235))
                blit_text(s, b, 22, (x + 140, 150 + i * 38), (255, 255, 255), bold=True)
        x = 870
        blit_text(s, 'ゲームパッド', 28, (x, 100), (120, 230, 140), bold=True)
        pad = [('移動', '左スティック'), ('ジャンプ', 'X / Y・上はじき'), ('攻撃', 'A'), ('必殺ワザ', 'B'),
               ('ガード', 'RB'), ('つかみ', 'LB'), ('スマッシュ', '右スティック'), ('覚醒', 'BACK/START横')]
        for i, (a, b) in enumerate(pad):
            blit_text(s, a, 22, (x, 150 + i * 38), (220, 220, 235))
            blit_text(s, b, 22, (x + 130, 150 + i * 38), (255, 255, 255), bold=True)
        tips = [
            'スマッシュ攻撃: 方向をはじくと同時に攻撃（またはスマッシュボタン）。押しっぱなしでためられる',
            'ガード: 押している間シールド。左右で回避（ころがり）、下でその場回避、空中で押すと空中回避',
            'つかみ → 方向で投げ（前・後・上・下）、攻撃でつかみ打撃。ガードはつかみに弱い！',
            '崖: 近づくと自動でつかまる。上/ステージ側で登る・ジャンプ・攻撃・ガードで転がり上がり',
            '上必殺ワザで復帰。使うとしりもち落下になるので注意',
            '覚醒ゲージ（パネル下）がたまったら 攻撃+必殺 同時押し（覚醒ボタン）で超必殺ワザ！',
            '%がたまるほど遠くへふっとぶ。画面の外まで飛ばしたら撃墜！',
        ]
        for i, t in enumerate(tips):
            blit_text(s, '・' + t, 20, (70, 470 + i * 31), (235, 235, 245))
        blit_text(s, 'Esc / Enter / クリックでもどる', 18, (W // 2, H - 18), (180, 180, 200), 'center')


# ================================================================ キャラ選択

class SelectScene:
    def __init__(self, app):
        self.app = app
        self.t = 0
        self.st = app.settings
        if self.st.training:
            sl = self.st.slots
            sl[0]['type'] = '1P'
            sl[1]['type'] = 'CPU'
            sl[1]['level'] = 0
            sl[2]['type'] = sl[3]['type'] = 'なし'
        self.active = 0
        self.hover_char = None
        self.msg = ''
        self.msg_t = 0
        self.build()

    def build(self):
        self.buttons = []
        self.card_rects = []
        n = len(CHARS)
        gap = 20 if n <= 5 else 12
        cw = min(212, (W - 100 - gap * (n - 1)) // n)
        x0 = (W - (cw * n + gap * (n - 1))) // 2
        for i in range(n):
            self.card_rects.append(pygame.Rect(x0 + i * (cw + gap), 74, cw, 236))
        for i in range(4):
            x = 40 + i * 304
            y = 336
            self.buttons.append(Button((x + 10, y + 10, 90, 36), '', lambda i=i: self.cycle_type(i), 20))
            self.buttons.append(Button((x + 10, y + 120, 40, 40), '◀', lambda i=i: self.cycle_char(i, -1), 22))
            self.buttons.append(Button((x + 234, y + 120, 40, 40), '▶', lambda i=i: self.cycle_char(i, 1), 22))
            self.buttons.append(Button((x + 120, y + 196, 34, 30), '－', lambda i=i: self.level(i, -1), 20))
            self.buttons.append(Button((x + 240, y + 196, 34, 30), '＋', lambda i=i: self.level(i, 1), 20))
        y = 622
        self.buttons.append(Button((150, y, 40, 40), '◀', lambda: self.rule('stocks', -1), 22))
        self.buttons.append(Button((330, y, 40, 40), '▶', lambda: self.rule('stocks', 1), 22))
        self.buttons.append(Button((440, y, 40, 40), '◀', lambda: self.rule('time', -1), 22))
        self.buttons.append(Button((620, y, 40, 40), '▶', lambda: self.rule('time', 1), 22))
        self.buttons.append(Button((730, y, 40, 40), '◀', lambda: self.rule('stage', -1), 22))
        self.buttons.append(Button((980, y, 40, 40), '▶', lambda: self.rule('stage', 1), 22))
        self.start_btn = Button((1050, 604, 200, 66), 'バトル開始!', self.start, 26, (200, 70, 60))
        self.back_btn = Button((20, 660, 120, 44), 'もどる', self.back, 20)
        self.buttons += [self.start_btn, self.back_btn]

    # ---------------------------------------------------------- 操作
    def cycle_type(self, i):
        sl = self.st.slots[i]
        sl['type'] = SLOT_TYPES[(SLOT_TYPES.index(sl['type']) + 1) % len(SLOT_TYPES)]
        self.active = i

    def cycle_char(self, i, d):
        sl = self.st.slots[i]
        sl['char'] = (sl['char'] + d) % len(CHARS)
        if sl['type'] == 'なし':
            sl['type'] = 'CPU'
        self.active = i

    def level(self, i, d):
        sl = self.st.slots[i]
        sl['level'] = max(0, min(9, sl['level'] + d))

    def rule(self, key, d):
        st = self.st
        if key == 'stocks':
            st.stocks = max(1, min(9, st.stocks + d))
        elif key == 'time':
            st.time_idx = (st.time_idx + d) % len(TIME_OPTS)
        else:
            st.stage_idx = (st.stage_idx + d) % len(STAGE_KEYS)

    def pick_char(self, ci):
        sl = self.st.slots[self.active]
        sl['char'] = ci
        if sl['type'] == 'なし':
            sl['type'] = 'CPU'
        self.app.audio.play('ok')
        # 次の空いていない枠へ
        for k in range(1, 5):
            j = (self.active + k) % 4
            if self.st.slots[j]['type'] != 'なし':
                self.active = j
                break

    def back(self):
        self.app.scene = TitleScene(self.app)

    def start(self):
        active = [s for s in self.st.slots if s['type'] != 'なし']
        if len(active) < 2:
            self.msg, self.msg_t = '2人以上にしてね（枠の「なし」をクリックで変更）', 120
            return
        self.app.audio.play('ok')
        self.app.scene = BattleScene(self.app)

    def handle(self, e):
        for b in self.buttons:
            if b.handle(e, self.app):
                return
        if e.type == pygame.MOUSEMOTION:
            self.hover_char = None
            for i, r in enumerate(self.card_rects):
                if r.collidepoint(e.pos):
                    self.hover_char = i
        elif e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
            for i, r in enumerate(self.card_rects):
                if r.collidepoint(e.pos):
                    self.pick_char(i)
                    return
            for i in range(4):
                if pygame.Rect(40 + i * 304, 336, 284, 236).collidepoint(e.pos):
                    self.active = i
        elif e.type == pygame.KEYDOWN:
            k = e.key
            if k in (pygame.K_RETURN, pygame.K_KP_ENTER):
                self.start()
            elif k in BACK:
                self.back()
            elif k == pygame.K_a:
                self.cycle_char(0, -1)
            elif k == pygame.K_d:
                self.cycle_char(0, 1)
            elif k == pygame.K_LEFT:
                self.cycle_char(1, -1)
            elif k == pygame.K_RIGHT:
                self.cycle_char(1, 1)
            else:
                return
            self.app.audio.play('select')
        elif e.type == pygame.JOYHATMOTION and e.value[0]:
            self.cycle_char(min(e.joy, 1), e.value[0])
        elif e.type == pygame.JOYBUTTONDOWN and e.button == 7:
            self.start()

    def update(self):
        self.t += 1
        if self.msg_t > 0:
            self.msg_t -= 1

    # ---------------------------------------------------------- 描画
    def draw(self, s):
        menu_bg(s, self.t, (50, 20, 60))
        title = 'トレーニング：キャラを選ぼう' if self.st.training else 'キャラクターセレクト'
        blit_text(s, title, 34, (W // 2, 34), (255, 230, 120), 'center', bold=True, outline=(0, 0, 0))
        for i, (ch, r) in enumerate(zip(CHARS, self.card_rects)):
            hov = self.hover_char == i
            pygame.draw.rect(s, darker(ch.look['body'], 0.35), r, border_radius=16)
            pygame.draw.rect(s, lighter(ch.look['body'], 0.3) if hov else ch.look['body'], r, 4, border_radius=16)
            clip = s.get_clip()
            s.set_clip(r.inflate(-6, -6))
            draw_full_body(s, ch, r.centerx, r.y + 190, min(1.75, 150 / ch.h), 1, self.t if hov else 0)
            s.set_clip(clip)
            blit_text(s, ch.name, 26 if r.width > 170 else 20, (r.centerx, r.bottom - 34), (255, 255, 255), 'center', bold=True, outline=(0, 0, 0))
            blit_text(s, ch.title, 16 if r.width > 170 else 12, (r.centerx, r.bottom - 12), lighter(ch.look['accent'], 0.3), 'center', outline=(0, 0, 0))
            for k, sl in enumerate(self.st.slots):
                if sl['type'] != 'なし' and sl['char'] == i:
                    c = C.PLAYER_COLORS[k]
                    pygame.draw.circle(s, c, (r.x + 22 + k * 30, r.y + 22), 13)
                    blit_text(s, str(k + 1), 16, (r.x + 22 + k * 30, r.y + 22), (255, 255, 255), 'center', bold=True)
        hc = CHARS[self.hover_char] if self.hover_char is not None else CHARS[self.st.slots[self.active]['char']]
        blit_text(s, '%s：%s' % (hc.name, hc.desc), 18, (W // 2, 322), (230, 230, 245), 'center')

        btn = {}
        for i in range(4):
            sl = self.st.slots[i]
            x, y = 40 + i * 304, 336
            r = pygame.Rect(x, y + 4, 284, 236)
            c = C.PLAYER_COLORS[i]
            on = sl['type'] != 'なし'
            pygame.draw.rect(s, darker(c, 0.3) if on else (30, 30, 40), r, border_radius=16)
            pygame.draw.rect(s, (255, 255, 255) if self.active == i else darker(c, 0.8), r, 4 if self.active == i else 2,
                             border_radius=16)
            if on:
                ch = CHARS[sl['char']]
                draw_portrait(s, ch, x + 142, y + 110, 40, 1, 'fierce' if self.active == i else 'open')
                blit_text(s, ch.name, 24, (x + 142, y + 168), (255, 255, 255), 'center', bold=True, outline=(0, 0, 0))
                if sl['type'] == 'CPU':
                    lv = sl['level']
                    blit_text(s, 'Lv %d%s' % (lv, '（棒立ち）' if lv == 0 else ''), 20, (x + 197, y + 211),
                              (255, 230, 120), 'center', bold=True)
            else:
                blit_text(s, 'クリックで参加', 20, (x + 142, y + 120), (140, 140, 160), 'center')
        for b in self.buttons:
            idx = self.buttons.index(b)
            if idx < 20:
                slot, kind = divmod(idx, 5)
                sl = self.st.slots[slot]
                if kind == 0:
                    b.label = sl['type']
                    b.color = C.PLAYER_COLORS[slot] if sl['type'] in ('1P', '2P') else ((90, 90, 120) if sl['type'] == 'CPU' else (50, 50, 60))
                elif kind in (3, 4) and sl['type'] != 'CPU':
                    continue
                elif kind in (1, 2) and sl['type'] == 'なし':
                    continue
            b.draw(s)
        y = 622
        blit_text(s, 'ストック', 18, (260, y - 14), (200, 200, 220), 'center')
        blit_text(s, '%d' % self.st.stocks if not self.st.training else '∞', 30, (260, y + 20), (255, 255, 255), 'center', bold=True)
        blit_text(s, '時間制限', 18, (550, y - 14), (200, 200, 220), 'center')
        tm = TIME_OPTS[self.st.time_idx]
        blit_text(s, '%d分' % tm if tm else 'なし', 30, (550, y + 20), (255, 255, 255), 'center', bold=True)
        stg = make_stage(STAGE_KEYS[self.st.stage_idx])
        blit_text(s, 'ステージ', 18, (875, y - 14), (200, 200, 220), 'center')
        blit_text(s, stg.name, 30, (875, y + 20), (255, 255, 255), 'center', bold=True)
        blit_text(s, stg.sub, 14, (875, y + 46), (180, 180, 200), 'center')
        blit_text(s, '1P: A/D でキャラ変更　2P: ←/→　Enter で開始', 15, (W // 2 + 60, H - 10), (190, 190, 210), 'center')
        if self.msg_t:
            blit_text(s, self.msg, 24, (W // 2, 560), (255, 120, 100), 'center', bold=True, outline=(0, 0, 0))


# ================================================================ バトル

class BattleScene:
    def __init__(self, app):
        self.app = app
        st = app.settings
        self.rng = random.Random()
        entries = []
        joy_next = 0
        for sl in st.slots:
            if sl['type'] == 'なし':
                continue
            ch = CHARS[sl['char']]
            if sl['type'] == '1P':
                ctrl, cpu = HumanController(0, 0), False
            elif sl['type'] == '2P':
                ctrl, cpu = HumanController(1, 1), False
            else:
                ctrl, cpu = CpuController(sl['level'], self.rng), True
            entries.append((ch, ctrl, cpu))
        stocks = 0 if st.training else st.stocks
        self.world = World(STAGE_KEYS[st.stage_idx], entries, stocks=stocks,
                           time_limit=0 if st.training else TIME_OPTS[st.time_idx] * 60)
        for f, sl in zip(self.world.fighters, [s for s in st.slots if s['type'] != 'なし']):
            if sl['type'] in ('1P', '2P'):
                f.tag = sl['type']
            else:
                f.tag = 'CP'
        self.r = Renderer(app.screen, self.world)
        self.paused = False
        self.pause_sel = 0
        self.after = 0
        self.tick = 0

    PAUSE_ITEMS = ['つづける', 'やりなおす', 'キャラ選択へ', 'タイトルへ']

    def pause_act(self, i):
        app = self.app
        app.audio.play('ok')
        if i == 0:
            self.paused = False
        elif i == 1:
            app.scene = BattleScene(app)
        elif i == 2:
            app.scene = SelectScene(app)
        else:
            app.scene = TitleScene(app)

    def handle(self, e):
        if e.type == pygame.KEYDOWN:
            if e.key in (pygame.K_ESCAPE, pygame.K_TAB):
                self.paused = not self.paused
                self.pause_sel = 0
                self.app.audio.play('select')
                return
            if self.paused:
                if e.key in UP:
                    self.pause_sel = (self.pause_sel - 1) % 4
                elif e.key in DOWN:
                    self.pause_sel = (self.pause_sel + 1) % 4
                elif e.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_j, pygame.K_SPACE):
                    self.pause_act(self.pause_sel)
                return
            if e.key == pygame.K_r and self.app.settings.training:
                for f in self.world.fighters:
                    f.damage = 0
                    f.meter = 100 if f.tag != 'CP' else f.meter
        elif e.type == pygame.JOYBUTTONDOWN and e.button == 7:
            self.paused = not self.paused
        elif self.paused and e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
            for i in range(4):
                if pygame.Rect(W // 2 - 160, 260 + i * 70, 320, 56).collidepoint(e.pos):
                    self.pause_act(i)

    def update(self):
        if self.paused:
            return
        w = self.world
        if w.over:
            self.after += 1
            if self.after > 20:
                self.app.scene = ResultScene(self.app, w)
            return
        self.tick += 1
        # GAME! 直後はスローモーション
        if not (w.ending > 40 and self.tick % 3):
            w.step()
        self.r.consume_events(w.events, self.app.audio)
        w.events.clear()

    def draw(self, s):
        self.r.draw(paused=self.paused)
        if self.app.settings.training:
            blit_text(s, 'トレーニング　R: ダメージリセット＆覚醒ゲージMAX　Esc: メニュー', 18, (W // 2, 14),
                      (255, 255, 255), 'midtop', outline=(0, 0, 0))
        if self.paused:
            g = pygame.Surface((W, H), pygame.SRCALPHA)
            g.fill((0, 0, 0, 160))
            s.blit(g, (0, 0))
            blit_text(s, 'PAUSE', 80, (W // 2, 170), (255, 255, 255), 'center', bold=True, outline=(0, 0, 0))
            for i, label in enumerate(self.PAUSE_ITEMS):
                r = pygame.Rect(W // 2 - 160, 260 + i * 70, 320, 56)
                c = (200, 70, 60) if i == self.pause_sel else (60, 60, 110)
                pygame.draw.rect(s, c, r, border_radius=12)
                pygame.draw.rect(s, lighter(c, 0.4), r, 2, border_radius=12)
                blit_text(s, label, 26, r.center, (255, 255, 255), 'center', bold=True)


# ================================================================ リザルト

class ResultScene:
    def __init__(self, app, world):
        self.app = app
        self.w = world
        self.t = 0
        self.ranked = sorted(world.fighters, key=lambda f: (f.place or 99))

    def handle(self, e):
        if self.t < 40:
            return
        if (e.type == pygame.KEYDOWN and e.key in ACCEPT) or (e.type == pygame.MOUSEBUTTONDOWN and e.button == 1) \
                or (e.type == pygame.JOYBUTTONDOWN and e.button in (0, 7)):
            self.app.audio.play('ok')
            self.app.scene = SelectScene(self.app)
        elif e.type == pygame.KEYDOWN and e.key in BACK:
            self.app.scene = TitleScene(self.app)

    def update(self):
        self.t += 1

    def draw(self, s):
        win = self.ranked[0]
        menu_bg(s, self.t, darker(win.char.look['body'], 0.6))
        draw_full_body(s, win.char, 300, 560, 3.6, 1, self.t, 'win')
        blit_text(s, '%s の勝ち！' % win.char.name if not win.is_cpu else 'CPU %s の勝ち！' % win.char.name, 56,
                  (300, 80), (255, 230, 120), 'center', bold=True, outline=(0, 0, 0), ow=4)
        blit_text(s, win.tag, 40, (300, 140), win.color, 'center', bold=True, outline=(0, 0, 0))
        y = 120
        for i, f in enumerate(self.ranked):
            r = pygame.Rect(620, y + i * 120, 600, 104)
            pygame.draw.rect(s, (20, 20, 36), r, border_radius=14)
            pygame.draw.rect(s, f.color, r, 3, border_radius=14)
            blit_text(s, '%d位' % (f.place or i + 1), 40, (r.x + 20, r.centery), (255, 230, 120) if i == 0 else (220, 220, 230),
                      'midleft', bold=True)
            draw_portrait(s, f.char, r.x + 150, r.centery + 4, 30, 1, 'fierce' if i == 0 else 'tired')
            blit_text(s, '%s  %s' % (f.tag, f.char.name), 26, (r.x + 200, r.y + 14), (255, 255, 255), bold=True)
            blit_text(s, '撃墜 %d　落下 %d　与ダメージ %d%%' % (f.kos, f.falls, int(f.dmg_dealt)), 20,
                      (r.x + 200, r.y + 58), (210, 210, 225))
        if self.t > 40:
            blit_text(s, 'Enter / クリック: もう一度　Esc: タイトル', 20, (W // 2, H - 26), (220, 220, 235), 'center')
