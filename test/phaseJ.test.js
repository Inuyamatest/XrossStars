/* Phase J: タクティクス/PP画像バッチの自動テスト（node test/phaseJ.test.js で実行）
 *
 * 対象:
 *  - js/engine/effectResolver.js playTacticsCardWithEffects: 消費タクティクスの〖アタック強化〗/〖アタック後〗
 *  - cardEffectData.js Phase Jで登録したタクティクスの代表パターン
 *  - カードデータ: タクティクス/PPの画像・コストがすべて揃っていること、PPチケットの種類統一
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
const FILLER_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.color === 'red' && c.cost === 1);
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban && !c.isParallel).slice(0, 5).map((c) => c.cardNumber);

// 先攻（playerA）1ターン目はタクティクスを使えないため、テストは後攻（playerB）の手番を作って行う
function makeState() {
  const state = Match.createMatch({
    matchId: 'test-match', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: PP_TICKET,
    playerA: { leaderCardIds: LEADERS_A, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: LEADERS_B, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
  });
  state.turn.activePlayer = 'playerB';
  state.turn.turnNumber = 2;
  state.turn.tacticsPlayedThisTurn = false;
  return state;
}

function putTactics(state, pid, cardId) {
  const inst = GameState.createCardInstance(cardId);
  state.players[pid].tacticsArea.push({ card: inst });
  return inst.instanceId;
}

function playTactics(state, cardId, subType, equipLeaderIndex) {
  const id = putTactics(state, 'playerB', cardId);
  EffectResolver.playTacticsCardWithEffects(state, 'playerB', id, { subType: subType || 'CONSUMABLE', equipLeaderIndex: equipLeaderIndex }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
}

function attack(state, targetIndex) {
  const inst = GameState.createCardInstance(FILLER_ATTACK);
  state.players.playerB.hand.push(inst);
  EffectResolver.playAttackCardWithEffects(state, 'playerB', inst.instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerA', targetLeaderIndex: targetIndex || 0,
  }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
}

// ============================================================
console.log('=== カードデータ ===');
// ============================================================
test('タクティクス/PPの全カードに画像がある', () => {
  const missing = allCards.filter((c) => ['TACTICS', 'PP', 'PP_TICKET'].includes(c.cardType) && !c.imageUrl);
  assert.deepStrictEqual(missing.map((c) => c.cardNumber), []);
});
test('タクティクス/PPチケットのコストはすべて確定している', () => {
  const missing = allCards.filter((c) => (c.cardType === 'TACTICS' || c.cardType === 'PP_TICKET') && typeof c.cost !== 'number');
  assert.deepStrictEqual(missing.map((c) => c.cardNumber), []);
});
test('PPチケット（BP01-097/BP02-081含む）はタクティクスではなくPPチケット種別（タクティクスデッキに入れられない）', () => {
  allCards.filter((c) => c.name === 'PPチケット').forEach((c) => assert.strictEqual(c.cardType, 'PP_TICKET', c.cardNumber));
});
test('ボディアーマーのコストは画像どおり2', () => {
  assert.strictEqual(cardIndex['BP01-096'].cost, 2);
});

// ============================================================
console.log('=== 消費タクティクスの〖アタック強化〗 ===');
// ============================================================
test('特殊弾：次のアタックに+80が乗る', () => {
  const state = makeState();
  playTactics(state, 'ST01-022');
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerB.leaders[0]);
  const hp = GameState.getLeaderCurrentHp(cardIndex, state.players.playerA.leaders[0]);
  attack(state);
  if (80 + atk >= hp) assert.strictEqual(state.players.playerA.leaders[0].isDown, true);
  else assert.strictEqual(state.players.playerA.leaders[0].damage, 80 + atk);
});
test('アドレナリン：1枚引き、次のアタックに+40', () => {
  const state = makeState();
  const handBefore = state.players.playerB.hand.length;
  playTactics(state, 'BP03-074');
  assert.strictEqual(state.players.playerB.hand.length, handBefore + 1);
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerB.leaders[0]);
  attack(state);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 40 + atk);
});
test('一斉攻撃：トラッシュに「攻撃要請」が無ければアタック後ダメージは無し', () => {
  const state = makeState();
  playTactics(state, 'BP04-077');
  attack(state);
  const others = state.players.playerA.leaders.slice(1).reduce((s, l) => s + l.damage, 0);
  assert.strictEqual(others, 0);
});
test('一斉攻撃：トラッシュに「攻撃要請」があればアタック後に相手リーダー1体へ40ダメージ', () => {
  const state = makeState();
  state.players.playerB.trash.push({ card: GameState.createCardInstance('BP04-078'), faceUp: true });
  playTactics(state, 'BP04-077');
  const atk = GameState.getLeaderCurrentAtk(cardIndex, state.players.playerB.leaders[0]);
  attack(state, 1); // アタックはリーダー1へ。アタック後の40は既定の対象（先頭の生存リーダー＝リーダー0）へ
  assert.strictEqual(state.players.playerA.leaders[1].damage, 40 + atk);
  assert.strictEqual(state.players.playerA.leaders[0].damage, 40);
});

// ============================================================
console.log('=== その他のタクティクス ===');
// ============================================================
test('PPチケット：使用済みPPを1回復する', () => {
  const state = makeState();
  state.players.playerB.ppCards.tapped = 2;
  playTactics(state, 'BP02-081');
  assert.strictEqual(state.players.playerB.ppCards.tapped, 1);
});
test('エナジーチャージャー：PPを1回復し1枚引く', () => {
  const state = makeState();
  state.players.playerB.ppCards.tapped = 1;
  const handBefore = state.players.playerB.hand.length;
  playTactics(state, 'ST01-020');
  assert.strictEqual(state.players.playerB.ppCards.tapped, 0);
  assert.strictEqual(state.players.playerB.hand.length, handBefore + 1);
});
test('ファイヤークラッカー：相手リーダーすべてに10ダメージ、1枚引く', () => {
  const state = makeState();
  const handBefore = state.players.playerB.hand.length;
  playTactics(state, 'BP03-078');
  state.players.playerA.leaders.forEach((l) => assert.strictEqual(l.damage, 10));
  assert.strictEqual(state.players.playerB.hand.length, handBefore + 1);
});
test('ボディアーマー：装備したリーダーの最大体力+40', () => {
  const state = makeState();
  const before = GameState.getLeaderMaxHp(cardIndex, state.players.playerB.leaders[1]);
  playTactics(state, 'BP01-096', 'EQUIPMENT', 1);
  assert.strictEqual(GameState.getLeaderMaxHp(cardIndex, state.players.playerB.leaders[1]), before + 40);
});
test('プロモのPPチケット（PR-067）も通常版と同じ効果', () => {
  assert.strictEqual(CardEffectData.getEffectsForCard('PR-067'), CardEffectData.getEffectsForCard('ST01-024'));
});
test('新機構が必要なタクティクス（追加マガジン・パワーフィールド）は未登録のまま（討伐クエストはbp05Ace.test.jsで登録を確認）', () => {
  ['BP03-076', 'BP03-077'].forEach((n) => assert.strictEqual(CardEffectData.hasEffects(n), false, n));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
