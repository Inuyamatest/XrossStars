/* リーダー覚醒時効果（6種の定型文）と第5弾リーダーの自動テスト（node test/leaderAwaken.test.js で実行）
 *
 * 対象:
 *  - cardEffectData.js: 全リーダーに覚醒時効果が登録されていること
 *  - 6種の定型文それぞれが、アタックで覚醒した瞬間に実際に解決されること（第5弾リーダーで検証）
 *  - js/data/leaders.js 第5弾16名の登録内容
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

const PP_TICKET = 'ST01-024';
const FILLER_ATTACK = allCards.filter((c) => c.cardType === 'ATTACK' && !c.ban && c.cost === 1 && !CardEffectData.hasEffects(c.cardNumber))[0].cardNumber;
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban && !c.isParallel).slice(0, 5).map((c) => c.cardNumber);
const OPP = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];

// 攻撃側の先頭リーダーを attackerId にして、相手リーダー0体目をダウン寸前にしてからアタックする
function awakenWith(attackerId) {
  const state = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: PP_TICKET,
    playerA: { leaderCardIds: [attackerId, 'BP05-L02', 'BP05-L03', 'BP05-L04'], deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: OPP, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
  });
  const target = state.players.playerB.leaders[0];
  target.damage = GameState.getLeaderCurrentHp(cardIndex, target) - 1;
  state.players.playerA.leaders[0].damage = 50; // 回復が見えるように
  const inst = GameState.createCardInstance(FILLER_ATTACK);
  state.players.playerA.hand.push(inst);
  const before = {
    hand: state.players.playerA.hand.length - 1,
    oppDamage: state.players.playerB.leaders.map((l) => l.damage),
  };
  EffectResolver.playAttackCardWithEffects(state, 'playerA', inst.instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[0].awakened, true, '前提：アタックで覚醒しているはず');
  return { state, before };
}

// ============================================================
console.log('=== 登録状況 ===');
// ============================================================
test('全リーダーに覚醒時効果が登録されている', () => {
  const missing = allCards.filter((c) => c.cardType === 'LEADER' && !CardEffectData.hasEffects(c.cardNumber));
  assert.deepStrictEqual(missing.map((c) => c.cardNumber), []);
});

// ============================================================
console.log('=== 6種の覚醒時効果（第5弾リーダーで検証） ===');
// ============================================================
test('自分のリーダー1体を20回復する（秋雪こはく）：既定では覚醒したリーダー自身', () => {
  const { state } = awakenWith('BP05-L01');
  assert.strictEqual(state.players.playerA.leaders[0].damage, 30);
});
test('カードを1枚引く（tttcheekyttt）', () => {
  const { state, before } = awakenWith('BP05-L08');
  assert.strictEqual(state.players.playerA.hand.length, before.hand + 1);
});
test('カードを2枚引き、手札を2枚捨てる（dtto.）：手札枚数は変わらない', () => {
  const { state, before } = awakenWith('BP05-L03');
  assert.strictEqual(state.players.playerA.hand.length, before.hand);
});
test('対戦相手のリーダー1体に10ダメージ（Ras (IGV)）', () => {
  const { state, before } = awakenWith('BP05-L12');
  const added = state.players.playerB.leaders.slice(1).reduce((s, l, i) => s + l.damage - before.oppDamage[i + 1], 0);
  assert.strictEqual(added, 10);
});
test('対戦相手のリーダー1体に20ダメージ（LEO）', () => {
  const { state, before } = awakenWith('BP05-L04');
  const added = state.players.playerB.leaders.slice(1).reduce((s, l, i) => s + l.damage - before.oppDamage[i + 1], 0);
  assert.strictEqual(added, 20);
});
test('対戦相手のリーダーすべてに10ダメージ（Selly (IGV)）：ダウンしたリーダーは対象外', () => {
  const { state } = awakenWith('BP05-L02');
  state.players.playerB.leaders.slice(1).forEach((l) => assert.strictEqual(l.damage, 10));
});
test('既に覚醒済みのリーダーでは再度発動しない', () => {
  const { state } = awakenWith('BP05-L02');
  const t = state.players.playerB.leaders[1];
  t.damage = GameState.getLeaderCurrentHp(cardIndex, t) - 1;
  const others = state.players.playerB.leaders.slice(2).map((l) => l.damage);
  const inst = GameState.createCardInstance(FILLER_ATTACK);
  state.players.playerA.hand.push(inst);
  state.players.playerA.ppCards.tapped = 0;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', inst.instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 1,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.deepStrictEqual(state.players.playerB.leaders.slice(2).map((l) => l.damage), others);
});

// ============================================================
console.log('=== 第5弾リーダーのデータ ===');
// ============================================================
test('第5弾は16名、各色4名、全員に画像がある', () => {
  const bp05 = allCards.filter((c) => c.cardType === 'LEADER' && c.set === 'BP05');
  assert.strictEqual(bp05.length, 16);
  ['red', 'blue', 'yellow', 'green'].forEach((col) => assert.strictEqual(bp05.filter((c) => c.color === col).length, 4, col));
  bp05.forEach((c) => assert.ok(c.imageUrl, c.cardNumber));
});
test('覚醒後HP/ATKは「HP+30・ATK+10」、未確認データとして扱われる', () => {
  allCards.filter((c) => c.cardType === 'LEADER' && c.set === 'BP05').forEach((c) => {
    assert.strictEqual(c.awakenHp, c.hp + 30);
    assert.strictEqual(c.awakenAtk, c.atk + 10);
    assert.strictEqual(c.confirmed, false);
  });
});
test('同名の既存リーダーとは別リーダー扱い（Cpt と Cpt (IGV)）', () => {
  assert.notStrictEqual(cardIndex['BP05-L11'].name, 'Cpt');
  assert.ok(allCards.some((c) => c.cardType === 'LEADER' && c.name === 'Cpt'));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
