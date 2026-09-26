/* 対戦画面の選択の仕組み（js/battle/choices.js）の自動テスト（node test/battleChoices.test.js で実行）
 *
 * 対象:
 *  - runWithAnswers: 選択が必要になった地点で中断し、答えを足してやり直すと最後まで進むこと。
 *    元の盤面は変更しないこと。同じシードなら乱数を使う処理も同じ結果になること。
 *  - makeCallbacks: エンジンの各選択コールバックが、画面用の質問（LEADERS/CARDS/ALLOCATE）になること
 *  - validateSelection
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const GameState = require('../js/engine/gameState.js');
const Match = require('../js/engine/match.js');
const Deck = require('../js/engine/deck.js');
const CardEffectData = require('../js/engine/cardEffectData.js');
const EffectResolver = require('../js/engine/effectResolver.js');
const Choices = require('../js/battle/choices.js');

const cardIndex = CardLookup.loadDefaultCardIndexNode();
const allCards = Object.values(cardIndex);

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

const LEADERS_A = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004'];
const LEADERS_B = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];
LEADERS_A.concat(LEADERS_B).forEach((id) => { delete CardEffectData.REGISTRY[id]; });
const noEffect = (c) => !c.ban && !c.isParallel && !CardEffectData.hasEffects(c.cardNumber) && !CardEffectData.KEYWORDS[c.cardNumber];
// 効果の無いカードを優先して選ぶ。該当が無ければ（ほぼ全カードに効果を登録済みのため）条件に合うカードの効果をこのテスト内だけ外して使う
function plainCard(pred) {
  const pool = allCards.filter((c) => pred(c) && !c.ban && !c.isParallel && !CardEffectData.KEYWORDS[c.cardNumber]);
  const c = pool.find((x) => !CardEffectData.hasEffects(x.cardNumber)) || pool[0];
  delete CardEffectData.REGISTRY[c.cardNumber];
  return c.cardNumber;
}
const FILLER_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 1);
const ATTACK_COST2 = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 2);
const MEMORIA_COST1 = plainCard((c) => c.cardType === 'MEMORIA' && c.cost === 1 && c.ace !== true);
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban && !c.isParallel).slice(0, 5).map((c) => c.cardNumber);

function makeState() {
  const state = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: 'ST01-024',
    playerA: { leaderCardIds: LEADERS_A, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: LEADERS_B, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
  });
  state.turn.activePlayer = 'playerB';
  state.turn.turnNumber = 2;
  ['playerA', 'playerB'].forEach((pid) => {
    state.players[pid].hand = [];
    state.players[pid].ppCards.max = 10;
    state.players[pid].ppCards.tapped = 0;
  });
  return state;
}
const inst = (id) => GameState.createCardInstance(id);

// 画面と同じ手順で、質問に answerFn で答えながら行動を最後まで進める。質問の列も返す。
function drive(base, action, answerFn) {
  const answers = [];
  const questions = [];
  for (let guard = 0; guard < 20; guard++) {
    const r = Choices.runWithAnswers(base, 12345, answers, (state, ask) => {
      const cb = Choices.makeCallbacks(ask, { getActivePlayerId: () => state.turn.activePlayer, getResolvingEffect: EffectResolver.getResolvingEffect });
      return action(state, cb, ask);
    });
    if (r.done) return { state: r.state, questions };
    questions.push(r.question);
    answers.push(answerFn(r.question, questions.length - 1));
  }
  throw new Error('終わらない');
}
function resolveAll(state) {
  require('../js/engine/resolutionStack.js').resolveAll(state.resolutionStack, state);
}

// ============================================================
console.log('=== runWithAnswers ===');
// ============================================================
test('選択が無い行動はそのまま完了し、元の盤面は変わらない', () => {
  const base = makeState();
  const c = inst(FILLER_ATTACK);
  base.players.playerB.hand.push(c);
  const before = JSON.stringify(base);
  const r = drive(base, (s, cb) => {
    EffectResolver.playAttackCardWithEffects(s, 'playerB', c.instanceId, Object.assign({ attackerLeaderIndex: 0, targetPlayerId: 'playerA', targetLeaderIndex: 0 }, cb), cardIndex);
    resolveAll(s);
  }, () => { throw new Error('質問は出ないはず'); });
  assert.strictEqual(JSON.stringify(base), before);
  assert.ok(r.state.players.playerA.leaders[0].damage > 0);
});
test('頂点捕食者：捨てる→デッキから選ぶ→の順に質問が出て、答えどおりに解決する', () => {
  const base = makeState();
  const apex = inst('BP05-038');
  const discard = inst(ATTACK_COST2);
  base.players.playerB.hand.push(apex, discard);
  base.players.playerB.deck = [ATTACK_COST2, FILLER_ATTACK, MEMORIA_COST1, FILLER_ATTACK].map(inst).concat(base.players.playerB.deck);
  const r = drive(base, (s, cb) => {
    EffectResolver.playAttackCardWithEffects(s, 'playerB', apex.instanceId, Object.assign({ attackerLeaderIndex: 0, targetPlayerId: 'playerA', targetLeaderIndex: 0 }, cb), cardIndex);
    resolveAll(s);
  }, (q, i) => (i === 0 ? [0] : (q.type === 'CARDS' ? [1] : [0])));
  assert.strictEqual(r.questions[0].type, 'CARDS');
  assert.strictEqual(r.questions[0].costMin, 2);
  assert.strictEqual(r.questions[0].source.cardId || r.questions[0].source.sourceInstanceId, apex.instanceId);
  assert.strictEqual(r.questions[1].type, 'CARDS');
  assert.deepStrictEqual(r.questions[1].cards.map((c) => c.cardId), [ATTACK_COST2, FILLER_ATTACK, FILLER_ATTACK]);
  // 2番目の候補（コスト1のアタック）を選んだ → コストを支払わずにプレイされる
  assert.deepStrictEqual(r.state.players.playerB.playArea.map((e) => e.card.cardId), ['BP05-038', FILLER_ATTACK]);
  assert.strictEqual(r.state.players.playerB.ppCards.tapped, 1);
});
test('頂点捕食者：「しない」を選べば何も起きない', () => {
  const base = makeState();
  const apex = inst('BP05-038');
  base.players.playerB.hand.push(apex, inst(ATTACK_COST2));
  const deckLen = base.players.playerB.deck.length;
  const r = drive(base, (s, cb) => {
    EffectResolver.playAttackCardWithEffects(s, 'playerB', apex.instanceId, Object.assign({ attackerLeaderIndex: 0, targetPlayerId: 'playerA', targetLeaderIndex: 0 }, cb), cardIndex);
    resolveAll(s);
  }, () => []);
  assert.strictEqual(r.questions.length, 1);
  assert.strictEqual(r.state.players.playerB.deck.length, deckLen);
});
test('同じシードなら山札切れの再シャッフルも同じ結果になる（やり直しで結果が変わらない）', () => {
  const base = makeState();
  const p = base.players.playerB;
  p.trash = [];
  for (let i = 0; i < 30; i++) p.trash.push({ card: inst(i % 2 ? FILLER_ATTACK : ATTACK_COST2), faceUp: false });
  p.deck = [];
  const run = () => Choices.runWithAnswers(base, 777, [], (s) => { Deck.drawCards(s, 'playerB', 5); return s.players.playerB.hand.map((c) => c.instanceId); });
  assert.deepStrictEqual(run().value, run().value);
});

// ============================================================
console.log('=== makeCallbacks ===');
// ============================================================
test('ヴァリアブルピック：相手が捨てる手札（相手の手札なのでsecret）→対象最大2体、の順に質問', () => {
  const base = makeState();
  const vp = inst('BP05-052');
  base.players.playerB.hand.push(vp);
  base.players.playerA.hand = [FILLER_ATTACK, ATTACK_COST2, MEMORIA_COST1].map(inst);
  const r = drive(base, (s, cb) => {
    EffectResolver.playMemoriaCardWithEffects(s, 'playerB', vp.instanceId, Object.assign({}, cb), cardIndex);
    resolveAll(s);
  }, (q) => (q.type === 'CARDS' ? [0, 2] : [3]));
  assert.strictEqual(r.questions[0].chooser, 'playerA');
  assert.strictEqual(r.questions[0].secret, true);
  assert.strictEqual(r.questions[0].min, 2);
  assert.strictEqual(r.questions[1].type, 'LEADERS');
  assert.strictEqual(r.questions[1].max, 2);
  assert.deepStrictEqual(r.questions[1].preselect, [0, 1]);
  assert.deepStrictEqual(r.state.players.playerA.hand.map((c) => c.cardId), [ATTACK_COST2]);
  assert.deepStrictEqual(r.state.players.playerA.leaders.map((l) => l.damage), [0, 0, 0, 30]);
});
test('共に至る極致：リーダーを選べば30ダメージを与えて2枚引く', () => {
  const base = makeState();
  const m = inst('BP05-045');
  base.players.playerB.hand.push(m);
  const r = drive(base, (s, cb) => {
    EffectResolver.playMemoriaCardWithEffects(s, 'playerB', m.instanceId, Object.assign({}, cb), cardIndex);
    resolveAll(s);
  }, () => [2]);
  assert.strictEqual(r.questions[0].declineLabel, 'しない');
  assert.strictEqual(r.state.players.playerB.leaders[2].damage, 30);
  assert.strictEqual(r.state.players.playerB.hand.length, 2);
});
test('候補が1体だけの単体対象は質問しない', () => {
  const cb = Choices.makeCallbacks(() => { throw new Error('質問は出ないはず'); }, { getActivePlayerId: () => 'playerA', getResolvingEffect: () => null });
  assert.strictEqual(cb.chooseTarget([{ playerId: 'playerB', leaderIndex: 2 }]), 0);
});
test('配分回復（ALLOCATE）の答えは割り振り量として返る', () => {
  const cands = [{ playerId: 'playerA', leaderIndex: 0 }, { playerId: 'playerA', leaderIndex: 1 }];
  const cb = Choices.makeCallbacks((q) => { assert.strictEqual(q.type, 'ALLOCATE'); return [20, 10]; }, { getActivePlayerId: () => 'playerA', getResolvingEffect: () => null });
  assert.deepStrictEqual(cb.chooseDistributedHeal(cands, 30).map((a) => a.amount), [20, 10]);
});
test('終了フェイズの手札上限：捨てるカードを選べる', () => {
  const base = makeState();
  base.players.playerB.hand = new Array(9).fill(FILLER_ATTACK).map(inst);
  base.players.playerB.ppCards.tapped = 10;
  const keepFirst = base.players.playerB.hand[0].instanceId;
  const r = drive(base, (s, cb, ask) => {
    EffectResolver.runEndPhaseWithEffects(s, Choices.makeHandLimitChooser(ask, 'playerB'));
  }, (q) => { assert.strictEqual(q.min, 2); return [0, 1]; });
  assert.strictEqual(r.state.players.playerB.hand.length, 7);
  assert.ok(!r.state.players.playerB.hand.some((c) => c.instanceId === keepFirst));
});

// ============================================================
console.log('=== validateSelection ===');
// ============================================================
test('枚数とコスト合計の条件', () => {
  const q = { type: 'CARDS', min: 0, max: 3, costMin: 2, cards: [{ cardId: FILLER_ATTACK }, { cardId: ATTACK_COST2 }, { cardId: MEMORIA_COST1 }] };
  assert.strictEqual(Choices.validateSelection(q, [0], cardIndex).ok, false);
  assert.strictEqual(Choices.validateSelection(q, [0, 2], cardIndex).ok, true);
  assert.strictEqual(Choices.validateSelection(q, [1], cardIndex).ok, true);
  assert.strictEqual(Choices.validateSelection(Object.assign({}, q, { costMin: null, costMax: 1 }), [1], cardIndex).ok, false);
  assert.strictEqual(Choices.validateSelection({ type: 'LEADERS', min: 1, max: 1 }, [], cardIndex).ok, false);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
