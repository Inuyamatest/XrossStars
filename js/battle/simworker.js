/* Xross Stars 対戦画面 — デッキ検証（CPU同士の連続対戦）を画面とは別のスレッドで回す Web Worker
 *
 * 受け取るメッセージ: { type: 'run', deckA, deckB, levelA, levelB, mode, games, seed }
 * 送るメッセージ:     { type: 'progress', summary } を1試合ごと、最後に { type: 'done', summary }
 *                    エラー時は { type: 'error', message }
 * 止めるときは、画面側が worker.terminate() する。
 * 先攻・後攻は1試合ごとに入れ替える（どちらのデッキも同じ回数だけ先攻になる）。
 */
self.window = self; // js/deckbuilder/cards-data.js は window にカードマスタを載せるため
(function () {
  var v = self.location.search || ''; // 対戦画面と同じ ?v= を付けて、古いキャッシュを読まないようにする
  importScripts(
    '../deckbuilder/cards-data.js' + v,
    '../engine/gameState.js' + v,
    '../engine/events.js' + v,
    '../engine/resolutionStack.js' + v,
    '../engine/deck.js' + v,
    '../engine/combat.js' + v,
    '../engine/phases.js' + v,
    '../engine/ruleConfig.js' + v,
    '../engine/match.js' + v,
    '../engine/cardEffect.js' + v,
    '../engine/effectFactories.js' + v,
    '../engine/parallelAliases.js' + v,
    '../engine/cardEffectData.js' + v,
    '../engine/effectResolver.js' + v,
    '../engine/cardLookup.js' + v,
    'choices.js' + v,
    'cpu.js' + v,
    'simulate.js' + v
  );
})();

var Sim = self.XS_BATTLE_SIMULATE;
var cardIndex = self.XS_ENGINE_CARD_LOOKUP.buildCardIndex(self.XS_DECKBUILDER_CARDS);

self.onmessage = function (e) {
  var m = e.data || {};
  if (m.type !== 'run') return;
  try {
    var summary = Sim.newSummary();
    for (var i = 0; i < m.games; i++) {
      var r = Sim.playMatch({
        seed: (m.seed + i * 7919) >>> 0, deckA: m.deckA, deckB: m.deckB, levelA: m.levelA, levelB: m.levelB,
        mode: m.mode, firstPlayer: i % 2 === 0 ? 'playerA' : 'playerB', cardIndex: cardIndex,
      });
      Sim.addResult(summary, r);
      self.postMessage({ type: 'progress', summary: summary });
    }
    self.postMessage({ type: 'done', summary: summary });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
