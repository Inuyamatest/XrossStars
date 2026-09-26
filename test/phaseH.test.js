/* Phase H: 「専用カード」（buildRule: リーダー：<推し名>）画像バッチで新規登録したカードの自動テスト
 * (node test/phaseH.test.js で実行)
 *
 * 対象: js/engine/cardEffectData.js に今回追加した約60枚の登録。既存のパターン
 * （ON_ATTACK固定ボーナス／ATTACK_BOOST／ON_PLAY／AFTER_ATTACK条件付き等）の代表例を
 * 1枚ずつ検証する。新しいAction/Target/Condition機構は追加していないため、
 * effectResolver.js/effectFactories.js自体の変更はない。
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
const FILLER_ATTACK = allCards.filter((c) => c.cardType === 'ATTACK' && c.color === 'red' && !c.ban && !CardEffectData.hasEffects(c.cardNumber) && !CardEffectData.KEYWORDS[c.cardNumber])[0].cardNumber;
const FILLER_MEMORIA = allCards.filter((c) => c.cardType === 'MEMORIA' && !c.ban && !CardEffectData.hasEffects(c.cardNumber) && !CardEffectData.KEYWORDS[c.cardNumber])[0].cardNumber;
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
}

// ============================================================
console.log('=== ON_ATTACK固定ボーナス（BP03-022 ピアッシングバレット：+10） ===');
// ============================================================
test('BP03-022：ダメージ+10が乗る', () => {
  const state = Match.createMatch(makeMatchConfig());
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP03-022');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 10 + atk);
});

// ============================================================
console.log('=== ON_ATTACK負のボーナス（BP04-020 ワールドクラス：-20 / BP03-037 Tango Down：-10） ===');
// ============================================================
test('BP04-020：ダメージ-20が乗る（減算）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP04-020');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, atk - 20);
});
test('BP03-037：ダメージ-10が乗る（プレイ時のPP回復条件は未実装のため対象外）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP03-037');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, atk - 10);
});

// ============================================================
console.log('=== ATTACK_BOOSTのみ・無条件（BP04-058 「またね」：+60） ===');
// ============================================================
test('BP04-058：プレイすると次のアタックに+60が乗る', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaId = injectHand(state, 'playerA', 'BP04-058');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 60 + atk);
});

// BP01-069 運もミスもない：ATTACK_BOOST+10のみ登録（ON_PLAYのデッキ確認・任意トラッシュは未実装）
test('BP01-069：プレイ時効果は無いが、ATTACK_BOOST+10は乗る', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaId = injectHand(state, 'playerA', 'BP01-069');
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore, 'デッキ確認によるドロー等は発生しない（未実装）');
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 10 + atk);
});

// ============================================================
console.log('=== ATTACK_BOOST条件付き（BP04-050 ヤー!：メモリア3枚以上で+30） ===');
// ============================================================
test('BP04-050：プレイエリアのメモリアが2枚（このカード含む）では+30は乗らない', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaId = injectHand(state, 'playerA', 'BP04-050');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, atk);
});
test('BP04-050：プレイエリアのメモリアが3枚以上で+30が乗る', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA);
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA);
  const memoriaId = injectHand(state, 'playerA', 'BP04-050');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 30 + atk);
});

// ============================================================
console.log('=== 2段階ATTACK_BOOST（BP02-069 換気：無条件+20、メモリア3枚以上でさらに+50） ===');
// ============================================================
test('BP02-069：メモリアが2枚（このカード含む）では無条件+20のみ', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaId = injectHand(state, 'playerA', 'BP02-069');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 20 + atk);
});
test('BP02-069：メモリアが3枚以上で+20と+50の合計+70が乗る（HPを超える場合はダウン＝ダメージ0リセットで確認）', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA);
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA);
  const memoriaId = injectHand(state, 'playerA', 'BP02-069');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const hp = GameState.getLeaderCurrentHp(cardIndex, state.players.playerB.leaders[0]);
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  if (70 + atk >= hp) {
    assert.strictEqual(state.players.playerB.leaders[0].isDown, true, '+70が乗った合計ダメージでダウンするはず');
  } else {
    assert.strictEqual(state.players.playerB.leaders[0].damage, 70 + atk);
  }
});

// ============================================================
console.log('=== ON_PLAY draw1 + ATTACK_BOOST（BP02-072 トリプルティアラ） ===');
// ============================================================
test('BP02-072：プレイ時に1枚引き、次のアタックに+30が乗る', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaId = injectHand(state, 'playerA', 'BP02-072');
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 30 + atk);
});

// ============================================================
console.log('=== ON_PLAY draw2のみ（BP03-069 アクアリウムツアー） ===');
// ============================================================
test('BP03-069：プレイ時に2枚引く', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaId = injectHand(state, 'playerA', 'BP03-069');
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 2);
});

// ============================================================
console.log('=== ON_PLAY：対戦相手のリーダー1体に20ダメージ（BP01-070 BEAUTY SALON -HANABUSA-） ===');
// ============================================================
test('BP01-070：プレイ時に対戦相手のリーダー1体に20ダメージ', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaId = injectHand(state, 'playerA', 'BP01-070');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const totalDamage = state.players.playerB.leaders.reduce((sum, l) => sum + l.damage, 0);
  assert.strictEqual(totalDamage, 20);
});

// ============================================================
console.log('=== AFTER_ATTACK：ダウンしたらカードを1枚引く（BP02-044 セクシーアローべにショット） ===');
// ============================================================
test('BP02-044：対象がダウンしなければ何も起きない', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP02-044');
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore, 'ダウンしていないのでドローしない');
});
test('BP02-044：対象をダウンさせるとカードを1枚引く', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 9999; // 確実にダウンさせる
  state.players.playerB.leaders[0].isDown = false;
  const instanceId = injectHand(state, 'playerA', 'BP02-044');
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1);
});

// ============================================================
console.log('=== AFTER_ATTACK：ダウンしたら対戦相手の他のリーダー1体に20ダメージ（BP03-029 漢の強行突破） ===');
// ============================================================
test('BP03-029：対象をダウンさせると他のリーダー1体に20ダメージ', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 9999;
  const instanceId = injectHand(state, 'playerA', 'BP03-029');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const others = state.players.playerB.leaders.filter((l, i) => i !== 0);
  assert.strictEqual(others.filter((l) => l.damage === 20).length, 1);
});

// ============================================================
console.log('=== AFTER_ATTACK：メモリア2枚以上で対戦相手の他のリーダー1体に20ダメージ（AN01-010 容疑者連行中） ===');
// ============================================================
test('AN01-010：メモリアが1枚以下では発動しない', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'AN01-010');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const totalDamage = state.players.playerB.leaders.reduce((sum, l) => sum + l.damage, 0);
  assert.strictEqual(totalDamage, GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]));
});
test('AN01-010：メモリアが2枚以上で他のリーダー1体に20ダメージ', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA);
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA);
  const instanceId = injectHand(state, 'playerA', 'AN01-010');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const others = state.players.playerB.leaders.filter((l, i) => i !== 0);
  assert.strictEqual(others.filter((l) => l.damage === 20).length, 1);
});

// ============================================================
console.log('=== AFTER_ATTACK：メモリア2枚以上で対戦相手の他のリーダーすべてに10ダメージ（AN01-006 肩乗りコーチング） ===');
// ============================================================
test('AN01-006：メモリアが2枚以上で他のリーダーすべてに10ダメージ', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA);
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA);
  const instanceId = injectHand(state, 'playerA', 'AN01-006');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const others = state.players.playerB.leaders.filter((l, i) => i !== 0);
  others.forEach((l) => assert.strictEqual(l.damage, 10));
});

// ============================================================
console.log('=== ATTACK_BOOST+50 + AFTER_ATTACK単発10ダメージ・無条件（BP01-079 小さなビデオレター） ===');
// ============================================================
test('BP01-079：+50が乗り、アタック後に他のリーダー1体に10ダメージ', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaId = injectHand(state, 'playerA', 'BP01-079');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 50 + atk);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const others = state.players.playerB.leaders.filter((l, i) => i !== 0);
  assert.strictEqual(others.filter((l) => l.damage === 10).length, 1);
});

// ============================================================
console.log('=== ATTACK_BOOST+50 + AFTER_ATTACK条件付き20ダメージ（BP04-071 快適な空の旅） ===');
// ============================================================
test('BP04-071：メモリア2枚（このカード含む）では条件を満たさずダメージなし', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaId = injectHand(state, 'playerA', 'BP04-071');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 50 + atk);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const others = state.players.playerB.leaders.filter((l, i) => i !== 0);
  others.forEach((l) => assert.strictEqual(l.damage, 0));
});
test('BP04-071：メモリア3枚以上で他のリーダー1体に20ダメージ', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA);
  pushToPlayArea(state, 'playerA', FILLER_MEMORIA);
  const memoriaId = injectHand(state, 'playerA', 'BP04-071');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const others = state.players.playerB.leaders.filter((l, i) => i !== 0);
  assert.strictEqual(others.filter((l) => l.damage === 20).length, 1);
});

// ============================================================
console.log('=== ON_PLAY条件付きdraw + ATTACK_BOOST無条件（BP03-056 シャンパンコール！） ===');
// ============================================================
test('BP03-056：自分の場にアタックカードが無ければON_PLAYは発動しない', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaId = injectHand(state, 'playerA', 'BP03-056');
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore);
});
test('BP03-056：自分の場にアタックカードが1枚以上あればON_PLAYで1枚引き、+40が乗る', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', FILLER_ATTACK);
  const memoriaId = injectHand(state, 'playerA', 'BP03-056');
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 40 + atk);
});

// ============================================================
console.log('=== AFTER_ATTACK OVERKILL（AN01-007 悲願の開花：オーバーキル20→PP回復1） ===');
// ============================================================
test('AN01-007：オーバーキル未達ならPPは回復しない', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerA.ppCards.tapped = 1; // 必要コスト分の空きPPは残す
  state.players.playerB.leaders[0].damage = 0; // HP満タンからの通常ダメージのみ（オーバーキル未達）
  const instanceId = injectHand(state, 'playerA', 'AN01-007');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.ppCards.tapped, 2, 'アタックカードのコスト支払い分だけtappedが増える（回復は発生しない）');
});
test('AN01-007：オーバーキル20以上でPPを1回復する', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerA.ppCards.tapped = 1;
  const hp = GameState.getLeaderCurrentHp(cardIndex, state.players.playerB.leaders[0]);
  state.players.playerB.leaders[0].damage = hp - 1; // あと1でダウンする状態にして、オーバーキルを確実に20以上にする
  const instanceId = injectHand(state, 'playerA', 'AN01-007');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.ppCards.tapped, 1, 'コスト支払いで+1、オーバーキルによる回復で-1され、差し引き元通り');
});

// ============================================================
console.log('=== AFTER_ATTACK OVERKILL（BP04-029 一斧両断：オーバーキル10→他のリーダー1体に30ダメージ） ===');
// ============================================================
test('BP04-029：オーバーキル10以上で他のリーダー1体に30ダメージ', () => {
  const state = Match.createMatch(makeMatchConfig());
  const hp = GameState.getLeaderCurrentHp(cardIndex, state.players.playerB.leaders[0]);
  state.players.playerB.leaders[0].damage = hp - 1;
  const instanceId = injectHand(state, 'playerA', 'BP04-029');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const others = state.players.playerB.leaders.filter((l, i) => i !== 0);
  assert.strictEqual(others.filter((l) => l.damage === 30).length, 1);
});

// ============================================================
console.log('=== ON_PLAY：すべてのプレイヤーは手札を1枚捨てる + ATTACK_BOOST+50（BP04-049 なんだコイツ…） ===');
// ============================================================
test('BP04-049：プレイ時に両プレイヤーとも手札が1枚減り、+50が乗る', () => {
  const state = Match.createMatch(makeMatchConfig());
  injectHand(state, 'playerA', FILLER_MEMORIA);
  injectHand(state, 'playerB', FILLER_MEMORIA);
  const handABefore = state.players.playerA.hand.length;
  const handBBefore = state.players.playerB.hand.length;
  const memoriaId = injectHand(state, 'playerA', 'BP04-049');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handABefore - 1, '自分の手札も1枚捨てるはず（このカード自身を引いた分は+1、捨てる分は-1で相殺）');
  assert.strictEqual(state.players.playerB.hand.length, handBBefore - 1);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 50 + atk);
});

// ============================================================
console.log('=== AFTER_ATTACK draw1・無条件・ATTACK_BOOST無し（BP02-049 究極自摸） ===');
// ============================================================
test('BP02-049：ATTACK_BOOSTを持たないメモリアでも、プレイすればAFTER_ATTACKが次のアタックに紐づく', () => {
  const state = Match.createMatch(makeMatchConfig());
  const memoriaId = injectHand(state, 'playerA', 'BP02-049');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  const handBeforeAttack = state.players.playerA.hand.length;
  const attackId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  // アタックカードを手札からプレイエリアへ移動（-1）した後、紐づくAFTER_ATTACKのDRAWで+1されるはず
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 1);
});

// ============================================================
console.log('=== 未実装として見送ったカードが未登録であることの確認 ===');
// ============================================================
// BP01-040 / BP01-022 / BP01-061 / BP04-023 は Phase K で登録した（test/phaseK.test.js参照）

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
