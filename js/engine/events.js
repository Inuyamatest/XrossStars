/* Xross Stars ゲームエンジン — Event定義
 *
 * 根拠: docs/game-engine-architecture.md 4章
 *
 * 重要な区別（型レベルで分類する）:
 *   OFFICIAL_TRIGGER_EVENTS … 公式プレイングマニュアルに「プレイ時」「アタックする」
 *     「アタック後」「アタック強化」「覚醒時」として明記されているTriggerに対応するもの
 *   IMPLEMENTATION_EVENTS … ログ・デバッグ・UI連携のために実装側が定義したイベント。
 *     公式ルール上それ専用のTrigger名が存在するわけではない
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.XS_ENGINE_EVENTS = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 公式Trigger相当（docs/xross-stars-game-spec.md 26章のTrigger分類と対応）
  var OFFICIAL_TRIGGER_EVENTS = {
    ON_PLAY: 'ON_PLAY',                 // 「プレイ時」 p.07, p.09, p.10
    ATTACK_DECLARED: 'ATTACK_DECLARED', // 「アタックする」 p.07, p.12
    ATTACK_BOOSTED: 'ATTACK_BOOSTED',   // 「アタック強化」 p.09, p.12
    AFTER_ATTACK: 'AFTER_ATTACK',       // 「アタック後」 p.07, p.12
    LEADER_AWAKENED: 'LEADER_AWAKENED', // 「覚醒時」 p.08
  };

  // implementation event（実装都合のログ・状態遷移通知。公式Trigger名ではない）
  var IMPLEMENTATION_EVENTS = {
    GAME_STARTED: 'GAME_STARTED',
    MATCH_SETUP_COMPLETED: 'MATCH_SETUP_COMPLETED',
    ROUND_STARTED: 'ROUND_STARTED',
    ROUND_SETUP_COMPLETED: 'ROUND_SETUP_COMPLETED',
    TURN_STARTED: 'TURN_STARTED',
    START_PHASE_PP_RECOVERED: 'START_PHASE_PP_RECOVERED',
    CARD_DRAWN: 'CARD_DRAWN',
    MAIN_PHASE_STARTED: 'MAIN_PHASE_STARTED',
    CARD_PLAYED: 'CARD_PLAYED',
    MEMORIA_PLAYED: 'MEMORIA_PLAYED',
    TACTICS_PLAYED: 'TACTICS_PLAYED',
    EQUIPMENT_ATTACHED: 'EQUIPMENT_ATTACHED',
    DAMAGE_CALCULATED: 'DAMAGE_CALCULATED',
    DAMAGE_DEALT: 'DAMAGE_DEALT',
    LEADER_DOWNED: 'LEADER_DOWNED',
    AFTER_ATTACK_EFFECTS_QUEUED: 'AFTER_ATTACK_EFFECTS_QUEUED',
    EFFECT_ORDER_CHOSEN: 'EFFECT_ORDER_CHOSEN',
    END_PHASE_STARTED: 'END_PHASE_STARTED',
    CARDS_TRASHED: 'CARDS_TRASHED',
    END_PHASE_DRAW: 'END_PHASE_DRAW',
    HAND_DISCARDED_OVER_LIMIT: 'HAND_DISCARDED_OVER_LIMIT',
    DECK_EMPTY: 'DECK_EMPTY',
    DECK_RESHUFFLED_FROM_TRASH: 'DECK_RESHUFFLED_FROM_TRASH',
    TACTICS_CONSUMED: 'TACTICS_CONSUMED',
    DECK_OUT_LOSS: 'DECK_OUT_LOSS',
    TURN_ENDED: 'TURN_ENDED',
    ROUND_ENDED: 'ROUND_ENDED',
    SIMULTANEOUS_LOSS: 'SIMULTANEOUS_LOSS',
    MATCH_ENDED: 'MATCH_ENDED',
  };

  function isOfficialTriggerEvent(type) {
    return Object.prototype.hasOwnProperty.call(OFFICIAL_TRIGGER_EVENTS, type);
  }

  function isImplementationEvent(type) {
    return Object.prototype.hasOwnProperty.call(IMPLEMENTATION_EVENTS, type);
  }

  function logEvent(state, type, payload) {
    if (!isOfficialTriggerEvent(type) && !isImplementationEvent(type)) {
      throw new Error('Unknown event type (not registered as OFFICIAL_TRIGGER_EVENTS or IMPLEMENTATION_EVENTS): ' + type);
    }
    state.actionLog.push({
      type: type,
      kind: isOfficialTriggerEvent(type) ? 'OFFICIAL_TRIGGER' : 'IMPLEMENTATION',
      payload: payload || {},
      turnNumber: state.turn.turnNumber,
      roundNumber: state.match.roundNumber,
    });
    return state;
  }

  return {
    OFFICIAL_TRIGGER_EVENTS: OFFICIAL_TRIGGER_EVENTS,
    IMPLEMENTATION_EVENTS: IMPLEMENTATION_EVENTS,
    isOfficialTriggerEvent: isOfficialTriggerEvent,
    isImplementationEvent: isImplementationEvent,
    logEvent: logEvent,
  };
}));
