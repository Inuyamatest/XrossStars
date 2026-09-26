/* Xross Stars 対戦UI — CPU（コンピューター対戦相手）
 *
 * 画面側（js/battle/app.js）は、CPUの手番のあいだ次の2つを呼ぶだけでよい:
 *   decideAction(state, playerId, cardIndex, helpers) … 次に行う1手（カードのプレイ／ターン終了）を決める
 *   answerQuestion(question, state, playerId, cardIndex) … 効果の選択画面（js/battle/choices.js の質問）にCPUが答える
 *
 * 方針（シンプルな「その場で一番よさそうな手」を選ぶ貪欲法。先読みはしない）:
 *   1. コスト0で効果のあるメモリア／タクティクスは先に使う
 *   2. アタックできるなら、その前にアタック強化（メモリア・消費タクティクス）と装備を、アタックのPPを残せる範囲で使う
 *   3. アタックは「倒せる相手を優先（残り体力が多い相手ほど価値が高い）、倒せなければ与えるダメージが大きく、
 *      残り体力が少ない相手」を選ぶ。アタッカーは同じ条件で一番ダメージが出るリーダー
 *   4. アタックできないときは、ドロー・回復・ダメージなど強化以外の効果を持つカードを使う
 *   5. 何もできなければターン終了（残ったPPはドローになる）
 * 手札・デッキの中身はCPU自身のものだけを見る（相手の非公開情報は使わない）。
 *
 * 強さ（helpers.level）:
 *   'EASY'   … 弱：使えるカード・アタックの対象をランダムに選び、途中でターンを終えることもある
 *   'NORMAL' … 中：上の貪欲法（既定）
 *   'HARD'   … 強：使える手をすべて盤面のコピーで試し、そのターンの残りを「中」の方針で最後まで進めて
 *               （終了フェイズのドローまで含めて）盤面を点数化し、一番点数の高い手を選ぶ
 *   ※「強」も相手の手札・山札の中身は見ない（シミュレーションで引くカードは自分の山札から）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('../engine/gameState.js'),
      require('../engine/phases.js'),
      require('../engine/cardEffectData.js'),
      require('../engine/effectResolver.js'),
      require('./choices.js')
    );
  } else {
    root.XS_BATTLE_CPU = factory(root.XS_ENGINE_STATE, root.XS_ENGINE_PHASES, root.XS_ENGINE_CARD_EFFECT_DATA, root.XS_ENGINE_EFFECT_RESOLVER, root.XS_BATTLE_CHOICES);
  }
}(typeof self !== 'undefined' ? self : this, function (GameState, Phases, CardEffectData, Resolver, Choices) {
  'use strict';

  var EQUIP_ACTION_TYPES = ['EQUIP_HP_MODIFIER', 'EQUIP_ATK_MODIFIER', 'EQUIP_GRANT_ABILITY', 'EQUIP_BASE_HP_OVERRIDE', 'EQUIP_TARGET_FLAG'];

  function effectsOf(cardId) { return CardEffectData.getEffectsForCard(cardId); }
  function boostAmountOf(cardId) {
    return effectsOf(cardId).reduce(function (s, e) {
      return (e.trigger === 'ATTACK_BOOST' && e.modifier) ? s + (e.modifier.amount || 0) : s;
    }, 0);
  }
  // 強化以外の「使うだけで得をする」効果（ドロー・回復・ダメージ等）を持つか
  function hasUtilityEffect(cardId) {
    return effectsOf(cardId).some(function (e) {
      return (e.trigger === 'ON_PLAY' && !(e.action && EQUIP_ACTION_TYPES.indexOf(e.action.type) >= 0)) ||
        (e.trigger === 'AFTER_ATTACK');
    });
  }
  function isEquipmentByEffects(cardId) {
    return effectsOf(cardId).some(function (e) { return e.action && EQUIP_ACTION_TYPES.indexOf(e.action.type) >= 0; });
  }

  function ppLeft(player) { return player.ppCards.max - player.ppCards.tapped; }
  function aliveIndexes(player) {
    return player.leaders.map(function (l, i) { return l.isDown ? -1 : i; }).filter(function (i) { return i >= 0; });
  }

  // アタック1回分の予想ダメージ（攻撃力＋カードの上乗せ＋次のアタックへの強化）
  function estimateAttack(state, playerId, cardId, attackerIndex, targetIndex, cardIndex) {
    var player = state.players[playerId];
    var oppId = GameState.getOpponentId(playerId);
    var ctx = {
      ownerPlayerId: playerId, attackerPlayerId: playerId, attackerLeaderIndex: attackerIndex,
      targetPlayerId: oppId, targetLeaderIndex: targetIndex, cardIndex: cardIndex,
    };
    var target = state.players[oppId].leaders[targetIndex];
    var hp = GameState.getLeaderCurrentHp(cardIndex, target);
    var downs = effectsOf(cardId).some(function (e) {
      return e.trigger === 'ON_ATTACK' && e.action && e.action.type === 'DOWN_TARGET' && (!e.condition || e.condition(state, ctx));
    });
    var atk = GameState.getLeaderCurrentAtk(cardIndex, player.leaders[attackerIndex]);
    var base = Resolver.computeAttackCardBaseDamage(cardId, state, ctx);
    var boost = (player.pendingAttackBoost || 0) + Resolver.computeAttackTimeBoost(state, playerId, ctx);
    var count = Resolver.getMultiAttackCount(cardId) || 1;
    var dmg = downs ? hp : Math.max(0, atk + base) * count + boost;
    return { damage: dmg, hp: hp, kill: dmg >= hp };
  }

  function scoreAttack(est, cost, cardId, attacker) {
    var s = est.kill ? 500 + est.hp : est.damage + (120 - est.hp) * 0.3;
    if (est.kill && !attacker.awakened) s += 40; // ダウンを取ると覚醒できる
    if (effectsOf(cardId).some(function (e) { return e.trigger === 'AFTER_ATTACK'; })) s += 15;
    return s - cost * 4;
  }

  function bestAttack(state, playerId, cardIndex, excluded) {
    var player = state.players[playerId];
    var opp = state.players[GameState.getOpponentId(playerId)];
    var pp = ppLeft(player);
    var best = null;
    player.hand.forEach(function (c) {
      if (excluded[c.instanceId]) return;
      var card = cardIndex[c.cardId];
      if (!card || card.cardType !== 'ATTACK') return;
      var cost = Resolver.getEffectivePlayCost(state, playerId, c.cardId, cardIndex);
      if (cost == null || cost > pp) return;
      aliveIndexes(player).forEach(function (ai) {
        Resolver.getAllowedAttackTargets(state, playerId).forEach(function (ti) {
          var est = estimateAttack(state, playerId, c.cardId, ai, ti, cardIndex);
          var score = scoreAttack(est, cost, c.cardId, player.leaders[ai]);
          if (!best || score > best.score) best = { score: score, instanceId: c.instanceId, cardId: c.cardId, cost: cost, attacker: ai, target: ti };
        });
      });
    });
    return best;
  }

  function cheapestAttackCost(state, playerId, cardIndex, excluded, exceptInstanceId) {
    var player = state.players[playerId];
    var min = null;
    player.hand.forEach(function (c) {
      if (excluded[c.instanceId] || c.instanceId === exceptInstanceId) return;
      var card = cardIndex[c.cardId];
      if (!card || card.cardType !== 'ATTACK') return;
      var cost = Resolver.getEffectivePlayCost(state, playerId, c.cardId, cardIndex);
      if (cost != null && (min == null || cost < min)) min = cost;
    });
    return min;
  }

  function bestAttackerIndex(state, playerId, cardIndex) {
    var player = state.players[playerId];
    var best = -1;
    var bestAtk = -1;
    aliveIndexes(player).forEach(function (i) {
      var atk = GameState.getLeaderCurrentAtk(cardIndex, player.leaders[i]);
      if (atk > bestAtk) { bestAtk = atk; best = i; }
    });
    return best;
  }

  // 次の1手。helpers: { isEquipment(cardId), level?: 'EASY'|'NORMAL'|'HARD', random?() }、
  // excluded: このターンに失敗したカード（instanceId → true）
  function decideAction(state, playerId, cardIndex, helpers, excluded) {
    var level = helpers && helpers.level;
    if (level === 'EASY') return decideEasy(state, playerId, cardIndex, helpers, excluded || {});
    if (level === 'HARD') return decideHard(state, playerId, cardIndex, helpers, excluded || {});
    return decideNormal(state, playerId, cardIndex, helpers, excluded || {});
  }

  function decideNormal(state, playerId, cardIndex, helpers, excluded) {
    var isEquipment = (helpers && helpers.isEquipment) || isEquipmentByEffects;
    var player = state.players[playerId];
    var pp = ppLeft(player);

    var attack = bestAttack(state, playerId, cardIndex, excluded);

    // 手札のメモリア・タクティクスエリアのタクティクスを候補にする
    var plays = [];
    player.hand.forEach(function (c) {
      if (excluded[c.instanceId]) return;
      var card = cardIndex[c.cardId];
      if (!card || card.cardType !== 'MEMORIA') return;
      var cost = Resolver.getEffectivePlayCost(state, playerId, c.cardId, cardIndex);
      if (cost == null || cost > pp) return;
      plays.push({ kind: 'MEMORIA', instanceId: c.instanceId, cardId: c.cardId, cost: cost, boost: boostAmountOf(c.cardId), utility: hasUtilityEffect(c.cardId) });
    });
    if (Phases.canPlayTactics(state)) {
      player.tacticsArea.forEach(function (t) {
        if (excluded[t.card.instanceId]) return;
        var card = cardIndex[t.card.cardId];
        if (!card || typeof card.cost !== 'number' || card.cost > pp) return;
        if (!CardEffectData.hasEffects(t.card.cardId)) return; // 効果が未登録のタクティクスは使っても意味が無い
        if (!Resolver.canPlayCardNow(state, playerId, t.card.cardId, cardIndex)) return; // プレイ条件（復活ポータル）
        var equip = isEquipment(t.card.cardId);
        plays.push({ kind: 'TACTICS', instanceId: t.card.instanceId, cardId: t.card.cardId, cost: card.cost, equip: equip, boost: boostAmountOf(t.card.cardId), utility: hasUtilityEffect(t.card.cardId) || equip });
      });
    }
    function toAction(p) {
      if (p.kind === 'MEMORIA') return { type: 'MEMORIA', instanceId: p.instanceId, cardId: p.cardId };
      return { type: 'TACTICS', instanceId: p.instanceId, cardId: p.cardId, subType: p.equip ? 'EQUIPMENT' : 'CONSUMABLE', equipLeaderIndex: p.equip ? bestAttackerIndex(state, playerId, cardIndex) : null };
    }

    // 1. コスト0で効果のあるカード
    var free = plays.filter(function (p) { return p.cost === 0 && (p.boost > 0 || p.utility); });
    if (free.length) return toAction(free[0]);

    if (attack) {
      // 2. アタックのPPを残せるなら、強化・装備・効果のあるカードを先に（強化が大きい順）
      var support = plays.filter(function (p) {
        if (!(p.boost > 0 || p.utility)) return false;
        var rest = cheapestAttackCost(state, playerId, cardIndex, excluded, p.instanceId);
        return rest != null && pp - p.cost >= rest;
      }).sort(function (a, b) { return (b.boost - a.boost) || (a.cost - b.cost); });
      if (support.length) return toAction(support[0]);
      // 3. アタック
      var count = Resolver.getMultiAttackCount(attack.cardId);
      var oppId = GameState.getOpponentId(playerId);
      var options = { attackerLeaderIndex: attack.attacker, targetPlayerId: oppId, targetLeaderIndex: attack.target };
      if (count) {
        options = { attacks: [] };
        for (var i = 0; i < count; i++) options.attacks.push({ attackerLeaderIndex: attack.attacker, targetPlayerId: oppId, targetLeaderIndex: attack.target });
      }
      return { type: 'ATTACK', instanceId: attack.instanceId, cardId: attack.cardId, options: options };
    }

    // 4. アタックできないなら、強化以外の効果を持つカード（強化だけのカードは次のアタックまで温存）
    var utility = plays.filter(function (p) { return p.utility; }).sort(function (a, b) { return a.cost - b.cost; });
    if (utility.length) return toAction(utility[0]);

    return { type: 'END' };
  }

  // ---------- 使える手の一覧（弱・強で使う） ----------
  function legalActions(state, playerId, cardIndex, helpers, excluded) {
    var isEquipment = (helpers && helpers.isEquipment) || isEquipmentByEffects;
    var player = state.players[playerId];
    var oppId = GameState.getOpponentId(playerId);
    var pp = ppLeft(player);
    var acts = [];
    player.hand.forEach(function (c) {
      if (excluded[c.instanceId]) return;
      var card = cardIndex[c.cardId];
      if (!card) return;
      var cost = Resolver.getEffectivePlayCost(state, playerId, c.cardId, cardIndex);
      if (cost == null || cost > pp) return;
      if (card.cardType === 'MEMORIA') {
        acts.push({ type: 'MEMORIA', instanceId: c.instanceId, cardId: c.cardId });
      } else if (card.cardType === 'ATTACK') {
        var count = Resolver.getMultiAttackCount(c.cardId);
        aliveIndexes(player).forEach(function (ai) {
          Resolver.getAllowedAttackTargets(state, playerId).forEach(function (ti) {
            var one = { attackerLeaderIndex: ai, targetPlayerId: oppId, targetLeaderIndex: ti };
            var options = one;
            if (count) {
              options = { attacks: [] };
              for (var k = 0; k < count; k++) options.attacks.push(Object.assign({}, one));
            }
            acts.push({ type: 'ATTACK', instanceId: c.instanceId, cardId: c.cardId, options: options });
          });
        });
      }
    });
    if (Phases.canPlayTactics(state)) {
      player.tacticsArea.forEach(function (t) {
        if (excluded[t.card.instanceId]) return;
        var card = cardIndex[t.card.cardId];
        if (!card || typeof card.cost !== 'number' || card.cost > pp) return;
        if (!CardEffectData.hasEffects(t.card.cardId)) return;
        if (!Resolver.canPlayCardNow(state, playerId, t.card.cardId, cardIndex)) return;
        if (isEquipment(t.card.cardId)) {
          aliveIndexes(player).forEach(function (li) {
            acts.push({ type: 'TACTICS', instanceId: t.card.instanceId, cardId: t.card.cardId, subType: 'EQUIPMENT', equipLeaderIndex: li });
          });
        } else {
          acts.push({ type: 'TACTICS', instanceId: t.card.instanceId, cardId: t.card.cardId, subType: 'CONSUMABLE', equipLeaderIndex: null });
        }
      });
    }
    return acts;
  }

  // ---------- 弱 ----------
  var EASY_END_RATE = 0.06;
  var EASY_SMART_RATE = 0.75;
  function decideEasy(state, playerId, cardIndex, helpers, excluded) {
    var rnd = (helpers && helpers.random) || Math.random;
    var acts = legalActions(state, playerId, cardIndex, helpers, excluded);
    if (!acts.length || rnd() < EASY_END_RATE) return { type: 'END' }; // まだ使えるカードがあってもターンを終えることがある
    if (rnd() < EASY_SMART_RATE) return decideNormal(state, playerId, cardIndex, helpers, excluded); // 4回に3回くらいは「中」と同じ手
    var attacks = acts.filter(function (a) { return a.type === 'ATTACK'; });
    var others = acts.filter(function (a) { return a.type !== 'ATTACK'; });
    var pool = attacks.length && (!others.length || rnd() < 0.6) ? attacks : others;
    return pool[Math.floor(rnd() * pool.length)];
  }

  // ---------- 強（盤面のコピーで試して点数化） ----------
  // シミュレーション用の盤面のコピー。行動ログはこのターンの分だけ残す（「このターン〜していれば」の判定用）
  function cloneForSim(state) {
    var log = state.actionLog || [];
    var cur = log.filter(function (e) { return e.turnNumber === state.turn.turnNumber && e.roundNumber === state.match.roundNumber; });
    var shallow = Object.assign({}, state, { actionLog: [] });
    var copy = Choices.deepClone(shallow);
    copy.actionLog = cur.slice();
    return copy;
  }

  // 効果の選択はCPUの答え方で進める（相手が選ぶ質問も、CPUの答え方で代わりに答える）
  function simEnv(s, cardIndex) {
    var ask = function (q) { return answerQuestion(q, s, q.chooser || s.turn.activePlayer, cardIndex); };
    return {
      ask: ask,
      cb: Choices.makeCallbacks(ask, { getActivePlayerId: function () { return s.turn.activePlayer; }, getResolvingEffect: Resolver.getResolvingEffect }),
    };
  }

  function withSimRandom(fn) {
    var orig = Math.random;
    Math.random = Choices.seededRandom(20260926);
    try { return fn(); } finally { Math.random = orig; }
  }

  // 1手を盤面のコピーで実行する（対戦画面の行動と同じく、最後にラウンド終了の判定まで行う）。失敗したらnull
  function simulate(state, playerId, act, cardIndex) {
    var s = cloneForSim(state);
    var env = simEnv(s, cardIndex);
    try {
      withSimRandom(function () {
        if (act.type === 'ATTACK') Resolver.playAttackCardWithEffects(s, playerId, act.instanceId, Object.assign({}, act.options, env.cb), cardIndex);
        else if (act.type === 'MEMORIA') Resolver.playMemoriaCardWithEffects(s, playerId, act.instanceId, Object.assign({}, env.cb), cardIndex);
        else Resolver.playTacticsCardWithEffects(s, playerId, act.instanceId, Object.assign({ subType: act.subType, equipLeaderIndex: act.equipLeaderIndex }, env.cb), cardIndex);
        if (s.match.status !== 'FINISHED') Resolver.processRoundEndWithEffects(s);
      });
      return s;
    } catch (e) {
      return null;
    }
  }

  function turnOver(s, playerId, base) {
    return s.match.status === 'FINISHED' || s.turn.phase === 'ROUND_SETUP' || s.turn.activePlayer !== playerId ||
      s.match.roundNumber !== base.match.roundNumber;
  }

  // ターンの残りを「中」の方針で進め、終了フェイズ（残ったPPのドロー・手札上限）まで行う
  function playOutTurn(s, playerId, cardIndex, helpers, base) {
    var excl = {};
    for (var step = 0; step < 10 && !turnOver(s, playerId, base); step++) {
      var a = decideNormal(s, playerId, cardIndex, helpers, excl);
      if (a.type === 'END') break;
      var next = simulate(s, playerId, a, cardIndex);
      if (!next) { excl[a.instanceId] = true; continue; }
      s = next;
    }
    if (!turnOver(s, playerId, base)) {
      var env = simEnv(s, cardIndex);
      try { withSimRandom(function () { Resolver.runEndPhaseWithEffects(s, Choices.makeHandLimitChooser(env.ask, playerId)); }); } catch (e) { /* 評価はそのまま */ }
    }
    return s;
  }

  // 盤面の点数（playerIdから見て。baseは考え始めた時点の盤面）
  function evaluate(s, playerId, cardIndex, base) {
    var oppId = GameState.getOpponentId(playerId);
    if (s.match.status === 'FINISHED') return s.match.winner === playerId ? 1e6 : (s.match.winner === 'DRAW' ? 0 : -1e6);
    var won = (s.match.roundWins[playerId] - base.match.roundWins[playerId]) - (s.match.roundWins[oppId] - base.match.roundWins[oppId]);
    if (won || s.match.roundNumber !== base.match.roundNumber) return won * 1e5;
    var score = 0;
    s.players[oppId].leaders.forEach(function (l) {
      if (l.isDown) { score += 420; return; }
      var max = GameState.getLeaderMaxHp(cardIndex, l);
      var hp = GameState.getLeaderCurrentHp(cardIndex, l);
      score += (max - hp) * 1.0 + (hp <= 40 ? 25 : 0);
    });
    var me = s.players[playerId];
    me.leaders.forEach(function (l) {
      if (l.isDown) { score -= 420; return; }
      var max = GameState.getLeaderMaxHp(cardIndex, l);
      var hp = GameState.getLeaderCurrentHp(cardIndex, l);
      score -= (max - hp) * 0.8;
      if (l.awakened) score += 30;
      score += (l.equipment || []).length * 18;
    });
    score += me.hand.length * 14;
    score += (me.pendingAttackBoost || 0) * 0.5;
    score += me.tacticsArea.length * 4;
    return score;
  }

  function decideHard(state, playerId, cardIndex, helpers, excluded) {
    var base = state;
    var best = { score: evaluate(playOutTurnFromEnd(state, playerId, cardIndex), playerId, cardIndex, base), act: { type: 'END' } };
    legalActions(state, playerId, cardIndex, helpers, excluded).forEach(function (act) {
      var s1 = simulate(state, playerId, act, cardIndex);
      if (!s1) return;
      var score = evaluate(playOutTurn(s1, playerId, cardIndex, helpers, base), playerId, cardIndex, base);
      if (score > best.score + 0.001) best = { score: score, act: act };
    });
    return best.act;
  }

  // 今すぐターンを終えた場合の盤面（終了フェイズまで）
  function playOutTurnFromEnd(state, playerId, cardIndex) {
    var s = cloneForSim(state);
    var env = simEnv(s, cardIndex);
    try { withSimRandom(function () { Resolver.runEndPhaseWithEffects(s, Choices.makeHandLimitChooser(env.ask, playerId)); }); } catch (e) { /* そのまま */ }
    return s;
  }

  // ---------- 選択画面への回答 ----------
  function leaderOf(state, ref) { return state.players[ref.playerId].leaders[ref.leaderIndex]; }
  function byHpAsc(state, cardIndex) {
    return function (a, b) { return GameState.getLeaderCurrentHp(cardIndex, leaderOf(state, a.ref)) - GameState.getLeaderCurrentHp(cardIndex, leaderOf(state, b.ref)); };
  }
  function cardCost(c, cardIndex) {
    if (typeof c.cost === 'number') return c.cost;
    var cd = cardIndex[c.cardId];
    return cd && typeof cd.cost === 'number' ? cd.cost : 99; // コスト未確定（プレイできない）カードは真っ先に捨てる
  }
  function cheapestIndexes(cards, n, cardIndex) {
    return cards.map(function (c, i) { return { i: i, cost: cardCost(c, cardIndex) }; })
      .sort(function (a, b) { return (a.cost === 99 ? -1 : a.cost) - (b.cost === 99 ? -1 : b.cost); })
      .slice(0, n).map(function (x) { return x.i; });
  }

  function answerQuestion(q, state, playerId, cardIndex) {
    var player = state.players[playerId];
    if (q.type === 'OPTIONS') {
      if (q.kind === 'DECLARE_TYPE') {
        // 自分のデッキで多い方のカードタイプを宣言する
        var counts = {};
        player.deck.forEach(function (c) { var cd = cardIndex[c.cardId]; if (cd) counts[cd.cardType] = (counts[cd.cardType] || 0) + 1; });
        var bestIdx = 0;
        q.options.forEach(function (o, i) { if ((counts[o.value] || 0) > (counts[q.options[bestIdx].value] || 0)) bestIdx = i; });
        return [bestIdx];
      }
      if (q.kind === 'MEET_ORDER') return [0]; // メモリア（アタック強化）を先に
      return [player.hand.length >= 3 ? 0 : 1]; // はい／いいえ（ランダムに捨ててよいか）：手札に余裕があれば「はい」
    }

    if (q.type === 'ALLOCATE' && q.kind === 'DAMAGE_ALLOC') {
      // 残り体力が少ない相手から、倒せる分だけ割り振る（余りは一番残り体力が少ない相手へ）
      var targets = q.candidates.map(function (ref, i) { return { i: i, hp: GameState.getLeaderCurrentHp(cardIndex, leaderOf(state, ref)) }; })
        .sort(function (a, b) { return a.hp - b.hp; });
      var dmg = q.candidates.map(function () { return 0; });
      var remain = q.total;
      targets.forEach(function (t) {
        var need = Math.ceil(t.hp / q.step) * q.step;
        if (need <= remain) { dmg[t.i] += need; remain -= need; }
      });
      if (remain > 0) dmg[targets[0].i] += remain;
      return dmg;
    }
    if (q.type === 'ALLOCATE') {
      // 一番ダメージを受けているリーダーから順に、受けているダメージの分だけ割り振る
      var order = q.candidates.map(function (ref, i) { return { i: i, dmg: leaderOf(state, ref).damage }; }).sort(function (a, b) { return b.dmg - a.dmg; });
      var amounts = q.candidates.map(function () { return 0; });
      var left = q.total;
      order.forEach(function (o) {
        var give = Math.min(left, Math.ceil(o.dmg / q.step) * q.step);
        amounts[o.i] += give; left -= give;
      });
      if (left > 0) amounts[order[0].i] += left;
      return amounts;
    }

    if (q.type === 'LEADERS') {
      var cands = q.candidates.map(function (ref, i) { return { ref: ref, i: i }; });
      var own = q.candidates.every(function (r) { return r.playerId === playerId; });
      if (q.kind === 'SELF_DAMAGE') {
        // 残り体力に余裕のあるリーダーがいれば、ダメージを受けて効果（ドロー等）を得る
        var healthy = cands.filter(function (c) { return GameState.getLeaderCurrentHp(cardIndex, leaderOf(state, c.ref)) >= 80; })
          .sort(byHpAsc(state, cardIndex)).reverse();
        return healthy.length ? [healthy[0].i] : [];
      }
      if (q.kind === 'ATTACKER' || q.kind === 'MOVE_EQUIP_DEST') {
        var bestAtk = cands.slice().sort(function (a, b) {
          return GameState.getLeaderCurrentAtk(cardIndex, leaderOf(state, b.ref)) - GameState.getLeaderCurrentAtk(cardIndex, leaderOf(state, a.ref));
        });
        return [bestAtk[0].i];
      }
      if (own) {
        // 自分のリーダーが対象（回復など）：一番ダメージを受けているリーダー
        return cands.slice().sort(function (a, b) { return leaderOf(state, b.ref).damage - leaderOf(state, a.ref).damage; })
          .slice(0, Math.max(q.min, Math.min(q.max, 1))).map(function (c) { return c.i; });
      }
      // 相手のリーダーが対象：残り体力が少ない順（倒せる可能性が高い）に、選べるだけ選ぶ
      return cands.slice().sort(byHpAsc(state, cardIndex)).slice(0, q.max).map(function (c) { return c.i; });
    }

    // CARDS
    var cards = q.cards;
    switch (q.kind) {
      case 'SET_TACTICS': {
        // ラウンド開始時のタクティクス：このラウンドのPPで使える中で一番コストの高いもの（無ければ一番安いもの）
        var ppMax = player.ppCards.max;
        var tac = cards.map(function (c, i) { return { i: i, cost: cardCost(c, cardIndex) }; }).sort(function (a, b) { return b.cost - a.cost; });
        var usable = tac.filter(function (x) { return x.cost <= ppMax; });
        return [(usable.length ? usable[0] : tac[tac.length - 1]).i];
      }
      case 'DISCARD':
      case 'HAND_LIMIT':
        return cheapestIndexes(cards, q.min, cardIndex);
      case 'ATTACK_DISCARD':
        if (q.max >= 2) return cheapestIndexes(cards, Math.min(q.max, cards.length), cardIndex); // オーバードライブ：捨てるほど得
        return player.hand.length >= 3 ? cheapestIndexes(cards, 1, cardIndex) : [];
      case 'APEX_DISCARD': {
        if (player.hand.length < 3) return [];
        var sorted = cards.map(function (c, i) { return { i: i, cost: cardCost(c, cardIndex) }; }).sort(function (a, b) { return a.cost - b.cost; });
        var picked = [];
        var sum = 0;
        for (var k = 0; k < sorted.length && sum < q.costMin; k++) { picked.push(sorted[k].i); sum += sorted[k].cost; }
        return sum >= q.costMin ? picked : [];
      }
      case 'MOVE_EQUIP':
        return [];
      case 'FREE_PLAY': {
        if (q.costMax != null) {
          // コスト合計の上限まで、コストの高い順に
          var byCost = cards.map(function (c, i) { return { i: i, cost: cardCost(c, cardIndex) }; }).sort(function (a, b) { return b.cost - a.cost; });
          var chosen = [];
          var total = 0;
          byCost.forEach(function (x) { if (chosen.length < q.max && total + x.cost <= q.costMax) { chosen.push(x.i); total += x.cost; } });
          return chosen;
        }
        return (q.preselect && q.preselect.length ? q.preselect : [0]).slice(0, q.max);
      }
      default:
        // 手札に加える等（選ぶほど得なもの）
        if (q.preselect && q.preselect.length) return q.preselect.slice(0, q.max);
        return cheapestIndexes(cards, Math.max(q.min, 0), cardIndex);
    }
  }

  return {
    decideAction: decideAction,
    answerQuestion: answerQuestion,
    LEVELS: ['EASY', 'NORMAL', 'HARD'],
    estimateAttack: estimateAttack,
  };
}));
