/* オンライン対戦の前提（2台で同じ手順を再生すれば同じ盤面になる）の自動テスト（node test/online.test.js で実行）
 *
 * js/battle/app.js のオンライン対戦は、盤面そのものではなく「行動・乱数のシード・選択の答え」だけを送り、
 * 相手の端末で同じ手順を再生する。これが成り立つには、エンジンが
 *   ・インスタンスIDの採番を揃え（GameState.resetInstanceIds）
 *   ・乱数を同じシードにすれば（Math.randomの差し替え）
 * 同じ結果になる必要がある。CPU同士の試合を記録し、別の状態から再生し直して毎手の盤面のハッシュが一致することを確かめる。
 */
const assert = require('assert');
const CardLookup = require('../js/engine/cardLookup.js');
const GameState = require('../js/engine/gameState.js');
const ResolutionStack = require('../js/engine/resolutionStack.js');
const Match = require('../js/engine/match.js');
const EffectResolver = require('../js/engine/effectResolver.js');
const Choices = require('../js/battle/choices.js');
const Cpu = require('../js/battle/cpu.js');
const Online = require('../js/battle/online.js').XS_BATTLE_ONLINE;

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

function withSeed(seed, fn) {
  const orig = Math.random;
  Math.random = Choices.seededRandom(seed);
  try { return fn(); } finally { Math.random = orig; }
}

const leaders = allCards.filter((c) => c.cardType === 'LEADER' && !c.isParallel);
const pool = allCards.filter((c) => ['ATTACK', 'MEMORIA'].includes(c.cardType) && !c.ban && !c.isParallel && typeof c.cost === 'number');
const tacticsPool = allCards.filter((c) => c.cardType === 'TACTICS' && !c.ban && !c.isParallel && typeof c.cost === 'number');
function makeConfig(seed) {
  return withSeed(seed, () => {
    const pickN = (arr, n) => { const a = arr.slice(); const out = []; while (out.length < n) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]); return out; };
    const deck = () => {
      const names = {};
      const ls = pickN(leaders, 20).filter((l) => (names[l.name] ? false : (names[l.name] = true))).slice(0, 4).map((l) => l.cardNumber);
      return { leaderCardIds: ls, deckCardIds: Array.from({ length: 50 }, () => pool[Math.floor(Math.random() * pool.length)].cardNumber), tacticsDeckCardIds: pickN(tacticsPool, 5).map((c) => c.cardNumber) };
    };
    return { matchId: 'online-test', mode: 'STANDARD', firstPlayer: 'playerA', ppTicketCardId: 'ST01-024', playerA: deck(), playerB: deck() };
  });
}

// app.js の actionFn と同じ手順
function actionFn(desc) {
  const startTurn = (s, cb) => { EffectResolver.runStartPhaseWithEffects(s, cardIndex, cb); ResolutionStack.resolveAll(s.resolutionStack, s); };
  const finish = (s, cb) => {
    if (s.match.status === 'FINISHED') return;
    const r = EffectResolver.processRoundEndWithEffects(s);
    if (r.roundEnded && !r.matchEnded) startTurn(s, cb);
  };
  return (s, cb, ask) => {
    if (desc.t === 'ATTACK') { EffectResolver.playAttackCardWithEffects(s, desc.pid, desc.id, Object.assign({}, desc.opt, cb), cardIndex); finish(s, cb); }
    else if (desc.t === 'MEMORIA') { EffectResolver.playMemoriaCardWithEffects(s, desc.pid, desc.id, Object.assign({}, cb), cardIndex); finish(s, cb); }
    else if (desc.t === 'TACTICS') { EffectResolver.playTacticsCardWithEffects(s, desc.pid, desc.id, Object.assign({ subType: desc.sub, equipLeaderIndex: desc.eq }, cb), cardIndex); finish(s, cb); }
    else {
      EffectResolver.runEndPhaseWithEffects(s, Choices.makeHandLimitChooser(ask, s.turn.activePlayer));
      if (s.match.status === 'FINISHED') return;
      EffectResolver.endTurnAndSwitchWithEffects(s);
      startTurn(s, cb);
    }
  };
}

function begin(config, seed) {
  GameState.resetInstanceIds();
  return withSeed(seed, () => {
    const s = Match.createMatch(config);
    EffectResolver.runStartPhaseWithEffects(s, cardIndex, {});
    ResolutionStack.resolveAll(s.resolutionStack, s);
    return s;
  });
}

// 1台目：CPUが操作し、行動・シード・答えを記録する（app.js の performAction/stepChoice と同じ方式）
function record(config, seed, rnd) {
  let state = begin(config, seed);
  const history = [];
  const hashes = [];
  let excluded = {};
  let key = null;
  for (let step = 0; step < 3000 && state.match.status !== 'FINISHED'; step++) {
    const pid = state.turn.activePlayer;
    const k = state.match.roundNumber + ':' + state.turn.turnNumber;
    if (k !== key) { key = k; excluded = {}; }
    const act = Cpu.decideAction(state, pid, cardIndex, null, excluded);
    const desc = act.type === 'END' ? { t: 'END' }
      : act.type === 'ATTACK' ? { t: 'ATTACK', pid, id: act.instanceId, opt: act.options }
        : act.type === 'MEMORIA' ? { t: 'MEMORIA', pid, id: act.instanceId }
          : { t: 'TACTICS', pid, id: act.instanceId, sub: act.subType, eq: act.equipLeaderIndex };
    const actSeed = Math.floor(rnd() * 4294967296);
    const answers = [];
    let r;
    try {
      for (let guard = 0; guard < 50; guard++) {
        r = Choices.runWithAnswers(state, actSeed, answers, (st, ask) => actionFn(desc)(st, Choices.makeCallbacks(ask, { getActivePlayerId: () => st.turn.activePlayer, getResolvingEffect: EffectResolver.getResolvingEffect }), ask));
        if (r.done) break;
        answers.push(Cpu.answerQuestion(r.question, r.state, r.question.chooser || r.state.turn.activePlayer, cardIndex));
      }
    } catch (e) {
      excluded[desc.id] = true;
      continue;
    }
    state = r.state;
    history.push({ desc, seed: actSeed, answers: answers.slice() });
    hashes.push(Online.stateHash(state));
  }
  return { state, history, hashes };
}

// 2台目：記録を受け取って同じ手順を再生する
function replay(config, seed, history) {
  let state = begin(config, seed);
  return history.map((h) => {
    const r = Choices.runWithAnswers(state, h.seed, h.answers, (st, ask) => actionFn(h.desc)(st, Choices.makeCallbacks(ask, { getActivePlayerId: () => st.turn.activePlayer, getResolvingEffect: EffectResolver.getResolvingEffect }), ask));
    assert.ok(r.done, '再生中に答えの無い質問が出た');
    state = r.state;
    return Online.stateHash(state);
  });
}

test('同じ設定・シード・行動を再生すると、毎手の盤面が一致する（3試合）', () => {
  for (let m = 1; m <= 3; m++) {
    const config = makeConfig(100 + m);
    const seed = 777 * m;
    const rec = record(config, seed, Choices.seededRandom(m));
    assert.strictEqual(rec.state.match.status, 'FINISHED', '試合が終わっていない');
    // 別の端末を想定して、関係ないカードを作ってインスタンスIDの採番をずらしてから再生する
    for (let i = 0; i < 37; i++) GameState.createCardInstance('BP01-046');
    const hashes = replay(config, seed, JSON.parse(JSON.stringify(rec.history)));
    const firstDiff = hashes.findIndex((h, i) => h !== rec.hashes[i]);
    assert.strictEqual(firstDiff, -1, '試合' + m + 'の' + firstDiff + '手目でずれた');
    assert.strictEqual(hashes.length, rec.history.length);
  }
});

test('シードが違えば盤面は変わる（ハッシュが盤面の違いを検出できる）', () => {
  const config = makeConfig(5);
  assert.notStrictEqual(Online.stateHash(begin(config, 1)), Online.stateHash(begin(config, 2)));
});

test('部屋コードは8文字の英小文字と数字', () => {
  const code = Online.randomCode();
  assert.ok(/^[a-z0-9]{8}$/.test(code), code);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
