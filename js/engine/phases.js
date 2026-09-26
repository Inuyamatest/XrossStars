/* Xross Stars ゲームエンジン — Phase State Machine / メインフェイズの行動
 *
 * 根拠: docs/xross-stars-game-spec.md 5〜8章 / docs/game-engine-architecture.md 2章
 *
 * PHASE:
 *   MATCH_SETUP -> ROUND_SETUP -> START_PHASE -> MAIN_PHASE -> END_PHASE
 *   -> (相手番 START_PHASE) ... -> ROUND_END -> (ROUND_SETUP | MATCH_END)
 *
 * 注意（設計上の割り切り。カード効果本体は未実装）:
 *   タクティクスカードの「消費」/「装備」の区別は、現行の data/cards.json に
 *   構造化フィールドとして存在しない（カードテキストの自動解析はしない方針のため）。
 *   そのため playTacticsCard() は subType を呼び出し側から明示的に受け取る。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('./gameState.js'),
      require('./events.js'),
      require('./deck.js'),
      require('./combat.js')
    );
  } else {
    root.XS_ENGINE_PHASES = factory(root.XS_ENGINE_STATE, root.XS_ENGINE_EVENTS, root.XS_ENGINE_DECK, root.XS_ENGINE_COMBAT);
  }
}(typeof self !== 'undefined' ? self : this, function (GameState, Events, Deck, Combat) {
  'use strict';

  var PHASES = {
    MATCH_SETUP: 'MATCH_SETUP',
    ROUND_SETUP: 'ROUND_SETUP',
    START_PHASE: 'START_PHASE',
    MAIN_PHASE: 'MAIN_PHASE',
    END_PHASE: 'END_PHASE',
    ROUND_END: 'ROUND_END',
    MATCH_END: 'MATCH_END',
  };

  function isFirstTurnOfRoundForFirstPlayer(state) {
    return state.turn.turnNumber === 1 && state.turn.activePlayer === state.match.firstPlayerThisRound;
  }

  // spec 15章（⚠️未確認）: RuleConfig経由でのみ判定する。ハードコードしない。
  function canPlayTactics(state) {
    var rule = state.ruleConfig.firstPlayerTacticsRestriction;
    if (state.turn.tacticsPlayedThisTurn) return false; // 1ターン1枚（spec確定済み）
    if (state.match.mode === 'QUICK' && !rule.appliesInQuickMatch) return true;
    if (rule.scope === 'MATCH_START_ONLY') {
      return !(state.match.roundNumber === 1 && isFirstTurnOfRoundForFirstPlayer(state));
    }
    // 'PER_ROUND'（デフォルト）
    return !isFirstTurnOfRoundForFirstPlayer(state);
  }

  function payPP(player, cost) {
    var available = player.ppCards.max - player.ppCards.tapped;
    if (available < cost) return false;
    player.ppCards.tapped += cost;
    return true;
  }

  // data/source/all-cards.json由来のcostがnull（公式ページ未確認等で未確定）のカードを
  // 「card.cost || 0」のように扱うと、コスト不明カードが常にコスト0としてプレイされてしまい、
  // PPをほとんど消費せずに何枚も連続プレイできてしまう（実際に対戦ログで確認された不具合）。
  // コスト未確定のカードは「プレイできない」ものとして明確にエラーにする（推測で0扱いしない）。
  function requireKnownCost(card) {
    if (typeof card.cost !== 'number') {
      throw new Error('このカードはコストが未確定のためプレイできません（カードデータ未整備）: ' + card.cardNumber + ' ' + card.name);
    }
    return card.cost;
  }

  // ---- START_PHASE（spec 6章：①PP全回復 ②1枚ドロー）----
  function runStartPhase(state) {
    state.turn.phase = PHASES.START_PHASE;
    Events.logEvent(state, 'TURN_STARTED', { playerId: state.turn.activePlayer, turnNumber: state.turn.turnNumber });
    var player = state.players[state.turn.activePlayer];

    player.ppCards.tapped = 0;
    Events.logEvent(state, 'START_PHASE_PP_RECOVERED', { playerId: state.turn.activePlayer });

    Deck.drawCard(state, state.turn.activePlayer);

    // 「ターン開始時効果」は⏳未確認のためデフォルトでは何もしない。将来のためのHookのみ用意する。
    if (state.ruleConfig.turnStartEffectsEnabled) {
      // 🧩 将来実装用フック。現時点では中身なし（PROVISIONAL）。
    }

    state.turn.tacticsPlayedThisTurn = false;
    state.turn.phase = PHASES.MAIN_PHASE;
    Events.logEvent(state, 'MAIN_PHASE_STARTED', { playerId: state.turn.activePlayer });
    return state;
  }

  // ---- MAIN_PHASE：アタック / メモリア / タクティクス ----

  function findInHand(player, instanceId) {
    var idx = player.hand.findIndex(function (c) { return c.instanceId === instanceId; });
    if (idx < 0) throw new Error('指定されたカードは手札にありません: ' + instanceId);
    return idx;
  }

  // options: { attackerLeaderIndex, targetPlayerId, targetLeaderIndex, afterAttackEffect?, freePlay? }
  // freePlay: true のときはPPを支払わない（カード効果による「コストを支払わずにプレイする」。例：頂点捕食者）
  function playAttackCard(state, playerId, cardInstanceId, options, cardIndex) {
    var player = state.players[playerId];
    var idx = findInHand(player, cardInstanceId);
    var card = GameState.getCardData(cardIndex, player.hand[idx].cardId);
    if (!(options && options.freePlay)) {
      var cost = requireKnownCost(card);
      if (!payPP(player, cost)) {
        throw new Error('PPが不足しています（必要:' + cost + '）');
      }
    }
    var instance = player.hand.splice(idx, 1)[0];
    player.playArea.push({ card: instance, order: player.playArea.length, pendingTriggers: [] });
    Events.logEvent(state, 'CARD_PLAYED', { playerId: playerId, cardId: instance.cardId, kind: 'ATTACK' });

    var damage = options.attackCardBaseDamage;
    if (damage == null) {
      throw new Error('attackCardBaseDamage が指定されていません（カード効果未実装のため呼び出し側が数値を渡す必要があります）');
    }

    return Combat.declareAttack(state, {
      attackerPlayerId: playerId,
      attackerLeaderIndex: options.attackerLeaderIndex,
      targetPlayerId: options.targetPlayerId,
      targetLeaderIndex: options.targetLeaderIndex,
      attackCardBaseDamage: damage,
      afterAttackEffect: options.afterAttackEffect,
    }, cardIndex);
  }

  // options: { attackBoostAmount?, freePlay? }（freePlay: true のときはPPを支払わない）
  function playMemoriaCard(state, playerId, cardInstanceId, options, cardIndex) {
    var player = state.players[playerId];
    var idx = findInHand(player, cardInstanceId);
    var card = GameState.getCardData(cardIndex, player.hand[idx].cardId);
    if (!(options && options.freePlay)) {
      var cost = requireKnownCost(card);
      if (!payPP(player, cost)) {
        throw new Error('PPが不足しています（必要:' + cost + '）');
      }
    }
    var instance = player.hand.splice(idx, 1)[0];
    player.playArea.push({ card: instance, order: player.playArea.length, pendingTriggers: [] });
    Events.logEvent(state, 'MEMORIA_PLAYED', { playerId: playerId, cardId: instance.cardId });

    if (options && options.attackBoostAmount) {
      Combat.queueAttackBoost(state, playerId, options.attackBoostAmount, instance.instanceId);
    }
    return state;
  }

  // options: { subType: 'CONSUMABLE' | 'EQUIPMENT', equipLeaderIndex? (装備先, EQUIPMENT時必須) }
  function playTacticsCard(state, playerId, cardInstanceId, options, cardIndex) {
    if (!canPlayTactics(state)) {
      throw new Error('現在このターンはタクティクスカードをプレイできません（1ターン1枚 or RuleConfigの先攻1ターン目制限）');
    }
    var player = state.players[playerId];
    var areaIdx = player.tacticsArea.findIndex(function (t) { return t.card.instanceId === cardInstanceId; });
    if (areaIdx < 0) throw new Error('指定されたタクティクスカードはタクティクスエリアにありません: ' + cardInstanceId);

    var entry = player.tacticsArea[areaIdx];
    var card = GameState.getCardData(cardIndex, entry.card.cardId);
    var cost = requireKnownCost(card);
    if (!payPP(player, cost)) {
      throw new Error('PPが不足しています（必要:' + cost + '）');
    }

    player.tacticsArea.splice(areaIdx, 1);
    state.turn.tacticsPlayedThisTurn = true;
    Events.logEvent(state, 'TACTICS_PLAYED', { playerId: playerId, cardId: entry.card.cardId, subType: options.subType });

    if (options.subType === 'EQUIPMENT') {
      if (options.equipLeaderIndex == null) throw new Error('装備タクティクスカードには equipLeaderIndex が必要です');
      player.leaders[options.equipLeaderIndex].equipment.push(entry.card);
      Events.logEvent(state, 'EQUIPMENT_ATTACHED', { playerId: playerId, leaderIndex: options.equipLeaderIndex, cardId: entry.card.cardId });
    } else {
      // 消費タクティクスカードは表向きにプレイエリアへ（終了フェイズでも表向きのままトラッシュ、spec 15章）
      player.playArea.push({ card: entry.card, order: player.playArea.length, pendingTriggers: [], isTactics: true });
    }
    return state;
  }

  // ---- END_PHASE（spec 8章：①プレイエリア→トラッシュ ②残PP分ドロー ③手札7枚制限）----
  // handDiscardChooserFn(hand, countToDiscard) => instanceId[]  (省略時は末尾から自動選択。PROVISIONAL、spec 8章参照)
  function clearPendingAttackEffects(player) {
    player.pendingAttackBoost = 0;
    player.pendingBoostSources = [];
    player.pendingAttackTimeBoosts = [];
    player.pendingAfterAttackEffects = [];
  }

  function runEndPhase(state, handDiscardChooserFn) {
    state.turn.phase = PHASES.END_PHASE;
    Events.logEvent(state, 'END_PHASE_STARTED', { playerId: state.turn.activePlayer });
    var player = state.players[state.turn.activePlayer];

    // ① プレイエリアのカードをトラッシュへ（タクティクスのみ表向き、他は裏向き）
    var trashedCount = player.playArea.length;
    player.playArea.forEach(function (entry) {
      player.trash.push({ card: entry.card, faceUp: !!entry.isTactics });
    });
    player.playArea = [];
    Events.logEvent(state, 'CARDS_TRASHED', { playerId: state.turn.activePlayer, count: trashedCount });
    // 使われなかった「次のアタック」への強化・アタック後効果は、元のメモリア等がトラッシュに行くので消える
    // （PROVISIONAL: ruleConfig.pendingAttackEffectsExpiryPolicy。次のターン・次のラウンドへ持ち越さない）
    clearPendingAttackEffects(player);

    // ② 余っているPP（縦向き＝未使用分）と同じ枚数をドロー
    var remainingPP = player.ppCards.max - player.ppCards.tapped;
    var drawn = Deck.drawCards(state, state.turn.activePlayer, remainingPP);
    Events.logEvent(state, 'END_PHASE_DRAW', { playerId: state.turn.activePlayer, count: drawn.length });

    // ③ 手札7枚制限（捨てるカードの選び方はPROVISIONAL。spec 8章参照）
    var HAND_LIMIT = 7;
    if (player.hand.length > HAND_LIMIT) {
      var overflow = player.hand.length - HAND_LIMIT;
      var toDiscardIds;
      if (typeof handDiscardChooserFn === 'function') {
        toDiscardIds = handDiscardChooserFn(player.hand.slice(), overflow);
      } else {
        toDiscardIds = player.hand.slice(-overflow).map(function (c) { return c.instanceId; });
      }
      toDiscardIds.forEach(function (instanceId) {
        var idx = player.hand.findIndex(function (c) { return c.instanceId === instanceId; });
        if (idx >= 0) {
          var card = player.hand.splice(idx, 1)[0];
          player.trash.push({ card: card, faceUp: false });
        }
      });
      Events.logEvent(state, 'HAND_DISCARDED_OVER_LIMIT', { playerId: state.turn.activePlayer, count: toDiscardIds.length });
    }

    Events.logEvent(state, 'TURN_ENDED', { playerId: state.turn.activePlayer });
    return state;
  }

  function endTurnAndSwitch(state) {
    state.turn.activePlayer = GameState.getOpponentId(state.turn.activePlayer);
    state.turn.turnNumber += 1;
    return state;
  }

  return {
    PHASES: PHASES,
    canPlayTactics: canPlayTactics,
    isFirstTurnOfRoundForFirstPlayer: isFirstTurnOfRoundForFirstPlayer,
    payPP: payPP,
    requireKnownCost: requireKnownCost,
    runStartPhase: runStartPhase,
    playAttackCard: playAttackCard,
    playMemoriaCard: playMemoriaCard,
    playTacticsCard: playTacticsCard,
    runEndPhase: runEndPhase,
    endTurnAndSwitch: endTurnAndSwitch,
  };
}));
