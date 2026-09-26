/* 第5弾ACE 8枚（＋同じ新機構で登録したBP04-028/BP04-079）の自動テスト（node test/bp05Ace.test.js で実行）
 *
 * 対象:
 *  - data/source/all-cards.json: 第5弾ACEの台帳登録・画像
 *  - effectResolver.js 新Action: DECK_LOOK_ADD_TO_HAND / OPTIONAL_SELF_DAMAGE_THEN /
 *    DISCARD_COST_THEN_DECK_LOOK_FREE_ATTACK、エコー（runEndPhaseWithEffects/runStartPhaseWithEffects）
 *  - effectFactories.js: makeUpToNOpponentLeadersTarget / makeAttackerDamagedCondition / makeAttackerRemainingHpCondition
 *  - phases.js playAttackCard の freePlay
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
// このテストではアタックでダウンを取ることがあるため、覚醒時効果の影響を受けないようにする
LEADERS_A.concat(LEADERS_B).forEach((id) => { delete CardEffectData.REGISTRY[id]; });

const PP_TICKET = 'ST01-024';
const noEffect = (c) => !c.ban && !c.isParallel && !CardEffectData.hasEffects(c.cardNumber) && !CardEffectData.KEYWORDS[c.cardNumber];
const plainCard = require('./helpers/plainCard.js')(allCards, CardEffectData, __filename);
const FILLER_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 1);
const ATTACK_COST2 = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 2);
const ATTACK_COST3 = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 3);
const MEMORIA_COST0 = plainCard((c) => c.cardType === 'MEMORIA' && c.cost === 0 && c.ace !== true);
const MEMORIA_COST1 = plainCard((c) => c.cardType === 'MEMORIA' && c.cost === 1 && c.ace !== true);
const ATTACK_COST0 = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 0 && c.ace !== true);
const ACE_COST0 = allCards.filter((c) => c.cost === 0 && c.ace === true && ['ATTACK', 'MEMORIA'].includes(c.cardType) && !c.isParallel)[0].cardNumber;
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban && !c.isParallel).slice(0, 5).map((c) => c.cardNumber);

// 後攻（playerB）の手番。デッキ・手札は各テストで直接組み立てる。
function makeState() {
  const state = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: PP_TICKET,
    playerA: { leaderCardIds: LEADERS_A, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: LEADERS_B, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
  });
  state.turn.activePlayer = 'playerB';
  state.turn.turnNumber = 2;
  state.turn.tacticsPlayedThisTurn = false;
  ['playerA', 'playerB'].forEach((pid) => {
    state.players[pid].hand = [];
    state.players[pid].ppCards.max = 10;
    state.players[pid].ppCards.tapped = 0;
  });
  return state;
}
const inst = (id) => GameState.createCardInstance(id);
function setDeckTop(state, pid, ids) {
  state.players[pid].deck = ids.map(inst).concat(new Array(20).fill(FILLER_ATTACK).map(inst));
}
function toHand(state, pid, id) {
  const c = inst(id);
  state.players[pid].hand.push(c);
  return c.instanceId;
}
function attackWith(state, cardId, options) {
  const id = toHand(state, 'playerB', cardId);
  EffectResolver.playAttackCardWithEffects(state, 'playerB', id, Object.assign({
    attackerLeaderIndex: 0, targetPlayerId: 'playerA', targetLeaderIndex: 0,
  }, options || {}), cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
}
function playMemoria(state, cardId, options) {
  const id = toHand(state, 'playerB', cardId);
  EffectResolver.playMemoriaCardWithEffects(state, 'playerB', id, options || {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  return id;
}
const handIds = (state, pid) => state.players[pid].hand.map((c) => c.cardId);
const damages = (state, pid) => state.players[pid].leaders.map((l) => l.damage);
const atkOf = (state, pid, i) => GameState.getLeaderCurrentAtk(cardIndex, state.players[pid].leaders[i]);

// ============================================================
console.log('=== 台帳・画像 ===');
// ============================================================
const BP05_ACE = {
  'BP05-017': ['デュアルハザード', 'ATTACK', 'red', 1],
  'BP05-024': ['アブソリュートドミニオン', 'ATTACK', 'blue', 1],
  'BP05-031': ['ダブルダウン', 'ATTACK', 'yellow', 2],
  'BP05-038': ['頂点捕食者', 'ATTACK', 'green', 1],
  'BP05-045': ['共に至る極致', 'MEMORIA', 'red', 1],
  'BP05-052': ['ヴァリアブルピック', 'MEMORIA', 'blue', 2],
  'BP05-059': ['魔王再臨', 'MEMORIA', 'yellow', 0],
  'BP05-066': ['ハセシンの刑執行', 'MEMORIA', 'green', 1],
};
test('第5弾ACE 8枚が名称・種類・色・コスト・SR/ACEで登録され、画像と効果がある', () => {
  Object.keys(BP05_ACE).forEach((n) => {
    const c = cardIndex[n];
    const [name, type, color, cost] = BP05_ACE[n];
    assert.ok(c, n);
    assert.deepStrictEqual([c.name, c.cardType, c.color, c.cost, c.rarity, c.ace, c.set], [name, type, color, cost, 'SR', true, 'BP05'], n);
    assert.strictEqual(c.imageUrl, 'cards/' + n + '.webp');
    assert.ok(CardEffectData.hasEffects(n), n);
  });
});
test('エコーを持つのは魔王再臨とハセシンの刑執行だけ', () => {
  assert.ok(CardEffectData.hasKeyword('BP05-059', 'ECHO'));
  assert.ok(CardEffectData.hasKeyword('BP05-066', 'ECHO'));
  assert.ok(!CardEffectData.hasKeyword('BP05-045', 'ECHO'));
});

// ============================================================
console.log('=== BP05-017 デュアルハザード ===');
// ============================================================
function dualHazardDamage(attackerDamage) {
  const state = makeState();
  const attacker = state.players.playerB.leaders[0];
  attacker.damage = attackerDamage;
  const before = state.players.playerA.leaders[1].damage;
  attackWith(state, 'BP05-017', { targetLeaderIndex: 1 });
  return state.players.playerA.leaders[1].damage - before - atkOf(state, 'playerB', 0);
}
test('アタッカーが無傷なら上乗せなし', () => {
  assert.strictEqual(dualHazardDamage(0), 0);
});
test('アタッカーがダメージを受けていれば+40', () => {
  assert.strictEqual(dualHazardDamage(10), 40);
});
test('アタッカーの残り体力が10なら、さらに+40（合計+80）', () => {
  const hp = GameState.getLeaderMaxHp(cardIndex, makeState().players.playerB.leaders[0]);
  const state = makeState();
  state.players.playerB.leaders[0].damage = hp - 10;
  const base = EffectResolver.computeAttackCardBaseDamage('BP05-017', state, {
    ownerPlayerId: 'playerB', attackerPlayerId: 'playerB', attackerLeaderIndex: 0, cardIndex,
  });
  assert.strictEqual(base, 80);
});

// ============================================================
console.log('=== BP05-024 アブソリュートドミニオン（DECK_LOOK_ADD_TO_HAND） ===');
// ============================================================
test('上から5枚のうちコスト0のメモリアを最大3枚手札に加え、残りはトラッシュ', () => {
  const state = makeState();
  setDeckTop(state, 'playerB', [MEMORIA_COST0, ATTACK_COST0, MEMORIA_COST0, MEMORIA_COST1, MEMORIA_COST0]);
  const deckBefore = state.players.playerB.deck.length;
  const trashBefore = state.players.playerB.trash.length;
  attackWith(state, 'BP05-024');
  assert.deepStrictEqual(handIds(state, 'playerB'), [MEMORIA_COST0, MEMORIA_COST0, MEMORIA_COST0]);
  assert.strictEqual(state.players.playerB.deck.length, deckBefore - 5);
  // 残り2枚＋プレイエリアのカードはまだトラッシュに行かない（ターン終了時）ので、トラッシュ増分は2枚
  assert.strictEqual(state.players.playerB.trash.length, trashBefore + 2);
  state.players.playerB.trash.slice(-2).forEach((t) => assert.strictEqual(t.faceUp, false));
});
test('候補が4枚以上でも手札に加えるのは3枚まで', () => {
  const state = makeState();
  setDeckTop(state, 'playerB', [MEMORIA_COST0, MEMORIA_COST0, MEMORIA_COST0, MEMORIA_COST0, MEMORIA_COST0]);
  attackWith(state, 'BP05-024');
  assert.strictEqual(state.players.playerB.hand.length, 3);
});
test('選択コールバックで枚数を減らせる（最大）', () => {
  const state = makeState();
  setDeckTop(state, 'playerB', [MEMORIA_COST0, MEMORIA_COST0, FILLER_ATTACK, FILLER_ATTACK, FILLER_ATTACK]);
  attackWith(state, 'BP05-024', { chooseDeckLookAddToHand: (cands) => [cands[1].instanceId] });
  assert.strictEqual(state.players.playerB.hand.length, 1);
});
test('BP04-028 シンクロトリニティ：エース以外のコスト0を1枚（種類は問わない）', () => {
  const state = makeState();
  setDeckTop(state, 'playerB', [ACE_COST0, ATTACK_COST0, MEMORIA_COST0]);
  attackWith(state, 'BP04-028');
  assert.deepStrictEqual(handIds(state, 'playerB'), [ATTACK_COST0]);
});
test('BP04-079 討伐クエスト：7枚から必ず1枚手札に加える（選択が空でも1枚加える）', () => {
  const state = makeState();
  setDeckTop(state, 'playerB', [ATTACK_COST3, FILLER_ATTACK, FILLER_ATTACK, FILLER_ATTACK, FILLER_ATTACK, FILLER_ATTACK, FILLER_ATTACK]);
  const deckBefore = state.players.playerB.deck.length;
  const t = inst('BP04-079');
  state.players.playerB.tacticsArea.push({ card: t });
  EffectResolver.playTacticsCardWithEffects(state, 'playerB', t.instanceId, { subType: 'CONSUMABLE', chooseDeckLookAddToHand: () => [] }, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.deepStrictEqual(handIds(state, 'playerB'), [ATTACK_COST3]);
  assert.strictEqual(state.players.playerB.deck.length, deckBefore - 7);
});

// ============================================================
console.log('=== BP05-031 ダブルダウン ===');
// ============================================================
test('プレイエリアにメモリアが2枚以上なら、対戦相手の他のリーダー1体に100ダメージ', () => {
  const state = makeState();
  playMemoria(state, MEMORIA_COST0);
  playMemoria(state, MEMORIA_COST0);
  attackWith(state, 'BP05-031', { targetLeaderIndex: 0 });
  const other = state.players.playerA.leaders[1];
  assert.ok(other.isDown || other.damage === 100, 'damage=' + other.damage);
});
test('メモリアが1枚なら何もしない', () => {
  const state = makeState();
  playMemoria(state, MEMORIA_COST0);
  attackWith(state, 'BP05-031', { targetLeaderIndex: 0 });
  assert.deepStrictEqual(damages(state, 'playerA').slice(1), [0, 0, 0]);
});

// ============================================================
console.log('=== BP05-038 頂点捕食者 ===');
// ============================================================
test('手札を捨てる選択が無ければ何もしない（デッキも見ない）', () => {
  const state = makeState();
  toHand(state, 'playerB', ATTACK_COST2);
  const deckBefore = state.players.playerB.deck.length;
  attackWith(state, 'BP05-038');
  assert.strictEqual(state.players.playerB.hand.length, 1);
  assert.strictEqual(state.players.playerB.deck.length, deckBefore);
});
test('コスト合計が2未満の選択は「しなかった」扱い', () => {
  const state = makeState();
  toHand(state, 'playerB', MEMORIA_COST1);
  const deckBefore = state.players.playerB.deck.length;
  attackWith(state, 'BP05-038', { chooseApexDiscard: (cands) => cands.map((c) => c.instanceId) });
  assert.strictEqual(state.players.playerB.hand.length, 1);
  assert.strictEqual(state.players.playerB.deck.length, deckBefore);
});
test('捨てたら上から4枚を見て、コスト2以下の頂点捕食者以外のアタックをコストを支払わずにプレイする', () => {
  const state = makeState();
  toHand(state, 'playerB', ATTACK_COST2);
  setDeckTop(state, 'playerB', ['BP05-038', ATTACK_COST3, ATTACK_COST2, MEMORIA_COST0]);
  const deckBefore = state.players.playerB.deck.length;
  const oppBefore = damages(state, 'playerA');
  attackWith(state, 'BP05-038', { chooseApexDiscard: (cands) => cands.map((c) => c.instanceId) });
  const pb = state.players.playerB;
  assert.strictEqual(pb.hand.length, 0, '手札のコスト2は捨てた');
  assert.strictEqual(pb.deck.length, deckBefore - 4);
  assert.strictEqual(pb.ppCards.tapped, 1, 'PPは頂点捕食者の1だけ');
  assert.deepStrictEqual(pb.playArea.map((e) => e.card.cardId), ['BP05-038', ATTACK_COST2]);
  // 1回目＋2回目のアタックで、アタッカーの攻撃力×2のダメージが相手リーダー0体目に入っている（ダウンしていなければ）
  const target = state.players.playerA.leaders[0];
  const expected = oppBefore[0] + atkOf(state, 'playerB', 0) * 2;
  assert.ok(target.isDown || target.damage === expected, 'damage=' + target.damage + ' expected=' + expected);
  // 捨てた1枚＋見た残り3枚（頂点捕食者・コスト3・メモリア）はトラッシュ
  assert.strictEqual(pb.trash.length, 4);
});
test('プレイしたアタックは「このアタックが終わってから」＝同じアタックの他の効果より後に解決される', () => {
  const state = makeState();
  toHand(state, 'playerB', ATTACK_COST2);
  setDeckTop(state, 'playerB', [ATTACK_COST2]);
  // メモリアが積んだアタック後効果（ハセシンの刑執行：他のリーダーすべてに10）を先に積んでおく
  playMemoria(state, 'BP05-066');
  attackWith(state, 'BP05-038', { chooseApexDiscard: (cands) => cands.map((c) => c.instanceId) });
  const events = state.actionLog;
  const idxFree = events.findIndex((e) => e.type === 'FREE_ATTACK_PLAYED_BY_EFFECT');
  const lastOtherDamage = events.map((e, i) => (e.type === 'DAMAGE_DEALT' && e.payload && e.payload.amount === 10 ? i : -1)).filter((i) => i >= 0);
  assert.ok(idxFree > 0, 'フリーアタックが記録されている');
  assert.ok(lastOtherDamage.length > 0 && lastOtherDamage.every((i) => i < idxFree), 'メモリアのアタック後効果が先');
});
test('デッキから選ぶ選択でnullを返せばプレイしない（見た4枚はすべてトラッシュ）', () => {
  const state = makeState();
  toHand(state, 'playerB', ATTACK_COST2);
  setDeckTop(state, 'playerB', [ATTACK_COST2, FILLER_ATTACK, FILLER_ATTACK, FILLER_ATTACK]);
  attackWith(state, 'BP05-038', { chooseApexDiscard: (c) => c.map((x) => x.instanceId), chooseDeckLookAttack: () => null });
  assert.strictEqual(state.players.playerB.playArea.length, 1);
  assert.strictEqual(state.players.playerB.trash.length, 5);
});

// ============================================================
console.log('=== BP05-045 共に至る極致 ===');
// ============================================================
test('選択が無ければダメージを与えず、引かない。アタック強化+50', () => {
  const state = makeState();
  playMemoria(state, 'BP05-045');
  assert.deepStrictEqual(damages(state, 'playerB'), [0, 0, 0, 0]);
  assert.strictEqual(state.players.playerB.hand.length, 0);
  assert.strictEqual(state.players.playerB.pendingAttackBoost, 50);
});
test('体力40以上のリーダーに30ダメージを与えたら2枚引く', () => {
  const state = makeState();
  playMemoria(state, 'BP05-045', { chooseSelfDamage: () => 1 });
  assert.strictEqual(state.players.playerB.leaders[1].damage, 30);
  assert.strictEqual(state.players.playerB.hand.length, 2);
});
test('残り体力40未満のリーダーは候補にならない', () => {
  const state = makeState();
  const l0 = state.players.playerB.leaders[0];
  l0.damage = GameState.getLeaderMaxHp(cardIndex, l0) - 30;
  let seen = null;
  playMemoria(state, 'BP05-045', { chooseSelfDamage: (cands) => { seen = cands.map((c) => c.leaderIndex); return -1; } });
  assert.deepStrictEqual(seen, [1, 2, 3]);
});

// ============================================================
console.log('=== BP05-052 ヴァリアブルピック ===');
// ============================================================
test('対戦相手は手札を2枚捨て、対戦相手のリーダー最大2体に30ダメージ（既定は先頭から2体）', () => {
  const state = makeState();
  [FILLER_ATTACK, FILLER_ATTACK, FILLER_ATTACK].forEach((id) => toHand(state, 'playerA', id));
  playMemoria(state, 'BP05-052');
  assert.strictEqual(state.players.playerA.hand.length, 1);
  assert.deepStrictEqual(damages(state, 'playerA'), [30, 30, 0, 0]);
});
test('対象は選べる（1体だけでもよい）', () => {
  const state = makeState();
  playMemoria(state, 'BP05-052', { chooseMultiTargets: () => [3] });
  assert.deepStrictEqual(damages(state, 'playerA'), [0, 0, 0, 30]);
});

// ============================================================
console.log('=== エコー（BP05-059 魔王再臨 / BP05-066 ハセシンの刑執行） ===');
// ============================================================
test('魔王再臨：プレイ時に1枚引き、ターン終了時は横向きでプレイエリアに残る', () => {
  const state = makeState();
  playMemoria(state, 'BP05-059');
  playMemoria(state, MEMORIA_COST0);
  assert.strictEqual(state.players.playerB.hand.length, 1);
  EffectResolver.runEndPhaseWithEffects(state);
  const pa = state.players.playerB.playArea;
  assert.deepStrictEqual(pa.map((e) => [e.card.cardId, e.echoHorizontal]), [['BP05-059', true]]);
});
test('魔王再臨：次の自分のメインフェイズ開始時にプレイし直して1枚引き、その次のターン終了時にトラッシュへ', () => {
  const state = makeState();
  playMemoria(state, 'BP05-059');
  EffectResolver.runEndPhaseWithEffects(state);
  const handBefore = state.players.playerB.hand.length;
  state.players.playerB.ppCards.tapped = 0;
  EffectResolver.runStartPhaseWithEffects(state, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  // スタートフェイズのドロー1枚＋エコーでのプレイ時効果1枚
  assert.strictEqual(state.players.playerB.hand.length, handBefore + 2);
  assert.strictEqual(state.players.playerB.ppCards.tapped, 0, 'コストは支払わない');
  EffectResolver.runEndPhaseWithEffects(state);
  assert.strictEqual(state.players.playerB.playArea.length, 0);
  assert.ok(state.players.playerB.trash.some((t) => t.card.cardId === 'BP05-059'));
});
test('ハセシンの刑執行：アタック強化+20と、アタック後に他のリーダーすべてへ10', () => {
  const state = makeState();
  playMemoria(state, 'BP05-066');
  assert.strictEqual(state.players.playerB.pendingAttackBoost, 20);
  attackWith(state, FILLER_ATTACK, { targetLeaderIndex: 0 });
  assert.deepStrictEqual(damages(state, 'playerA').slice(1), [10, 10, 10]);
});
test('ハセシンの刑執行：エコーでプレイし直すと、次のターンのアタックにも強化と効果が乗る', () => {
  const state = makeState();
  playMemoria(state, 'BP05-066');
  attackWith(state, FILLER_ATTACK, { targetLeaderIndex: 0 });
  EffectResolver.runEndPhaseWithEffects(state);
  assert.strictEqual(state.players.playerB.playArea.length, 1);
  EffectResolver.runStartPhaseWithEffects(state, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.pendingAttackBoost, 20);
  attackWith(state, FILLER_ATTACK, { targetLeaderIndex: 0 });
  const others = state.players.playerA.leaders.slice(1);
  others.forEach((l) => assert.ok(l.isDown || l.damage === 20, 'damage=' + l.damage));
});
test('相手のスタートフェイズではプレイし直さない（自分のメインフェイズ開始時のみ）', () => {
  const state = makeState();
  playMemoria(state, 'BP05-059');
  EffectResolver.runEndPhaseWithEffects(state);
  EffectResolver.endTurnAndSwitchWithEffects(state);
  const handBefore = state.players.playerB.hand.length;
  EffectResolver.runStartPhaseWithEffects(state, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  assert.strictEqual(state.players.playerB.hand.length, handBefore);
  assert.strictEqual(state.players.playerB.playArea[0].echoHorizontal, true);
});
test('エコー無しのメモリアは通常どおりトラッシュ', () => {
  const state = makeState();
  playMemoria(state, 'BP05-045');
  EffectResolver.runEndPhaseWithEffects(state);
  assert.strictEqual(state.players.playerB.playArea.length, 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
