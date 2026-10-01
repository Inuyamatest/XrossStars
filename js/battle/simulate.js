/* Xross Stars 対戦画面 — CPU同士の連続対戦（デッキの勝率を測る「デッキ検証」）
 *
 * CPU同士で1試合を最後まで進め、勝者を返す。対戦画面と同じエンジン・CPUを使い、
 * 選択（対象・してもよい等）はすべてCPUの答え（cpu.js answerQuestion）で行う。
 * ブラウザでは js/battle/simworker.js（Web Worker）から呼び、画面を固めずに何十戦も回す。
 *
 * playMatch({ seed, deckA, deckB, levelA, levelB, mode, firstPlayer, cardIndex })
 *   deck: { leaders: [4], cards: [{cardNumber, count}] または [cardNumber...], tactics: [5] }
 *   firstPlayer: 'playerA' | 'playerB' | 省略（シードから決める）
 *   戻り値: { winner: 'playerA'|'playerB'|'DRAW'|null, turns, firstPlayer }
 * 同じシードなら同じ結果になる（試合中は Math.random をシード付きの乱数に置き換える）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('../engine/match.js'),
      require('../engine/effectResolver.js'),
      require('../engine/resolutionStack.js'),
      require('../engine/deck.js'),
      require('./choices.js'),
      require('./cpu.js')
    );
  } else {
    root.XS_BATTLE_SIMULATE = factory(root.XS_ENGINE_MATCH, root.XS_ENGINE_EFFECT_RESOLVER, root.XS_ENGINE_RESOLUTION_STACK, root.XS_ENGINE_DECK, root.XS_BATTLE_CHOICES, root.XS_BATTLE_CPU);
  }
}(typeof self !== 'undefined' ? self : this, function (Match, Resolver, ResolutionStack, Deck, Choices, Cpu) {
  'use strict';

  var PP_TICKET_CARD_ID = 'ST01-024';
  var MAX_TURNS = 300; // 決着がつかない試合（両者が何もできない等）の打ち切り
  var MAX_STEPS_PER_TURN = 30;

  function expandCards(deck) {
    var cards = deck.cards || [];
    if (typeof cards[0] === 'string') return cards.slice();
    var ids = [];
    cards.forEach(function (e) { for (var i = 0; i < e.count; i++) ids.push(e.cardNumber); });
    return ids;
  }

  function playMatch(opts) {
    var orig = Math.random;
    var rnd = Choices.seededRandom(opts.seed >>> 0);
    Math.random = rnd;
    try {
      var cardIndex = opts.cardIndex;
      var first = opts.firstPlayer || (rnd() < 0.5 ? 'playerA' : 'playerB');
      var levels = { playerA: opts.levelA || 'HARD', playerB: opts.levelB || 'HARD' };
      var state = Match.createMatch({
        matchId: 'sim-' + opts.seed, mode: opts.mode || 'STANDARD', firstPlayer: first, ppTicketCardId: PP_TICKET_CARD_ID, deferRoundSetup: true,
        playerA: { leaderCardIds: opts.deckA.leaders.slice(0, 4), deckCardIds: expandCards(opts.deckA), tacticsDeckCardIds: (opts.deckA.tactics || []).slice() },
        playerB: { leaderCardIds: opts.deckB.leaders.slice(0, 4), deckCardIds: expandCards(opts.deckB), tacticsDeckCardIds: (opts.deckB.tactics || []).slice() },
      });
      var ask = function (q) { return Cpu.answerQuestion(q, state, q.chooser || state.turn.activePlayer, cardIndex); };
      var cb = Choices.makeCallbacks(ask, { getActivePlayerId: function () { return state.turn.activePlayer; }, getResolvingEffect: Resolver.getResolvingEffect });
      var startTurn = function () {
        Resolver.runStartPhaseWithEffects(state, cardIndex, cb);
        ResolutionStack.resolveAll(state.resolutionStack, state);
      };
      var setupRound = function () {
        Match.runRoundSetup(state, Choices.makeTacticsChooser(ask));
        startTurn();
      };
      // デッキ切れのタクティクスは、対戦画面と同じく対戦相手（CPU）が裏向きのまま選ぶ
      Deck.setTacticsConsumeChooser(Choices.makeDeckOutTacticsChooser(ask));

      setupRound();
      var turns = 0;
      while (state.match.status !== 'FINISHED' && turns < MAX_TURNS) {
        turns++;
        var pid = state.turn.activePlayer;
        var excluded = {};
        var roundEnded = false;
        for (var step = 0; step < MAX_STEPS_PER_TURN && state.match.status !== 'FINISHED'; step++) {
          var act = Cpu.decideAction(state, pid, cardIndex, { level: levels[pid], random: rnd }, excluded);
          if (act.type === 'END') break;
          try {
            if (act.type === 'ATTACK') Resolver.playAttackCardWithEffects(state, pid, act.instanceId, Object.assign({}, act.options, cb), cardIndex);
            else if (act.type === 'MEMORIA') Resolver.playMemoriaCardWithEffects(state, pid, act.instanceId, Object.assign({}, cb), cardIndex);
            else Resolver.playTacticsCardWithEffects(state, pid, act.instanceId, Object.assign({ subType: act.subType, equipLeaderIndex: act.equipLeaderIndex }, cb), cardIndex);
          } catch (e) {
            excluded[act.instanceId] = true;
            continue;
          }
          if (state.match.status === 'FINISHED') break;
          var r = Resolver.processRoundEndWithEffects(state);
          if (r.roundEnded) {
            if (!r.matchEnded) setupRound();
            roundEnded = true;
            break;
          }
        }
        if (roundEnded || state.match.status === 'FINISHED') continue;
        Resolver.runEndPhaseWithEffects(state, Choices.makeHandLimitChooser(ask, pid));
        if (state.match.status === 'FINISHED') break;
        Resolver.endTurnAndSwitchWithEffects(state);
        startTurn();
      }
      return { winner: state.match.status === 'FINISHED' ? state.match.winner : null, turns: turns, firstPlayer: first };
    } finally {
      Deck.setTacticsConsumeChooser(null);
      Math.random = orig;
    }
  }

  // n試合分の集計（先攻・後攻は交互に入れ替える）。onProgress(done, summary) を1試合ごとに呼ぶ
  function newSummary() { return { games: 0, winsA: 0, winsB: 0, draws: 0, firstA: { games: 0, winsA: 0 }, firstB: { games: 0, winsA: 0 }, turns: 0 }; }
  function addResult(sum, r) {
    sum.games++;
    sum.turns += r.turns;
    if (r.winner === 'playerA') sum.winsA++;
    else if (r.winner === 'playerB') sum.winsB++;
    else sum.draws++;
    var bucket = r.firstPlayer === 'playerA' ? sum.firstA : sum.firstB;
    bucket.games++;
    if (r.winner === 'playerA') bucket.winsA++;
    return sum;
  }

  return { playMatch: playMatch, expandCards: expandCards, newSummary: newSummary, addResult: addResult };
}));
