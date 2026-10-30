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


LIP = 26          # 崖の縁の厚み（ここまでは壁がまっすぐ）
SLICE = 12        # 当たり判定の輪切りの厚み
CORNER_R = 10     # 崖の角の丸み（見た目）


def half_width(shape, w, depth, d):
    """上面から深さ d の位置での、ステージ本体の半分の幅。崖の下は内側にえぐれていく。"""
    if d <= LIP:
        return w
    t = min(1.0, (d - LIP) / max(1, depth - LIP))
    if shape == 'wedge':
        # 終点風: 縁の下が少しだけまっすぐ続き、そこから斜めに絞れる
        return w * (1 - 0.92 * t) if t > 0.08 else w * (1 - t * 0.5)
    # 戦場風: 下がお椀型にカーブして絞れる（崖下にもぐり込める）
    return w * math.sqrt(max(0.0, 1 - t * t)) * 0.96 + w * 0.04 * (1 - t)


def build_solids(main, shape):
    """本体を水平な輪切りの矩形の列にする（上から順）。"""
    cx = (main.x1 + main.x2) / 2
    w = (main.x2 - main.x1) / 2
    out = []
    d = 0
    while d < main.depth:
        d2 = min(main.depth, d + (LIP if d == 0 else SLICE))
        hw = max(half_width(shape, w, main.depth, d), half_width(shape, w, main.depth, d2))
        if hw > 4:
            out.append((cx - hw, main.y + d, cx + hw, main.y + d2))
        d = d2
    return out


def outline(main, shape, steps=28):
    """描画用の輪郭（右回り）。崖の角は少し丸める。"""
    cx = (main.x1 + main.x2) / 2
    w = (main.x2 - main.x1) / 2
    y = main.y
    pts = []
    r = CORNER_R
    # 左上の角 → 右上の角（上面）
    for i in range(6):
        a = math.pi + (math.pi / 2) * i / 5
        pts.append((cx - w + r + math.cos(a) * r, y + r + math.sin(a) * r))
    for i in range(6):
        a = -math.pi / 2 + (math.pi / 2) * i / 5
        pts.append((cx + w - r + math.cos(a) * r, y + r + math.sin(a) * r))
    # 右側の壁 → 底
    for i in range(steps + 1):
        d = LIP + (main.depth - LIP) * i / steps
        pts.append((cx + half_width(shape, w, main.depth, d), y + d))
    for i in range(steps, -1, -1):
        d = LIP + (main.depth - LIP) * i / steps
        pts.append((cx - half_width(shape, w, main.depth, d), y + d))
    return pts


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
        self.shape = {'final': 'wedge'}.get(key, 'bowl')
        main.solids = build_solids(main, self.shape)
        main.outline = outline(main, self.shape)

    def update(self, frame):
        for p in self.plats:
            p.update(frame)

    def surfaces(self):
        return [self.main] + self.plats


def make_stage(key):
    if key == 'battlefield':
        return Stage(key, '戦場', '足場が3つの標準ステージ',
                     Platform(-430, 430, 0, True, 210),
                     [Platform(-300, -120, -140), Platform(120, 300, -140), Platform(-90, 90, -275)],
                     (-1350, 1350, -1400, 720), [-280, 280, -110, 110], 'dusk')
    if key == 'final':
        return Stage(key, '終点', '足場なしの平らなステージ',
                     Platform(-520, 520, 0, True, 170), [],
                     (-1400, 1400, -1400, 720), [-330, 330, -110, 110], 'space')
    if key == 'skyway':
        return Stage(key, 'スカイウェイ', '動く足場のある小さめステージ',
                     Platform(-360, 360, 0, True, 170),
                     [Platform(-100, 100, -170, move=(280, 0, 520)), Platform(-500, -360, -60), Platform(360, 500, -60)],
                     (-1250, 1250, -1350, 700), [-250, 250, -90, 90], 'sky')
    raise KeyError(key)


STAGE_KEYS = ['battlefield', 'final', 'skyway']
