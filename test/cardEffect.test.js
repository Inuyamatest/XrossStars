/* Card Effect Engine の自動テスト（依存ライブラリなし。node test/cardEffect.test.js で実行）
 * 対象: js/engine/cardEffect.js, js/engine/cardEffectData.js, js/engine/effectResolver.js
 * 根拠: docs/xross-stars-game-spec.md 26〜28章 / docs/game-engine-architecture.md 10〜11章
 *
 * このファイルは js/engine/*.js（gameState/events/resolutionStack/deck/combat/phases/match）を
 * 一切変更せずに、それらの上に乗る Card Effect Engine（cardEffectData.js / effectResolver.js）だけを
 * 検証する。既存の test/gameEngine.test.js / test/deckRules.test.js は変更しない。
 *
 * 使用しているカードはすべて data/cards.json / js/data/leaders.js に実在するカードである
 * （BP01-058危機一髪 / BP01-019インパクトショット / BP01-095ライトシールド /
 *   BP01-021ギャングの襲撃 / BP01-053超新星 / BP01-018エレガントドミネート / ST02-002 Mondo）。
 * ただし「解決時Condition再評価」を汎用機構として厳密に検証するテスト（末尾の1件のみ）は、
 * 実在しないカードを新設せず、CardEffectCore.createCardEffect() で作った検証専用の
 * 合成PendingEffectを使う（test/gameEngine.test.js のResolutionStack単体テストと同じ考え方）。
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const RuleConfig = require('../js/engine/ruleConfig.js');
const GameState = require('../js/engine/gameState.js');
const Events = require('../js/engine/events.js');
const ResolutionStack = require('../js/engine/resolutionStack.js');
const Deck = require('../js/engine/deck.js');
const Combat = require('../js/engine/combat.js');
const Phases = require('../js/engine/phases.js');
const Match = require('../js/engine/match.js');
const CardEffectCore = require('../js/engine/cardEffect.js');
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

// ---- テスト用データ ----
const LEADERS_A = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004'];
const LEADERS_A_WITH_MONDO = ['ST02-002', 'BP01-002', 'BP01-003', 'BP01-004']; // 覚醒時効果テスト用
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

// 手札に直接カードを1枚加え、instanceIdを返す（既存gameEngine.test.jsと同じ手法）
function injectHand(state, playerId, cardId) {
  const instance = GameState.createCardInstance(cardId);
  state.players[playerId].hand.push(instance);
  return instance.instanceId;
}

// タクティクスエリアに直接カードを1枚置き、instanceIdを返す（装備テスト用）
function injectTactics(state, playerId, cardId) {
  const instance = GameState.createCardInstance(cardId);
  state.players[playerId].tacticsArea.push({ card: instance, faceUp: false });
  return instance.instanceId;
}

// ============================================================
console.log('=== ON_PLAY: 危機一髪（メモリア, カードを2枚引く） ===');
// ============================================================

test('ON_PLAY効果が正しく発火する：危機一髪でカードを2枚引く', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP01-058');
  const handBefore = state.players.playerA.hand.length;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  // 手札：プレイした1枚が減り、ON_PLAY効果で2枚増える
  assert.strictEqual(state.players.playerA.hand.length, handBefore - 1 + 2);
});

test('Costが正しく消費される：危機一髪のcost1がPPから消費される', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP01-058');
  const tappedBefore = state.players.playerA.ppCards.tapped;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  assert.strictEqual(state.players.playerA.ppCards.tapped, tappedBefore + 1);
});

test('EffectがGameStateへ反映される：ON_PLAY解決前は手札は減った状態のまま増えていない', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP01-058');
  const handBefore = state.players.playerA.hand.length;
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  // まだResolutionStackを解決していないので、ドロー分はまだ反映されない
  assert.strictEqual(state.players.playerA.hand.length, handBefore - 1);
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 1);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore - 1 + 2);
});

// ============================================================
console.log('=== ON_ATTACK: インパクトショット（アタックカード自身のダメージ+40） ===');
// ============================================================

test('ON_ATTACK効果が正しく発火する：インパクトショットのダメージ+40がアタックダメージに加算される', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP01-019');
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, false);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 40 + atk);
});

// ============================================================
console.log('=== AFTER_ATTACK + Condition: ギャングの襲撃（ダウンしていればカードを1枚引く） ===');
// ============================================================

test('Conditionが正しく判定される：ダウンしなかった場合はAFTER_ATTACK効果が発火しない', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP01-021');
  const handBeforeAttack = state.players.playerA.hand.length - 1; // プレイして1枚減った後の基準
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, false, 'atk30・ベースダメージ0では100HPをダウンさせない前提が崩れている');
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack, 'ダウンしていないのでドローは発生しないはず');
});

test('Conditionが正しく判定される・EffectがGameStateへ反映される：ダウンした場合はカードを1枚引く', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 75; // 残りHP25。atk30のみで確実にダウンする
  const instanceId = injectHand(state, 'playerA', 'BP01-021');
  const handBeforeAttack = state.players.playerA.hand.length - 1;
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 1, 'ダウンしているのでドローが発生するはず');
});

// ============================================================
console.log('=== Target選択 + No-op安全性: エレガントドミネート（対戦相手の他のリーダー1体に20ダメージ） ===');
// ============================================================

test('不正な対象の場合に安全に失敗する：対象になれる他リーダーがいなければNo-opで例外にならない', () => {
  const state = Match.createMatch(makeMatchConfig());
  // 攻撃対象(0)以外の相手リーダーを全員ダウンさせておく
  state.players.playerB.leaders[1].isDown = true;
  state.players.playerB.leaders[2].isDown = true;
  state.players.playerB.leaders[3].isDown = true;
  const instanceId = injectHand(state, 'playerA', 'BP01-018');
  assert.doesNotThrow(() => {
    EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
      attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
    }, cardIndex);
    ResolutionStack.resolveAll(state.resolutionStack, state);
  });
  // 誰にも追加ダメージが入っていないこと（No-op）
  assert.strictEqual(state.players.playerB.leaders[1].damage, 0);
  assert.strictEqual(state.players.playerB.leaders[2].damage, 0);
  assert.strictEqual(state.players.playerB.leaders[3].damage, 0);
});

test('Targetが正しく選択される：対象がいれば対戦相手の他のリーダーに20ダメージが入る', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 75; // アタック対象。atk30でダウンする
  const instanceId = injectHand(state, 'playerA', 'BP01-018');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  // target()はindex!==0かつisDownでない候補の先頭（index1）を選ぶ
  assert.strictEqual(state.players.playerB.leaders[1].damage, 20);
  assert.strictEqual(state.players.playerB.leaders[2].damage, 0);
  assert.strictEqual(state.players.playerB.leaders[3].damage, 0);
});

test('Targetが正しく選択される：chooseTargetで対象を選び直せる', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 75;
  const instanceId = injectHand(state, 'playerA', 'BP01-018');
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
    chooseTarget: (candidates) => candidates.findIndex((c) => c.leaderIndex === 2),
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[1].damage, 0);
  assert.strictEqual(state.players.playerB.leaders[2].damage, 20);
});

// ============================================================
console.log('=== 複数Effect + ResolutionStack統合: 超新星（アタック強化+アタック後） × ギャングの襲撃 ===');
// ============================================================

test('複数Effectが正しい順番で解決される・ResolutionStackと連携できる：超新星＋ギャングの襲撃', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 45; // 超新星の+30ブースト込みで確実にダウンさせる

  const memoriaInstance = injectHand(state, 'playerA', 'BP01-053'); // 超新星（cost2, ACE）
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', memoriaInstance, {}, cardIndex);
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 0, '超新星自身はプレイ時ではなくアタック強化/アタック後効果のみ');

  const attackInstance = injectHand(state, 'playerA', 'BP01-021'); // ギャングの襲撃（cost1）
  const handBeforeAttack = state.players.playerA.hand.length - 1;

  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackInstance, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);

  assert.strictEqual(state.players.playerB.leaders[0].isDown, true, '45+ブースト30+atk30=105>=100でダウンする前提');
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 2, 'ギャングの襲撃自身のAFTER_ATTACKと、超新星が積んでおいたAFTER_ATTACKの2件が積まれるはず');
  const tappedAfterAttack = state.players.playerA.ppCards.tapped; // 超新星cost2+ギャングの襲撃cost1=3タップ済みのはず

  // 実行順をあえて逆に選ぶ（超新星のMULTI効果を先に解決）。
  // resolveOne()は候補が2件以上のときだけchooseIndexFnを呼ぶため、1件目の解決結果を
  // 都度確認することで「選んだ順に解決されている」ことを検証する。
  ResolutionStack.resolveOne(state.resolutionStack, state, (candidates) => candidates.findIndex((c) => c.sourceInstanceId === memoriaInstance));
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 1, '超新星の効果が先に解決され、ギャングの襲撃の分だけ残るはず');
  assert.strictEqual(state.players.playerA.ppCards.tapped, Math.max(0, tappedAfterAttack - 2), '超新星のPP回復2が先に反映されているはず');
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 1, '超新星のドロー1が先に反映されているはず');

  ResolutionStack.resolveOne(state.resolutionStack, state);
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 0);
  assert.strictEqual(state.players.playerA.hand.length, handBeforeAttack + 2, 'ギャングの襲撃のドロー1も反映され合計+2になるはず');
});

// ============================================================
console.log('=== 解決時Condition再評価（実カード + 検証用の合成PendingEffectで機構自体を検証） ===');
// ============================================================

test('解決時Condition再評価が機能する：宣言時は対象が生存していても、先に別の効果でダウンすれば実カードの条件が成立する', () => {
  const state = Match.createMatch(makeMatchConfig());
  assert.strictEqual(state.players.playerB.leaders[0].isDown, false);

  // 実カード（ギャングの襲撃）のAFTER_ATTACK定義をそのまま使う。
  // ctxは「playerAがplayerBのleaders[0]を攻撃した」という体で組み立てる。
  const gangEffect = CardEffectData.getEffectsForCard('BP01-021')[0];
  const ctx = { ownerPlayerId: 'playerA', sourceInstanceId: 'test-gang#1', targetPlayerId: 'playerB', targetLeaderIndex: 0 };
  const gangPending = EffectResolver.buildPendingEffect(gangEffect, ctx, cardIndex);

  // 検証専用の合成効果：実在カードではなく、"先に解決すると対象をダウンさせる"効果をテストのために組み立てる
  // （このPendingEffectはcardEffectData.jsには登録しない。ResolutionStackの解決時評価そのものを検証するための治具）
  const lethalStrike = CardEffectCore.createCardEffect({
    trigger: 'AFTER_ATTACK',
    target: () => [{ playerId: 'playerB', leaderIndex: 0 }],
    action: { type: 'DAMAGE', amount: 9999 },
  });
  const lethalCtx = { ownerPlayerId: 'playerA', sourceInstanceId: 'test-lethal#1' };
  const lethalPending = EffectResolver.buildPendingEffect(lethalStrike, lethalCtx, cardIndex);

  ResolutionStack.push(state.resolutionStack, gangPending);
  ResolutionStack.push(state.resolutionStack, lethalPending);
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 2);

  const handBefore = state.players.playerA.hand.length;

  // lethalStrikeを先に解決 → 対象がダウンする → ギャングの襲撃の条件は「解決時点」で真になる
  ResolutionStack.resolveOne(state.resolutionStack, state, (candidates) => candidates.findIndex((c) => c.sourceInstanceId === 'test-lethal#1'));
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  ResolutionStack.resolveOne(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + 1, '解決時点(ダウン後)の状態で条件判定されるため発火するはず');
});

test('解決時Condition再評価が機能する：先に条件を評価すると宣言時点(生存中)の状態でfalseになり発火しない', () => {
  const state = Match.createMatch(makeMatchConfig());

  const gangEffect = CardEffectData.getEffectsForCard('BP01-021')[0];
  const ctx = { ownerPlayerId: 'playerA', sourceInstanceId: 'test-gang#2', targetPlayerId: 'playerB', targetLeaderIndex: 0 };
  const gangPending = EffectResolver.buildPendingEffect(gangEffect, ctx, cardIndex);

  const lethalStrike = CardEffectCore.createCardEffect({
    trigger: 'AFTER_ATTACK',
    target: () => [{ playerId: 'playerB', leaderIndex: 0 }],
    action: { type: 'DAMAGE', amount: 9999 },
  });
  const lethalCtx = { ownerPlayerId: 'playerA', sourceInstanceId: 'test-lethal#2' };
  const lethalPending = EffectResolver.buildPendingEffect(lethalStrike, lethalCtx, cardIndex);

  ResolutionStack.push(state.resolutionStack, gangPending);
  ResolutionStack.push(state.resolutionStack, lethalPending);

  const handBefore = state.players.playerA.hand.length;

  // ギャングの襲撃を先に解決 → まだ対象は生存中なので条件不成立（No-op扱いでスタックから除去される）
  ResolutionStack.resolveOne(state.resolutionStack, state, (candidates) => candidates.findIndex((c) => c.sourceInstanceId === 'test-gang#2'));
  assert.strictEqual(state.players.playerA.hand.length, handBefore, '解決した時点ではまだ生存しているので発火しないはず');
  // 続けてlethalStrikeを解決（対象はダウンするが、ギャングの襲撃は既にNo-opとして消費済み）
  ResolutionStack.resolveOne(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  assert.strictEqual(state.players.playerA.hand.length, handBefore, '一度No-opとして解決済みの効果が後から再発火することはない');
});

// ============================================================
console.log('=== ON_AWAKEN: Mondo（自分のリーダー1体を20回復） ===');
// ============================================================

test('覚醒時効果が正しく発火する：Mondoが覚醒すると自分（デフォルトでは覚醒した本人）を20回復する', () => {
  const state = Match.createMatch(makeMatchConfig({ playerA: { leaderCardIds: LEADERS_A_WITH_MONDO, deckCardIds: fillDeck(FILLER_ATTACK, 50), tacticsDeckCardIds: TACTICS_5 } }));
  state.players.playerA.leaders[0].damage = 50; // Mondo自身に事前ダメージ
  state.players.playerB.leaders[0].damage = 75; // atk30の1撃でダウンする
  assert.strictEqual(state.players.playerA.leaders[0].awakened, false);

  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);

  assert.strictEqual(state.players.playerA.leaders[0].awakened, true);
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 1);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 30, '50ダメージ-20回復=30になるはず');
});

test('覚醒時効果でTargetが正しく選択される：chooseHealTargetで回復対象を他のリーダーに変更できる', () => {
  const state = Match.createMatch(makeMatchConfig({ playerA: { leaderCardIds: LEADERS_A_WITH_MONDO, deckCardIds: fillDeck(FILLER_ATTACK, 50), tacticsDeckCardIds: TACTICS_5 } }));
  state.players.playerA.leaders[1].damage = 40; // 別のリーダーに事前ダメージ
  state.players.playerB.leaders[0].damage = 75;

  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK);
  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
    chooseHealTarget: (candidates) => candidates.findIndex((c) => c.leaderIndex === 1),
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[1].damage, 20, '40ダメージ-20回復=20になるはず');
});

// ============================================================
console.log('=== 装備効果: ライトシールド（体力+30） ===');
// ============================================================

test('装備効果が正しく反映される：ライトシールドを装備すると実効最大HPが+30される（EffectがGameStateへ反映される）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.turn.turnNumber = 2; // 先攻1ターン目のタクティクス制限を避ける（RuleConfig, ⚠️未確定ルールとは無関係の単純な準備）
  const leader = state.players.playerA.leaders[0];
  const baseMaxHp = GameState.getLeaderMaxHp(cardIndex, leader);

  const instanceId = injectTactics(state, 'playerA', 'BP01-095');
  Phases.playTacticsCard(state, 'playerA', instanceId, { subType: 'EQUIPMENT', equipLeaderIndex: 0 }, cardIndex);

  assert.strictEqual(leader.equipment.length, 1);
  assert.strictEqual(EffectResolver.getEffectiveMaxHp(cardIndex, leader), baseMaxHp + 30);
  // 既知の制限（未実装）：combat.js の DOWN CHECK は GameState.getLeaderMaxHp のみを見るため、
  // 装備による+30はまだ実際のダウン判定には反映されない（今回のスコープ外。最終報告に明記する）。
});

// ============================================================
console.log('=== 安全性: 未知のActionTypeは黙って無視せず例外にする ===');
// ============================================================

test('未知のActionTypeを渡すと例外になる（設定ミスに気付けるようにする安全設計）', () => {
  const state = Match.createMatch(makeMatchConfig());
  assert.throws(() => {
    EffectResolver.applyAction(state, { type: 'NOT_A_REAL_ACTION' }, [], { ownerPlayerId: 'playerA' }, cardIndex);
  });
});

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
