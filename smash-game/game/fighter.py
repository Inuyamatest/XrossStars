"""ファイターの状態遷移と物理。"""
import math
from . import config as C
from .inputs import InputState, BUTTONS
from .moves import THROWS


def approach(v, target, step):
    if v < target:
        return min(target, v + step)
    return max(target, v - step)


def sign(v):
    return 1 if v > 0 else (-1 if v < 0 else 0)


class MoveInst:
    __slots__ = ('d', 'f', 'charge', 'hitlog', 'data')

    def __init__(self, d):
        self.d = d
        self.f = 0
        self.charge = 0
        self.hitlog = {}
        self.data = {}


class Fighter:
    def __init__(self, idx, char, ctrl, stocks, is_cpu=False):
        self.idx = idx
        self.team = idx
        self.char = char
        self.st = char.stats
        self.moves = char.build_moves()
        self.ctrl = ctrl
        self.is_cpu = is_cpu
        self.color = C.PLAYER_COLORS[idx % 4]
        self.tag = 'CP' if is_cpu else C.PLAYER_TAGS[idx % 4]
        self.stocks = stocks
        self.hw, self.h = char.hw, char.h
        self.weight = self.st['weight']
        self.damage = 0.0
        self.x = self.y = 0.0
        self.vx = self.vy = 0.0
        self.kx = self.ky = 0.0
        self.face = 1
        self.ground = None
        self.jumps = self.st['jumps']
        self.state = 'stand'
        self.timer = 0
        self.move = None
        self.hitlag = 0
        self.hitstun = 0
        self.shieldstun = 0
        self.inv = 0
        self.shield_hp = C.SHIELD_MAX
        self.fastfall = False
        self.used_up = self.used_side = self.used_dodge = self.ledge_inv_used = False
        self.ledge = None
        self.ledge_cd = 0
        self.drop_t = 0
        self.grab_target = None
        self.grabbed_by = None
        self.grab_timer = 0
        self.pummel_cd = 0
        self.meter = 0.0
        self.awakened = 0
        self.inp = InputState()
        self.prev = InputState()
        self.buf = {b: 0 for b in BUTTONS}
        self.tapx = self.tapy = 99
        self.last_hit_by = None
        self.kos = self.falls = 0
        self.dmg_dealt = 0.0
        self.anim = 0
        self.hidden = False
        self.out = False
        self.place = 0
        self.crouch = False
        self.dodge = None
        self.tumble = False
        self.shake = 0
        self.dmg_flash = 0
        self.ai = None
        self.tech_t = 0      # 受け身の受付残りフレーム
        self.tech_lock = 0   # 受け身の再入力禁止（連打対策）

    # ------------------------------------------------------------ 入力
    def read_input(self, w):
        self.prev = self.inp
        self.inp = self.ctrl.get(w, self) if self.ctrl else InputState()
        i, p = self.inp, self.prev
        for b in BUTTONS:
            if getattr(i, b) and not getattr(p, b):
                self.buf[b] = C.BUFFER
            elif self.buf[b] > 0:
                self.buf[b] -= 1
        self.tapx = 0 if (abs(i.x) > 0.75 and (abs(p.x) < 0.3 or sign(i.x) != sign(p.x))) else self.tapx + 1
        self.tapy = 0 if (abs(i.y) > 0.75 and (abs(p.y) < 0.3 or sign(i.y) != sign(p.y))) else self.tapy + 1

    def consume(self, b):
        if self.buf[b] > 0:
            self.buf[b] = 0
            return True
        return False

    def pressed(self, b):
        return self.buf[b] > 0

    # ------------------------------------------------------------ 状態ヘルパ
    @property
    def alive(self):
        return not self.out and self.state != 'dead'

    def invincible(self):
        if self.inv > 0 or self.hidden:
            return True
        if self.state in ('dead', 'climb'):
            return True
        if self.state == 'dodge' and self.dodge and self.dodge['inv'][0] <= self.timer <= self.dodge['inv'][1]:
            return True
        if self.state == 'move' and self.move.d.in_window('inv', self.move.f):
            return True
        return False

    def set_state(self, s, timer=0):
        self.state = s
        self.timer = timer
        if s != 'move':
            self.move = None
        self.hidden = False

    def to_neutral(self):
        self.set_state('stand' if self.ground else 'air')

    def start_move(self, w, key):
        d = self.moves[key]
        if d.once == 'up':
            self.used_up = True
        elif d.once == 'side' and not self.ground:
            self.used_side = True
        self.set_state('move')
        self.move = MoveInst(d)
        w.event('swing', self.x, self.y - 40, who=self, key=key)

    def end_move(self, w):
        d = self.move.d
        if d.helpless and not self.ground:
            self.set_state('helpless')
        else:
            self.to_neutral()

    def can_awaken(self):
        return self.meter >= 100

    # ------------------------------------------------------------ メイン更新
    def update(self, w):
        self.anim += 1
        if self.out:
            return
        if self.dmg_flash > 0:
            self.dmg_flash -= 1
        if self.state == 'dead':
            self.timer -= 1
            if self.timer <= 0:
                w.respawn(self)
            return
        self.read_input(w)
        self.update_tech_input()
        if self.hitlag > 0:
            self.hitlag -= 1
            if self.shake > 0:
                self.shake -= 1
            return
        self.shake = 0
        if self.inv > 0:
            self.inv -= 1
        if self.ledge_cd > 0:
            self.ledge_cd -= 1
        if self.drop_t > 0:
            self.drop_t -= 1
        if self.pummel_cd > 0:
            self.pummel_cd -= 1
        if self.awakened > 0:
            self.awakened -= 1
        if self.state != 'shield' and self.shield_hp < C.SHIELD_MAX:
            self.shield_hp = min(C.SHIELD_MAX, self.shield_hp + C.SHIELD_REGEN)
        self.crouch = False
        getattr(self, 'st_' + self.state)(w)
        if self.state not in ('ledge', 'climb', 'grabbed', 'dead', 'respawn', 'awaken'):
            self.physics(w)
        if self.grab_target is not None:
            self.hold_position()

    # ------------------------------------------------------------ 地上
    def ground_actions(self, w):
        i = self.inp
        if self.can_awaken() and (self.consume('awaken') or (self.pressed('attack') and self.pressed('special'))):
            self.buf['attack'] = self.buf['special'] = 0
            w.start_awaken(self)
            return True
        if self.consume('jump'):
            self.set_state('jumpsquat', 3)
            return True
        if self.consume('grab') or (i.shield and self.pressed('attack')):
            self.buf['attack'] = 0
            dashing = abs(self.vx) > self.st['walk'] + 0.5
            self.start_move(w, 'dashgrab' if dashing else 'grab')
            return True
        if i.shield:
            self.set_state('shield')
            return True
        if self.consume('special'):
            self.start_special(w)
            return True
        if self.consume('smash'):
            self.start_smash(w)
            return True
        if self.consume('attack'):
            self.start_ground_attack(w)
            return True
        return False

    def start_smash(self, w):
        i = self.inp
        if i.y < -0.5:
            self.start_move(w, 'usmash')
        elif i.y > 0.5:
            self.start_move(w, 'dsmash')
        else:
            if abs(i.x) > 0.3:
                self.face = sign(i.x)
            self.start_move(w, 'fsmash')

    def start_ground_attack(self, w):
        i = self.inp
        smash_x = abs(i.x) > 0.7 and self.tapx <= C.SMASH_TAP
        smash_y = abs(i.y) > 0.7 and self.tapy <= C.SMASH_TAP
        running = abs(self.vx) > self.st['walk'] + 0.5
        if i.y < -0.5:
            self.start_move(w, 'usmash' if smash_y else 'utilt')
        elif i.y > 0.5:
            self.start_move(w, 'dsmash' if smash_y else 'dtilt')
        elif abs(i.x) > 0.3:
            self.face = sign(i.x)
            if smash_x:
                self.start_move(w, 'fsmash')
            elif running:
                self.start_move(w, 'dash')
            else:
                self.start_move(w, 'ftilt')
        else:
            self.start_move(w, 'jab')

    def start_special(self, w):
        i = self.inp
        if i.y < -0.5:
            key = 'uspecial'
            if self.used_up:
                return
        elif abs(i.x) > 0.5 and abs(i.x) >= abs(i.y):
            key = 'sspecial'
            if self.used_side:
                return
            self.face = sign(i.x)
        elif i.y > 0.5:
            key = 'dspecial'
        else:
            key = 'nspecial'
        if not self.ground and key + '_air' in self.moves:
            key = key + '_air'
        self.start_move(w, key)

    def st_stand(self, w):
        if self.ground_actions(w):
            return
        i, s = self.inp, self.st
        if i.y > 0.5 and abs(i.x) < 0.5:
            self.crouch = True
            self.vx = approach(self.vx, 0, s['friction'] * 2)
            if self.ground is not w.stage.main and self.tapy <= 3:
                self.drop_t = 14
                self.ground = None
                self.y += 2
                self.set_state('air')
                return
        elif abs(i.x) > 0.2:
            self.face = sign(i.x)
            target = (s['run'] if abs(i.x) > 0.75 else s['walk']) * sign(i.x)
            self.vx = approach(self.vx, target, 1.3)
        else:
            self.vx = approach(self.vx, 0, s['friction'])

    def st_jumpsquat(self, w):
        self.vx *= 0.9
        self.timer -= 1
        if self.timer <= 0:
            full = self.inp.jump or self.inp.y < -0.7
            self.vy = -(self.st['jump'] if full else self.st['short'])
            self.vx += self.inp.x * 1.2
            self.ground = None
            self.set_state('air')
            w.event('jump', self.x, self.y, who=self)

    def st_lag(self, w):
        self.vx = approach(self.vx, 0, self.st['friction'])
        self.timer -= 1
        if self.timer <= 0:
            self.to_neutral()

    def st_knockdown(self, w):
        self.vx = approach(self.vx, 0, 0.8)
        self.timer += 1
        if not self.ground:
            self.set_state('air')
            return
        acted = self.timer > 12 and (self.pressed('attack') or self.pressed('jump') or abs(self.inp.x) > 0.6
                                     or self.inp.y < -0.6)
        if acted and self.consume('attack'):
            self.start_move(w, 'getupatk')
            return
        if acted or self.timer > 60:
            if abs(self.inp.x) > 0.6:
                self.set_state('dodge')
                self.dodge = dict(kind='roll', total=30, inv=(1, 20), dir=sign(self.inp.x))
                return
            self.inv = 18
            self.set_state('lag', 18)

    def st_dizzy(self, w):
        self.timer -= 1
        self.vx = approach(self.vx, 0, 0.5)
        if self.timer <= 0:
            self.to_neutral()

    # ------------------------------------------------------------ ガード・回避
    def st_shield(self, w):
        i = self.inp
        self.vx = approach(self.vx, 0, self.st['friction'])
        if not self.ground:
            self.set_state('air')
            return
        if self.shieldstun > 0:
            self.shieldstun -= 1
            return
        self.shield_hp -= C.SHIELD_DRAIN
        if self.shield_hp <= 0:
            w.shield_break(self)
            return
        if self.consume('jump'):
            self.set_state('jumpsquat', 3)
            return
        if self.consume('attack') or self.consume('grab'):
            self.start_move(w, 'grab')
            return
        if abs(i.x) > 0.7 and self.tapx <= 3:
            self.start_dodge(w, 'roll', sign(i.x))
            return
        if i.y > 0.7 and self.tapy <= 3:
            self.start_dodge(w, 'spot', 0)
            return
        if not i.shield:
            self.set_state('lag', 6)

    def start_dodge(self, w, kind, d, dy=0.0):
        if kind == 'roll':
            self.dodge = dict(kind=kind, total=30, inv=(4, 18), dir=d)
        elif kind == 'spot':
            self.dodge = dict(kind=kind, total=24, inv=(3, 17), dir=0)
        else:
            self.dodge = dict(kind=kind, total=40, inv=(3, 22), dir=d, dy=dy)
            self.used_dodge = True
            if d or dy:
                self.vx, self.vy = d * 11, dy * 11
            else:
                self.vx *= 0.5
                self.vy = min(self.vy, 2)
        self.set_state('dodge')
        self.timer = 0
        w.event('dodge', self.x, self.y - 40)

    def st_dodge(self, w):
        self.timer += 1
        d = self.dodge
        if d['kind'] == 'roll':
            self.vx = d['dir'] * 7.2 if 3 <= self.timer <= 22 else approach(self.vx, 0, 1.5)
            if self.timer >= d['total']:
                self.face = -d['dir']
        elif d['kind'] in ('spot', 'tech'):
            self.vx = approach(self.vx, 0, 1.5)
        else:
            if self.timer <= 16 and (d['dir'] or d['dy']):
                self.vx *= 0.88
                self.vy *= 0.88
        if self.timer >= d['total']:
            self.dodge = None
            self.to_neutral()

    # ------------------------------------------------------------ 受け身
    TECH_WINDOW = 11   # 床・壁・天井に当たる何フレーム前までのガード入力を受け身にするか
    TECH_LOCK = 40     # 一度押したら次に受け付けるまでのフレーム（連打では取れない）

    def update_tech_input(self):
        if self.tech_t > 0:
            self.tech_t -= 1
        if self.tech_lock > 0:
            self.tech_lock -= 1
        if self.inp.shield and not self.prev.shield and self.tech_lock == 0:
            self.tech_t = self.TECH_WINDOW
            self.tech_lock = self.TECH_LOCK

    def can_tech(self):
        return self.state == 'hitstun' and self.tech_t > 0

    def tech_ground(self, w):
        """床受け身: その場 or 左右に転がる。"""
        self.tech_t = 0
        self.tech_lock = 0
        self.kx = self.ky = self.vx = self.vy = 0
        self.hitstun = 0
        self.tumble = False
        d = sign(self.inp.x) if abs(self.inp.x) > 0.5 else 0
        if d:
            self.dodge = dict(kind='roll', total=38, inv=(0, 20), dir=d)
        else:
            self.dodge = dict(kind='tech', total=26, inv=(0, 20), dir=0)
        self.set_state('dodge')
        self.timer = 0
        w.event('tech', self.x, self.y - self.h * 0.3, who=self, color=self.color)

    def tech_wall(self, w, side, ceiling=False):
        """壁・天井受け身: 一瞬はりついて無敵。壁ならジャンプ入力で壁ジャンプ。"""
        self.tech_t = 0
        self.tech_lock = 0
        self.kx = self.ky = self.vx = self.vy = 0
        self.hitstun = 0
        self.tumble = False
        self.inv = max(self.inv, 20)
        self.set_state('walltech', 0)
        self.wall_side = 0 if ceiling else side
        w.event('tech', self.x + side * self.hw, self.y - self.h * 0.5, who=self, color=self.color)

    def st_walltech(self, w):
        self.timer += 1
        self.vx = self.vy = 0
        if self.wall_side and self.timer >= 4 and self.consume('jump'):
            self.vy = -self.st['djump'] * 0.95
            self.vx = -self.wall_side * self.st['air']
            self.face = -self.wall_side
            self.set_state('air')
            w.event('djump', self.x, self.y, who=self)
            return
        if self.timer >= 12:
            self.set_state('air')

    # ------------------------------------------------------------ 空中
    def air_drift(self, mul=1.0):
        s, i = self.st, self.inp
        if abs(i.x) > 0.15:
            self.vx = approach(self.vx, i.x * s['air'] * mul, s['airacc'] * mul)
        else:
            self.vx = approach(self.vx, 0, 0.06)

    def st_air(self, w):
        i = self.inp
        self.air_drift()
        if self.vy > 0 and i.y > 0.7 and self.tapy <= 4:
            self.fastfall = True
        if self.can_awaken() and (self.consume('awaken') or (self.pressed('attack') and self.pressed('special'))):
            self.buf['attack'] = self.buf['special'] = 0
            w.start_awaken(self)
            return
        if self.consume('jump') and self.jumps > 0:
            self.jumps -= 1
            self.vy = -self.st['djump']
            self.vx = i.x * self.st['air']
            self.fastfall = False
            w.event('djump', self.x, self.y, who=self)
            return
        if self.consume('shield') and not self.used_dodge:
            n = math.hypot(i.x, i.y)
            if n > 0.4:
                self.start_dodge(w, 'air', i.x / n, i.y / n)
            else:
                self.start_dodge(w, 'air', 0, 0)
            return
        if self.consume('special'):
            self.start_special(w)
            return
        if self.consume('attack') or self.consume('smash') or self.consume('grab'):
            self.start_aerial(w)

    def start_aerial(self, w):
        i = self.inp
        if i.y < -0.5 and abs(i.y) >= abs(i.x):
            self.start_move(w, 'uair')
        elif i.y > 0.5 and abs(i.y) >= abs(i.x):
            self.start_move(w, 'dair')
        elif i.x * self.face > 0.3:
            self.start_move(w, 'fair')
        elif i.x * self.face < -0.3:
            self.start_move(w, 'bair')
        else:
            self.start_move(w, 'nair')

    def st_helpless(self, w):
        self.air_drift(0.6)

    def st_hitstun(self, w):
        self.hitstun -= 1
        if self.ground:
            self.vx = approach(self.vx, 0, 0.5)
        if self.hitstun <= 0:
            self.to_neutral()

    # ------------------------------------------------------------ ワザ
    def st_move(self, w):
        m = self.move
        d = m.d
        if d.charge_at is not None and m.f == d.charge_at and m.charge < d.charge_max:
            held = self.inp.special if d.charge_btn == 'special' else (self.inp.attack or self.inp.smash)
            if held:
                m.charge += 1
                if self.ground:
                    self.vx = approach(self.vx, 0, self.st['friction'])
                return
        m.f += 1
        if d.chain and m.f >= d.chain[0] and self.consume('attack'):
            self.start_move(w, d.chain[1])
            return
        if d.key in THROWS:
            at, params = THROWS[d.key]
            if m.f == at:
                w.throw_release(self, params, dirsign=self.face)
        if d.on_frame:
            d.on_frame(w, self, m)
        if self.state != 'move' or self.move is not m:
            return
        if self.ground:
            if not d.keep_vx:
                self.vx = approach(self.vx, 0, self.st['friction'])
        elif not d.no_drift and not d.keep_vx:
            self.air_drift(0.8)
        if m.f >= d.total:
            self.end_move(w)

    # ------------------------------------------------------------ つかみ・投げ
    def hold_position(self):
        t = self.grab_target
        if t is None or t.grabbed_by is not self:
            self.grab_target = None
            return
        if self.state == 'move' and self.move.d.key == 's_throw':
            return
        side = self.face
        if self.state == 'move' and self.move.d.key == 'bthrow' and self.move.f >= 6:
            side = -self.face
        t.x = self.x + side * (self.hw + t.hw - 6)
        t.y = self.y
        t.face = -side

    def st_hold(self, w):
        t = self.grab_target
        self.vx = approach(self.vx, 0, 1)
        if t is None or t.grabbed_by is not self:
            self.grab_target = None
            self.to_neutral()
            return
        self.timer += 1
        self.grab_timer -= 1
        i = self.inp
        if self.timer >= 8:
            if (self.pressed('attack') and abs(i.x) < 0.5 and abs(i.y) < 0.5) and self.pummel_cd <= 0:
                self.consume('attack')
                self.pummel_cd = 16
                w.pummel(self, t)
                return
            key = None
            if i.x * self.face > 0.6:
                key = 'fthrow'
            elif i.x * self.face < -0.6:
                key = 'bthrow'
            elif i.y < -0.6:
                key = 'uthrow'
            elif i.y > 0.6:
                key = 'dthrow'
            if key:
                self.start_move(w, key)
                return
        if self.grab_timer <= 0:
            w.grab_release(self)

    def st_grabbed(self, w):
        h = self.grabbed_by
        if h is None or h.grab_target is not self:
            self.grabbed_by = None
            self.to_neutral()
            return
        mashed = any(self.buf[b] == C.BUFFER for b in BUTTONS) or self.tapx == 0 or self.tapy == 0
        if mashed:
            h.grab_timer -= 4

    # ------------------------------------------------------------ 崖
    def st_ledge(self, w):
        L = self.ledge
        self.x = L.x + L.dir * (self.hw + 2)
        self.y = L.y + self.h * 0.72
        self.vx = self.vy = 0
        self.timer += 1
        i = self.inp
        toward = -L.dir
        if self.timer < 8:
            return
        if self.consume('jump') or i.y < -0.7:
            self.leave_ledge(w)
            self.y = L.y + 10
            self.vy = -15.5
            self.vx = toward * 2.6
            self.set_state('air')
            w.event('jump', self.x, self.y, who=self)
        elif self.consume('attack') or self.consume('smash'):
            self.leave_ledge(w)
            self.place_on_ledge_top(L)
            self.start_move(w, 'ledgeatk')
        elif self.consume('shield'):
            self.leave_ledge(w)
            self.place_on_ledge_top(L)
            self.start_dodge(w, 'roll', toward)
            self.dodge['inv'] = (1, 20)
        elif i.x * toward > 0.5:
            self.leave_ledge(w)
            self.set_state('climb', 0)
        elif i.x * L.dir > 0.5 or i.y > 0.7 or self.timer > 300:
            self.leave_ledge(w)
            self.ledge_cd = 30
            self.set_state('air')

    def place_on_ledge_top(self, L):
        self.x = L.x - L.dir * (self.hw + 4)
        self.y = L.y
        self.ground = None
        self.vy = 0

    def leave_ledge(self, w):
        if self.ledge:
            self.ledge.holder = None
        self.ledge_saved = self.ledge
        self.ledge = None

    def st_climb(self, w):
        L = self.ledge_saved
        self.timer += 1
        if self.timer >= 22:
            self.place_on_ledge_top(L)
            self.vx = 0
            self.ground = w.stage.main
            self.set_state('stand')

    def try_ledge(self, w):
        if self.ledge_cd > 0 or self.ground:
            return False
        ok = self.state in ('air', 'helpless') and (self.vy >= 0 or self.state == 'helpless')
        if self.state == 'move' and self.move.d.ledge_ok and self.move.f > 6:
            ok = True
        if not ok or self.inp.y > 0.7:
            return False
        hand_y = self.y - self.h * 0.85
        for L in w.stage.ledges:
            dx = (self.x - L.x) * L.dir
            if -12 <= dx <= self.hw + 36 and L.y - 30 <= hand_y <= L.y + 40:
                if L.holder is not None and L.holder is not self:
                    other = L.holder  # 崖奪い
                    other.leave_ledge(w)
                    other.ledge_cd = 40
                    other.set_state('air')
                    other.vx = L.dir * 4
                L.holder = self
                self.ledge = L
                self.face = -L.dir
                self.vx = self.vy = self.kx = self.ky = 0
                self.jumps = self.st['jumps']
                self.used_up = self.used_side = self.used_dodge = False
                self.fastfall = False
                if not self.ledge_inv_used:
                    self.inv = max(self.inv, C.LEDGE_INV)
                    self.ledge_inv_used = True
                self.set_state('ledge', 0)
                w.event('ledge', L.x, L.y)
                return True
        return False

    # ------------------------------------------------------------ 覚醒・復活
    def st_awaken(self, w):
        self.timer += 1
        if self.timer == 52:
            w.awaken_blast(self)
        if self.timer >= 70:
            self.to_neutral()

    def st_respawn(self, w):
        self.timer += 1
        self.vx = self.vy = 0
        i = self.inp
        moved = abs(i.x) > 0.5 or i.y > 0.5 or any(self.buf[b] for b in BUTTONS)
        if (moved and self.timer > 30) or self.timer > 240:
            self.set_state('air')
            self.inv = C.RESPAWN_INV

    def st_dead(self, w):
        pass

    # ------------------------------------------------------------ 物理
    def physics(self, w):
        s = self.st
        d = self.move.d if self.state == 'move' else None
        nograv = d is not None and d.in_window('nograv', self.move.f)
        if self.state == 'dodge' and self.dodge['kind'] == 'air' and self.timer <= 16 and (self.dodge['dir'] or self.dodge['dy']):
            nograv = True
        if self.state in ('awaken', 'walltech'):
            nograv = True
        if not self.ground and not nograv:
            maxf = s['ffall'] if self.fastfall else s['fall']
            if self.fastfall:
                self.vy = max(self.vy, maxf)
            elif self.vy < maxf:
                self.vy = min(self.vy + s['grav'], maxf)
        if self.kx or self.ky:
            mag = math.hypot(self.kx, self.ky)
            if mag <= C.LAUNCH_DECAY:
                self.kx = self.ky = 0.0
            else:
                k = (mag - C.LAUNCH_DECAY) / mag
                self.kx *= k
                self.ky *= k
            if self.ground:
                self.kx *= 0.9
        ox, oy = self.x, self.y
        self.x += self.vx + self.kx
        self.y += self.vy + self.ky
        w.collide(self, ox, oy)
        if not self.ground:
            self.try_ledge(w)

    def on_land(self, w):
        self.jumps = self.st['jumps']
        self.fastfall = False
        self.used_up = self.used_side = self.used_dodge = self.ledge_inv_used = False
        st = self.state
        if st == 'hitstun':
            if self.can_tech():
                self.tech_ground(w)
                return
            if self.ky > 7 or (self.tumble and self.vy + self.ky > 9):
                # 叩きつけバウンド
                self.ky = -abs(self.ky) * 0.6 - 2
                self.vy = 0
                self.ground = None
                w.event('bounce', self.x, self.y)
                return
            if self.tumble:
                self.kx *= 0.5
                self.ky = 0
                self.set_state('knockdown', 0)
                w.event('land', self.x, self.y, heavy=True)
            return
        if st == 'move':
            d = self.move.d
            if d.on_land and d.on_land(w, self, self.move):
                return
            if d.air:
                self.set_state('lag', d.landlag)
            elif d.helpless:
                self.set_state('lag', 14)
            w.event('land', self.x, self.y)
            return
        if st == 'helpless':
            self.set_state('lag', 14)
        elif st == 'dodge' and self.dodge and self.dodge['kind'] == 'air':
            self.dodge = None
            self.set_state('lag', 10)
        elif st == 'air':
            self.set_state('lag', 3)
        elif st == 'dizzy':
            pass
        w.event('land', self.x, self.y)
