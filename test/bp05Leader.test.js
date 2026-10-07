/* 第5弾のリーダー専用カード（C/UC/R）の自動テスト（node test/bp05Leader.test.js で実行）
 * 対象: レイジングスラッシュ／ミスショット／ブライトホーリー／ロングレンジスナイプ／ミッドナイトトーク／Cap-chicken／ハイリスク・ハイリターン／一般通過
 * （ロングレンジスナイプの新Action DAMAGE_ATTACKER_KEEP_MIN を中心に確認）
 *
 *
 * 対象:
 *  - data/source/all-cards.json: 第5弾ACEの台帳登録・画像
 *  - effectResolver.js 新Action: DECK_LOOK_ADD_TO_HAND / OPTIONAL_SELF_DAMAGE_THEN /
 *    DISCARD_COST_THEN_DECK_LOOK_FREE_ATTACK、エコー（runEndPhaseWithEffects/runStartPhaseWithEffects）
 *  - effectFactories.js: makeUpToNOpponentLeadersTarget / makeAttackerDamagedCondition / makeAttackerRemainingHpCondition
 *  - phases.js playAttackCard の freePlay
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

const LEADERS_A = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004'];
const LEADERS_B = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];
// このテストではアタックでダウンを取ることがあるため、覚醒時効果の影響を受けないようにする
LEADERS_A.concat(LEADERS_B).forEach((id) => { delete CardEffectData.REGISTRY[id]; });

const PP_TICKET = 'ST01-024';
const noEffect = (c) => !c.ban && !c.isParallel && !CardEffectData.hasEffects(c.cardNumber) && !CardEffectData.KEYWORDS[c.cardNumber];
const plainCard = require('./helpers/plainCard.js')(allCards, CardEffectData, __filename);
const FILLER_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 1);
const ATTACK_COST2 = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 2);
const ATTACK_COST3 = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 3);
const MEMORIA_COST0 = plainCard((c) => c.cardType === 'MEMORIA' && c.cost === 0 && c.ace !== true);
const MEMORIA_COST1 = plainCard((c) => c.cardType === 'MEMORIA' && c.cost === 1 && c.ace !== true);
const ATTACK_COST0 = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 0 && c.ace !== true);
const ACE_COST0 = allCards.filter((c) => c.cost === 0 && c.ace === true && ['ATTACK', 'MEMORIA'].includes(c.cardType) && !c.isParallel)[0].cardNumber;
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban && !c.isParallel).slice(0, 5).map((c) => c.cardNumber);

// 後攻（playerB）の手番。デッキ・手札は各テストで直接組み立てる。
function makeState() {
  const state = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: PP_TICKET,
    playerA: { leaderCardIds: LEADERS_A, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: LEADERS_B, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
  });
  state.turn.activePlayer = 'playerB';
  state.turn.turnNumber = 2;
  state.turn.tacticsPlayedThisTurn = false;
  ['playerA', 'playerB'].forEach((pid) => {
    state.players[pid].hand = [];
    state.players[pid].ppCards.max = 10;
    state.players[pid].ppCards.tapped = 0;
  });
  return state;
}
const inst = (id) => GameState.createCardInstance(id);
function setDeckTop(state, pid, ids) {
  state.players[pid].deck = ids.map(inst).concat(new Array(20).fill(FILLER_ATTACK).map(inst));
}
function toHand(state, pid, id) {
  const c = inst(id);
  state.players[pid].hand.push(c);
  return c.instanceId;
}
function attackWith(state, cardId, options) {
  const id = toHand(state, 'playerB', cardId);
  EffectResolver.playAttackCardWithEffects(state, 'playerB', id, Object.assign({
    attackerLeaderIndex: 0, targetPlayerId: 'playerA', targetLeaderIndex: 0,
  }, options || {}), cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
}
function playMemoria(state, cardId, options) {
  const id = toHand(state, 'playerB', cardId);
  EffectResolver.playMemoriaCardWithEffects(state, 'playerB', id, options || {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  return id;
}
const handIds = (state, pid) => state.players[pid].hand.map((c) => c.cardId);
const damages = (state, pid) => state.players[pid].leaders.map((l) => l.damage);
const atkOf = (state, pid, i) => GameState.getLeaderCurrentAtk(cardIndex, state.players[pid].leaders[i]);


// ============================================================
console.log('=== 台帳 ===');
// ============================================================
const CARDS = {
  'BP05-035': ['レイジングスラッシュ', 'ATTACK', 'yellow', 1, '胡桃のあ (IGV)', 'BP03-027'],
  'BP05-036': ['ミスショット', 'ATTACK', 'yellow', 1, 'Cpt (IGV)', 'BP01-023'],
  'BP05-042': ['ブライトホーリー', 'ATTACK', 'green', 1, '花芽すみれ (IGV)', 'BP01-024'],
  'BP05-044': ['ロングレンジスナイプ', 'ATTACK', 'green', 1, 'ハセシン', null],
  'BP05-063': ['ミッドナイトトーク', 'MEMORIA', 'yellow', 1, '胡桃のあ (IGV)', 'BP03-056'],
  'BP05-064': ['Cap-chicken', 'MEMORIA', 'yellow', 0, 'Cpt (IGV)', 'BP02-049'],
  'BP05-070': ['ハイリスク・ハイリターン', 'MEMORIA', 'green', 0, '花芽すみれ (IGV)', 'BP02-049'],
  'BP05-072': ['一般通過', 'MEMORIA', 'green', 1, 'ハセシン', 'BP01-079'],
};
test('8枚が名称・種類・色・コスト・ビルドルールつきで登録され、効果がある', () => {
  Object.keys(CARDS).forEach((n) => {
    const c = cardIndex[n];
    const [name, type, color, cost, leader] = CARDS[n];
    assert.ok(c, n);
    assert.deepStrictEqual([c.name, c.cardType, c.color, c.cost, c.set, c.ace], [name, type, color, cost, 'BP05', false], n);
    assert.strictEqual(c.buildRuleParsed && c.buildRuleParsed.leaderName, leader, n);
    assert.ok(CardEffectData.hasEffects(n), n);
    assert.strictEqual(c.imageUrl, 'cards/' + n + '.webp', n + ' の画像');
  });
});
test('同じテキストの既存カードと、効果の種類（トリガー）が同じ', () => {
  Object.keys(CARDS).forEach((n) => {
    const twin = CARDS[n][5];
    if (!twin) return;
    assert.strictEqual(cardIndex[n].text, cardIndex[twin].text, n + ' のテキスト');
    const trig = (id) => CardEffectData.getEffectsForCard(id).map((e) => e.trigger).join(',');
    assert.strictEqual(trig(n), trig(twin), n);
  });
});

// ============================================================
console.log('=== BP05-044 ロングレンジスナイプ ===');
// ============================================================
function snipe(attackerDamage, otherDown) {
  const state = makeState();
  state.players.playerB.leaders[0].damage = attackerDamage;
  if (otherDown) [1, 2, 3].forEach((i) => { state.players.playerA.leaders[i].isDown = true; });
  const before = damages(state, 'playerA');
  attackWith(state, 'BP05-044', { targetLeaderIndex: 0 });
  const after = damages(state, 'playerA');
  const others = [1, 2, 3].reduce((s, i) => s + (after[i] - before[i]), 0);
  const attacker = state.players.playerB.leaders[0];
  return { others, attackerHp: GameState.getLeaderCurrentHp(cardIndex, attacker), attackerDown: attacker.isDown };
}
test('相手の他のリーダー1体に20ダメージ、アタッカーに20ダメージ（体力100→80）', () => {
  const r = snipe(0, false);
  assert.strictEqual(r.others, 20);
  assert.strictEqual(r.attackerHp, 80);
  assert.strictEqual(r.attackerDown, false);
});
test('アタッカーの残り体力が20なら、ダウンせず残り10になる', () => {
  const r = snipe(80, false);
  assert.strictEqual(r.attackerHp, 10);
  assert.strictEqual(r.attackerDown, false);
});
test('アタッカーの残り体力が10なら、そのまま10（ダウンしない）', () => {
  const r = snipe(90, false);
  assert.strictEqual(r.attackerHp, 10);
  assert.strictEqual(r.attackerDown, false);
});
test('相手の他のリーダーがいなくても、アタッカーへの20ダメージは行う', () => {
  const r = snipe(0, true);
  assert.strictEqual(r.others, 0);
  assert.strictEqual(r.attackerHp, 80);
});

// ============================================================
console.log('=== 同文カードの動き ===');
// ============================================================
test('ミスショット：ダメージ+10', () => {
  const state = makeState();
  const before = state.players.playerA.leaders[0].damage;
  attackWith(state, 'BP05-036');
  assert.strictEqual(state.players.playerA.leaders[0].damage - before, atkOf(state, 'playerB', 0) + 10);
});
test('Cap-chicken／ハイリスク・ハイリターン：アタック後に1枚引く', () => {
  ['BP05-064', 'BP05-070'].forEach((n) => {
    const state = makeState();
    setDeckTop(state, 'playerB', []);
    playMemoria(state, n);
    const h = state.players.playerB.hand.length;
    attackWith(state, FILLER_ATTACK);
    assert.strictEqual(state.players.playerB.hand.length, h + 1, n);
  });
});
test('一般通過：次のアタック+50、アタック後に相手の他のリーダー1体に10ダメージ', () => {
  const state = makeState();
  playMemoria(state, 'BP05-072');
  const before = damages(state, 'playerA');
  attackWith(state, FILLER_ATTACK, { targetLeaderIndex: 0 });
  const after = damages(state, 'playerA');
  assert.strictEqual(after[0] - before[0], atkOf(state, 'playerB', 0) + 50);
  assert.strictEqual([1, 2, 3].reduce((s, i) => s + (after[i] - before[i]), 0), 10);
});
test('ブライトホーリー：メモリア2枚以上で相手の他のリーダーすべてに10ダメージ（1枚では無し）', () => {
  [[1, 0], [2, 30]].forEach(([mems, expect]) => {
    const state = makeState();
    for (let i = 0; i < mems; i++) playMemoria(state, MEMORIA_COST0);
    const before = damages(state, 'playerA');
    attackWith(state, 'BP05-042', { targetLeaderIndex: 0 });
    const after = damages(state, 'playerA');
    assert.strictEqual([1, 2, 3].reduce((s, i) => s + (after[i] - before[i]), 0), expect, 'メモリア' + mems + '枚');
  });
});
test('ミッドナイトトーク：アタックカードがプレイエリアにあればプレイ時に1枚引く', () => {
  const state = makeState();
  setDeckTop(state, 'playerB', []);
  attackWith(state, FILLER_ATTACK);
  const h = state.players.playerB.hand.length;
  playMemoria(state, 'BP05-063');
  assert.strictEqual(state.players.playerB.hand.length, h + 1);
});

// ============================================================
console.log('=== 第5弾リーダーの所属（カード画像の印字で確認）===');
// ============================================================
test('所属：CR／VSPO!／REJECT／Neo-Porte／印字なし', () => {
  const aff = (n) => (cardIndex[n].affiliations || []).join(',');
  ['BP05-L02', 'BP05-L04', 'BP05-L11', 'BP05-L12', 'BP05-L15'].forEach((n) => assert.strictEqual(aff(n), 'CR', n));
  ['BP05-L09', 'BP05-L10', 'BP05-L13', 'BP05-L14'].forEach((n) => assert.strictEqual(aff(n), 'VSPO!', n));
  ['BP05-L01', 'BP05-L03'].forEach((n) => assert.strictEqual(aff(n), 'REJECT', n));
  assert.strictEqual(aff('BP05-L07'), 'Neo-Porte');
  ['BP05-L05', 'BP05-L06', 'BP05-L08', 'BP05-L16'].forEach((n) => assert.strictEqual(aff(n), '', n));
});
test('魔王降臨：第5弾のCRリーダー4体だけでも「すべてがCR」になり、アタックを受けたリーダーがダウンする', () => {
  const state = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: PP_TICKET,
    playerA: { leaderCardIds: LEADERS_A, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: ['BP05-L02', 'BP05-L04', 'BP05-L11', 'BP05-L12'], deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
  });
  state.turn.activePlayer = 'playerB'; state.turn.turnNumber = 2;
  ['playerA', 'playerB'].forEach((pid) => { state.players[pid].hand = []; state.players[pid].ppCards.max = 10; state.players[pid].ppCards.tapped = 0; });
  attackWith(state, 'ST02-009', { targetLeaderIndex: 0 });
  assert.strictEqual(state.players.playerA.leaders[0].isDown, true);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
