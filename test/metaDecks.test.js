/* おすすめデッキの自動探索（scripts/meta）用データの自動テスト（node test/metaDecks.test.js で実行）
 *  data/meta/field.json（環境）・pool.json（候補）のデッキがルールを満たすこと、ranking.json があれば形がそろっていること
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CardLookup = require('../js/engine/cardLookup.js');
const Rules = require('../js/deckbuilder/rules.js');
const DeckCode = require('../js/deckbuilder/deckcode.js');

const cardIndex = CardLookup.loadDefaultCardIndexNode();
const META = path.join(__dirname, '..', 'data', 'meta');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok -', name); } catch (e) { failed++; console.log('  FAIL -', name); console.log('       ', e.message); } }
const read = (f) => JSON.parse(fs.readFileSync(path.join(META, f), 'utf8'));

test('環境（field.json）のデッキはすべてルールを満たし、名前が重ならない', () => {
  const field = read('field.json');
  assert.ok(field.length >= 3);
  const names = new Set();
  field.forEach((d) => {
    const v = Rules.validateDeck({ leaders: d.leaders, cards: d.cards, tactics: d.tactics }, cardIndex);
    assert.ok(v.valid, d.name + ': ' + v.violations.join(' / '));
    assert.ok(!names.has(d.name), '名前の重複: ' + d.name);
    names.add(d.name);
  });
});
test('候補（pool.json）のデッキはすべてルールを満たし、idが重ならない', () => {
  const pool = read('pool.json');
  const ids = new Set();
  pool.forEach((d) => {
    const v = Rules.validateDeck({ leaders: d.leaders, cards: d.cards, tactics: d.tactics }, cardIndex);
    assert.ok(v.valid, d.name + ': ' + v.violations.join(' / '));
    assert.ok(d.id && !ids.has(d.id), 'idの重複・未設定: ' + d.id);
    ids.add(d.id);
    assert.ok(['auto', 'claude', 'user', 'field'].indexOf(d.origin) >= 0, d.name + ' の origin');
  });
});
test('ranking.json があれば、各デッキのコードを読み込める', () => {
  if (!fs.existsSync(path.join(META, 'ranking.json'))) return;
  const r = read('ranking.json');
  assert.ok(r.updatedAt && Array.isArray(r.decks));
  r.decks.forEach((d, i) => {
    assert.strictEqual(d.rank, i + 1);
    assert.ok(d.winRate >= 0 && d.winRate <= 100);
    const deck = DeckCode.decode(d.code);
    assert.deepStrictEqual(deck.leaders, d.leaders);
    const v = Rules.validateDeck(deck, cardIndex);
    assert.ok(v.valid, d.name + ': ' + v.violations.join(' / '));
  });
  for (let i = 1; i < r.decks.length; i++) assert.ok(r.decks[i - 1].winRate >= r.decks[i].winRate, '勝率の高い順');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
