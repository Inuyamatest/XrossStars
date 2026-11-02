/* 第5弾のビルドルールの無いカード・再録カードの自動テスト（node test/bp05Generic.test.js で実行）
 *  恐怖の一突き・怒涛の勢い・最後の祈り・インプレッシブコール・キャプテンズ・リターン・二連覇の称号 ほか、再録（パラレル扱い）
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
const Cpu = require('../js/battle/cpu.js');

const cardIndex = CardLookup.loadDefaultCardIndexNode();
const allCards = Object.values(cardIndex);
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok -', name); } catch (e) { failed++; console.log('  FAIL -', name); console.log('       ', e.message); } }

const SELF = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004'];
const OPP = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];
SELF.concat(OPP).forEach((id) => { delete CardEffectData.REGISTRY[id]; }); // リーダーの覚醒時効果が混ざらないように
const plainCard = require('./helpers/plainCard.js')(allCards, CardEffectData, __filename);
const FILLER = plainCard((c) => c.cardType === 'ATTACK' && c.cost === 1);
const COST2 = plainCard((c) => c.cardType === 'MEMORIA' && c.cost === 2);
const TACTICS_5 = ['BP01-089', 'BP01-090', 'BP01-091', 'BP01-092', 'BP01-095'];
function makeState() {
  const s = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: 'ST01-024',
    playerA: { leaderCardIds: OPP, deckCardIds: new Array(50).fill(FILLER), tacticsDeckCardIds: TACTICS_5 },
    playerB: { leaderCardIds: SELF, deckCardIds: new Array(50).fill(FILLER), tacticsDeckCardIds: TACTICS_5 },
  });
  s.turn.activePlayer = 'playerB'; s.turn.turnNumber = 2;
  ['playerA', 'playerB'].forEach((p) => { s.players[p].hand = []; s.players[p].ppCards.max = 10; s.players[p].ppCards.tapped = 0; });
  return s;
}
const inst = (id) => GameState.createCardInstance(id);
function toHand(s, id) { const c = inst(id); s.players.playerB.hand.push(c); return c.instanceId; }
const cb = { chooseTarget: () => 0, chooseHealTarget: () => 0, chooseDiscard: (cands, n) => cands.slice(0, n).map((c) => c.instanceId) };
function attack(s, id, extra) {
  const iid = toHand(s, id);
  EffectResolver.playAttackCardWithEffects(s, 'playerB', iid, Object.assign({ attackerLeaderIndex: 0, targetPlayerId: 'playerA', targetLeaderIndex: 0 }, cb, extra || {}), cardIndex);
  ResolutionStack.resolveAll(s.resolutionStack, s);
}
function memoria(s, id, extra) {
  const iid = toHand(s, id);
  EffectResolver.playMemoriaCardWithEffects(s, 'playerB', iid, Object.assign({}, cb, extra || {}), cardIndex);
  ResolutionStack.resolveAll(s.resolutionStack, s);
}
const dmg = (s) => s.players.playerA.leaders.map((l) => l.damage);
const atk0 = (s) => GameState.getLeaderCurrentAtk(cardIndex, s.players.playerB.leaders[0]);

console.log('=== 登録・画像 ===');
test('新しいカード12枚・PPカード・再録7枚にデータと画像があり、効果のあるカードは効果も登録されている', () => {
  ['BP05-019', 'BP05-026', 'BP05-033', 'BP05-040', 'BP05-046', 'BP05-047', 'BP05-053', 'BP05-054', 'BP05-060', 'BP05-061', 'BP05-067', 'BP05-068',
    'BP05-018', 'BP05-025', 'BP05-032', 'BP05-039', 'BP05-073', 'BP05-074', 'BP05-075', 'BP05-080'].forEach((id) => {
    const c = cardIndex[id];
    assert.ok(c, id);
    assert.ok(c.imageUrl && fs.existsSync(path.join(__dirname, '..', c.imageUrl)), id + ' の画像');
    if (c.cardType !== 'PP') assert.ok(CardEffectData.hasEffects(id), id + ' の効果');
  });
});
test('再録カードは元のカードと同名・同じ効果・ビルドルール（同名4枚までに一緒に数えられる）', () => {
  [['BP05-018', 'BP01-018'], ['BP05-025', 'BP01-027'], ['BP05-032', 'BP01-037'], ['BP05-039', 'BP01-045'], ['BP05-073', 'BP01-095'], ['BP05-074', 'BP04-076'], ['BP05-075', 'ST01-022']].forEach(([n, base]) => {
    assert.strictEqual(cardIndex[n].name, cardIndex[base].name, n);
    assert.strictEqual(cardIndex[n].buildRule, cardIndex[base].buildRule, n);
    assert.deepStrictEqual(CardEffectData.getEffectsForCard(n), CardEffectData.getEffectsForCard(base), n);
  });
});
test('第5弾リーダーの覚醒後の画像（渋谷ハル (IGV)・tttcheekyttt・Ras (IGV) を追加）', () => {
  ['BP05-L07', 'BP05-L08', 'BP05-L12'].forEach((id) => {
    const c = cardIndex[id];
    assert.ok(c.imageUrlAwakened && c.imageUrlAwakened !== c.imageUrl, id);
    assert.ok(fs.existsSync(path.join(__dirname, '..', c.imageUrlAwakened)), id);
  });
});

console.log('=== アタック ===');
test('恐怖の一突き：プレイエリアにコスト2のカードがあるときだけ、他のリーダー1体に20ダメージ', () => {
  const a = makeState();
  attack(a, 'BP05-019');
  const base = atk0(a);
  assert.deepStrictEqual(dmg(a), [base, 0, 0, 0], 'コスト2が無ければ追加ダメージなし');
  const b = makeState();
  b.players.playerB.playArea.push({ card: inst(COST2), order: 0, pendingTriggers: [] });
  attack(b, 'BP05-019');
  assert.strictEqual(dmg(b)[0], base);
  assert.strictEqual(dmg(b).slice(1).reduce((x, y) => x + y, 0), 20, '他のリーダー1体に20');
});
test('決闘開始：ダメージ+40／怒涛の勢い：メモリア2枚以上ならダメージ+50', () => {
  const a = makeState(); const base = atk0(a);
  attack(a, 'BP05-033'); assert.strictEqual(dmg(a)[0], base + 40);
  const b = makeState(); attack(b, 'BP05-040'); assert.strictEqual(dmg(b)[0], base, 'メモリアなし');
  const c = makeState();
  c.players.playerB.playArea.push({ card: inst('BP05-046'), order: 0, pendingTriggers: [] }, { card: inst('BP05-053'), order: 1, pendingTriggers: [] });
  attack(c, 'BP05-040'); assert.strictEqual(dmg(c)[0], base + 50);
});
test('パーフェクトクローザー：アタッカーが覚醒していればダメージ+10', () => {
  const a = makeState(); const base = atk0(a);
  attack(a, 'BP05-026'); assert.strictEqual(dmg(a)[0], base);
  const b = makeState(); b.players.playerB.leaders[0].awakened = true; const awk = atk0(b);
  attack(b, 'BP05-026'); assert.strictEqual(dmg(b)[0], awk + 10);
});

console.log('=== メモリア ===');
test('ナイトウォーカー等：次のアタック+50', () => {
  ['BP05-046', 'BP05-053', 'BP05-060', 'BP05-067'].forEach((id) => {
    const s = makeState(); const base = atk0(s);
    memoria(s, id); attack(s, FILLER);
    assert.strictEqual(dmg(s)[0], base + 50, id);
  });
});
test('最後の祈り：2枚引いて2枚捨て、次のアタック+30', () => {
  const s = makeState(); const base = atk0(s);
  toHand(s, FILLER); toHand(s, FILLER);
  memoria(s, 'BP05-047');
  assert.strictEqual(s.players.playerB.hand.length, 2, '2枚引いて2枚捨てる');
  attack(s, FILLER);
  assert.strictEqual(dmg(s)[0], base + 30);
});
test('インプレッシブコール：+40、アタッカーが装備していればさらに+20（アタックのときに確認）', () => {
  const a = makeState(); const base = atk0(a);
  memoria(a, 'BP05-054'); attack(a, FILLER); assert.strictEqual(dmg(a)[0], base + 40);
  const b = makeState();
  memoria(b, 'BP05-054');
  b.players.playerB.leaders[0].equipment.push(inst('BP03-079')); // 装備（攻撃力・体力は変えないターゲットフラッグ）
  attack(b, FILLER); assert.strictEqual(dmg(b)[0], base + 60);
});
test('キャプテンズ・リターン：手札のコスト3以下を公開したら、そのコストと同じ数を引く（公開しなくてもよい）', () => {
  const s = makeState();
  toHand(s, COST2);
  memoria(s, 'BP05-061', { chooseRevealCard: (cands) => [cands[0].instanceId] });
  assert.strictEqual(s.players.playerB.hand.length, 3, '公開したカードは手札に残り、2枚引く');
  const t = makeState();
  toHand(t, COST2);
  memoria(t, 'BP05-061', { chooseRevealCard: () => [] });
  assert.strictEqual(t.players.playerB.hand.length, 1, '公開しなければ引かない');
});
test('キャプテンズ・リターン：CPUは一番コストの高いカードを公開する（コスト0だけなら公開しない）', () => {
  const s = makeState();
  const q = { kind: 'REVEAL_FOR_DRAW', type: 'CARDS', cards: [{ cardId: 'BP05-068', cost: 0 }, { cardId: COST2, cost: 2 }, { cardId: FILLER, cost: 1 }], min: 0, max: 1 };
  assert.deepStrictEqual(Cpu.answerQuestion(q, s, 'playerB', cardIndex), [1]);
  assert.deepStrictEqual(Cpu.answerQuestion(Object.assign({}, q, { cards: [{ cardId: 'BP05-068', cost: 0 }] }), s, 'playerB', cardIndex), []);
});
test('二連覇の称号（コスト0）：自分のリーダー1体を10回復、次のアタック+10', () => {
  const s = makeState(); const base = atk0(s);
  s.players.playerB.leaders[0].damage = 30;
  memoria(s, 'BP05-068');
  assert.strictEqual(s.players.playerB.leaders[0].damage, 20);
  attack(s, FILLER);
  assert.strictEqual(dmg(s)[0], base + 10);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
