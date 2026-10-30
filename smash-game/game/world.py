"""試合の進行: 当たり判定・ふっとばし・飛び道具・撃墜・勝敗。"""
import math
import random
from . import config as C
from .stage import make_stage
from .fighter import Fighter, sign


def calc_kb(p, d, w, bkb, kbg):
    """スマブラ式のふっとばし力（p は被弾後の%）。"""
    return ((((p / 10 + p * d / 20) * 200 / (w + 100) * 1.4) + 18) * kbg / 100) + bkb


def circle_rect(cx, cy, r, rect):
    x1, y1, x2, y2 = rect
    nx = min(max(cx, x1), x2)
    ny = min(max(cy, y1), y2)
    return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r


def rect_rect(a, b):
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]


def hurtbox(f):
    h = f.h * (0.62 if f.crouch else 1.0)
    if f.state == 'knockdown':
        h = f.h * 0.4
    return (f.x - f.hw, f.y - h, f.x + f.hw, f.y)


class Proj:
    def __init__(self, owner, kind, x, y, vx, vy, **kw):
        self.owner, self.kind = owner, kind
        self.x, self.y, self.vx, self.vy = x, y, vx, vy
        self.r = kw.get('r', 12)
        self.dmg = kw.get('dmg', 5)
        self.ang = kw.get('ang', 40)
        self.bkb = kw.get('bkb', 30)
        self.kbg = kw.get('kbg', 40)
        self.life = kw.get('life', 90)
        self.grav = kw.get('grav', 0.0)
        self.bounce = kw.get('bounce', 0)
        self.ax = kw.get('ax', 0.0)
        self.ret = kw.get('ret', False)
        self.rect = kw.get('rect')
        self.reflectable = kw.get('reflectable', True)
        self.pierce = kw.get('pierce', False)
        self.color = kw.get('color', (255, 255, 255))
        self.ground_wave = kw.get('ground_wave', False)
        self.returning = False
        self.hit = set()
        self.t = 0
        self.dead = False

    def box(self):
        if self.rect:
            w, h = self.rect
            return (self.x - w / 2, self.y - h, self.x + w / 2, self.y)
        return None


class World:
    def __init__(self, stage_key, entries, stocks=3, time_limit=0, seed=None, countdown=True):
        """entries: [(CharDef, controller, is_cpu), ...]"""
        self.rng = random.Random(seed)
        self.stage = make_stage(stage_key)
        self.fighters = []
        for i, (ch, ctrl, cpu) in enumerate(entries):
            f = Fighter(i, ch, ctrl, stocks, cpu)
            self.fighters.append(f)
        self.place_start()
        self.projs = []
        self.events = []
        self.frame = 0
        self.cinema = None
        self.countdown = 170 if countdown else 0
        self.go_t = 0
        self.over = False
        self.ending = 0
        self.winner = None
        self.time_limit = time_limit * C.FPS if time_limit else 0
        self.stocks = stocks

    # ------------------------------------------------------------ 補助
    def event(self, kind, x, y, **kw):
        e = dict(kind=kind, x=x, y=y)
        e.update(kw)
        self.events.append(e)

    def place_start(self):
        sp = self.stage.spawns
        for i, f in enumerate(self.fighters):
            f.x = sp[i % len(sp)]
            f.y = self.stage.main.y
            f.ground = self.stage.main
            f.face = 1 if f.x < 0 else -1

    def opponents(self, f):
        return [o for o in self.fighters if o is not f and o.team != f.team and not o.out]

    def ground_below(self, x, y):
        best = None
        for g in self.stage.surfaces():
            if g.x1 <= x <= g.x2 and g.y >= y and (best is None or g.y < best):
                best = g.y
        return best

    def spawn_proj(self, owner, kind, x, y, vx, vy, **kw):
        p = Proj(owner, kind, x, y, vx, vy, **kw)
        p.dir0 = sign(vx) or owner.face
        self.projs.append(p)
        self.event('proj', x, y, proj=kind, color=p.color)
        return p

    # ------------------------------------------------------------ 1フレーム
    def step(self):
        if self.over:
            return
        self.frame += 1
        if self.countdown > 0:
            self.countdown -= 1
            if self.countdown == 0:
                self.go_t = 50
                self.event('go', 0, 0)
            elif self.countdown % 50 == 20 and self.countdown < 160:
                self.event('count', 0, 0, n=self.countdown // 50 + 1)
            for f in self.fighters:
                f.read_input(self)
            return
        if self.go_t > 0:
            self.go_t -= 1
        if self.cinema:
            f = self.cinema[0]
            f.update(self)
            self.cinema[1] -= 1
            if self.cinema[1] <= 0:
                self.cinema = None
            return
        self.stage.update(self.frame)
        for f in self.fighters:
            g = f.ground
            if g is not None and (g.dx or g.dy) and f.state not in ('dead', 'ledge'):
                f.x += g.dx
                f.y = g.y
        for f in self.fighters:
            f.update(self)
        self.resolve_hits()
        self.update_projs()
        self.push_apart()
        self.check_blast()
        self.check_end()

    # ------------------------------------------------------------ 地形
    def collide(self, f, ox, oy):
        st = self.stage
        m = st.main
        if f.ground is not None:
            g = f.ground
            if f.ky < -0.5 or f.vy < -0.5:
                f.ground = None
            elif f.x < g.x1 or f.x > g.x2:
                clamp = f.state in ('dodge', 'shield', 'lag', 'hold', 'jumpsquat', 'grabbed', 'climb', 'dizzy')
                if f.state == 'move' and not f.move.d.keep_vx:
                    clamp = True
                if clamp:
                    f.x = min(max(f.x, g.x1), g.x2)
                    f.vx = 0
                    f.y = g.y
                else:
                    f.ground = None
                    if f.state in ('stand', 'knockdown'):
                        f.set_state('air')
            else:
                f.y = g.y
                f.vy = 0
                if f.ky > 0:
                    f.ky = 0
        if f.ground is not None:
            return
        dy = f.y - oy
        if dy >= 0 and f.state != 'grabbed':
            for g in st.surfaces():
                if not g.solid and (f.drop_t > 0 or f.state == 'helpless' and f.inp.y > 0.7):
                    continue
                if oy - g.dy <= g.y + 1 and f.y >= g.y and g.x1 <= f.x <= g.x2:
                    self.land(f, g)
                    return
        for _ in range(3):
            if not self.collide_solids(f, m):
                break

    def collide_solids(self, f, m):
        """ステージ本体（輪切りの矩形の列）との押し出し。押し出したら True。"""
        l, r, top, bot = f.x - f.hw, f.x + f.hw, f.y - f.h, f.y
        for k, (sx1, sy1, sx2, sy2) in enumerate(m.solids):
            if not (r > sx1 and l < sx2 and bot > sy1 + 1 and top < sy2):
                continue
            pen = {'left': r - sx1, 'right': sx2 - l, 'down': sy2 - top}
            if k == 0:
                pen['up'] = bot - sy1
            side = min(pen, key=pen.get)
            if side == 'up':
                f.x = min(max(f.x, m.x1), m.x2)
                self.land(f, m)
                return True
            if side == 'left':
                f.x = sx1 - f.hw
                self.wall(f, 1)
            elif side == 'right':
                f.x = sx2 + f.hw
                self.wall(f, -1)
            else:
                f.y = sy2 + f.h
                if f.can_tech():
                    f.tech_wall(self, 0, ceiling=True)
                    return True
                if f.vy < 0:
                    f.vy = 0
                if f.ky < 0:
                    f.ky = -f.ky * 0.5
            return True
        return False

    def land(self, f, g):
        f.y = g.y
        f.vy = 0
        f.ground = g
        f.on_land(self)
        if f.ground is not None and f.ky > 0:
            f.ky = 0

    def wall(self, f, side=0):
        """side: 壁がある向き（+1=右側に壁）。"""
        if f.can_tech():
            f.tech_wall(self, side)
            return
        if f.state == 'hitstun' and abs(f.kx) > 6:
            f.kx = -f.kx * 0.5
            self.event('bounce', f.x, f.y - f.h / 2)
        else:
            f.kx = 0
        f.vx = 0

    def push_apart(self):
        fs = [f for f in self.fighters if f.alive and f.ground is not None and f.state not in ('grabbed', 'hold')]
        for i in range(len(fs)):
            for j in range(i + 1, len(fs)):
                a, b = fs[i], fs[j]
                if a.ground is not b.ground:
                    continue
                d = b.x - a.x
                minv = (a.hw + b.hw) * 0.7
                if abs(d) < minv:
                    s = 1 if d >= 0 else -1
                    push = min(1.2, (minv - abs(d)) * 0.15)
                    a.x -= s * push
                    b.x += s * push

    # ------------------------------------------------------------ 当たり判定
    def resolve_hits(self):
        for a in self.fighters:
            if a.state != 'move' or not a.alive or a.hitlag > 0:
                continue
            m = a.move
            for h in m.d.active(m.f):
                boxes = [(a.x + h['x'] * a.face, a.y + h['y'], a.face)]
                if h['both']:
                    boxes.append((a.x - h['x'] * a.face, a.y + h['y'], -a.face))
                for t in self.fighters:
                    if t is a or not t.alive or t.team == a.team or t.grabbed_by is a or t.state == 'respawn':
                        continue
                    key = (t.idx, h['group'])
                    last = m.hitlog.get(key)
                    if last is not None and (not h['rehit'] or m.f - last < h['rehit']):
                        continue
                    hb = hurtbox(t)
                    for cx, cy, dsg in boxes:
                        rc = h.get('rect')
                        if rc is not None:
                            x1, x2 = (rc[0], rc[2]) if dsg > 0 else (-rc[2], -rc[0])
                            hit = rect_rect((a.x + x1, a.y + rc[1], a.x + x2, a.y + rc[3]), hb)
                        else:
                            hit = circle_rect(cx, cy, h['r'], hb)
                        if hit:
                            if h['radial']:
                                dsg = sign(t.x - a.x) or a.face
                            if self.apply_hit(a, t, h, dsg, m):
                                m.hitlog[key] = m.f
                            break
                    if a.state != 'move' or a.move is not m:
                        break
                if a.state != 'move' or a.move is not m:
                    break

    def apply_hit(self, a, t, h, dsg, m=None, proj=None):
        if t.invincible() or t.state == 'respawn':
            return False
        if t.state == 'move' and t.move.d.in_window('counter', t.move.f) and not h.get('grab') and proj is None:
            self.counter(t, a, h)
            return True
        if h.get('grab'):
            if a.grab_target is not None or (t.ground is None and t.state != 'shield') or t.grabbed_by:
                return False
            self.grab(a, t, h.get('cmd'))
            return True
        dmg = h['dmg']
        if m is not None and m.d.charge_at is not None and m.d.charge_btn != 'special':
            dmg *= 1 + 0.4 * m.charge / 60
        if a.awakened > 0:
            dmg *= 1.2
        dmg = round(dmg, 1)
        hl = int(min(20, dmg * 0.65 + 4))
        if t.state == 'shield':
            t.shield_hp -= dmg * 1.2 * h.get('shieldmul', 1.0)
            t.shieldstun = int(dmg * 0.8) + 3
            t.vx = dsg * min(9, 2 + dmg * 0.45)
            t.hitlag = hl // 2
            if proj is None:
                a.hitlag = hl // 2
            self.event('block', t.x + dsg * -t.hw, t.y - t.h / 2, dmg=dmg, color=t.color)
            if t.shield_hp <= 0:
                self.shield_break(t)
            return True
        t.damage = min(999.0, t.damage + dmg)
        a.dmg_dealt += dmg
        a.meter = min(100.0, a.meter + dmg * 1.0)
        t.meter = min(100.0, t.meter + dmg * 0.6)
        kb = calc_kb(t.damage, dmg, t.weight, h['bkb'], h['kbg'])
        if t.state == 'move' and t.move.d.in_window('armor', t.move.f) and kb < 230:
            t.hitlag = hl
            if proj is None:
                a.hitlag = hl
            t.dmg_flash = 8
            self.event('armor', t.x, t.y - t.h / 2, dmg=dmg)
            return True
        if t.crouch:
            kb *= 0.85
        if t.grab_target is not None:
            self.grab_release(t, quiet=True)
        if t.grabbed_by is not None:
            hold = t.grabbed_by
            hold.grab_target = None
            t.grabbed_by = None
            hold.to_neutral()
        if t.ledge:
            t.leave_ledge(self)
        self.launch(t, kb, h['ang'], dsg)
        t.last_hit_by = a
        t.last_hit_frame = self.frame
        t.dmg_flash = 10
        t.hitlag = hl
        t.shake = hl
        if proj is None:
            a.hitlag = hl
        if m is not None and m.d.on_hit:
            m.d.on_hit(self, a, m, t)
        hx = (a.x + t.x) / 2 if proj is None else proj.x
        hy = t.y - t.h * 0.55
        self.event('hit', hx, hy, dmg=dmg, kb=kb, color=a.color, who=t, by=a, fx=h.get('fx', 'slash'))
        return True

    def launch(self, t, kb, ang, dsg):
        rad = math.radians(ang)
        lx, ly = math.cos(rad) * dsg, -math.sin(rad)
        # ずらし（DI）: スティックの横成分で最大15度
        i = t.inp
        px, py = -ly, lx
        dot = max(-1.0, min(1.0, i.x * px + i.y * py))
        rot = dot * math.radians(15) * (1 if kb > 60 else 0)
        c, s = math.cos(rot), math.sin(rot)
        lx, ly = lx * c - ly * s, lx * s + ly * c
        if t.ground is not None and ly > 0:
            ly = -ly * 0.8
        speed = kb * C.LAUNCH_SCALE
        t.set_state('hitstun')
        t.kx, t.ky = lx * speed, ly * speed
        t.vx = t.vy = 0
        t.hitstun = int(kb * C.HITSTUN_MUL)
        t.tumble = kb > 80
        t.fastfall = False
        t.shieldstun = 0
        if t.ky < -1:
            t.ground = None

    def counter(self, t, a, h):
        t.start_move(self, 'd_hit')
        dsg = sign(a.x - t.x) or t.face
        t.face = dsg
        ch = dict(dmg=max(8.0, h['dmg'] * 1.3), ang=40, bkb=60, kbg=85, fx='big')
        self.event('counter', t.x, t.y - t.h / 2, color=(120, 230, 255))
        self.apply_hit(t, a, ch, dsg)

    # ------------------------------------------------------------ つかみ・投げ
    def grab(self, a, t, cmd=False):
        a.grab_target = t
        t.grabbed_by = a
        t.set_state('grabbed')
        t.vx = t.vy = t.kx = t.ky = 0
        t.shieldstun = 0
        t.ground = a.ground
        self.event('grab', t.x, t.y - t.h / 2, color=a.color)
        if cmd:
            a.start_move(self, 's_throw')
        else:
            a.set_state('hold', 0)
            a.grab_timer = 50 + t.damage * 0.7
        a.hold_position()

    def grab_release(self, a, quiet=False):
        t = a.grab_target
        a.grab_target = None
        if t is not None and t.grabbed_by is a:
            t.grabbed_by = None
            t.kx = a.face * 5
            if t.ground is not None:
                t.set_state('lag', 12)
            else:
                t.set_state('air')
        if not quiet:
            a.kx = -a.face * 3
            a.set_state('lag', 14)

    def throw_release(self, a, params, dirsign):
        t = a.grab_target
        if t is None:
            return
        a.grab_target = None
        t.grabbed_by = None
        t.inv = 0
        t.set_state('air')
        h = dict(dmg=params['dmg'], ang=params['ang'], bkb=params['bkb'], kbg=params['kbg'], fx='big')
        self.apply_hit(a, t, h, dirsign)
        a.hitlag = 0

    def pummel(self, a, t):
        d = 1.6
        t.damage = min(999.0, t.damage + d)
        a.dmg_dealt += d
        a.meter = min(100.0, a.meter + d)
        t.hitlag = 6
        t.shake = 6
        t.dmg_flash = 6
        self.event('hit', t.x, t.y - t.h / 2, dmg=d, kb=0, color=a.color, who=t, by=a, fx='small')

    def shield_break(self, f):
        f.set_state('dizzy', 220)
        f.vy = -11
        f.ground = None
        f.shield_hp = C.SHIELD_MAX * 0.4
        self.event('shieldbreak', f.x, f.y - f.h / 2, color=f.color)

    # ------------------------------------------------------------ 覚醒（必殺の切り札）
    def start_awaken(self, f):
        f.meter = 0
        f.set_state('awaken', 0)
        f.vx = f.vy = f.kx = f.ky = 0
        self.cinema = [f, 70]
        self.event('awaken', f.x, f.y - f.h / 2, who=f, color=f.char.look['accent'])

    def awaken_blast(self, f):
        self.event('awaken_blast', f.x, f.y - f.h / 2, who=f, color=f.char.look['accent'])
        for t in self.opponents(f):
            if not t.alive or t.state == 'respawn':
                continue
            if abs(t.x - f.x) < 720 and abs(t.y - f.y) < 520:
                if t.state == 'shield':
                    t.set_state('stand')
                t.inv = 0
                if t.state == 'move' and t.move.d.inv:
                    t.to_neutral()
                h = dict(dmg=round(26 * f.char.power, 1), ang=50, bkb=95, kbg=92, fx='big')
                self.apply_hit(f, t, h, sign(t.x - f.x) or f.face)
        f.awakened = 600
        f.hitlag = 0

    # ------------------------------------------------------------ 飛び道具
    def update_projs(self):
        st = self.stage
        m = st.main
        bl, br, bt, bb = st.blast
        for p in self.projs:
            p.t += 1
            p.life -= 1
            if p.ret and not p.returning:
                p.vx += p.ax
                if p.vx * p.dir0 <= 0:
                    p.returning = True
                    p.hit = set()
            if p.returning:
                o = p.owner
                dx, dy = o.x - p.x, (o.y - o.h * 0.6) - p.y
                dist = math.hypot(dx, dy) or 1
                p.vx = approach_f(p.vx, dx / dist * 13, 0.8)
                p.vy = approach_f(p.vy, dy / dist * 13, 0.8)
                if dist < 30 or not o.alive:
                    p.dead = True
            p.vy += p.grav
            oy = p.y
            p.x += p.vx
            p.y += p.vy
            if p.grav > 0:
                for g in st.surfaces():
                    if p.vy > 0 and oy + p.r <= g.y + 1 <= p.y + p.r + 1 and g.x1 <= p.x <= g.x2:
                        p.y = g.y - p.r
                        if p.ground_wave:
                            p.vy = 0
                        elif p.bounce > 0:
                            p.vy = -6
                            p.bounce -= 1
                        else:
                            p.dead = True
                        break
            if any(sx1 < p.x < sx2 and sy1 < p.y < sy2 for sx1, sy1, sx2, sy2 in m.solids):
                p.dead = True
            if p.life <= 0 or not (bl < p.x < br and bt < p.y < bb):
                p.dead = True
            if p.dead:
                continue
            for t in self.fighters:
                if t is p.owner or not t.alive or t.team == p.owner.team or t in p.hit or t.state == 'respawn':
                    continue
                hb = hurtbox(t)
                box = p.box()
                hit = rect_rect(box, hb) if box else circle_rect(p.x, p.y, p.r, hb)
                if not hit or t.invincible():
                    continue
                if (t.state == 'move' and t.move.d.reflect and t.move.d.in_window('counter', t.move.f)
                        and p.reflectable):
                    p.owner = t
                    p.vx = -p.vx * 1.3
                    p.ax = -p.ax
                    p.dir0 = -p.dir0
                    p.dmg *= 1.3
                    p.hit = set()
                    p.life = max(p.life, 60)
                    p.ret = p.returning = False
                    self.event('reflect', p.x, p.y, color=(120, 230, 255))
                    break
                h = dict(dmg=p.dmg, ang=p.ang, bkb=p.bkb, kbg=p.kbg, fx=p.kind)
                dsg = sign(p.vx) or sign(t.x - p.x) or 1
                self.apply_hit(p.owner, t, h, dsg, proj=p)
                p.hit.add(t)
                if not p.pierce:
                    p.dead = True
                    break
        self.projs = [p for p in self.projs if not p.dead]

    # ------------------------------------------------------------ 撃墜・勝敗
    def check_blast(self):
        bl, br, bt, bb = self.stage.blast
        for f in self.fighters:
            if not f.alive or f.state == 'respawn':
                continue
            if f.x < bl or f.x > br or f.y > bb or f.y < bt:
                self.ko(f)

    def ko(self, f):
        bl, br, bt, bb = self.stage.blast
        ex = min(max(f.x, bl), br)
        ey = min(max(f.y - f.h / 2, bt), bb)
        self.event('ko', ex, ey, who=f, color=f.color)
        if f.grab_target is not None:
            self.grab_release(f, quiet=True)
        if f.grabbed_by is not None:
            f.grabbed_by.grab_target = None
            f.grabbed_by.to_neutral()
            f.grabbed_by = None
        if f.ledge:
            f.leave_ledge(self)
        killer = f.last_hit_by
        if killer is not None and self.frame - getattr(f, 'last_hit_frame', -9999) < 600 and killer is not f:
            killer.kos += 1
        f.falls += 1
        f.stocks -= 1
        f.set_state('dead', C.RESPAWN_WAIT)
        f.kx = f.ky = f.vx = f.vy = 0
        f.ground = None
        if self.stocks and f.stocks <= 0:
            f.out = True
            f.place = sum(1 for o in self.fighters if not o.out) + 1

    def respawn(self, f):
        f.damage = 0.0
        f.x, f.y = 0.0, -330.0
        f.vx = f.vy = f.kx = f.ky = 0
        f.ground = None
        f.jumps = f.st['jumps']
        f.used_up = f.used_side = f.used_dodge = False
        f.shield_hp = C.SHIELD_MAX
        f.last_hit_by = None
        f.set_state('respawn', 0)
        f.inv = 0
        self.event('respawn', f.x, f.y, who=f)

    def check_end(self):
        if self.ending > 0:
            self.ending -= 1
            if self.ending == 0:
                self.over = True
            return
        teams = {f.team for f in self.fighters if not f.out}
        timeout = self.time_limit and self.frame >= self.time_limit + 170
        if len(teams) <= 1 or timeout:
            alive = [f for f in self.fighters if not f.out]
            if timeout:
                alive.sort(key=lambda f: (-(f.kos - f.falls), f.damage))
                for i, f in enumerate(alive):
                    f.place = i + 1
            else:
                for f in alive:
                    f.place = 1
            self.winner = min(self.fighters, key=lambda f: f.place)
            self.ending = 100
            self.event('game', 0, 0)

    def time_left(self):
        if not self.time_limit:
            return None
        return max(0, self.time_limit - max(0, self.frame - 170)) / C.FPS


def approach_f(v, t, s):
    return min(t, v + s) if v < t else max(t, v - s)
