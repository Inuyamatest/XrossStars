# 素材

| フォルダ | 内容 | 作者 | ライセンス |
|---|---|---|---|
| `platformer/` | Free Platformer Pack（ブロック・足場・木・雲・小物） | Quaternius（https://quaternius.com） | CC0 1.0（`platformer/License.txt`） |
| `animations/` | Universal Animation Library 1・2（モーション86本。Unreal マネキン式の骨） | Quaternius | CC0 1.0（`animations/License.txt`） |

CC0 なのでクレジット表記は不要ですが、作者への感謝として記載しています。
ステージでは材質をゲーム側のアニメ調シェーダーに差し替えて使っています（`scripts/main.gd` の `_prop`）。

モーションはどのモデル（MMD など）にも付け替えて使います（`scripts/view/motion_lib.gd`）。
どのワザ・状態にどのモーションを使うかは `scripts/view/model_view.gd` の `MOVE_SLOTS` / `STATE_SLOTS` と、
`motion_lib.gd` の `SLOT_CLIPS` で決めています。キック・アッパー・宙返り・崖つかまりは同梱に無いので手続きアニメです
（`characters/_motions/` に Mixamo のモーションを置けばそちらが優先されます）。
