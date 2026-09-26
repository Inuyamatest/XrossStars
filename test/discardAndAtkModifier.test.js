/* Card Effect Engine — Phase D-1 自動テスト（node test/discardAndAtkModifier.test.js で実行）
 * 対象: js/engine/effectResolver.js の DISCARD_HAND / EQUIP_ATK_MODIFIER
 *       js/engine/gameState.js の getEquipmentAtkModifierSum（getLeaderCurrentAtkへの加算）
 *       js/engine/cardEffectData.js に今回追加した実カード群
 *
 * 既存ファイル（gameState.js以外のjs/engine/*.js、js/deckbuilder/、data/cards.json）は無改修。
 * 既存テスト（gameEngine.test.js / deckRules.test.js / cardEffect.test.js /
 * cardEffectIntegration.test.js）はすべて無変更のまま成功することを別途確認済み。
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const GameState = require('../js/engine/gameState.js');
const ResolutionStack = require('../js/engine/resolutionStack.js');
const Combat = require('../js/engine/combat.js');
const Phases = require('../js/engine/phases.js');
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

function fillDeck(cardId, count) { return new Array(count).fill(cardId); }

function makeMatchConfig(overrides) {
  return Object.assign({
    matchId: 'discard-atk-test-match',
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
console.log('=== DISCARD_HAND: BP01-093 ジャミングパルス（対戦相手は手札を2枚捨てる） ===');
// ============================================================

test('相手の手札2枚を捨てる（DISCARD_HAND who:OPPONENT）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const handBefore = state.players.playerB.hand.length;
  const trashBefore = state.players.playerB.trash.length;
  const instanceId = injectTactics(state, 'playerA', 'BP01-093');
  state.turn.turnNumber = 2; // 先攻1ターン目のタクティクス制限を避ける（PROVISIONALとは無関係の単純な準備）

  EffectResolver.playTacticsCardWithEffects(state, 'playerA', instanceId, { subType: 'CONSUMABLE' }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  assert.strictEqual(state.players.playerB.hand.length, handBefore - 2);
  assert.strictEqual(state.players.playerB.trash.length, trashBefore + 2);
});

test('捨てたカードが正しいZoneへ移動する（トラッシュへ裏向き）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.turn.turnNumber = 2;
  const discardedCardId = state.players.playerB.hand[0].cardId;
  const instanceId = injectTactics(state, 'playerA', 'BP01-093');
  state.players.playerB.hand = state.players.playerB.hand.slice(0, 1); // 手札を1枚だけにして「最後の1枚」を確定させる

  EffectResolver.playTacticsCardWithEffects(state, 'playerA', instanceId, { subType: 'CONSUMABLE' }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  assert.strictEqual(state.players.playerB.hand.length, 0);
  const trashedEntry = state.players.playerB.trash[state.players.playerB.trash.length - 1];
  assert.strictEqual(trashedEntry.card.cardId, discardedCardId);
  assert.strictEqual(trashedEntry.faceUp, false);
});

test('手札が指定枚数未満でもクラッシュせず、あるだけ捨てる（PROVISIONAL: DISCARD_AVAILABLE_ONLY）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.turn.turnNumber = 2;
  state.players.playerB.hand = state.players.playerB.hand.slice(0, 1); // 手札を1枚に減らす（要求は2枚）
  const instanceId = injectTactics(state, 'playerA', 'BP01-093');

  assert.doesNotThrow(() => {
    EffectResolver.playTacticsCardWithEffects(state, 'playerA', instanceId, { subType: 'CONSUMABLE' }, cardIndex);
    ResolutionStack.resolveAll(state.resolutionStack, state);
  });
  assert.strictEqual(state.players.playerB.hand.length, 0, '2枚指定でも手札1枚しかなければ1枚だけ捨てて終わるはず');
});

test('0枚指定でも安全に失敗する（不正な数値でもクラッシュしない）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const handBefore = state.players.playerA.hand.length;
  assert.doesNotThrow(() => {
    EffectResolver.applyAction(state, { type: 'DISCARD_HAND', who: 'SELF', amount: 0 }, [], { ownerPlayerId: 'playerA' }, cardIndex);
  });
  assert.strictEqual(state.players.playerA.hand.length, handBefore);
});

test('不正対象でクラッシュしない：手札が0枚の状態でDISCARD_HANDを発動しても何も起きない', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.hand = [];
  const instanceId = injectTactics(state, 'playerA', 'BP01-093');
  state.turn.turnNumber = 2;
  assert.doesNotThrow(() => {
    EffectResolver.playTacticsCardWithEffects(state, 'playerA', instanceId, { subType: 'CONSUMABLE' }, cardIndex);
    ResolutionStack.resolveAll(state.resolutionStack, state);
  });
  assert.strictEqual(state.players.playerB.hand.length, 0);
});

test('カスタムchooseDiscardで捨てるカードを指定できる（誰が選ぶかはPROVISIONAL、既定の上書き手段として提供）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const targetId = state.players.playerB.hand[0].instanceId;
  const chooseDiscard = (hand, count) => hand.slice(0, count).map((c) => c.instanceId);
  EffectResolver.applyAction(state, { type: 'DISCARD_HAND', who: 'OPPONENT', amount: 1 }, [], { ownerPlayerId: 'playerA', chooseDiscard: chooseDiscard }, cardIndex);
  assert.strictEqual(state.players.playerB.hand.some((c) => c.instanceId === targetId), false, '指定した先頭カードが捨てられているはず');
});

// ============================================================
console.log('=== DISCARD_HAND: 自分の手札を捨てるケース（リスキーエントリー：カードを1枚引き、手札を1枚捨てる） ===');
// ============================================================

test('自分の手札を捨てるケースが実在する：リスキーエントリーはドロー後に自分の手札を1枚捨てる', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 75; // このカード自体はダメージ効果を持たないため、atk30の1撃で確実にダウンさせる
  const instanceId = injectHand(state, 'playerA', 'BP01-028');
  const handAfterPlay = state.players.playerA.hand.length - 1;
  const deckBefore = state.players.playerA.deck.length;

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  // ドロー1枚→手札1枚捨て（デフォルトでは末尾＝直前に引いたカードを捨てる）で手札の総数は差し引きゼロ
  assert.strictEqual(state.players.playerA.hand.length, handAfterPlay);
  assert.strictEqual(state.players.playerA.deck.length, deckBefore - 1, 'デッキから実際に1枚引かれているはず（発火の証拠）');
  assert.strictEqual(state.players.playerA.trash.some((t) => !t.faceUp), true, '捨てたカードがトラッシュに裏向きで存在するはず');
});

test('リーダー覚醒時の自分の手札を捨てるケース：橘ひなの（カードを2枚引き、手札を2枚捨てる）', () => {
  const state = Match.createMatch(makeMatchConfig({ playerA: { leaderCardIds: ['BP01-003', 'BP01-002', 'BP01-004', 'BP01-001'], deckCardIds: fillDeck(FILLER_ATTACK, 50), tacticsDeckCardIds: TACTICS_5 } }));
  state.players.playerB.leaders[0].damage = 75;
  const deckBefore = state.players.playerA.deck.length;
  const instanceId = injectHand(state, 'playerA', FILLER_ATTACK);
  const handAfterAttackCardPlay = state.players.playerA.hand.length - 1; // プレイ後の基準値（injectHand後に計算する）

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerA.leaders[0].awakened, true);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  assert.strictEqual(state.players.playerA.hand.length, handAfterAttackCardPlay, '2枚引いて2枚捨てるので差し引きゼロのはず');
  assert.strictEqual(state.players.playerA.deck.length, deckBefore - 2);
});

// ============================================================
console.log('=== DISCARD_HAND: 全員が捨てるケース（ドリル開錠） ===');
// ============================================================

test('すべてのプレイヤーが手札を1枚捨てる（DISCARD_HAND who:ALL）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const handABefore = state.players.playerA.hand.length;
  const handBBefore = state.players.playerB.hand.length;
  const instanceId = injectHand(state, 'playerA', 'BP01-032');

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  // handABeforeは注入前の値（プレイした1枚は元々手札になかった分なので相殺される）。
  // 実際に減るのはDISCARD_HAND(who:ALL)による自分の1枚捨ての分だけ。
  assert.strictEqual(state.players.playerA.hand.length, handABefore - 1, 'DISCARD_HANDで自分も1枚捨てるはず');
  assert.strictEqual(state.players.playerB.hand.length, handBBefore - 1, '相手も1枚捨てるはず');
});

// ============================================================
console.log('=== DISCARD_HAND: 条件付き・複合ケース ===');
// ============================================================

test('条件付きOPPONENT discard：ダウンしなければ発火しない（ブリッツブラスト）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const handBBefore = state.players.playerB.hand.length;
  const instanceId = injectHand(state, 'playerA', 'BP01-033');

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, false);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.hand.length, handBBefore, 'ダウンしていないので発火しないはず');
});

test('複合ケース：強奪の宴（自分ドロー＋相手ディスカードが同時に発火）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders[0].damage = 75;
  const handABefore = state.players.playerA.hand.length; // プレイした1枚は注入前の値と相殺されるため-1は不要
  const handBBefore = state.players.playerB.hand.length;
  const instanceId = injectHand(state, 'playerA', 'BP03-038');

  EffectResolver.playAttackCardWithEffects(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  assert.strictEqual(state.players.playerA.hand.length, handABefore + 1);
  assert.strictEqual(state.players.playerB.hand.length, handBBefore - 1);
});

test('既存手札処理との競合がない：DISCARD_HAND解決後もEND_PHASEの7枚制限処理は正常に動作する', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', 'BP01-093' /* TACTICSだがここではATTACKとして注入しない */);
  // BP01-093はTACTICSなのでhand経由ではなくtacticsArea経由でプレイする
  state.players.playerA.hand = state.players.playerA.hand.filter((c) => c.instanceId !== instanceId);
  const tacticsInstance = injectTactics(state, 'playerA', 'BP01-093');
  state.turn.turnNumber = 2;

  EffectResolver.playTacticsCardWithEffects(state, 'playerA', tacticsInstance, { subType: 'CONSUMABLE' }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  // その後、手札を9枚まで積み増してEND_PHASEを実行 → 既存のgameEngine.test.jsと同じ検証
  while (state.players.playerA.hand.length < 9) {
    state.players.playerA.hand.push(GameState.createCardInstance(FILLER_ATTACK));
  }
  state.turn.phase = 'END_PHASE';
  state.players.playerA.ppCards.tapped = state.players.playerA.ppCards.max;
  Phases.runEndPhase(state);
  assert.strictEqual(state.players.playerA.hand.length, 7, 'DISCARD_HAND効果とEND_PHASEの7枚制限が競合せず独立して動作するはず');
});

// ============================================================
console.log('=== EQUIP_ATK_MODIFIER: メリケンサック（攻撃力+10） ===');
// ============================================================

test('装備前ATK / 装備後ATK：メリケンサックでATK+10される', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.turn.turnNumber = 2;
  const leader = state.players.playerA.leaders[0];
  const baseAtk = GameState.getLeaderCurrentAtk(cardIndex, leader);

  const instanceId = injectTactics(state, 'playerA', 'BP02-080');
  EffectResolver.playTacticsCardWithEffects(state, 'playerA', instanceId, { subType: 'EQUIPMENT', equipLeaderIndex: 0 }, cardIndex);

  assert.strictEqual(leader.equipment[0].atkModifier, 10);
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, leader), baseAtk + 10);
  assert.strictEqual(EffectResolver.getEffectiveAtk(cardIndex, leader), baseAtk + 10);
});

test('複数装備：メリケンサックを2枚装備すると+20される（加算方式）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.turn.turnNumber = 2;
  const leader = state.players.playerA.leaders[0];
  const baseAtk = GameState.getLeaderCurrentAtk(cardIndex, leader);

  const instance1 = injectTactics(state, 'playerA', 'BP02-080');
  EffectResolver.playTacticsCardWithEffects(state, 'playerA', instance1, { subType: 'EQUIPMENT', equipLeaderIndex: 0 }, cardIndex);
  state.turn.tacticsPlayedThisTurn = false; // 1ターン1枚制限を回避するためのテスト上の準備（ルールとは無関係）
  const instance2 = injectTactics(state, 'playerA', 'BP02-080');
  EffectResolver.playTacticsCardWithEffects(state, 'playerA', instance2, { subType: 'EQUIPMENT', equipLeaderIndex: 0 }, cardIndex);

  assert.strictEqual(leader.equipment.length, 2);
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, leader), baseAtk + 20);
});

test('ATK modifierが実戦のダメージ計算へ反映される', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.turn.turnNumber = 2;
  const leader = state.players.playerA.leaders[0];
  const baseAtk = GameState.getLeaderCurrentAtk(cardIndex, leader);

  const instanceId = injectTactics(state, 'playerA', 'BP02-080');
  EffectResolver.playTacticsCardWithEffects(state, 'playerA', instanceId, { subType: 'EQUIPMENT', equipLeaderIndex: 0 }, cardIndex);

  Combat.declareAttack(state, {
    attackerPlayerId: 'playerA', attackerLeaderIndex: 0,
    targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].damage, baseAtk + 10, 'combat.js無改修のまま、ATK+10が実ダメージへ反映されるはず');
});

test('装備解除/ダウン時の処理：ラウンドをまたいでもATK modifierは装備が残る限り持続する（既存downedLeaderEquipmentHandling: KEEP）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.turn.turnNumber = 2;
  const leader = state.players.playerA.leaders[0];
  const baseAtk = GameState.getLeaderCurrentAtk(cardIndex, leader);
  const instanceId = injectTactics(state, 'playerA', 'BP02-080');
  EffectResolver.playTacticsCardWithEffects(state, 'playerA', instanceId, { subType: 'EQUIPMENT', equipLeaderIndex: 0 }, cardIndex);

  // このリーダーをダウンさせてからラウンドリセット（装備は既存仕様どおり保持される想定）
  leader.isDown = true;
  Match.resetForNextRound(state);
  assert.strictEqual(leader.isDown, false, 'ラウンドリセットでダウンは復活する（既存仕様）');
  assert.strictEqual(leader.equipment.length, 1, '装備はラウンドをまたいで保持される（既存downedLeaderEquipmentHandling）');
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, leader), baseAtk + 10, 'ATK modifierも装備が残る限り持続するはず');
});

test('既存HP modifierと独立して動作する：ライトシールド(HP+30)とメリケンサック(ATK+10)を同時装備', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.turn.turnNumber = 2;
  const leader = state.players.playerA.leaders[0];
  const baseHp = GameState.getLeaderMaxHp(cardIndex, leader);
  const baseAtk = GameState.getLeaderCurrentAtk(cardIndex, leader);

  const hpInstance = injectTactics(state, 'playerA', 'BP01-095');
  EffectResolver.playTacticsCardWithEffects(state, 'playerA', hpInstance, { subType: 'EQUIPMENT', equipLeaderIndex: 0 }, cardIndex);
  state.turn.tacticsPlayedThisTurn = false;
  const atkInstance = injectTactics(state, 'playerA', 'BP02-080');
  EffectResolver.playTacticsCardWithEffects(state, 'playerA', atkInstance, { subType: 'EQUIPMENT', equipLeaderIndex: 0 }, cardIndex);

  assert.strictEqual(GameState.getLeaderMaxHp(cardIndex, leader), baseHp + 30, 'HP modifierはATK装備の影響を受けないはず');
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, leader), baseAtk + 10, 'ATK modifierはHP装備の影響を受けないはず');
});

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
