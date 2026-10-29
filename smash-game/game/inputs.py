"""入力: キーボード2人分＋ゲームパッド。CPUも同じ InputState を返す。"""
import pygame

BUTTONS = ('attack', 'special', 'jump', 'shield', 'grab', 'smash', 'awaken')


class InputState:
    __slots__ = ('x', 'y') + BUTTONS

    def __init__(self):
        self.x = 0.0
        self.y = 0.0  # 上がマイナス
        for b in BUTTONS:
            setattr(self, b, False)

    def copy(self):
        n = InputState()
        n.x, n.y = self.x, self.y
        for b in BUTTONS:
            setattr(n, b, getattr(self, b))
        return n


K = pygame
KEYMAPS = [
    {   # 1P
        'left': [K.K_a], 'right': [K.K_d], 'up': [K.K_w], 'down': [K.K_s],
        'attack': [K.K_j], 'special': [K.K_k], 'shield': [K.K_l], 'jump': [K.K_SPACE, K.K_i],
        'grab': [K.K_u], 'smash': [K.K_o], 'awaken': [K.K_p],
    },
    {   # 2P
        'left': [K.K_LEFT], 'right': [K.K_RIGHT], 'up': [K.K_UP], 'down': [K.K_DOWN],
        'attack': [K.K_KP1, K.K_COMMA], 'special': [K.K_KP2, K.K_PERIOD], 'shield': [K.K_KP3, K.K_SLASH],
        'jump': [K.K_KP0, K.K_KP5, K.K_RSHIFT], 'grab': [K.K_KP4, K.K_SEMICOLON],
        'smash': [K.K_KP6, K.K_QUOTE], 'awaken': [K.K_KP7, K.K_RIGHTBRACKET],
    },
]

KEY_HELP = [
    [('移動', 'W A S D'), ('ジャンプ', 'Space / I'), ('攻撃', 'J'), ('必殺ワザ', 'K'), ('ガード', 'L'),
     ('つかみ', 'U'), ('スマッシュ', 'O'), ('覚醒', 'P')],
    [('移動', '← ↑ → ↓'), ('ジャンプ', 'テンキー0 / 右Shift'), ('攻撃', 'テンキー1 / ,'), ('必殺ワザ', 'テンキー2 / .'),
     ('ガード', 'テンキー3 / /'), ('つかみ', 'テンキー4 / ;'), ('スマッシュ', 'テンキー6 / \''), ('覚醒', 'テンキー7 / ]')],
]


class HumanController:
    """キーボード（keymap番号）とゲームパッド（joy番号）を合成する。"""

    def __init__(self, keymap_idx, joy_idx):
        self.km = KEYMAPS[keymap_idx] if keymap_idx is not None else None
        self.joy_idx = joy_idx
        self.tap_jump_pad = True

    def get(self, world, fighter):
        s = InputState()
        keys = pygame.key.get_pressed()
        if self.km:
            def held(name):
                return any(keys[k] for k in self.km[name])
            s.x = (1.0 if held('right') else 0.0) - (1.0 if held('left') else 0.0)
            s.y = (1.0 if held('down') else 0.0) - (1.0 if held('up') else 0.0)
            for b in ('attack', 'special', 'shield', 'jump', 'grab', 'smash', 'awaken'):
                setattr(s, b, held(b))
        joy = joystick(self.joy_idx)
        if joy is not None:
            try:
                ax = joy.get_axis(0) if joy.get_numaxes() > 0 else 0
                ay = joy.get_axis(1) if joy.get_numaxes() > 1 else 0
                if joy.get_numhats() > 0:
                    hx, hy = joy.get_hat(0)
                    if hx or hy:
                        ax, ay = hx, -hy
                if abs(ax) > 0.25:
                    s.x = max(-1.0, min(1.0, ax))
                if abs(ay) > 0.25:
                    s.y = max(-1.0, min(1.0, ay))
                nb = joy.get_numbuttons()

                def jb(i):
                    return i < nb and joy.get_button(i)
                s.attack |= bool(jb(0))
                s.special |= bool(jb(1))
                s.jump |= bool(jb(2) or jb(3))
                s.shield |= bool(jb(5))
                s.grab |= bool(jb(4))
                s.awaken |= bool(jb(8) or jb(9))
                if self.tap_jump_pad and ay < -0.75:
                    s.jump = True
                # 右スティック = スマッシュ
                if joy.get_numaxes() >= 4:
                    rx, ry = joy.get_axis(2), joy.get_axis(3)
                    if abs(rx) > 0.6 or abs(ry) > 0.6:
                        s.smash = True
                        if abs(rx) >= abs(ry):
                            s.x, s.y = (1.0 if rx > 0 else -1.0), 0.0
                        else:
                            s.x, s.y = 0.0, (1.0 if ry > 0 else -1.0)
            except pygame.error:
                pass
        return s


_joys = {}


def joystick(i):
    if i is None:
        return None
    try:
        if pygame.joystick.get_count() <= i:
            return None
        if i not in _joys:
            j = pygame.joystick.Joystick(i)
            j.init()
            _joys[i] = j
        return _joys[i]
    except pygame.error:
        return None
