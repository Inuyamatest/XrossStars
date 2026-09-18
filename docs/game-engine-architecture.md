# Xross Stars ゲームエンジン設計書

**このドキュメントはアーキテクチャ設計のみです。コード実装は含みません。**

唯一のルール根拠は `docs/xross-stars-game-spec.md` です。本書はその仕様を「どういうデータ構造・処理フローで再現するか」を定義するものであり、ルールそのものを新たに定義・変更するものではありません。仕様書で✅（公式確認済み）の項目はそのまま設計に反映し、⚠️（要確認）の項目は**コードにハードコードせず、後述のRule Configuration Layerに分離**します。

対象外（今回やらないこと。ユーザー指示どおり）：オンライン対戦の実通信（WebSocket/Firebase/Supabase/P2P）、対戦UI、全カード効果の実装、デッキビルダー・カードJSONの変更。

---

## 0. レイヤー構成（最重要）

```
┌─────────────────────────────────────┐
│ Game Rules（docs/xross-stars-game-spec.md）│  ← ルールの一次情報。コードではなくドキュメント
└─────────────────────────────────────┘
                 ↓ 実装
┌─────────────────────────────────────┐
│ Rule Configuration Layer               │  ← ⚠️未確定ルールの切り出し先（本書9章）
├─────────────────────────────────────┤
│ Game Engine（本書のGameState/PhaseFSM/  │  ← ターン進行・PP・デッキ・ダウン等、
│ ResolutionStack/Event）                │    公式確認済みの一般ルールを処理する
├─────────────────────────────────────┤
│ Card Effect Engine（Trigger/Condition/  │  ← 個別カードの効果を解決する。
│ Target/Action等。本書10章）            │    「カードテキストがルールに優先する」
│                                         │    （FAQ Q10）をここで表現する
├─────────────────────────────────────┤
│ Card Data（data/cards.json 他）        │  ← 今回は変更しない。参照のみ
└─────────────────────────────────────┘
```

- **Game Engine** は「公式ルールとして確認済みの一般手続き」（ターン進行、PP、ダウン、デッキ切れ処理等）を実装する。個別カードのことは知らない
- **Card Effect Engine** は個別カードの効果（`data/cards.json` に後から手動追加する `effects: CardEffect[]`）を解決する。ここが「カードテキストが一般ルールを上書きできる」仕組み（Replacement、本書10章）を持つ
- カードJSONにゲームルールの手続き（ターン進行やPP計算など）を埋め込まない。カードJSONが持つのは「このカードが何をするか」という効果定義だけ
- Rule Configuration Layerは、Game EngineがGame Rulesを参照する際に「⚠️未確定な部分」だけを差し替え可能にする薄い層（本書9章）

---

## 1. GameState

```text
GameState
├─ match: MatchState
├─ turn: TurnState
├─ players: { playerA: PlayerState, playerB: PlayerState }
├─ resolutionStack: ResolutionStack        // 本書5章
├─ actionLog: GameEvent[]                  // 本書6章
└─ ruleConfig: RuleConfig                  // 本書9章（⚠️未確定ルールの現在値）
```

```text
MatchState
├─ matchId: string
├─ mode: "STANDARD" | "QUICK"              // 🧩 内部コード名。ユーザー向け表示名は未確定（"フルマッチ"呼称は仕様書⚠️参照）
├─ roundNumber: 1 | 2 | 3                  // クイックマッチは常に1
├─ roundWins: { playerA: number, playerB: number }
├─ firstPlayerThisRound: PlayerId          // 初回はジャンケン、以降は前ラウンド敗者（spec 2-3）
├─ status: "IN_PROGRESS" | "FINISHED"
└─ winner: PlayerId | "DRAW" | null        // "DRAW"は⚠️未確定ケース（FAQ Q11、本書9章参照）専用の表現
```

```text
TurnState
├─ turnNumber: number             // ラウンド内の通し番号（先攻1ターン目判定に使用）
├─ activePlayer: PlayerId
├─ phase: PhaseId                 // 本書4章のState Machine参照
└─ isFirstTurnOfRoundFor: { [playerId]: boolean }  // spec 15章の判定に使う生データ。判定ロジックそのものはRuleConfig側（本書9章）
```

```text
PlayerState
├─ playerId
├─ deck: CardInstance[]              // 裏向き。配列の並び順が山札の順序（spec 18章）
├─ hand: CardInstance[]              // 非公開情報（spec 17章）
├─ leaders: [LeaderState, LeaderState, LeaderState, LeaderState]
├─ tacticsDeck: CardInstance[]       // 裏向き。本人のみ閲覧可（spec 15章）
├─ tacticsArea: { card: CardInstance, faceUp: boolean }[]
├─ playArea: PlayAreaEntry[]         // 左から古い順（spec 12章のプレイ順管理に使用）
├─ trash: { card: CardInstance, faceUp: boolean }[]   // faceUp=trueはタクティクス消費カードのみ（spec 16章, FAQ Q7）
├─ ppCards: { max: 3 | 4 | 5, tapped: number }   // spec 9章。tapped分が横向き＝支払い済み
└─ hasPpTicket: boolean              // 後攻のみtrue（spec 10章）
```

```text
LeaderState
├─ cardId: string          // カードマスタのcardNumberを内部IDとして使う（既存資産と同じ方針）
├─ isDown: boolean
├─ awakened: boolean
├─ damage: number          // ダメージカウンター数（spec 3-2, 13章）
├─ equipment: CardInstance[]   // 装備タクティクスカード（spec 15章「装備」サブタイプ）
└─ effects: AppliedEffect[]    // 🧩 将来の永続効果（バフ等）用の置き場。今回中身は実装しない
```

```text
PlayAreaEntry
├─ card: CardInstance
├─ order: number                 // 左からの並び順（アタック強化の「次の1回のみ」判定に必要、spec 12-2）
└─ pendingTriggers: TriggerId[]  // まだ実行していない「プレイ時」等のTrigger（FAQ Q5対応）
```

```text
CardInstance
├─ instanceId: string   // 同じcardIdのカードが複数枚デッキに入るため、インスタンスごとに一意なID
└─ cardId: string        // カードマスタ（data/cards.json）のcardNumber
```

- `currentHp` / `currentAtk` はGameStateに保存せず、`cardId`（→カードマスタのhp/atk/awakenHp/awakenAtk）と`awakened`・`damage`から都度導出する（🧩 導出値を二重管理しない設計）：
  `currentHp = (awakened ? card.awakenHp : card.hp) - damage`
  `currentAtk = awakened ? card.awakenAtk : card.atk`

---

## 2. Phase State Machine

公式ターン構造（spec 5〜8章：開始フェイズ→メインフェイズ→終了フェイズ）を、ラウンド・マッチの状態と統合した状態機械として設計する。

```text
MATCH_SETUP
   ↓（spec 4章：リーダー配置・タクティクスデッキ・デッキシャッフル・PP3枚配置・ジャンケン・初期タクティクス選出・PPチケット・初期手札4枚）
ROUND_SETUP
   ↓（1ラウンド目はMATCH_SETUPに含まれる。2・3ラウンド目はspec 2-3章：タクティクス選出・PPカード追加・4枚ドロー）
START_PHASE
   ↓（spec 6章：①PP全回復 ②1枚ドロー）
MAIN_PHASE
   ↓（spec 7章：アタック/メモリア/タクティクスを好きな順。ResolutionStackが空になるまでMAIN_PHASEに留まる）
END_PHASE
   ↓（spec 8章：①プレイエリア→トラッシュ ②残りPP分ドロー ③手札7枚制限）
── ラウンド継続判定 ──
   ├─ どちらのプレイヤーもリーダー全滅していない → ターン交代して START_PHASE（相手番）
   └─ 片方（または両方）のリーダーが全滅 → ROUND_END
ROUND_END
   ↓（spec 12-3章：プレイエリアの未実行効果を消化 → 覚醒判定 → spec 2-2章のリセット処理）
── マッチ継続判定 ──
   ├─ どちらのプレイヤーもroundWins到達数未満 → ROUND_SETUP（次ラウンド）
   └─ 先に2ラウンド勝利（クイックマッチは1ラウンド勝利） → MATCH_END
MATCH_END
```

### 実装上の注意（🧩）

- 「ラウンド継続判定」「マッチ継続判定」はPhase自体ではなく、`END_PHASE`/`ROUND_END`から次の状態へ遷移する際のガード条件として実装する（ユーザー提示のシンプルな遷移図に、公式仕様が要求する分岐を追加した形）
- `MAIN_PHASE`は「行動を選ぶ→ResolutionStackで解決→まだ行動できるなら継続」というループを内包する（spec 7章「好きな順番で行える」に対応）。Phase自体はMAIN_PHASEのままで、ResolutionStackの出入りで表現する（本書3章）
- 両者同時全滅（spec 1-2章、FAQ Q11、⚠️未確定）が起きた場合の`ROUND_END`→`MATCH_END`直行の可否は、RuleConfig（本書9章）の`lossConditionScope`に応じて分岐できるようにしておく。**現時点ではこの分岐の具体的な中身は実装しない**（設計上の差し込み口だけ用意する）

---

## 3. ResolutionStack

カード効果・アタック処理・複数効果の順序選択を一元的に扱うためのスタック。目的は「今後カード効果が増えても、Phase State Machine側のコードを増改築しなくて済むようにする」こと。

```text
PendingEffect
├─ id: string
├─ sourceInstanceId: string        // どのCardInstanceに由来する効果か
├─ trigger: TriggerId              // ON_PLAY / ON_ATTACK / AFTER_ATTACK / ON_AWAKEN / ATTACK_BOOST（本書10章）
├─ ownerPlayerId: PlayerId         // ターンを行っているプレイヤー（複数効果の順序選択権を持つ、spec 12-4）
├─ resolve: (state: GameState) => GameState   // 🧩 純粋関数として設計。今回は中身を実装しない
└─ requiresPlayerChoice: boolean   // 対象選択・順序選択などUIの介在が必要な場合true
```

```text
ResolutionStack
├─ pending: PendingEffect[]        // まだ実行していない効果
└─ isEmpty(): boolean
```

### 処理ルール（spec根拠つき）

- 効果は即座に適用せず、まず`pending`に積む。`MAIN_PHASE`はこのスタックが空になるまで次の手続き（ターン終了・ラウンド終了）に進めない（FAQ Q5：「ラウンドが終わるとき、まだ効果を実行していないプレイエリアにあるカードはどうする？」→「効果を実行します。」）
- 同時に複数の`pending`があり、かつ`trigger`が同種（例：複数の`AFTER_ATTACK`）の場合、**`ownerPlayerId`のプレイヤーが実行順を自由に選べる**（spec 12-4、FAQ Q6）。UIが介在するため`requiresPlayerChoice`をtrueにし、選択が行われるまでスタックの当該グループは保留する
- `Condition`の評価は`resolve()`が実際に呼ばれる瞬間に行う。スタックに積んだ時点の状態をキャッシュしない（FAQ Q6の「超新星」「カウンタースナイプ」の実例：実行順によって条件成立が変わる、spec 12-4）
- アタック処理は複数の`PendingEffect`の連鎖として表現する（本書6章で詳細化）

---

## 4. Event設計

イベントは「Game EngineとCard Effect Engineが状態変化を伝え合うための共通言語」であり、かつ`actionLog`（リプレイ・デバッグ用）に記録される。

**重要な区別**：イベント名を定義することと、それが公式ルール上のTrigger（カード効果の発生タイミング）であることは別。以下、`[公式Trigger]`と`[implementation event]`を明示する。

| イベント | 種別 | 根拠 |
|---|---|---|
| `GAME_STARTED` | implementation event | ログ・UI用。公式Triggerではない |
| `MATCH_SETUP_COMPLETED` | implementation event | 同上 |
| `ROUND_STARTED` | implementation event | 同上 |
| `ROUND_SETUP_COMPLETED` | implementation event | 同上 |
| `TURN_STARTED` | implementation event | 同上（開始フェイズの発生源にはなるが、"ターン開始時効果"という公式Triggerの存在自体はspec 6章で⏳未確認） |
| `START_PHASE_PP_RECOVERED` | implementation event | spec 6章①の処理を表すログ用イベント |
| `CARD_DRAWN` | implementation event | ログ用。ドロー自体は公式ルール（spec 6, 8, 17章）だが「イベント」という概念は実装上のもの |
| `MAIN_PHASE_STARTED` | implementation event | ログ用 |
| `CARD_PLAYED` | implementation event | 「プレイする」という行為自体はspec 7章の用語だが、イベントとしての切り出しは実装都合 |
| `ATTACK_DECLARED` | **公式Trigger相当**（`ON_ATTACK`＝「アタックする」） | spec 7章, 12章 |
| `ATTACK_BOOSTED` | **公式Trigger相当**（`ATTACK_BOOST`＝「アタック強化」） | spec 9章, 12-2章 |
| `DAMAGE_CALCULATED` | implementation event | spec 12-2章②の計算ステップをログ化したもの。公式資料に「ダメージ計算」というTrigger名があるわけではない |
| `DAMAGE_DEALT` | implementation event | 同上（ダメージ付与自体はspec 7,8,12章で確認済みの手続き） |
| `LEADER_DOWNED` | implementation event | ダウン自体はspec 3-2章で確認済みの状態変化だが、Trigger名としての「ダウン時」効果が公式に存在するかは⏳未確認（spec 28章参照） |
| `LEADER_AWAKENED` | **公式Trigger相当**（`ON_AWAKEN`＝「覚醒時」） | spec 3-3章, 8章 |
| `AFTER_ATTACK_EFFECTS_QUEUED` | implementation event | spec 12-4章の複数「アタック後」効果の積み上げをログ化 |
| `EFFECT_ORDER_CHOSEN` | implementation event | プレイヤーが実行順を選んだ記録（spec 12-4, FAQ Q6） |
| `MEMORIA_PLAYED` | implementation event | メモリアのプレイ自体はspec 14章 |
| `TACTICS_PLAYED` | implementation event | タクティクスのプレイ自体はspec 15章 |
| `EQUIPMENT_ATTACHED` | implementation event | 装備タクティクスのプレイ（spec 15章） |
| `END_PHASE_STARTED` | implementation event | ログ用 |
| `CARDS_TRASHED` | implementation event | spec 8章の終了フェイズ処理①のログ化 |
| `END_PHASE_DRAW` | implementation event | spec 8章②（残りPP分ドロー）のログ化 |
| `HAND_DISCARDED_OVER_LIMIT` | implementation event | spec 8章③（手札7枚制限） |
| `DECK_EMPTY` | implementation event | FAQ Q1の入口条件 |
| `DECK_RESHUFFLED_FROM_TRASH` | implementation event | FAQ Q1手順1 |
| `TACTICS_CONSUMED` | implementation event | FAQ Q1手順2（タクティクスデッキを1枚犠牲にする処理） |
| `DECK_OUT_LOSS` | implementation event | FAQ Q1手順3（タクティクスデッキも尽きた場合の敗北） |
| `TURN_ENDED` | implementation event | ログ用 |
| `ROUND_ENDED` | implementation event | ラウンド終了自体はspec 2章で確認済みの状態変化 |
| `SIMULTANEOUS_LOSS` | implementation event | FAQ Q11のケース。⚠️未確定のため、発火条件はRuleConfig依存（本書9章） |
| `MATCH_ENDED` | implementation event | ログ用 |

---

## 5. 攻撃処理フロー設計

spec 12章（基本手順p.07＋詳細版p.12）をResolutionStackへの積み方として設計する。

```text
1. アタックカードをプレイ（PP支払い、playAreaへ表向きに配置）
     ↓
2. カードに「プレイ時」効果があれば PendingEffect(trigger=ON_PLAY) を積み、解決
     ↓
3. 「アタックする」効果を PendingEffect(trigger=ON_ATTACK) として積み、解決
     3-1. アタッカー（自分のリーダー）と対象（相手のダウンしていないリーダー）を選ぶ
     3-2. ダメージ値を計算する：
          Σ(このアタックを強化しているATTACK_BOOST効果のダメージ) + アタックカードのダメージ + アタッカーのcurrentAtk
          （条件付き・追加効果があればここに合算。spec 12-2章②）
     3-3. 対象にダメージを与える（damageを加算）
     3-4. currentHp <= 0 ならダウン処理（isDown=true, damageリセット, LEADER_DOWNEDイベント）
     ↓
4. 「アタック後」効果があれば PendingEffect(trigger=AFTER_ATTACK) を積む
     ※同時に複数の AFTER_ATTACK が積まれている場合、ownerPlayerId（ターンプレイヤー）が解決順を選ぶ（本書3章）
     ↓
5. 対象リーダーが1体以上ダウンし、かつアタッカーがまだ awakened=false なら、
   PendingEffect(trigger=ON_AWAKEN) を積んで解決する（覚醒フラグを立て、「覚醒時」効果を実行）
     ↓
6. ResolutionStackが空になるまで2〜5を繰り返す
```

### 設計に反映した確認済みルール

- **同じリーダーが何度でも攻撃可能**（spec 7章）：アタッカー選択時に「このリーダーは既にこのターン攻撃した」という制限を一切設けない設計にする（制限を実装しない、という設計判断）
- **アタック強化は次の1回のみ**（spec 9章, 12-2章）：`ATTACK_BOOST`のPendingEffectは「次に解決される`ON_ATTACK`」にのみ適用し、適用後はスタックから消費される（次の次のアタックには残らない）
- **メモリアはアタックカードより先にプレイ**（spec 9章, 12-2章）：これはプレイヤーの操作順の話であり、エンジン側で「先にプレイしないとエラーにする」必要はない。単に`ATTACK_BOOST`効果は「まだ解決されていない次の`ON_ATTACK`」を待ち構える形で実装すれば、結果的にプレイ順が自然に強制される
- **複数の「アタック後」効果は順序選択可能**（spec 12-4章）：本書3章のResolutionStackの仕組みをそのまま使う
- **ラウンド終了時、プレイエリアの未実行効果を先に消化してから覚醒判定、その後ラウンド終了処理へ**（spec 12-3章, FAQ Q4/Q5）：ResolutionStackが空になることをラウンド終了処理の前提条件にする

---

## 6. PP管理設計

- `PlayerState.ppCards.max`は`match.roundNumber`に応じて`ROUND_SETUP`で設定する：ラウンド1=3、ラウンド2=4、ラウンド3=5（spec 9章、Manual p.04/p.05/p.11）
- `START_PHASE`の処理①で`ppCards.tapped = 0`にする（全回復。spec 6章）
- カードプレイのコスト支払いは`ppCards.tapped += cost`（`tapped`が`max`を超える支払いは実行不可）
- `END_PHASE`の処理②で「残っているPP」＝`max - tapped`の枚数だけドローする（spec 8章）
- `hasPpTicket`は後攻プレイヤーのみ`true`（spec 10章）。PPチケットは「タクティクスカードの一種」として`tacticsArea`に積まれ、他のタクティクスカードと同じ`1ターン1枚`制限の対象になる（spec 10章の一般ルールがそのまま適用されると考えられるが、PPチケット固有の追加ルールの有無は⏳未確認。spec 10章参照）

---

## 7. デッキ・トラッシュ処理設計

FAQ Q1（spec 19章）のフォールバック連鎖を、1つの巨大関数にせず責務ごとに分離する。

```text
drawCard(player, count): CardInstance[]
  → player.deck から count 枚取り出す
  → 途中で deck が尽きたら checkDeckOutLoss() 経由のフォールバックへ

rebuildDeckFromTrash(player): void
  → player.trash の裏向きカードをすべて player.deck へ移し、シャッフルする
  → FAQ Q1手順1

consumeTacticsDeck(player): CardInstance | null
  → player.tacticsDeck からランダムに1枚選び、表向きで trash へ置く
  → 戻り値はUI/ログ用（実際にdeckへ補充されるわけではない点に注意。
     FAQ Q1の例では「タクティクスデッキを消費する」こと自体が処理であり、
     それによってデッキ内容が増えるわけではない。この関数の役割は
     「フォールバックとして消費できるかどうか」と「消費した事実の記録」）
  → tacticsDeck が0枚なら null を返す

checkDeckOutLoss(player): boolean
  → tacticsDeck が0枚の状態で consumeTacticsDeck が呼ばれた（＝選ぶカードがない）場合 true
  → true の場合、そのプレイヤーの敗北処理（MATCH_ENDへ、または⚠️のSIMULTANEOUS_LOSS分岐、本書9章）を呼び出す
```

### 呼び出しフロー（FAQ Q1準拠）

```
何らかの理由でデッキから引く/見る必要が生じる
  ↓
deck が空か？ ── No → 通常通り引く
  ↓ Yes
rebuildDeckFromTrash() を呼ぶ
  ↓
（再構築後）deck が空か？ ── No → 引く
  ↓ Yes（trashにも裏向きカードがなかった）
consumeTacticsDeck() を呼ぶ
  ↓
null が返ったか？ ── No → 処理続行（このステップでは「引けた」ことにはならない点に注意。
                            FAQ Q1の例は「タクティクスデッキ消費」を挟んで元のアタック効果の
                            処理（デッキの残りを見る等）を続行する特殊な流れであり、
                            単純な「引く」の代替にはならないケースもある。
                            🧩 個別カード効果（リンクアサルトの例）ごとに挙動が変わりうるため、
                            この関数群は「汎用フォールバックの部品」として提供し、
                            具体的な組み合わせ方はCard Effect Engine側（呼び出し元）に委ねる設計とする
  ↓ Yes
checkDeckOutLoss() → true → 敗北処理
```

---

## 8. 対戦画面・オンライン対戦との関係（🧩 今回は設計方針のみ）

- Game Engineは`GameState`を入力に取り`GameState`を返す純粋な reducer（`applyAction(state, action) -> state`）として設計し、UIやネットワーク層に依存させない
- 手札・裏向きトラッシュ・タクティクスデッキ等の非公開情報は、`GameState`全体とは別に「プレイヤー視点でマスクした View」を生成する関数（`maskStateForPlayer(state, playerId)`）を今後追加できるようにしておく（spec 29章）。今回はこの関数の中身は実装しない
- ローカル2人対戦（Player A/Bを画面上で切り替える）は、上記reducerに対して交互に`Action`を投げるだけの薄いUIとして将来実装できる。今回はUI自体を作らない

---

## 9. Rule Configuration Layer（⚠️未確定ルールの分離）

仕様書で⚠️扱いの項目は、Game Engineのコードに直接分岐を書かず、以下の設定オブジェクトを参照する形にする。値は**すべてPROVISIONAL（暫定）** であり、公式確定値ではない。

```text
RuleConfig
├─ firstPlayerTacticsRestriction: {
│    scope: "PER_ROUND" | "MATCH_START_ONLY",   // PROVISIONAL: "PER_ROUND"
│    appliesInQuickMatch: boolean,               // PROVISIONAL: true
│    status: "PROVISIONAL",
│    source: "spec.md 15章（未確定）"
│  }
│
├─ lossConditionScope: {
│    scope: "ROUND" | "MATCH",                   // PROVISIONAL: "ROUND"
│    status: "PROVISIONAL",
│    source: "spec.md 1-2章 / FAQ Q11（未確定）"
│  }
│
├─ turnStartEffectsEnabled: boolean               // PROVISIONAL: false（該当Triggerの存在自体が⏳未確認のため、
│                                                  //   デフォルトでは何も発火させない安全側の設定）
│
├─ downedLeaderEquipmentHandling: {
│    mode: "KEEP" | "AUTO_TRASH",                 // PROVISIONAL: "KEEP"（一般ルールとしての自動処理は未確認、
│                                                  //   個別カード効果に委ねる方針。spec 3-4章）
│    status: "PROVISIONAL"
│  }
│
├─ limitedBanSource: "CARD_DATA_FLAG"             // ✅確定扱いでよい：BAN自体はcard.banフラグで駆動する
│                                                  //   設計は既存デッキビルダーと同じ方針（spec 21章）。
│                                                  //   「制度としての説明」はマニュアルにないが、
│                                                  //   運用方法自体はデータ駆動で確定している
│
└─ matchModeDisplayNames: {
     standard: "PROVISIONAL_STANDARD_MATCH",      // "フルマッチ"という名称が公式資料に存在しないため、
                                                    //   確定するまでは内部コードのプレースホルダ名を使う
     quick: "クイックマッチ"                        // ✅ こちらは公式名称として確認済み（spec 22章）
   }
```

- `status: "PROVISIONAL"` を持つ項目は、UIやログ上でも「これは仮仕様です」と分かるようにする（🧩 今回はUIを作らないため設計方針のみ）
- 公式資料（Quick Manual・FAQ単体・Floor Rules等）が新たに提供され仕様書側が✅に更新されたら、対応する`RuleConfig`の値を確定値に差し替え、`status`を`"CONFIRMED"`にする。**この切り替えがGame Engine本体のコード変更を必要としない**ことが、この層を分離する目的

---

## 10. Card Effect Layer（設計のみ。個別カード効果は実装しない）

```text
CardEffect
├─ trigger: "ON_PLAY" | "ON_ATTACK" | "AFTER_ATTACK" | "ON_AWAKEN" | "ATTACK_BOOST"
├─ condition?: Condition        // 省略時は常に成立
├─ target?: TargetSpec          // 省略時は対象を取らない効果
├─ cost?: CostSpec               // PP以外の追加コスト（例：手札を1枚捨てる）
├─ action: ActionSpec            // DRAW/DAMAGE/HEAL/RECOVER_PP/DISCARD等
├─ modifier?: ModifierSpec       // ダメージ加算等の数値修正
├─ duration?: "NEXT_ATTACK_ONLY" | "THIS_TURN" | "PERMANENT"   // spec 9章より判明しているのは NEXT_ATTACK_ONLY のみ。他は将来拡張用
└─ replacement?: ReplacementSpec // ルールを明示的に上書きする効果（FAQ Q10。例：ダウン中リーダーを対象にできる）
```

```text
Condition = (state: GameState) => boolean
```
- **必ず効果解決の瞬間に呼び出す。** ResolutionStackに積む時点や、カードをプレイした時点の状態で判定を固定しない（本書3章、FAQ Q6の実例）

```text
TargetSpec = (state: GameState, context) => LeaderRef[] | CardRef[]
```
- 対象の集合が空の場合、そのCardEffectは何もしない（No-op）。エラーにしない（FAQ Q8）

```text
ReplacementSpec
├─ overridesRuleIds: string[]   // 例: ["CANNOT_TARGET_DOWNED_LEADER"]
```
- Rule Layer（Game Engine側）は「ダウン中のリーダーを対象にできない」という一般チェックを提供する関数を持つが、Card Effect Engineがある効果を解決する際、その効果の`replacement.overridesRuleIds`に該当ルールIDが含まれていれば、そのチェックをスキップしてよい。**カード側が明示的に宣言した範囲でのみ**ルールを上書きでき、エンジンが「多分このカードは特別扱いだろう」と推測することはない（FAQ Q10の趣旨をそのまま構造化したもの）

以上の概念（Trigger/Condition/Target/Cost/Action/Modifier/Duration/Replacement）は、いずれもこれまでに確認した公式カードテキストの実例（spec 26章）から抽出したものであり、実例のない概念を新たに追加してはいない。

---

## 11. テスト設計（実装前の設計。テストコード自体は今回書かない）

以下はテストケースの一覧。実装フェーズでこれをそのままテスト関数に落とし込む想定。⚠️未確定ルールに関わるテストは、`RuleConfig`のPROVISIONAL値を**テスト側で明示的に指定**し、「その設定値のときにこう動く」ことだけを検証する（公式ルールとして断定しない）。

### Match
- 3ラウンド制で進行できる（1勝1敗の後、3ラウンド目に決着）
- 2ラウンド先取で試合が終了する
- クイックマッチは1ラウンドで試合が終了する（後攻はPPチケットの代わりにタクティクス2枚目を持つ）

### Round
- ラウンド1のPP上限は3
- ラウンド2のPP上限は4（ラウンド開始時にPPカードが1枚追加される）
- ラウンド3のPP上限は5
- ラウンド終了時、装備・覚醒状態は次ラウンドに持ち越され、ダメージ・プレイエリア・手札はリセットされる

### Turn
- 開始フェイズ：PP全回復→1枚ドローの順で処理される
- メインフェイズ：アタック/メモリア/タクティクスを任意の順で実行できる
- 終了フェイズ：プレイエリア→トラッシュ（タクティクスのみ表向き）→残りPP分ドロー→手札7枚制限、の順で処理される
- 先攻プレイヤーも1ターン目の開始フェイズでドローする（例外なし、FAQ Q13）

### Attack
- 同一リーダーが1ターン中に複数回攻撃できる
- アタック強化（メモリア）が次の1回のアタックのみに適用され、その次のアタックには持ち越されない
- メモリアをアタックカードより先にプレイした場合のみ、そのアタックが強化される
- 複数の「アタック後」効果がある場合、ターンプレイヤーが実行順を選べる。選ぶ順序によって後続の条件成立が変わる（FAQ Q6の実例を再現）
- アタックで相手の最後のリーダーをダウンさせた場合、覚醒処理と「覚醒時」「アタック後」効果が実行されてからラウンド終了処理に入る

### Deck
- デッキが空の状態で引こうとすると、トラッシュの裏向きカードがシャッフルされてデッキに戻る
- トラッシュにも裏向きカードがない場合、タクティクスデッキから1枚が消費される
- タクティクスデッキも0枚の状態で消費しようとすると、そのプレイヤーは敗北する

### Hand
- 終了フェイズに、残っているPP枚数と同じ枚数だけドローする
- 手札が7枚を超えている場合、終了フェイズに7枚になるまでトラッシュする

### Tactics
- タクティクスカードは1ターンに1枚までしかプレイできない
- 先攻1ターン目のタクティクス制限：**この制限がどの範囲に適用されるかは未確定（本書9章のRuleConfig参照）のため、テストは「`RuleConfig.firstPlayerTacticsRestriction.scope = "PER_ROUND"`のときはこう動く／`"MATCH_START_ONLY"`のときはこう動く」という2通りを設定切り替えで検証する形にする。どちらか一方を公式ルールとして確定させるテストにはしない**

---

## 完了状態

- `docs/xross-stars-game-spec.md` … 既存（本作業では変更なし）
- `docs/game-engine-architecture.md` … 本ファイル（新規作成）
- コード（GameState型定義、Phase State Machine実装、ResolutionStack実装、Event実装、RuleConfig実装、Card Effect Engine実装、テストコード）は**まだ一切実装していない**
