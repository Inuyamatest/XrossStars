# キャラクターモデル（VRoid + Mixamo）

ここに `characters/<キャラID>/` のフォルダを作ってモデルとモーションを置きます（gitには入りません）。

## 用意するもの
1. **モデル**: VRoid Studio でキャラを作り「VRMエクスポート」→ `model.vrm`
2. **モーション**: Mixamo（https://www.mixamo.com）で、次のような動きを「FBX Binary / Without Skin」でダウンロード
   - 待機（Idle）、歩き（Walking）、走り（Running）、ジャンプ（Jump）、落下（Falling Idle）
   - パンチ・キック各種、アッパー、回し蹴り、投げ（Throw）、ガード（Block）、回避（Dodge / Roll）
   - やられ（Hit Reaction）、ふっとび（Falling / Knocked Down）、起き上がり（Getting Up）、崖つかまり（Hanging Idle / Climbing）
   - 勝利ポーズ（Victory）

## 次の作業
モデルと上のモーションのファイルがそろったら、ゲームの状態（待機・攻撃・やられ…）ごとに
どのモーションを流すかの割り当てと、Mixamo の骨から VRoid の骨へのつけ替え（リターゲット）を組み込みます。

## モーションの置き場所（組み込み済み）
Mixamo などのモーション（.fbx / .glb）は `characters/_motions/` に置きます。すべてのモデルで共通に使われます。
ファイル名から使い道を判断します（`idle.fbx` のように使い道の名前にするのが確実。`Fighting Idle.fbx` のような Mixamo の名前のままでも、
idle / walk / run / jump / fall / landing / jab / punch / kick / hook / uppercut / sweep / flying kick / flip / block / hit / knock / getting up /
hang / climb / roll / throw / magic / victory などの単語が入っていれば自動で割り当てます）。
モーションが無い動きは、これまでどおり手続きアニメで動きます。
