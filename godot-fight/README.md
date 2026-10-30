# Cross Fight 3D（試作）

`smash-game/`（2D・pygame版）のルールを Godot 4 に移植した、スマブラ風 2.5D 対戦アクションの試作です。
3D のキャラを横から映して、2D のステージで戦います（スマブラSPと同じ方式）。

## 起動
1. Godot 4.3 以降（標準版。.NET 版でなくてよい）を https://godotengine.org/download からダウンロード
2. Godot を起動 →「インポート」→ このフォルダの `project.godot` を選ぶ
3. F5 で実行

## 操作
| 操作 | 1P キーボード | 2P キーボード（F3で切替） | ゲームパッド |
|---|---|---|---|
| 移動 | W A S D | ← ↑ → ↓ | 左スティック / 十字 |
| ジャンプ | Space / I | テンキー0 / Shift | X / Y |
| 攻撃 | J | テンキー1 / , | A |
| 必殺ワザ | K | テンキー2 / . | B |
| ガード（受け身・回避） | L | テンキー3 / / | RB / RT |
| つかみ | U | テンキー4 / ; | LB / LT |
| スマッシュ | O | テンキー6 / ' | 右スティック |
| 覚醒 | P | テンキー7 / ] | BACK |

Esc: ポーズ / Enter: やり直し / Tab: ステージ切替（戦場・終点）/ F2: CPUレベル / F3: 2P を人間にする / F11: 全画面

## 入っているもの（2D版と同じルール）
%とふっとばし、ストック、弱・強・スマッシュ（ため）・空中攻撃・メテオ、必殺ワザ、ガード（削れ・ブレイク）、
回避（転がり・その場・方向つき空中回避）、つかみ・4方向投げ、崖つかまり（無敵・崖奪い・5種類の上がり方）、
受け身（床・壁・天井・壁ジャンプ）、覚醒（切りふだ）、CPU（Lv0〜9）。

## 構成
- `scripts/sim/` … ゲームの中身（描画なし。ヘッドレスで動く）
  - `world.gd` 当たり判定・ふっとばし・撃墜 / `fighter.gd` 状態遷移と物理 / `moves.gd` ワザ / `cpu.gd` CPU / `stage.gd` ステージ
- `scripts/view/puppet.gd` … 仮の3D人形（VRoid モデルが無いキャラ用）
- `scripts/main.gd` … ステージ・カメラ・エフェクト・HUD
- `tests/test_sim.gd` … CPU同士を戦わせる自動テスト
  `godot --headless --path godot-fight --script res://tests/test_sim.gd`

## VRoid / Mixamo モデルについて
今は全キャラ仮の人形です。モデルの入れ方は `characters/README.md` を参照してください。
