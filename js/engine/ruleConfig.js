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
    };
  }

  return { createDefaultRuleConfig: createDefaultRuleConfig };
}));
