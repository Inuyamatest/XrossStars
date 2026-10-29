"""全体の定数。単位はピクセル・フレーム（60fps）。"""
W, H = 1280, 720
FPS = 60

# ふっとばし: 速度 = kb * LAUNCH_SCALE、毎フレーム LAUNCH_DECAY ずつ減速
LAUNCH_SCALE = 0.17
LAUNCH_DECAY = 0.306
HITSTUN_MUL = 0.4

SHIELD_MAX = 50.0
SHIELD_DRAIN = 0.12
SHIELD_REGEN = 0.07

BUFFER = 6          # 先行入力の受付フレーム
SMASH_TAP = 4       # はじき入力とみなすフレーム数
RESPAWN_WAIT = 70
RESPAWN_INV = 120
LEDGE_INV = 40

PLAYER_COLORS = [(235, 64, 64), (64, 132, 245), (245, 200, 40), (60, 200, 100)]
PLAYER_TAGS = ['1P', '2P', '3P', '4P']
