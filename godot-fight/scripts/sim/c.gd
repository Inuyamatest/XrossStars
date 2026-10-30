## 全体の定数。単位はピクセル相当・フレーム（60fps）。y は下向きが正（2D版と同じ）。
class_name C

const FPS := 60
const LAUNCH_SCALE := 0.17   # ふっとばし: 速度 = kb * LAUNCH_SCALE
const LAUNCH_DECAY := 0.306  # 毎フレームこれだけ減速
const HITSTUN_MUL := 0.4
const SHIELD_MAX := 50.0
const SHIELD_DRAIN := 0.12
const SHIELD_REGEN := 0.07
const BUFFER := 6            # 先行入力の受付フレーム
const SMASH_TAP := 4         # はじき入力とみなすフレーム数
const RESPAWN_WAIT := 70
const RESPAWN_INV := 120
const LEDGE_INV := 40
const TECH_WINDOW := 11      # 受け身の受付
const TECH_LOCK := 40        # 受け身の再入力禁止

const PLAYER_COLORS := [Color(0.92, 0.25, 0.25), Color(0.25, 0.52, 0.96), Color(0.96, 0.78, 0.16), Color(0.24, 0.78, 0.39)]
const PLAYER_TAGS := ["1P", "2P", "3P", "4P"]
