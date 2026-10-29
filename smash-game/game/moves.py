"""ワザのデータ。

ヒットボックス座標はキャラの足元基準（x は向いている方向が正、y は上がマイナス）。
ang は向き基準の角度（0=前、90=真上、140=後ろ上、270=真下メテオ）。
"""


def H(f0, f1, x, y, r, dmg, ang, bkb, kbg, **kw):
    h = dict(f=(f0, f1), x=x, y=y, r=r, dmg=dmg, ang=ang, bkb=bkb, kbg=kbg,
             both=False, grab=False, group=0, rehit=0, radial=False, shieldmul=1.0,
             fx='slash', limb=None)
    h.update(kw)
    return h


class Move:
    def __init__(self, key, total, hits=(), **kw):
        self.key = key
        self.total = total
        self.hits = list(hits)
        self.air = kw.get('air', False)            # 空中攻撃（着地で着地スキ）
        self.landlag = kw.get('landlag', 8)
        self.helpless = kw.get('helpless', False)  # 終了後しりもち落下
        self.on_frame = kw.get('on_frame')
        self.on_land = kw.get('on_land')
        self.on_hit = kw.get('on_hit')
        self.armor = kw.get('armor')               # (開始, 終了) スーパーアーマー
        self.inv = kw.get('inv')                   # 無敵
        self.counter = kw.get('counter')           # カウンター受付
        self.reflect = kw.get('reflect', False)
        self.charge_at = kw.get('charge_at')       # ためるフレーム
        self.charge_btn = kw.get('charge_btn', 'attack')
        self.charge_max = kw.get('charge_max', 60)
        self.chain = kw.get('chain')               # (受付開始, 次のワザ)
        self.keep_vx = kw.get('keep_vx', False)
        self.nograv = kw.get('nograv')
        self.no_drift = kw.get('no_drift', False)
        self.ledge_ok = kw.get('ledge_ok', False)
        self.once = kw.get('once')                 # 'up' / 'side'（空中で1回まで）
        self.pose = kw.get('pose', 'strike')
        self.name = kw.get('name', key)
        self.color = kw.get('color')

    def active(self, f):
        return [h for h in self.hits if h['f'][0] <= f <= h['f'][1]]

    def in_window(self, attr, f):
        w = getattr(self, attr)
        return w is not None and w[0] <= f <= w[1]


# ---------------------------------------------------------------- 共通ワザ

def _dash_push(speed, f0, f1):
    def fn(w, f, m):
        if f0 <= m.f <= f1:
            f.vx = f.face * speed
    return fn


def common_moves(power=1.0):
    p = power
    mv = {}
    mv['jab'] = Move('jab', 18, [H(3, 5, 34, -50, 22, 3 * p, 70, 15, 25, limb='hand')],
                     chain=(7, 'jab2'), name='弱1', pose='punch')
    mv['jab2'] = Move('jab2', 18, [H(3, 5, 38, -48, 22, 3 * p, 70, 15, 25, limb='hand')],
                      chain=(7, 'jab3'), name='弱2', pose='punch2')
    mv['jab3'] = Move('jab3', 30, [H(5, 8, 44, -44, 28, 5 * p, 40, 40, 80, limb='foot')],
                      name='弱3', pose='kick')
    mv['ftilt'] = Move('ftilt', 28, [H(6, 9, 52, -40, 27, 9 * p, 30, 30, 95, limb='foot')],
                       name='横強', pose='kick')
    mv['utilt'] = Move('utilt', 26, [H(5, 7, 30, -80, 28, 7 * p, 92, 40, 110, limb='hand'),
                                     H(8, 10, -10, -100, 28, 7 * p, 92, 40, 110, limb='hand')],
                       name='上強', pose='upswing')
    mv['dtilt'] = Move('dtilt', 22, [H(5, 7, 50, -10, 24, 6 * p, 75, 45, 55, limb='foot')],
                       name='下強', pose='lowkick')
    mv['dash'] = Move('dash', 34, [H(6, 12, 36, -40, 30, 10 * p, 55, 55, 70, limb='foot'),
                                   H(13, 20, 30, -40, 24, 6 * p, 55, 40, 60, limb='foot')],
                      keep_vx=True, name='ダッシュ攻撃', pose='dashkick',
                      on_frame=lambda w, f, m: setattr(f, 'vx', f.vx * 0.94))
    mv['fsmash'] = Move('fsmash', 48, [H(14, 17, 60, -44, 33, 16 * p, 40, 35, 100, limb='hand', fx='big')],
                        charge_at=9, name='横スマッシュ', pose='bigpunch')
    mv['usmash'] = Move('usmash', 46, [H(11, 15, 6, -104, 36, 15 * p, 88, 35, 98, limb='hand', fx='big')],
                        charge_at=7, name='上スマッシュ', pose='upswing')
    mv['dsmash'] = Move('dsmash', 46, [H(10, 12, 48, -12, 28, 13 * p, 30, 30, 95, both=True, limb='foot', fx='big')],
                        charge_at=5, name='下スマッシュ', pose='split')
    mv['nair'] = Move('nair', 36, [H(5, 10, 0, -42, 44, 9 * p, 45, 25, 85, fx='ring', group=0),
                                   H(11, 22, 0, -42, 40, 5 * p, 45, 20, 70, fx='ring', group=0)],
                      air=True, landlag=7, name='空N', pose='spin')
    mv['fair'] = Move('fair', 40, [H(12, 15, 46, -46, 32, 13 * p, 45, 30, 95, limb='hand', fx='big')],
                      air=True, landlag=14, name='空前', pose='bigpunch')
    mv['bair'] = Move('bair', 34, [H(7, 10, -48, -42, 29, 12 * p, 140, 30, 100, limb='foot')],
                      air=True, landlag=9, name='空後', pose='backkick')
    mv['uair'] = Move('uair', 30, [H(5, 9, 6, -106, 32, 9 * p, 85, 30, 105, limb='foot')],
                      air=True, landlag=7, name='空上', pose='flipkick')
    mv['dair'] = Move('dair', 44, [H(14, 17, 4, 2, 30, 13 * p, 270, 25, 85, limb='foot', fx='big')],
                      air=True, landlag=16, name='空下', pose='stomp')
    mv['grab'] = Move('grab', 32, [H(6, 8, 40, -46, 26, 0, 0, 0, 0, grab=True, limb='hand')],
                      name='つかみ', pose='grab')
    mv['dashgrab'] = Move('dashgrab', 38, [H(8, 10, 52, -46, 28, 0, 0, 0, 0, grab=True, limb='hand')],
                          keep_vx=True, name='ダッシュつかみ', pose='grab',
                          on_frame=lambda w, f, m: setattr(f, 'vx', f.vx * 0.85))
    mv['ledgeatk'] = Move('ledgeatk', 32, [H(10, 14, 44, -30, 32, 8, 35, 60, 30, limb='foot')],
                          inv=(1, 10), name='崖上がり攻撃', pose='kick')
    mv['getupatk'] = Move('getupatk', 32, [H(9, 13, 46, -16, 30, 7, 30, 60, 30, both=True, limb='foot')],
                          inv=(1, 12), name='起き上がり攻撃', pose='split')
    # 投げ（つかんだ相手に直接当てる）
    mv['fthrow'] = Move('fthrow', 28, [], name='前投げ', pose='throwf')
    mv['bthrow'] = Move('bthrow', 32, [], name='後投げ', pose='throwb')
    mv['uthrow'] = Move('uthrow', 30, [], name='上投げ', pose='throwu')
    mv['dthrow'] = Move('dthrow', 30, [], name='下投げ', pose='throwd')
    return mv


THROWS = {
    'fthrow': (10, dict(dmg=8, ang=45, bkb=60, kbg=62)),
    'bthrow': (14, dict(dmg=10, ang=135, bkb=60, kbg=72)),
    'uthrow': (12, dict(dmg=7, ang=90, bkb=70, kbg=64)),
    'dthrow': (12, dict(dmg=6, ang=78, bkb=50, kbg=42)),
}
