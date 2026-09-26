/* Phase K: テキストは登録済みなのに効果が未登録だった基本カードの一括登録の自動テスト（node test/phaseK.test.js で実行）
 *
 * きっかけ：クリティカルショット（〖アタックする〗ダメージ+70）でアタックしても、攻撃力30＋70＝100のダメージが
 * 入らなかった（効果が未登録で+70が乗っていなかった）。
 *
 * 対象:
 *  - cardEffectData.js Phase K の登録（代表パターンごと）
 *  - effectResolver.js: 〖アタックする〗の手札破棄/公開ボーナス、アタック宣言時に判定する強化、
 *    アタックカード自身の〖プレイ時〗〖アタック強化〗、同名カードによるコスト免除、強化の出どころの記録
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
LEADERS_A.concat(LEADERS_B).forEach((id) => { delete CardEffectData.REGISTRY[id]; });
function plainCard(pred) {
  const pool = allCards.filter((c) => pred(c) && !c.ban && !c.isParallel && !CardEffectData.KEYWORDS[c.cardNumber]);
  const c = pool.find((x) => !CardEffectData.hasEffects(x.cardNumber)) || pool[0];
  delete CardEffectData.REGISTRY[c.cardNumber];
  return c.cardNumber;
}
const FILLER_ATTACK = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 1);
const MEMORIA_0 = plainCard((c) => c.cardType === 'MEMORIA' && c.cost === 0 && c.ace !== true);
const MEMORIA_1 = plainCard((c) => c.cardType === 'MEMORIA' && c.cost === 1 && c.ace !== true);
const MEMORIA_2 = plainCard((c) => c.cardType === 'MEMORIA' && c.cost === 2 && c.ace !== true);
const TACTICS_5 = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban && !c.isParallel).slice(0, 5).map((c) => c.cardNumber);

function makeState() {
  const state = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: 'ST01-024',
    playerA: { leaderCardIds: LEADERS_A, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: LEADERS_B, deckCardIds: new Array(50).fill(FILLER_ATTACK), tacticsDeckCardIds: TACTICS_5 },
  });
  state.turn.activePlayer = 'playerB';
  state.turn.turnNumber = 2;
  ['playerA', 'playerB'].forEach((pid) => {
    state.players[pid].hand = [];
    state.players[pid].ppCards.max = 10;
    state.players[pid].ppCards.tapped = 0;
  });
  return state;
}
const inst = (id) => GameState.createCardInstance(id);
function toHand(state, pid, id) { const c = inst(id); state.players[pid].hand.push(c); return c.instanceId; }
function attackWith(state, cardId, options) {
  const id = toHand(state, 'playerB', cardId);
  EffectResolver.playAttackCardWithEffects(state, 'playerB', id, Object.assign({ attackerLeaderIndex: 0, targetPlayerId: 'playerA', targetLeaderIndex: 0 }, options || {}), cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  return id;
}
function playMemoria(state, cardId, options) {
  const id = toHand(state, 'playerB', cardId);
  EffectResolver.playMemoriaCardWithEffects(state, 'playerB', id, options || {}, cardIndex);
  ResolutionStack.resolveAll(state.resolutionStack, state);
  return id;
}
const atk = (state) => GameState.getLeaderCurrentAtk(cardIndex, state.players.playerB.leaders[0]);
// アタックを受けたリーダーに入ったダメージ（ダウンするとダメージカウンターが0に戻るため、最後のDAMAGE_DEALTから読む）
const dmg = (state, i) => {
  const idx = i == null ? 0 : i;
  // アタックのダメージはtargetPlayerId/targetLeaderIndex、効果のダメージはplayerId/leaderIndexで記録される
  const ev = state.actionLog.filter((e) => e.type === 'DAMAGE_DEALT' && (e.payload.targetPlayerId || e.payload.playerId) === 'playerA' &&
    (e.payload.targetLeaderIndex != null ? e.payload.targetLeaderIndex : e.payload.leaderIndex) === idx);
  return ev.length ? ev[ev.length - 1].payload.amount : 0;
};
const others = (state) => state.players.playerA.leaders.slice(1).map((l) => l.damage);

// ============================================================
console.log('=== 報告された不具合：クリティカルショット ===');
// ============================================================
test('クリティカルショット（BP01-046/ST01-010）：攻撃力＋70のダメージが入る（攻撃力30なら100）', () => {
  ['BP01-046', 'ST01-010'].forEach((id) => {
    const state = makeState();
    assert.strictEqual(atk(state), 30);
    attackWith(state, id);
    assert.strictEqual(dmg(state), 100, id);
  });
});
test('メモリアのアタック強化（胴だよ胴！+50）と合わせると 30＋70＋50＝150', () => {
  const state = makeState();
  state.players.playerA.leaders[0].damage = 0;
  playMemoria(state, 'BP01-054');
  attackWith(state, 'BP01-046');
  const t = state.players.playerA.leaders[0];
  assert.ok(t.isDown, 'HP100のリーダーに150ならダウン');
});
test('効果が未登録のまま残っているのは、新しい仕組みが必要な13枚だけ', () => {
  const fixtures = [FILLER_ATTACK, MEMORIA_0, MEMORIA_1, MEMORIA_2]; // このテストで効果を外して使っているカード
  const rows = allCards.filter((c) => !c.isParallel && ['ATTACK', 'MEMORIA', 'TACTICS'].includes(c.cardType) && c.text &&
    !CardEffectData.hasEffects(c.cardNumber) && !CardEffectData.KEYWORDS[c.cardNumber] && !fixtures.includes(c.cardNumber));
  assert.deepStrictEqual(rows.map((c) => c.cardNumber).sort(), ['BP01-094', 'BP02-045', 'BP02-075', 'BP02-077', 'BP03-066', 'BP03-076', 'BP03-077',
    'BP03-079', 'BP03-080', 'BP04-059', 'BP04-073', 'ST01-005', 'ST02-009'].filter((n) => rows.some((c) => c.cardNumber === n)).sort());
  assert.strictEqual(rows.length, 13);
});

// ============================================================
console.log('=== アタック強化の出どころ（画面表示用） ===');
// ============================================================
test('強化したカードと量が記録され、アタックで消費されると空になる', () => {
  const state = makeState();
  playMemoria(state, 'BP01-054');
  playMemoria(state, 'BP02-065');
  const src = state.players.playerB.pendingBoostSources;
  assert.deepStrictEqual(src.map((s) => [s.cardId, s.amount]), [['BP01-054', 50], ['BP02-065', 50]]);
  assert.strictEqual(state.players.playerB.pendingAttackBoost, 100);
  attackWith(state, FILLER_ATTACK);
  assert.deepStrictEqual(state.players.playerB.pendingBoostSources, []);
  assert.strictEqual(state.players.playerB.pendingAttackBoost, 0);
});

// ============================================================
console.log('=== 〖アタックする〗ダメージ修正・条件 ===');
// ============================================================
test('インパクトショット+40 / だまし討ち+10', () => {
  let s = makeState(); attackWith(s, 'ST02-007'); assert.strictEqual(dmg(s), 70);
  s = makeState(); attackWith(s, 'BP01-023'); assert.strictEqual(dmg(s), 40);
});
test('アンストッパブル：3ラウンド目だけ+20', () => {
  let s = makeState(); attackWith(s, 'BP02-032'); assert.strictEqual(dmg(s), 30);
  s = makeState(); s.match.roundNumber = 3; attackWith(s, 'BP02-032'); assert.strictEqual(dmg(s), 50);
});
test('サイコフォートレス：アタッカーが覚醒していれば+10', () => {
  const s = makeState(); s.players.playerB.leaders[0].awakened = true;
  attackWith(s, 'BP02-018');
  assert.strictEqual(dmg(s), atk(s) + 10);
});
test('カウンターブロー：ダメージ-10。プレイエリアに他のカードがなければPPを1回復（実質コスト0）', () => {
  let s = makeState(); attackWith(s, 'BP02-029');
  assert.strictEqual(dmg(s), 20);
  assert.strictEqual(s.players.playerB.ppCards.tapped, 0);
  s = makeState(); playMemoria(s, MEMORIA_0); attackWith(s, 'BP02-029');
  assert.strictEqual(s.players.playerB.ppCards.tapped, 1, '他のカードがあるので回復しない');
});
test('短気な爆弾魔：このターンに手札を捨てていれば+10', () => {
  let s = makeState(); attackWith(s, 'BP03-025'); assert.strictEqual(dmg(s), 30);
  s = makeState(); toHand(s, 'playerB', FILLER_ATTACK);
  attackWith(s, 'BP01-020', { chooseAttackDiscard: (c) => [c[0].instanceId] }); // 大黒柱で1枚捨てる
  s.players.playerA.leaders[0].damage = 0;
  attackWith(s, 'BP03-025');
  assert.strictEqual(dmg(s), 40);
});

// ============================================================
console.log('=== 〖アタックする〗の選択・公開 ===');
// ============================================================
test('大黒柱：捨てる選択が無ければ+0、1枚捨てれば+20', () => {
  let s = makeState(); toHand(s, 'playerB', FILLER_ATTACK); attackWith(s, 'BP01-020');
  assert.strictEqual(dmg(s), 30); assert.strictEqual(s.players.playerB.hand.length, 1);
  s = makeState(); toHand(s, 'playerB', FILLER_ATTACK);
  attackWith(s, 'BP01-020', { chooseAttackDiscard: (c) => [c[0].instanceId] });
  assert.strictEqual(dmg(s), 50); assert.strictEqual(s.players.playerB.hand.length, 0);
});
test('大黒柱：アタックカード自身は捨てる候補に含まれない', () => {
  const s = makeState(); let seen = null;
  attackWith(s, 'BP01-020', { chooseAttackDiscard: (c) => { seen = c; return []; } });
  assert.strictEqual(seen, null, '手札が他に無いので質問自体が出ない');
});
test('CLUTCH!!!：コスト0のカードだけが候補。捨てたら1枚引いて+40', () => {
  const s = makeState(); toHand(s, 'playerB', MEMORIA_1); toHand(s, 'playerB', MEMORIA_0);
  let seen;
  attackWith(s, 'BP01-026', { chooseAttackDiscard: (c) => { seen = c.map((x) => x.cardId); return [c[0].instanceId]; } });
  assert.deepStrictEqual(seen, [MEMORIA_0]);
  assert.strictEqual(dmg(s), 70);
  assert.strictEqual(s.players.playerB.hand.length, 2, 'コスト1が残り＋1枚引いた');
});
test('仁義なき抗争：「はい」ならランダムに1枚捨てて+30', () => {
  const s = makeState(); toHand(s, 'playerB', FILLER_ATTACK); toHand(s, 'playerB', FILLER_ATTACK);
  attackWith(s, 'BP03-027', { chooseConfirm: () => true });
  assert.strictEqual(dmg(s), 60); assert.strictEqual(s.players.playerB.hand.length, 1);
});
test('オーバードライブ：捨てたアタック1枚につき+30、メモリア1枚につき2枚引く', () => {
  const s = makeState(); toHand(s, 'playerB', FILLER_ATTACK); toHand(s, 'playerB', MEMORIA_1);
  attackWith(s, 'BP04-024', { chooseAttackDiscard: (c, spec) => { assert.strictEqual(spec.max, 2); return c.map((x) => x.instanceId); } });
  assert.strictEqual(dmg(s), 60);
  assert.strictEqual(s.players.playerB.hand.length, 2);
});
test('神速フリック：相手のデッキの上がアタックなら+20（トラッシュへ）、天衣無縫はメモリアなら+20', () => {
  let s = makeState(); const oppDeck = s.players.playerA.deck.length;
  attackWith(s, 'BP01-030');
  assert.strictEqual(dmg(s), 50); assert.strictEqual(s.players.playerA.deck.length, oppDeck - 1);
  s = makeState(); attackWith(s, 'BP04-023'); assert.strictEqual(dmg(s), 30);
});
test('テラーエンゲージ：上から4枚のコストの種類×30。すべて異なればPPを1回復', () => {
  let s = makeState();
  s.players.playerB.deck = [MEMORIA_0, MEMORIA_1, MEMORIA_2, 'BP01-046'].map(inst).concat(s.players.playerB.deck);
  attackWith(s, 'BP04-031');
  assert.strictEqual(dmg(s), 30 + 120);
  assert.strictEqual(s.players.playerB.ppCards.tapped, 1, 'コスト2を払ってPP1回復');
  s = makeState(); attackWith(s, 'BP04-031'); // 全部コスト1のアタック
  assert.strictEqual(dmg(s), 60);
  assert.strictEqual(s.players.playerB.ppCards.tapped, 2);
});

// ============================================================
console.log('=== 〖アタック後〗 ===');
// ============================================================
test('バウンティーハンター：他のリーダー1体に40 / マルチグレネード：他のすべてに20', () => {
  let s = makeState(); attackWith(s, 'ST01-007'); assert.deepStrictEqual(others(s), [40, 0, 0]);
  s = makeState(); attackWith(s, 'ST02-011'); assert.deepStrictEqual(others(s), [20, 20, 20]);
});
test('ソニックチェイサー：ダメージを受けている他のリーダーにだけ20', () => {
  const s = makeState(); s.players.playerA.leaders[2].damage = 10;
  attackWith(s, 'BP03-031'); assert.deepStrictEqual(others(s), [0, 30, 0]);
});
test('カウンタースナイプ：手札2枚以下なら20、3枚なら何もしない', () => {
  let s = makeState(); attackWith(s, 'BP01-036'); assert.deepStrictEqual(others(s), [20, 0, 0]);
  s = makeState(); [1, 2, 3].forEach(() => toHand(s, 'playerB', FILLER_ATTACK)); attackWith(s, 'BP01-036'); assert.deepStrictEqual(others(s), [0, 0, 0]);
});
test('勝利の一撃：アタックを受けたリーダーがダウンしたら1枚引く', () => {
  const s = makeState(); s.players.playerA.leaders[0].damage = 90;
  attackWith(s, 'ST01-008'); assert.strictEqual(s.players.playerB.hand.length, 1);
});
test('頂きの景色：プレイエリアのメモリアのコスト合計だけ引く', () => {
  const s = makeState(); playMemoria(s, MEMORIA_1); playMemoria(s, MEMORIA_2);
  attackWith(s, 'BP03-024'); assert.strictEqual(s.players.playerB.hand.length, 3);
});

// ============================================================
console.log('=== メモリア・タクティクス ===');
// ============================================================
test('逃走成功：両プレイヤーが1枚引き、アタック強化+50', () => {
  const s = makeState(); playMemoria(s, 'BP01-061');
  assert.strictEqual(s.players.playerA.hand.length, 1); assert.strictEqual(s.players.playerB.hand.length, 1);
  assert.strictEqual(s.players.playerB.pendingAttackBoost, 50);
});
test('開店セレモニー：+20。メモリアが3枚以上なら（自身を含めて数える）さらに+50', () => {
  let s = makeState(); playMemoria(s, 'BP01-075'); assert.strictEqual(s.players.playerB.pendingAttackBoost, 20);
  s = makeState(); playMemoria(s, MEMORIA_0); playMemoria(s, MEMORIA_0); playMemoria(s, 'BP01-075');
  assert.strictEqual(s.players.playerB.pendingAttackBoost, 70);
});
test('福男：自分のリーダーが3体ダウンしているときだけ1枚引く', () => {
  let s = makeState(); playMemoria(s, 'BP01-073'); assert.strictEqual(s.players.playerB.hand.length, 0);
  s = makeState(); [1, 2, 3].forEach((i) => { s.players.playerB.leaders[i].isDown = true; });
  playMemoria(s, 'BP01-073'); assert.strictEqual(s.players.playerB.hand.length, 1);
});
test('マウントタックル：自身の〖アタック強化〗は次のアタックに乗る', () => {
  const s = makeState(); attackWith(s, 'BP02-043');
  assert.strictEqual(dmg(s), 30);
  assert.strictEqual(s.players.playerB.pendingAttackBoost, 20);
  s.players.playerA.leaders[0].damage = 0;
  attackWith(s, FILLER_ATTACK); assert.strictEqual(dmg(s), 50);
});
test('バックステージパス：+40。アタックする時点でアタッカーが装備していれば、さらに+20', () => {
  let s = makeState(); playMemoria(s, 'BP03-047'); attackWith(s, FILLER_ATTACK); assert.strictEqual(dmg(s), 70);
  s = makeState(); playMemoria(s, 'BP03-047');
  s.players.playerB.leaders[0].equipment.push(inst('BP01-095'));
  attackWith(s, FILLER_ATTACK); assert.strictEqual(dmg(s), 90);
});
test('運命のルーレット：宣言が当たれば4枚引く、外れたら公開したカードをトラッシュ', () => {
  let s = makeState(); playMemoria(s, 'BP01-068', { chooseDeclareCardType: () => 'ATTACK' });
  assert.strictEqual(s.players.playerB.hand.length, 4);
  s = makeState(); const deck = s.players.playerB.deck.length;
  playMemoria(s, 'BP01-068', { chooseDeclareCardType: () => 'MEMORIA' });
  assert.strictEqual(s.players.playerB.hand.length, 0); assert.strictEqual(s.players.playerB.deck.length, deck - 1);
});
test('気まずい空間：上から3枚をトラッシュへ', () => {
  const s = makeState(); const deck = s.players.playerB.deck.length;
  playMemoria(s, 'BP03-067'); assert.strictEqual(s.players.playerB.deck.length, deck - 3);
});
test('丸太椅子最：相手のリーダー1体に20', () => {
  const s = makeState(); playMemoria(s, 'BP01-087'); assert.strictEqual(dmg(s), 20);
});
test('アイテムショップ：裏向きのトラッシュをデッキに戻してシャッフルし、2枚引く', () => {
  const s = makeState(); const p = s.players.playerB;
  p.trash = [{ card: inst(FILLER_ATTACK), faceUp: false }, { card: inst(FILLER_ATTACK), faceUp: false }, { card: inst('BP01-095'), faceUp: true }];
  const deck = p.deck.length;
  const t = inst('BP04-076'); p.tacticsArea.push({ card: t });
  EffectResolver.playTacticsCardWithEffects(s, 'playerB', t.instanceId, { subType: 'CONSUMABLE' }, cardIndex);
  ResolutionStack.resolveAll(s.resolutionStack, s);
  assert.strictEqual(p.hand.length, 2);
  assert.strictEqual(p.deck.length, deck + 2 - 2);
  assert.strictEqual(p.trash.filter((x) => !x.faceUp).length, 0);
});
test('エリートコマンダー / ダイナミックデュオはエコーを持つ', () => {
  assert.ok(CardEffectData.hasKeyword('BP04-045', 'ECHO'));
  assert.ok(CardEffectData.hasKeyword('BP04-052', 'ECHO'));
});

// ============================================================
console.log('=== 同名カードによるコスト免除（壁ジャンプ・引っ張り合い・ロケットシャワー） ===');
// ============================================================
test('プレイエリアに同名がちょうど1枚ならコスト0、0枚・2枚ならコストを支払う', () => {
  const s = makeState();
  assert.strictEqual(EffectResolver.getEffectivePlayCost(s, 'playerB', 'BP01-022', cardIndex), 1);
  attackWith(s, 'BP01-022');
  assert.strictEqual(EffectResolver.getEffectivePlayCost(s, 'playerB', 'BP01-022', cardIndex), 0);
  attackWith(s, 'BP01-022');
  assert.strictEqual(s.players.playerB.ppCards.tapped, 1, '2枚目はコストなし');
  assert.strictEqual(EffectResolver.getEffectivePlayCost(s, 'playerB', 'BP01-022', cardIndex), 1, '2枚あるので払う');
});
test('引っ張り合い（メモリア）も同じ', () => {
  const s = makeState(); playMemoria(s, 'BP01-084'); playMemoria(s, 'BP01-084');
  assert.strictEqual(s.players.playerB.ppCards.tapped, 1);
  assert.strictEqual(s.players.playerB.pendingAttackBoost, 80);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
