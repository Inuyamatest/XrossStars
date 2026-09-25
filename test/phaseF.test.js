/* Phase F: MULTI_ATTACK機構、及びON_AWAKEN再発火バグの修正の自動テスト（node test/phaseF.test.js で実行）
 * 対象: js/engine/effectResolver.js（playAttackCardWithEffectsのMULTI_ATTACK対応、
 *       ON_AWAKENが「新たに覚醒した瞬間」だけで発火するようにした修正）,
 *       js/engine/effectFactories.js（makeAllAliveOpponentLeadersTargetの新設）
 *
 * 実カード: BP03-017 ストームラッシュ（1回のプレイで3回アタックする）, BP01-080 勝利へのジャンプ
 * （ON_PLAYで対戦相手のリーダーすべてに50ダメージ。新設したTarget Factoryだけで表現できる単純なケース）。
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

// LEADERS_A: BP01-001〜004はいずれもON_AWAKEN登録済み（MULTI[DRAW(2), DISCARD_HAND(SELF,2)]）
const LEADERS_A = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004'];
const LEADERS_B = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];
const PP_TICKET = 'ST01-024';
const FILLER_ATTACK = allCards.filter((c) => c.cardType === 'ATTACK' && c.color === 'red' && !c.ban && !CardEffectData.hasEffects(c.cardNumber))[0].cardNumber;
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
console.log('=== BP03-017 ストームラッシュ（MULTI_ATTACK: 1回のプレイで3回アタック宣言） ===');
// ============================================================

test('3回とも独立したアタックとしてダメージが入る（PP・手札消費は1回分のみ）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const tappedBefore = state.players.playerA.ppCards.tapped;
  const handBefore = state.players.playerA.hand.length;

  const instanceId = injectHand(state, 'playerA', 'BP03-017');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attacks: [
      { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 },
      { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 1 },
      { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 2 },
    ],
  }, cardIndex);

  assert.strictEqual(state.players.playerB.leaders[0].damage, atk);
  assert.strictEqual(state.players.playerB.leaders[1].damage, atk);
  assert.strictEqual(state.players.playerB.leaders[2].damage, atk);
  assert.strictEqual(state.players.playerA.ppCards.tapped, tappedBefore + cardIndex['BP03-017'].cost, 'PPはカード1枚分のコストしか消費しないはず');
  assert.strictEqual(state.players.playerA.hand.length, handBefore, 'カードを1枚引いて1枚出したので手札枚数は変わらない前提（injectHandで+1、プレイで-1）');
  assert.strictEqual(state.players.playerA.playArea.length, 1, 'プレイエリアにはカード1枚だけが積まれるはず（3回複製されない）');
});

test('options.attacksの件数がcountと一致しない場合はエラーになる', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP03-017');
  assert.throws(() => {
    EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
      attacks: [{ attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 }],
    }, cardIndex);
  }, /MULTI_ATTACK/);
});

test('メモリアのアタック強化・紐づくAFTER_ATTACKは最初の1回のアタックにのみ適用される', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerA.ppCards.max = 10; // 超新星(cost2)+ストームラッシュ(cost2)を1ターンでまかなうため
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);

  const memoriaInstance = injectHand(state, 'playerA', 'BP01-053'); // 超新星（アタック強化+30、アタック後：ダウンならPP2回復+ドロー1）
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaInstance, {}, cardIndex);

  // 1体目は超新星のブースト込みで確実にダウンさせ、2体目・3体目はブーストが乗らないことを確認する
  state.players.playerB.leaders[0].damage = 75; // 残りHP25、atk30+boost30で確実にダウン
  const instanceId = injectHand(state, 'playerA', 'BP03-017');
  const handBeforeAttack = state.players.playerA.hand.length - 1;

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attacks: [
      { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0 },
      { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 1 },
      { attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 2 },
    ],
  }, cardIndex);

  assert.strictEqual(state.players.playerB.leaders[0].isDown, true, '1回目はブースト+30込みでダウンするはず');
  // 1回目のダウンでアタッカー自身が覚醒するため（Combat.declareAttack自体の仕様）、
  // 2回目・3回目は覚醒後ATK（BP01-001: 30->40）で攻撃する。ブースト自体は消費済みで乗らないが、
  // ATKの上昇分（+10）は正しく反映される、という自然な相互作用を確認する。
  const awakenedAtk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  assert.strictEqual(state.players.playerA.leaders[0].awakened, true, '1回目のダウンで覚醒しているはず');
  assert.strictEqual(awakenedAtk, atk + 10, '覚醒後ATKは30->40のはず');
  assert.strictEqual(state.players.playerB.leaders[1].damage, awakenedAtk, '2回目はブーストは無いが覚醒後ATKで攻撃するはず');
  assert.strictEqual(state.players.playerB.leaders[2].damage, awakenedAtk, '3回目も同様のはず');

  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 1, '超新星のAFTER_ATTACK（ドロー1）は1回目にのみ紐づいて発動するはず');
});

test('攻撃の途中で新たに覚醒した場合、ON_AWAKEN効果は1回だけ発動する（2回目・3回目では再発火しない）', () => {
  const state = Match.createMatch(makeMatchConfig());
  // attackerLeaderIndex:2 = BP01-003（ON_AWAKEN登録済み: MULTI[DRAW(2), DISCARD_HAND(SELF,2)]）
  // 1体目のみダウンさせて覚醒させる。2体目・3体目はダウンさせない（すでに覚醒済みの状態で追加攻撃するケース）
  state.players.playerB.leaders[0].damage = 75; // atk30で確実にダウン
  const instanceId = injectHand(state, 'playerA', 'BP03-017');
  const handBeforeAttack = state.players.playerA.hand.length - 1;
  // ON_AWAKENのDISCARD_HAND(SELF,2)で捨てるカードを確保しておく
  injectHand(state, 'playerA', FILLER_ATTACK);
  injectHand(state, 'playerA', FILLER_ATTACK);

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attacks: [
      { attackerLeaderIndex: 2, targetPlayerId: 'playerB', targetLeaderIndex: 0 },
      { attackerLeaderIndex: 2, targetPlayerId: 'playerB', targetLeaderIndex: 1 },
      { attackerLeaderIndex: 2, targetPlayerId: 'playerB', targetLeaderIndex: 2 },
    ],
  }, cardIndex);

  assert.strictEqual(state.players.playerA.leaders[2].awakened, true, '1回目のダウンで覚醒するはず');
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 1, 'ON_AWAKEN効果が1件だけ積まれるはず（2回目・3回目では再発火しない）');
  ResolutionStack.resolveAll(state.resolutionStack, state);
  // BP01-003のON_AWAKEN効果はMULTI[DRAW(2), DISCARD_HAND(SELF,2)]（差し引き±0）。
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 2, 'ON_AWAKENは1回だけ発動し差し引き±0のはず（+2は事前に確保した捨て札用の2枚分）');
});

// ============================================================
console.log('=== 単発アタック経路でのON_AWAKEN再発火バグ修正の回帰テスト ===');
// ============================================================

test('既に覚醒済みのリーダーが（別のカードで）再度ダウンを取っても、ON_AWAKENは再発火しない', () => {
  const state = Match.createMatch(makeMatchConfig());
  // attackerLeaderIndex:2 = BP01-003（ON_AWAKEN登録済み）。既に覚醒済みという状況を直接作る
  state.players.playerA.leaders[2].awakened = true;

  state.players.playerB.leaders[0].damage = 75; // atk30で確実にダウン
  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 2, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 0, 'すでに覚醒済みなのでON_AWAKENは発動しないはず（修正前はここが1件積まれてしまうバグだった）');
});

test('未覚醒のリーダーが今回のダウンで新たに覚醒した場合は、従来どおりON_AWAKENが発動する', () => {
  const state = Match.createMatch(makeMatchConfig());
  assert.strictEqual(state.players.playerA.leaders[2].awakened, false);
  state.players.playerB.leaders[0].damage = 75;
  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 2, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerA.leaders[2].awakened, true);
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 1, 'ON_AWAKEN効果が1件だけ積まれるはず');
});

// ============================================================
console.log('=== BP01-080 勝利へのジャンプ（ON_PLAY: 対戦相手のリーダーすべてに50ダメージ） ===');
// ============================================================

test('プレイ時に対戦相手の生存リーダー全員に50ダメージが入る（ダウン済みは対象外）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[2].isDown = true;
  const instanceId = injectHand(state, 'playerA', 'BP01-080');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 50);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 50);
  assert.strictEqual(state.players.playerB.leaders[2].damage, 0, 'ダウン済みリーダーは対象外のはず');
  assert.strictEqual(state.players.playerB.leaders[3].damage, 50);
});

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
