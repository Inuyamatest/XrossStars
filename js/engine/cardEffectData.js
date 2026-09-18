/* Xross Stars ゲームエンジン — カード効果レジストリ（Phase B：代表カードのみ）
 *
 * data/cards.json / js/data/leaders.js は一切変更しない。
 * ここは「カードID → CardEffect[]」の対応表を手動で追加していく場所
 * （js/data/effects.js の設計思想を踏襲。カードテキストの自動解析はしない）。
 *
 * 実装済みは代表カードのみ（Phase B）。600枚以上を一気に実装しない方針。
 * 各エントリには、根拠となる実際のカードテキスト（data/cards.json / js/data/leaders.js より）を
 * コメントで残す。存在しない効果を推測して追加しない。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./cardEffect.js'));
  } else {
    root.XS_ENGINE_CARD_EFFECT_DATA = factory(root.XS_ENGINE_CARD_EFFECT);
  }
}(typeof self !== 'undefined' ? self : this, function (CardEffectCore) {
  'use strict';

  var E = CardEffectCore.createCardEffect;

  var REGISTRY = {

    // BP01-058 危機一髪（メモリア, 赤, cost1, buildRule: リーダー：Selly）
    // カードテキスト: "〖プレイ時〗カードを2枚引く。"
    'BP01-058': [
      E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 2 } }),
    ],

    // BP01-019 インパクトショット（アタック, 赤, cost2）
    // カードテキスト: "〖アタックする〗ダメージ+40。"
    // このカード自身のアタックダメージへの上乗せなので ATTACK_DAMAGE_BONUS として表現する
    // （combat.jsの declareAttack が要求する attackCardBaseDamage を、この値から導出する）
    'BP01-019': [
      E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 40 } }),
    ],

    // BP01-095 ライトシールド（タクティクス, 無色, cost0, 装備）
    // カードテキスト: "体力+30"（Playing Manual p.10 の装備例そのもの）
    'BP01-095': [
      E({ trigger: 'ON_PLAY', duration: 'PERMANENT', action: { type: 'EQUIP_HP_MODIFIER', amount: 30 } }),
    ],

    // BP01-021 ギャングの襲撃（アタック, 赤, cost1, buildRule: リーダー：小森めと）
    // カードテキスト: "〖アタックする〗 〖アタック後〗このアタックを受けたリーダーがダウンしているなら、カードを1枚引く。"
    'BP01-021': [
      E({
        trigger: 'AFTER_ATTACK',
        condition: function (state, ctx) {
          return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown;
        },
        action: { type: 'DRAW', amount: 1 },
      }),
    ],

    // BP01-053 超新星（メモリア, 赤, cost2, ACE）※公式FAQ Q6 の実例カード
    // カードテキスト: "〖アタック強化〗次のアタックのダメージ+30。
    //                  〖アタック後〗このアタックを受けたリーダーがダウンしているなら、PPを2回復し、カードを1枚引く。"
    'BP01-053': [
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } }),
      E({
        trigger: 'AFTER_ATTACK',
        condition: function (state, ctx) {
          return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown;
        },
        action: { type: 'MULTI', actions: [{ type: 'RECOVER_PP', amount: 2 }, { type: 'DRAW', amount: 1 }] },
      }),
    ],

    // BP01-018 エレガントドミネート（アタック, 赤, cost1, buildRule: 赤のリーダー3体以上）
    // カードテキスト: "〖アタックする〗 〖アタック後〗対戦相手の他のリーダー1体に20ダメージ。"
    'BP01-018': [
      E({
        trigger: 'AFTER_ATTACK',
        target: function (state, ctx) {
          var opponent = state.players[ctx.targetPlayerId];
          var candidates = [];
          opponent.leaders.forEach(function (l, i) {
            if (i !== ctx.targetLeaderIndex && !l.isDown) candidates.push({ playerId: ctx.targetPlayerId, leaderIndex: i });
          });
          if (candidates.length === 0) return []; // No-op（FAQ Q8）
          var pick = (ctx.chooseTarget ? ctx.chooseTarget(candidates, state) : 0);
          if (pick < 0 || pick >= candidates.length) pick = 0;
          return [candidates[pick]];
        },
        action: { type: 'DAMAGE', amount: 20 },
      }),
    ],

    // --- リーダー覚醒時効果（js/data/leaders.js のawakeningEffectに対応する代表例）---
    // Mondo（id: bp01-mondo, cardNumber: ST02-002）
    // awakeningEffect: "自分のリーダー1体を20回復する。"（Playing Manual p.08 の実例そのもの）
    'ST02-002': [
      E({
        trigger: 'ON_AWAKEN',
        target: function (state, ctx) {
          var self = state.players[ctx.ownerPlayerId];
          var candidates = [];
          self.leaders.forEach(function (l, i) { if (!l.isDown) candidates.push({ playerId: ctx.ownerPlayerId, leaderIndex: i }); });
          if (candidates.length === 0) return [];
          var pick = (ctx.chooseTarget ? ctx.chooseTarget(candidates, state) : candidates.findIndex(function (c) { return c.leaderIndex === ctx.attackerLeaderIndex; }));
          if (pick < 0) pick = 0;
          return [candidates[pick]];
        },
        action: { type: 'HEAL', amount: 20 },
      }),
    ],
  };

  function getEffectsForCard(cardId) {
    return REGISTRY[cardId] || [];
  }

  function hasEffects(cardId) {
    return !!REGISTRY[cardId] && REGISTRY[cardId].length > 0;
  }

  return {
    REGISTRY: REGISTRY,
    getEffectsForCard: getEffectsForCard,
    hasEffects: hasEffects,
  };
}));
