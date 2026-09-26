/* Phase E: 条件付きON_ATTACK/ATTACK_BOOSTボーナス機構の自動テスト（node test/phaseE.test.js で実行）
 * 対象: js/engine/effectResolver.js（computeAttackCardBaseDamage・playMemoriaCardWithEffectsの変更）,
 *       js/engine/effectFactories.js（makeAllLeadersDifferentColorsConditionの新設）
 *
 * これまでcomputeAttackCardBaseDamage(cardId)はcardIdのみを受け取り、ATTACK_DAMAGE_BONUSに
 * conditionが付いていても評価できなかった（常に無条件で加算）。同様にATTACK_BOOSTのmodifierも
 * Combat.queueAttackBoostへ常に無条件で渡していた。本Phaseでこの2箇所にcondition評価を追加した。
 * 検証は実カード3枚（BP04-038アナイアレーション／BP02-038オールスターコンボ／BP03-059We are...!）
 * で行う。
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

const LEADERS_RAINBOW = ['BP01-001', 'BP01-005', 'BP01-009', 'BP01-013']; // 赤/青/黄/緑（全員異なる色）
const LEADERS_SAME_COLOR = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004']; // 全員red
const LEADERS_B = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];
const PP_TICKET = 'ST01-024';
const FILLER_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.color === 'red');
const FILLER_MEMORIA = plainCard((c) => c.cardType === 'MEMORIA');
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
      leaderCardIds: LEADERS_RAINBOW,
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

// プレイエリアに直接カードを積む（PPコストを消費せずに「すでに場に出ている」状況を作るテスト用ヘルパー。
// 既存のPLAY_AREA_TYPE_COUNT系テスト〔conditionTargetExpansion.test.js〕と同じ考え方）
function pushToPlayArea(state, playerId, cardId) {
  const instance = GameState.createCardInstance(cardId);
  state.players[playerId].playArea.push({ card: instance, order: state.players[playerId].playArea.length, pendingTriggers: [] });
}

// ============================================================
console.log('=== BP04-038 アナイアレーション（自分のリーダーの色がすべて異なるなら） ===');
// ============================================================

test('リーダーの色がすべて異なる場合：ON_ATTACK+30とAFTER_ATTACKの3効果が発動する', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerA.leaders[0].damage = 40; // 攻撃者自身への回復を確認するため先にダメージを負わせておく
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP04-038');
  const handBeforeAttack = state.players.playerA.hand.length - 1;

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 30 + atk, 'ON_ATTACKの+30が加算されているはず');

  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 30, '対戦相手の他のリーダー1体に30ダメージ');
  assert.strictEqual(state.players.playerA.leaders[0].damage, 10, '攻撃者自身が30回復されて40->10になるはず');
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 1, 'カードを1枚引くはず');
});

test('リーダーの色が重複している場合：ON_ATTACK/AFTER_ATTACKとも発動しない', () => {
  const state = Match.createMatch(makeMatchConfig({
    playerA: { leaderCardIds: LEADERS_SAME_COLOR, deckCardIds: fillDeck(FILLER_ATTACK, 50), tacticsDeckCardIds: TACTICS_5 },
  }));
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP04-038');
  const handBeforeAttack = state.players.playerA.hand.length - 1;

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, atk, '色が重複しているのでON_ATTACKの+30は乗らないはず');

  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 0);
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack, 'ドローも発生しないはず');
});

// ============================================================
console.log('=== BP02-038 オールスターコンボ（プレイエリアの他アタックカード枚数による段階ボーナス） ===');
// ============================================================

test('他のアタックカードが0枚：ボーナスなし', () => {
  const state = Match.createMatch(makeMatchConfig());
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP02-038');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, atk);
});

test('他のアタックカードが2枚：+40', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', FILLER_ATTACK);
  pushToPlayArea(state, 'playerA', FILLER_ATTACK);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP02-038');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 40 + atk);
});

test('他のアタックカードが4枚：+40と+20が両方乗って合計+60', () => {
  const state = Match.createMatch(makeMatchConfig());
  for (let i = 0; i < 4; i++) pushToPlayArea(state, 'playerA', FILLER_ATTACK);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP02-038');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 60 + atk);
});

test('このカード自身はプレイ前提のためカウントに含まれない（コスト等は問わずプレイエリアに積まれる前に判定する）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP02-038');
  // 他に何も無い状態でプレイ -> このカード自身を「他の」に数えて無限ループ的に自己参照しないことの確認
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, atk, '自分自身は「他のアタックカード」には数えないはず');
});

// ============================================================
console.log('=== BP03-059 We are...!（ON_PLAY条件・ATTACK_BOOST条件の両方） ===');
// ============================================================

test('プレイエリアにアタックカードが0枚：ON_PLAYは発動しない', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP03-059');
  const handBefore = state.players.playerA.hand.length;
  state.players.playerA.leaders[0].damage = 50;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 50, '条件不成立なので回復しないはず');
  assert.strictEqual(state.players.playerA.hand.length, handBefore - 1, '条件不成立なのでドローもしないはず');
});

test('プレイエリアにアタックカードが2枚：ON_PLAYで自分のリーダーを30回復・カードを2枚引く', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', FILLER_ATTACK);
  pushToPlayArea(state, 'playerA', FILLER_ATTACK);
  state.players.playerA.leaders[0].damage = 50;
  const instanceId = injectHand(state, 'playerA', 'BP03-059');
  const handBefore = state.players.playerA.hand.length;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 20, '50ダメージから30回復して残り20になるはず');
  assert.strictEqual(state.players.playerA.hand.length, handBefore - 1 + 2);
});

test('プレイエリアにメモリアカードが3枚未満（このカード自身含む）：ATTACK_BOOSTは発動しない', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA); // これで自分自身と合わせて2枚
  const instanceId = injectHand(state, 'playerA', 'BP03-059');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  assert.strictEqual(state.players.playerA.pendingAttackBoost || 0, 0, '3枚未満なのでアタック強化は乗らないはず');
});

test('プレイエリアにメモリアカードが3枚以上（このカード自身を含めて数える）：ATTACK_BOOST+70が乗る', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA);
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA);
  // この時点でプレイエリアのメモリアは2枚。We are...!自身がプレイされて3枚目になった瞬間に判定する。
  const instanceId = injectHand(state, 'playerA', 'BP03-059');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  assert.strictEqual(state.players.playerA.pendingAttackBoost, 70, '自分自身を含めて3枚になるのでアタック強化+70が乗るはず');
});

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
