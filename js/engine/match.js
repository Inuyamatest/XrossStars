/* Xross Stars ゲームエンジン — Match / Round オーケストレーション
 *
 * 根拠: docs/xross-stars-game-spec.md 1〜4章, 12-3章 / docs/game-engine-architecture.md 2, 9章
 *
 * createMatch()      … MATCH_SETUP（spec 4章の手順①〜⑧のうち、ゲーム状態として表現できる部分）
 * setupNextRound()   … 次ラウンドの準備（spec 2-3章）
 * resetForNextRound()… ラウンド終了処理（spec 2-2章）
 * checkRoundWinner() … ラウンド勝敗判定（spec 2-1章）。同時全滅はRuleConfig.lossConditionScope依存（⚠️）
 * checkMatchWinner() … マッチ勝敗判定（spec 1-1章：STANDARD=2勝, QUICK=1勝）
 * processRoundEnd()  … 上記を束ね、ResolutionStackを空にしてから判定する（FAQ Q5対応）
 *
 * 注意：ジャンケンによる1ラウンド目の先攻決定はゲームルールではなく「誰が決めるか」の手続きの話のため、
 * createMatch() では firstPlayer を呼び出し側が指定する（ジャンケンの実装自体はUI/呼び出し側の責務）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('./gameState.js'),
      require('./events.js'),
      require('./deck.js'),
      require('./resolutionStack.js'),
      require('./ruleConfig.js')
    );
  } else {
    root.XS_ENGINE_MATCH = factory(
      root.XS_ENGINE_STATE, root.XS_ENGINE_EVENTS, root.XS_ENGINE_DECK,
      root.XS_ENGINE_RESOLUTION_STACK, root.XS_ENGINE_RULE_CONFIG
    );
  }
}(typeof self !== 'undefined' ? self : this, function (GameState, Events, Deck, ResolutionStack, RuleConfig) {
  'use strict';

  // config: {
  //   matchId, mode: 'STANDARD'|'QUICK', firstPlayer: 'playerA'|'playerB',
  //   playerA: { leaderCardIds[4], deckCardIds[50], tacticsDeckCardIds[5] },
  //   playerB: { 同上 },
  //   ppTicketCardId: string,  // PPチケットのcardId（カードマスタ側の値。カードJSONは変更しない）
  //   ruleConfig?  // 省略時はデフォルト（すべてPROVISIONAL）
  //   deferRoundSetup?: boolean
  //     true: 各ラウンドの「タクティクスを置く→4枚ドロー」を行わず、turn.phase='ROUND_SETUP' で止める。
  //           呼び出し側が runRoundSetup(state, chooseTactics) でプレイヤーに選ばせてから手札を配る（対戦画面用）。
  //     省略/false: 従来どおりタクティクスをランダムに選んで、そのまま手札を配る（テスト・シミュレーション用）
  // }
  function createMatch(config) {
    var ruleConfig = config.ruleConfig || RuleConfig.createDefaultRuleConfig();
    var state = GameState.createGameState({
      matchId: config.matchId,
      mode: config.mode || 'STANDARD',
      firstPlayer: config.firstPlayer,
      ruleConfig: ruleConfig,
      playerA: Object.assign({ playerId: 'playerA' }, config.playerA, { hasPpTicket: config.firstPlayer !== 'playerA' }),
      playerB: Object.assign({ playerId: 'playerB' }, config.playerB, { hasPpTicket: config.firstPlayer !== 'playerB' }),
    });

    Events.logEvent(state, 'GAME_STARTED', { matchId: state.match.matchId, mode: state.match.mode });
    if (!config.ppTicketCardId && state.match.mode !== 'QUICK') throw new Error('config.ppTicketCardId が指定されていません');
    state.match.ppTicketCardId = config.ppTicketCardId || null;
    state.match.deferRoundSetup = !!config.deferRoundSetup;

    if (state.match.deferRoundSetup) {
      Deck.shuffle(state.players.playerA.deck);
      Deck.shuffle(state.players.playerB.deck);
      state.turn.phase = 'ROUND_SETUP';
      return state;
    }
    ['playerA', 'playerB'].forEach(function (pid) {
      Deck.shuffle(state.players[pid].deck);
      placeRoundTactics(state, pid, randomTacticsChooser);
    });
    dealRound(state);
    return state;
  }

  function randomTacticsChooser(state, playerId, candidates) {
    return Math.floor(Math.random() * candidates.length);
  }

  function takeTactics(state, playerId, chooseTactics) {
    var player = state.players[playerId];
    if (player.tacticsDeck.length === 0) return;
    var idx = player.tacticsDeck.length === 1 ? 0 : chooseTactics(state, playerId, player.tacticsDeck.slice());
    if (!(idx >= 0 && idx < player.tacticsDeck.length)) idx = 0;
    var card = player.tacticsDeck.splice(idx, 1)[0];
    player.tacticsArea.push({ card: card, faceUp: false });
  }

  // 自分のタクティクスデッキから1枚選び、タクティクスエリアに裏向きで置く（spec 4章⑥・2-3章）
  // chooseTactics(state, playerId, candidates) => index（candidatesはタクティクスデッキの写し）
  function placeRoundTactics(state, playerId, chooseTactics) {
    var player = state.players[playerId];
    takeTactics(state, playerId, chooseTactics);
    if (state.match.roundNumber !== 1 || !player.hasPpTicket) return;
    // 後攻プレイヤーの扱い（spec 4章⑦, 22章）：
    //   STANDARD: 1ラウンド目のタクティクスカードを選択した後、PPチケットを表向きにタクティクスエリアへ
    //   QUICK   : PPチケットの代わりに2枚目のタクティクスカードを置く（PPチケットは使用しない）
    if (state.match.mode === 'QUICK') {
      takeTactics(state, playerId, chooseTactics);
    } else {
      player.tacticsArea.push({ card: GameState.createCardInstance(state.match.ppTicketCardId), faceUp: true });
    }
  }

  // タクティクスを置いた後：お互い4枚ドローして、そのラウンドの1ターン目を始められる状態にする（spec 4章⑧・2-3章）
  function dealRound(state) {
    var round = state.match.roundNumber;
    if (round === 1) Events.logEvent(state, 'ROUND_STARTED', { roundNumber: 1 });
    Deck.drawCards(state, 'playerA', 4);
    Deck.drawCards(state, 'playerB', 4);
    state.turn.turnNumber = 1;
    state.turn.activePlayer = state.match.firstPlayerThisRound;
    state.turn.phase = 'START_PHASE'; // 呼び出し側が Phases.runStartPhase(state) を呼ぶ前提
    if (round === 1) {
      Events.logEvent(state, 'MATCH_SETUP_COMPLETED', {});
    } else {
      Events.logEvent(state, 'ROUND_SETUP_COMPLETED', { roundNumber: round });
      Events.logEvent(state, 'ROUND_STARTED', { roundNumber: round });
    }
  }

  // deferRoundSetup のとき、turn.phase==='ROUND_SETUP' の盤面で呼ぶ。
  // 両プレイヤーがタクティクスを選んで置いてから（先攻→後攻の順に質問）、手札を配る。
  // PROVISIONAL: 選ぶ順は ruleConfig.tacticsSetupPolicy 参照（お互い裏向きに置くので順番は結果に影響しない）
  function runRoundSetup(state, chooseTactics) {
    if (state.turn.phase !== 'ROUND_SETUP') throw new Error('タクティクスを置く場面ではありません');
    var first = state.match.firstPlayerThisRound;
    [first, GameState.getOpponentId(first)].forEach(function (pid) {
      placeRoundTactics(state, pid, chooseTactics || randomTacticsChooser);
    });
    dealRound(state);
  }

  function allLeadersDown(player) {
    return player.leaders.every(function (l) { return l.isDown; });
  }

  // spec 3-2章：単一リーダーの撃破判定（ダウン済みかどうか）
  function checkLeaderDefeat(leader) {
    return leader.isDown;
  }

  // spec 2-1章：対戦相手のリーダーを全員ダウンさせたらラウンド勝利
  // 戻り値: null（継続） | { simultaneous: true }（⚠️FAQ Q11） | { winner, loser }
  function checkRoundWinner(state) {
    var aDown = allLeadersDown(state.players.playerA);
    var bDown = allLeadersDown(state.players.playerB);
    if (!aDown && !bDown) return null;
    if (aDown && bDown) return { simultaneous: true };
    return aDown ? { winner: 'playerB', loser: 'playerA' } : { winner: 'playerA', loser: 'playerB' };
  }

  // spec 1-1章：STANDARDは2ラウンド先取、QUICKは1ラウンド先取
  function checkMatchWinner(state) {
    var threshold = state.match.mode === 'QUICK' ? 1 : 2;
    if (state.match.roundWins.playerA >= threshold) return 'playerA';
    if (state.match.roundWins.playerB >= threshold) return 'playerB';
    return null;
  }

  // spec 2-2章：①プレイエリア→トラッシュ ②手札→トラッシュ ③ダメージ全除去 ④ダウン復活
  // 覚醒状態・装備・トラッシュの中身・デッキのシャッフルの要否はここでは変更しない（spec確定事項）
  function resetForNextRound(state) {
    ['playerA', 'playerB'].forEach(function (pid) {
      var player = state.players[pid];
      player.playArea.forEach(function (entry) {
        player.trash.push({ card: entry.card, faceUp: !!entry.isTactics });
      });
      player.playArea = [];
      player.hand.forEach(function (card) { player.trash.push({ card: card, faceUp: false }); });
      player.hand = [];
      player.leaders.forEach(function (l) { l.damage = 0; });
      player.leaders.forEach(function (l) { l.isDown = false; });
    });
  }

  // spec 2-3章：次ラウンドの準備
  function setupNextRound(state) {
    state.match.roundNumber += 1;
    state.match.firstPlayerThisRound = state.match.previousRoundLoser;

    ['playerA', 'playerB'].forEach(function (pid) {
      state.players[pid].ppCards.max += 1; // ラウンド2=4, ラウンド3=5（spec 9章）
    });

    if (state.match.deferRoundSetup) {
      // タクティクスの選択と手札の配布は runRoundSetup で（呼び出し側がプレイヤーに選ばせる）
      state.turn.turnNumber = 0;
      state.turn.activePlayer = state.match.firstPlayerThisRound;
      state.turn.phase = 'ROUND_SETUP';
      return;
    }
    ['playerA', 'playerB'].forEach(function (pid) { placeRoundTactics(state, pid, randomTacticsChooser); });
    dealRound(state);
  }

  // ラウンド終了・マッチ終了までを一括で処理する。
  // 呼び出しタイミング: 攻撃処理などでリーダーがダウンした直後（spec 12-3章：
  // 「プレイエリアの未実行効果→覚醒判定→ラウンド終了処理」の順を守るため、
  // 先にResolutionStackを空にしてから判定する）
  function processRoundEnd(state, chooseIndexFn) {
    ResolutionStack.resolveAll(state.resolutionStack, state, chooseIndexFn);

    var result = checkRoundWinner(state);
    if (!result) return { roundEnded: false, matchEnded: false };

    if (result.simultaneous) {
      Events.logEvent(state, 'SIMULTANEOUS_LOSS', { scope: state.ruleConfig.lossConditionScope.scope });
      if (state.ruleConfig.lossConditionScope.scope === 'MATCH') {
        state.match.status = 'FINISHED';
        state.match.winner = 'DRAW';
        state.turn.phase = 'MATCH_END';
        Events.logEvent(state, 'MATCH_ENDED', { winner: 'DRAW', reason: 'SIMULTANEOUS_LOSS' });
        return { roundEnded: true, matchEnded: true, simultaneous: true };
      }
      // 'ROUND'スコープ（デフォルト）：どちらのプレイヤーもこのラウンドの勝利は得られない
      resetForNextRound(state);
      Events.logEvent(state, 'ROUND_ENDED', { winner: null, simultaneous: true });
      // 🧩 未検討の縁辺ケース：ラウンド3で同時全滅した場合、規定の3ラウンドを超える
      // 「ラウンド4」に進んでしまう。この状況を公式資料は想定しておらず未確定のため、
      // ここではクラッシュさせない以上の対応はしていない（別途要確認）。
      setupNextRound(state);
      return { roundEnded: true, matchEnded: false, simultaneous: true };
    }

    state.match.roundWins[result.winner] += 1;
    state.match.previousRoundLoser = result.loser;
    Events.logEvent(state, 'ROUND_ENDED', { winner: result.winner, loser: result.loser });

    resetForNextRound(state);

    var matchWinner = checkMatchWinner(state);
    if (matchWinner) {
      state.match.status = 'FINISHED';
      state.match.winner = matchWinner;
      state.turn.phase = 'MATCH_END';
      Events.logEvent(state, 'MATCH_ENDED', { winner: matchWinner });
      return { roundEnded: true, matchEnded: true, winner: matchWinner };
    }

    setupNextRound(state);
    return { roundEnded: true, matchEnded: false };
  }

  return {
    createMatch: createMatch,
    checkLeaderDefeat: checkLeaderDefeat,
    checkRoundWinner: checkRoundWinner,
    checkMatchWinner: checkMatchWinner,
    resetForNextRound: resetForNextRound,
    setupNextRound: setupNextRound,
    runRoundSetup: runRoundSetup,
    processRoundEnd: processRoundEnd,
  };
}));
