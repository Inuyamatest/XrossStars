/* デッキ切れ（FAQ Q1）で残りのタクティクスを1枚トラッシュする処理の自動テスト（node test/deckOut.test.js で実行）
 *
 * 対象:
 *  - 選び方を指定しないとき（テスト・シミュレーション）はランダム
 *  - Deck.setTacticsConsumeChooser で「裏向きのままシャッフルして相手に選んでもらう」：
 *    候補はシャッフル済み・選んだカードが表向きでトラッシュへ・残り1枚なら質問しない
 *  - 対戦画面の質問（choices.js makeDeckOutTacticsChooser）：対戦相手が選ぶ・裏向き表示・答えのカードが消費される
 *  - CPUの答え（cpu.js DECKOUT_TACTICS）
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const Match = require('../js/engine/match.js');
const Deck = require('../js/engine/deck.js');
const Choices = require('../js/battle/choices.js');
const Cpu = require('../js/battle/cpu.js');

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
  } finally {
    Deck.setTacticsConsumeChooser(null);
  }
}

const TACTICS = Object.values(cardIndex).filter((c) => c.cardType === 'TACTICS' && !c.ban && !c.isParallel && typeof c.cost === 'number')
  .slice(0, 5).map((c) => c.cardNumber);

// playerAのデッキ・トラッシュ（裏向き）を空にした盤面
function makeDeckOut() {
  const state = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: 'ST01-024', deferRoundSetup: true,
    playerA: { leaderCardIds: ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004'], deckCardIds: new Array(50).fill('BP01-046'), tacticsDeckCardIds: TACTICS.slice() },
    playerB: { leaderCardIds: ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'], deckCardIds: new Array(50).fill('BP01-046'), tacticsDeckCardIds: TACTICS.slice() },
  });
  state.players.playerA.deck = [];
  state.players.playerA.trash = [];
  return state;
}
const consumedEvents = (s) => s.actionLog.filter((e) => e.type === 'TACTICS_CONSUMED');

console.log('=== 選び方 ===');
test('選び方の指定が無ければランダムに1枚（表向きでトラッシュ、カードは引けない）', () => {
  const s = makeDeckOut();
  const card = Deck.drawCard(s, 'playerA');
  assert.strictEqual(card, null);
  const p = s.players.playerA;
  assert.strictEqual(p.tacticsDeck.length, 4);
  assert.strictEqual(p.trash.length, 1);
  assert.strictEqual(p.trash[0].faceUp, true);
  assert.strictEqual(consumedEvents(s)[0].payload.chosenBy, 'RANDOM');
});

test('相手に選んでもらう：候補はタクティクスデッキ全部（並びはシャッフル）、選んだカードが消費される', () => {
  const s = makeDeckOut();
  const p = s.players.playerA;
  let seen = null;
  Deck.setTacticsConsumeChooser((state, pid, cands) => { seen = { pid, ids: cands.map((c) => c.instanceId) }; return 2; });
  Deck.drawCard(s, 'playerA');
  assert.strictEqual(seen.pid, 'playerA');
  assert.strictEqual(seen.ids.length, 5);
  const trashed = p.trash[0].card.instanceId;
  assert.strictEqual(trashed, seen.ids[2]); // 候補の3枚目を選んだら、そのカードがトラッシュへ
  assert.ok(!p.tacticsDeck.some((c) => c.instanceId === trashed));
  assert.strictEqual(consumedEvents(s)[0].payload.chosenBy, 'OPPONENT');
});

test('シャッフルされるので、候補の並びは元のタクティクスデッキの順と同じとは限らない', () => {
  let differs = false;
  for (let k = 0; k < 20 && !differs; k++) {
    const s = makeDeckOut();
    const original = s.players.playerA.tacticsDeck.map((c) => c.instanceId).join(',');
    Deck.setTacticsConsumeChooser((state, pid, cands) => { if (cands.map((c) => c.instanceId).join(',') !== original) differs = true; return 0; });
    Deck.drawCard(s, 'playerA');
  }
  assert.ok(differs);
});

test('残り1枚なら質問しない。0枚なら試合に敗北', () => {
  const s = makeDeckOut();
  s.players.playerA.tacticsDeck = s.players.playerA.tacticsDeck.slice(0, 1);
  let asked = 0;
  Deck.setTacticsConsumeChooser(() => { asked++; return 0; });
  Deck.drawCard(s, 'playerA');
  assert.strictEqual(asked, 0);
  assert.strictEqual(s.players.playerA.tacticsDeck.length, 0);
  Deck.drawCard(s, 'playerA');
  assert.strictEqual(s.match.status, 'FINISHED');
  assert.strictEqual(s.match.winner, 'playerB');
});

test('トラッシュに裏向きのカードがあれば山札に戻して引く。そのうえでタクティクスも1枚置く（FAQ Q1の実例）', () => {
  const s = makeDeckOut();
  s.players.playerA.trash = [{ card: s.players.playerB.deck[0], faceUp: false }];
  let asked = 0;
  Deck.setTacticsConsumeChooser(() => { asked++; return 0; });
  const card = Deck.drawCard(s, 'playerA');
  assert.ok(card);
  assert.strictEqual(asked, 1);
  assert.strictEqual(s.players.playerA.tacticsDeck.length, 4);
});

test('デッキが足りていればデッキ切れ処理は起きない', () => {
  const s = makeDeckOut();
  s.players.playerA.deck = s.players.playerB.deck.splice(0, 3);
  assert.strictEqual(Deck.ensureDeckCards(s, 'playerA', 3), true);
  assert.strictEqual(s.players.playerA.tacticsDeck.length, 5);
  assert.strictEqual(consumedEvents(s).length, 0);
});

test('見る枚数に足りないとき：残りのデッキは上のまま、その下にトラッシュの裏向きカードを戻し、タクティクスを1枚置く', () => {
  const s = makeDeckOut();
  const p = s.players.playerA;
  p.deck = s.players.playerB.deck.splice(0, 1);
  const topId = p.deck[0].instanceId;
  p.trash = s.players.playerB.deck.splice(0, 4).map((c) => ({ card: c, faceUp: false }));
  assert.strictEqual(Deck.ensureDeckCards(s, 'playerA', 3), true);
  assert.strictEqual(p.deck.length, 5);
  assert.strictEqual(p.deck[0].instanceId, topId);
  assert.strictEqual(p.tacticsDeck.length, 4);
  assert.deepStrictEqual(p.trash.map((t) => t.faceUp), [true]);
});

test('見る枚数に足りず、置くタクティクスも無ければ敗北（falseを返す）', () => {
  const s = makeDeckOut();
  s.players.playerA.tacticsDeck = [];
  assert.strictEqual(Deck.ensureDeckCards(s, 'playerA', 1), false);
  assert.strictEqual(s.match.winner, 'playerB');
});

test('ruleConfig に解釈（PROVISIONAL）が記録されている', () => {
  const policy = makeDeckOut().ruleConfig.deckOutPolicy;
  assert.strictEqual(policy.alwaysConsumeTactics, true);
  assert.strictEqual(policy.effectFizzlesOnEmptyDeck, false);
  assert.strictEqual(policy.status, 'PROVISIONAL');
});

test('n枚引くときにデッキが足りなければ、デッキ切れ処理は1回だけ（引けるだけ引く）', () => {
  const s = makeDeckOut();
  s.players.playerA.trash = [{ card: s.players.playerB.deck[0], faceUp: false }];
  const drawn = Deck.drawCards(s, 'playerA', 3);
  assert.strictEqual(drawn.length, 1);
  assert.strictEqual(consumedEvents(s).length, 1);
});

console.log('=== 対戦画面の質問・CPU ===');
test('質問は対戦相手が選ぶ・裏向き（faceDown）・答えたカードが消費される', () => {
  const base = makeDeckOut();
  const run = (answers) => Choices.runWithAnswers(base, 7, answers, (state, ask) => {
    Deck.setTacticsConsumeChooser(Choices.makeDeckOutTacticsChooser(ask));
    try { Deck.drawCard(state, 'playerA'); } finally { Deck.setTacticsConsumeChooser(null); }
    return true;
  });
  const r1 = run([]);
  assert.strictEqual(r1.done, false);
  assert.strictEqual(r1.question.kind, 'DECKOUT_TACTICS');
  assert.strictEqual(r1.question.chooser, 'playerB');
  assert.strictEqual(r1.question.faceDown, true);
  assert.strictEqual(r1.question.deckOutPlayer, 'playerA');
  assert.strictEqual(r1.question.cards.length, 5);
  const r2 = run([[4]]);
  assert.strictEqual(r2.done, true);
  assert.strictEqual(r2.state.players.playerA.trash[0].card.instanceId, r1.question.cards[4].instanceId); // 同じシードなら同じ並び
});

test('CPUはどれか1枚を選ぶ（条件を満たす答え）', () => {
  const s = makeDeckOut();
  let q = null;
  Choices.runWithAnswers(s, 1, [], (state, ask) => {
    Deck.setTacticsConsumeChooser(Choices.makeDeckOutTacticsChooser((question) => { q = question; return ask(question); }));
    try { Deck.drawCard(state, 'playerA'); } finally { Deck.setTacticsConsumeChooser(null); }
  });
  const a = Cpu.answerQuestion(q, s, 'playerB', cardIndex);
  assert.strictEqual(a.length, 1);
  assert.ok(Choices.validateSelection(q, a, cardIndex).ok);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
