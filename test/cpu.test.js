/* CPU（js/battle/cpu.js）の自動テスト（node test/cpu.test.js で実行）
 *
 * 対象:
 *  - decideAction: 倒せる相手を狙う／強化メモリアをアタックの前に使う／PPが無ければターン終了
 *  - answerQuestion: 選択画面の各種質問に、条件を満たす答えを返す
 *  - CPU同士でランダムなデッキの試合を最後まで行える（エラー・無限ループが無い）
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const GameState = require('../js/engine/gameState.js');
const ResolutionStack = require('../js/engine/resolutionStack.js');
const Match = require('../js/engine/match.js');
const CardEffectData = require('../js/engine/cardEffectData.js');
const EffectResolver = require('../js/engine/effectResolver.js');
const Choices = require('../js/battle/choices.js');
const Cpu = require('../js/battle/cpu.js');

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

// 乱数を固定して、試合のシミュレーションを毎回同じ結果にする
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const leaders = allCards.filter((c) => c.cardType === 'LEADER' && !c.isParallel);
const mainPool = allCards.filter((c) => ['ATTACK', 'MEMORIA'].includes(c.cardType) && !c.ban && !c.isParallel && typeof c.cost === 'number');
const tacticsPool = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban && !c.isParallel && typeof c.cost === 'number');
function pick(arr, n, rnd) { const a = arr.slice(); const out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; }
function randomDeck(rnd) {
  const names = {};
  const ls = pick(leaders, 12, rnd).filter((l) => (names[l.name] ? false : (names[l.name] = true))).slice(0, 4).map((l) => l.cardNumber);
  const cards = [];
  while (cards.length < 50) cards.push(mainPool[Math.floor(rnd() * mainPool.length)].cardNumber);
  return { leaders: ls, cards, tactics: pick(tacticsPool, 5, rnd).map((c) => c.cardNumber) };
}

// CPU同士の1試合（画面の app.js と同じ順番でエンジンを呼ぶ）
function simulateMatch(seed) {
  const rnd = seeded(seed);
  const orig = Math.random;
  Math.random = rnd;
  const stats = { attacks: 0, memorias: 0, tactics: 0, errors: [], questions: 0 };
  try {
    const A = randomDeck(rnd);
    const B = randomDeck(rnd);
    const state = Match.createMatch({
      matchId: 'cpu', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: 'ST01-024',
      playerA: { leaderCardIds: A.leaders, deckCardIds: A.cards, tacticsDeckCardIds: A.tactics },
      playerB: { leaderCardIds: B.leaders, deckCardIds: B.cards, tacticsDeckCardIds: B.tactics },
    });
    const ask = (q) => {
      stats.questions++;
      const a = Cpu.answerQuestion(q, state, q.chooser || state.turn.activePlayer, cardIndex);
      if (q.type !== 'ALLOCATE' && q.type !== 'OPTIONS' || q.type === 'OPTIONS') {
        const v = Choices.validateSelection(q, a, cardIndex);
        if (!v.ok) throw new Error('CPUの答えが条件を満たしていない: ' + q.title + ' ' + JSON.stringify(a));
      }
      return a;
    };
    const cb = Choices.makeCallbacks(ask, { getActivePlayerId: () => state.turn.activePlayer, getResolvingEffect: EffectResolver.getResolvingEffect });
    const startTurn = () => { EffectResolver.runStartPhaseWithEffects(state, cardIndex, cb); ResolutionStack.resolveAll(state.resolutionStack, state); };
    startTurn();
    let turns = 0;
    while (state.match.status !== 'FINISHED' && turns < 400) {
      turns++;
      const pid = state.turn.activePlayer;
      const excluded = {};
      let roundEnded = false;
      for (let step = 0; step < 30 && state.match.status !== 'FINISHED'; step++) {
        const act = Cpu.decideAction(state, pid, cardIndex, null, excluded);
        if (act.type === 'END') break;
        try {
          if (act.type === 'ATTACK') { EffectResolver.playAttackCardWithEffects(state, pid, act.instanceId, Object.assign({}, act.options, cb), cardIndex); stats.attacks++; }
          else if (act.type === 'MEMORIA') { EffectResolver.playMemoriaCardWithEffects(state, pid, act.instanceId, Object.assign({}, cb), cardIndex); stats.memorias++; }
          else { EffectResolver.playTacticsCardWithEffects(state, pid, act.instanceId, Object.assign({ subType: act.subType, equipLeaderIndex: act.equipLeaderIndex }, cb), cardIndex); stats.tactics++; }
        } catch (e) {
          if (/CPUの答え/.test(e.message)) throw e;
          stats.errors.push(e.message);
          excluded[act.instanceId] = true;
          continue;
        }
        if (state.match.status === 'FINISHED') break;
        const r = EffectResolver.processRoundEndWithEffects(state);
        if (r.roundEnded) { if (!r.matchEnded) startTurn(); roundEnded = true; break; }
      }
      if (roundEnded || state.match.status === 'FINISHED') continue;
      EffectResolver.runEndPhaseWithEffects(state, Choices.makeHandLimitChooser(ask, pid));
      if (state.match.status === 'FINISHED') break;
      EffectResolver.endTurnAndSwitchWithEffects(state);
      startTurn();
    }
    return { state, stats, turns };
  } finally {
    Math.random = orig;
  }
}

const OPP = ['BP01-005', 'BP01-006', 'BP01-007', 'BP01-008'];
const SELF = ['BP01-001', 'BP01-002', 'BP01-003', 'BP01-004'];
function makeState() {
  const filler = 'BP01-046';
  const state = Match.createMatch({
    matchId: 't', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: 'ST01-024',
    playerA: { leaderCardIds: SELF, deckCardIds: new Array(50).fill(filler), tacticsDeckCardIds: [] },
    playerB: { leaderCardIds: OPP, deckCardIds: new Array(50).fill(filler), tacticsDeckCardIds: [] },
  });
  state.players.playerA.hand = [];
  state.players.playerA.ppCards.max = 3;
  state.players.playerA.ppCards.tapped = 0;
  return state;
}
function hand(state, id) { const c = GameState.createCardInstance(id); state.players.playerA.hand.push(c); return c.instanceId; }

// ============================================================
console.log('=== 1手の判断 ===');
// ============================================================
test('倒せる相手がいれば、その相手を狙う', () => {
  const s = makeState();
  hand(s, 'ST02-007'); // インパクトショット +40（攻撃力30なら70）
  s.players.playerB.leaders[2].damage = GameState.getLeaderMaxHp(cardIndex, s.players.playerB.leaders[2]) - 60;
  const act = Cpu.decideAction(s, 'playerA', cardIndex);
  assert.strictEqual(act.type, 'ATTACK');
  assert.strictEqual(act.options.targetLeaderIndex, 2);
});
test('アタックのPPを残せるなら、強化メモリアを先に使う', () => {
  const s = makeState();
  hand(s, 'ST02-007'); // コスト2
  const mem = hand(s, 'BP01-054'); // 胴だよ胴！ コスト1 +50
  const act = Cpu.decideAction(s, 'playerA', cardIndex);
  assert.strictEqual(act.type, 'MEMORIA');
  assert.strictEqual(act.instanceId, mem);
});
test('強化メモリアを使うとアタックできなくなるなら、アタックを優先する', () => {
  const s = makeState();
  s.players.playerA.ppCards.max = 2;
  hand(s, 'ST02-007'); hand(s, 'BP01-054');
  assert.strictEqual(Cpu.decideAction(s, 'playerA', cardIndex).type, 'ATTACK');
});
test('PPが足りなければターン終了', () => {
  const s = makeState();
  s.players.playerA.ppCards.tapped = 3;
  hand(s, 'ST02-007');
  assert.strictEqual(Cpu.decideAction(s, 'playerA', cardIndex).type, 'END');
});
test('失敗したカードは同じターンに選び直さない', () => {
  const s = makeState();
  const id = hand(s, 'ST02-007');
  assert.strictEqual(Cpu.decideAction(s, 'playerA', cardIndex, null, { [id]: true }).type, 'END');
});

// ============================================================
console.log('=== 選択画面への回答 ===');
// ============================================================
test('相手のリーダーを選ぶ質問では、残り体力が一番少ないリーダー', () => {
  const s = makeState();
  s.players.playerB.leaders[3].damage = 70;
  const q = { type: 'LEADERS', kind: 'TARGET', min: 1, max: 1, candidates: [0, 1, 2, 3].map((i) => ({ playerId: 'playerB', leaderIndex: i })) };
  assert.deepStrictEqual(Cpu.answerQuestion(q, s, 'playerA', cardIndex), [3]);
});
test('手札を捨てる質問では、コストの低いカードから指定枚数', () => {
  const s = makeState();
  const q = { type: 'CARDS', kind: 'DISCARD', min: 2, max: 2, cards: [{ cardId: 'BP01-046' }, { cardId: 'BP01-054' }, { cardId: 'BP05-059' }] };
  const a = Cpu.answerQuestion(q, s, 'playerA', cardIndex);
  assert.deepStrictEqual(a.sort(), [1, 2]);
});
test('運命のルーレットの宣言は、自分のデッキに多い方のカードタイプ', () => {
  const s = makeState(); // デッキは全部アタックカード
  const q = { type: 'OPTIONS', kind: 'DECLARE_TYPE', options: [{ label: 'メモリアカード', value: 'MEMORIA' }, { label: 'アタックカード', value: 'ATTACK' }] };
  assert.deepStrictEqual(Cpu.answerQuestion(q, s, 'playerA', cardIndex), [1]);
});

// ============================================================
console.log('=== CPU同士の試合 ===');
// ============================================================
test('ランダムなデッキで10試合、すべて最後まで終わり、CPUはアタックしている', () => {
  let totalAttacks = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const r = simulateMatch(seed);
    assert.strictEqual(r.state.match.status, 'FINISHED', 'seed ' + seed + ' が終わらない（' + r.turns + 'ターン）');
    assert.ok(r.stats.attacks > 0, 'seed ' + seed + ' でアタックしていない');
    totalAttacks += r.stats.attacks;
  }
  assert.ok(totalAttacks > 50);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
