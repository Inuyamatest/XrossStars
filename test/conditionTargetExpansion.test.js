/* Card Effect Engine — Phase D-2 自動テスト（node test/conditionTargetExpansion.test.js で実行）
 * 対象: js/engine/effectFactories.js（PLAY_AREA_TYPE_COUNT / SAME_COLOR_AS / OVERKILL_AMOUNT /
 *       ONCE_PER_TURN_USED）、js/engine/effectResolver.js の ctx.cardIndex 配線 と overkillAmount計算、
 *       js/engine/cardEffectData.js に今回追加した実カード群
 *
 * 既存ファイル（cardEffect.js/gameState.js/events.js/resolutionStack.js/deck.js/combat.js/phases.js/
 * match.js、js/deckbuilder/、data/cards.json）は無改修。
 * 既存テスト（gameEngine.test.js / deckRules.test.js / cardEffect.test.js /
 * cardEffectIntegration.test.js / discardAndAtkModifier.test.js）はすべて無変更のまま成功することを
 * 別途確認済み。
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const GameState = require('../js/engine/gameState.js');
const ResolutionStack = require('../js/engine/resolutionStack.js');
const Combat = require('../js/engine/combat.js');
const Match = require('../js/engine/match.js');
const CardEffectCore = require('../js/engine/cardEffect.js');
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

const LEADERS_A = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004']; // 赤4体
const LEADERS_B = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008']; // 青4体
const PP_TICKET = 'ST01-024';
const FILLER_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.color === 'red');
const BLUE_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.color === 'blue');
const FILLER_MEMORIA = plainCard((c) => c.cardType === 'MEMORIA');
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban).slice(0, 5).map((c) => c.cardNumber);
const TACTICS_5_B = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban).slice(5, 10).map((c) => c.cardNumber);

function fillDeck(cardId, count) { return new Array(count).fill(cardId); }

function makeMatchConfig(overrides) {
  return Object.assign({
    matchId: 'd2-test-match',
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

function pushPlayArea(state, playerId, cardId, isTactics) {
  const instance = GameState.createCardInstance(cardId);
  state.players[playerId].playArea.push({ card: instance, order: state.players[playerId].playArea.length, pendingTriggers: [], isTactics: !!isTactics });
  return instance.instanceId;
}

// ============================================================
console.log('=== Phase D-2-A: ctx.cardIndex の配線 ===');
// ============================================================

test('Conditionからctx.cardIndexを取得できる', () => {
  const state = Match.createMatch(makeMatchConfig());
  let observedCardIndex = null;
  const synthetic = CardEffectCore.createCardEffect({
    trigger: 'AFTER_ATTACK',
    condition: (state, ctx) => { observedCardIndex = ctx.cardIndex; return true; },
    action: { type: 'DRAW', amount: 1 },
  });
  const pending = EffectResolver.buildPendingEffect(synthetic, { ownerPlayerId: 'playerA', sourceInstanceId: 'test#1' }, cardIndex);
  ResolutionStack.push(state.resolutionStack, pending);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(observedCardIndex, cardIndex, 'condition(state, ctx)からctx.cardIndexで元のcardIndexを参照できるはず');
});

test('Targetからctx.cardIndexを取得できる', () => {
  const state = Match.createMatch(makeMatchConfig());
  let observedCardIndex = null;
  const synthetic = CardEffectCore.createCardEffect({
    trigger: 'AFTER_ATTACK',
    target: (state, ctx) => { observedCardIndex = ctx.cardIndex; return []; },
    action: { type: 'DRAW', amount: 1 },
  });
  const pending = EffectResolver.buildPendingEffect(synthetic, { ownerPlayerId: 'playerA', sourceInstanceId: 'test#2' }, cardIndex);
  ResolutionStack.push(state.resolutionStack, pending);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(observedCardIndex, cardIndex, 'target(state, ctx)からctx.cardIndexで元のcardIndexを参照できるはず');
});

test('既存のcondition(state, ctx)のシグネチャは変わらない（cardIndexを参照しない既存効果は無影響）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 75;
  const instanceId = injectHand(state, 'playerA', 'BP01-021'); // Phase B: ギャングの襲撃（cardIndexを一切参照しない）
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1);
});

// ============================================================
console.log('=== Phase D-2-B: PLAY_AREA_TYPE_COUNT ===');
// ============================================================

test('Test1: 自分の場にMEMORIAが2枚ありGTE 2ならtrue', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushPlayArea(state, 'playerA', FILLER_MEMORIA);
  pushPlayArea(state, 'playerA', FILLER_MEMORIA);
  const condition = EffectFactories.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 });
  assert.strictEqual(condition(state, { ownerPlayerId: 'playerA', cardIndex: cardIndex }), true);
});

test('Test2: 自分の場にMEMORIAが1枚ならfalse', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushPlayArea(state, 'playerA', FILLER_MEMORIA);
  const condition = EffectFactories.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 });
  assert.strictEqual(condition(state, { ownerPlayerId: 'playerA', cardIndex: cardIndex }), false);
});

test('Test3: 相手の場を数えるケース（player:OPPONENT）', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushPlayArea(state, 'playerB', FILLER_MEMORIA);
  pushPlayArea(state, 'playerB', FILLER_MEMORIA);
  const condition = EffectFactories.makePlayAreaTypeCountCondition({ player: 'OPPONENT', cardType: 'MEMORIA', operator: 'GTE', count: 2 });
  // ctx.ownerPlayerIdは「効果の持ち主」= playerA。OPPONENTなのでplayerBの場を数える
  assert.strictEqual(condition(state, { ownerPlayerId: 'playerA', cardIndex: cardIndex }), true);
  assert.strictEqual(state.players.playerA.playArea.length, 0, '自分の場は数えていないことの確認');
});

test('Test4: ATTACK/MEMORIA/TACTICSを区別できる', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushPlayArea(state, 'playerA', FILLER_ATTACK); // ATTACK
  pushPlayArea(state, 'playerA', FILLER_MEMORIA); // MEMORIA
  const memoriaCondition = EffectFactories.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'EQ', count: 1 });
  const attackCondition = EffectFactories.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'ATTACK', operator: 'EQ', count: 1 });
  const tacticsCondition = EffectFactories.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'TACTICS', operator: 'EQ', count: 0 });
  const ctx = { ownerPlayerId: 'playerA', cardIndex: cardIndex };
  assert.strictEqual(memoriaCondition(state, ctx), true);
  assert.strictEqual(attackCondition(state, ctx), true);
  assert.strictEqual(tacticsCondition(state, ctx), true);
});

test('Test5: 存在しないcardIndex・不正なカードデータでもクラッシュしない', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushPlayArea(state, 'playerA', 'NOT-A-REAL-CARD-ID'); // カードマスタに存在しないID
  const condition = EffectFactories.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 1 });
  assert.doesNotThrow(() => {
    assert.strictEqual(condition(state, { ownerPlayerId: 'playerA', cardIndex: cardIndex }), false);
  });
  assert.doesNotThrow(() => {
    // cardIndex自体が渡されない（undefined）場合も安全に0件扱いになるはず
    assert.strictEqual(condition(state, { ownerPlayerId: 'playerA' }), false);
  });
});

test('実カード：ウォールブレイカー（自分の場にメモリア2枚以上→対戦相手の他のリーダー1体に20ダメージ）', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushPlayArea(state, 'playerA', FILLER_MEMORIA);
  pushPlayArea(state, 'playerA', FILLER_MEMORIA);
  state.players.playerB.leaders[0].damage = 75;
  const instanceId = injectHand(state, 'playerA', 'BP01-042');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 20);
});

test('実カード：ハイグラバースト（自分の場にメモリア2枚未満→発火しない、AOE版）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 75;
  const instanceId = injectHand(state, 'playerA', 'BP01-024');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 0);
  assert.strictEqual(state.players.playerB.leaders[2].damage, 0);
  assert.strictEqual(state.players.playerB.leaders[3].damage, 0);
});

test('実カード：ハイグラバースト（条件成立時はAOEで他のリーダー全員に10ダメージ）', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushPlayArea(state, 'playerA', FILLER_MEMORIA);
  pushPlayArea(state, 'playerA', FILLER_MEMORIA);
  state.players.playerB.leaders[0].damage = 75;
  const instanceId = injectHand(state, 'playerA', 'BP01-024');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 10);
  assert.strictEqual(state.players.playerB.leaders[2].damage, 10);
  assert.strictEqual(state.players.playerB.leaders[3].damage, 10);
});

// ============================================================
console.log('=== Phase D-2-C: SAME_COLOR_AS ===');
// ============================================================

// 色を混在させた専用リーダー編成（playerBを赤/青混在にする。playerBの元編成は全員青なので上書きする）
function makeMixedColorConfig() {
  return makeMatchConfig({ playerB: { leaderCardIds: ['BP01-005', 'BP01-006', 'BP01-001', 'BP01-007'], deckCardIds: fillDeck(BLUE_ATTACK, 50), tacticsDeckCardIds: TACTICS_5_B } });
  // index0=Kamito(青,被アタック) index1=渋谷ハル(青,同色) index2=うるか(赤,別色) index3=白雪レイド(青,同色)
}

test('赤→赤のみ対象・青は対象外・複数対象を正しく選ぶ', () => {
  const state = Match.createMatch(makeMixedColorConfig());
  const target = EffectFactories.makeSameColorAsAttackedLeaderTarget();
  const ctx = { targetPlayerId: 'playerB', targetLeaderIndex: 0, cardIndex: cardIndex }; // 被アタック=青(Kamito)
  const refs = target(state, ctx);
  const indexes = refs.map((r) => r.leaderIndex).sort();
  assert.deepStrictEqual(indexes, [1, 3], '青の被アタックリーダーと同じ色(青)のリーダー(index1,3)のみ対象、赤(index2)は対象外');
});

test('対象が0件（同じ色の他リーダーがいない）', () => {
  const state = Match.createMatch(makeMatchConfig()); // playerBは全員青、他に赤がいない構成に変更
  state.players.playerB.leaders = state.players.playerB.leaders.map((l, i) => (i === 0 ? l : GameState.createLeaderState('BP01-001'))); // index1-3を赤にする
  const target = EffectFactories.makeSameColorAsAttackedLeaderTarget();
  const ctx = { targetPlayerId: 'playerB', targetLeaderIndex: 0, cardIndex: cardIndex }; // 被アタック=青、他は全員赤
  assert.deepStrictEqual(target(state, ctx), []);
});

test('基準対象が取得できない場合（targetLeaderIndexが不正）でも安全に空配列を返す', () => {
  const state = Match.createMatch(makeMatchConfig());
  const target = EffectFactories.makeSameColorAsAttackedLeaderTarget();
  assert.doesNotThrow(() => {
    assert.deepStrictEqual(target(state, { targetPlayerId: 'playerB', targetLeaderIndex: 99, cardIndex: cardIndex }), []);
  });
  assert.doesNotThrow(() => {
    // cardIndexが渡されない場合も安全
    assert.deepStrictEqual(target(state, { targetPlayerId: 'playerB', targetLeaderIndex: 0 }), []);
  });
});

test('ダウン中のリーダーは同色でも対象にならない', () => {
  const state = Match.createMatch(makeMixedColorConfig());
  state.players.playerB.leaders[1].isDown = true; // 同色(青)だがダウン中
  const target = EffectFactories.makeSameColorAsAttackedLeaderTarget();
  const refs = target(state, { targetPlayerId: 'playerB', targetLeaderIndex: 0, cardIndex: cardIndex });
  assert.deepStrictEqual(refs.map((r) => r.leaderIndex), [3]);
});

test('実カード：ポイズンボム（このアタックを受けたリーダーと同じ色の他リーダー全員に40ダメージ）', () => {
  const state = Match.createMatch(makeMixedColorConfig());
  state.players.playerB.leaders[0].damage = 75; // 被アタック(青,Kamito)をダウンさせる
  const instanceId = injectHand(state, 'playerA', 'BP02-039');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 40, '同色(青)なので40ダメージ');
  assert.strictEqual(state.players.playerB.leaders[2].damage, 0, '別色(赤)なので対象外');
  assert.strictEqual(state.players.playerB.leaders[3].damage, 40, '同色(青)なので40ダメージ');
});

// ============================================================
console.log('=== Phase D-2-D: OVERKILL_AMOUNT ===');
// ============================================================

test('Overkill 0（ちょうど致死量、余剰なし）：GTE 1はfalse、GTE 0はtrue', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 70; // atk30の1撃でちょうど100（overkill=0）
  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  const gte1 = EffectFactories.makeOverkillAmountCondition({ operator: 'GTE', amount: 1 });
  const gte0 = EffectFactories.makeOverkillAmountCondition({ operator: 'GTE', amount: 0 });
  const eq0 = EffectFactories.makeOverkillAmountCondition({ operator: 'EQ', amount: 0 });
  const ctx = { overkillAmount: 0 };
  assert.strictEqual(gte1(state, ctx), false);
  assert.strictEqual(gte0(state, ctx), true);
  assert.strictEqual(eq0(state, ctx), true);
});

test('Overkill 10 / 30 / 50 の各値とGTE/GT/EQの組み合わせ', () => {
  const gte30 = EffectFactories.makeOverkillAmountCondition({ operator: 'GTE', amount: 30 });
  const gt30 = EffectFactories.makeOverkillAmountCondition({ operator: 'GT', amount: 30 });
  const eq30 = EffectFactories.makeOverkillAmountCondition({ operator: 'EQ', amount: 30 });
  assert.strictEqual(gte30({}, { overkillAmount: 10 }), false);
  assert.strictEqual(gte30({}, { overkillAmount: 30 }), true);
  assert.strictEqual(gt30({}, { overkillAmount: 30 }), false, 'GTは厳密に超過が必要');
  assert.strictEqual(gt30({}, { overkillAmount: 50 }), true);
  assert.strictEqual(eq30({}, { overkillAmount: 30 }), true);
  assert.strictEqual(eq30({}, { overkillAmount: 50 }), false);
});

test('ダウンしなかった場合はfalse（ctx.overkillAmountはnull）', () => {
  const condition = EffectFactories.makeOverkillAmountCondition({ operator: 'GTE', amount: 0 });
  assert.strictEqual(condition({}, { overkillAmount: null }), false);
});

test('余剰ダメージが存在しない場合（ctx.overkillAmount自体が無いコンテキスト）でもfalseで安全', () => {
  const condition = EffectFactories.makeOverkillAmountCondition({ operator: 'GTE', amount: 0 });
  assert.doesNotThrow(() => {
    assert.strictEqual(condition({}, {}), false);
  });
});

test('実カード：うるパーンチッ！（オーバーキル30未満→発火しない）', () => {
  const state = Match.createMatch(makeMatchConfig());
  // atk30のみ。ダウンさせるが余剰はごくわずかにする
  state.players.playerB.leaders[0].damage = 71; // 100-71=29、attack30で丁度ダウン、overkill=1（30未満）
  const instanceId = injectHand(state, 'playerA', 'BP01-029');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 0, 'overkill=1<30なので発火しないはず');
});

test('実カード：うるパーンチッ！（オーバーキル30以上→対戦相手の他のリーダー1体に50ダメージ）', () => {
  const state = Match.createMatch(makeMatchConfig());
  // atk30だけではoverkill>=30を安定して作れないため、Combat.queueAttackBoostで直接+30する
  // （超新星カード自体を使うと、そのカード自身のAFTER_ATTACK効果も同じ攻撃に付随してしまい
  //   検証対象（うるパーンチッ！のオーバーキル効果）以外の副作用が混ざるため、ここでは避ける）
  Combat.queueAttackBoost(state, 'playerA', 30, 'test-boost#1');
  state.players.playerB.leaders[0].damage = 71; // 残りHP29。boost30+atk30=60。overkill=60-29=31（>=30）
  const instanceId = injectHand(state, 'playerA', 'BP01-029');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 50, 'overkill=31>=30なので発火するはず');
});

test('実カード：猪突猛進（オーバーキル30以上→カードを2枚引く）', () => {
  const state = Match.createMatch(makeMatchConfig());
  Combat.queueAttackBoost(state, 'playerA', 30, 'test-boost#2');
  state.players.playerB.leaders[0].damage = 71; // 残りHP29。boost30+atk30=60。overkill=31
  const instanceId = injectHand(state, 'playerA', 'BP02-020');
  const handBefore = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 2);
});

test('実カード：ヘンディーブロー（オーバーキル20以上→自分のリーダー1体を30回復する）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerA.leaders[0].damage = 50;
  Combat.queueAttackBoost(state, 'playerA', 30, 'test-boost#3');
  state.players.playerB.leaders[0].damage = 71; // overkill=31（>=20）
  const instanceId = injectHand(state, 'playerA', 'BP02-025');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 20, '50ダメージ-30回復=20');
});

// ============================================================
console.log('=== Phase D-2-E: ONCE_PER_TURN_USED（合成テスト。実カード登録はEQUIP_GRANT_ABILITY実装後に持ち越し） ===');
// ============================================================

test('Test1: 初回使用→false（まだ使用していない）', () => {
  const state = Match.createMatch(makeMatchConfig());
  assert.strictEqual(EffectFactories.isEffectUsedThisTurn(state, 'synthetic#1'), false);
});

test('Test2: 効果解決後→true', () => {
  const state = Match.createMatch(makeMatchConfig());
  const condition = EffectFactories.makeOncePerTurnCondition();
  const synthetic = CardEffectCore.createCardEffect({ trigger: 'AFTER_ATTACK', condition: condition, action: { type: 'DRAW', amount: 1 } });
  const pending = EffectResolver.buildPendingEffect(synthetic, { ownerPlayerId: 'playerA', sourceInstanceId: 'synthetic#2' }, cardIndex);
  ResolutionStack.push(state.resolutionStack, pending);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(EffectFactories.isEffectUsedThisTurn(state, 'synthetic#2'), true);
});

test('Test3: 同一ターン中の2回目→発動不可', () => {
  const state = Match.createMatch(makeMatchConfig());
  const condition = EffectFactories.makeOncePerTurnCondition();
  const synthetic = CardEffectCore.createCardEffect({ trigger: 'AFTER_ATTACK', condition: condition, action: { type: 'DRAW', amount: 1 } });
  const handBefore = state.players.playerA.hand.length;

  const pending1 = EffectResolver.buildPendingEffect(synthetic, { ownerPlayerId: 'playerA', sourceInstanceId: 'synthetic#3' }, cardIndex);
  ResolutionStack.push(state.resolutionStack, pending1);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1);

  const pending2 = EffectResolver.buildPendingEffect(synthetic, { ownerPlayerId: 'playerA', sourceInstanceId: 'synthetic#3' }, cardIndex);
  ResolutionStack.push(state.resolutionStack, pending2);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1, '同一ターン2回目は発動しないはず');
});

test('Test4: ターン終了（ターン進行）後→再び使用可能', () => {
  const state = Match.createMatch(makeMatchConfig());
  const condition = EffectFactories.makeOncePerTurnCondition();
  const synthetic = CardEffectCore.createCardEffect({ trigger: 'AFTER_ATTACK', condition: condition, action: { type: 'DRAW', amount: 1 } });
  const handBefore = state.players.playerA.hand.length;

  const pending1 = EffectResolver.buildPendingEffect(synthetic, { ownerPlayerId: 'playerA', sourceInstanceId: 'synthetic#4' }, cardIndex);
  ResolutionStack.push(state.resolutionStack, pending1);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1);

  state.turn.turnNumber += 1; // ターン進行（phases.jsのendTurnAndSwitchと同じ効果。ここではturnNumberのみ検証）

  const pending2 = EffectResolver.buildPendingEffect(synthetic, { ownerPlayerId: 'playerA', sourceInstanceId: 'synthetic#4' }, cardIndex);
  ResolutionStack.push(state.resolutionStack, pending2);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 2, 'ターンが進んだので再び発動できるはず');
});

test('Test5: 別カード/別リーダー（別sourceInstanceId）の使用状況が干渉しない', () => {
  const state = Match.createMatch(makeMatchConfig());
  const condition = EffectFactories.makeOncePerTurnCondition();
  const syntheticA = CardEffectCore.createCardEffect({ trigger: 'AFTER_ATTACK', condition: condition, action: { type: 'DRAW', amount: 1 } });
  const syntheticB = CardEffectCore.createCardEffect({ trigger: 'AFTER_ATTACK', condition: condition, action: { type: 'DRAW', amount: 1 } });

  const pendingA = EffectResolver.buildPendingEffect(syntheticA, { ownerPlayerId: 'playerA', sourceInstanceId: 'equip-instance#A' }, cardIndex);
  ResolutionStack.push(state.resolutionStack, pendingA);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  assert.strictEqual(EffectFactories.isEffectUsedThisTurn(state, 'equip-instance#A'), true);
  assert.strictEqual(EffectFactories.isEffectUsedThisTurn(state, 'equip-instance#B'), false, '別インスタンスの使用状況には影響しないはず');

  // Bはまだ使用していないので発動できる
  const handBefore = state.players.playerA.hand.length;
  const pendingB = EffectResolver.buildPendingEffect(syntheticB, { ownerPlayerId: 'playerA', sourceInstanceId: 'equip-instance#B' }, cardIndex);
  ResolutionStack.push(state.resolutionStack, pendingB);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1);
});

test('innerConditionと組み合わせられる（条件不成立なら使用済みにもならない）', () => {
  const state = Match.createMatch(makeMatchConfig());
  let innerCalls = 0;
  const innerCondition = () => { innerCalls += 1; return false; };
  const condition = EffectFactories.makeOncePerTurnCondition(innerCondition);
  assert.strictEqual(condition(state, { sourceInstanceId: 'synthetic#5' }), false);
  assert.strictEqual(innerCalls, 1);
  assert.strictEqual(EffectFactories.isEffectUsedThisTurn(state, 'synthetic#5'), false, '内部条件が不成立なら使用済みにはならないはず');
});

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
