/* デッキ構築ルールの自動テスト（依存ライブラリなし。 node test/deckRules.test.js で実行）*/
const assert = require('assert');
const path = require('path');
const RULES = require('../js/deckbuilder/rules.js');
const cards = require('../data/cards.json');

const cardIndex = {};
cards.forEach((c) => { cardIndex[c.cardNumber] = c; });

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

// --- テスト用の固定編成: 第1弾 赤3+青1 のリーダー ---
const LEADERS_4 = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-005']; // うるか/小森めと/橘ひなの(赤) + Kamito(青)
function baseDeck(overrides) {
  return Object.assign({ leaders: LEADERS_4.slice(), cards: [], tactics: [] }, overrides);
}

function fillMainDeck(count, pickFn) {
  // 適当な赤カードを積み増して合計count枚にする（同名4枚制限に注意して複数カードに分散）。
  // 同名4枚制限はカード名基準なので、収録弾違いの重複カード名（例: BP01-019とST02-007は
  // 共に「インパクトショット」という同一カードの別収録）を二重に数えないよう、カード名
  // 単位で1つずつしか採用しない。
  const redNonAce = cards.filter((c) => c.color === 'red' && (c.cardType === 'ATTACK' || c.cardType === 'MEMORIA') && !c.ban && !c.buildRule && c.ace !== true);
  const entries = [];
  const usedGroups = {};
  let remaining = count;
  let i = 0;
  while (remaining > 0 && i < redNonAce.length) {
    const card = redNonAce[i];
    const groupKey = card.name;
    i++;
    if (usedGroups[groupKey]) continue;
    usedGroups[groupKey] = true;
    const take = Math.min(4, remaining);
    entries.push({ cardNumber: card.cardNumber, count: take });
    remaining -= take;
  }
  if (remaining > 0) throw new Error('not enough distinct red cards in fixture data to build test deck');
  return pickFn ? pickFn(entries) : entries;
}

const FULL_50 = fillMainDeck(50);
const FULL_TACTICS = (() => {
  const t = cards.filter((c) => c.cardType === 'TACTICS' && !c.ban).slice(0, 5);
  assert.strictEqual(t.length, 5, 'need 5 non-ban tactics cards in fixture data');
  return t.map((c) => c.cardNumber);
})();

console.log('=== リーダー枚数 ===');
test('リーダー4枚未満 → NG', () => {
  const r = RULES.validateDeck(baseDeck({ leaders: LEADERS_4.slice(0, 3), cards: FULL_50, tactics: FULL_TACTICS }), cardIndex);
  assert.ok(!r.valid);
  assert.ok(r.violations.some((v) => v.includes('リーダーが4枚必要')));
});
test('リーダー4枚 → OK（リーダー条件のみ）', () => {
  const r = RULES.validateDeck(baseDeck({ cards: FULL_50, tactics: FULL_TACTICS }), cardIndex);
  assert.strictEqual(r.summary.leaderCount, 4);
});
test('同じリーダー2枚 → NG', () => {
  const r = RULES.validateDeck(baseDeck({ leaders: ['BP01-001', 'BP01-001', 'BP01-002', 'BP01-005'], cards: FULL_50, tactics: FULL_TACTICS }), cardIndex);
  assert.ok(!r.valid);
  assert.ok(r.violations.some((v) => v.includes('重複')));
});

console.log('=== デッキ枚数 ===');
test('50枚未満 → NG', () => {
  const r = RULES.validateDeck(baseDeck({ cards: fillMainDeck(49), tactics: FULL_TACTICS }), cardIndex);
  assert.ok(!r.valid);
  assert.ok(r.violations.some((v) => v.includes('デッキは50枚必要')));
});
test('50枚 → OK', () => {
  const r = RULES.validateDeck(baseDeck({ cards: FULL_50, tactics: FULL_TACTICS }), cardIndex);
  assert.strictEqual(r.summary.mainCount, 50);
  assert.ok(!r.violations.some((v) => v.includes('デッキは50枚必要')));
});
test('51枚 → NG', () => {
  const over = FULL_50.slice();
  const extra = cards.find((c) => c.color === 'red' && c.cardType === 'MEMORIA' && !c.ban && !c.buildRule && c.ace !== true && !over.some((e) => e.cardNumber === c.cardNumber));
  over.push({ cardNumber: extra.cardNumber, count: 1 });
  const r = RULES.validateDeck(baseDeck({ cards: over, tactics: FULL_TACTICS }), cardIndex);
  assert.ok(!r.valid);
  assert.ok(r.violations.some((v) => v.includes('デッキは50枚必要')));
});

console.log('=== 同名制限 ===');
test('同名5枚 → NG', () => {
  const target = cards.find((c) => c.color === 'red' && c.cardType === 'ATTACK' && !c.ban);
  const deckCards = fillMainDeck(45).concat([{ cardNumber: target.cardNumber, count: 5 }]);
  const r = RULES.validateDeck(baseDeck({ cards: deckCards, tactics: FULL_TACTICS }), cardIndex);
  assert.ok(!r.valid);
  assert.ok(r.violations.some((v) => v.includes('最大4枚')));
});

console.log('=== ACE制限 ===');
test('ACE8枚 → OK', () => {
  const aceCards = cards.filter((c) => c.ace === true && c.color === 'red' && !c.ban).slice(0, 2);
  assert.ok(aceCards.length >= 2, 'need >=2 distinct red ACE cards in fixture');
  const deckCards = [
    { cardNumber: aceCards[0].cardNumber, count: 4 },
    { cardNumber: aceCards[1].cardNumber, count: 4 },
  ].concat(fillMainDeck(42));
  const r = RULES.validateDeck(baseDeck({ cards: deckCards, tactics: FULL_TACTICS }), cardIndex);
  assert.strictEqual(r.summary.aceCount, 8);
  assert.ok(!r.violations.some((v) => v.includes('ACEカードが')));
});
test('ACE9枚 → NG', () => {
  const aceCards = cards.filter((c) => c.ace === true && c.color === 'red' && !c.ban).slice(0, 3);
  assert.ok(aceCards.length >= 3, 'need >=3 distinct red ACE cards in fixture');
  const deckCards = [
    { cardNumber: aceCards[0].cardNumber, count: 4 },
    { cardNumber: aceCards[1].cardNumber, count: 4 },
    { cardNumber: aceCards[2].cardNumber, count: 1 },
  ].concat(fillMainDeck(41));
  const r = RULES.validateDeck(baseDeck({ cards: deckCards, tactics: FULL_TACTICS }), cardIndex);
  assert.strictEqual(r.summary.aceCount, 9);
  assert.ok(r.violations.some((v) => v.includes('ACEカードが9枚')));
});

console.log('=== BAN判定 ===');
test('BANカード → NG', () => {
  const banned = cards.find((c) => c.ban === true && c.cardType === 'TACTICS');
  assert.ok(banned, 'need a banned tactics card in fixture (エナジーチャージャー)');
  const tacticsWithBan = FULL_TACTICS.slice(0, 4).concat([banned.cardNumber]);
  const r = RULES.validateDeck(baseDeck({ cards: FULL_50, tactics: tacticsWithBan }), cardIndex);
  assert.ok(!r.valid);
  assert.ok(r.violations.some((v) => v.includes('BANされています')));
});

console.log('=== 色判定 ===');
test('色外カード → NG', () => {
  const greenCard = cards.find((c) => c.color === 'green' && c.cardType === 'MEMORIA' && !c.buildRule && !c.ban);
  const deckCards = fillMainDeck(46).concat([{ cardNumber: greenCard.cardNumber, count: 4 }]);
  const r = RULES.validateDeck(baseDeck({ cards: deckCards, tactics: FULL_TACTICS }), cardIndex);
  assert.ok(!r.valid, 'green card should be rejected when leaders are red/blue only');
  assert.ok(r.violations.some((v) => v.includes(greenCard.name) && v.includes('一致しません')));
});

console.log('=== ビルドルール判定 ===');
test('ビルドルールを満たす → OK（リーダー：Selly 系）', () => {
  // 壁ジャンプ(BP01-022) buildRule: リーダー：Selly。SellyをLEADERS_4に含める編成でテスト
  const withSelly = ['BP01-001', 'BP01-002', 'BP01-003', 'ST02-001']; // Selly
  const card = cardIndex['BP01-022'];
  assert.strictEqual(card.buildRuleParsed.kind, 'LEADER_NAME');
  const result = RULES.evaluateBuildRule(card, withSelly.map((n) => cardIndex[n]));
  assert.strictEqual(result.status, 'OK');
});
test('ビルドルールを満たさない → NG（リーダー：Selly系、Sellyがいない編成）', () => {
  const card = cardIndex['BP01-022'];
  const result = RULES.evaluateBuildRule(card, LEADERS_4.map((n) => cardIndex[n]));
  assert.strictEqual(result.status, 'FAIL');
  assert.ok(result.reason.includes('Selly'));
});
test('色数ビルドルール（赤のリーダー3体以上）を満たす → OK', () => {
  const card = cardIndex['BP01-018']; // エレガントドミネート: 赤のリーダー3体以上
  const threeRed = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-005']; // 赤3+青1
  const result = RULES.evaluateBuildRule(card, threeRed.map((n) => cardIndex[n]));
  assert.strictEqual(result.status, 'OK');
});
test('色数ビルドルールを満たさない → NG', () => {
  const card = cardIndex['BP01-018'];
  const twoRed = ['BP01-001', 'BP01-002', 'BP01-005', 'BP01-006']; // 赤2+青2
  const result = RULES.evaluateBuildRule(card, twoRed.map((n) => cardIndex[n]));
  assert.strictEqual(result.status, 'FAIL');
});

console.log('=== タクティクス ===');
test('タクティクス5枚 → OK', () => {
  const r = RULES.validateDeck(baseDeck({ cards: FULL_50, tactics: FULL_TACTICS }), cardIndex);
  assert.strictEqual(r.summary.tacticsCount, 5);
  assert.ok(!r.violations.some((v) => v.includes('タクティクスデッキは5枚')));
});
test('タクティクス同名重複 → NG', () => {
  const dup = FULL_TACTICS.slice(0, 4).concat([FULL_TACTICS[0]]);
  const r = RULES.validateDeck(baseDeck({ cards: FULL_50, tactics: dup }), cardIndex);
  assert.ok(!r.valid);
  assert.ok(r.violations.some((v) => v.includes('重複しています（同名不可）')));
});

console.log('=== 総合 ===');
test('全条件を満たす完全なデッキ → valid=true', () => {
  const r = RULES.validateDeck(baseDeck({ cards: FULL_50, tactics: FULL_TACTICS }), cardIndex);
  if (!r.valid) console.log('     violations:', r.violations);
  assert.strictEqual(r.valid, true);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
