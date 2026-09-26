/* Xross Stars 対戦UI — カード効果の「選択」を画面で行うための仕組み
 *
 * js/engine のカード効果は、選択が必要になると ctx.chooseXxx(候補, …) を「同期的に」呼び出して
 * その場で答えを受け取る設計になっている。一方、画面での選択はクリックを待つ非同期の操作になる。
 * そこで「リプレイ方式」で橋渡しする:
 *
 *   1. 行動（カードのプレイ・ターン終了など）を、現在の盤面のコピーに対して実行する。
 *   2. まだ答えの無い選択に来たら、その質問を投げて実行を中断する（コピーは捨てる）。
 *   3. 画面で答えを選んだら、答えの列を記録して、元の盤面のコピーに対して1.からやり直す。
 *      記録済みの質問には記録した答えを即座に返すので、同じ地点まで同じ結果で進む。
 *   4. 最後まで進んだら、そのコピーを新しい盤面として採用する。
 *
 * やり直しで結果が変わらないように、実行中はMath.randomを同じシードの疑似乱数に差し替える
 * （山札切れ時の再シャッフル・ラウンド開始時のタクティクス抽選など）。
 * 答えは候補の「何番目か」で記録する（インスタンスIDが変わっても対応が崩れないように）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.XS_BATTLE_CHOICES = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 盤面のコピー。関数（登録済み効果のcondition/target等）は参照のまま共有する（不変のため）。
  function deepClone(v) {
    if (Array.isArray(v)) return v.map(deepClone);
    if (v && typeof v === 'object') {
      var out = {};
      Object.keys(v).forEach(function (k) { out[k] = deepClone(v[k]); });
      return out;
    }
    return v;
  }

  function seededRandom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function NeedChoice(question, state) {
    this.question = question;
    this.state = state;
  }

  // fn(state, ask) を baseState のコピーに対して実行する。
  // 戻り値: { done: true, state, value } | { done: false, question, state（中断時点の盤面） }
  function runWithAnswers(baseState, seed, answers, fn) {
    var state = deepClone(baseState);
    var asked = 0;
    function ask(question) {
      if (asked < answers.length) return answers[asked++];
      throw new NeedChoice(question, state);
    }
    var originalRandom = Math.random;
    Math.random = seededRandom(seed);
    try {
      var value = fn(state, ask);
      return { done: true, state: state, value: value };
    } catch (e) {
      if (e instanceof NeedChoice) return { done: false, question: e.question, state: e.state };
      throw e;
    } finally {
      Math.random = originalRandom;
    }
  }

  function firstN(n, len) {
    var out = [];
    for (var i = 0; i < Math.min(n, len); i++) out.push(i);
    return out;
  }

  // 質問の種類:
  //   LEADERS  : candidates（{playerId, leaderIndex}）から min〜max 体を選ぶ → 答え: index[]
  //   CARDS    : cards（{instanceId, cardId, cost?, note?}）から min〜max 枚を選ぶ → 答え: index[]（選んだ順）
  //              costMin: 1枚以上選ぶならコスト合計がこれ以上 / costMax: コスト合計の上限
  //              secret: 手番でないプレイヤーの手札（表示前にワンクッション置く）
  //   ALLOCATE : candidates に total を step 刻みで割り振る → 答え: amount[]
  //   OPTIONS  : options（{label}）から1つ選ぶ → 答え: [index]
  // env: { getActivePlayerId(), getResolvingEffect() }
  function makeCallbacks(ask, env) {
    function source() {
      var r = env.getResolvingEffect && env.getResolvingEffect();
      return r ? { sourceInstanceId: r.sourceInstanceId, trigger: r.trigger, ownerPlayerId: r.ownerPlayerId, attackerLeaderIndex: r.attackerLeaderIndex, cardId: r.cardId } : null;
    }
    function owner() {
      var s = source();
      return (s && s.ownerPlayerId) || env.getActivePlayerId();
    }
    function q(extra) {
      return Object.assign({ chooser: owner(), source: source(), preselect: [] }, extra);
    }
    function cardList(cands) {
      return cands.map(function (c) { return { instanceId: c.instanceId, cardId: c.cardId, cost: c.cost }; });
    }
    function singleLeader(title, kind) {
      return function (candidates) {
        if (candidates.length <= 1) return 0;
        var a = ask(q({ type: 'LEADERS', kind: kind, title: title, candidates: candidates, min: 1, max: 1 }));
        return a[0];
      };
    }

    return {
      chooseTarget: singleLeader('対象のリーダーを1体選んでください', 'TARGET'),
      chooseHealTarget: singleLeader('対象のリーダーを1体選んでください', 'TARGET'),
      chooseFreeAttackTarget: singleLeader('このアタックを受けるリーダーを選んでください', 'TARGET'),
      chooseFreeAttackAttacker: singleLeader('アタックする自分のリーダーを選んでください', 'ATTACKER'),

      // ジェイルブレイク：合計ダメージを対戦相手のリーダーに割り振る
      chooseDistributedDamage: function (candidates, total) {
        if (!candidates.length) return [];
        if (candidates.length === 1) return [{ playerId: candidates[0].playerId, leaderIndex: candidates[0].leaderIndex, amount: total }];
        var amounts = ask(q({ kind: 'DAMAGE_ALLOC', type: 'ALLOCATE', title: '合計' + total + 'のダメージを割り振ってください', candidates: candidates, total: total, step: 10 }));
        return candidates.map(function (c, i) { return { playerId: c.playerId, leaderIndex: c.leaderIndex, amount: amounts[i] || 0 }; })
          .filter(function (x) { return x.amount > 0; });
      },

      // 巡り合う二人：メモリア最大1枚・アタック最大1枚と、プレイする順番
      chooseMeetTwo: function (memCands, atkCands) {
        var mem = null;
        var atk = null;
        if (memCands.length) {
          var a = ask(q({ kind: 'MEET_MEMORIA', type: 'CARDS', title: 'コストを支払わずにプレイするメモリアを選んでください（最大1枚）', cards: cardList(memCands), min: 0, max: 1, preselect: [0], declineLabel: 'プレイしない' }));
          if (a.length) mem = memCands[a[0]].instanceId;
        }
        if (atkCands.length) {
          var b = ask(q({ kind: 'MEET_ATTACK', type: 'CARDS', title: 'コストを支払わずにプレイするアタックカードを選んでください（最大1枚）', cards: cardList(atkCands), min: 0, max: 1, preselect: [0], declineLabel: 'プレイしない' }));
          if (b.length) atk = atkCands[b[0]].instanceId;
        }
        var attackFirst = false;
        if (mem && atk) {
          var o = ask(q({ kind: 'MEET_ORDER', type: 'OPTIONS', title: 'プレイする順番を選んでください（先にプレイしたカードの効果から実行）', options: [{ label: 'メモリア → アタック' }, { label: 'アタック → メモリア' }] }));
          attackFirst = o[0] === 1;
        }
        return { memoria: mem, attack: atk, attackFirst: attackFirst };
      },

      chooseMultiTargets: function (candidates, n) {
        return ask(q({ kind: 'MULTI_TARGET', type: 'LEADERS', title: '対象のリーダーを最大' + n + '体選んでください', candidates: candidates, min: 0, max: n, preselect: firstN(n, candidates.length) }));
      },

      chooseSelfDamage: function (candidates) {
        var a = ask(q({ kind: 'SELF_DAMAGE', type: 'LEADERS', title: 'ダメージを与える自分のリーダーを選んでください（与えない場合は「しない」）', candidates: candidates, min: 0, max: 1, declineLabel: 'しない' }));
        return a.length ? a[0] : -1;
      },

      chooseDeckLookAddToHand: function (cands, maxPick) {
        if (!cands.length || !(maxPick > 0)) return []; // 手札に加えない効果（気まずい空間）は選ぶものが無い
        var a = ask(q({ kind: 'ADD_TO_HAND', type: 'CARDS', title: '手札に加えるカードを選んでください（最大' + maxPick + '枚）', cards: cardList(cands), min: 0, max: maxPick, preselect: firstN(maxPick, cands.length), declineLabel: '加えない' }));
        return a.map(function (i) { return cands[i].instanceId; });
      },

      chooseApexDiscard: function (cands, minCost) {
        var total = cands.reduce(function (s, c) { return s + c.cost; }, 0);
        if (!cands.length || total < minCost) return [];
        var a = ask(q({ kind: 'APEX_DISCARD', type: 'CARDS', title: '捨てるカードを選んでください（コスト合計' + minCost + '以上。捨てない場合は「しない」）', cards: cardList(cands), min: 0, max: cands.length, costMin: minCost, declineLabel: 'しない' }));
        return a.map(function (i) { return cands[i].instanceId; });
      },

      chooseDeckLookAttack: function (cands) {
        if (!cands.length) return null;
        var a = ask(q({ kind: 'FREE_PLAY', type: 'CARDS', title: 'コストを支払わずにプレイするアタックカードを選んでください', cards: cardList(cands), min: 0, max: 1, preselect: [0], declineLabel: 'プレイしない' }));
        return a.length ? cands[a[0]].instanceId : null;
      },

      chooseFreePlayFromHand: function (cands, costLimit) {
        if (!cands.length) return [];
        var a = ask(q({ kind: 'FREE_PLAY', type: 'CARDS', title: 'コストを支払わずにプレイするメモリアを選んでください（コスト合計' + costLimit + '以下・選んだ順にプレイ）', cards: cardList(cands), min: 0, max: cands.length, costMax: costLimit, ordered: true, declineLabel: 'プレイしない' }));
        return a.map(function (i) { return cands[i].instanceId; });
      },

      chooseDeckLookPlay: function (cands) {
        if (!cands.length) return null;
        var a = ask(q({ kind: 'FREE_PLAY', type: 'CARDS', title: 'コストを支払わずにプレイするメモリアを選んでください', cards: cardList(cands), min: 0, max: 1, preselect: [0], declineLabel: 'プレイしない' }));
        return a.length ? cands[a[0]].instanceId : null;
      },

      chooseReplayFromPlayArea: function (cands, maxCount) {
        if (!cands.length) return [];
        var a = ask(q({ kind: 'FREE_PLAY', type: 'CARDS', title: 'プレイし直すメモリアを選んでください（最大' + maxCount + '枚）', cards: cardList(cands), min: 0, max: maxCount, preselect: firstN(maxCount, cands.length), declineLabel: 'しない' }));
        return a.map(function (i) { return cands[i].instanceId; });
      },

      chooseDistributedHeal: function (candidates, total) {
        if (!candidates.length) return [];
        if (candidates.length === 1) return [{ playerId: candidates[0].playerId, leaderIndex: candidates[0].leaderIndex, amount: total }];
        var amounts = ask(q({ kind: 'HEAL_ALLOC', type: 'ALLOCATE', title: '合計' + total + 'の回復を割り振ってください', candidates: candidates, total: total, step: 10 }));
        return candidates.map(function (c, i) { return { playerId: c.playerId, leaderIndex: c.leaderIndex, amount: amounts[i] || 0 }; })
          .filter(function (x) { return x.amount > 0; });
      },

      chooseMoveEquipment: function (cands, leaderIndexes) {
        var pid = owner();
        var a = ask(q({
          kind: 'MOVE_EQUIP', type: 'CARDS', title: '移動する装備を選んでください（移動しない場合は「しない」）', min: 0, max: 1, declineLabel: 'しない',
          cards: cands.map(function (c) { return { instanceId: c.equip.instanceId, cardId: c.equip.cardId, equippedTo: { playerId: pid, leaderIndex: c.leaderIndex } }; }),
        }));
        if (!a.length) return null;
        var from = cands[a[0]];
        var dests = leaderIndexes.filter(function (i) { return i !== from.leaderIndex; }).map(function (i) { return { playerId: pid, leaderIndex: i }; });
        if (!dests.length) return null;
        var b = dests.length === 1 ? [0] : ask(q({ kind: 'MOVE_EQUIP_DEST', type: 'LEADERS', title: '装備の移動先のリーダーを選んでください', candidates: dests, min: 1, max: 1 }));
        return { candidateIndex: a[0], toLeaderIndex: dests[b[0]].leaderIndex };
      },

      // 〖アタックする〗で手札を捨てる（大黒柱・CLUTCH!!!等は最大1枚、オーバードライブは最大2枚）
      chooseAttackDiscard: function (cands, spec) {
        var title = spec && spec.bonus
          ? '捨てるカードを選んでください（捨てるとダメージ+' + spec.bonus + '。捨てない場合は「しない」）'
          : '公開して捨てるカードを選んでください（最大' + spec.max + '枚。0枚でもよい）';
        var a = ask(q({ kind: 'ATTACK_DISCARD', type: 'CARDS', title: title, cards: cardList(cands), min: 0, max: spec.max, declineLabel: spec && spec.bonus ? 'しない' : '捨てない' }));
        return a.map(function (i) { return cands[i].instanceId; });
      },

      // はい／いいえ（仁義なき抗争「手札を1枚ランダムに捨ててもよい」）
      chooseConfirm: function (info) {
        var a = ask(q({ kind: 'CONFIRM', type: 'OPTIONS', title: info.title, options: [{ label: 'はい' }, { label: 'いいえ' }] }));
        return a[0] === 0;
      },

      // カードタイプの宣言（運命のルーレット）
      chooseDeclareCardType: function (types) {
        var label = { MEMORIA: 'メモリアカード', ATTACK: 'アタックカード' };
        var a = ask(q({ kind: 'DECLARE_TYPE', type: 'OPTIONS', title: '宣言するカードタイプを選んでください', options: types.map(function (t) { return { label: label[t] || t, value: t }; }) }));
        return types[a[0]];
      },

      chooseDiscard: function (hand, count, playerId) {
        if (hand.length <= count) return hand.map(function (c) { return c.instanceId; });
        var a = ask(q({ kind: 'DISCARD', type: 'CARDS', title: '手札から捨てるカードを' + count + '枚選んでください', cards: cardList(hand), min: count, max: count, chooser: playerId, secret: playerId !== env.getActivePlayerId() }));
        return a.map(function (i) { return hand[i].instanceId; });
      },
    };
  }

  // 終了フェイズの手札上限（7枚）で捨てるカードの選択（Phases.runEndPhaseのhandDiscardChooserFn）
  function makeHandLimitChooser(ask, playerId) {
    return function (hand, overflow) {
      var a = ask({ kind: 'HAND_LIMIT', type: 'CARDS', chooser: playerId, source: null, preselect: [], title: '手札が上限（7枚）を超えています。捨てるカードを' + overflow + '枚選んでください', cards: hand.map(function (c) { return { instanceId: c.instanceId, cardId: c.cardId }; }), min: overflow, max: overflow });
      return a.map(function (i) { return hand[i].instanceId; });
    };
  }

  // 画面での選択内容が質問の条件を満たすか。cardIndex はコスト条件の判定に使う。
  function validateSelection(question, selection, cardIndex) {
    if (question.type === 'OPTIONS') return { ok: selection.length === 1 };
    if (question.type === 'ALLOCATE') {
      var sum = selection.reduce(function (s, x) { return s + (x || 0); }, 0);
      return { ok: sum > 0 && sum <= question.total, sum: sum };
    }
    var n = selection.length;
    if (n < question.min || n > question.max) return { ok: false };
    if (question.type === 'CARDS' && (question.costMin != null || question.costMax != null) && n > 0) {
      var cost = selection.reduce(function (s, i) {
        var c = question.cards[i];
        var cd = cardIndex && cardIndex[c.cardId];
        return s + (c.cost != null ? c.cost : (cd && cd.cost) || 0);
      }, 0);
      if (question.costMin != null && cost < question.costMin) return { ok: false, cost: cost };
      if (question.costMax != null && cost > question.costMax) return { ok: false, cost: cost };
      return { ok: true, cost: cost };
    }
    return { ok: true };
  }

  return {
    deepClone: deepClone,
    seededRandom: seededRandom,
    runWithAnswers: runWithAnswers,
    makeCallbacks: makeCallbacks,
    makeHandLimitChooser: makeHandLimitChooser,
    validateSelection: validateSelection,
  };
}));
