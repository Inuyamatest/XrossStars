/* Phase M: 新しい仕組みが必要で未登録だった11枚の自動テスト（node test/phaseM.test.js で実行）
 *
 *  復活ポータル（プレイ条件・復活）/ サイバネアーマー（基本の体力の置き換え）/ 追加マガジン（タクティクスエリアに戻る）/
 *  パワーフィールド（ラウンド中の攻撃力+10・プレイエリアに残る）/ ターゲットフラッグ（アタック対象の制限）/
 *  オートタレット（アタック後効果でダメージを与えたら）/ 巡り合う二人（メモリアとアタックをコストなしで）/
 *  ジェイルブレイク（効果で引いた枚数×20を割り振る）/ グレイトフルファーマー（アタックカードをプレイし直す）
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

const SELF = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004'];
const OPP = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];
SELF.concat(OPP).forEach((id) => { delete CardEffectData.REGISTRY[id]; });
const FILLER_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 1);
const MEMORIA_1 = plainCard((c) => c.cardType === 'MEMORIA' && c.cost === 1 && c.ace !== true);
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban && !c.isParallel).slice(0, 5).map((c) => c.cardNumber);

// 後攻（playerB）の手番（タクティクスを使えるように）
function makeState() {
  const state = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: 'ST01-024',
    playerA: { leaderCardIds: OPP, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: SELF, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
  });
  state.turn.activePlayer = 'playerB';
  state.turn.turnNumber = 2;
  state.turn.tacticsPlayedThisTurn = false;
  ['playerA', 'playerB'].forEach((pid) => { state.players[pid].hand = []; state.players[pid].ppCards.max = 10; state.players[pid].ppCards.tapped = 0; });
  return state;
}
const inst = (id) => GameState.createCardInstance(id);
function toHand(s, id) { const c = inst(id); s.players.playerB.hand.push(c); return c.instanceId; }
function tactics(s, id, subType, equipLeaderIndex, options) {
  const c = inst(id);
  s.players.playerB.tacticsArea.push({ card: c });
  s.turn.tacticsPlayedThisTurn = false;
  EffectResolver.playTacticsCardWithEffects(s, 'playerB', c.instanceId, Object.assign({ subType: subType || 'CONSUMABLE', equipLeaderIndex }, options || {}), cardIndex);
  ResolutionStack.resolveAll(s.resolutionStack, s);
  return c.instanceId;
}
function attack(s, cardId, options) {
  const id = toHand(s, cardId);
  EffectResolver.playAttackCardWithEffects(s, 'playerB', id, Object.assign({ attackerLeaderIndex: 0, targetPlayerId: 'playerA', targetLeaderIndex: 0 }, options || {}), cardIndex);
  ResolutionStack.resolveAll(s.resolutionStack, s);
  return id;
}
function memoria(s, cardId, options) {
  const id = toHand(s, cardId);
  EffectResolver.playMemoriaCardWithEffects(s, 'playerB', id, options || {}, cardIndex);
  ResolutionStack.resolveAll(s.resolutionStack, s);
  return id;
}
const oppDmg = (s) => s.players.playerA.leaders.map((l) => l.damage);
const atk0 = (s) => GameState.getLeaderCurrentAtk(cardIndex, s.players.playerB.leaders[0]);

// ============================================================
console.log('=== 登録状況 ===');
// ============================================================
test('11枚すべてに効果（またはキーワード）が登録されている', () => {
  ['BP01-094', 'BP02-075', 'BP03-080', 'BP04-073', 'BP03-076', 'BP03-077', 'BP03-079', 'BP02-077', 'BP02-045', 'BP03-066', 'BP04-059']
    .forEach((n) => assert.ok(CardEffectData.hasEffects(n), n));
});

// ============================================================
console.log('=== 復活ポータル ===');
// ============================================================
test('対戦相手よりダウンしているリーダーが多くなければプレイできない', () => {
  const s = makeState();
  assert.strictEqual(EffectResolver.canPlayCardNow(s, 'playerB', 'BP01-094', cardIndex), false);
  assert.throws(() => tactics(s, 'BP01-094'));
  s.players.playerB.leaders[1].isDown = true;
  s.players.playerA.leaders[0].isDown = true;
  assert.strictEqual(EffectResolver.canPlayCardNow(s, 'playerB', 'BP01-094', cardIndex), false, '同数ではプレイできない');
});
test('ダウンしている自分のリーダー1体をダウンしていない状態に戻し、装備は表向きでトラッシュへ', () => {
  const s = makeState();
  const l = s.players.playerB.leaders[2];
  l.isDown = true;
  l.equipment.push(inst('BP01-095'));
  tactics(s, 'BP02-075');
  assert.strictEqual(l.isDown, false);
  assert.strictEqual(l.damage, 0);
  assert.strictEqual(l.equipment.length, 0);
  assert.ok(s.players.playerB.trash.some((t) => t.card.cardId === 'BP01-095' && t.faceUp));
});

// ============================================================
console.log('=== サイバネアーマー ===');
// ============================================================
test('装備すると基本の体力が140（覚醒していれば170）。体力+の装備は上乗せされる', () => {
  const s = makeState();
  tactics(s, 'BP03-080', 'EQUIPMENT', 0);
  const l = s.players.playerB.leaders[0];
  assert.strictEqual(GameState.getLeaderMaxHp(cardIndex, l), 140);
  l.awakened = true;
  assert.strictEqual(GameState.getLeaderMaxHp(cardIndex, l), 170);
  tactics(s, 'BP01-095', 'EQUIPMENT', 0); // ライトシールド 体力+30
  assert.strictEqual(GameState.getLeaderMaxHp(cardIndex, l), 200);
});

// ============================================================
console.log('=== 追加マガジン ===');
// ============================================================
test('手札を1枚捨て、アタック強化+30。ターン終了時はトラッシュでなくタクティクスエリアに戻る', () => {
  const s = makeState();
  toHand(s, FILLER_ATTACK);
  const id = tactics(s, 'BP03-076');
  assert.strictEqual(s.players.playerB.hand.length, 0);
  assert.strictEqual(s.players.playerB.pendingAttackBoost, 30);
  EffectResolver.runEndPhaseWithEffects(s);
  assert.ok(s.players.playerB.tacticsArea.some((t) => t.card.instanceId === id));
  assert.ok(!s.players.playerB.trash.some((t) => t.card.instanceId === id));
});
test('ラウンド終了時のプレイエリア一掃でもタクティクスエリアに戻る', () => {
  const s = makeState();
  const id = tactics(s, 'BP03-076');
  s.players.playerA.leaders.forEach((l) => { l.isDown = true; });
  const r = EffectResolver.processRoundEndWithEffects(s);
  assert.ok(r.roundEnded);
  assert.ok(s.players.playerB.tacticsArea.some((t) => t.card.instanceId === id));
});

// ============================================================
console.log('=== パワーフィールド ===');
// ============================================================
test('このラウンド、自分のリーダーすべての攻撃力+10。ターン終了時もプレイエリアに残り、ラウンド終了で消える', () => {
  const s = makeState();
  const before = atk0(s);
  const id = tactics(s, 'BP03-077');
  assert.strictEqual(atk0(s), before + 10);
  assert.strictEqual(GameState.getLeaderCurrentAtk(cardIndex, s.players.playerB.leaders[3]), before + 10);
  EffectResolver.runEndPhaseWithEffects(s);
  EffectResolver.endTurnAndSwitchWithEffects(s);
  assert.ok(s.players.playerB.playArea.some((e) => e.card.instanceId === id), 'プレイエリアに残る');
  assert.strictEqual(atk0(s), before + 10, '相手のターンも続く');
  s.players.playerA.leaders.forEach((l) => { l.isDown = true; });
  EffectResolver.processRoundEndWithEffects(s);
  assert.strictEqual(atk0(s), before);
  assert.ok(s.players.playerB.trash.some((t) => t.card.instanceId === id && t.faceUp));
});

// ============================================================
console.log('=== ターゲットフラッグ ===');
// ============================================================
test('装備したリーダーにしかアタックできない（効果のダメージは制限しない）', () => {
  const s = makeState();
  // 相手（playerA）のリーダー2にフラッグを付ける
  const flag = inst('BP03-079');
  s.players.playerA.leaders[2].equipment.push(Object.assign(flag, { targetFlag: true }));
  assert.deepStrictEqual(EffectResolver.getAllowedAttackTargets(s, 'playerB'), [2]);
  assert.throws(() => attack(s, FILLER_ATTACK, { targetLeaderIndex: 0 }));
  attack(s, 'BP01-027', { targetLeaderIndex: 2 }); // フラッシュバン：アタック後、他のリーダー1体に20
  assert.strictEqual(s.players.playerA.leaders[2].damage, 30);
  assert.ok(s.players.playerA.leaders.some((l, i) => i !== 2 && l.damage === 20), '効果のダメージは他のリーダーにも与えられる');
});
test('装備した時点でフラッグが有効になる', () => {
  const s = makeState();
  tactics(s, 'BP03-079', 'EQUIPMENT', 1);
  assert.deepStrictEqual(EffectResolver.getAllowedAttackTargets(s, 'playerA'), [1]);
  s.players.playerB.leaders[1].isDown = true;
  assert.deepStrictEqual(EffectResolver.getAllowedAttackTargets(s, 'playerA'), [0, 2, 3], 'ダウンしたら制限は無くなる');
});

// ============================================================
console.log('=== オートタレット ===');
// ============================================================
test('このアタックのアタック後効果でダメージを与えていれば、他のリーダーすべてに10（ターンに1回）', () => {
  const s = makeState();
  tactics(s, 'BP02-077', 'EQUIPMENT', 0);
  attack(s, 'BP01-027'); // フラッシュバン：他のリーダー1体に20
  const d = oppDmg(s);
  assert.deepStrictEqual(d.slice(1).sort(), [10, 10, 30]);
  attack(s, 'BP01-027');
  const d2 = oppDmg(s);
  assert.strictEqual(d2.slice(1).reduce((a, b) => a + b, 0), 50 + 20, '2回目は発動しない（ターンに1回）');
});
test('アタック後効果でダメージを与えていなければ発動しない', () => {
  const s = makeState();
  tactics(s, 'BP02-077', 'EQUIPMENT', 0);
  attack(s, FILLER_ATTACK);
  assert.deepStrictEqual(oppDmg(s).slice(1), [0, 0, 0]);
});

// ============================================================
console.log('=== 巡り合う二人 ===');
// ============================================================
test('上から5枚からコスト1以下のメモリアとアタックを1枚ずつ、メモリア→アタックの順にコストなしでプレイ', () => {
  const s = makeState();
  s.players.playerB.deck = ['BP01-054', FILLER_ATTACK, 'BP01-046', MEMORIA_1, FILLER_ATTACK].map(inst).concat(s.players.playerB.deck);
  memoria(s, 'BP02-045');
  const p = s.players.playerB;
  assert.strictEqual(p.ppCards.tapped, 2, '巡り合う二人のコストだけ');
  assert.deepStrictEqual(p.playArea.map((e) => e.card.cardId), ['BP02-045', 'BP01-054', FILLER_ATTACK]);
  // 胴だよ胴！の+50がアタックに乗る：攻撃力30＋50
  assert.ok(s.players.playerA.leaders.some((l) => l.damage === 80 || l.isDown), JSON.stringify(oppDmg(s)));
  assert.strictEqual(p.trash.length, 3);
});
test('アタック→メモリアの順を選ぶと、アタックには強化が乗らない（強化は次のアタックへ）', () => {
  const s = makeState();
  s.players.playerB.deck = ['BP01-054', FILLER_ATTACK].map(inst).concat(s.players.playerB.deck);
  memoria(s, 'BP02-045', { chooseMeetTwo: (m, a) => ({ memoria: m[0].instanceId, attack: a[0].instanceId, attackFirst: true }) });
  assert.ok(s.players.playerA.leaders.some((l) => l.damage === 30));
  assert.strictEqual(s.players.playerB.pendingAttackBoost, 50);
});

// ============================================================
console.log('=== ジェイルブレイク ===');
// ============================================================
test('このターンにメモリア/アタックの効果で引いた枚数×20を割り振る', () => {
  const s = makeState();
  memoria(s, 'BP01-058'); // 危機一髪：2枚引く
  memoria(s, 'BP03-066', { chooseDistributedDamage: (c, total) => [{ playerId: c[1].playerId, leaderIndex: c[1].leaderIndex, amount: total }] });
  assert.deepStrictEqual(oppDmg(s), [0, 40, 0, 0]);
});
test('100ダメージまで。タクティクスや覚醒時効果で引いたカードは数えない', () => {
  const s = makeState();
  memoria(s, 'BP01-058'); memoria(s, 'BP01-058'); memoria(s, 'BP01-058'); // 6枚
  memoria(s, 'BP03-066');
  const dealt = s.actionLog.filter((e) => e.type === 'DAMAGE_DEALT' && e.payload.source === 'CARD_EFFECT').map((e) => e.payload.amount);
  assert.deepStrictEqual(dealt, [100], '6枚×20=120だが上限100');
  const s2 = makeState();
  tactics(s2, 'BP03-078'); // タクティクス：1枚引く
  assert.strictEqual(EffectResolver.effectDrawsThisTurn(s2, 'playerB'), 0);
  memoria(s2, 'BP03-066');
  assert.deepStrictEqual(oppDmg(s2).slice(0, 1), [10], 'タクティクスのダメージ10だけ');
});
test('次のターンには数え直す', () => {
  const s = makeState();
  memoria(s, 'BP01-058');
  s.turn.turnNumber += 1;
  assert.strictEqual(EffectResolver.effectDrawsThisTurn(s, 'playerB'), 0);
});

// ============================================================
console.log('=== グレイトフルファーマー ===');
// ============================================================
test('アタックカードの実行が終わったら、同じカードでもう一度アタックする（コストなし）', () => {
  const s = makeState();
  memoria(s, 'BP04-059');
  const pp = s.players.playerB.ppCards.tapped;
  attack(s, 'ST02-007', { targetLeaderIndex: 1 }); // インパクトショット +40（70ダメージ）
  const l = s.players.playerA.leaders[1];
  assert.ok(l.isDown || l.damage === 140, '2回アタックしている: ' + l.damage);
  assert.strictEqual(s.players.playerB.ppCards.tapped, pp + 2, '2回目はコストを支払わない');
  assert.strictEqual(s.players.playerB.playArea.filter((e) => e.card.cardId === 'ST02-007').length, 1);
});
test('プレイし直したアタックでは、グレイトフルファーマーはもう発動しない（無限に続かない）', () => {
  const s = makeState();
  memoria(s, 'BP04-059');
  attack(s, FILLER_ATTACK, { targetLeaderIndex: 3 });
  assert.strictEqual(s.players.playerA.leaders[3].damage, 60, '攻撃力30のアタックがちょうど2回');
  assert.strictEqual(s.resolutionStack.pending.length, 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
