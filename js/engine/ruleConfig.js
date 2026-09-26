/* Xross Stars ゲームエンジン — Rule Configuration Layer
 *
 * docs/xross-stars-game-spec.md で ⚠️要確認 のルールは、ここに分離する。
 * すべて status: "PROVISIONAL"（暫定値）であり、公式確定ルールではない。
 * エンジン本体のコードはこれらの値を直接ハードコードせず、必ずこのオブジェクト経由で参照する。
 *
 * 公式資料（Quick Manual／FAQ単体／Floor Rules等）が新たに確認でき、
 * docs/xross-stars-game-spec.md 側が✅に更新されたら、対応する値を確定させ
 * status を "CONFIRMED" に変更する。この切り替えでエンジン本体のコードは変更不要。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.XS_ENGINE_RULE_CONFIG = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createDefaultRuleConfig() {
    return {
      // spec.md 15章：先攻1ターン目のタクティクス禁止の適用範囲（⚠️未確認）
      firstPlayerTacticsRestriction: {
        scope: 'PER_ROUND', // 'PER_ROUND' | 'MATCH_START_ONLY'
        appliesInQuickMatch: true,
        status: 'PROVISIONAL',
        source: 'docs/xross-stars-game-spec.md 15章（未確定）',
      },
      // spec.md 1-2章 / FAQ Q11：両者同時敗北の粒度（⚠️未確認）
      lossConditionScope: {
        scope: 'ROUND', // 'ROUND' | 'MATCH'
        status: 'PROVISIONAL',
        source: 'docs/xross-stars-game-spec.md 1-2章, FAQ Q11（未確定）',
      },
      // spec.md 6章：「ターン開始時効果」という公式Trigger自体の存在が⏳未確認のため、
      // デフォルトでは何も発火させない（安全側）。Hookは用意するが中身は空。
      turnStartEffectsEnabled: false,
      // spec.md 3-4章：ダウン時の装備カード自動処理（⏳未確認）
      downedLeaderEquipmentHandling: {
        mode: 'KEEP', // 'KEEP' | 'AUTO_TRASH'
        status: 'PROVISIONAL',
        source: 'docs/xross-stars-game-spec.md 3-4章（未確定）',
      },
      // spec.md 21章：BAN自体はカードデータのbanフラグで駆動する。運用方法としては確定。
      limitedBanSource: 'CARD_DATA_FLAG',
      // spec.md 22章：「フルマッチ」という名称は公式資料に一度も登場しない
      matchModeDisplayNames: {
        STANDARD: 'PROVISIONAL_STANDARD_MATCH',
        QUICK: 'クイックマッチ',
      },
      // spec.md 8章：手札7枚超過時、どのカードを捨てるかの選択主体は明記がない（⚠️未確認）
      handOverflowDiscardChoice: {
        chooser: 'OWNER_PLAYER', // 'OWNER_PLAYER'（本人が選ぶ）以外の値は今回未検討
        status: 'PROVISIONAL',
        source: 'docs/xross-stars-game-spec.md 8章（未確定）',
      },
      // 装備タクティクスカードの「体力+30」等の効果テキストが、
      // 最大HP（体力そのもの）の増加なのか、その場限りの回復（ダメージカウンター除去）なのか、
      // 公式資料に明記が見当たらない（⚠️未確認）。
      // 「体力」＝カード印刷値（p.02, p.08）、「回復」＝ダメージカウンター除去（FAQ）と
      // 用語が一貫して区別されていることから、本エンジンはMAX_HP_INCREASEを採用している。
      // CURRENT_HP_HEALは未実装（このRuleConfigで切り分けているだけで、実際の分岐処理は無い）。
      equipmentHpModifierSemantics: {
        mode: 'MAX_HP_INCREASE', // 'MAX_HP_INCREASE'（実装済み） | 'CURRENT_HP_HEAL'（未実装）
        status: 'PROVISIONAL',
        source: 'docs/xross-stars-game-spec.md 3-4章 / p.02,p.08の「体力」表記, FAQ「体力の回復＝ダメージカウンター除去」の用語比較（未確定）',
      },
      // カード効果（例：BP01-093ジャミングパルス「対戦相手は手札を2枚捨てる」）による強制ディスカードで、
      // 「どのカードを捨てるか」を誰が選ぶかが公式資料に明記されていない（⚠️未確認）。
      // 自分の手札を自分で捨てるケース（曖昧性なし）は対象外。相手/全員への強制ディスカードのみが対象。
      // 既存のhandOverflowDiscardChoice（8章・終了フェイズの7枚制限専用）とは別文脈のため独立して定義する。
      // insufficientHandBehaviorは、PPの回復/HEALが「利用可能な分だけ処理する」設計（FAQ Q9）と
      // 一貫させるための類推であり、ディスカード自体の公式ルールとして明記されたものではない。
      cardEffectDiscardChoice: {
        chooser: 'OWNER_PLAYER', // 'OWNER_PLAYER'（捨てる本人が選ぶ）以外の値は今回未検討
        insufficientHandBehavior: 'DISCARD_AVAILABLE_ONLY', // 手札が指定枚数未満なら、あるだけ捨てる（クラッシュさせない）
        status: 'PROVISIONAL',
        source: 'docs/xross-stars-game-spec.md 8章（手札上限の類推）, FAQ Q9（回復量の類推）（いずれも未確定）',
      },
      // カードテキストの「オーバーキルN：〜」（例：BP01-029等）が指す「余剰ダメージ」の定義自体が、
      // Playing Manualに一般ルールとして明記されていない（各カードの括弧書き説明からの類推）。
      // 本エンジンでは「このカード自身のメイン攻撃で与えたダメージ－攻撃前の残りHP」とし、
      // 他の効果による累積ダメージは含めない（ダウンしなかった場合はOverkillの概念自体が存在しない）。
      overkillDefinition: {
        formula: 'DAMAGE_MINUS_REMAINING_HP', // 与えたダメージ－攻撃前の残りHP
        scope: 'PRIMARY_ATTACK_ONLY', // このカード自身のメイン攻撃のみ。AFTER_ATTACK効果の累積ダメージは含めない
        status: 'PROVISIONAL',
        source: '各オーバーキルカードの括弧書き説明からの類推（Playing Manualに一般ルールとしての式の明記なし）',
      },
      // 装備が付与する「この効果はターンに1回しか発動しない」（例：オートタレット/盗賊キット。
      // ただしEQUIP_GRANT_ABILITY自体はPhase D-2の対象外のため今回は実カード未登録）の識別単位・
      // 判定タイミングが公式資料に明記されていない。
      oncePerTurnUsageTracking: {
        identificationUnit: 'SOURCE_INSTANCE_ID', // カードID単位ではなく、効果の発生源インスタンス単位（装備なら装備インスタンス単位）
        markUsedTiming: 'ON_CONDITION_MET', // Condition成立と同時に使用済みとする（対象0件のNo-opでも使用済みになる）
        // Phase D-3A監査で修正: turnNumberはラウンドが変わるたびに1にリセットされる（match.js）ため、
        // 生のturnNumberだけの比較ではラウンドをまたいだ誤判定（衝突）が起きることを確認した。
        // roundNumber+turnNumberの複合キーで一意化する（match.js/phases.js自体は無改修）。
        resetMechanism: 'ROUND_AND_TURN_NUMBER_COMPARISON',
        status: 'PROVISIONAL',
        source: 'docs/xross-stars-game-spec.md 該当章なし（カードテキストのみから類推、未確定）',
      },
      // Phase D-3A: 装備が付与する能力（EQUIP_GRANT_ABILITY、例：盗賊キット/ヒーリングオーブ）の
      // ライフサイクルが公式資料に明記されていない。
      equipGrantedAbilityLifecycle: {
        // 付与能力は「装備がleader.equipmentに存在する間だけ」有効という設計（hpModifier/atkModifierと同じ扱い）。
        durationScope: 'WHILE_EQUIPPED',
        // リーダーがダウンしても装備・付与能力ともに残る（既存downedLeaderEquipmentHandling: KEEPと同じ扱い）。
        onLeaderDown: 'FOLLOWS_DOWNED_LEADER_EQUIPMENT_HANDLING',
        // 装備の移動・解除（MOVE_EQUIPMENT等）は未実装のため、その際の能力消失は検証していない。
        onUnequipOrMove: 'NOT_IMPLEMENTED',
        status: 'PROVISIONAL',
        source: 'docs/xross-stars-game-spec.md 3-4章（装備の一般的な扱いからの類推）、該当カードのテキストのみ（未確定）',
      },
      // Phase D-3: MOVE_EQUIPMENT（例：メカニカルエキスパート「装備し直してもよい」）の
      // 移動先選択・未選択時の挙動が公式資料に明記されていない。
      moveEquipmentPolicy: {
        // 選択コールバック未提供時は「してもよい」を辞退したもの＝何もしないとして扱う
        defaultWhenNoChoice: 'DECLINE',
        // 移動先にDOWN中の自分のリーダーを含めてよいか：一般的な対象制限（spec 3-2章）は
        // ダメージ等の「対象」に関するものであり、装備の付け替えはそれとは別と解釈して除外しない
        allowDownedLeaderAsDestination: true,
        status: 'PROVISIONAL',
        source: 'docs/xross-stars-game-spec.md 3-2章・3-4章からの類推、該当カードのテキストのみ（未確定）',
      },
      // Phase D-3: TEMP_ATK_MODIFIER（例：先導者の証「このターン、攻撃力+30」）の
      // 失効タイミングが公式資料に明記されていない。
      tempAtkModifierLifecycle: {
        // ターン終了時・ラウンド終了時の両方でクリアする（match.js/phases.js自体は無改修、
        // effectResolver.jsのラッパー関数が能動的にクリアする設計）
        clearsOn: ['TURN_END', 'ROUND_END'],
        // DOWNしても消えない（既存downedLeaderEquipmentHandling: KEEPと同じ非クリア方針）
        clearsOnLeaderDown: false,
        // 同一ターンに複数回付与された場合は加算で積み上がる（装備ATK修正の複数装備時と同じ扱い）
        stacking: 'ADDITIVE',
        status: 'PROVISIONAL',
        source: 'docs/xross-stars-game-spec.md 該当章なし（カードテキストのみから類推、未確定）',
      },
      // Phase D-3: DISTRIBUTED_HEAL（例：救急キット「合計80回復、複数のリーダーを選んでもよい」）の
      // 配分方法が公式資料に明記されていない。
      distributedHealAllocationPolicy: {
        // 配分コールバック未提供時は先頭候補1体に全量を割り当てる（均等配分ではない）
        defaultWhenNoChoice: 'FIRST_CANDIDATE_GETS_ALL',
        // 過剰に請求した分（対象の残りダメージカウンターを超える割り当て）は他対象へ繰り越さず失われる
        overAllocationHandling: 'LOST_NOT_REDISTRIBUTED',
        status: 'PROVISIONAL',
        source: 'docs/xross-stars-game-spec.md 該当章なし（カードテキストのみから類推、未確定）',
      },
      // Phase D-3: BP02-076ドレインロッドはdata/cards.json内で
      // confirmStatus:"要確認（外部情報で基本情報確認／公式詳細未確認）", confirmed:false, officialUrl:null。
      // 他の確定カードと異なりテキスト自体の公式確認が完了していない状態であることを明記する
      // （テキストは変更せずそのまま実装したが、データの確度自体がPROVISIONAL）。
      unconfirmedCardData: {
        cardIds: ['BP02-076'],
        status: 'PROVISIONAL',
        source: 'data/cards.json内のconfirmStatus/confirmedフィールド自体が未確認を示している',
      },
      // Phase E: 条件付きのON_ATTACK（ATTACK_DAMAGE_BONUS）・ATTACK_BOOST（DAMAGE_BONUS）ボーナスを
      // いつ評価するかは、これまでcomputeAttackCardBaseDamage/queueAttackBoostのどちらも
      // 「常に無条件で発動する」設計だったため、新たに決める必要があった。
      // ON_ATTACK: アタック宣言時（Phases.playAttackCard呼び出し直前、このカード自身がまだ
      //   プレイエリアに積まれる前）に評価する（アナイアレーション・オールスターコンボで確認できる
      //   範囲では、宣言時点の状態で確定して問題ない）。
      // ATTACK_BOOST: メモリアをプレイした瞬間（このカード自身は既にプレイエリアに積まれた後）に
      //   評価する。We are...!の括弧書き「メモリアカードの数は【アタック強化】を実行するときに数える」
      //   という個別カードの明記されたルーリングを、条件付きATTACK_BOOST全般の評価タイミングとして
      //   一般化したもの（他のカードでの確認は取れていない）。
      conditionalAttackBonusEvaluationTiming: {
        onAttack: 'AT_ATTACK_DECLARATION_BEFORE_PLAY_AREA_PUSH',
        attackBoost: 'AT_MEMORIA_PLAY_TIME_AFTER_PLAY_AREA_PUSH',
        status: 'PROVISIONAL',
        source: 'BP03-059 We are...!の括弧書き（ATTACK_BOOST側のみ明記）からの一般化。ON_ATTACK側は該当カードのテキストに評価タイミングの明記なし。',
      },
      // Phase F: MULTI_ATTACK（例：ストームラッシュ「アタックする」×3、アタックのたびにアタッカー/
      // 対象を選ぶ）を、カード1枚のプレイ内で独立したCombat.declareAttackをcount回呼ぶ形で実装した際の
      // 設計判断。公式資料に「複数回アタックする」効果の一般ルールとしての明記は見当たらず、各カードの
      // テキスト（「アタックする」を複数回書く形式）からの類推。
      multiAttackSemantics: {
        // カードのPP支払い・手札からの除去・プレイエリアへの追加は1回のみ（カードは1枚のまま）
        costAndPlayAreaHandling: 'ONCE_PER_CARD_PLAY',
        // 各回の宣言は完全に独立したアタックイベントとして扱う
        // （オーバーキル計算・カード自身/装備のAFTER_ATTACK・ON_AWAKEN判定をそれぞれ個別に行う）
        eachDeclarationIsIndependentAttackEvent: true,
        // メモリア等が付与する「次の1回のアタックのみ」のアタック強化/紐づくAFTER_ATTACK効果は、
        // pendingAttackBoost/pendingAfterAttackEffectsが最初の宣言で消費される実装上の帰結として、
        // 自然にN回のうち最初の1回にのみ適用される（2回目以降には引き継がれない）
        boostAndLinkedAfterAttackAppliesToFirstDeclarationOnly: true,
        // 対象は事前にまとめて指定されるため、先の回でダウンした対象/アタッカーが指定されていた場合は
        // 生存している先頭のリーダーに差し替え、差し替え先が無ければ残りのアタックは行わない
        downedPredeclaredTarget: 'RETARGET_FIRST_ALIVE_ELSE_STOP',
        status: 'PROVISIONAL',
        source: 'BP03-017 ストームラッシュの文言（「アタックする」×3＋「アタックのたびに、アタッカーとアタックを受けるリーダーを選ぶ」という括弧書き）からの類推。他の実カードでの確認は取れていない。',
      },
      // Phase G: FREE_PLAY系（手札/デッキルック/プレイエリアから選んでコストを支払わずプレイする）
      // カードの共通の設計判断。
      freePlayAndReplayPolicy: {
        // 選択コールバック未提供時は、他のPROVISIONAL項目と同様「してもよい」を辞退したものとして扱う
        // （FREE_PLAY_MEMORIA_FROM_HAND/DECK_LOOK_FREE_PLAY_MEMORIA/REPLAY_SELECTED_FROM_PLAY_AREA共通）
        defaultWhenNoChoice: 'DECLINE',
        // 一騎当千のコスト合計上限は、申告された選択をそのまま信頼せず、こちら側で合計を再計算しながら
        // 順に加算し、上限を超える時点のカードは無視する（安全側。呼び出し元の不正/バグに強くする）
        costLimitEnforcement: 'RECOMPUTED_SERVER_SIDE_NOT_TRUSTED_FROM_CALLER',
        // リンク・アサルトの「デッキの上から見て、選ばなかった残りをトラッシュに置く」の表裏は
        // 公式資料に明記が無い。他の非公開情報の扱い（手札からの破棄=裏向き）に合わせて裏向きとする。
        deckLookRestOrientation: 'FACE_DOWN',
        // 三銃士「プレイエリアのカードをプレイし直す」で再トリガーするのはON_PLAY効果のみとし、
        // ATTACK_BOOST/AFTER_ATTACKへの再リンクは行わない（公式資料に対象Trigger範囲の明記が無く、
        // 対象が「コスト0のメモリア」に限定されている実例からON_PLAYのみと解釈するのが安全側）
        replayFromPlayAreaTriggerScope: 'ON_PLAY_ONLY',
        status: 'PROVISIONAL',
        source: 'BP01-017 一騎当千 / BP01-044 リンク・アサルト / BP02-024 三銃士 のテキストからの類推。公式資料にFREE_PLAY/デッキルック/リプレイの一般ルールとしての明記は無い。',
      },
      // 第5弾ACE（カード画像のみで確認。公式FAQ等は未確認）の実装で決めた解釈。
      bp05AcePolicy: {
        // DECK_LOOK_ADD_TO_HAND（アブソリュートドミニオン／シンクロトリニティ／討伐クエスト）：
        // 選択コールバックが無いときは条件に合うカードを先頭から上限枚数まで手札に加える
        // （手札に加えるだけで失うものが無いため。FREE_PLAY系の既定「辞退」とは意図的に変えている）。
        deckLookAddToHandDefault: 'TAKE_FIRST_UP_TO_MAX',
        deckLookAddToHandRestOrientation: 'FACE_DOWN',
        // ヴァリアブルピック「対戦相手のリーダー最大2体」：選択が無いときは生存リーダーの先頭から2体
        upToNTargetDefault: 'FIRST_N_ALIVE',
        // 共に至る極致「自分の体力40以上のリーダー」：現在の残り体力（装備修正込み）で判定。選択が無いときは辞退
        optionalSelfDamageHpBasis: 'CURRENT_REMAINING_HP',
        optionalSelfDamageDefault: 'DECLINE',
        // 頂点捕食者：手札を捨てる選択が無いときは辞退。捨てた後、デッキから選ぶ選択が無いときは先頭の候補をプレイ。
        // プレイするアタックは「このアタックが終わってから」＝このアタックで積まれた他の効果がすべて解決した後。
        // その時点で元のアタッカーがダウンしていれば生存している先頭のリーダー、アタックを受けるリーダーは
        // 元の対象（ダウンしていれば生存している先頭）。アタッカー/対象がいなければプレイせずトラッシュへ裏向き。
        apexDiscardDefault: 'DECLINE',
        apexDeckLookPlayDefault: 'FIRST_CANDIDATE',
        apexDiscardOrientation: 'FACE_DOWN',
        // デュアルハザードの判定はアタック宣言時（ダメージ計算前）のアタッカーの状態で行う
        dualHazardEvaluationTiming: 'AT_DECLARATION',
        // エコー：ターン終了時に縦向きならプレイエリアに残して横向きに。次の自分のメインフェイズ開始時
        // （スタートフェイズのPP回復・ドローの後）にプレイし直し、プレイ時・アタック強化・アタック後を再び処理する。
        // ラウンド終了時のプレイエリア一掃では横向きのエコーカードもトラッシュに置く。
        echoReplayTiming: 'AFTER_START_PHASE_BEFORE_MAIN_ACTIONS',
        echoReplayTriggerScope: 'ON_PLAY_ATTACK_BOOST_AFTER_ATTACK',
        echoAtRoundEnd: 'TRASHED_WITH_PLAY_AREA',
        status: 'PROVISIONAL',
        source: 'BP05-017/024/038/045/052/059/066 のカード画像のテキストからの解釈。公式ページ・FAQは未確認。',
      },
      // Phase K（テキスト登録済みで効果未登録だった基本カードの一括登録）で決めた解釈。
      phaseKPolicy: {
        // 〖アタックする〗の手札破棄・デッキ公開（大黒柱・CLUTCH!!!・神速フリック・テラーエンゲージ等）は、
        // アタックカードのコストを支払う前・ダメージを決める前に処理する。PPが足りない場合は何もせずエラーにする。
        preDamageAttackActionTiming: 'BEFORE_COST_PAYMENT_AND_DAMAGE',
        // テラーエンゲージの「PPを1回復する」は、このカードのコストを支払った後に適用する
        preDamagePpRecoverTiming: 'AFTER_COST_PAYMENT',
        // 公開してトラッシュに置いたカード・捨てたカードはいずれも裏向き（手札からの破棄と同じ扱い）
        revealedThenTrashedOrientation: 'FACE_DOWN',
        // 対戦相手のデッキが0枚のとき、神速フリック/天衣無縫は何もしない（トラッシュからの再構築はしない）
        millOpponentEmptyDeck: 'NO_OP',
        // 運命のルーレット：宣言の選択が無いときはアタックカードを宣言する
        declareCardTypeDefault: 'ATTACK',
        // アタックカード自身の〖プレイ時〗（カウンターブロー）は、アタックのダメージ処理の直後・アタック後の効果より先に解決
        attackCardOnPlayTiming: 'AFTER_DAMAGE_BEFORE_AFTER_ATTACK',
        // アタックカード自身の〖アタック強化〗（マウントタックル）は、そのアタックの後の「次のアタック」に積む
        attackCardOwnBoostAppliesTo: 'NEXT_ATTACK_AFTER_THIS_ONE',
        // 壁ジャンプ等の「同名が1枚あるならコストを支払わずにプレイしてもよい」は、条件を満たせば常に支払わない（得なので自動）
        freeIfOneSameNameInPlay: 'AUTO_FREE',
        // 短気な爆弾魔「このターン、手札を1枚以上捨てているなら」は、このターンのカード効果による破棄の記録で判定する
        discardedThisTurnBasis: 'CARD_EFFECT_DISCARDS_THIS_TURN',
        // バックステージパス「アタッカーがカードを装備しているなら、さらに+20」は、次のアタックを宣言した時点で判定する
        conditionalBoostEvaluation: 'AT_ATTACK_DECLARATION',
        status: 'PROVISIONAL',
        source: 'data/source/all-cards.json の各カードテキストからの解釈。公式FAQ等は未確認。',
      },
    };
  }

  return { createDefaultRuleConfig: createDefaultRuleConfig };
}));
