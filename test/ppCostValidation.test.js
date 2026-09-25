/* PPコスト未確定カードの誤った無料プレイを防ぐ回帰テスト (node test/ppCostValidation.test.js で実行)
 *
 * 背景: data/source/all-cards.json由来のcostがnull（公式ページ未確認等で未確定）のカードを、
 * js/engine/phases.js・effectResolver.jsが「card.cost || 0」として扱っていたため、
 * コスト不明カードが常にコスト0としてプレイでき、実質PPをほとんど使わずに何枚も連続プレイ
 * できてしまう不具合が対戦ログから見つかった（例: 1ターンで5枚プレイしてPP消費はわずか2）。
 * 修正: Phases.requireKnownCost(card) を新設し、cost が number でないカードは明確な
 * エラーでプレイを拒否する（推測で0扱いにしない）。
 */
const assert = require('assert');
const GameState = require('../js/engine/gameState.js');
const Phases = require('../js/engine/phases.js');
const Match = require('../js/engine/match.js');
const CardLookup = require('../js/engine/cardLookup.js');

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
const PP_TICKET = 'ST01-024';
const KNOWN_COST_ATTACK = allCards.find((c) => c.cardType === 'ATTACK' && typeof c.cost === 'number' && !c.ban).cardNumber;
const UNKNOWN_COST_CARD = allCards.find((c) => (c.cardType === 'ATTACK' || c.cardType === 'MEMORIA') && c.cost == null && !c.ban);
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
      deckCardIds: fillDeck(KNOWN_COST_ATTACK, 50),
      tacticsDeckCardIds: TACTICS_5,
    },
    playerB: {
      leaderCardIds: LEADERS_B,
      deckCardIds: fillDeck(KNOWN_COST_ATTACK, 50),
      tacticsDeckCardIds: TACTICS_5_B,
    },
  }, overrides);
}

function injectHand(state, playerId, cardId) {
  const instance = GameState.createCardInstance(cardId);
  state.players[playerId].hand.push(instance);
  return instance.instanceId;
}

console.log('前提: このデータセットには現時点でコスト未確定（null）のカードが存在するか ->', !!UNKNOWN_COST_CARD);

test('コストが判明しているカードは通常どおりPPを消費してプレイできる', () => {
  const state = Match.createMatch(makeMatchConfig());
  const instanceId = injectHand(state, 'playerA', KNOWN_COST_ATTACK);
  const cost = cardIndex[KNOWN_COST_ATTACK].cost;
  const ppBefore = state.players.playerA.ppCards.max - state.players.playerA.ppCards.tapped;
  Phases.playAttackCard(state, 'playerA', instanceId, {
    attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 0,
  }, cardIndex);
  const ppAfter = state.players.playerA.ppCards.max - state.players.playerA.ppCards.tapped;
  assert.strictEqual(ppAfter, ppBefore - cost);
});

if (UNKNOWN_COST_CARD) {
  test('コスト未確定（null）のカードはATTACKとしてプレイできず、明確なエラーになる（コスト0として無料プレイされない）', () => {
    if (UNKNOWN_COST_CARD.cardType !== 'ATTACK') return; // このケースはMEMORIA側の同名テストでカバーする
    const state = Match.createMatch(makeMatchConfig());
    const instanceId = injectHand(state, 'playerA', UNKNOWN_COST_CARD.cardNumber);
    const handBefore = state.players.playerA.hand.length;
    const ppBefore = state.players.playerA.ppCards.max - state.players.playerA.ppCards.tapped;
    assert.throws(() => {
      Phases.playAttackCard(state, 'playerA', instanceId, {
        attackerLeaderIndex: 0, targetPlayerId: 'playerB', targetLeaderIndex: 0, attackCardBaseDamage: 0,
      }, cardIndex);
    }, /コストが未確定/);
    const ppAfter = state.players.playerA.ppCards.max - state.players.playerA.ppCards.tapped;
    assert.strictEqual(ppAfter, ppBefore, 'エラーになった時点でPPは消費されていないはず');
    assert.strictEqual(state.players.playerA.hand.length, handBefore, '手札からも取り除かれていないはず');
  });

  test('コスト未確定（null）のカードはMEMORIAとしてもプレイできず、明確なエラーになる', () => {
    const memoriaCard = allCards.find((c) => c.cardType === 'MEMORIA' && c.cost == null && !c.ban);
    if (!memoriaCard) return;
    const state = Match.createMatch(makeMatchConfig());
    const instanceId = injectHand(state, 'playerA', memoriaCard.cardNumber);
    const ppBefore = state.players.playerA.ppCards.max - state.players.playerA.ppCards.tapped;
    assert.throws(() => {
      Phases.playMemoriaCard(state, 'playerA', instanceId, {}, cardIndex);
    }, /コストが未確定/);
    const ppAfter = state.players.playerA.ppCards.max - state.players.playerA.ppCards.tapped;
    assert.strictEqual(ppAfter, ppBefore);
  });
} else {
  console.log('  (skip) 現在のデータセットにコスト未確定カードが存在しないため、該当テストはスキップ');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
