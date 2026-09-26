/* Phase I: アタック/メモリア全種の画像バッチ（パラレル/プロモ含む）の自動テスト（node test/phaseI.test.js で実行）
 *
 * 対象:
 *  - scripts/build-cards-json.js: パラレル/プロモが通常版のコスト・テキスト・ビルドルールを引き継ぐこと
 *  - js/engine/parallelAliases.js + cardEffectData.js: パラレルのカード番号でも通常版の効果が引けること
 *  - cardEffectData.js Phase Iで新規登録したカードの代表パターン
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
const PP_TICKET = 'ST01-024';
const FILLER_ATTACK = allCards.filter((c) => c.cardType === 'ATTACK' && c.color === 'red' && !c.ban && typeof c.cost === 'number' && c.cost <= 1 && !CardEffectData.hasEffects(c.cardNumber) && !CardEffectData.KEYWORDS[c.cardNumber])[0].cardNumber;
const TACTICS_CARD = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban)[0].cardNumber;
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban).slice(0, 5).map((c) => c.cardNumber);
const TACTICS_5_B = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban).slice(5, 10).map((c) => c.cardNumber);

function makeMatchConfig() {
  return {
    matchId: 'test-match',
    mode: 'STANDARD',
    firstPlayer: 'playerA',
    ppTicketCardId: PP_TICKET,
    playerA: { leaderCardIds: LEADERS_A, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: LEADERS_B, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5_B },
  };
}

function injectHand(state, playerId, cardId) {
  const instance = GameState.createCardInstance(cardId);
  state.players[playerId].hand.push(instance);
  return instance.instanceId;
}

function pushToPlayArea(state, playerId, cardId, isTactics) {
  const instance = GameState.createCardInstance(cardId);
  state.players[playerId].playArea.push({ card: instance, order: state.players[playerId].playArea.length, pendingTriggers: [], isTactics: !!isTactics });
}

function attackWith(state, cardId) {
  const id = injectHand(state, 'playerA', cardId);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', id, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
}

function playMemoria(state, cardId) {
  const id = injectHand(state, 'playerA', cardId);
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', id, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
}

// ============================================================
console.log('=== カードデータ全体 ===');
// ============================================================
test('アタック/メモリアカードは全てコストが確定している（コスト未確定による無料プレイ不具合の再発防止）', () => {
  const missing = allCards.filter((c) => (c.cardType === 'ATTACK' || c.cardType === 'MEMORIA') && typeof c.cost !== 'number');
  assert.deepStrictEqual(missing.map((c) => c.cardNumber), []);
});
test('BP02-049 究極自摸のコストは画像どおり0', () => {
  assert.strictEqual(cardIndex['BP02-049'].cost, 0);
});

// ============================================================
console.log('=== パラレル/プロモ ===');
// ============================================================
test('パラレルは通常版のコスト・テキスト・ビルドルールを引き継ぐ', () => {
  assert.strictEqual(cardIndex['BP04-105'].cost, cardIndex['BP04-017'].cost); // 慈悲の刃 SRP
  assert.strictEqual(cardIndex['PR-047'].cost, 2); // メンタルブレイク（プロモ）
  assert.strictEqual(cardIndex['PR-040'].buildRule, cardIndex['BP01-025'].buildRule); // キリングスプリー（リーダー専用）
  assert.strictEqual(cardIndex['BP01-137'].text, cardIndex['BP01-053'].text); // 超新星 SRP
  assert.strictEqual(cardIndex['BP01-137'].parallelGroupId, 'BP01-053');
});
test('パラレルのカード番号でも通常版の効果登録が引ける', () => {
  assert.strictEqual(CardEffectData.getEffectsForCard('BP01-137'), CardEffectData.getEffectsForCard('BP01-053'));
  assert.strictEqual(CardEffectData.getEffectsForCard('PR-054'), CardEffectData.getEffectsForCard('BP02-024')); // 三銃士
  assert.ok(CardEffectData.hasEffects('BP04-105'));
});
test('パラレル（BP01-137 超新星 SRP）を実際にプレイすると通常版と同じ+30が乗る', () => {
  const state = Match.createMatch(makeMatchConfig());
  playMemoria(state, 'BP01-137');
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  attackWith(state, FILLER_ATTACK);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 30 + atk);
});

// ============================================================
console.log('=== Phase I 新規登録カード ===');
// ============================================================
test('BP04-047 ベッドでチキン：タクティクスが無ければ+40のみ', () => {
  const state = Match.createMatch(makeMatchConfig());
  playMemoria(state, 'BP04-047');
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  attackWith(state, FILLER_ATTACK);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 40 + atk);
});
test('BP04-047 ベッドでチキン：プレイエリアにタクティクスがあれば+60（HP超過ならダウン）', () => {
  const state = Match.createMatch(makeMatchConfig());
  pushToPlayArea(state, 'playerA', TACTICS_CARD, true);
  playMemoria(state, 'BP04-047');
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const hp = GameState.getLeaderCurrentHp(cardIndex, state.players.playerB.leaders[0]);
  attackWith(state, FILLER_ATTACK);
  if (60 + atk >= hp) assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  else assert.strictEqual(state.players.playerB.leaders[0].damage, 60 + atk);
});
test('BP04-039 大旋風：アタッカーが未覚醒ならボーナス無し', () => {
  const state = Match.createMatch(makeMatchConfig());
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  attackWith(state, 'BP04-039');
  assert.strictEqual(state.players.playerB.leaders[0].damage, atk);
});
test('BP04-039 大旋風：アタッカーが覚醒済みなら+10', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerA.leaders[0].awakened = true;
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  attackWith(state, 'BP04-039');
  assert.strictEqual(state.players.playerB.leaders[0].damage, 10 + atk);
});
test('BP03-054 闇の加護：プレイ時に自分のリーダー1体を30回復し、次のアタックに+30', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerA.leaders[0].damage = 50;
  playMemoria(state, 'BP03-054');
  assert.strictEqual(state.players.playerA.leaders[0].damage, 20);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  attackWith(state, FILLER_ATTACK);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 30 + atk);
});
test('BP04-018 1TAP：アタック後に1枚引いて1枚捨てる（手札枚数はアタックカード分だけ減る）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const id = injectHand(state, 'playerA', 'BP04-018');
  const handBefore = state.players.playerA.hand.length;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', id, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore - 1);
});
test('BP04-033 パン売りの少女：ダメージ+70（HP超過ならダウン）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const hp = GameState.getLeaderCurrentHp(cardIndex, state.players.playerB.leaders[0]);
  attackWith(state, 'BP04-033');
  if (70 + atk >= hp) assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  else assert.strictEqual(state.players.playerB.leaders[0].damage, 70 + atk);
});
// ============================================================
console.log('=== MULTI_ATTACK（ストームラッシュ）の対戦UI対応に伴うエンジン修正 ===');
// ============================================================
test('アタック指定の件数不足はPP支払い・カード移動の前にエラーになる（中途半端な状態を残さない）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const id = injectHand(state, 'playerA', 'BP03-017');
  const tappedBefore = state.players.playerA.ppCards.tapped;
  const handBefore = state.players.playerA.hand.length;
  assert.throws(() => EffectResolver.playAttackCardWithEffects(state, 'playerA', id, { attacks: [] }, cardIndex), /MULTI_ATTACK/);
  assert.strictEqual(state.players.playerA.ppCards.tapped, tappedBefore);
  assert.strictEqual(state.players.playerA.hand.length, handBefore);
  assert.strictEqual(state.players.playerA.playArea.length, 0);
});
test('先の回でダウンした対象が後の回にも指定されていたら、生存している先頭のリーダーに差し替える', () => {
  const state = Match.createMatch(makeMatchConfig());
  const hp = GameState.getLeaderCurrentHp(cardIndex, state.players.playerB.leaders[0]);
  state.players.playerB.leaders[0].damage = hp - 1; // 1回目のアタックで確実にダウン
  const id = injectHand(state, 'playerA', 'BP03-017');
  const same = { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 };
  EffectResolver.playAttackCardWithEffects(state, 'playerA', id, { attacks: [same, same, same] }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  const hitOthers = state.players.playerB.leaders.slice(1).reduce((s, l) => s + l.damage + (l.isDown ? 1 : 0), 0);
  assert.ok(hitOthers > 0, '2回目以降のアタックは生存リーダーに差し替えられているはず');
});

// BP03-025 短気な爆弾魔 / BP03-067 気まずい空間 は Phase K で登録した（test/phaseK.test.js参照）

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
