/* Xross Stars ゲームエンジン — GameState / PlayerState / LeaderState
 *
 * 根拠: docs/game-engine-architecture.md 1章
 * HP/ATKは card data + damage + awakened から都度導出し、二重管理しない
 * （docs/game-engine-architecture.md 1章の方針、既存の js/deckbuilder 設計とも一貫）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.XS_ENGINE_STATE = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var instanceCounter = 0;
  function nextInstanceId(cardId) {
    instanceCounter += 1;
    return cardId + '#' + instanceCounter;
  }

  function createCardInstance(cardId) {
    return { instanceId: nextInstanceId(cardId), cardId: cardId };
  }

  function createCardInstances(cardIds) {
    return (cardIds || []).map(createCardInstance);
  }

  function createLeaderState(cardId) {
    return {
      cardId: cardId,
      isDown: false,
      awakened: false,
      damage: 0,
      equipment: [],
    };
  }

  // player options: { playerId, leaderCardIds:[4], deckCardIds:[50], tacticsDeckCardIds:[5], hasPpTicket }
  function createPlayerState(options) {
    return {
      playerId: options.playerId,
      deck: createCardInstances(options.deckCardIds),
      hand: [],
      leaders: (options.leaderCardIds || []).map(createLeaderState),
      tacticsDeck: createCardInstances(options.tacticsDeckCardIds),
      tacticsArea: [], // { card: CardInstance, faceUp: boolean }
      playArea: [], // { card: CardInstance, order, pendingTriggers: [] }
      trash: [], // { card: CardInstance, faceUp: boolean }
      ppCards: { max: 3, tapped: 0 },
      hasPpTicket: !!options.hasPpTicket,
    };
  }

  // options: { matchId, mode: 'STANDARD'|'QUICK', playerA: {...}, playerB: {...}, firstPlayer }
  function createGameState(options) {
    return {
      match: {
        matchId: options.matchId || 'match-1',
        mode: options.mode || 'STANDARD',
        roundNumber: 1,
        roundWins: { playerA: 0, playerB: 0 },
        firstPlayerThisRound: options.firstPlayer,
        previousRoundLoser: null,
        status: 'IN_PROGRESS',
        winner: null,
      },
      turn: {
        turnNumber: 0, // ROUND_SETUP完了時に1になる
        activePlayer: options.firstPlayer,
        phase: 'MATCH_SETUP',
        tacticsPlayedThisTurn: false,
      },
      players: {
        playerA: createPlayerState(options.playerA),
        playerB: createPlayerState(options.playerB),
      },
      resolutionStack: { pending: [] },
      actionLog: [],
      ruleConfig: options.ruleConfig,
    };
  }

  function getOpponentId(playerId) {
    return playerId === 'playerA' ? 'playerB' : 'playerA';
  }

  function getCardData(cardIndex, cardId) {
    var card = cardIndex[cardId];
    if (!card) throw new Error('Unknown cardId (not found in card master): ' + cardId);
    return card;
  }

  // 装備（leader.equipment）による最大HP修正の合計を加算する。
  // ここではCard Effect Layer（cardEffectData.js等）には一切依存せず、装備時にそちらが
  // 各装備インスタンスへ書き込んでおいた数値（equip.hpModifier）を合算するだけにとどめる
  // （Rule LayerがCard Effect Layerを知らないという既存の層分離を壊さないため）。
  // 装備が無い・hpModifierが未設定の場合は従来どおり0加算となり、既存の挙動は変わらない。
  function getEquipmentHpModifierSum(leader) {
    return (leader.equipment || []).reduce(function (sum, equip) {
      return sum + (equip.hpModifier || 0);
    }, 0);
  }

  function getLeaderMaxHp(cardIndex, leader) {
    var card = getCardData(cardIndex, leader.cardId);
    var hp = leader.awakened ? card.awakenHp : card.hp;
    var base = hp == null ? 0 : hp;
    return base + getEquipmentHpModifierSum(leader);
  }

  function getLeaderCurrentHp(cardIndex, leader) {
    if (leader.isDown) return 0;
    return Math.max(0, getLeaderMaxHp(cardIndex, leader) - leader.damage);
  }

  // 装備によるATK修正の合計。getEquipmentHpModifierSumと完全に対称の設計
  // （装備時にCard Effect Layer側が equip.atkModifier へ書き込んだ数値を合算するだけ）。
  function getEquipmentAtkModifierSum(leader) {
    return (leader.equipment || []).reduce(function (sum, equip) {
      return sum + (equip.atkModifier || 0);
    }, 0);
  }

  function getLeaderCurrentAtk(cardIndex, leader) {
    var card = getCardData(cardIndex, leader.cardId);
    var atk = leader.awakened ? card.awakenAtk : card.atk;
    var base = atk == null ? 0 : atk;
    return base + getEquipmentAtkModifierSum(leader);
  }

  return {
    createCardInstance: createCardInstance,
    createCardInstances: createCardInstances,
    createLeaderState: createLeaderState,
    createPlayerState: createPlayerState,
    createGameState: createGameState,
    getOpponentId: getOpponentId,
    getCardData: getCardData,
    getEquipmentHpModifierSum: getEquipmentHpModifierSum,
    getEquipmentAtkModifierSum: getEquipmentAtkModifierSum,
    getLeaderMaxHp: getLeaderMaxHp,
    getLeaderCurrentHp: getLeaderCurrentHp,
    getLeaderCurrentAtk: getLeaderCurrentAtk,
  };
}));
