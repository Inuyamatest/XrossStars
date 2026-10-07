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
  // 強化以外の「使うだけで得をする」効果（ドロー・回復・ダメージ等）を持つか。
  // 相手の手札が0枚なら、相手に捨てさせる効果（ハンデス）は得にならないので数えない
  function hasUtilityNow(state, playerId, cardId) {
    var oppHand = state.players[GameState.getOpponentId(playerId)].hand.length;
    return effectsOf(cardId).some(function (e) {
      var a = e.action;
      if (a && a.type === 'DISCARD_HAND' && (a.who === 'OPPONENT' || a.who === 'ALL') && oppHand === 0) return false;
      return (e.trigger === 'ON_PLAY' && !(a && EQUIP_ACTION_TYPES.indexOf(a.type) >= 0)) || (e.trigger === 'AFTER_ATTACK');
    });
  }
  // 調整用（テストで旧来の動きと比べるため。対戦画面では変更しない）
  var TUNE = { hpEquipFirst: true, chipWeight: 0.7, handBase: 30, oppHand: 0.8, depth2: true, depth2Top: 3, combo: true, multiPlan: true };
  function isHpEquipment(cardId) {
    return effectsOf(cardId).some(function (e) { return e.action && (e.action.type === 'EQUIP_HP_MODIFIER' || e.action.type === 'EQUIP_BASE_HP_OVERRIDE'); });
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

  // 複数回アタック（ストームラッシュ）の対象の割り振り：同じリーダーに全部撃つと、1回目でダウンさせた後の残りが無駄になる。
  // 1回ずつ「この1回で倒せる相手（体力の多い順）」→いなければ「残り体力の一番少ない相手」を選ぶ（倒し切れる相手を順番に狙う）
  function planMultiAttack(state, playerId, cardId, attackerIndex, count, cardIndex) {
    var player = state.players[playerId];
    var oppId = GameState.getOpponentId(playerId);
    var targets = Resolver.getAllowedAttackTargets(state, playerId);
    var remain = {};
    targets.forEach(function (ti) { remain[ti] = GameState.getLeaderCurrentHp(cardIndex, state.players[oppId].leaders[ti]); });
    var ctx = { ownerPlayerId: playerId, attackerPlayerId: playerId, attackerLeaderIndex: attackerIndex, targetPlayerId: oppId, targetLeaderIndex: targets[0], cardIndex: cardIndex };
    var per = Math.max(0, GameState.getLeaderCurrentAtk(cardIndex, player.leaders[attackerIndex]) + Resolver.computeAttackCardBaseDamage(cardId, state, ctx));
    var first = per + (player.pendingAttackBoost || 0);
    var out = [];
    for (var k = 0; k < count; k++) {
      var dmg = k === 0 ? first : per;
      var alive = targets.filter(function (ti) { return remain[ti] > 0; });
      if (!alive.length) alive = targets;
      var killable = alive.filter(function (ti) { return remain[ti] <= dmg; }).sort(function (a, b) { return remain[b] - remain[a]; });
      var ti = killable.length ? killable[0] : alive.slice().sort(function (a, b) { return remain[a] - remain[b]; })[0];
      remain[ti] -= dmg;
      out.push({ attackerLeaderIndex: attackerIndex, targetPlayerId: oppId, targetLeaderIndex: ti });
    }
    return { attacks: out };
  }

  // アタック後効果の見積もり（中の判断と、強のターンの残りの見積もりで使う。強の1手目は盤面のコピーで実行して比べる）。
  // アタック後の盤面を一時的に作り（このカードを手札から除く・倒せるなら対象をダウン・オーバーキル量）、
  // 各効果の条件と対象をエンジンの関数そのもので判定する。これで「手札が2枚以下なら」（カウンタースナイプ）、
  // 「ダウンしているなら」（船上の乱戦）、「オーバーキル」（スタンプキル）、「同じ色」（ポイズンボム）なども数えられる。
  // 判定に使った盤面はすぐ元に戻す（「ターンに1回」の使用記録も戻す）。
  function afterAttackValue(state, playerId, instanceId, cardId, attackerIndex, targetIndex, est, cardIndex) {
    var effs = effectsOf(cardId).filter(function (e) {
      return e.trigger === 'AFTER_ATTACK' && e.action && (e.action.type === 'DAMAGE' || e.action.type === 'DRAW' || e.action.type === 'RECOVER_PP');
    });
    if (!effs.length) return 0;
    var player = state.players[playerId];
    var oppId = GameState.getOpponentId(playerId);
    var opp = state.players[oppId];
    var target = opp.leaders[targetIndex];
    var handIdx = player.hand.findIndex(function (c) { return c.instanceId === instanceId; });
    var removed = handIdx >= 0 ? player.hand.splice(handIdx, 1)[0] : null;
    var wasDown = target.isDown;
    if (est.kill) target.isDown = true;
    var usage = state.turn.effectUsage;
    state.turn.effectUsage = usage ? Object.assign({}, usage) : usage;
    var hpOf = function (l) { return GameState.getLeaderCurrentHp(cardIndex, l); };
    var ctx = {
      ownerPlayerId: playerId, attackerPlayerId: playerId, attackerLeaderIndex: attackerIndex,
      targetPlayerId: oppId, targetLeaderIndex: targetIndex, cardIndex: cardIndex,
      overkillAmount: est.kill ? est.damage - est.hp : null, attackTrace: { afterAttackDamage: false },
      // 対象を1体選ぶ効果：CPUの答えと同じく、残り体力が一番少ないリーダー
      chooseTarget: function (cands) {
        var best = 0;
        cands.forEach(function (c, i) { if (hpOf(state.players[c.playerId].leaders[c.leaderIndex]) < hpOf(state.players[cands[best].playerId].leaders[cands[best].leaderIndex])) best = i; });
        return best;
      },
    };
    var value = 0;
    try {
      effs.forEach(function (e) {
        if (e.condition && !e.condition(state, ctx)) return;
        var a = e.action;
        if (a.type === 'DAMAGE') {
          if (typeof a.amount !== 'number' || !e.target) return;
          (e.target(state, ctx) || []).forEach(function (ref) {
            if (ref.playerId !== oppId) return;
            var l = opp.leaders[ref.leaderIndex];
            if (!l || l.isDown) return;
            var hp = hpOf(l);
            value += Math.min(a.amount, hp) * TUNE.chipWeight + (a.amount >= hp ? 150 : 0);
          });
        } else if (a.type === 'DRAW') {
          value += (typeof a.amount === 'number' ? a.amount : 1) * 8;
        } else if (a.type === 'RECOVER_PP') {
          value += (typeof a.amount === 'number' ? a.amount : 1) * 15;
        }
      });
    } catch (err) {
      // 見積もりなので、判定できない効果は数えない
    } finally {
      state.turn.effectUsage = usage;
      target.isDown = wasDown;
      if (removed) player.hand.splice(handIdx, 0, removed);
    }
    return value;
  }

  function scoreAttack(est, cost, cardId, attacker, afterValue) {
    var s = est.kill ? 500 + est.hp : est.damage + (120 - est.hp) * 0.3;
    s += afterValue || 0;
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
          var score = scoreAttack(est, cost, c.cardId, player.leaders[ai], afterAttackValue(state, playerId, c.instanceId, c.cardId, ai, ti, est, cardIndex));
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
      if (TUNE.combo && !comboReady(state, playerId, c.cardId, cost, pp, cardIndex, excluded)) return; // コンボの準備カードは決め手を撃てるときまで温存
      plays.push({ kind: 'MEMORIA', instanceId: c.instanceId, cardId: c.cardId, cost: cost, boost: boostAmountOf(c.cardId), utility: hasUtilityNow(state, playerId, c.cardId) });
    });
    if (Phases.canPlayTactics(state)) {
      player.tacticsArea.forEach(function (t) {
        if (excluded[t.card.instanceId]) return;
        var card = cardIndex[t.card.cardId];
        if (!card || typeof card.cost !== 'number' || card.cost > pp) return;
        if (!CardEffectData.hasEffects(t.card.cardId)) return; // 効果が未登録のタクティクスは使っても意味が無い
        if (!Resolver.canPlayCardNow(state, playerId, t.card.cardId, cardIndex)) return; // プレイ条件（復活ポータル）
        var equip = isEquipment(t.card.cardId);
        plays.push({ kind: 'TACTICS', instanceId: t.card.instanceId, cardId: t.card.cardId, cost: card.cost, equip: equip, boost: boostAmountOf(t.card.cardId), utility: hasUtilityNow(state, playerId, t.card.cardId) || equip });
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
      if (count && TUNE.multiPlan) options = planMultiAttack(state, playerId, attack.cardId, attack.attacker, count, cardIndex);
      else if (count) {
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
        if (TUNE.combo && !comboReady(state, playerId, c.cardId, cost, pp, cardIndex, excluded)) return; // コンボの準備カードは温存
        acts.push({ type: 'MEMORIA', instanceId: c.instanceId, cardId: c.cardId });
      } else if (card.cardType === 'ATTACK') {
        var count = Resolver.getMultiAttackCount(c.cardId);
        if (count && TUNE.multiPlan) aliveIndexes(player).forEach(function (ai) { acts.push({ type: 'ATTACK', instanceId: c.instanceId, cardId: c.cardId, options: planMultiAttack(state, playerId, c.cardId, ai, count, cardIndex) }); });
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
  // 手札の価値（強）：
  //  - ラウンドの終わりが近い（自分か相手の、生きているリーダーの残り体力の合計が少ない）ほど下げる（ラウンド終了で手札はトラッシュ）
  //  - 6枚目以降は半分（手札上限7枚。持ちすぎても使い切れない）
  //  - デッキとトラッシュの裏向きのカードが残り少ないときは下げる。尽きていれば次のドローでタクティクスを失う／負けるので減点
  function aliveHpSum(player, cardIndex) {
    return player.leaders.reduce(function (sum, l) { return l.isDown ? sum : sum + GameState.getLeaderCurrentHp(cardIndex, l); }, 0);
  }
  var HAND_TUNE = { ref: 200, floor: 0.3, lowSupply: 0.6, over5: 0.5 };
  function handScore(me, opp, cardIndex) {
    var t = HAND_TUNE;
    var per = TUNE.handBase * Math.max(t.floor, Math.min(1, Math.min(aliveHpSum(me, cardIndex), aliveHpSum(opp, cardIndex)) / t.ref));
    var supply = me.deck.length + me.trash.filter(function (x) { return !x.faceUp; }).length;
    var extra = 0;
    if (supply < 5) per *= t.lowSupply;
    if (supply === 0) extra = me.tacticsDeck.length === 0 ? -5e4 : -25;
    var score = 0;
    for (var i = 0; i < me.hand.length; i++) score += i < 5 ? per : per * t.over5;
    return score + extra;
  }
  // 相手の手札の価値（強）：相手の手札も相手にとっては同じように価値がある。
  // これを数えないと、ハンデス（対戦相手は手札を捨てる）の得を評価できず、相手の手札が0枚でも撃ってしまう。
  // 1枚あたりの価値は考え始めた時点の盤面（base）で決めて固定する（与えたダメージで値が動くと、アタックの評価まで変わってしまうため）。
  // 自分のカードは確実に使えるが、相手のカードは相手の次のターンまでに状況が変わるので、重みは TUNE.oppHand 倍にする
  function oppHandScore(s, base, playerId, cardIndex) {
    var t = HAND_TUNE;
    var oppId = GameState.getOpponentId(playerId);
    var per = TUNE.handBase * Math.max(t.floor, Math.min(1, Math.min(aliveHpSum(base.players[playerId], cardIndex), aliveHpSum(base.players[oppId], cardIndex)) / t.ref));
    var score = 0;
    for (var i = 0; i < s.players[oppId].hand.length; i++) score += i < 5 ? per : per * t.over5;
    return score * TUNE.oppHand;
  }

  // ---------- コンボ（揃えて同じターンに使うと強い組み合わせ）----------
  // enabler（準備のメモリア）は、payoff（決め手のアタック）を同じターンに撃てるときまで手札に温存する。
  // 名前で判定する（パラレル版も同じカードとして扱う）。hold＝揃っているときに手札に残す価値（evaluateの点数）
  var COMBOS = [
    { enabler: '先導者の証', payoffs: ['ストームラッシュ'], hold: 70 },                                        // 攻撃力+30 → 3回アタック
    { enabler: 'グレイトフルファーマー', payoffs: ['ダブルダウン', 'ストームラッシュ', 'ロケットランチャー', '勝利の雄たけび'], hold: 50 }, // アタックをもう一度
  ];
  function nameOf(cardId, cardIndex) { var c = cardIndex[cardId]; return c ? c.name : ''; }
  function countNames(list, names, cardIndex) {
    return list.reduce(function (n, c) { return n + (names.indexOf(nameOf(c.cardId || (c.card && c.card.cardId), cardIndex)) >= 0 ? 1 : 0); }, 0);
  }
  function comboHoldScore(me, cardIndex) {
    var score = 0;
    COMBOS.forEach(function (cb) {
      var en = countNames(me.hand, [cb.enabler], cardIndex);
      if (!en) return;
      var payHand = countNames(me.hand, cb.payoffs, cardIndex);
      var payDeck = countNames(me.deck, cb.payoffs, cardIndex);
      if (payHand) score += cb.hold * Math.min(en, payHand) + cb.hold * 0.4 * Math.max(0, en - payHand);
      else if (payDeck) score += cb.hold * 0.4 * en;
    });
    return score;
  }
  // 準備カードを今プレイしてよいか：準備カードでなければ常にtrue。準備カードなら、手札の決め手を同じターンに撃てる（PPが足りる）ときだけ
  function comboReady(state, playerId, cardId, cost, pp, cardIndex, excluded) {
    var name = nameOf(cardId, cardIndex);
    var cb = COMBOS.filter(function (x) { return x.enabler === name; })[0];
    if (!cb) return true;
    var me = state.players[playerId];
    if (!countNames(me.hand, cb.payoffs, cardIndex) && !countNames(me.deck, cb.payoffs, cardIndex)) return true; // 決め手がもう残っていなければ普通に使う
    return me.hand.some(function (h) {
      if ((excluded && excluded[h.instanceId]) || cb.payoffs.indexOf(nameOf(h.cardId, cardIndex)) < 0) return false;
      var pc = Resolver.getEffectivePlayCost(state, playerId, h.cardId, cardIndex);
      return pc != null && cost + pc <= pp;
    });
  }
  // このアクションが「手札に決め手があるときの準備カード」か（2手先まで必ず読む）
  function isComboStarter(state, playerId, act, cardIndex) {
    if (!act || act.type !== 'MEMORIA') return false;
    var name = nameOf(act.cardId, cardIndex);
    var hand = state.players[playerId].hand;
    return COMBOS.some(function (cb) { return cb.enabler === name && countNames(hand, cb.payoffs, cardIndex) > 0; });
  }
  // 手札に加えるカードの選び方（討伐クエスト等）：足りないコンボパーツ＞ACE＞コストの高いカード
  function addToHandValue(cardId, hand, cardIndex) {
    var cd = cardIndex[cardId];
    if (!cd) return 0;
    var v = (typeof cd.cost === 'number' ? cd.cost : 0) * 8 + (cd.ace ? 20 : 0);
    COMBOS.forEach(function (cb) {
      if (cd.name === cb.enabler) v += countNames(hand, cb.payoffs, cardIndex) ? 120 : 40;
      if (cb.payoffs.indexOf(cd.name) >= 0) v += countNames(hand, [cb.enabler], cardIndex) ? 120 : 30;
    });
    return v;
  }

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
      score += (max - hp) * TUNE.chipWeight + (hp <= 40 ? 25 : 0);
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
    score += handScore(me, s.players[oppId], cardIndex);
    if (TUNE.combo) score += comboHoldScore(me, cardIndex);
    score -= oppHandScore(s, base, playerId, cardIndex);
    score += (me.pendingAttackBoost || 0) * 0.5;
    score += me.tacticsArea.length * 4;
    return score;
  }

  function decideHard(state, playerId, cardIndex, helpers, excluded) {
    var base = state;
    var best = { score: evaluate(playOutTurnFromEnd(state, playerId, cardIndex), playerId, cardIndex, base), act: { type: 'END' } };
    var tried = [];
    legalActions(state, playerId, cardIndex, helpers, excluded).forEach(function (act) {
      var s1 = simulate(state, playerId, act, cardIndex);
      if (!s1) return;
      var score = evaluate(playOutTurn(s1, playerId, cardIndex, helpers, base), playerId, cardIndex, base);
      tried.push({ act: act, s1: s1, score: score });
      if (score > best.score + 0.001) best = { score: score, act: act };
    });
    // 2手先まで読む：点数の高い1手目（上位TUNE.depth2Top個）について、2手目もすべて試してからターンの残りを進める
    if (TUNE.depth2 && tried.length > 1) {
      tried.sort(function (a, b) { return b.score - a.score; });
      var explore = tried.slice(0, TUNE.depth2Top);
      if (TUNE.combo) tried.slice(TUNE.depth2Top).forEach(function (t) { if (isComboStarter(state, playerId, t.act, cardIndex)) explore.push(t); }); // コンボの1手目は点数が低く見えても必ず続きを読む
      explore.forEach(function (t) {
        if (turnOver(t.s1, playerId, base)) return;
        secondActions(t.s1, playerId, cardIndex, helpers).forEach(function (a2) {
          var s2 = simulate(t.s1, playerId, a2, cardIndex);
          if (!s2) return;
          var score2 = evaluate(playOutTurn(s2, playerId, cardIndex, helpers, base), playerId, cardIndex, base);
          if (score2 > best.score + 0.001) best = { score: score2, act: t.act };
        });
      });
    }
    return best.act;
  }

  // 2手目の候補：メモリア・タクティクスはすべて、アタックはカードごとに見込みの高いアタッカーと対象の組を2つまで（読む手の数を抑える）
  function secondActions(s, playerId, cardIndex, helpers) {
    var acts = legalActions(s, playerId, cardIndex, helpers, {});
    var out = [];
    var byCard = {};
    acts.forEach(function (a) {
      if (a.type !== 'ATTACK') { out.push(a); return; }
      var o = a.options.attacks ? a.options.attacks[0] : a.options;
      var est = estimateAttack(s, playerId, a.cardId, o.attackerLeaderIndex, o.targetLeaderIndex, cardIndex);
      var sc = scoreAttack(est, 0, a.cardId, s.players[playerId].leaders[o.attackerLeaderIndex], 0);
      (byCard[a.instanceId] = byCard[a.instanceId] || []).push({ a: a, sc: sc });
    });
    Object.keys(byCard).forEach(function (k) {
      byCard[k].sort(function (x, y) { return y.sc - x.sc; }).slice(0, 2).forEach(function (x) { out.push(x.a); });
    });
    return out;
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
      case 'DECKOUT_TACTICS':
        // 相手のタクティクスは裏向きなので、どれを選んでも同じ（ランダム）
        return [Math.floor(Math.random() * cards.length)];
      case 'SET_TACTICS': {
        // ラウンド開始時のタクティクス。装備は試合の終わりまで残るので、体力を増やす装備（ライトシールド・
        // サイバネアーマー等）は1ラウンド目に置いて早く使う（体力を増やして、相手の倒しきりの計算をずらす）。
        // それ以外は、このラウンドのPPで使える中で一番コストの高いもの（無ければ一番安いもの）
        var ppMax = player.ppCards.max;
        var round = state.match.roundNumber;
        var scored = cards.map(function (c, i) {
          var cost = cardCost(c, cardIndex);
          var v = cost <= ppMax ? 30 + cost * 5 : 0;
          if (TUNE.hpEquipFirst && isHpEquipment(c.cardId)) v = round === 1 ? 100 : 60;
          if (TUNE.hpEquipFirst && CardEffectData.getPlayCondition && CardEffectData.getPlayCondition(c.cardId)) v = Math.min(v, 20); // 復活ポータル等：条件を満たすまで使えない
          return { i: i, v: v, cost: cost };
        }).sort(function (a, b) { return (b.v - a.v) || (a.cost - b.cost); });
        return [scored[0].i];
      }
      case 'DISCARD':
      case 'HAND_LIMIT':
        return cheapestIndexes(cards, q.min, cardIndex);
      case 'ATTACK_DISCARD':
        if (q.max >= 2) return cheapestIndexes(cards, Math.min(q.max, cards.length), cardIndex); // オーバードライブ：捨てるほど得
        return player.hand.length >= 3 ? cheapestIndexes(cards, 1, cardIndex) : [];
      case 'LOOK_TOP_TRASH': {
        // 運もミスもない：エースは残す。同じ種類のカードが手札に十分あれば（アタック3枚以上／メモリア2枚以上）トラッシュに置いて引き直す
        var top = cardIndex[cards[0].cardId];
        if (!top || top.ace) return [];
        var sameType = player.hand.filter(function (c) { var cd = cardIndex[c.cardId]; return cd && cd.cardType === top.cardType; }).length;
        return sameType >= (top.cardType === 'ATTACK' ? 3 : 2) ? [0] : [];
      }
      case 'APEX_DISCARD': {
        // 頂点捕食者：できるだけ少ない枚数で払う（手札を減らさない）。
        // 1枚で足りるカード（コスト2など）があれば、エース以外・コストの低いものを1枚だけ捨てる（1枚捨てて1枚プレイ＝枚数は減らない）。
        // 2枚以上が必要なら、手札が3枚以上あるときだけ、コストの高い順（コスト0は払いの足しにならないので使わない）に捨てる。
        var items = cards.map(function (c, i) { var cd = cardIndex[c.cardId]; return { i: i, cost: cardCost(c, cardIndex), ace: !!(cd && cd.ace) }; });
        var singles = items.filter(function (x) { return x.cost >= q.costMin; })
          .sort(function (a, b) { return (a.ace - b.ace) || (a.cost - b.cost); });
        if (singles.length && (!singles[0].ace || player.hand.length >= 3)) return [singles[0].i];
        if (player.hand.length < 3) return [];
        var sorted = items.filter(function (x) { return x.cost > 0 && !x.ace; }).sort(function (a, b) { return b.cost - a.cost; });
        var picked = [];
        var sum = 0;
        for (var k = 0; k < sorted.length && sum < q.costMin; k++) { picked.push(sorted[k].i); sum += sorted[k].cost; }
        return sum >= q.costMin ? picked : [];
      }
      case 'MOVE_EQUIP':
        return [];
      case 'FREE_PLAY': {
        if (q.replay) {
          // 三銃士「プレイし直す」：もう一度起きるのはプレイ時効果だけ（effectResolver REPLAY_SELECTED_FROM_PLAY_AREA）。
          // ダメージを与えるもの→その他のプレイ時効果の順に選び、プレイ時効果の無いカードは選ばない
          var replayScore = function (c) {
            var on = effectsOf(c.cardId).filter(function (e) { return e.trigger === 'ON_PLAY'; });
            if (!on.length) return 0;
            return on.some(function (e) { return e.action && e.action.type === 'DAMAGE'; }) ? 2 : 1;
          };
          return cards.map(function (c, i) { return { i: i, v: replayScore(c) }; })
            .filter(function (x) { return x.v > 0; })
            .sort(function (a, b) { return b.v - a.v; })
            .slice(0, q.max).map(function (x) { return x.i; });
        }
        if (q.costMax != null) {
          // コスト合計の上限まで、コストの高い順に
          var byCost = cards.map(function (c, i) { return { i: i, cost: cardCost(c, cardIndex) }; }).sort(function (a, b) { return b.cost - a.cost; });
          var chosen = [];
          var total = 0;
          byCost.forEach(function (x) { if (chosen.length < q.max && total + x.cost <= q.costMax) { chosen.push(x.i); total += x.cost; } });
          return chosen;
        }
        if (q.max === 1 && cards.length > 1) {
          // 1枚だけタダでプレイする（頂点捕食者の山札から等）：コストの高いカードほど効果が大きいので、一番高いもの
          var best = cards.map(function (c, i) { return { i: i, cost: cardCost(c, cardIndex) }; }).sort(function (a, b) { return b.cost - a.cost; })[0];
          return [best.i];
        }
        return (q.preselect && q.preselect.length ? q.preselect : [0]).slice(0, q.max);
      }
      case 'ADD_TO_HAND': {
        if (!TUNE.combo) return (q.preselect && q.preselect.length ? q.preselect : [0]).slice(0, q.max);
        if (!cards.length || !(q.max > 0)) return [];
        return cards.map(function (c, i) { return { i: i, v: addToHandValue(c.cardId, player.hand, cardIndex) }; })
          .sort(function (a, b) { return b.v - a.v; }).slice(0, q.max).map(function (x) { return x.i; });
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
    TUNE: TUNE,
    estimateAttack: estimateAttack,
    afterAttackValue: afterAttackValue,
  };
}));
