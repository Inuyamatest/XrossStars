/* 使われなかったアタック強化の持ち越し（ruleConfig.pendingAttackEffectsExpiryPolicy）の自動テスト（node test/boostExpiry.test.js で実行）
 *
 * 対象:
 *  - 同じターンのうちは、メモリアのアタック強化が次のアタックに乗る（これまでどおり）
 *  - アタックせずにターンを終えると、終了フェイズで強化（ダメージ+・次のアタックに紐づくアタック後効果）が消える
 *  - ラウンド終了時も、両プレイヤーの強化が消える
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const GameState = require('../js/engine/gameState.js');
const ResolutionStack = require('../js/engine/resolutionStack.js');
const Match = require('../js/engine/match.js');
const CardEffectData = require('../js/engine/cardEffectData.js');
const EffectResolver = require('../js/engine/effectResolver.js');

const cardIndex = CardLookup.loadDefaultCardIndexNode();
const allCards = Object.values(cardIndex);
const plainCard = require('./helpers/plainCard.js')(allCards, CardEffectData, __filename);

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

const SELF = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004'];
const OPP = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];
SELF.concat(OPP).forEach((id) => { delete CardEffectData.REGISTRY[id]; }); // リーダーの覚醒時効果で数値がぶれないように
const FILLER_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 1);
const TOUR_GUIDE = 'ST02-015'; // ツアーガイド：〖アタック強化〗次のアタックのダメージ+50
const PASSION_CALL = 'BP02-065'; // パッションコール：〖アタック強化〗+50 〖アタック後〗対戦相手の他のリーダー1体に10ダメージ

function makeState() {
  const state = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: 'ST01-024',
    playerA: { leaderCardIds: OPP, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: [] },
    playerB: { leaderCardIds: SELF, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: [] },
  });
  state.turn.activePlayer = 'playerB';
  state.turn.turnNumber = 2;
  ['playerA', 'playerB'].forEach((pid) => { state.players[pid].hand = []; state.players[pid].ppCards.max = 10; state.players[pid].ppCards.tapped = 0; });
  return state;
}
function toHand(s, id) { const c = GameState.createCardInstance(id); s.players.playerB.hand.push(c); return c.instanceId; }
function memoria(s, cardId) {
  const id = toHand(s, cardId);
  EffectResolver.playMemoriaCardWithEffects(s, 'playerB', id, {}, cardIndex);
  ResolutionStack.resolveAll(s.resolutionStack, s);
}
function attack(s) {
  const id = toHand(s, FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(s, 'playerB', id, { attackerLeaderIndex: 0, targetPlayerId: 'playerA', targetLeaderIndex: 0 }, cardIndex);
  ResolutionStack.resolveAll(s.resolutionStack, s);
}
// 次の自分のターンになったことにする（相手のターンは省略）
function nextOwnTurn(s) {
  s.turn.turnNumber += 2;
  s.players.playerB.ppCards.tapped = 0;
}
const oppDmg = (s) => s.players.playerA.leaders.map((l) => l.damage);
const ATK = 30;

// ============================================================
console.log('=== 同じターン ===');
// ============================================================
test('メモリアのアタック強化は、同じターンの次のアタックに乗る', () => {
  const s = makeState();
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, s.players.playerB.leaders[0]), ATK);
  memoria(s, TOUR_GUIDE);
  assert.strictEqual(s.players.playerB.pendingAttackBoost, 50);
  attack(s);
  assert.deepStrictEqual(oppDmg(s), [ATK + 50, 0, 0, 0]);
  assert.strictEqual(s.players.playerB.pendingAttackBoost, 0);
});

// ============================================================
console.log('=== ターンをまたぐ ===');
// ============================================================
test('アタックせずにターンを終えると、終了フェイズでアタック強化が消える', () => {
  const s = makeState();
  memoria(s, TOUR_GUIDE);
  EffectResolver.runEndPhaseWithEffects(s);
  const p = s.players.playerB;
  assert.strictEqual(p.pendingAttackBoost, 0);
  assert.deepStrictEqual(p.pendingBoostSources, []);
  assert.deepStrictEqual(p.pendingAttackTimeBoosts, []);
  nextOwnTurn(s);
  attack(s);
  assert.deepStrictEqual(oppDmg(s), [ATK, 0, 0, 0]); // 前のターンの+50は乗らない
});

test('次のアタックに紐づくアタック後効果も、終了フェイズで消える', () => {
  const s = makeState();
  memoria(s, PASSION_CALL);
  assert.strictEqual(s.players.playerB.pendingAfterAttackEffects.length, 1);
  EffectResolver.runEndPhaseWithEffects(s);
  assert.deepStrictEqual(s.players.playerB.pendingAfterAttackEffects, []);
  nextOwnTurn(s);
  attack(s);
  assert.deepStrictEqual(oppDmg(s), [ATK, 0, 0, 0]); // 他のリーダーへの10ダメージも出ない
});

test('同じターンなら、アタック後効果も次のアタックで出る', () => {
  const s = makeState();
  memoria(s, PASSION_CALL);
  attack(s);
  const d = oppDmg(s);
  assert.strictEqual(d[0], ATK + 50);
  assert.strictEqual(d.slice(1).reduce((a, b) => a + b, 0), 10);
});

// ============================================================
console.log('=== ラウンドをまたぐ ===');
// ============================================================
test('ラウンド終了時は、両プレイヤーのアタック強化・アタック後効果が消える', () => {
  const s = makeState();
  memoria(s, PASSION_CALL);
  s.players.playerA.pendingAttackBoost = 40;
  s.players.playerA.pendingBoostSources = [{ cardId: TOUR_GUIDE, amount: 40 }];
  s.players.playerA.leaders.forEach((l) => { l.isDown = true; });
  const r = Match.processRoundEnd(s);
  assert.ok(r.roundEnded && !r.matchEnded);
  ['playerA', 'playerB'].forEach((pid) => {
    const p = s.players[pid];
    assert.strictEqual(p.pendingAttackBoost, 0, pid);
    assert.deepStrictEqual(p.pendingBoostSources, [], pid);
    assert.deepStrictEqual(p.pendingAttackTimeBoosts, [], pid);
    assert.deepStrictEqual(p.pendingAfterAttackEffects, [], pid);
  });
});

test('ruleConfig に解釈（PROVISIONAL）が記録されている', () => {
  const policy = s0().ruleConfig.pendingAttackEffectsExpiryPolicy;
  assert.strictEqual(policy.expiresAtEndPhase, true);
  assert.strictEqual(policy.expiresAtRoundEnd, true);
  assert.strictEqual(policy.status, 'PROVISIONAL');
});
function s0() { return makeState(); }

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
