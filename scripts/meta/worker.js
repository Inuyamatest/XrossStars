/* おすすめデッキ探索（scripts/meta/run.js）の対戦係。worker_threads で動く。
 * 受け取る: { id, me, opp, games, seed } … me と opp を games 戦（席・先攻を1戦ごとに入れ替え）
 * 返す:     { id, wins, games }
 */
'use strict';
const { parentPort } = require('worker_threads');
const path = require('path');
const R = path.join(__dirname, '..', '..');
const CardLookup = require(path.join(R, 'js/engine/cardLookup.js'));
const Sim = require(path.join(R, 'js/battle/simulate.js'));
const cardIndex = CardLookup.loadDefaultCardIndexNode();

function playSeries(me, opp, games, seed) {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const meIsA = g % 2 === 0;
    const r = Sim.playMatch({
      seed: seed + g, cardIndex, levelA: 'HARD', levelB: 'HARD', mode: 'STANDARD',
      deckA: meIsA ? me : opp, deckB: meIsA ? opp : me,
      firstPlayer: (Math.floor(g / 2) % 2 === 0) ? 'playerA' : 'playerB',
    });
    if (r.winner === (meIsA ? 'playerA' : 'playerB')) wins++;
  }
  return wins;
}

parentPort.on('message', (m) => {
  try {
    parentPort.postMessage({ id: m.id, wins: playSeries(m.me, m.opp, m.games, m.seed), games: m.games });
  } catch (e) {
    parentPort.postMessage({ id: m.id, error: String(e && e.stack || e) });
  }
});
