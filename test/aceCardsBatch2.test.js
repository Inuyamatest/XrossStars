/* ACEカード追加登録（バッチ2・画像37枚分）の自動テスト（node test/aceCardsBatch2.test.js で実行）
 * 対象: js/engine/cardEffectData.js への以下の追加登録の検証
 *   BP01-035 ロケットランチャー / BP01-062 Never Fall / BP02-017 ビクトリーランページ /
 *   BP02-031 勝利の雄たけび / BP02-052 恐怖の迷宮 / BP02-059 逆転のハイドギャル /
 *   BP02-066 流行語大賞 / BP03-038 強奪の宴 / BP03-052 参拝・乾杯・超喝采 / BP04-066 収穫の刻
 * いずれも既存のAction/Target/Conditionファクトリのみで実装しており、新しい仕組みは追加していない。
 * 新しい仕組みが必要なため今回未登録のカード（BP04-045/052/059, BP03-017/024/031/059/066,
 * BP02-024/038/045, BP01-017/026/044/080, ST01-005/016, ST02-009/012）は
 * getEffectsForCard()が空配列を返すことのみ確認する。
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

const LEADERS_A = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004']; // 全員red
const LEADERS_B = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008']; // 全員blue
const LEADERS_YELLOW = ['BP01-009', 'BP01-010', 'BP01-011', 'BP01-012']; // 全員yellow
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

// ============================================================
console.log('=== BP01-035 ロケットランチャー（ON_ATTACK+40、AFTER_ATTACK: 他のリーダー1体に30） ===');
// ============================================================

test('BP01-035: ON_ATTACKで+40、AFTER_ATTACKで対戦相手の他のリーダー1体に30ダメージ', () => {
  const state = Match.createMatch(makeMatchConfig());
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP01-035');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 40 + atk);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 30);
});

// ============================================================
console.log('=== BP01-062 Never Fall（ON_PLAY: カードを3枚引く） ===');
// ============================================================

test('BP01-062: プレイ時に3枚引く', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP01-062');
  const handBefore = state.players.playerA.hand.length;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore - 1 + 3);
});

// ============================================================
console.log('=== BP02-017 ビクトリーランページ（AFTER_ATTACK + OVERKILL_AMOUNT>=40） ===');
// ============================================================

test('BP02-017: オーバーキル40未満なら発動しない', () => {
  const state = Match.createMatch(makeMatchConfig());
  // ダウンさせない（残りHPが十分ある）ようにして、そもそもOverkillの概念が発生しない状況を作る
  const instanceId = injectHand(state, 'playerA', 'BP02-017');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, false, '素のATK30だけでは100HPをダウンさせない前提');
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 0, 'ダウンしていないのでOverkill自体が成立しないはず');
});

test('BP02-017: オーバーキル40以上なら対戦相手の他のリーダー1体に90ダメージ', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 99; // 残りHP1
  const boostInstance = injectHand(state, 'playerA', 'BP01-053'); // 超新星（アタック強化+30）
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', boostInstance, {}, cardIndex);

  const instanceId = injectHand(state, 'playerA', 'BP02-017');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  // totalDamage = boost30 + atk30 = 60、hpBeforeAttack=1 -> overkill=59 >= 40
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 90);
});

// ============================================================
console.log('=== BP02-031 勝利の雄たけび（無条件ON_ATTACK+30・AFTER_ATTACKドロー2） ===');
// ============================================================

test('BP02-031: 条件なしでダメージ+30とドロー2が両方発動する', () => {
  const state = Match.createMatch(makeMatchConfig());
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP02-031');
  const handBeforeAttack = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 30 + atk);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 2);
});

// ============================================================
console.log('=== BP02-052 恐怖の迷宮（ATTACK_BOOST+20・AFTER_ATTACK: 他のリーダー全員に10） ===');
// ============================================================

test('BP02-052: アタック強化+20と、対戦相手の他のリーダー全員への10ダメージ', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaInstance = injectHand(state, 'playerA', 'BP02-052');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaInstance, {}, cardIndex);

  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const attackInstance = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackInstance, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 20 + atk, 'アタック強化+20が乗っているはず');
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 10);
  assert.strictEqual(state.players.playerB.leaders[2].damage, 10);
  assert.strictEqual(state.players.playerB.leaders[3].damage, 10);
});

// ============================================================
console.log('=== BP02-059 逆転のハイドギャル（ATTACK_BOOSTのみ、+80） ===');
// ============================================================

test('BP02-059: アタック強化+80のみが発動する', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaInstance = injectHand(state, 'playerA', 'BP02-059');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaInstance, {}, cardIndex);

  // +80が乗れば100/110HPどちらのリーダーもダウンする（80+atk30=110）ため、
  // ダウン時にダメージカウンターが0へリセットされる仕様（spec 3-2章）を踏まえ、isDownで検証する。
  const attackInstance = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackInstance, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true, '+80が加算されていればダウンするはず');
});

test('BP02-059: アタック強化+80が無ければ素のATKだけではダウンしない前提の確認（比較対照）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const attackInstance = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackInstance, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, false);
});

// ============================================================
console.log('=== BP02-066 流行語大賞（ON_PLAY: 自分のリーダー1体を40回復、カードを1枚引く） ===');
// ============================================================

test('BP02-066: プレイ時に自分のリーダーを40回復し、カードを1枚引く', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerA.leaders[0].damage = 60;
  const instanceId = injectHand(state, 'playerA', 'BP02-066');
  const handBefore = state.players.playerA.hand.length;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 20, '60ダメージから40回復して残り20になるはず');
  assert.strictEqual(state.players.playerA.hand.length, handBefore - 1 + 1);
});

// ============================================================
console.log('=== BP03-038 強奪の宴（AFTER_ATTACK + ダウン判定：ドロー1・対戦相手は手札を1枚捨てる） ===');
// ============================================================

test('BP03-038: ダウンしなければ発動しない', () => {
  const state = Match.createMatch(makeMatchConfig());
  const oppHandBefore = state.players.playerB.hand.length;
  const instanceId = injectHand(state, 'playerA', 'BP03-038');
  const handBeforeAttack = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, false);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack);
  assert.strictEqual(state.players.playerB.hand.length, oppHandBefore);
});

test('BP03-038: ダウンすればドロー1・対戦相手は手札を1枚捨てる', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 75; // atk30で確実にダウン
  injectHand(state, 'playerB', FILLER_ATTACK); // 捨てる用の手札を保証
  const oppHandBefore = state.players.playerB.hand.length;
  const instanceId = injectHand(state, 'playerA', 'BP03-038');
  const handBeforeAttack = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 1);
  assert.strictEqual(state.players.playerB.hand.length, oppHandBefore - 1);
});

// ============================================================
console.log('=== BP03-052 参拝・乾杯・超喝采（アタッカーの色による分岐） ===');
// ============================================================

test('BP03-052: アタッカーが青なら対戦相手の他のリーダー1体に50ダメージ', () => {
  // playerB(全員blue)を攻撃側にするため、先攻をplayerBにする
  const state = Match.createMatch(makeMatchConfig({ firstPlayer: 'playerB' }));
  const memoriaInstance = injectHand(state, 'playerB', 'BP03-052');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerB', memoriaInstance, {}, cardIndex);
  const attackInstance = injectHand(state, 'playerB', BLUE_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerB', attackInstance, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerA', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[1].damage, 50, 'アタッカーが青なので50ダメージが入るはず');
});

test('BP03-052: アタッカーが黄ならカードを2枚引く', () => {
  const state = Match.createMatch(makeMatchConfig({
    firstPlayer: 'playerA',
    playerA: { leaderCardIds: LEADERS_YELLOW, deckCardIds: fillDeck(FILLER_ATTACK, 50), tacticsDeckCardIds: TACTICS_5 },
  }));
  const memoriaInstance = injectHand(state, 'playerA', 'BP03-052');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaInstance, {}, cardIndex);
  // cost0の未登録アタックカードを使い、超喝采(cost2)と合わせてPP3以内に収める
  const attackInstance = injectHand(state, 'playerA', 'AN01-008');
  const handBeforeAttack = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackInstance, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 2, 'アタッカーが黄なので2枚引くはず');
  assert.strictEqual(state.players.playerB.leaders[1].damage, 0, '青の分岐は発動しないはず');
});

// ============================================================
console.log('=== BP04-066 収穫の刻（ON_PLAY: 対戦相手のリーダー1体に20ダメージ、カードを1枚引く） ===');
// ============================================================

test('BP04-066: プレイ時に対戦相手のリーダー1体に20ダメージ、カードを1枚引く', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP04-066');
  const handBefore = state.players.playerA.hand.length;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 20);
  assert.strictEqual(state.players.playerA.hand.length, handBefore - 1 + 1);
});

// ============================================================
console.log('=== 新しい仕組みが必要なため未登録のカード（意図せず発火しないことの確認） ===');
// ============================================================

// BP04-038（別ファイルでテスト済み）・BP03-059・BP02-038は、後のPhase Eで条件付き
// ON_ATTACK/ATTACK_BOOSTボーナス機構を追加した際に登録されたため、この一覧から除外している
// （test/phaseE.test.js参照）。BP03-017・BP01-080も、後のPhase FでMULTI_ATTACK機構・
// makeAllAliveOpponentLeadersTargetを追加した際に登録されたため除外している（test/phaseF.test.js参照）。
// BP01-017・BP01-044・BP02-024も、後のPhase GでFREE_PLAY_MEMORIA_FROM_HAND/
// DECK_LOOK_FREE_PLAY_MEMORIA/REPLAY_SELECTED_FROM_PLAY_AREA機構を追加した際に登録されたため
// 除外している（test/phaseG.test.js参照）。
// BP04-045・BP04-052・BP03-024・BP03-031・BP01-026・ST01-016・ST02-012 は Phase K で登録した
// （ST01-016/ST02-012 はアタック強化のみ。test/phaseK.test.js参照）。
// ST01-005 / ST02-009 は所属データ（data/source/affiliations.json）を追加して登録した（test/phaseL.test.js参照）。
['BP04-059', 'BP03-066', 'BP02-045'].forEach((cardId) => {
  test(`${cardId}は新機構が必要なため未登録のまま`, () => {
    assert.deepStrictEqual(CardEffectData.getEffectsForCard(cardId), []);
  });
});

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
