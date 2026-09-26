/* ACEカード追加登録（バッチ1）の自動テスト（依存ライブラリなし。node test/aceCardsBatch1.test.js で実行）
 * 対象: js/engine/cardEffectData.js への以下の追加登録の検証
 *   - AN01-012 超新星（1st Anniv.版。BP01-053超新星と同名・同効果のリプリントで、同じ登録内容を複製）
 *   - BP04-017 慈悲の刃（ON_ATTACKのダメージ+120のみ登録。プレイ時の「デッキ上から5枚見てトラッシュ」は
 *     対応するAction typeが存在しないため未実装のまま）
 * および、意図的に未登録のままにしたカードが本当に効果なしとして扱われることの確認
 *   - AN01-008 ラストスタンド（追加効果なしのバニラアタックカード）
 *   - BP04-024 オーバードライブ（手札の種類別カウントに基づく効果。新Action type設計が必要なため未実装）
 *
 * 既存のjs/engine/*.jsは一切変更していない（cardEffectData.jsへのエントリ追加のみ）ため、
 * 既存のtest/*.test.jsは無改修・無影響である。
 *
 * 注: BP04-038アナイアレーションはこのバッチ作成時点では未登録だったが、後のPhase Eで
 * 条件付きON_ATTACKボーナス機構を追加した際に登録された（test/aceCardsBatch2.test.js参照）。
 * このファイルからは「未登録の確認」を削除済み。
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
const FILLER_ATTACK = allCards.filter((c) => c.cardType === 'ATTACK' && c.color === 'red' && !c.ban && !CardEffectData.hasEffects(c.cardNumber) && !CardEffectData.KEYWORDS[c.cardNumber])[0].cardNumber;
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
console.log('=== data/cards.json: 今回追加・修正したカードが正しく取り込まれていること ===');
// ============================================================

test('AN01-008 ラストスタンドがカードマスタに存在する（アタック, cost0, ACE）', () => {
  const c = cardIndex['AN01-008'];
  assert.ok(c, 'AN01-008がdata/cards.jsonに存在しない');
  assert.strictEqual(c.cardType, 'ATTACK');
  assert.strictEqual(c.cost, 0);
  assert.strictEqual(c.ace, true);
});

test('AN01-012 超新星がカードマスタに存在する（メモリア, cost2, ACE）', () => {
  const c = cardIndex['AN01-012'];
  assert.ok(c, 'AN01-012がdata/cards.jsonに存在しない');
  assert.strictEqual(c.cardType, 'MEMORIA');
  assert.strictEqual(c.cost, 2);
  assert.strictEqual(c.ace, true);
});

test('BP04-017の名称が「慈悲の刃」に修正されている（旧placeholderの「バーニングショット」ではない）', () => {
  const c = cardIndex['BP04-017'];
  assert.strictEqual(c.name, '慈悲の刃');
  assert.strictEqual(c.cost, 3);
  assert.strictEqual(c.ace, true);
});

test('BP04-038の名称が「アナイアレーション」に修正されている（旧placeholderの「グリーンインパクト」ではない）', () => {
  const c = cardIndex['BP04-038'];
  assert.strictEqual(c.name, 'アナイアレーション');
  assert.strictEqual(c.cost, 2);
});

// ============================================================
console.log('=== AN01-012 超新星（BP01-053のリプリント。同じ登録内容を複製） ===');
// ============================================================

test('AN01-012はBP01-053と同じ効果（アタック強化+30、アタック後ダウンならPP2回復+ドロー1）が発火する', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 45; // +30ブースト込みで確実にダウンさせる

  const memoriaInstance = injectHand(state, 'playerA', 'AN01-012');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaInstance, {}, cardIndex);
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 0, 'AN01-012自身はプレイ時ではなくアタック強化/アタック後効果のみ');

  const attackInstance = injectHand(state, 'playerA', 'BP01-021'); // ギャングの襲撃（cost1、ダウンならカードを1枚引く）
  const handBeforeAttack = state.players.playerA.hand.length - 1;

  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackInstance, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true, 'アタック強化+30が乗ってダウンする前提が崩れている');
  // ここまででPP消費は「超新星(2) + ギャングの襲撃(1)」＝3(=tapped)。まだAFTER_ATTACKは未解決。
  assert.strictEqual(state.players.playerA.ppCards.tapped, 3);

  ResolutionStack.resolveAll(state.resolutionStack, state);
  // AN01-012自身のアタック後効果（PP2回復・ドロー1）＋ギャングの襲撃自身のアタック後効果（ドロー1）の両方が発火する
  assert.strictEqual(state.players.playerA.ppCards.tapped, 1, 'tapped=3からPP2回復で1になるはず');
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 2, 'AN01-012のドロー1枚＋ギャングの襲撃のドロー1枚で計2枚増えるはず');
});

// ============================================================
console.log('=== BP04-017 慈悲の刃（ON_ATTACKのダメージ+120のみ登録。プレイ時のデッキルック/トラッシュは未実装） ===');
// ============================================================

test('BP04-017のON_ATTACK効果でアタックダメージに+120が加算される', () => {
  const state = Match.createMatch(makeMatchConfig());
  // 素のATK(30)だけでは100HPの相手をダウンさせられないが、+120が乗れば確実にダウンする
  // （120+atk30=150>100HP）。ダメージ量そのものはダウン時に0へリセットされる仕様（spec 3-2章）のため、
  // 「+120が本当に加算されたこと」はisDownの成立で検証する。
  const instanceId = injectHand(state, 'playerA', 'BP04-017');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true, '+120が加算されていればダウンするはず');
});

test('BP04-017のON_ATTACK+120が無ければ素のATKだけではダウンしない前提の確認（比較対照）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK); // 効果未登録の素のアタックカード
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, false, '素のATK30だけでは100HPの相手はダウンしない前提が崩れている');
});

test('BP04-017のプレイ時「デッキ上から5枚見てトラッシュ」は未実装のため、プレイしてもデッキ枚数は変化しない', () => {
  const state = Match.createMatch(makeMatchConfig());
  const deckBefore = state.players.playerA.deck.length;
  const instanceId = injectHand(state, 'playerA', 'BP04-017');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.deck.length, deckBefore, 'プレイ時のデッキルック/トラッシュ効果は未実装のはず（意図的な仕様）');
});

// ============================================================
console.log('=== 未登録のまま据え置いたカード：意図せず効果が発火しないことの確認 ===');
// ============================================================

test('AN01-008（バニラのアタックカード）には登録済み効果が無い', () => {
  assert.deepStrictEqual(CardEffectData.getEffectsForCard('AN01-008'), []);
});

// BP04-024オーバードライブはPhase K（DISCARD_UP_TO_FOR_BONUS）で登録済み（test/phaseK.test.js参照）

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
