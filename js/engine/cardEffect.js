/* Xross Stars ゲームエンジン — Card Effect Engine（土台のみ。個別カード効果は未実装）
 *
 * 根拠: docs/xross-stars-game-spec.md 26〜27章 / docs/game-engine-architecture.md 10章
 *
 * ここで定義するのは「型・インターフェース」であり、data/cards.json の
 * 600枚以上のカードに対する実際の効果実装は今回一切行わない。
 * Rule Layer（js/engine/combat.js, phases.js, match.js）と Card Effect Layer（本ファイル）は
 * 意図的に分離している。カードJSONにゲームルールの手続きを埋め込まない方針を維持するため、
 * ここに置くのは「カード効果の共通の形」だけである。
 *
 * FAQ Q10（カードテキストがルールに優先する）への対応：
 *   Rule Layer は一般制約チェック関数を「ルールID付き」で提供する想定にし
 *   （例：'CANNOT_TARGET_DOWNED_LEADER'）、CardEffect.replacement.overridesRuleIds に
 *   そのIDが含まれる場合のみ、Card Effect Engineはそのチェックをスキップしてよい。
 *   エンジン側が「このカードは特別扱いだろう」と推測することはない。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.XS_ENGINE_CARD_EFFECT = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 公式カードテキストの実例から抽出したTrigger（spec 26章）。
  // 新しい概念をここに追加する場合、必ず実際のカードテキストの実例を根拠にすること。
  var TRIGGERS = {
    ON_PLAY: 'ON_PLAY',               // 「プレイ時」
    ON_ATTACK: 'ON_ATTACK',           // 「アタックする」
    AFTER_ATTACK: 'AFTER_ATTACK',     // 「アタック後」
    ATTACK_BOOST: 'ATTACK_BOOST',     // 「アタック強化」（次の1回のアタックのみ）
    ON_AWAKEN: 'ON_AWAKEN',           // 「覚醒時」
  };

  // CardEffect = {
  //   trigger: TRIGGERS の値,
  //   condition?: (state, context) => boolean,   // 省略時は常に成立。解決時に評価する（宣言時ではない）
  //   target?: (state, context) => Ref[],         // 省略時は対象を取らない。空配列ならNo-op
  //   cost?: { pp?: number, other?: string },      // PP以外の追加コスト（例：手札を1枚捨てる）は今回中身未実装
  //   action?: { type: string, amount?: number, [key: string]: any },  // DRAW/DAMAGE/HEAL/RECOVER_PP等。今回は型のみ
  //   modifier?: { type: string, amount: number }, // ダメージ加算等
  //   duration?: 'NEXT_ATTACK_ONLY' | 'THIS_TURN' | 'PERMANENT',  // 確認済みなのは NEXT_ATTACK_ONLY のみ
  //   replacement?: { overridesRuleIds: string[] }, // FAQ Q10対応
  // }
  function createCardEffect(spec) {
    if (!spec || !spec.trigger || !Object.prototype.hasOwnProperty.call(TRIGGERS, spec.trigger)) {
      throw new Error('CardEffect.trigger は TRIGGERS のいずれかである必要があります: ' + (spec && spec.trigger));
    }
    return {
      trigger: spec.trigger,
      condition: spec.condition || null,
      target: spec.target || null,
      cost: spec.cost || null,
      action: spec.action || null,
      modifier: spec.modifier || null,
      duration: spec.duration || null,
      replacement: spec.replacement || null,
    };
  }

  // Rule Layer が提供する「一般制約」のID。Card Effect側はこれをoverridesRuleIdsで指定して上書きできる。
  var RULE_IDS = {
    CANNOT_TARGET_DOWNED_LEADER: 'CANNOT_TARGET_DOWNED_LEADER', // spec 3-2章
  };

  function isRuleOverridden(cardEffect, ruleId) {
    return !!(cardEffect && cardEffect.replacement && cardEffect.replacement.overridesRuleIds
      && cardEffect.replacement.overridesRuleIds.indexOf(ruleId) >= 0);
  }

  // 対象が存在しない場合のNo-op判定（FAQ Q8）
  function resolveTargets(state, context, cardEffect) {
    if (typeof cardEffect.target !== 'function') return [];
    return cardEffect.target(state, context) || [];
  }

  // Conditionは解決時に評価する（宣言時に固定しない。FAQ Q6）
  function isConditionMet(state, context, cardEffect) {
    if (typeof cardEffect.condition !== 'function') return true;
    return !!cardEffect.condition(state, context);
  }

  return {
    TRIGGERS: TRIGGERS,
    RULE_IDS: RULE_IDS,
    createCardEffect: createCardEffect,
    isRuleOverridden: isRuleOverridden,
    resolveTargets: resolveTargets,
    isConditionMet: isConditionMet,
  };
}));
