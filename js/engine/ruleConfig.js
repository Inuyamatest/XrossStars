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
    };
  }

  return { createDefaultRuleConfig: createDefaultRuleConfig };
}));
