/* ラウンド開始時のタクティクス選択（match.js deferRoundSetup / runRoundSetup）の自動テスト（node test/tacticsSetup.test.js で実行）
 *
 * 対象:
 *  - deferRoundSetup: 試合開始時・ラウンド終了後に「タクティクスを置く→手札を配る」の前で止まる（ROUND_SETUP）
 *  - runRoundSetup: プレイヤーが選んだタクティクスを置いてから手札を4枚ずつ配る（先攻→後攻の順に質問）
 *  - 1ラウンド目の後攻：STANDARDはタクティクスを選んだ後にPPチケット、QUICKは2枚目のタクティクスを選ぶ
 *  - 対戦画面の選択（choices.js makeTacticsChooser）とCPUの答え（cpu.js SET_TACTICS）
 *  - deferRoundSetup を指定しない従来の呼び方は、これまでどおりランダムに置いて手札を配る
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const Match = require('../js/engine/match.js');
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
  }
}

const TICKET = 'ST01-024';
const SELF = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004'];
const OPP = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];
const TACTICS = Object.values(cardIndex).filter((c) => c.cardType === 'TACTICS' && !c.ban && !c.isParallel && typeof c.cost === 'number')
  .slice(0, 5).map((c) => c.cardNumber);

function makeMatch(opts) {
  opts = opts || {};
  return Match.createMatch({
    matchId: 't', mode: opts.mode || 'STANDARD', firstPlayer: opts.firstPlayer || 'playerA', ppTicketCardId: TICKET,
    deferRoundSetup: opts.defer !== false,
    playerA: { leaderCardIds: SELF, deckCardIds: new Array(50).fill('BP01-046'), tacticsDeckCardIds: TACTICS.slice() },
    playerB: { leaderCardIds: OPP, deckCardIds: new Array(50).fill('BP01-046'), tacticsDeckCardIds: TACTICS.slice() },
  });
}

// 呼ばれた順番と、呼ばれた時点の手札の枚数を記録する選び方（毎回 pick 番目を選ぶ）
function recorder(pick) {
  const calls = [];
  const fn = (state, playerId, candidates) => {
    calls.push({ playerId, n: candidates.length, ids: candidates.map((c) => c.cardId), handA: state.players.playerA.hand.length, handB: state.players.playerB.hand.length, round: state.match.roundNumber });
    return pick;
  };
  fn.calls = calls;
  return fn;
}

function endRound(state, loser) {
  state.players[loser].leaders.forEach((l) => { l.isDown = true; });
  return Match.processRoundEnd(state);
}

// ============================================================
console.log('=== 試合開始時 ===');
// ============================================================
test('deferRoundSetup: タクティクスを置く前・手札を配る前で止まる', () => {
  const s = makeMatch();
  assert.strictEqual(s.turn.phase, 'ROUND_SETUP');
  assert.strictEqual(s.players.playerA.hand.length, 0);
  assert.strictEqual(s.players.playerB.hand.length, 0);
  assert.strictEqual(s.players.playerA.tacticsArea.length, 0);
  assert.strictEqual(s.players.playerB.tacticsArea.length, 0);
  assert.strictEqual(s.players.playerA.tacticsDeck.length, 5);
});

test('runRoundSetup: 手札を配る前に、先攻→後攻の順でタクティクスを選ぶ', () => {
  const s = makeMatch({ firstPlayer: 'playerB' });
  const choose = recorder(0);
  Match.runRoundSetup(s, choose);
  assert.deepStrictEqual(choose.calls.map((c) => c.playerId), ['playerB', 'playerA']);
  choose.calls.forEach((c) => { assert.strictEqual(c.handA, 0); assert.strictEqual(c.handB, 0); assert.strictEqual(c.n, 5); });
  assert.strictEqual(s.players.playerA.hand.length, 4);
  assert.strictEqual(s.players.playerB.hand.length, 4);
  assert.strictEqual(s.turn.phase, 'START_PHASE');
  assert.strictEqual(s.turn.turnNumber, 1);
  assert.strictEqual(s.turn.activePlayer, 'playerB');
});

test('選んだタクティクスが裏向きでタクティクスエリアに置かれ、タクティクスデッキから抜ける', () => {
  const s = makeMatch();
  Match.runRoundSetup(s, (state, pid) => (pid === 'playerA' ? 3 : 1));
  const a = s.players.playerA;
  assert.strictEqual(a.tacticsArea[0].card.cardId, TACTICS[3]);
  assert.strictEqual(a.tacticsArea[0].faceUp, false);
  assert.strictEqual(a.tacticsDeck.length, 4);
  assert.ok(!a.tacticsDeck.some((c) => c.cardId === TACTICS[3]));
  assert.strictEqual(s.players.playerB.tacticsArea[0].card.cardId, TACTICS[1]);
});

test('STANDARD：後攻はタクティクスを選んだ後にPPチケットを表向きで置く（先攻は置かない）', () => {
  const s = makeMatch({ firstPlayer: 'playerA' });
  Match.runRoundSetup(s, () => 0);
  const b = s.players.playerB.tacticsArea;
  assert.strictEqual(b.length, 2);
  assert.strictEqual(b[0].faceUp, false);
  assert.strictEqual(b[1].card.cardId, TICKET);
  assert.strictEqual(b[1].faceUp, true);
  assert.strictEqual(s.players.playerA.tacticsArea.length, 1);
});

test('QUICK：後攻はPPチケットの代わりに2枚目のタクティクスも選ぶ', () => {
  const s = makeMatch({ mode: 'QUICK', firstPlayer: 'playerA' });
  const choose = recorder(0);
  Match.runRoundSetup(s, choose);
  assert.deepStrictEqual(choose.calls.map((c) => [c.playerId, c.n]), [['playerA', 5], ['playerB', 5], ['playerB', 4]]);
  const b = s.players.playerB.tacticsArea;
  assert.strictEqual(b.length, 2);
  assert.ok(b.every((t) => t.card.cardId !== TICKET && t.faceUp === false));
});

test('ROUND_SETUP以外の場面では runRoundSetup はエラー', () => {
  const s = makeMatch();
  Match.runRoundSetup(s, () => 0);
  assert.throws(() => Match.runRoundSetup(s, () => 0), /タクティクスを置く場面ではありません/);
});

// ============================================================
console.log('=== 次のラウンド ===');
// ============================================================
test('ラウンド終了後も、タクティクスを選ぶ前（手札0枚）で止まり、PPの最大値は増える', () => {
  const s = makeMatch({ firstPlayer: 'playerA' });
  Match.runRoundSetup(s, () => 0);
  const r = endRound(s, 'playerA');
  assert.ok(r.roundEnded && !r.matchEnded);
  assert.strictEqual(s.turn.phase, 'ROUND_SETUP');
  assert.strictEqual(s.match.roundNumber, 2);
  assert.strictEqual(s.players.playerA.hand.length, 0);
  assert.strictEqual(s.players.playerB.hand.length, 0);
  assert.strictEqual(s.players.playerA.ppCards.max, 4);
  assert.strictEqual(s.players.playerA.leaders.every((l) => !l.isDown && l.damage === 0), true);
});

test('2ラウンド目：前のラウンドで負けた側（先攻）から選び、PPチケットは置かない。選んだ後に手札4枚', () => {
  const s = makeMatch({ firstPlayer: 'playerA' });
  Match.runRoundSetup(s, () => 0);
  endRound(s, 'playerA');
  const choose = recorder(1);
  Match.runRoundSetup(s, choose);
  assert.deepStrictEqual(choose.calls.map((c) => [c.playerId, c.n, c.round, c.handA + c.handB]), [['playerA', 4, 2, 0], ['playerB', 4, 2, 0]]);
  assert.strictEqual(s.players.playerB.tacticsArea.filter((t) => t.card.cardId === TICKET).length, 1); // 1ラウンド目の分だけ
  assert.strictEqual(s.players.playerA.tacticsArea.length, 2);
  assert.strictEqual(s.players.playerA.hand.length, 4);
  assert.strictEqual(s.turn.activePlayer, 'playerA');
  assert.strictEqual(s.turn.phase, 'START_PHASE');
});

test('試合が決まったラウンドの後は ROUND_SETUP にならない', () => {
  const s = makeMatch({ firstPlayer: 'playerA' });
  Match.runRoundSetup(s, () => 0);
  endRound(s, 'playerB');
  Match.runRoundSetup(s, () => 0);
  const r = endRound(s, 'playerB');
  assert.ok(r.matchEnded);
  assert.strictEqual(s.match.status, 'FINISHED');
  assert.notStrictEqual(s.turn.phase, 'ROUND_SETUP');
});

// ============================================================
console.log('=== 従来の呼び方（deferRoundSetup なし） ===');
// ============================================================
test('ランダムに置いてそのまま手札を配る（1ラウンド目・2ラウンド目とも）', () => {
  const s = makeMatch({ defer: false, firstPlayer: 'playerA' });
  assert.strictEqual(s.turn.phase, 'START_PHASE');
  assert.strictEqual(s.players.playerA.hand.length, 4);
  assert.strictEqual(s.players.playerA.tacticsArea.length, 1);
  assert.strictEqual(s.players.playerB.tacticsArea.length, 2);
  endRound(s, 'playerA');
  assert.strictEqual(s.turn.phase, 'START_PHASE');
  assert.strictEqual(s.players.playerA.hand.length, 4);
  assert.strictEqual(s.players.playerA.tacticsArea.length, 2);
});

// ============================================================
console.log('=== 対戦画面の選択・CPU ===');
// ============================================================
test('makeTacticsChooser：プレイヤーごとの隠れた選択（SET_TACTICS）として質問し、答えのカードを置く', () => {
  const base = makeMatch({ firstPlayer: 'playerA' });
  const run = (answers) => Choices.runWithAnswers(base, 1, answers, (state, ask) => { Match.runRoundSetup(state, Choices.makeTacticsChooser(ask)); return true; });
  const r1 = run([]);
  assert.strictEqual(r1.done, false);
  assert.strictEqual(r1.question.kind, 'SET_TACTICS');
  assert.strictEqual(r1.question.chooser, 'playerA');
  assert.strictEqual(r1.question.secret, true);
  assert.strictEqual(r1.question.cards.length, 5);
  assert.strictEqual(r1.state.players.playerA.hand.length, 0); // 選択中の盤面：手札はまだ配られていない
  const r2 = run([[2]]);
  assert.strictEqual(r2.done, false);
  assert.strictEqual(r2.question.chooser, 'playerB');
  const r3 = run([[2], [4]]);
  assert.strictEqual(r3.done, true);
  assert.strictEqual(r3.state.players.playerA.tacticsArea[0].card.cardId, TACTICS[2]);
  assert.strictEqual(r3.state.players.playerB.tacticsArea[0].card.cardId, TACTICS[4]);
  assert.strictEqual(r3.state.players.playerB.hand.length, 4);
});

test('CPU：SET_TACTICSには、そのラウンドのPPで使えるタクティクスを1枚選ぶ', () => {
  const s = makeMatch();
  let q = null;
  Choices.runWithAnswers(s, 1, [], (state, ask) => { Match.runRoundSetup(state, Choices.makeTacticsChooser((question) => { q = question; return ask(question); })); });
  const a = Cpu.answerQuestion(q, s, 'playerA', cardIndex);
  assert.strictEqual(a.length, 1);
  assert.ok(Choices.validateSelection(q, a, cardIndex).ok);
  const picked = cardIndex[q.cards[a[0]].cardId];
  const usable = q.cards.map((c) => cardIndex[c.cardId]).filter((c) => c.cost <= s.players.playerA.ppCards.max);
  if (usable.length) assert.ok(picked.cost <= s.players.playerA.ppCards.max);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
