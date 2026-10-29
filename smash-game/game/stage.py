"""ステージ: 本体（すり抜け不可）とすり抜け足場、場外ライン。"""
import math


class Platform:
    def __init__(self, x1, x2, y, solid=False, depth=0, move=None):
        self.bx1, self.bx2, self.by = x1, x2, y
        self.x1, self.x2, self.y = x1, x2, y
        self.solid = solid
        self.depth = depth
        self.move = move  # (dx振幅, dy振幅, 周期フレーム)
        self.dx = self.dy = 0.0

    def update(self, frame):
        if not self.move:
            return
        ax, ay, period = self.move
        t = 2 * math.pi * frame / period
        nx, ny = ax * math.sin(t), ay * math.sin(t)
        ox, oy = self.x1 - self.bx1, self.y - self.by
        self.dx, self.dy = nx - ox, ny - oy
        self.x1, self.x2, self.y = self.bx1 + nx, self.bx2 + nx, self.by + ny


class Ledge:
    def __init__(self, x, y, d):
        self.x, self.y, self.dir = x, y, d  # dir: ステージの外側方向
        self.holder = None


class Stage:
    def __init__(self, key, name, sub, main, plats, blast, spawns, theme):
        self.key, self.name, self.sub = key, name, sub
        self.main = main
        self.plats = plats
        self.blast = blast  # (左, 右, 上, 下)
        self.spawns = spawns
        self.theme = theme
        self.ledges = [Ledge(main.x1, main.y, -1), Ledge(main.x2, main.y, 1)]

    def update(self, frame):
        for p in self.plats:
            p.update(frame)

    def surfaces(self):
        return [self.main] + self.plats


def make_stage(key):
    if key == 'battlefield':
        return Stage(key, '戦場', '足場が3つの標準ステージ',
                     Platform(-430, 430, 0, True, 150),
                     [Platform(-300, -120, -140), Platform(120, 300, -140), Platform(-90, 90, -275)],
                     (-1350, 1350, -1400, 720), [-280, 280, -110, 110], 'dusk')
    if key == 'final':
        return Stage(key, '終点', '足場なしの平らなステージ',
                     Platform(-520, 520, 0, True, 130), [],
                     (-1400, 1400, -1400, 720), [-330, 330, -110, 110], 'space')
    if key == 'skyway':
        return Stage(key, 'スカイウェイ', '動く足場のある小さめステージ',
                     Platform(-360, 360, 0, True, 120),
                     [Platform(-100, 100, -170, move=(280, 0, 520)), Platform(-500, -360, -60), Platform(360, 500, -60)],
                     (-1250, 1250, -1350, 700), [-250, 250, -90, 90], 'sky')
    raise KeyError(key)


STAGE_KEYS = ['battlefield', 'final', 'skyway']
