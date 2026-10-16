#!/usr/bin/env node
/* おすすめデッキの自動探索（GitHub Actions で毎晩実行。Claude は使わない）
 *
 *  1. data/meta/pool.json の候補デッキを、data/meta/field.json の相手デッキ（環境）と CPU（強）同士で対戦させて勝率を測る
 *  2. 残り時間で、上位のデッキを1か所ずつ入れ替え（メイン2枚 or タクティクス1枚）、勝率が上がったものを候補に加える
 *     ふるい分け（相手1つにつき SCREEN 戦）→ 本番の確認（VERIFY 戦×2回、親と同じ乱数で比べる）を両方通ったものだけ採用
 *  3. data/meta/ranking.json（デッキビルダーの「おすすめ」に出す）と pool.json を書き出す
 *
 *  node scripts/meta/run.js [--minutes 300] [--workers N] [--screen 10] [--verify 30] [--keep 16] [--dry]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const R = path.join(__dirname, '..', '..');
const CardLookup = require(path.join(R, 'js/engine/cardLookup.js'));
const Rules = require(path.join(R, 'js/deckbuilder/rules.js'));
const DeckCode = require(path.join(R, 'js/deckbuilder/deckcode.js'));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const MINUTES = +opt('minutes', 300);
const WORKERS = +opt('workers', Math.max(1, os.cpus().length));
const SCREEN = +opt('screen', 10);
const VERIFY = +opt('verify', 30);
const KEEP = +opt('keep', 16);
const DRY = !!opt('dry', false);
const META = path.join(R, 'data/meta');
const T0 = Date.now();
const deadline = T0 + MINUTES * 60000;
const timeLeft = () => deadline - Date.now();
const RESERVE = Math.min(20 * 60000, MINUTES * 60000 * 0.1); // 書き出し・後片付け用に残す時間
const log = (...a) => console.log('[meta ' + ((Date.now() - T0) / 60000).toFixed(1) + 'm]', ...a);

const cardIndex = CardLookup.loadDefaultCardIndexNode();
const field = JSON.parse(fs.readFileSync(path.join(META, 'field.json'), 'utf8'));
let pool = JSON.parse(fs.readFileSync(path.join(META, 'pool.json'), 'utf8'));
// 前回の結果（時間切れで測れなかったデッキは前回の勝率を引き継ぐ。前回の上位から順に測る）
const prevRanking = fs.existsSync(path.join(META, 'ranking.json')) ? JSON.parse(fs.readFileSync(path.join(META, 'ranking.json'), 'utf8')) : { decks: [] };
const prevById = {};
(prevRanking.decks || []).forEach((d) => { prevById[d.id] = d; });

// 実行ごとに乱数を変える（同じ試合に合わせ込まないように）。同じ日に回し直したら同じ結果
const day = Math.floor(Date.now() / 86400000);
const SEED_A = (day % 10000) * 100000 + 11;
const SEED_B = SEED_A + 50000;

// ---------- デッキの扱い ----------
const expand = (d) => { const ids = []; d.cards.forEach((e) => { for (let i = 0; i < e.count; i++) ids.push(e.cardNumber); }); return ids; };
const compact = (ids) => { const m = {}; ids.forEach((x) => { m[x] = (m[x] || 0) + 1; }); return Object.keys(m).sort().map((k) => ({ cardNumber: k, count: m[k] })); };
const keyOf = (d) => d.leaders.slice().sort().join(',') + '|' + compact(expand(d)).map((e) => e.cardNumber + 'x' + e.count).join(',') + '|' + d.tactics.slice().sort().join(',');
const valid = (d) => Rules.validateDeck({ leaders: d.leaders, cards: d.cards, tactics: d.tactics }, cardIndex).valid;
const nameOf = (id) => (cardIndex[id] && cardIndex[id].name) || id;
const opponentsOf = (d) => { const k = keyOf(d); return field.filter((f) => keyOf(f) !== k); };

function eligiblePools(d) {
  const L = d.leaders.map((i) => cardIndex[i]);
  const ok = (c) => !c.ban && !c.isParallel && typeof c.cost === 'number' && Rules.evaluateEligibility(c, L).eligible === true;
  const all = Object.values(cardIndex);
  return {
    main: all.filter((c) => (c.cardType === 'ATTACK' || c.cardType === 'MEMORIA') && ok(c)).map((c) => c.cardNumber),
    tactics: all.filter((c) => c.cardType === 'TACTICS' && ok(c)).map((c) => c.cardNumber),
  };
}

// 1か所だけ変える：メインのあるカードを2枚（1枚しかなければ1枚）別のカードに、またはタクティクス1枚を別のものに
function mutate(d, rnd) {
  const pools = eligiblePools(d);
  for (let t = 0; t < 300; t++) {
    if (rnd() < 0.2) {
      const i = Math.floor(rnd() * d.tactics.length);
      const y = pools.tactics[Math.floor(rnd() * pools.tactics.length)];
      if (!y || d.tactics.some((x) => nameOf(x) === nameOf(y))) continue;
      const nd = { leaders: d.leaders.slice(), cards: d.cards.map((e) => Object.assign({}, e)), tactics: d.tactics.slice() };
      nd.tactics[i] = y;
      if (valid(nd)) return { deck: nd, change: 'タクティクス：' + nameOf(d.tactics[i]) + ' → ' + nameOf(y) };
    } else {
      const ids = expand(d);
      const x = ids[Math.floor(rnd() * ids.length)];
      const y = pools.main[Math.floor(rnd() * pools.main.length)];
      if (!y || nameOf(x) === nameOf(y)) continue;
      const k = Math.min(2, ids.filter((v) => v === x).length);
      for (let j = 0; j < k; j++) ids.splice(ids.indexOf(x), 1);
      for (let j = 0; j < k; j++) ids.push(y);
      const nd = { leaders: d.leaders.slice(), cards: compact(ids), tactics: d.tactics.slice() };
      if (valid(nd)) return { deck: nd, change: nameOf(x) + '×' + k + ' → ' + nameOf(y) + '×' + k };
    }
  }
  return null;
}

// ---------- 並列で対戦 ----------
const workers = [];
const idle = [];
const waiting = [];
const pending = new Map();
let jobSeq = 0;
for (let i = 0; i < WORKERS; i++) {
  const w = new Worker(path.join(__dirname, 'worker.js'));
  w.on('message', (m) => {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m);
    idle.push(w); pump();
  });
  w.on('error', (e) => { console.error(e); process.exit(1); });
  workers.push(w); idle.push(w);
}
function pump() { while (idle.length && waiting.length) { const job = waiting.shift(); const w = idle.shift(); pending.set(job.msg.id, job); w.postMessage(job.msg); } }
function series(me, opp, games, seed) {
  return new Promise((resolve, reject) => { waiting.push({ msg: { id: ++jobSeq, me, opp, games, seed }, resolve, reject }); pump(); });
}
// 相手デッキごとに games 戦。相手ごとに乱数をずらす（同じ相手なら親子で同じ乱数＝比べやすい）
async function evaluate(d, games, seed) {
  const opps = opponentsOf(d);
  const rs = await Promise.all(opps.map((o, oi) => series(d, o, games, seed + oi * 1009)));
  const per = {};
  let wins = 0, n = 0;
  rs.forEach((r, i) => { per[opps[i].name] = r.wins + '/' + r.games; wins += r.wins; n += r.games; });
  return { wins, games: n, rate: n ? wins / n : 0, per };
}

// ---------- 本体 ----------
(async () => {
  log('workers', WORKERS, 'minutes', MINUTES, 'pool', pool.length, 'field', field.length, 'seed', SEED_A);
  pool = pool.filter((d) => { const ok = valid(d); if (!ok) log('ルール違反のため除外:', d.name); return ok; });
  pool.sort((x, y) => ((prevById[y.id] && prevById[y.id].winRate) || 0) - ((prevById[x.id] && prevById[x.id].winRate) || 0));

  // 1. 全候補の勝率（VERIFY 戦 × 2つの乱数）
  for (const d of pool) {
    const a = await evaluate(d, VERIFY, SEED_A);
    const b = await evaluate(d, VERIFY, SEED_B);
    d.result = { wins: a.wins + b.wins, games: a.games + b.games, rate: (a.wins + b.wins) / (a.games + b.games), per: mergePer(a.per, b.per) };
    d._a = a; d._b = b; d.measuredAt = new Date().toISOString();
    log('評価', d.name, (d.result.rate * 100).toFixed(1) + '%');
    if (timeLeft() < RESERVE / 2) { log('時間切れのため評価を打ち切り'); break; }
  }
  pool.sort((x, y) => ((y.result && y.result.rate) || 0) - ((x.result && x.result.rate) || 0));

  // 2. 上位のデッキを少しずつ入れ替えて、強くなったものを候補に加える
  let seed = SEED_A + 1;
  const rnd = mulberry(SEED_A);
  const tried = new Set(pool.map(keyOf));
  let round = 0, accepted = 0;
  while (timeLeft() > RESERVE) {
    const tops = pool.filter((d) => d.result).slice(0, 3);
    if (!tops.length) break;
    const parent = tops[round++ % tops.length];
    const m = mutate(parent, rnd);
    if (!m) continue;
    const k = keyOf(m.deck);
    if (tried.has(k)) continue;
    tried.add(k);
    seed += 7;
    const [cs, ps] = await Promise.all([evaluate(m.deck, SCREEN, seed * 13), evaluate(parent, SCREEN, seed * 13)]);
    if (cs.wins < ps.wins + 3) continue;
    // 本番の確認：親と同じ乱数で2回（親の結果は手順1のものを使う）
    const ca = await evaluate(m.deck, VERIFY, SEED_A);
    if (ca.wins <= parent._a.wins) { log('不採用（確認1）', m.change); continue; }
    const cb = await evaluate(m.deck, VERIFY, SEED_B);
    const cw = ca.wins + cb.wins, pw = parent._a.wins + parent._b.wins;
    if (cw < pw + Math.ceil(0.015 * (ca.games + cb.games))) { log('不採用（確認2）', m.change); continue; }
    accepted++;
    const child = {
      id: parent.id.replace(/~\d+$/, '') + '~' + (Date.now() % 100000000),
      name: nextChildName(parent.name),
      origin: 'auto', parent: parent.name, change: (parent.change ? parent.change + ' ／ ' : '') + m.change,
      leaders: m.deck.leaders, cards: m.deck.cards, tactics: m.deck.tactics,
      result: { wins: cw, games: ca.games + cb.games, rate: cw / (ca.games + cb.games), per: mergePer(ca.per, cb.per) }, _a: ca, _b: cb, measuredAt: new Date().toISOString(),
    };
    pool.push(child);
    pool.sort((x, y) => ((y.result && y.result.rate) || 0) - ((x.result && x.result.rate) || 0));
    log('採用', child.name, m.change, (parent.result.rate * 100).toFixed(1) + '% → ' + (child.result.rate * 100).toFixed(1) + '%');
  }

  // 3. 書き出し。ユーザー・環境のデッキは残し、自動で作ったデッキは上位だけ残す
  // 時間切れで測れなかったデッキは前回の結果を引き継ぐ（候補からは消さない）
  pool.forEach((d) => {
    if (d.result || !prevById[d.id]) return;
    const pr = prevById[d.id];
    d.result = { rate: pr.winRate / 100, games: pr.games, per: pr.perOpponent, carried: true };
    d.measuredAt = pr.measuredAt || prevRanking.updatedAt;
  });
  pool.sort((x, y) => ((y.result && y.result.rate) || 0) - ((x.result && x.result.rate) || 0));
  const autoRanked = pool.filter((d) => d.origin === 'auto' && d.result);
  const autoKept = autoRanked.slice(0, KEEP);
  const newPool = pool.filter((d) => d.origin !== 'auto' || !d.result || autoKept.indexOf(d) >= 0);
  const ranking = {
    updatedAt: new Date().toISOString(),
    minutes: Math.round((Date.now() - T0) / 60000),
    gamesPerOpponent: VERIFY * 2,
    field: field.map((f) => f.name),
    note: 'CPU（強）同士の対戦シミュレーションでの勝率。人間が使ったときの強さとはずれることがある',
    decks: newPool.filter((d) => d.result).map((d, i) => ({
      rank: i + 1, id: d.id, name: d.name, origin: d.origin, parent: d.parent || null, change: d.change || null,
      winRate: Math.round(d.result.rate * 1000) / 10, games: d.result.games, perOpponent: d.result.per, measuredAt: d.measuredAt || null,
      leaders: d.leaders, leaderNames: d.leaders.map(nameOf),
      code: DeckCode.encode({ name: d.name, leaders: d.leaders, cards: d.cards, tactics: d.tactics }),
    })),
  };
  const cleanPool = newPool.map((d) => { const o = Object.assign({}, d); delete o.result; delete o._a; delete o._b; delete o.measuredAt; return o; });
  if (!DRY) {
    fs.writeFileSync(path.join(META, 'ranking.json'), JSON.stringify(ranking, null, 1) + '\n');
    fs.writeFileSync(path.join(META, 'pool.json'), JSON.stringify(cleanPool, null, 1) + '\n');
  }
  log('完了：採用', accepted, '件、上位', ranking.decks.slice(0, 3).map((d) => d.name + ' ' + d.winRate + '%').join(' / '));
  workers.forEach((w) => w.terminate());
})().catch((e) => { console.error(e); process.exit(1); });

function nextChildName(parentName) {
  const base = parentName.replace(/ 改\d*$/, '');
  let n = 0;
  pool.forEach((d) => { const m = d.name.match(/ 改(\d+)$/); if (m && d.name.replace(/ 改\d+$/, '') === base) n = Math.max(n, +m[1]); });
  return base + ' 改' + (n + 1);
}
function mergePer(a, b) {
  const out = {};
  Object.keys(a).forEach((k) => {
    const [w1, n1] = a[k].split('/').map(Number);
    const [w2, n2] = (b[k] || '0/0').split('/').map(Number);
    out[k] = (w1 + w2) + '/' + (n1 + n2);
  });
  return out;
}
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
