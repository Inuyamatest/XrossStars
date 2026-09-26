/* Card Effect Engine — Phase D-3A 自動テスト（node test/equipGrantAbility.test.js で実行）
 * 対象: js/engine/effectResolver.js（EQUIP_GRANT_ABILITY統合、queueOnPlayEffectsのマーカー除外）、
 *       js/engine/effectFactories.js（ONCE_PER_TURN_USEDのラウンド跨ぎ衝突バグ修正）、
 *       js/engine/cardEffectData.js に今回追加した実カード群（盗賊キット×2, ヒーリングオーブ）
 *
 * 既存ファイル（cardEffect.js/gameState.js/events.js/resolutionStack.js/deck.js/combat.js/phases.js/
 * match.js、js/deckbuilder/、data/cards.json）は無改修。
 * 既存テスト（gameEngine/deckRules/cardEffect/cardEffectIntegration/discardAndAtkModifier/
 * conditionTargetExpansion）はすべて無変更のまま成功することを別途確認済み。
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const GameState = require('../js/engine/gameState.js');
const ResolutionStack = require('../js/engine/resolutionStack.js');
const Match = require('../js/engine/match.js');
const CardEffectData = require('../js/engine/cardEffectData.js');

// このファイルは他のカード効果を検証するため、フィクスチャのリーダーのうち後から覚醒時効果を登録した
// 第1弾6名の覚醒時効果をこのファイル内でだけ無効化する（アタックでダウンを取ると攻撃側が覚醒し、
// 検証対象と無関係なダメージ/ドローが混ざるため）。覚醒時効果そのものは test/leaderAwaken.test.js で検証する。
['BP01-001', 'BP01-002', 'BP01-004', 'BP01-005', 'BP01-006', 'BP01-008'].forEach(function (id) {
  CardEffectData.REGISTRY[id] = (CardEffectData.REGISTRY[id] || []).filter(function (e) { return e.trigger !== 'ON_AWAKEN'; });
});
const EffectResolver = require('../js/engine/effectResolver.js');
const EffectFactories = require('../js/engine/effectFactories.js');

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
const BLUE_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.color === 'blue');
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban).slice(0, 5).map((c) => c.cardNumber);
const TACTICS_5_B = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban).slice(5, 10).map((c) => c.cardNumber);

function fillDeck(cardId, count) { return new Array(count).fill(cardId); }

function makeMatchConfig(overrides) {
  return Object.assign({
    matchId: 'd3a-test-match',
    mode: 'STANDARD',
    firstPlayer: 'playerA',
    ppTicketCardId: PP_TICKET,
    playerA: { leaderCardIds: LEADERS_A, deckCardIds: fillDeck(FILLER_ATTACK, 50), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: LEADERS_B, deckCardIds: fillDeck(BLUE_ATTACK, 50), tacticsDeckCardIds: TACTICS_5_B },
  }, overrides);
}

function injectHand(state, playerId, cardId) {
  const instance = GameState.createCardInstance(cardId);
  state.players[playerId].hand.push(instance);
  return instance.instanceId;
}
function injectTactics(state, playerId, cardId) {
  const instance = GameState.createCardInstance(cardId);
  state.players[playerId].tacticsArea.push({ card: instance, faceUp: false });
  return instance.instanceId;
}
function equip(state, playerId, cardId, leaderIndex) {
  const instanceId = injectTactics(state, playerId, cardId);
  state.turn.tacticsPlayedThisTurn = false; // 1ターン1枚制限を回避する準備（ルールとは無関係）
  return EffectResolver.playTacticsCardWithEffects(state, playerId, instanceId, { subType: 'EQUIPMENT', equipLeaderIndex: leaderIndex }, cardIndex);
}
function freshMatchAtTurn2() {
  const state = Match.createMatch(makeMatchConfig());
  state.turn.turnNumber = 2; // 先攻1ターン目のタクティクス制限を避ける（PROVISIONALとは無関係の単純な準備）
  return state;
}

// ============================================================
console.log('=== Phase D-2監査で発見したバグの修正確認: ONCE_PER_TURN_USEDのラウンド跨ぎ衝突 ===');
// ============================================================

test('ラウンドをまたぐと、たまたま同じturnNumberでも「未使用」と正しく判定される', () => {
  const state = { match: { roundNumber: 1 }, turn: { turnNumber: 3 } };
  EffectFactories.markEffectUsedThisTurn(state, 'equip#audit');
  assert.strictEqual(EffectFactories.isEffectUsedThisTurn(state, 'equip#audit'), true);
  state.match.roundNumber = 2;
  state.turn.turnNumber = 3; // 修正前は誤って「使用済み」と判定されていた
  assert.strictEqual(EffectFactories.isEffectUsedThisTurn(state, 'equip#audit'), false);
});

// ============================================================
console.log('=== Test1: 装備プレイで能力が付与される ===');
// ============================================================

test('Test1: 盗賊キットを装備するとgrantedAbilitiesが付与される', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP02-078', 0);
  const leader = state.players.playerA.leaders[0];
  assert.strictEqual(leader.equipment.length, 1);
  assert.strictEqual(leader.equipment[0].grantedAbilities.length, 1);
  assert.strictEqual(leader.equipment[0].grantedAbilities[0].trigger, 'AFTER_ATTACK');
});

// ============================================================
console.log('=== Test2/3: 付与された能力の発動・Condition不成立時は発動しない ===');
// ============================================================

test('Test2: 付与された能力が指定Trigger(AFTER_ATTACK)で発動する（相手をダウンさせるとカードを1枚引く）', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP02-078', 0);
  state.players.playerB.leaders[0].damage = 75; // atk30の1撃で確実にダウンする
  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK);
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1);
});

test('Test3: Conditionがfalse（ダウンしていない）なら発動しない', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP02-078', 0);
  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK);
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, false);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore);
});

// ============================================================
console.log('=== Test4/5: ONCE_PER_TURN（同一ターン2回目不可・次ターンで再度可能） ===');
// ============================================================

test('Test4: 1ターン中に2回ダウンさせても、装備能力は1回しか発動しない', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.ppCards.max = 10; // 複数回攻撃カードをプレイして検証するための準備（ルールとは無関係）
  equip(state, 'playerA', 'BP02-078', 0);
  state.players.playerB.leaders[0].damage = 75;
  state.players.playerB.leaders[1].damage = 75;

  const instance1 = injectHand(state, 'playerA', FILLER_ATTACK);
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instance1, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1, '1回目は発動するはず');

  const instance2 = injectHand(state, 'playerA', FILLER_ATTACK);
  const handBeforeSecond = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instance2, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 1 }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[1].isDown, true, '2回目の攻撃もダウンさせる前提');
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBeforeSecond, '同一ターン2回目は発動しないはず');
});

test('Test5: 次ターンになると再度発動可能になる', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.ppCards.max = 10;
  equip(state, 'playerA', 'BP02-078', 0);
  state.players.playerB.leaders[0].damage = 75;
  const instance1 = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instance1, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  state.turn.turnNumber += 1; // ターン進行（phases.js相当の効果のみをここでは検証）
  state.players.playerB.leaders[1].damage = 75;
  const instance2 = injectHand(state, 'playerA', FILLER_ATTACK);
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instance2, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 1 }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1, 'ターンが進んだので再び発動できるはず');
});

// ============================================================
console.log('=== Test6/10: 複数の異なる装備の使用回数が干渉しない・すべて評価される ===');
// ============================================================

test('Test6/10: 盗賊キットとヒーリングオーブを同時装備→両方独立して発動する', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP02-078', 0); // 盗賊キット：ダウン条件でドロー1
  ResolutionStack.resolveAll(state.resolutionStack, state); // ヒーリングオーブのプレイ時60回復と混ざらないよう先に流す
  state.players.playerA.leaders[0].damage = 50;
  equip(state, 'playerA', 'BP02-079', 0); // ヒーリングオーブ：プレイ時60回復＋無条件でアタック後20回復
  ResolutionStack.resolveAll(state.resolutionStack, state); // プレイ時60回復を先に解決しておく
  assert.strictEqual(state.players.playerA.leaders[0].damage, 0, '50ダメージ-60回復=0（マイナスにはならない）');

  state.players.playerA.leaders[0].damage = 30; // アタック後20回復の検証用に再度ダメージを乗せる
  state.players.playerB.leaders[0].damage = 75;
  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK);
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 2, '盗賊キットのドローとヒーリングオーブの回復、両方が積まれるはず');
  ResolutionStack.resolveAll(state.resolutionStack, state);

  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1, '盗賊キットのドローが発動しているはず');
  assert.strictEqual(state.players.playerA.leaders[0].damage, 10, '30ダメージ-20回復=10（ヒーリングオーブの装備能力も発動しているはず）');
});

// ============================================================
console.log('=== Test7: 同じ装備カードを2枚装備した場合、それぞれ独立している ===');
// ============================================================

test('Test7: 盗賊キットを2枚装備すると、1回の攻撃でドローが2回発動する', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP02-078', 0);
  equip(state, 'playerA', 'BP02-078', 0); // 同じカードをもう1枚、同じリーダーへ装備
  const leader = state.players.playerA.leaders[0];
  assert.strictEqual(leader.equipment.length, 2);
  assert.notStrictEqual(leader.equipment[0].instanceId, leader.equipment[1].instanceId, '装備インスタンスは別物のはず');

  state.players.playerB.leaders[0].damage = 75;
  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK);
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 2, '2枚それぞれが独立したPendingEffectとして積まれるはず');
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 2, '2枚分のドローが両方発動するはず');
});

// ============================================================
console.log('=== Test8: 装備能力によるActionがResolutionStackで正しく解決される ===');
// ============================================================

test('Test8: 装備能力はResolutionStackに積まれ、resolveするまで反映されない', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP02-078', 0);
  state.players.playerB.leaders[0].damage = 75;
  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK);
  const handAfterPlay = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  assert.strictEqual(state.players.playerA.hand.length, handAfterPlay, 'resolve前はまだ反映されない');
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 1);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handAfterPlay + 1, 'resolve後に反映される');
});

// ============================================================
console.log('=== Test9: 既存の通常カード効果と装備能力が同一Triggerで競合しても壊れない ===');
// ============================================================

test('Test9: ギャングの襲撃(通常のAFTER_ATTACK効果)と盗賊キット(装備能力)が同時に発動しても両方正しく動く', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP02-078', 0);
  state.players.playerB.leaders[0].damage = 75;
  const instanceId = injectHand(state, 'playerA', 'BP01-021'); // ギャングの襲撃：ダウンしていればカードを1枚引く
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 2, '通常カードのAFTER_ATTACKと装備能力のAFTER_ATTACKが両方積まれるはず');
  assert.doesNotThrow(() => { ResolutionStack.resolveAll(state.resolutionStack, state); });
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 2, '両方のドロー効果が発動するはず');
});

// ============================================================
console.log('=== 実カード：ヒーリングオーブのプレイ時60回復（EQUIP_GRANT_ABILITYとは別の通常ON_PLAY効果） ===');
// ============================================================

test('実カード：ヒーリングオーブを装備するとプレイ時に自分のリーダー1体を60回復する', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.leaders[0].damage = 80;
  equip(state, 'playerA', 'BP02-079', 0);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 20, '80ダメージ-60回復=20');
});

// ============================================================
console.log('=== UNVERIFIED確認: BP02-077オートタレットは未登録（メタ条件のため見送り） ===');
// ============================================================

test('BP02-077（オートタレット）はcardEffectDataに未登録である', () => {
  assert.strictEqual(CardEffectData.hasEffects('BP02-077'), false);
});

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
