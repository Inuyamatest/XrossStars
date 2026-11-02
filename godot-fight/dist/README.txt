Cross Fight 3D（試作）

■ 起動
  CrossFight3D.exe をダブルクリック。
  （起動しない・真っ黒のときは、グラフィックドライバを更新してください。Vulkan 対応の GPU が必要です）

■ キャラクターモデルの置き方
  モデルは利用規約の都合で同梱していません。手元のモデルを次のように置いてください。

  CrossFight3D.exe
  characters\
    roster.json          … キャラの名前・タイプ・武器の設定（同梱。編集して使う）
    muzan\               … フォルダ名は roster.json に合わせる
      鬼舞辻無惨.pmx
      tex\ ...
    fubuki\  iroha\  yukari\  astolfo\ ...
    _motions\            … Mixamo のモーション（.fbx）を置く（任意）
      Fighting Idle.fbx
      Hurricane Kick.fbx ...

  ・MMD の .pmx はテクスチャごとフォルダで置けば読み込まれます
  ・characters フォルダが無くても、仮の人形キャラ（ブレイズ）で遊べます

■ 操作（キーボード）
  1P: WASD 移動 / Space ジャンプ / J 攻撃 / K 必殺 / L ガード / U つかみ / O スマッシュ / P 覚醒
  Esc ポーズ / Enter やり直し / Tab ステージ切替 / F2 CPUの強さ / F3 2Pを人間に / F4・F5 キャラ切替 / F6 画質 / F11 全画面
  ゲームパッドにも対応（A 攻撃 / B 必殺 / X・Y ジャンプ / RB ガード / LB つかみ / 右スティック スマッシュ）
