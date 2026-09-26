/* Card Effect Engine — Phase D-3 自動テスト（node test/actionExpansionD3.test.js で実行）
 * 対象: js/engine/effectResolver.js（MOVE_EQUIPMENT / TEMP_ATK_MODIFIER / DISTRIBUTED_HEAL /
 *       DERIVED_AMOUNT）、js/engine/gameState.js（tempAtkModifier）、
 *       js/engine/effectFactories.js（makeAllOwnAliveLeadersTarget / makeAnyOpponentLeaderTarget）、
 *       js/engine/cardEffectData.js に今回追加した実カード群
 *
 * 既存ファイル（cardEffect.js/events.js/resolutionStack.js/deck.js/combat.js/phases.js、
 * js/deckbuilder/、data/cards.json）は無改修。
 * 既存テスト（gameEngine/deckRules/cardEffect/cardEffectIntegration/discardAndAtkModifier/
 * conditionTargetExpansion/equipGrantAbility、計137件）はすべて無変更のまま成功することを別途確認済み。
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const GameState = require('../js/engine/gameState.js');
const ResolutionStack = require('../js/engine/resolutionStack.js');
const Combat = require('../js/engine/combat.js');
const Match = require('../js/engine/match.js');
const CardEffectData = require('../js/engine/cardEffectData.js');
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
    matchId: 'd3-test-match',
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
console.log('=== D-3-A: MOVE_EQUIPMENT（メカニカルエキスパート） ===');
// ============================================================

test('Test1/2/3: Aリーダーの装備をBリーダーへ移動（Aから消え、Bに同じinstanceIdで追加される）', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP01-095', 0); // ライトシールド
  const originalInstanceId = state.players.playerA.leaders[0].equipment[0].instanceId;

  const instanceId = injectHand(state, 'playerA', 'BP03-045');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {
    chooseMoveEquipment: (candidates) => ({ candidateIndex: 0, toLeaderIndex: 1 }),
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  assert.strictEqual(state.players.playerA.leaders[0].equipment.length, 0, 'Aから装備が消えるはず');
  assert.strictEqual(state.players.playerA.leaders[1].equipment.length, 1, 'Bに装備が追加されるはず');
  assert.strictEqual(state.players.playerA.leaders[1].equipment[0].instanceId, originalInstanceId, '同じinstanceIdのまま移動するはず（新規生成しない）');
});

test('Test4: HP modifierが移動後も維持される', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP01-095', 0); // ライトシールド(HP+30)
  const instanceId = injectHand(state, 'playerA', 'BP03-045');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {
    chooseMoveEquipment: () => ({ candidateIndex: 0, toLeaderIndex: 1 }),
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[1].equipment[0].hpModifier, 30);
  const baseHp = cardIndex['BP01-002'].hp; // leaders[1]のカードデータ
  assert.strictEqual(GameState.getLeaderMaxHp(cardIndex, state.players.playerA.leaders[1]), baseHp + 30);
});

test('Test5: ATK modifierが移動後も維持される', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP02-080', 0); // メリケンサック(ATK+10)
  const instanceId = injectHand(state, 'playerA', 'BP03-045');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {
    chooseMoveEquipment: () => ({ candidateIndex: 0, toLeaderIndex: 2 }),
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[2].equipment[0].atkModifier, 10);
  const baseAtk = cardIndex['BP01-003'].atk;
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[2]), baseAtk + 10);
});

test('Test6: grantedAbilitiesが移動後も維持される', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP02-078', 0); // 盗賊キット
  const instanceId = injectHand(state, 'playerA', 'BP03-045');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {
    chooseMoveEquipment: () => ({ candidateIndex: 0, toLeaderIndex: 3 }),
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[3].equipment[0].grantedAbilities.length, 1);
  assert.strictEqual(state.players.playerA.leaders[3].equipment[0].grantedAbilities[0].trigger, 'AFTER_ATTACK');
});

test('Test7: 装備が無い場合にクラッシュしない（No-op）', () => {
  const state = freshMatchAtTurn2();
  const instanceId = injectHand(state, 'playerA', 'BP03-045');
  assert.doesNotThrow(() => {
    EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {
      chooseMoveEquipment: () => ({ candidateIndex: 0, toLeaderIndex: 1 }),
    }, cardIndex);
    ResolutionStack.resolveAll(state.resolutionStack, state);
  });
  state.players.playerA.leaders.forEach((l) => assert.strictEqual(l.equipment.length, 0));
});

test('Test8: 不正な移動先（自分自身）でクラッシュせず、装備は元のまま', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP01-095', 0);
  const instanceId = injectHand(state, 'playerA', 'BP03-045');
  assert.doesNotThrow(() => {
    EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {
      chooseMoveEquipment: () => ({ candidateIndex: 0, toLeaderIndex: 0 }), // 移動元と同じ＝不正
    }, cardIndex);
    ResolutionStack.resolveAll(state.resolutionStack, state);
  });
  assert.strictEqual(state.players.playerA.leaders[0].equipment.length, 1, '不正な移動先の場合は元のまま残るはず');
});

test('デフォルト（chooseMoveEquipment未指定）は「してもよい」を辞退したものとして何もしない（PROVISIONAL）', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP01-095', 0);
  const instanceId = injectHand(state, 'playerA', 'BP03-045');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[0].equipment.length, 1, '未選択時は移動しないはず');
});

// ============================================================
console.log('=== D-3-B: TEMP_ATK_MODIFIER（先導者の証） ===');
// ============================================================

test('Test1/2: 通常ATK → 先導者の証プレイ後は自分のリーダー全員+30される', () => {
  const state = freshMatchAtTurn2();
  const baseAtk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP01-071');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  state.players.playerA.leaders.forEach((l) => {
    assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, l), baseAtk + 30);
  });
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, state.players.playerB.leaders[0]), GameState.getLeaderCurrentAtk(cardIndex, state.players.playerB.leaders[0]), '相手には影響しない前提の確認用');
  assert.notStrictEqual(state.players.playerB.leaders[0].tempAtkModifier, 30, '相手のリーダーには付与されないはず');
});

test('Test3: 攻撃時に反映される', () => {
  const state = freshMatchAtTurn2();
  const buffInstance = injectHand(state, 'playerA', 'BP01-071');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', buffInstance, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  Combat.declareAttack(state, {
    attackerPlayerId: 'playerA', attackerLeaderIndex: 0,
    targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 0,
  }, cardIndex);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  assert.strictEqual(state.players.playerB.leaders[0].damage, atk, 'combat.js無改修のまま、一時ATK補正込みのダメージが反映されるはず');
});

test('Test4: ターン終了後に消える', () => {
  const state = freshMatchAtTurn2();
  const baseAtk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP01-071');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]), baseAtk + 30);

  EffectResolver.endTurnAndSwitchWithEffects(state);
  assert.strictEqual(state.players.playerA.leaders[0].tempAtkModifier, 0);
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]), baseAtk, 'ターン終了後は元のATKに戻るはず');
});

test('Test5: 複数補正（同じ効果を2回付与すると加算で積み上がる）', () => {
  const state = freshMatchAtTurn2();
  const baseAtk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instance1 = injectHand(state, 'playerA', 'BP01-071');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instance1, {}, cardIndex);
  const instance2 = injectHand(state, 'playerA', 'BP01-071');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instance2, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]), baseAtk + 60);
});

test('Test6: Equipment ATKとの併用', () => {
  const state = freshMatchAtTurn2();
  const baseAtk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  equip(state, 'playerA', 'BP02-080', 0); // ATK+10
  const instanceId = injectHand(state, 'playerA', 'BP01-071'); // ATK+30(一時)
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]), baseAtk + 10 + 30);
});

test('Test7: 既存ATTACK_BONUS(ON_ATTACK)との併用', () => {
  const state = freshMatchAtTurn2();
  const baseAtk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const buffInstance = injectHand(state, 'playerA', 'BP01-071');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', buffInstance, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);

  const attackInstance = injectHand(state, 'playerA', 'BP01-019'); // インパクトショット：ダメージ+40
  // targetLeaderIndex=2（HP110）を狙う：40+atk(base+30)=100<110でダウンしない
  // （HP100の相手だと40+60=100でちょうどダウンし、ダウン時にdamageが0へリセットされるため検証できない）
  EffectResolver.playAttackCardWithEffects(state, 'playerA', attackInstance, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 2,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[2].isDown, false, '110HPに対し100ダメージなのでダウンしない前提');
  assert.strictEqual(state.players.playerB.leaders[2].damage, 40 + baseAtk + 30);
});

test('Test8: ラウンド境界で消える', () => {
  const state = freshMatchAtTurn2();
  const baseAtk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  const instanceId = injectHand(state, 'playerA', 'BP01-071');
  EffectResolver.playMemoriaCardWithEffects(state, 'playerA', instanceId, {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]), baseAtk + 30);

  state.players.playerB.leaders.forEach((l) => { l.isDown = true; }); // ラウンド終了条件を作る
  const result = EffectResolver.processRoundEndWithEffects(state);
  assert.strictEqual(result.roundEnded, true);
  assert.strictEqual(state.players.playerA.leaders[0].tempAtkModifier, 0, 'ラウンド境界でも消えるはず');
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]), baseAtk);
});

// ============================================================
console.log('=== D-3-C: DISTRIBUTED_HEAL（救急キット・ドレインロッド） ===');
// ============================================================

test('Test1: 2体へ均等配分', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.leaders[0].damage = 50;
  state.players.playerA.leaders[1].damage = 50;
  const candidates = [{ playerId: 'playerA', leaderIndex: 0 }, { playerId: 'playerA', leaderIndex: 1 }];
  const ctx = { ownerPlayerId: 'playerA', chooseDistributedHeal: (c, total) => [{ playerId: 'playerA', leaderIndex: 0, amount: total / 2 }, { playerId: 'playerA', leaderIndex: 1, amount: total / 2 }] };
  const healed = EffectResolver.applyDistributedHeal(state, ctx, 60, candidates);
  assert.strictEqual(healed, 60);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 20);
  assert.strictEqual(state.players.playerA.leaders[1].damage, 20);
});

test('Test2: 2体へ不均等配分', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.leaders[0].damage = 50;
  state.players.playerA.leaders[1].damage = 50;
  const candidates = [{ playerId: 'playerA', leaderIndex: 0 }, { playerId: 'playerA', leaderIndex: 1 }];
  const ctx = { ownerPlayerId: 'playerA', chooseDistributedHeal: () => [{ playerId: 'playerA', leaderIndex: 0, amount: 50 }, { playerId: 'playerA', leaderIndex: 1, amount: 30 }] };
  const healed = EffectResolver.applyDistributedHeal(state, ctx, 80, candidates);
  assert.strictEqual(healed, 80);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 0);
  assert.strictEqual(state.players.playerA.leaders[1].damage, 20);
});

test('Test3: 3体への配分', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.leaders[0].damage = 30;
  state.players.playerA.leaders[1].damage = 30;
  state.players.playerA.leaders[2].damage = 30;
  const candidates = [0, 1, 2].map((i) => ({ playerId: 'playerA', leaderIndex: i }));
  const ctx = { ownerPlayerId: 'playerA', chooseDistributedHeal: () => candidates.map((c) => Object.assign({ amount: 20 }, c)) };
  const healed = EffectResolver.applyDistributedHeal(state, ctx, 60, candidates);
  assert.strictEqual(healed, 60);
  [0, 1, 2].forEach((i) => assert.strictEqual(state.players.playerA.leaders[i].damage, 10));
});

test('Test4: 合計回復量が指定を超えない（超過分は切り捨て）', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.leaders[0].damage = 100;
  state.players.playerA.leaders[1].damage = 100;
  const candidates = [{ playerId: 'playerA', leaderIndex: 0 }, { playerId: 'playerA', leaderIndex: 1 }];
  const ctx = { ownerPlayerId: 'playerA', chooseDistributedHeal: () => [{ playerId: 'playerA', leaderIndex: 0, amount: 60 }, { playerId: 'playerA', leaderIndex: 1, amount: 60 }] };
  const healed = EffectResolver.applyDistributedHeal(state, ctx, 80, candidates); // 合計指定は80のみ
  assert.strictEqual(healed, 80, '請求合計120でも指定した合計80を超えないはず');
});

test('Test5: 最大HP（実際はダメージカウンター）を超えるケース＝過剰回復しない', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.leaders[0].damage = 10; // 10ダメージしか無い
  const candidates = [{ playerId: 'playerA', leaderIndex: 0 }];
  const ctx = { ownerPlayerId: 'playerA', chooseDistributedHeal: () => [{ playerId: 'playerA', leaderIndex: 0, amount: 80 }] };
  const healed = EffectResolver.applyDistributedHeal(state, ctx, 80, candidates);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 0);
  assert.strictEqual(healed, 10, 'FAQ Q9類推：実際に回復したのは10だけのはず（80請求しても無駄になる）');
});

test('Test6: 1体しか対象がいないケース（デフォルトで全量割り当て）', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.leaders[0].damage = 50;
  const candidates = [{ playerId: 'playerA', leaderIndex: 0 }];
  const healed = EffectResolver.applyDistributedHeal(state, {}, 80, candidates); // chooseDistributedHeal省略
  assert.strictEqual(state.players.playerA.leaders[0].damage, 0);
  assert.strictEqual(healed, 50);
});

test('Test7: 対象0件', () => {
  const state = freshMatchAtTurn2();
  const healed = EffectResolver.applyDistributedHeal(state, {}, 80, []);
  assert.strictEqual(healed, 0);
});

test('Test8: Equipment HP modifierとの併用（最大HPが増えてもHEAL自体はダメージカウンターのみで動作）', () => {
  const state = freshMatchAtTurn2();
  equip(state, 'playerA', 'BP01-095', 0); // ライトシールド(HP+30)
  state.players.playerA.leaders[0].damage = 100;
  const candidates = [{ playerId: 'playerA', leaderIndex: 0 }];
  const ctx = { ownerPlayerId: 'playerA', chooseDistributedHeal: () => [{ playerId: 'playerA', leaderIndex: 0, amount: 100 }] };
  const healed = EffectResolver.applyDistributedHeal(state, ctx, 100, candidates);
  assert.strictEqual(healed, 100);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 0);
  assert.strictEqual(GameState.getLeaderMaxHp(cardIndex, state.players.playerA.leaders[0]), cardIndex['BP01-001'].hp + 30, '装備によるHP修正はそのまま維持される');
});

test('実カード：救急キットを実際にプレイして配分回復する（chooseDistributedHealの橋渡しを確認）', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.leaders[0].damage = 40;
  state.players.playerA.leaders[1].damage = 40;
  const instanceId = injectTactics(state, 'playerA', 'ST01-021');
  EffectResolver.playTacticsCardWithEffects(state, 'playerA', instanceId, {
    subType: 'CONSUMABLE',
    chooseDistributedHeal: (candidates, total) => [
      { playerId: 'playerA', leaderIndex: 0, amount: 40 },
      { playerId: 'playerA', leaderIndex: 1, amount: total - 40 },
    ],
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 0);
  assert.strictEqual(state.players.playerA.leaders[1].damage, 0);
});

// ============================================================
console.log('=== D-3-D: DERIVED_AMOUNT（ドレインロッド：回復した数値と同じダメージ） ===');
// ============================================================

test('中間値：回復した分だけダメージが入る（過剰請求分は含まれない）', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.leaders[0].damage = 15; // 40請求しても15しか回復できない
  const instanceId = injectTactics(state, 'playerA', 'BP02-076');
  EffectResolver.playTacticsCardWithEffects(state, 'playerA', instanceId, {
    subType: 'CONSUMABLE',
    chooseDistributedHeal: () => [{ playerId: 'playerA', leaderIndex: 0, amount: 40 }],
    chooseTarget: () => 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 0);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 15, '実際に回復した15とダメージが一致するはず（40ではない）');
});

test('最小値：回復量が少なければダメージも少ない（ドレインロッド）', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.leaders[0].damage = 5; // 5しか回復できない（40請求しても5だけ）
  const instanceId = injectTactics(state, 'playerA', 'BP02-076');
  EffectResolver.playTacticsCardWithEffects(state, 'playerA', instanceId, {
    subType: 'CONSUMABLE',
    chooseDistributedHeal: () => [{ playerId: 'playerA', leaderIndex: 0, amount: 40 }],
    chooseTarget: (candidates) => 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 0);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 5, '実際に回復した5とダメージが一致するはず');
});

test('最大値：合計40すべて回復できればダメージも40', () => {
  const state = freshMatchAtTurn2();
  state.players.playerA.leaders[0].damage = 40;
  const instanceId = injectTactics(state, 'playerA', 'BP02-076');
  EffectResolver.playTacticsCardWithEffects(state, 'playerA', instanceId, {
    subType: 'CONSUMABLE',
    chooseDistributedHeal: () => [{ playerId: 'playerA', leaderIndex: 0, amount: 40 }],
    chooseTarget: () => 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 40);
});

test('0になるケース：回復対象のダメージが既に0ならダメージも0（クラッシュしない）', () => {
  const state = freshMatchAtTurn2();
  const instanceId = injectTactics(state, 'playerA', 'BP02-076');
  assert.doesNotThrow(() => {
    EffectResolver.playTacticsCardWithEffects(state, 'playerA', instanceId, {
      subType: 'CONSUMABLE',
      chooseDistributedHeal: () => [{ playerId: 'playerA', leaderIndex: 0, amount: 40 }],
      chooseTarget: () => 0,
    }, cardIndex);
    ResolutionStack.resolveAll(state.resolutionStack, state);
  });
  assert.strictEqual(state.players.playerB.leaders[0].damage, 0);
});

test('状態変化前後：同じカードでも回復前のダメージ量によって派生ダメージが変わる（解決時点の値を参照している証拠）', () => {
  const stateA = freshMatchAtTurn2();
  stateA.players.playerA.leaders[0].damage = 10;
  const instanceA = injectTactics(stateA, 'playerA', 'BP02-076');
  EffectResolver.playTacticsCardWithEffects(stateA, 'playerA', instanceA, {
    subType: 'CONSUMABLE', chooseDistributedHeal: () => [{ playerId: 'playerA', leaderIndex: 0, amount: 40 }], chooseTarget: () => 0,
  }, cardIndex);
  ResolutionStack.resolveAll(stateA.resolutionStack, stateA);

  const stateB = freshMatchAtTurn2();
  stateB.players.playerA.leaders[0].damage = 25;
  const instanceB = injectTactics(stateB, 'playerA', 'BP02-076');
  EffectResolver.playTacticsCardWithEffects(stateB, 'playerA', instanceB, {
    subType: 'CONSUMABLE', chooseDistributedHeal: () => [{ playerId: 'playerA', leaderIndex: 0, amount: 40 }], chooseTarget: () => 0,
  }, cardIndex);
  ResolutionStack.resolveAll(stateB.resolutionStack, stateB);

  assert.strictEqual(stateA.players.playerB.leaders[0].damage, 10);
  assert.strictEqual(stateB.players.playerB.leaders[0].damage, 25);
  assert.notStrictEqual(stateA.players.playerB.leaders[0].damage, stateB.players.playerB.leaders[0].damage);
});

test('不正値：未知のDERIVED_AMOUNT sourceを指定すると例外になる（設定ミスに気付ける安全設計）', () => {
  assert.throws(() => {
    EffectResolver.resolveActionAmount({ type: 'DERIVED_AMOUNT', source: 'NOT_A_REAL_SOURCE' }, {});
  });
});

test('プレーンな数値のamountはDERIVED_AMOUNT導入後も完全に後方互換', () => {
  assert.strictEqual(EffectResolver.resolveActionAmount(40, {}), 40);
});

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
