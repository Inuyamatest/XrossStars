/* CPU（js/battle/cpu.js）の自動テスト（node test/cpu.test.js で実行）
 *
 * 対象:
 *  - decideAction: 倒せる相手を狙う／強化メモリアをアタックの前に使う／PPが無ければターン終了
 *  - answerQuestion: 選択画面の各種質問に、条件を満たす答えを返す
 *  - CPU同士でランダムなデッキの試合を最後まで行える（エラー・無限ループが無い）
 *  - 強さ（弱・中・強）: 弱/強の1手も正しい手になっている・強は中より勝ち、中は弱より勝つ
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
function simulateMatch(seed, levels) {
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
        const act = Cpu.decideAction(state, pid, cardIndex, levels ? { level: levels[pid], random: rnd } : null, excluded);
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
// 頂点捕食者の捨て札：BP04-053 穏やかな一時(0) / BP04-063 気合十分(1) / BP01-019 インパクトショット(2) / BP04-108 アナイアレーション(2, ACE)
const apexQ = (ids) => ({ type: 'CARDS', kind: 'APEX_DISCARD', min: 0, max: ids.length, costMin: 2, cards: ids.map((cardId) => ({ cardId })) });
function apexHand(s, ids) { s.players.playerA.hand = []; ids.forEach((id) => hand(s, id)); return apexQ(ids); }
test('頂点捕食者の捨て札：コスト2のカードがあれば、それ1枚だけ捨てる（安いカードを何枚も捨てない）', () => {
  const s = makeState();
  const q = apexHand(s, ['BP04-053', 'BP04-063', 'BP04-063', 'BP01-019']);
  assert.deepStrictEqual(Cpu.answerQuestion(q, s, 'playerA', cardIndex), [3]);
});
test('頂点捕食者の捨て札：手札がコスト2の1枚だけでも捨てる（1枚捨てて1枚プレイ）', () => {
  const s = makeState();
  const q = apexHand(s, ['BP01-019']);
  assert.deepStrictEqual(Cpu.answerQuestion(q, s, 'playerA', cardIndex), [0]);
});
test('頂点捕食者の捨て札：エースより普通のカードを捨てる', () => {
  const s = makeState();
  const q = apexHand(s, ['BP04-108', 'BP04-063', 'BP01-019']);
  assert.deepStrictEqual(Cpu.answerQuestion(q, s, 'playerA', cardIndex), [2]);
});
test('頂点捕食者の捨て札：コスト1を2枚捨てるのは手札が3枚以上のときだけ。コスト0は捨てない', () => {
  const s = makeState();
  assert.deepStrictEqual(Cpu.answerQuestion(apexHand(s, ['BP04-063', 'BP04-063']), s, 'playerA', cardIndex), []);
  const a = Cpu.answerQuestion(apexHand(s, ['BP04-053', 'BP04-063', 'BP04-063']), s, 'playerA', cardIndex);
  assert.deepStrictEqual(a.sort(), [1, 2]);
});
test('三銃士でプレイし直すメモリアは、プレイ時にダメージを与えるものを優先し、プレイ時効果の無いものは選ばない', () => {
  const s = makeState();
  // 美味しいよね（アタック強化のみ）／穏やかな一時（プレイ時：回復）／BEAUTY SALON（プレイ時：20ダメージ）
  const q = { type: 'CARDS', kind: 'FREE_PLAY', replay: true, min: 0, max: 2, cards: [{ cardId: 'BP02-056' }, { cardId: 'BP04-053' }, { cardId: 'BP01-070' }] };
  assert.deepStrictEqual(Cpu.answerQuestion(q, s, 'playerA', cardIndex), [2, 1]);
  const q2 = { type: 'CARDS', kind: 'FREE_PLAY', replay: true, min: 0, max: 2, cards: [{ cardId: 'BP02-056' }] };
  assert.deepStrictEqual(Cpu.answerQuestion(q2, s, 'playerA', cardIndex), []);
});
test('運もミスもない：エースは残す。同じ種類が手札に十分あればトラッシュに置く', () => {
  const s = makeState();
  const q = (id) => ({ type: 'CARDS', kind: 'LOOK_TOP_TRASH', min: 0, max: 1, cards: [{ cardId: id }] });
  assert.deepStrictEqual(Cpu.answerQuestion(q('BP05-024'), s, 'playerA', cardIndex), []); // エース
  s.players.playerA.hand = [];
  ['BP04-063', 'BP04-063'].forEach((id) => hand(s, id)); // メモリア2枚
  assert.deepStrictEqual(Cpu.answerQuestion(q('BP02-053'), s, 'playerA', cardIndex), [0]); // メモリアは置く
  assert.deepStrictEqual(Cpu.answerQuestion(q('BP01-028'), s, 'playerA', cardIndex), []); // アタックは残す
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

// ============================================================
console.log('=== CPUの強さ（弱・中・強） ===');
// ============================================================
test('強：倒せる相手がいれば、その相手を狙う', () => {
  const s = makeState();
  hand(s, 'ST02-007');
  s.players.playerB.leaders[2].damage = GameState.getLeaderMaxHp(cardIndex, s.players.playerB.leaders[2]) - 60;
  const act = Cpu.decideAction(s, 'playerA', cardIndex, { level: 'HARD' });
  assert.strictEqual(act.type, 'ATTACK');
  assert.strictEqual(act.options.targetLeaderIndex, 2);
});
test('強：PPが足りなければターン終了。考えるときに元の盤面を変えない', () => {
  const s = makeState();
  hand(s, 'ST02-007'); hand(s, 'BP01-054');
  const before = JSON.stringify(s);
  assert.notStrictEqual(Cpu.decideAction(s, 'playerA', cardIndex, { level: 'HARD' }).type, 'END');
  assert.strictEqual(JSON.stringify(s), before);
  s.players.playerA.ppCards.tapped = 3;
  assert.strictEqual(Cpu.decideAction(s, 'playerA', cardIndex, { level: 'HARD' }).type, 'END');
});
test('弱：何度選ばせても、手札・PPの範囲の手かターン終了', () => {
  const s = makeState();
  const ids = [hand(s, 'ST02-007'), hand(s, 'BP01-054'), hand(s, 'BP01-046')];
  const rnd = seeded(7);
  for (let i = 0; i < 200; i++) {
    const act = Cpu.decideAction(s, 'playerA', cardIndex, { level: 'EASY', random: rnd });
    if (act.type === 'END') continue;
    assert.ok(ids.includes(act.instanceId));
    if (act.type === 'ATTACK') assert.ok(act.options.targetLeaderIndex >= 0 && act.options.targetLeaderIndex < 4);
  }
});
test('強：デッキ・裏向きのトラッシュ・タクティクスデッキが尽きているなら、PPを残して終了フェイズのドローで負けるより、PPを使い切る', () => {
  const s = makeState();
  const p = s.players.playerA;
  p.deck = [];
  p.trash = [];
  p.tacticsDeck = [];
  p.ppCards.max = 2;
  hand(s, 'ST02-007'); // インパクトショット（コスト2）
  const act = Cpu.decideAction(s, 'playerA', cardIndex, { level: 'HARD' });
  assert.strictEqual(act.type, 'ATTACK');
});
test('強：ラウンドの終わりが近い盤面（相手の残り1体・体力わずか）でも手を返し、倒せるならアタックする', () => {
  const s = makeState();
  const leaders = s.players.playerB.leaders;
  const hpOf = (l) => GameState.getLeaderMaxHp(cardIndex, l);
  const act1 = Cpu.decideAction(s, 'playerA', cardIndex, { level: 'HARD' });
  // 相手のリーダーが残り1体・体力わずかな状況でも、正しく手を返す（例外にならない）
  leaders.forEach((l, i) => { if (i > 0) { l.isDown = true; l.damage = hpOf(l); } else l.damage = hpOf(l) - 20; });
  hand(s, 'ST02-007');
  const act2 = Cpu.decideAction(s, 'playerA', cardIndex, { level: 'HARD' });
  assert.ok(act1 && act2);
  assert.strictEqual(act2.type, 'ATTACK'); // 倒せば勝ち：アタックする
});
test('ラウンド開始時のタクティクス：1ラウンド目は体力を増やす装備（サイバネアーマー等）を選ぶ', () => {
  const s = makeState();
  s.match.roundNumber = 1;
  const cards = ['BP01-093', 'BP04-073', 'ST02-022'].map((id) => ({ instanceId: 'x' + id, cardId: id })); // ジャミングパルス・サイバネアーマー・特殊弾
  const a = Cpu.answerQuestion({ type: 'CARDS', kind: 'SET_TACTICS', cards, min: 1, max: 1 }, s, 'playerA', cardIndex);
  assert.strictEqual(cards[a[0]].cardId, 'BP04-073');
});
test('ラウンド開始時のタクティクス：復活ポータル（条件付き）は1ラウンド目に選ばない', () => {
  const s = makeState();
  s.match.roundNumber = 1;
  const cards = ['BP01-094', 'ST02-022'].map((id) => ({ instanceId: 'x' + id, cardId: id }));
  const a = Cpu.answerQuestion({ type: 'CARDS', kind: 'SET_TACTICS', cards, min: 1, max: 1 }, s, 'playerA', cardIndex);
  assert.strictEqual(cards[a[0]].cardId, 'ST02-022');
});
test('1枚だけタダでプレイする選択（頂点捕食者の山札から等）では、コストの一番高いカードを選ぶ', () => {
  const s = makeState();
  const cards = ['BP01-046', 'ST02-007', 'AN01-005'].map((id) => ({ instanceId: 'x' + id, cardId: id }));
  const a = Cpu.answerQuestion({ type: 'CARDS', kind: 'FREE_PLAY', cards, min: 0, max: 1, preselect: [0] }, s, 'playerA', cardIndex);
  assert.strictEqual(a.length, 1);
  const costs = cards.map((c) => cardIndex[c.cardId].cost);
  assert.strictEqual(costs[a[0]], Math.max(...costs));
});
test('強さの順：強は中に、中は弱に勝ち越す（同じデッキで席を入れ替えて各12試合）', () => {
  function series(strong, weak) {
    let wins = 0;
    for (let i = 0; i < 12; i++) {
      const swap = i % 2 === 1;
      const levels = swap ? { playerA: weak, playerB: strong } : { playerA: strong, playerB: weak };
      const r = simulateMatch(500 + Math.floor(i / 2), levels);
      assert.strictEqual(r.state.match.status, 'FINISHED');
      if (r.state.match.winner === (swap ? 'playerB' : 'playerA')) wins++;
    }
    return wins;
  }
  const hn = series('HARD', 'NORMAL');
  const ne = series('NORMAL', 'EASY');
  assert.ok(hn >= 7, '強 vs 中 ' + hn + '/12');
  assert.ok(ne >= 7, '中 vs 弱 ' + ne + '/12');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
