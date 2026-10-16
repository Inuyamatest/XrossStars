/* 第5弾タクティクス4枚の自動テスト（node test/bp05Tactics.test.js で実行）
 *  電磁スモーク（1枚引く・プレイエリアに残る・相手のタクティクスのコスト+1）/ 名誉のバッジ（覚醒させる・覚醒時の効果）/
 *  復活ビーコン（プレイエリアの枚数でコストが下がる・1が下限・復活）/ フォールダウンシールド（直前のラウンドで負けたらコスト-5・体力+50）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
  try { fn(); passed++; console.log('  ok -', name); } catch (e) { failed++; console.log('  FAIL -', name); console.log('       ', e.message); }
}

const FILLER = allCards.find((c) => c.cardType === 'ATTACK' && c.cost === 1 && !c.buildRule && !c.ace && !c.isParallel).cardNumber;
const TACTICS_5 = ['BP01-089', 'BP01-090', 'BP01-091', 'BP01-092', 'BP01-095'];
// playerB（後攻）の手番。SELFの3体目に「覚醒時：カードを1枚引く」のtttcheekyttt
function makeState(selfLeaders) {
  const state = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: 'ST01-024',
    playerA: { leaderCardIds: ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'], deckCardIds: new Array(50).fill(FILLER), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: selfLeaders || ['BP01-001', 'BP01-002', 'BP05-L08', 'BP01-004'], deckCardIds: new Array(50).fill(FILLER), tacticsDeckCardIds: TACTICS_5 },
  });
  state.turn.activePlayer = 'playerB';
  state.turn.turnNumber = 2;
  state.turn.tacticsPlayedThisTurn = false;
  ['playerA', 'playerB'].forEach((pid) => { state.players[pid].hand = []; state.players[pid].ppCards.max = 10; state.players[pid].ppCards.tapped = 0; });
  return state;
}
const inst = (id) => GameState.createCardInstance(id);
function putTactics(s, pid, id) { const c = inst(id); s.players[pid].tacticsArea.push({ card: c }); return c; }
function tactics(s, id, subType, equipLeaderIndex) {
  const c = putTactics(s, 'playerB', id);
  s.turn.tacticsPlayedThisTurn = false;
  EffectResolver.playTacticsCardWithEffects(s, 'playerB', c.instanceId, { subType: subType || 'CONSUMABLE', equipLeaderIndex }, cardIndex);
  ResolutionStack.resolveAll(s.resolutionStack, s);
  return c;
}
const cost = (s, pid, id) => EffectResolver.getEffectivePlayCost(s, pid, id, cardIndex);
const ppUsed = (s) => s.players.playerB.ppCards.tapped;

console.log('=== 登録状況 ===');
test('4枚ともカードデータ・画像・効果がある', () => {
  [['BP05-076', '電磁スモーク', 0], ['BP05-077', '名誉のバッジ', 0], ['BP05-078', '復活ビーコン', 5], ['BP05-079', 'フォールダウンシールド', 5]].forEach(([id, name, c]) => {
    const card = cardIndex[id];
    assert.ok(card, id);
    assert.strictEqual(card.name, name);
    assert.strictEqual(card.cardType, 'TACTICS');
    assert.strictEqual(card.cost, c);
    assert.ok(fs.existsSync(path.join(__dirname, '..', card.imageUrl)), id + ' の画像');
    assert.ok(CardEffectData.hasEffects(id), id + ' の効果');
  });
});

console.log('=== 電磁スモーク ===');
test('プレイ時に1枚引き、ターン終了時にトラッシュに置かずプレイエリアに残る', () => {
  const s = makeState();
  tactics(s, 'BP05-076');
  assert.strictEqual(s.players.playerB.hand.length, 1);
  EffectResolver.runEndPhaseWithEffects(s, () => []);
  assert.ok(s.players.playerB.playArea.some((e) => e.card.cardId === 'BP05-076'), 'プレイエリアに残る');
});
test('このラウンド、対戦相手のタクティクスのコストが+1（自分のタクティクスは変わらない）', () => {
  const s = makeState();
  assert.strictEqual(cost(s, 'playerA', 'BP01-092'), 0);
  tactics(s, 'BP05-076');
  assert.strictEqual(cost(s, 'playerA', 'BP01-092'), 1, '相手のタクティクス');
  assert.strictEqual(cost(s, 'playerB', 'BP01-092'), 0, '自分のタクティクス');
  assert.strictEqual(cost(s, 'playerA', FILLER), 1, 'タクティクス以外は変わらない');
  // 相手の手番：+1したコストを支払う
  s.turn.activePlayer = 'playerA';
  s.turn.tacticsPlayedThisTurn = false;
  const t = putTactics(s, 'playerA', 'BP01-092');
  EffectResolver.playTacticsCardWithEffects(s, 'playerA', t.instanceId, { subType: 'CONSUMABLE' }, cardIndex);
  assert.strictEqual(s.players.playerA.ppCards.tapped, 1);
});

console.log('=== 名誉のバッジ ===');
test('自分のリーダー1体を覚醒させ、そのリーダーの覚醒時の効果が出る', () => {
  const s = makeState();
  s.players.playerB.leaders[0].awakened = true;
  s.players.playerB.leaders[1].isDown = true;
  const before = s.players.playerB.hand.length;
  tactics(s, 'BP05-077'); // 候補は覚醒していない・ダウンしていない2体目以降：2番目（index2=ttt）が先頭
  const l = s.players.playerB.leaders[2];
  assert.strictEqual(l.awakened, true);
  assert.strictEqual(GameState.getLeaderMaxHp(cardIndex, l), cardIndex['BP05-L08'].awakenHp);
  assert.strictEqual(s.players.playerB.hand.length, before + 1, 'tttcheekytttの覚醒時：カードを1枚引く');
  assert.strictEqual(s.players.playerB.leaders[1].awakened, false, 'ダウンしているリーダーは覚醒しない');
});
test('覚醒させられるリーダーがいなければ何もしない', () => {
  const s = makeState();
  s.players.playerB.leaders.forEach((l) => { l.awakened = true; });
  tactics(s, 'BP05-077');
  assert.ok(s.players.playerB.leaders.every((l) => l.awakened));
});

console.log('=== 復活ビーコン ===');
test('コスト5。自分のプレイエリアのカード1枚につき-1、1までしか下がらない', () => {
  const s = makeState();
  assert.strictEqual(cost(s, 'playerB', 'BP05-078'), 5);
  const pa = s.players.playerB.playArea;
  for (let i = 0; i < 3; i++) pa.push({ card: inst(FILLER), order: i, pendingTriggers: [] });
  assert.strictEqual(cost(s, 'playerB', 'BP05-078'), 2);
  for (let i = 0; i < 4; i++) pa.push({ card: inst(FILLER), order: 3 + i, pendingTriggers: [] });
  assert.strictEqual(cost(s, 'playerB', 'BP05-078'), 1, '下限1');
});
test('下がったコストを支払ってプレイし、ダウンしている自分のリーダーを戻す（装備は表向きでトラッシュ）', () => {
  const s = makeState();
  const pa = s.players.playerB.playArea;
  for (let i = 0; i < 2; i++) pa.push({ card: inst(FILLER), order: i, pendingTriggers: [] });
  const l = s.players.playerB.leaders[3];
  l.isDown = true;
  l.equipment.push(inst('BP01-095'));
  tactics(s, 'BP05-078');
  assert.strictEqual(ppUsed(s), 3);
  assert.strictEqual(l.isDown, false);
  assert.strictEqual(l.equipment.length, 0);
  assert.ok(s.players.playerB.trash.some((t) => t.card.cardId === 'BP01-095' && t.faceUp));
});
test('相手の電磁スモークがあれば下限1のあとで+1', () => {
  const s = makeState();
  for (let i = 0; i < 6; i++) s.players.playerB.playArea.push({ card: inst(FILLER), order: i, pendingTriggers: [] });
  s.players.playerA.playArea.push({ card: inst('BP05-076'), order: 0, pendingTriggers: [], isTactics: true });
  assert.strictEqual(cost(s, 'playerB', 'BP05-078'), 2);
});

console.log('=== フォールダウンシールド ===');
test('コスト5。直前のラウンドで自分が負けているならコスト0', () => {
  const s = makeState();
  assert.strictEqual(cost(s, 'playerB', 'BP05-079'), 5);
  s.match.previousRoundLoser = 'playerA';
  assert.strictEqual(cost(s, 'playerB', 'BP05-079'), 5, '相手が負けたラウンドの後は下がらない');
  s.match.previousRoundLoser = 'playerB';
  assert.strictEqual(cost(s, 'playerB', 'BP05-079'), 0);
});
test('装備すると体力+50', () => {
  const s = makeState();
  s.match.previousRoundLoser = 'playerB';
  const l = s.players.playerB.leaders[0];
  const base = GameState.getLeaderMaxHp(cardIndex, l);
  tactics(s, 'BP05-079', 'EQUIPMENT', 0);
  assert.strictEqual(ppUsed(s), 0);
  assert.strictEqual(GameState.getLeaderMaxHp(cardIndex, l), base + 50);
});
test('PPが足りなければプレイできない（コスト5）', () => {
  const s = makeState();
  s.players.playerB.ppCards.max = 3;
  assert.throws(() => tactics(s, 'BP05-079', 'EQUIPMENT', 0));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
