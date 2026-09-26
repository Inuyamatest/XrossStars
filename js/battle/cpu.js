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
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('../engine/gameState.js'),
      require('../engine/phases.js'),
      require('../engine/cardEffectData.js'),
      require('../engine/effectResolver.js')
    );
  } else {
    root.XS_BATTLE_CPU = factory(root.XS_ENGINE_STATE, root.XS_ENGINE_PHASES, root.XS_ENGINE_CARD_EFFECT_DATA, root.XS_ENGINE_EFFECT_RESOLVER);
  }
}(typeof self !== 'undefined' ? self : this, function (GameState, Phases, CardEffectData, Resolver) {
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

  // 次の1手。helpers: { isEquipment(cardId) }、excluded: このターンに失敗したカード（instanceId → true）
  function decideAction(state, playerId, cardIndex, helpers, excluded) {
    excluded = excluded || {};
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
    estimateAttack: estimateAttack,
  };
}));
