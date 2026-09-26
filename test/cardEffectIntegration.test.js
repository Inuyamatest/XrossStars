/* Card Effect Engine — Phase C 実戦統合テスト（node test/cardEffectIntegration.test.js で実行）
 *
 * test/cardEffect.test.js が Effect Engine 単体の仕組み（Trigger/Condition/Target/Action/
 * ResolutionStack）を検証しているのに対し、このファイルは「実際のゲーム進行（Match.createMatch→
 * Phases→EffectResolverの実戦ラッパー→Combat）を通しても同じ効果が正しく発火するか」だけを
 * 検証する（ユーザー指示 Step 8 の Test A〜G に対応）。
 *
 * 既存ファイル（gameState.js以外のjs/engine/*.js、js/deckbuilder/、data/cards.json）は無改修。
 * gameState.js の変更点（装備によるgetLeaderMaxHpの加算）は Test D で明示的に検証する。
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const GameState = require('../js/engine/gameState.js');
const ResolutionStack = require('../js/engine/resolutionStack.js');
const Combat = require('../js/engine/combat.js');
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
const LEADERS_A_WITH_MONDO = ['ST02-002', 'BP01-002', 'BP01-003', 'BP01-004'];
const LEADERS_B = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];
const PP_TICKET = 'ST01-024';
// カード効果が未登録の「ただのアタックカード」を、ドロー用の埋め草デッキ及び対照実験用に使う
const FILLER_ATTACK = allCards.filter((c) => c.cardType === 'ATTACK' && c.color === 'red' && !c.ban && !CardEffectData.hasEffects(c.cardNumber))[0].cardNumber;
const BLUE_ATTACK = allCards.filter((c) => c.cardType === 'ATTACK' && c.color === 'blue' && !c.ban)[0].cardNumber;
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban).slice(0, 5).map((c) => c.cardNumber);
const TACTICS_5_B = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban).slice(5, 10).map((c) => c.cardNumber);

function fillDeck(cardId, count) { return new Array(count).fill(cardId); }

function makeMatchConfig(overrides) {
  return Object.assign({
    matchId: 'integration-test-match',
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

// ============================================================
console.log('=== Test A: インパクトショット（ON_ATTACK+40が実戦ダメージへ反映） ===');
// ============================================================

test('Test A: インパクトショットをプレイ→攻撃→ダメージ+40が実戦結果(GameState)に反映される', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerA.ppCards.max = 10; // 複数回アタックカードをプレイして検証するための準備（ルールとは無関係）
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP01-019');

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);

  assert.strictEqual(state.players.playerB.leaders[0].damage, 40 + atk);

  // Step2 確認事項3,4：このボーナスは「この攻撃だけ」。次にただのアタックカードを撃っても+40は乗らない
  const fillerInstance = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', fillerInstance, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 1,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[1].damage, atk, '次の攻撃には+40が持ち越されないはず');
});

// ============================================================
console.log('=== Test B/C: ギャングの襲撃（AFTER_ATTACK, 解決時Condition） ===');
// ============================================================

test('Test B: ギャングの襲撃→攻撃→相手がダウン→AFTER_ATTACKで1ドロー', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 75; // atk30の1撃で確実にダウンする
  const instanceId = injectHand(state, 'playerA', 'BP01-021');
  const handAfterPlay = state.players.playerA.hand.length - 1;

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);

  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handAfterPlay + 1);
});

test('Test C: ギャングの襲撃→攻撃→相手がダウンしない→ドローされない', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP01-021');
  const handAfterPlay = state.players.playerA.hand.length - 1;

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, false);

  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handAfterPlay);
});

// ============================================================
console.log('=== Test D: ライトシールド（装備HP補正が実際のダウン判定へ反映） ===');
// ============================================================

test('Test D: ライトシールド装備→最大HP+30→その補正がダウン判定へ反映される（combat.js無改修）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.turn.turnNumber = 2; // 先攻1ターン目タクティクス制限を回避するだけの準備（PROVISIONALとは無関係）
  const leader = state.players.playerA.leaders[0];
  const baseMaxHp = GameState.getLeaderMaxHp(cardIndex, leader); // 装備前なので素のHP
  const attackerAtk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerB.leaders[0]);

  const tacticsInstance = injectTactics(state, 'playerA', 'BP01-095');
  EffectResolver.playTacticsCardWithEffects(state, 'playerA', tacticsInstance, { subType: 'EQUIPMENT', equipLeaderIndex: 0 }, cardIndex);
  assert.strictEqual(GameState.getLeaderMaxHp(cardIndex, leader), baseMaxHp + 30);

  // 装備前なら合計ダメージがちょうどbaseMaxHpになる（＝即ダウンする）攻撃量。装備後は耐えるはず
  Combat.declareAttack(state, {
    attackerPlayerId: 'playerB', attackerLeaderIndex: 0,
    targetPlayerId: 'playerA', targetLeaderIndex: 0, attackCardBaseDamage: baseMaxHp - attackerAtk,
  }, cardIndex);
  assert.strictEqual(leader.isDown, false, 'combat.js自体は無改修だが、GameState.getLeaderMaxHpが装備を加算するためダウンしないはず');

  // 残り30以上を追加で受けるとダウンする
  Combat.declareAttack(state, {
    attackerPlayerId: 'playerB', attackerLeaderIndex: 0,
    targetPlayerId: 'playerA', targetLeaderIndex: 0, attackCardBaseDamage: 30,
  }, cardIndex);
  assert.strictEqual(leader.isDown, true);
});

// ============================================================
console.log('=== Test E: 超新星（ATTACK_BOOST + AFTER_ATTACK、複数Trigger連携） ===');
// ============================================================

test('Test E: 超新星→ATTACK_BOOST→攻撃→AFTER_ATTACK→条件成立時にPP回復＋ドロー', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerA.ppCards.max = 10; // 複数回カードをプレイして検証するための準備（ルールとは無関係）
  state.players.playerB.leaders[0].damage = 45; // +30ブースト込みで確実にダウンする

  const memoriaInstance = injectHand(state, 'playerA', 'BP01-053');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaInstance, {}, cardIndex);

  const attackInstance = injectHand(state, 'playerA', FILLER_ATTACK); // ボーナスはメモリア側なのでアタックカード自体は無印でよい
  const handAfterPlay = state.players.playerA.hand.length - 1;

  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackInstance, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true, '45+ブースト30+atk30=105>=100でダウンする前提');
  const tappedAfterAttack = state.players.playerA.ppCards.tapped; // 超新星cost2＋アタックカードのcostが積まれた状態

  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.ppCards.tapped, Math.max(0, tappedAfterAttack - 2));
  assert.strictEqual(state.players.playerA.hand.length, handAfterPlay + 1);

  // Step2 確認事項5相当：ブーストは次の1回のみ。もう一度攻撃してもボーナスは乗らない
  const fillerInstance2 = injectHand(state, 'playerA', FILLER_ATTACK);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', fillerInstance2, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 1,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[1].damage, atk, 'ブーストは消費済みで持ち越されないはず');
});

// ============================================================
console.log('=== Test F: Mondo覚醒（ON_AWAKEN、対象選択・No-op安全性） ===');
// ============================================================

test('Test F: Mondo覚醒→ON_AWAKEN→対象リーダーを20回復（最大HPを超えて回復しない）', () => {
  const state = Match.createMatch(makeMatchConfig({ playerA: { leaderCardIds: LEADERS_A_WITH_MONDO, deckCardIds: fillDeck(FILLER_ATTACK, 50), tacticsDeckCardIds: TACTICS_5 } }));
  state.players.playerA.leaders[0].damage = 10; // 10ダメージのところに20回復→0未満にはならない（オーバーヒールしない）
  state.players.playerB.leaders[0].damage = 75;

  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerA.leaders[0].awakened, true);

  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 0, '10ダメージに対し20回復なので0で止まる（オーバーヒールしない）');
});

test('Test F: ON_AWAKENは対象0件でもクラッシュせずNo-opになる（防御的な異常系）', () => {
  const state = Match.createMatch(makeMatchConfig({ playerA: { leaderCardIds: LEADERS_A_WITH_MONDO, deckCardIds: fillDeck(FILLER_ATTACK, 50), tacticsDeckCardIds: TACTICS_5 } }));
  // 通常のゲーム進行では起こり得ない異常系（自分のリーダー全員が既にダウンしている状態）を
  // 意図的に作り、target()が[]を返してもresolve()がクラッシュしないことだけを確認する
  const mondoEffect = CardEffectData.getEffectsForCard('ST02-002')[0];
  const ctx = { ownerPlayerId: 'playerA', sourceInstanceId: 'test-mondo#1', attackerLeaderIndex: 0 };
  state.players.playerA.leaders.forEach((l) => { l.isDown = true; });
  const pending = EffectResolver.buildPendingEffect(mondoEffect, ctx, cardIndex);
  assert.doesNotThrow(() => {
    ResolutionStack.push(state.resolutionStack, pending);
    ResolutionStack.resolveAll(state.resolutionStack, state);
  });
});

// ============================================================
console.log('=== Test G: 危機一髪（ON_PLAY、デッキ切れフォールバック） ===');
// ============================================================

test('Test G: 危機一髪→ON_PLAY→2枚ドロー、カードプレイ処理と効果解決の順序が正しい', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP01-058');
  const handBeforePlay = state.players.playerA.hand.length;

  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  // カードプレイ処理（手札から場へ移動、PP支払い）は即座に反映される
  assert.strictEqual(state.players.playerA.hand.length, handBeforePlay - 1);
  assert.strictEqual(state.players.playerA.ppCards.tapped, 1);

  // 効果解決（ドロー）はResolutionStackを解決するまで反映されない
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBeforePlay - 1 + 2);
});

test('Test G: 危機一髪→デッキが尽きていても既存のFAQ Q1フォールバック連鎖に従う（トラッシュから再構築して2枚引ける）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerA.deck = []; // 山札を空にする
  state.players.playerA.trash = [
    { card: GameState.createCardInstance(FILLER_ATTACK), faceUp: false },
    { card: GameState.createCardInstance(FILLER_ATTACK), faceUp: false },
  ]; // トラッシュの裏向きカードから再構築できるようにしておく（FAQ Q1手順1）
  const instanceId = injectHand(state, 'playerA', 'BP01-058');
  const handBeforePlay = state.players.playerA.hand.length;

  assert.doesNotThrow(() => {
    EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
    ResolutionStack.resolveAll(state.resolutionStack, state);
  });
  // Deck.drawCards（既存・無改修）のFAQ Q1フォールバック連鎖（トラッシュ再構築）を経て2枚引けているはず
  assert.strictEqual(state.players.playerA.hand.length, handBeforePlay - 1 + 2);
  assert.strictEqual(state.players.playerA.trash.length, 0, '裏向きトラッシュはすべてデッキへ再構築され引かれたはず');
});

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
