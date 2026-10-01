/* デッキ検証（CPU同士の連続対戦。js/battle/simulate.js）の自動テスト（node test/simulate.test.js で実行）
 *
 * 対象:
 *  - 1試合が最後まで終わり、勝者が決まる
 *  - 同じシード・同じ設定なら同じ結果（ブラウザのWeb Workerと同じ結果を再現できる）
 *  - 先攻の指定どおりに始まる
 *  - デッキは { cardNumber, count } 形式と、カード番号の配列のどちらでも渡せる
 *  - 集計（勝ち数・先攻別・ターン数）
 *  - 試合のあとで Math.random とデッキ切れの選び方を元に戻す
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const Deck = require('../js/engine/deck.js');
const Sim = require('../js/battle/simulate.js');

const cardIndex = CardLookup.loadDefaultCardIndexNode();

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok -', name);
  } catch (e) {
    failed++;
    console.log('  FAIL -', name);
    console.log('       ', e.message);
  }
}

// 最強イエロー（黄4体）と、緑3体＋黄1体のデッキ
const YELLOW = {
  leaders: ['BP03-010', 'BP02-011', 'BP02-012', 'BP05-L11'],
  cards: [['ST02-015', 4], ['BP03-035', 4], ['BP02-031', 4], ['BP01-037', 4], ['BP02-036', 3], ['BP02-033', 3], ['BP03-033', 3], ['ST02-011', 3], ['BP02-064', 3], ['BP04-033', 3], ['ST02-010', 3], ['BP02-059', 2], ['BP02-032', 2], ['BP04-060', 2], ['BP03-063', 2], ['BP01-036', 1], ['BP01-035', 1], ['BP02-065', 1], ['BP04-061', 1], ['BP05-059', 1]]
    .map(([cardNumber, count]) => ({ cardNumber, count })),
  tactics: ['BP02-079', 'BP01-094', 'BP01-092', 'BP04-073', 'BP03-073'],
};
const GREEN = {
  leaders: ['BP01-016', 'ST01-003', 'BP01-013', 'BP04-010'],
  cards: [['BP01-045', 4], ['BP01-052', 4], ['BP02-031', 4], ['BP05-038', 4], ['BP04-063', 4], ['BP01-083', 4], ['BP01-085', 4], ['BP01-088', 4], ['BP01-049', 4], ['BP04-035', 3], ['ST02-011', 3], ['ST01-009', 3], ['BP04-040', 2], ['BP03-040', 2], ['ST02-015', 1]]
    .map(([cardNumber, count]) => ({ cardNumber, count })),
  tactics: ['BP02-079', 'BP01-094', 'BP01-092', 'BP04-073', 'BP03-073'],
};
const opts = (o) => Object.assign({ seed: 1, deckA: GREEN, deckB: YELLOW, levelA: 'NORMAL', levelB: 'NORMAL', cardIndex }, o);

console.log('=== 1試合 ===');
test('試合が最後まで終わり、勝者が決まる', () => {
  const r = Sim.playMatch(opts({}));
  assert.ok(r.winner === 'playerA' || r.winner === 'playerB', 'winner=' + r.winner);
  assert.ok(r.turns > 0);
});
test('同じシード・同じ設定なら同じ結果（強でも）', () => {
  const a = Sim.playMatch(opts({ seed: 42, levelA: 'HARD', levelB: 'HARD' }));
  const b = Sim.playMatch(opts({ seed: 42, levelA: 'HARD', levelB: 'HARD' }));
  assert.deepStrictEqual(a, b);
});
test('先攻の指定どおりに始まる', () => {
  assert.strictEqual(Sim.playMatch(opts({ firstPlayer: 'playerB' })).firstPlayer, 'playerB');
  assert.strictEqual(Sim.playMatch(opts({ firstPlayer: 'playerA' })).firstPlayer, 'playerA');
});
test('デッキはカード番号の配列でも渡せる（同じ結果）', () => {
  const flat = Object.assign({}, GREEN, { cards: Sim.expandCards(GREEN) });
  assert.strictEqual(flat.cards.length, 50);
  assert.deepStrictEqual(Sim.playMatch(opts({ seed: 7, deckA: flat })), Sim.playMatch(opts({ seed: 7 })));
});
test('試合のあとで Math.random とデッキ切れの選び方を元に戻す', () => {
  const orig = Math.random;
  Sim.playMatch(opts({ seed: 3 }));
  assert.strictEqual(Math.random, orig);
  // デッキ切れの選び方が残っていれば、選ぶ処理が呼ばれてしまう（残っていなければランダム）
  const state = { players: { playerA: { tacticsDeck: [{ cardId: 'X' }, { cardId: 'Y' }], trash: [] } }, actionLog: [], match: {} };
  try { Deck.consumeTacticsDeck(state, 'playerA'); } catch (e) { /* ログの形式が違っても、選ぶ処理が呼ばれないことだけ見る */ }
  assert.ok(!state.actionLog.some((e) => e.payload && e.payload.chosenBy === 'OPPONENT'));
});

console.log('=== 集計 ===');
test('勝ち数・引き分け・先攻別・ターン数を数える', () => {
  const sum = Sim.newSummary();
  Sim.addResult(sum, { winner: 'playerA', turns: 10, firstPlayer: 'playerA' });
  Sim.addResult(sum, { winner: 'playerB', turns: 20, firstPlayer: 'playerB' });
  Sim.addResult(sum, { winner: null, turns: 300, firstPlayer: 'playerA' });
  assert.deepStrictEqual(sum, { games: 3, winsA: 1, winsB: 1, draws: 1, firstA: { games: 2, winsA: 1 }, firstB: { games: 1, winsA: 0 }, turns: 330 });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
