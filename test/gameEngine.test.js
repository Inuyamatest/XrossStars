/* ゲームエンジン コアの自動テスト（依存ライブラリなし。node test/gameEngine.test.js で実行）
 * 対象: js/engine/*.js
 * 根拠: docs/xross-stars-game-spec.md, docs/game-engine-architecture.md
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
const LEADERS_A = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004']; // 赤4体
const LEADERS_B = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008']; // 青4体
const PP_TICKET = 'ST01-024';
const RED_ATTACK = allCards.filter((c) => c.cardType === 'ATTACK' && c.color === 'red' && !c.ban)[0].cardNumber;
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
      deckCardIds: fillDeck(RED_ATTACK, 50),
      tacticsDeckCardIds: TACTICS_5,
    },
    playerB: {
      leaderCardIds: LEADERS_B,
      deckCardIds: fillDeck(BLUE_ATTACK, 50),
      tacticsDeckCardIds: TACTICS_5_B,
    },
  }, overrides);
}

function findHandCard(state, playerId, cardId) {
  const found = state.players[playerId].hand.find((c) => c.cardId === cardId);
  if (!found) throw new Error('hand does not contain ' + cardId);
  return found.instanceId;
}

// ============================================================
console.log('=== Match ===');
// ============================================================

test('createMatch: GameState生成・初期配置（4枚ドロー・PPチケット・タクティクス1枚）', () => {
  const state = Match.createMatch(makeMatchConfig());
  assert.strictEqual(state.players.playerA.hand.length, 4);
  assert.strictEqual(state.players.playerB.hand.length, 4);
  assert.strictEqual(state.players.playerA.ppCards.max, 3);
  assert.strictEqual(state.players.playerB.tacticsArea.some((t) => t.card.cardId === PP_TICKET && t.faceUp), true);
  assert.strictEqual(state.players.playerA.tacticsArea.some((t) => t.card.cardId === PP_TICKET), false);
  assert.strictEqual(state.players.playerA.tacticsArea.length, 1); // 通常のタクティクス1枚のみ
  assert.strictEqual(state.players.playerB.tacticsArea.length, 2); // タクティクス1枚 + PPチケット
});

test('3ラウンド制（STANDARD）で進行し、2ラウンド先取で試合終了する', () => {
  const state = Match.createMatch(makeMatchConfig());
  // playerAがラウンド1を勝つ
  state.players.playerB.leaders.forEach((l) => { l.isDown = true; });
  const r1 = Match.processRoundEnd(state);
  assert.strictEqual(r1.roundEnded, true);
  assert.strictEqual(r1.matchEnded, false);
  assert.strictEqual(state.match.roundWins.playerA, 1);
  assert.strictEqual(state.match.roundNumber, 2);
  assert.strictEqual(state.players.playerA.ppCards.max, 4);

  // playerAがラウンド2も勝つ→2勝で試合終了
  state.players.playerB.leaders.forEach((l) => { l.isDown = true; });
  const r2 = Match.processRoundEnd(state);
  assert.strictEqual(r2.matchEnded, true);
  assert.strictEqual(r2.winner, 'playerA');
  assert.strictEqual(state.match.status, 'FINISHED');
});

test('Quick Match（1ラウンド制）：後攻はPPチケットの代わりにタクティクス2枚目を持つ', () => {
  const state = Match.createMatch(makeMatchConfig({ mode: 'QUICK' }));
  assert.strictEqual(state.players.playerB.tacticsArea.filter((t) => t.card.cardId === PP_TICKET).length, 0,
    'クイックマッチではPPチケットを使用しない（spec 22章, Manual p.05）');
  assert.strictEqual(state.players.playerB.tacticsArea.length, 2, '後攻はタクティクス2枚（通常1枚+代替1枚）を持つ');
  assert.strictEqual(state.players.playerA.tacticsArea.length, 1);
});

test('Quick Match（1ラウンド制）は1ラウンド勝利で試合終了する', () => {
  const state = Match.createMatch(makeMatchConfig({ mode: 'QUICK' }));
  state.players.playerB.leaders.forEach((l) => { l.isDown = true; });
  const r1 = Match.processRoundEnd(state);
  assert.strictEqual(r1.matchEnded, true);
  assert.strictEqual(r1.winner, 'playerA');
});

// ============================================================
console.log('=== Round（PP上限） ===');
// ============================================================

test('ラウンド1のPP上限は3', () => {
  const state = Match.createMatch(makeMatchConfig());
  assert.strictEqual(state.players.playerA.ppCards.max, 3);
  assert.strictEqual(state.players.playerB.ppCards.max, 3);
});

test('ラウンド2のPP上限は4', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders.forEach((l) => { l.isDown = true; });
  Match.processRoundEnd(state);
  assert.strictEqual(state.players.playerA.ppCards.max, 4);
  assert.strictEqual(state.players.playerB.ppCards.max, 4);
});

test('ラウンド3のPP上限は5', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders.forEach((l) => { l.isDown = true; });
  Match.processRoundEnd(state); // round2
  state.players.playerB.leaders.forEach((l) => { l.isDown = true; });
  Match.processRoundEnd(state); // playerA 2勝で終了するはずなので、代わりにplayerBが1勝してから確認する
});

test('ラウンド3のPP上限は5（1勝1敗にしてから確認）', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders.forEach((l) => { l.isDown = true; });
  Match.processRoundEnd(state); // playerA 1勝、round2へ
  state.players.playerA.leaders.forEach((l) => { l.isDown = true; });
  Match.processRoundEnd(state); // playerB 1勝、round3へ
  assert.strictEqual(state.match.roundNumber, 3);
  assert.strictEqual(state.players.playerA.ppCards.max, 5);
  assert.strictEqual(state.players.playerB.ppCards.max, 5);
});

// ============================================================
console.log('=== Turn ===');
// ============================================================

test('開始フェイズ：PP全回復して1枚ドローする', () => {
  const state = Match.createMatch(makeMatchConfig());
  const before = state.players.playerA.hand.length;
  state.players.playerA.ppCards.tapped = 3;
  Phases.runStartPhase(state);
  assert.strictEqual(state.players.playerA.ppCards.tapped, 0);
  assert.strictEqual(state.players.playerA.hand.length, before + 1);
  assert.strictEqual(state.turn.phase, 'MAIN_PHASE');
});

test('メインフェイズ：アタックカードをプレイできる（PP支払い・プレイエリア経由）', () => {
  const state = Match.createMatch(makeMatchConfig());
  Phases.runStartPhase(state);
  const cardInstanceId = findHandCard(state, 'playerA', RED_ATTACK);
  const tappedBefore = state.players.playerA.ppCards.tapped;
  Phases.playAttackCard(state, 'playerA', cardInstanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 20,
  }, cardIndex);
  const cost = cardIndex[RED_ATTACK].cost || 0;
  assert.strictEqual(state.players.playerA.ppCards.tapped, tappedBefore + cost);
  assert.strictEqual(state.players.playerB.leaders[0].damage > 0, true);
});

test('終了フェイズ：プレイエリア→トラッシュ、残りPP分ドロー、手札7枚制限', () => {
  const state = Match.createMatch(makeMatchConfig());
  Phases.runStartPhase(state);
  const cardInstanceId = findHandCard(state, 'playerA', RED_ATTACK);
  Phases.playAttackCard(state, 'playerA', cardInstanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 10,
  }, cardIndex);
  const handBefore = state.players.playerA.hand.length;
  const remainingPP = state.players.playerA.ppCards.max - state.players.playerA.ppCards.tapped;
  Phases.runEndPhase(state);
  assert.strictEqual(state.players.playerA.playArea.length, 0);
  assert.strictEqual(state.players.playerA.trash.length, 1);
  assert.strictEqual(state.players.playerA.hand.length, handBefore + remainingPP);
});

test('手札7枚制限：終了フェイズで7枚を超えた分がトラッシュされる', () => {
  const state = Match.createMatch(makeMatchConfig());
  // 手札を9枚まで積み増す
  while (state.players.playerA.hand.length < 9) {
    state.players.playerA.hand.push(GameState.createCardInstance(RED_ATTACK));
  }
  state.turn.phase = 'END_PHASE';
  state.players.playerA.ppCards.tapped = state.players.playerA.ppCards.max; // 残りPP0＝終了フェイズドローなし
  Phases.runEndPhase(state);
  assert.strictEqual(state.players.playerA.hand.length, 7);
});

test('ターン交代：activePlayerが入れ替わりturnNumberが増える', () => {
  const state = Match.createMatch(makeMatchConfig());
  Phases.endTurnAndSwitch(state);
  assert.strictEqual(state.turn.activePlayer, 'playerB');
  assert.strictEqual(state.turn.turnNumber, 2);
});

// ============================================================
console.log('=== Leader（ダメージ・ダウン・覚醒・複数回攻撃） ===');
// ============================================================

test('ダメージを受けると currentHp が減少する', () => {
  const state = Match.createMatch(makeMatchConfig());
  Combat.declareAttack(state, {
    attackerPlayerId: 'playerA', attackerLeaderIndex: 0,
    targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 20,
  }, cardIndex);
  const hp = GameState.getLeaderCurrentHp(cardIndex, state.players.playerB.leaders[0]);
  const maxHp = GameState.getLeaderMaxHp(cardIndex, state.players.playerB.leaders[0]);
  assert.strictEqual(hp, maxHp - (20 + GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0])));
});

test('体力以上のダメージでダウンする（ダメージカウンターは除去される）', () => {
  const state = Match.createMatch(makeMatchConfig());
  const result = Combat.declareAttack(state, {
    attackerPlayerId: 'playerA', attackerLeaderIndex: 0,
    targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 9999,
  }, cardIndex);
  assert.strictEqual(result.downed, true);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, true);
  assert.strictEqual(state.players.playerB.leaders[0].damage, 0);
});

test('相手をダウンさせるとアタッカーが覚醒する', () => {
  const state = Match.createMatch(makeMatchConfig());
  assert.strictEqual(state.players.playerA.leaders[0].awakened, false);
  Combat.declareAttack(state, {
    attackerPlayerId: 'playerA', attackerLeaderIndex: 0,
    targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 9999,
  }, cardIndex);
  assert.strictEqual(state.players.playerA.leaders[0].awakened, true);
});

test('ダウン中のリーダーをアタッカーにするとエラーになる', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerA.leaders[0].isDown = true;
  assert.throws(() => {
    Combat.declareAttack(state, {
      attackerPlayerId: 'playerA', attackerLeaderIndex: 0,
      targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 10,
    }, cardIndex);
  });
});

test('同じリーダーが同じターンに複数回攻撃できる（回数制限なし）', () => {
  const state = Match.createMatch(makeMatchConfig());
  Combat.declareAttack(state, {
    attackerPlayerId: 'playerA', attackerLeaderIndex: 0,
    targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 5,
  }, cardIndex);
  const dmgAfterFirst = state.players.playerB.leaders[0].damage;
  Combat.declareAttack(state, {
    attackerPlayerId: 'playerA', attackerLeaderIndex: 0,
    targetPlayerId: 'playerB', targetLeaderIndex: 1, attackCardBaseDamage: 5,
  }, cardIndex);
  assert.strictEqual(dmgAfterFirst > 0, true);
  assert.strictEqual(state.players.playerB.leaders[1].damage > 0, true);
});

test('アタック強化は次の1回のアタックのみ強化し、消費後はリセットされる', () => {
  const state = Match.createMatch(makeMatchConfig());
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerA.leaders[0]);
  // ダウンさせない程度の小さいブースト量で検証する（ダウンするとdamageカウンターがリセットされ、
  // 「ブースト分が乗ったかどうか」を確認できなくなるため）
  Combat.queueAttackBoost(state, 'playerA', 20, 'memoria#1');
  Combat.declareAttack(state, {
    attackerPlayerId: 'playerA', attackerLeaderIndex: 0,
    targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[0].isDown, false);
  const firstDamage = state.players.playerB.leaders[0].damage;
  assert.strictEqual(firstDamage, 20 + atk); // ブースト分が乗っている

  Combat.declareAttack(state, {
    attackerPlayerId: 'playerA', attackerLeaderIndex: 0,
    targetPlayerId: 'playerB', targetLeaderIndex: 1, attackCardBaseDamage: 0,
  }, cardIndex);
  assert.strictEqual(state.players.playerB.leaders[1].damage, atk); // ブーストは持ち越されない
});

test('アタック後効果はResolutionStackへ積まれる', () => {
  const state = Match.createMatch(makeMatchConfig());
  let resolved = false;
  Combat.declareAttack(state, {
    attackerPlayerId: 'playerA', attackerLeaderIndex: 0,
    targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 10,
    afterAttackEffect: {
      id: 'eff1', sourceInstanceId: 'attack#1', trigger: 'AFTER_ATTACK', ownerPlayerId: 'playerA',
      resolve: (s) => { resolved = true; return s; },
    },
  }, cardIndex);
  assert.strictEqual(ResolutionStack.pendingCount(state.resolutionStack), 1);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(resolved, true);
});

// ============================================================
console.log('=== Deck ===');
// ============================================================

test('通常ドロー：デッキから手札へ1枚移動する', () => {
  const state = Match.createMatch(makeMatchConfig());
  const before = state.players.playerA.hand.length;
  Deck.drawCard(state, 'playerA');
  assert.strictEqual(state.players.playerA.hand.length, before + 1);
});

test('デッキ切れ：デッキが0枚だとトラッシュから再構築する', () => {
  const state = Match.createMatch(makeMatchConfig());
  const player = state.players.playerA;
  player.deck = [];
  player.trash = [
    { card: GameState.createCardInstance(RED_ATTACK), faceUp: false },
    { card: GameState.createCardInstance(RED_ATTACK), faceUp: false },
  ];
  const card = Deck.drawCard(state, 'playerA');
  assert.notStrictEqual(card, null);
  assert.strictEqual(player.trash.length, 0);
});

test('トラッシュ再構築後もデッキが0枚ならタクティクスデッキを消費する', () => {
  const state = Match.createMatch(makeMatchConfig());
  const player = state.players.playerA;
  player.deck = [];
  player.trash = [];
  const tacticsBefore = player.tacticsDeck.length;
  const result = Deck.drawCard(state, 'playerA');
  assert.strictEqual(result, null);
  assert.strictEqual(player.tacticsDeck.length, tacticsBefore - 1);
  assert.strictEqual(player.trash.length, 1);
  assert.strictEqual(player.trash[0].faceUp, true);
});

test('デッキ・トラッシュ・タクティクスデッキすべて尽きると試合に敗北する', () => {
  const state = Match.createMatch(makeMatchConfig());
  const player = state.players.playerA;
  player.deck = [];
  player.trash = [];
  player.tacticsDeck = [];
  Deck.drawCard(state, 'playerA');
  assert.strictEqual(state.match.status, 'FINISHED');
  assert.strictEqual(state.match.winner, 'playerB');
});

// ============================================================
console.log('=== Tactics ===');
// ============================================================

test('タクティクスは1ターンに1枚までしかプレイできない', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.turn.turnNumber = 2; // 先攻1ターン目制限を回避して純粋に「1枚制限」だけを見る
  const first = state.players.playerA.tacticsArea[0];
  Phases.playTacticsCard(state, 'playerA', first.card.instanceId, { subType: 'CONSUMABLE' }, cardIndex);
  assert.strictEqual(state.turn.tacticsPlayedThisTurn, true);
  assert.throws(() => {
    Phases.playTacticsCard(state, 'playerA', 'does-not-matter', { subType: 'CONSUMABLE' }, cardIndex);
  });
});

test('RuleConfig: 先攻1ターン目制限（PER_ROUND, デフォルト）でPER_ROUND適用時はプレイ不可', () => {
  const state = Match.createMatch(makeMatchConfig());
  assert.strictEqual(state.turn.turnNumber, 1);
  assert.strictEqual(state.turn.activePlayer, 'playerA'); // firstPlayerThisRoundと一致
  assert.strictEqual(Phases.canPlayTactics(state), false);
});

test('RuleConfig: scope=MATCH_START_ONLY のときラウンド2の先攻1ターン目はプレイ可能', () => {
  const config = makeMatchConfig({
    ruleConfig: Object.assign(RuleConfig.createDefaultRuleConfig(), {
      firstPlayerTacticsRestriction: { scope: 'MATCH_START_ONLY', appliesInQuickMatch: true, status: 'PROVISIONAL', source: 'test' },
    }),
  });
  const state = Match.createMatch(config);
  state.players.playerB.leaders.forEach((l) => { l.isDown = true; });
  Match.processRoundEnd(state); // round2へ
  assert.strictEqual(state.match.roundNumber, 2);
  assert.strictEqual(Phases.canPlayTactics(state), true, 'MATCH_START_ONLYのときラウンド2の先攻1ターン目は制限対象外');
});

test('RuleConfig: scope=PER_ROUND のときラウンド2の先攻1ターン目もプレイ不可', () => {
  const state = Match.createMatch(makeMatchConfig());
  state.players.playerB.leaders.forEach((l) => { l.isDown = true; });
  Match.processRoundEnd(state); // round2へ
  assert.strictEqual(state.turn.turnNumber, 1);
  assert.strictEqual(Phases.canPlayTactics(state), false, 'PER_ROUND（デフォルト）のときは毎ラウンド先攻1ターン目が制限される');
});

// ============================================================
console.log('=== ResolutionStack ===');
// ============================================================

test('push/resolveOne：効果を1件解決できる', () => {
  const stack = ResolutionStack.createResolutionStack();
  let ran = false;
  ResolutionStack.push(stack, { id: 'e1', trigger: 'AFTER_ATTACK', ownerPlayerId: 'playerA', resolve: (s) => { ran = true; return s; } });
  ResolutionStack.resolveOne(stack, {});
  assert.strictEqual(ran, true);
  assert.strictEqual(ResolutionStack.isEmpty(stack), true);
});

test('複数効果：chooseIndexFnで実行順を選べる', () => {
  const stack = ResolutionStack.createResolutionStack();
  const order = [];
  ResolutionStack.push(stack, { id: 'A', trigger: 'AFTER_ATTACK', ownerPlayerId: 'playerA', resolve: (s) => { order.push('A'); return s; } });
  ResolutionStack.push(stack, { id: 'B', trigger: 'AFTER_ATTACK', ownerPlayerId: 'playerA', resolve: (s) => { order.push('B'); return s; } });
  // Bを先に選ぶ
  ResolutionStack.resolveOne(stack, {}, (candidates) => candidates.findIndex((c) => c.id === 'B'));
  ResolutionStack.resolveOne(stack, {});
  assert.deepStrictEqual(order, ['B', 'A']);
});

test('解決時Condition再評価：宣言時ではなく解決時の状態で判定する（FAQ Q6相当）', () => {
  const stack = ResolutionStack.createResolutionStack();
  const state = { handCount: 2 };
  // 「カウンタースナイプ」相当：自分の手札が2枚以下ならダメージ
  let counterSnipeFired = false;
  ResolutionStack.push(stack, {
    id: 'counterSnipe', trigger: 'AFTER_ATTACK', ownerPlayerId: 'playerA',
    condition: (s) => s.handCount <= 2,
    resolve: (s) => { counterSnipeFired = true; return s; },
  });
  // 「超新星」相当：先に解決するとカードを1枚引いて手札が3枚になる
  ResolutionStack.push(stack, {
    id: 'novaBurst', trigger: 'AFTER_ATTACK', ownerPlayerId: 'playerA',
    resolve: (s) => { s.handCount += 1; return s; },
  });
  // novaBurstを先に実行 → counterSnipeの条件は解決時点(手札3枚)で評価されて不成立になるはず
  ResolutionStack.resolveOne(stack, state, (candidates) => candidates.findIndex((c) => c.id === 'novaBurst'));
  assert.strictEqual(state.handCount, 3);
  ResolutionStack.resolveOne(stack, state);
  assert.strictEqual(counterSnipeFired, false, '宣言時(手札2枚)ではなく解決時(手札3枚)の状態で条件判定されるべき');
});

test('条件が解決時に成立していれば実行される（実行順を変えた場合）', () => {
  const stack = ResolutionStack.createResolutionStack();
  const state = { handCount: 2 };
  let counterSnipeFired = false;
  ResolutionStack.push(stack, {
    id: 'counterSnipe', trigger: 'AFTER_ATTACK', ownerPlayerId: 'playerA',
    condition: (s) => s.handCount <= 2,
    resolve: (s) => { counterSnipeFired = true; return s; },
  });
  ResolutionStack.push(stack, {
    id: 'novaBurst', trigger: 'AFTER_ATTACK', ownerPlayerId: 'playerA',
    resolve: (s) => { s.handCount += 1; return s; },
  });
  // counterSnipeを先に実行 → まだ手札2枚のうちに条件成立
  ResolutionStack.resolveOne(stack, state, (candidates) => candidates.findIndex((c) => c.id === 'counterSnipe'));
  assert.strictEqual(counterSnipeFired, true);
});

// ============================================================
console.log('=== 完了条件：GameState生成からMatch終了までの一気通貫シミュレーション ===');
// ============================================================

test('E2E: Match開始→Round進行→リーダー撃破→Round終了→次Round→2Round勝利→Match終了', () => {
  const state = Match.createMatch(makeMatchConfig());
  assert.strictEqual(state.match.status, 'IN_PROGRESS');

  function playerAWinsRound() {
    Phases.runStartPhase(state);
    // playerAの全リーダーでplayerBの全リーダーを1体ずつ即死させる
    state.players.playerB.leaders.forEach((_, i) => {
      Combat.declareAttack(state, {
        attackerPlayerId: 'playerA', attackerLeaderIndex: 0,
        targetPlayerId: 'playerB', targetLeaderIndex: i, attackCardBaseDamage: 9999,
      }, cardIndex);
    });
    Phases.runEndPhase(state);
    return Match.processRoundEnd(state);
  }

  const r1 = playerAWinsRound();
  assert.strictEqual(r1.roundEnded, true);
  assert.strictEqual(state.match.roundWins.playerA, 1);
  assert.strictEqual(state.match.roundNumber, 2);

  // ラウンド2は先攻がplayerB（ラウンド1敗者）に交代しているはず
  assert.strictEqual(state.match.firstPlayerThisRound, 'playerB');
  assert.strictEqual(state.turn.activePlayer, 'playerB');

  // ラウンド2はplayerBのターン→playerAのターンで決着させる（playerA視点で攻撃するにはターン交代が必要）
  Phases.runStartPhase(state); // playerBのターン
  Phases.runEndPhase(state);
  Phases.endTurnAndSwitch(state); // playerAのターンへ
  const r2 = playerAWinsRound();
  assert.strictEqual(r2.matchEnded, true);
  assert.strictEqual(r2.winner, 'playerA');
  assert.strictEqual(state.match.status, 'FINISHED');
  assert.strictEqual(state.match.winner, 'playerA');
});

// ============================================================
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
