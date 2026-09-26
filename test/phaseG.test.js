/* Phase G: FREE_PLAY_MEMORIA_FROM_HAND / DECK_LOOK_FREE_PLAY_MEMORIA / REPLAY_SELECTED_FROM_PLAY_AREA
 * の自動テスト（node test/phaseG.test.js で実行）
 * 対象: js/engine/effectResolver.js（3つの新Action・playMemoriaForFreeAndQueueEffectsヘルパー）
 *
 * 実カード: BP01-017 一騎当千（手札から選んでコスト無しでプレイ）,
 *           BP01-044 リンク・アサルト（デッキルック3枚から1枚選んでコスト無しでプレイ）,
 *           BP02-024 三銃士（プレイエリアのコスト0メモリアを選んでプレイし直す）
 *
 * 注意：これら3枚の効果はすべてAFTER_ATTACKで登録されているため、playAttackCardWithEffects()の
 * 呼び出し時点ではResolutionStackへ積まれるだけで、実際の処理（手札除去・デッキ操作・トラッシュ・
 * ON_PLAY再発火）はResolutionStack.resolveAll()を呼ぶまで発生しない。各テストで必ず解決してから検証する。
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

const LEADERS_A = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004'];
const LEADERS_B = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];
const PP_TICKET = 'ST01-024';
const FILLER_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.color === 'red');
const BLUE_ATTACK = allCards.filter((c) => c.cardType === 'ATTACK' && c.color === 'blue' && !c.ban)[0].cardNumber;
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban).slice(0, 5).map((c) => c.cardNumber);
const TACTICS_5_B = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban).slice(5, 10).map((c) => c.cardNumber);

function fillDeck(cardId, count) {
  return new Array(count).fill(cardId);
}

function makeMatchConfig(overrides) {
  return Object.assign({
    matchId: 'test-match',
    mode: 'STANDARD',
    firstPlayer: 'playerA',
    ppTicketCardId: PP_TICKET,
    playerA: {
      leaderCardIds: LEADERS_A,
      deckCardIds: fillDeck(FILLER_ATTACK, 50),
      tacticsDeckCardIds: TACTICS_5,
    },
    playerB: {
      leaderCardIds: LEADERS_B,
      deckCardIds: fillDeck(BLUE_ATTACK, 50),
      tacticsDeckCardIds: TACTICS_5_B,
    },
  }, overrides);
}

function injectHand(state, playerId, cardId) {
  const instance = GameState.createCardInstance(cardId);
  state.players[playerId].hand.push(instance);
  return instance.instanceId;
}

function pushToPlayArea(state, playerId, cardId) {
  const instance = GameState.createCardInstance(cardId);
  state.players[playerId].playArea.push({ card: instance, order: state.players[playerId].playArea.length, pendingTriggers: [] });
  return instance.instanceId;
}

// ============================================================
console.log('=== BP01-017 一騎当千（FREE_PLAY_MEMORIA_FROM_HAND, costLimit:3） ===');
// ============================================================

test('選択コールバック未提供：辞退扱いで何もプレイされない', () => {
  const state = Match.createMatch(makeMatchConfig());
  injectHand(state, 'playerA', 'BP01-058'); // 危機一髪（cost1, ON_PLAY: draw2）候補として手札に置いておく
  const instanceId = injectHand(state, 'playerA', 'BP01-017');
  const handBeforeAttack = state.players.playerA.hand.length - 1; // 一騎当千プレイ直前の基準（危機一髪を含む）

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack, '辞退なので危機一髪は手札に残ったままのはず');
});

test('選んだメモリア（合計コスト2）が2枚ともコスト無しでプレイされる', () => {
  const state = Match.createMatch(makeMatchConfig());
  const kikiIppatsu = injectHand(state, 'playerA', 'BP01-058'); // cost1, ON_PLAY: draw2
  const kunanNoShoukaku = injectHand(state, 'playerA', 'BP01-063'); // cost1, ON_PLAY: draw2+discard2(self), ATTACK_BOOST+30
  const tappedBefore = state.players.playerA.ppCards.tapped;
  const instanceId = injectHand(state, 'playerA', 'BP01-017');
  const handBeforeAttack = state.players.playerA.hand.length - 1;

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
    chooseFreePlayFromHand: (candidates) => candidates.map((c) => c.instanceId), // 両方選ぶ
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  assert.strictEqual(state.players.playerA.hand.find((c) => c.instanceId === kikiIppatsu), undefined, '危機一髪は手札から出ているはず');
  assert.strictEqual(state.players.playerA.hand.find((c) => c.instanceId === kunanNoShoukaku), undefined, '苦難の昇格も手札から出ているはず');
  assert.strictEqual(state.players.playerA.playArea.some((e) => e.card.instanceId === kikiIppatsu), true, 'プレイエリアに積まれているはず');
  // コストを支払わずにプレイしているので、一騎当千(cost2)以外のPPタップは増えないはず
  assert.strictEqual(state.players.playerA.ppCards.tapped, tappedBefore + cardIndex['BP01-017'].cost);
  // 危機一髪(draw2, +2)＋苦難の昇格(draw2discard2、差引0) -> 手札は移動分(-2)と相殺して結局±0
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack, '出た2枚の分、引いた分が相殺して元の枚数に戻るはず');
  assert.strictEqual(state.players.playerA.pendingAttackBoost, 30, '苦難の昇格のアタック強化+30もコスト無しプレイで正しく乗るはず');
});

test('合計コストが上限(3)を超える選択は、超過分が無視される', () => {
  const state = Match.createMatch(makeMatchConfig());
  const ids = [
    injectHand(state, 'playerA', 'BP01-058'),
    injectHand(state, 'playerA', 'BP01-058'),
    injectHand(state, 'playerA', 'BP01-058'),
    injectHand(state, 'playerA', 'BP01-058'),
  ]; // cost1×4 = 合計4 > costLimit(3)
  const instanceId = injectHand(state, 'playerA', 'BP01-017');

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
    chooseFreePlayFromHand: () => ids, // 4枚とも選ぼうとする
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  const playedCount = ids.filter((id) => state.players.playerA.playArea.some((e) => e.card.instanceId === id)).length;
  assert.strictEqual(playedCount, 3, '合計コストが3を超えないよう、先頭から3枚だけプレイされるはず');
});

// ============================================================
console.log('=== BP01-044 リンク・アサルト（DECK_LOOK_FREE_PLAY_MEMORIA, count:3, maxCost:1） ===');
// ============================================================

test('選択コールバック未提供：デッキ上から3枚が全て裏向きでトラッシュに置かれる', () => {
  const state = Match.createMatch(makeMatchConfig({
    playerA: { leaderCardIds: LEADERS_A, deckCardIds: ['BP01-058', 'BP01-058', 'BP01-058'].concat(fillDeck(FILLER_ATTACK, 47)), tacticsDeckCardIds: TACTICS_5 },
  }));
  const deckBefore = state.players.playerA.deck.length;
  const trashBefore = state.players.playerA.trash.length;
  const instanceId = injectHand(state, 'playerA', 'BP01-044');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.deck.length, deckBefore - 3);
  assert.strictEqual(state.players.playerA.trash.length, trashBefore + 3);
  assert.ok(state.players.playerA.trash.slice(-3).every((t) => t.faceUp === false), '見た残りは裏向きでトラッシュに置かれるはず');
});

test('コスト1以下のメモリアを1枚選んでコスト無しでプレイし、残り2枚はトラッシュに置かれる', () => {
  // Match.createMatch()内でデッキをシャッフルするため、上から3枚を確実に候補にするには
  // デッキ全体を候補カードで統一する（一部だけ混ぜても、シャッフル後に候補が0枚になり得る）。
  const state = Match.createMatch(makeMatchConfig({
    playerA: { leaderCardIds: LEADERS_A, deckCardIds: fillDeck('BP01-058', 50), tacticsDeckCardIds: TACTICS_5 },
  }));
  const instanceId = injectHand(state, 'playerA', 'BP01-044');
  const handBeforeAttack = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
    chooseDeckLookPlay: (candidates) => candidates[0].instanceId,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.playArea.length, 2, 'リンク・アサルト自身＋選んだメモリア1枚がプレイエリアに積まれるはず');
  assert.strictEqual(state.players.playerA.trash.length, 2, '選ばなかった残り2枚はトラッシュへ');
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 2, 'リンク・アサルトはプレイ済み。危機一髪のドロー2枚だけ増えるはず');
});

// ============================================================
console.log('=== BP02-024 三銃士（REPLAY_SELECTED_FROM_PLAY_AREA, maxCount:2, maxCost:0） ===');
// ============================================================

// 現行データにはコスト0・非ACEで効果登録済みのメモリアが実在しないため、実在するコスト0・非ACEの
// メモリア（BP01-056、元々は効果未登録）にテスト専用の一時的なON_PLAY効果を登録し、
// REPLAY_SELECTED_FROM_PLAY_AREAが実際に候補として拾ってON_PLAYを再発火できることを検証する。
// テスト終了後は必ずレジストリから削除し、他のテストへ影響しないようにする。
const REPLAY_TEST_CARD = 'BP01-056';
const originalReplayTestEntry = CardEffectData.REGISTRY[REPLAY_TEST_CARD];
CardEffectData.REGISTRY[REPLAY_TEST_CARD] = [
  { trigger: 'ON_PLAY', condition: null, target: null, action: { type: 'DRAW', amount: 1 }, modifier: null, duration: null, replacement: null, cost: null },
];

test('選択コールバック未提供：辞退扱いで何も再発火しない', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', REPLAY_TEST_CARD);
  const instanceId = injectHand(state, 'playerA', 'BP02-024');
  const handBeforeAttack = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack, '辞退なので何も再発火しないはず');
});

test('選んだプレイエリアのカードのON_PLAYが再発火する（カード自体は移動しない）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const replayInstanceId = pushToPlayArea(state, 'playerA', REPLAY_TEST_CARD);
  const instanceId = injectHand(state, 'playerA', 'BP02-024');
  const handBeforeAttack = state.players.playerA.hand.length - 1;

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
    chooseReplayFromPlayArea: (candidates) => candidates.map((c) => c.instanceId),
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 1, '再発火したドロー1枚の分だけ増えるはず');
  assert.strictEqual(state.players.playerA.playArea.filter((e) => e.card.instanceId === replayInstanceId).length, 1, 'プレイエリアのカードは複製・移動しない');
});

test('maxCount(2)を超える選択は先頭2件のみ処理される', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', REPLAY_TEST_CARD);
  pushToPlayArea(state, 'playerA', REPLAY_TEST_CARD);
  pushToPlayArea(state, 'playerA', REPLAY_TEST_CARD);
  const instanceId = injectHand(state, 'playerA', 'BP02-024');
  const handBeforeAttack = state.players.playerA.hand.length - 1;

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
    chooseReplayFromPlayArea: (candidates) => candidates.map((c) => c.instanceId), // 3件選ぼうとする
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 2, '3件選んでもmaxCount=2なので2回分のドローしか発生しないはず');
});

if (originalReplayTestEntry === undefined) delete CardEffectData.REGISTRY[REPLAY_TEST_CARD];
else CardEffectData.REGISTRY[REPLAY_TEST_CARD] = originalReplayTestEntry;

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
