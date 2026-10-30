"""CPU。レベル 0（棒立ち）〜 9。InputState を返すだけなので人間と同じルールで動く。"""
import math
from .inputs import InputState


def S(**kw):
    s = InputState()
    for k, v in kw.items():
        setattr(s, k, v)
    return s


def sgn(v):
    return 1 if v > 0 else -1


class CpuController:
    def __init__(self, level, rng):
        self.level = level
        self.rng = rng
        self.seq = []
        self.wait = 0
        self.hold_x = 0.0
        self.hold_y = 0.0

    def push(self, *frames):
        self.seq.extend(frames)

    def press(self, **kw):
        self.push(S(**kw), S(x=kw.get('x', 0.0), y=0.0))

    def get(self, w, f):
        if self.seq:
            return self.seq.pop(0)
        if self.level <= 0 or w.countdown > 0 or f.state == 'dead':
            return S()
        st = f.state
        if st == 'respawn':
            return S(x=-sgn(f.x) * 0.0, y=1.0 if self.rng.random() < 0.03 else 0.0)
        if st == 'grabbed':
            if self.rng.random() < 0.15 + self.level * 0.06:
                return S(attack=(f.anim % 4 < 2), x=1.0 if f.anim % 8 < 4 else -1.0)
            return S()
        if st == 'ledge':
            return self.ledge(w, f)
        if st == 'hold':
            return self.hold(w, f)
        if st in ('hitstun',):
            # ずらし: 外側に飛ばされているならステージ側へ
            return S(x=-sgn(f.kx) if abs(f.kx) > 3 else 0.0, y=-1.0 if f.ky > 3 else 0.0)
        if self.offstage(w, f):
            return self.recover(w, f)
        if self.wait > 0:
            self.wait -= 1
            return S(x=self.hold_x, y=self.hold_y)
        self.wait = max(0, 10 - self.level) + self.rng.randint(0, max(0, 6 - self.level // 2))
        self.hold_y = 0.0
        return self.fight(w, f)

    # ------------------------------------------------------------ 状況別
    def offstage(self, w, f):
        m = w.stage.main
        if f.ground is not None:
            return False
        return f.x < m.x1 - 4 or f.x > m.x2 + 4 or f.y > m.y + 10

    def recover(self, w, f):
        m = w.stage.main
        L = min(w.stage.ledges, key=lambda L: abs(L.x - f.x))
        under = m.x1 <= f.x <= m.x2
        tx = L.x + L.dir * 50 if under else L.x
        dx = tx - f.x
        dy = f.y - L.y
        x = sgn(dx)
        if f.state in ('helpless', 'move', 'dodge', 'awaken'):
            return S(x=x)
        if f.state != 'air':
            return S(x=x)
        if f.vy > -3:
            if f.jumps > 0 and dy > -40 and (abs(dx) > 60 or dy > 20):
                self.push(S(x=x, jump=True), S(x=x), S(x=x))
                return S(x=x)
            if not f.used_up and (dy > 30 or abs(dx) > 230) and (f.jumps == 0 or dy > 120):
                n = math.hypot(dx, dy + 80) or 1
                ux, uy = dx / n, -abs(dy + 80) / n
                self.push(S(x=ux, y=min(uy, -0.6), special=True), S(x=ux, y=min(uy, -0.6)),
                          *[S(x=ux, y=uy) for _ in range(18)])
                return S(x=ux, y=-1.0)
            if not f.used_side and abs(dx) > 260 and dy < 90 and f.char.side_recover:
                self.push(S(x=x, special=True), S(x=x))
                return S(x=x)
        return S(x=x)

    def ledge(self, w, f):
        if f.timer < 10 + self.rng.randint(0, 30):
            return S()
        L = f.ledge
        toward = -L.dir
        r = self.rng.random()
        if r < 0.4:
            return S(x=toward)
        if r < 0.65:
            self.push(S(jump=True), S(jump=True), S(x=toward), S(x=toward))
            return S(jump=True)
        if r < 0.82:
            self.press(attack=True)
            return S()
        self.press(shield=True)
        return S()

    def hold(self, w, f):
        t = f.grab_target
        if t is None or f.timer < 8:
            return S()
        if f.timer < 40 and t.damage < 60 and self.rng.random() < 0.06 * self.level and f.pummel_cd <= 0:
            return S(attack=f.anim % 2 == 0)
        m = w.stage.main
        dist_front = (m.x2 - f.x) if f.face > 0 else (f.x - m.x1)
        dist_back = (f.x - m.x1) if f.face > 0 else (m.x2 - f.x)
        if t.damage < 50 and self.rng.random() < 0.5:
            return S(y=1.0 if self.rng.random() < 0.5 else -1.0)
        if dist_back < dist_front:
            return S(x=-f.face)
        return S(x=f.face)

    def target(self, w, f):
        best, bd = None, 1e9
        for o in w.opponents(f):
            if not o.alive or o.state == 'respawn':
                continue
            d = abs(o.x - f.x) + abs(o.y - f.y) * 0.7 + (300 if o.inv > 0 else 0)
            if d < bd:
                best, bd = o, d
        return best

    def fight(self, w, f):
        t = self.target(w, f)
        rnd = self.rng.random
        lv = self.level
        m = w.stage.main
        if t is None:
            self.hold_x = -sgn(f.x) if abs(f.x) > 100 else 0.0
            return S(x=self.hold_x)
        dx, dy = t.x - f.x, t.y - f.y
        adx = abs(dx)
        dirx = sgn(dx)
        st = f.state
        actionable_ground = st in ('stand',)
        self.hold_x = 0.0

        if st == 'shield':
            if t.state == 'move' and adx < 140 and rnd() < 0.85:
                self.wait = 6
                return S(shield=True)
            if adx < 70 and rnd() < 0.5:
                self.press(shield=True, attack=True)
                return S(shield=True)
            return S()

        # 覚醒
        if f.can_awaken() and adx < 420 and abs(dy) < 260 and st in ('stand', 'air') and rnd() < 0.3:
            self.press(awaken=True)
            return S()

        # 防御
        threat = t.state == 'move' and adx < 130 and abs(dy) < 110 and t.move.d.hits and t.move.f < 10
        threat = threat or any(p.owner is t and abs(p.x - f.x) < 140 and abs(p.y - (f.y - 40)) < 80 for p in w.projs)
        if threat and actionable_ground and rnd() < 0.07 * lv:
            r = rnd()
            if r < 0.6:
                self.push(*[S(shield=True) for _ in range(10 + self.rng.randint(0, 8))])
            elif r < 0.8:
                self.push(S(shield=True), S(shield=True, y=1.0), S())
            else:
                d = -dirx if rnd() < 0.5 else dirx
                self.push(S(shield=True), S(shield=True, x=d), S())
            return S(shield=True)

        if actionable_ground:
            edge_l, edge_r = m.x1 + 40, m.x2 - 40
            on_main = f.ground is m
            if t.state == 'shield' and adx < 80:
                self.push(S(x=dirx * 0.2, grab=True), S())
                return S(x=dirx * 0.2)
            if adx < 80 and abs(dy) < 50:
                if f.face != dirx:
                    self.push(S(x=dirx * 0.4))
                kill_pct = 85 + (t.weight - 100) * 0.8
                r = rnd()
                if t.damage > kill_pct and r < 0.55:
                    n = self.rng.randint(0, 25)
                    self.push(S(smash=True, x=dirx), *[S(smash=True) for _ in range(n)], S())
                elif t.state == 'shield' or r < 0.18:
                    self.push(S(x=dirx * 0.3, grab=True), S())
                elif r < 0.4:
                    self.push(S(attack=True), S(), S(attack=True), S(), S(attack=True), S())
                elif r < 0.62:
                    self.push(S(x=dirx * 0.5, attack=True), S())
                elif r < 0.78:
                    self.push(S(y=0.6, attack=True), S())
                elif r < 0.9:
                    self.push(S(x=dirx * 0.4, special=True), S())
                else:
                    self.push(S(y=1.0, smash=True), S())
                return S(x=dirx * 0.4)
            if dy < -90 and adx < 90:
                if rnd() < 0.45 and dy > -200:
                    self.push(S(y=-1.0, smash=True), S())
                    return S()
                self.push(S(jump=True), S(jump=True), S(jump=True), S())
                return S(jump=True)
            if adx > 280 and f.face == dirx and rnd() < 0.03 * lv:
                chg = f.moves['nspecial'].charge_at is not None
                self.push(S(special=True), S(), S(special=True) if chg else S())
                if chg:
                    self.push(*[S(special=True) for _ in range(self.rng.randint(5, 50))], S())
                return S()
            # 移動（相手が場外なら崖際で待つ）
            nx = f.x + dirx * 60
            if on_main and (nx < edge_l or nx > edge_r) and (t.x < m.x1 or t.x > m.x2):
                if lv >= 6 and adx < 260 and abs(dy) < 200 and rnd() < 0.15:
                    self.push(S(x=dirx, jump=True), S(x=dirx), S(x=dirx), S(x=dirx), S(x=dirx * 0.2, attack=True), S(x=-dirx))
                    return S(x=dirx)
                return S()
            if rnd() < 0.015 * lv and adx < 260:
                self.push(S(x=dirx, jump=True), S(x=dirx), S(x=dirx))
                return S(x=dirx)
            self.hold_x = float(dirx)
            return S(x=dirx)

        if st == 'air':
            x = float(dirx)
            if f.x < m.x1 + 20 and dirx < 0 and t.x < m.x1 - 80:
                x = 1.0
            if f.x > m.x2 - 20 and dirx > 0 and t.x > m.x2 + 80:
                x = -1.0
            if adx < 95 and abs(dy) < 100:
                if dy < -45:
                    self.push(S(y=-1.0, attack=True), S(x=x))
                elif dy > 45:
                    self.push(S(y=1.0, attack=True), S(x=x))
                elif adx < 30:
                    self.push(S(attack=True), S(x=x))
                elif dirx == f.face:
                    self.push(S(x=float(dirx), attack=True), S(x=x))
                else:
                    self.push(S(x=float(dirx), attack=True), S(x=x))
                return S(x=x)
            if dy < -130 and f.jumps > 0 and f.vy > -2 and rnd() < 0.5:
                self.push(S(x=x, jump=True), S(x=x))
                return S(x=x)
            if dy > 80 and f.vy > 0 and rnd() < 0.3:
                self.push(S(x=x, y=1.0), S(x=x))
                return S(x=x)
            self.hold_x = x
            return S(x=x)
        return S(x=float(dirx) if st in ('lag',) else 0.0)
