/* Phase L: 所属（VSPO!/CR）と、台帳のテキストが「要確認」だったカードの登録の自動テスト（node test/phaseL.test.js で実行）
 *
 * 対象:
 *  - data/source/affiliations.json → カードデータの affiliations（ユーザー提供のカード画像で確認）
 *  - ST01-005 クロスファイア / ST02-009 魔王降臨（リーダーすべてが〇〇なら、アタックを受けたリーダーはダウン）
 *  - ST01-016 初の栄冠 / ST02-012 変わらない関係（〇〇を持つリーダー1体につき10ダメージ）
 *  - 焦土の王者（1枚引いて1枚捨てる）など、テキストが「要確認」だった16枚
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

const VSPO = ['ST01-001', 'ST01-002', 'ST01-003', 'ST01-004']; // 一ノ瀬うるは・小雀とと・花芽すみれ・花芽なずな
const CR = ['ST02-001', 'ST02-002', 'ST02-003', 'ST02-004']; // Selly・Mondo・Cpt・Ras
const MIXED = ['ST01-001', 'ST01-002', 'ST01-003', 'ST02-001'];
const OPP = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];
VSPO.concat(CR, OPP).forEach((id) => { delete CardEffectData.REGISTRY[id]; }); // 覚醒時効果の影響を受けないように
const plainCard = require('./helpers/plainCard.js')(allCards, CardEffectData, __filename);
const FILLER_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 1);
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban && !c.isParallel).slice(0, 5).map((c) => c.cardNumber);

function makeState(leadersB) {
  const state = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: 'ST01-024',
    playerA: { leaderCardIds: OPP, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: leadersB || VSPO, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
  });
  state.turn.activePlayer = 'playerB';
  state.turn.turnNumber = 2;
  ['playerA', 'playerB'].forEach((pid) => { state.players[pid].hand = []; state.players[pid].ppCards.max = 10; state.players[pid].ppCards.tapped = 0; });
  return state;
}
const inst = (id) => GameState.createCardInstance(id);
function toHand(state, id) { const c = inst(id); state.players.playerB.hand.push(c); return c.instanceId; }
function attackWith(state, cardId, options) {
  const id = toHand(state, cardId);
  EffectResolver.playAttackCardWithEffects(state, 'playerB', id, Object.assign({ attackerLeaderIndex: 0, targetPlayerId: 'playerA', targetLeaderIndex: 0 }, options || {}), cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
}
function playMemoria(state, cardId, options) {
  const id = toHand(state, cardId);
  EffectResolver.playMemoriaCardWithEffects(state, 'playerB', id, options || {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
}
const others = (s) => s.players.playerA.leaders.slice(1).map((l) => l.damage);

// ============================================================
console.log('=== 所属データ ===');
// ============================================================
test('VSPO! は27名、CR は25名。重なりは無い', () => {
  const leaders = allCards.filter((c) => c.cardType === 'LEADER');
  const v = leaders.filter((c) => (c.affiliations || []).includes('VSPO!'));
  const cr = leaders.filter((c) => (c.affiliations || []).includes('CR'));
  assert.strictEqual(v.length, 27);
  assert.strictEqual(cr.length, 25);
  assert.ok(!v.some((c) => cr.includes(c)));
  VSPO.forEach((n) => assert.ok(cardIndex[n].affiliations.includes('VSPO!'), n));
  CR.forEach((n) => assert.ok(cardIndex[n].affiliations.includes('CR'), n));
});

// ============================================================
console.log('=== クロスファイア / 魔王降臨 ===');
// ============================================================
test('クロスファイア：自分のリーダーがすべてVSPO!なら、アタックを受けたリーダーはダウンし、アタッカーは覚醒する', () => {
  const s = makeState(VSPO);
  attackWith(s, 'ST01-005');
  assert.strictEqual(s.players.playerA.leaders[0].isDown, true);
  assert.strictEqual(s.players.playerB.leaders[0].awakened, true);
});
test('クロスファイア：1体でもVSPO!でなければ、通常のダメージだけ（ダウンした状態のリーダーも数える）', () => {
  const s = makeState(MIXED);
  attackWith(s, 'ST01-005');
  assert.strictEqual(s.players.playerA.leaders[0].isDown, false);
  assert.strictEqual(s.players.playerA.leaders[0].damage, 30);
  const s2 = makeState(VSPO);
  s2.players.playerB.leaders[3].isDown = true;
  attackWith(s2, 'ST01-005');
  assert.strictEqual(s2.players.playerA.leaders[0].isDown, true, 'ダウン中のリーダーもVSPO!なので条件を満たす');
});
test('魔王降臨：自分のリーダーがすべてCRならダウン、VSPO!デッキでは通常のダメージ', () => {
  let s = makeState(CR); attackWith(s, 'ST02-009'); assert.strictEqual(s.players.playerA.leaders[0].isDown, true);
  s = makeState(VSPO); attackWith(s, 'ST02-009'); assert.strictEqual(s.players.playerA.leaders[0].isDown, false);
});

// ============================================================
console.log('=== 初の栄冠 / 変わらない関係 ===');
// ============================================================
test('初の栄冠：アタック強化+30。アタック後、他のリーダー1体に「VSPO!の数×10」', () => {
  let s = makeState(VSPO); playMemoria(s, 'ST01-016'); attackWith(s, FILLER_ATTACK);
  assert.deepStrictEqual(others(s), [40, 0, 0]);
  s = makeState(MIXED); playMemoria(s, 'ST01-016'); attackWith(s, FILLER_ATTACK);
  assert.deepStrictEqual(others(s), [30, 0, 0]);
});
test('変わらない関係：CRの数×10（VSPO!だけのデッキでは0なので何もしない）', () => {
  let s = makeState(CR); playMemoria(s, 'ST02-012'); attackWith(s, FILLER_ATTACK);
  assert.deepStrictEqual(others(s), [40, 0, 0]);
  s = makeState(VSPO); playMemoria(s, 'ST02-012'); attackWith(s, FILLER_ATTACK);
  assert.deepStrictEqual(others(s), [0, 0, 0]);
});

// ============================================================
console.log('=== テキストが「要確認」だったカード ===');
// ============================================================
test('台帳にテキストが「要確認」のカードが残っていない', () => {
  const src = require('../data/source/all-cards.json');
  assert.deepStrictEqual(src.filter((c) => c['カードテキスト'] === '要確認').map((c) => c['カード番号']), []);
});
test('焦土の王者：1枚引いて、手札を1枚捨てる（捨てるカードは選べる）', () => {
  const s = makeState();
  toHand(s, FILLER_ATTACK);
  const keep = s.players.playerB.hand[0].instanceId;
  playMemoria(s, 'BP02-054', { chooseDiscard: (hand) => [hand.find((c) => c.instanceId !== keep).instanceId] });
  assert.deepStrictEqual(s.players.playerB.hand.map((c) => c.instanceId), [keep]);
  assert.strictEqual(s.players.playerB.trash.length, 1);
});
test('花火づくり：2枚引いて2枚捨てる＋アタック強化+30', () => {
  const s = makeState();
  playMemoria(s, 'BP01-072');
  assert.strictEqual(s.players.playerB.hand.length, 0);
  assert.strictEqual(s.players.playerB.pendingAttackBoost, 30);
});
test('偶然の邂逅：アタック強化+30、アタック後に他のリーダーすべてに10', () => {
  const s = makeState(); playMemoria(s, 'BP01-078'); attackWith(s, FILLER_ATTACK);
  assert.deepStrictEqual(others(s), [10, 10, 10]);
  assert.strictEqual(s.players.playerA.leaders[0].damage, 60);
});
test('ドレッドフォーム：アタック後、他のリーダー1体に10', () => {
  const s = makeState(); attackWith(s, 'BP02-026'); assert.deepStrictEqual(others(s), [10, 0, 0]);
});
test('スリフティプレイ：ダメージ-20（攻撃力30なら10）', () => {
  const s = makeState(); attackWith(s, 'BP01-048'); assert.strictEqual(s.players.playerA.leaders[0].damage, 10);
});
test('ケーキのおうち：自分のリーダー1体を30回復＋強化+30', () => {
  const s = makeState(); s.players.playerB.leaders[0].damage = 50;
  playMemoria(s, 'BP02-047');
  assert.strictEqual(s.players.playerB.leaders[0].damage, 20);
  assert.strictEqual(s.players.playerB.pendingAttackBoost, 30);
});
test('台帳を更新した16枚のビルドルールとACE', () => {
  assert.strictEqual(cardIndex['BP01-048'].buildRule, 'リーダー：ありさか');
  assert.strictEqual(cardIndex['BP02-056'].buildRule, 'リーダー：かずのこ');
  assert.strictEqual(cardIndex['BP02-054'].buildRule, null);
  ['BP01-048', 'BP02-054', 'ST01-018'].forEach((n) => assert.strictEqual(cardIndex[n].ace, false, n));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
