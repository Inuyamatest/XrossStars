/* Xross Stars ゲームエンジン — Effect Resolver（Phase A：汎用Effect Engine本体）
 *
 * 根拠: docs/xross-stars-game-spec.md 26〜28章 / docs/game-engine-architecture.md 10〜11章
 *
 * 役割:
 *   カードデータ（cardId） → cardEffectData.js の CardEffect[] → 本ファイルのApply処理 → GameState変更
 *
 * 既存ファイル（events.js / resolutionStack.js / deck.js / combat.js / phases.js / match.js）は
 * 一切変更しない。本ファイルはそれらの上に乗る「効果対応レイヤー」として、既存の公開APIだけを
 * 呼び出して統合する。
 *
 * 例外（Phase C, 最小限の1関数のみ）: gameState.js の getLeaderMaxHp() には、装備による
 * 最大HP修正（leader.equipment[].hpModifier の合計）を加算する変更を行った。
 * これはRule Layer（gameState.js/combat.js）がCard Effect Layer（本ファイル）を一切知らないまま、
 * 装備時に本ファイルが装備インスタンスへ書き込んだ「ただの数値」を合算するだけの変更であり、
 * combat.js自体は無改修のままダウン判定に装備が反映されるようになる（詳細は関数コメント参照）。
 *
 * Action は最小限のみ実装する（Phase Bの代表カード＋Phase D-1で追加した分だけ）:
 *   DRAW, DAMAGE, HEAL, RECOVER_PP, ATTACK_DAMAGE_BONUS, EQUIP_HP_MODIFIER, EQUIP_ATK_MODIFIER,
 *   DISCARD_HAND, MULTI
 * 未知のActionTypeは黙って無視せず例外にする（安全側。カード追加時の設定ミスに気付ける）。
 *
 * Phase D-1（最小限の追加）: gameState.js の getLeaderCurrentAtk() にも、getLeaderMaxHp()と
 * 完全に対称の装備ATK修正（leader.equipment[].atkModifier の合計）を加算する変更を行った。
 * combat.js は今回も無改修（getLeaderCurrentAtkを呼ぶだけなので自動的に反映される）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('./gameState.js'),
      require('./events.js'),
      require('./resolutionStack.js'),
      require('./deck.js'),
      require('./combat.js'),
      require('./phases.js'),
      require('./cardEffect.js'),
      require('./cardEffectData.js'),
      require('./effectFactories.js'),
      require('./match.js')
    );
  } else {
    root.XS_ENGINE_EFFECT_RESOLVER = factory(
      root.XS_ENGINE_STATE, root.XS_ENGINE_EVENTS, root.XS_ENGINE_RESOLUTION_STACK,
      root.XS_ENGINE_DECK, root.XS_ENGINE_COMBAT, root.XS_ENGINE_PHASES,
      root.XS_ENGINE_CARD_EFFECT, root.XS_ENGINE_CARD_EFFECT_DATA, root.XS_ENGINE_EFFECT_FACTORIES,
      root.XS_ENGINE_MATCH
    );
  }
}(typeof self !== 'undefined' ? self : this, function (
  GameState, Events, ResolutionStack, Deck, Combat, Phases, CardEffectCore, CardEffectData, EffectFactories, Match
) {
  'use strict';

  var effectIdCounter = 0;
  function nextEffectId() { effectIdCounter += 1; return 'effect#' + effectIdCounter; }

  // いま解決中の効果の情報（UIの選択画面で「どのカードの効果か」を表示するため）。
  // PendingEffect.resolve()の実行中だけ値が入る。ルール処理はこの値を参照しない。
  var resolvingEffect = null;
  function getResolvingEffect() { return resolvingEffect; }
  function withResolvingEffect(info, fn) {
    var prev = resolvingEffect;
    resolvingEffect = info;
    try { return fn(); } finally { resolvingEffect = prev; }
  }

  // ---- Action適用（GameState変更の実体）----
  // targets: LeaderRef[]（{playerId, leaderIndex}）。actionによっては使わない（DRAW/RECOVER_PP等）。
  function applyAction(state, action, targets, ctx, cardIndex) {
    if (!action) return state;

    switch (action.type) {
      case 'DRAW':
        // action.who: 'ALL'（「すべてのプレイヤーはカードを1枚引く」）。省略時は自分。
        if (action.who === 'ALL') {
          [ctx.ownerPlayerId, GameState.getOpponentId(ctx.ownerPlayerId)].forEach(function (pid) { Deck.drawCards(state, pid, action.amount); });
        } else {
          Deck.drawCards(state, ctx.ownerPlayerId, action.amount);
        }
        return state;

      case 'RECOVER_PP': {
        var player = state.players[ctx.ownerPlayerId];
        var recover = Math.min(action.amount, player.ppCards.tapped); // FAQ Q9: 乗っている分以上は回復しない
        player.ppCards.tapped -= recover;
        return state;
      }

      case 'HEAL':
        (targets || []).forEach(function (ref) {
          var leader = state.players[ref.playerId].leaders[ref.leaderIndex];
          leader.damage = Math.max(0, leader.damage - action.amount); // FAQ Q9: ダメージカウンター以上は回復しない
        });
        return state;

      case 'DAMAGE': {
        // Phase D-3: action.amountは数値のほか、{type:'DERIVED_AMOUNT', source}も受け付ける
        // （ドレインロッドの「回復した数値と同じダメージ」用）。既存の数値指定は完全に後方互換。
        var damageAmount = resolveActionAmount(action.amount, ctx);
        (targets || []).forEach(function (ref) {
          dealDamageAndCheckDown(state, ref, damageAmount, cardIndex, ctx);
        });
        return state;
      }

      case 'MULTI':
        (action.actions || []).forEach(function (sub) { applyAction(state, sub, targets, ctx, cardIndex); });
        return state;

      case 'TEMP_ATK_MODIFIER':
        // duration（いつ消えるか）はPROVISIONAL（ruleConfig.js参照）。leader.tempAtkModifierへ加算するだけで、
        // 実際のクリアはendTurnAndSwitchWithEffects/processRoundEndWithEffectsが行う。
        (targets || []).forEach(function (ref) {
          var leader = state.players[ref.playerId].leaders[ref.leaderIndex];
          leader.tempAtkModifier = (leader.tempAtkModifier || 0) + action.amount;
        });
        return state;

      case 'DISTRIBUTED_HEAL': {
        // Phase D-3: 対象は常に「自分の生存リーダー」（実在3枚すべてで確認済みのため、
        // MULTI内で別対象〔相手リーダー〕を必要とするDAMAGEと衝突しないよう、
        // cardEffect.targetの解決結果（targets引数）には依存せず内部で直接解決する。
        var healCandidates = EffectFactories.makeAllOwnAliveLeadersTarget()(state, ctx);
        var healedTotal = applyDistributedHeal(state, ctx, action.total, healCandidates);
        // DERIVED_AMOUNTが参照する解決中一時領域（このPendingEffectのresolve()呼び出し内でのみ有効）
        ctx.derivedValues = ctx.derivedValues || {};
        ctx.derivedValues.lastDistributedHealTotal = healedTotal;
        return state;
      }

      case 'MOVE_EQUIPMENT':
        moveEquipment(state, ctx);
        return state;

      case 'DISCARD_HAND': {
        // action.who: 'SELF' | 'OPPONENT' | 'ALL'（省略時はSELF）。Target APIはLeader用の形（{playerId,leaderIndex}）
        // なので流用せず、既存のRECOVER_PP同様「誰の手札か」をActionのフィールドで直接指定する。
        var discardPlayerIds;
        if (action.who === 'ALL') discardPlayerIds = ['playerA', 'playerB'];
        else if (action.who === 'OPPONENT') discardPlayerIds = [GameState.getOpponentId(ctx.ownerPlayerId)];
        else discardPlayerIds = [ctx.ownerPlayerId];
        discardPlayerIds.forEach(function (pid) { discardFromHand(state, pid, action.amount, ctx); });
        return state;
      }

      case 'FREE_PLAY_MEMORIA_FROM_HAND': {
        // Phase G: 一騎当千「自分の手札のエース以外のメモリアカードを、コストの合計がaction.costLimit以下に
        // なるように好きな枚数公開する。公開したカードを、コストを支払わず好きな順番でプレイする。」
        // PROVISIONAL: 選択はctx.chooseFreePlayFromHand(candidates, costLimit, state) => instanceId[]（順序＝プレイ順）に
        // 委ねる。省略時は「してもよい」を辞退したものとして何もしない。コスト合計超過分・重複・不正な
        // instanceIdは安全に無視する（申告どおりに信頼せず、こちら側で合計を再計算して打ち切る）。
        var freePlayer = state.players[ctx.ownerPlayerId];
        // コスト未確定（null）のカードは「card.cost || 0」でコスト0扱いにすると、コスト合計の
        // 判定を誤って通してしまう（実データで確認された不具合と同種）ため、候補から除外する。
        var freeCandidates = freePlayer.hand.filter(function (c) {
          var cd = ctx.cardIndex[c.cardId];
          return cd && cd.cardType === 'MEMORIA' && cd.ace !== true && typeof cd.cost === 'number';
        }).map(function (c) { return { instanceId: c.instanceId, cardId: c.cardId, cost: ctx.cardIndex[c.cardId].cost }; });
        if (freeCandidates.length === 0) return state;
        var chosenFreeIds = (ctx.chooseFreePlayFromHand ? ctx.chooseFreePlayFromHand(freeCandidates.slice(), action.costLimit, state) : []) || [];
        var freeTotalCost = 0;
        var seenFreeIds = {};
        chosenFreeIds.forEach(function (instanceId) {
          if (seenFreeIds[instanceId]) return;
          var cand = freeCandidates.find(function (c) { return c.instanceId === instanceId; });
          if (!cand) return; // 候補にないIDは無視
          if (freeTotalCost + cand.cost > action.costLimit) return; // 上限超過分は無視（安全側）
          seenFreeIds[instanceId] = true;
          freeTotalCost += cand.cost;
          var idx = freePlayer.hand.findIndex(function (c) { return c.instanceId === instanceId; });
          if (idx < 0) return;
          var instance = freePlayer.hand.splice(idx, 1)[0];
          playMemoriaForFreeAndQueueEffects(state, ctx.ownerPlayerId, instance, cardIndex, pickChoiceCallbacks(ctx));
        });
        return state;
      }

      case 'DECK_LOOK_FREE_PLAY_MEMORIA': {
        // Phase G: リンク・アサルト「自分のデッキの上から{action.count}枚を見る。その中からコスト
        // {action.maxCost}以下のメモリアカード1枚を、コストを支払わずにプレイしてもよい。残りのカードを
        // トラッシュに置く。」PROVISIONAL: 選択はctx.chooseDeckLookPlay(candidates, state) => instanceId|null
        // に委ねる（省略時・null＝辞退）。見た残り（プレイした1枚以外）は裏向きでトラッシュへ置く
        // （ruleConfig.js deckLookTrashOrientation参照。公式資料に表裏の明記なし）。
        var deckLookPlayer = state.players[ctx.ownerPlayerId];
        var revealed = deckLookPlayer.deck.splice(0, Math.min(action.count, deckLookPlayer.deck.length));
        // コスト未確定（null）のカードは対象外にする（(cd.cost || 0)だと誤って0扱いになってしまう）。
        var deckLookCandidates = revealed.filter(function (c) {
          var cd = ctx.cardIndex[c.cardId];
          return cd && cd.cardType === 'MEMORIA' && typeof cd.cost === 'number' && cd.cost <= action.maxCost;
        }).map(function (c) { return { instanceId: c.instanceId, cardId: c.cardId }; });
        var chosenId = (deckLookCandidates.length > 0 && ctx.chooseDeckLookPlay) ? ctx.chooseDeckLookPlay(deckLookCandidates.slice(), state) : null;
        var chosenCard = chosenId ? revealed.find(function (c) { return c.instanceId === chosenId; }) : null;
        revealed.forEach(function (c) {
          if (chosenCard && c.instanceId === chosenCard.instanceId) return;
          deckLookPlayer.trash.push({ card: c, faceUp: false });
        });
        if (chosenCard) {
          playMemoriaForFreeAndQueueEffects(state, ctx.ownerPlayerId, chosenCard, cardIndex, pickChoiceCallbacks(ctx));
        }
        return state;
      }

      case 'REPLAY_SELECTED_FROM_PLAY_AREA': {
        // Phase G: 三銃士「プレイエリアのエース以外のコスト{action.maxCost}のメモリアカードを最大
        // {action.maxCount}枚選び、プレイし直す。」対象カードはプレイエリアから移動しない（そのまま）。
        // PROVISIONAL: 再トリガーするのはON_PLAY効果のみとする（ATTACK_BOOST/AFTER_ATTACKへの
        // 再リンクは、公式資料に「プレイし直す」の対象Trigger範囲の明記が無いため見送る）。
        // 選択はctx.chooseReplayFromPlayArea(candidates, maxCount, state) => instanceId[]に委ねる
        // （省略時は「してもよい」を辞退）。
        var replayPlayer = state.players[ctx.ownerPlayerId];
        // maxCostが指定されている場合、コスト未確定（null）のカードは満たすかどうか判定できないため対象外にする
        // （(cd.cost || 0)だと誤って0扱いになってしまう）。maxCost自体が無い場合はコストを問わないので影響しない。
        var replayCandidates = replayPlayer.playArea.filter(function (entry) {
          var cd = ctx.cardIndex[entry.card.cardId];
          return cd && cd.cardType === 'MEMORIA' && cd.ace !== true &&
            (action.maxCost == null || (typeof cd.cost === 'number' && cd.cost <= action.maxCost));
        }).map(function (entry) { return { instanceId: entry.card.instanceId, cardId: entry.card.cardId }; });
        if (replayCandidates.length === 0) return state;
        var chosenReplayIds = (ctx.chooseReplayFromPlayArea ? ctx.chooseReplayFromPlayArea(replayCandidates.slice(), action.maxCount, state) : []) || [];
        var seenReplayIds = {};
        chosenReplayIds.slice(0, action.maxCount).forEach(function (instanceId) {
          if (seenReplayIds[instanceId]) return;
          seenReplayIds[instanceId] = true;
          var cand = replayCandidates.find(function (c) { return c.instanceId === instanceId; });
          if (!cand) return;
          queueOnPlayEffects(state, ctx.ownerPlayerId, { instanceId: cand.instanceId, cardId: cand.cardId }, cardIndex, pickChoiceCallbacks(ctx));
        });
        return state;
      }

      case 'DECK_LOOK_ADD_TO_HAND': {
        // 第5弾ACE アブソリュートドミニオン／BP04-028 シンクロトリニティ／BP04-079 討伐クエスト：
        // 「自分のデッキの上から{count}枚を見る。その中から{filter}のカードを（最大）{maxPick}枚手札に加える。
        //  残りのカードをトラッシュに置く。」
        // action: { count, maxPick, minPick?, filter?: { cardType?, cost?, excludeAce? } }
        // 選択はctx.chooseDeckLookAddToHand(candidates, maxPick, state) => instanceId[]。
        // PROVISIONAL（ruleConfig.js bp05AcePolicy）: コールバック省略時は先頭から上限まで手札に加える
        // （手札に加えるだけで失うものが無いため、FREE_PLAY系の「辞退」とは既定を変えている）。
        // minPick（「手札に加える」と義務になっている討伐クエスト）は、選択が足りなければ先頭から補う。
        var lookPlayer = state.players[ctx.ownerPlayerId];
        var looked = lookPlayer.deck.splice(0, Math.min(action.count, lookPlayer.deck.length));
        var filter = action.filter || {};
        var addCandidates = looked.filter(function (c) {
          var cd = ctx.cardIndex[c.cardId];
          if (!cd) return false;
          if (filter.cardType && cd.cardType !== filter.cardType) return false;
          if (filter.cost != null && cd.cost !== filter.cost) return false; // コスト未確定（null）は一致しない
          if (filter.excludeAce && cd.ace === true) return false;
          return true;
        }).map(function (c) { return { instanceId: c.instanceId, cardId: c.cardId }; });
        var pickIds = ctx.chooseDeckLookAddToHand
          ? (ctx.chooseDeckLookAddToHand(addCandidates.slice(), action.maxPick, state) || [])
          : addCandidates.map(function (c) { return c.instanceId; });
        var picked = [];
        pickIds.forEach(function (id) {
          if (picked.length >= action.maxPick || picked.indexOf(id) >= 0) return;
          if (addCandidates.some(function (c) { return c.instanceId === id; })) picked.push(id);
        });
        var minPick = Math.min(action.minPick || 0, addCandidates.length);
        addCandidates.forEach(function (c) {
          if (picked.length < minPick && picked.indexOf(c.instanceId) < 0) picked.push(c.instanceId);
        });
        looked.forEach(function (c) {
          if (picked.indexOf(c.instanceId) >= 0) {
            lookPlayer.hand.push(c);
            Events.logEvent(state, 'CARD_ADDED_TO_HAND_BY_EFFECT', { playerId: ctx.ownerPlayerId, cardId: c.cardId });
          } else {
            lookPlayer.trash.push({ card: c, faceUp: false });
          }
        });
        return state;
      }

      case 'OPTIONAL_SELF_DAMAGE_THEN': {
        // 第5弾ACE 共に至る極致「自分の体力{minHp}以上のリーダー1体に{amount}ダメージを与えてもよい。
        // そうしたなら、{then}」。選択はctx.chooseSelfDamage(candidates, state) => index（-1/null＝辞退）。
        // コールバック省略時は辞退（自分のリーダーが傷つくコストを伴う「してもよい」のため）。
        // 「体力」は現在の残り体力（装備修正込み）で判定する（PROVISIONAL、ruleConfig.js bp05AcePolicy）。
        var selfCandidates = [];
        state.players[ctx.ownerPlayerId].leaders.forEach(function (l, i) {
          if (!l.isDown && GameState.getLeaderCurrentHp(cardIndex, l) >= action.minHp) selfCandidates.push({ playerId: ctx.ownerPlayerId, leaderIndex: i });
        });
        if (selfCandidates.length === 0 || !ctx.chooseSelfDamage) return state;
        var selfPick = ctx.chooseSelfDamage(selfCandidates.slice(), state);
        if (selfPick == null || selfPick < 0 || selfPick >= selfCandidates.length) return state;
        dealDamageAndCheckDown(state, selfCandidates[selfPick], action.amount, cardIndex, null);
        if (action.then) applyAction(state, action.then, [], ctx, cardIndex);
        return state;
      }

      case 'DISCARD_COST_THEN_DECK_LOOK_FREE_ATTACK': {
        // 第5弾ACE 頂点捕食者「自分の手札のカードを、コストの合計が{minDiscardCost}以上になるように好きな枚数
        // 公開し、捨ててもよい。そうしたなら自分のデッキの上から{count}枚を見る。その中からコスト{maxCost}以下の
        // 「{excludeName}」以外のアタックカード1枚を、コストを支払わずにプレイしてもよい。残りのカードを
        // トラッシュに置く。（プレイしたカードの効果は、このアタックが終わってから実行する。）」
        // 捨てる選択: ctx.chooseApexDiscard(candidates, minDiscardCost, state) => instanceId[]（省略時は辞退）。
        //   合計コストが足りない選択は「しなかった」扱い（何も捨てない）。コスト未確定のカードは候補外。
        // プレイする選択: ctx.chooseDeckLookAttack(candidates, state) => instanceId|null（省略時は先頭の候補。
        //   手札を捨てるコストを既に払った後なので、既定ではプレイする側に倒す。PROVISIONAL）。
        // 選んだアタックは「このアタックが終わってから」実行するため、ResolutionStackの末尾に積む
        // （FIFOなので、このアタックで既に積まれている他の効果がすべて解決した後にアタックが行われる）。
        var apexPlayer = state.players[ctx.ownerPlayerId];
        var discardCandidates = apexPlayer.hand.filter(function (c) {
          var cd = ctx.cardIndex[c.cardId];
          return cd && typeof cd.cost === 'number';
        }).map(function (c) { return { instanceId: c.instanceId, cardId: c.cardId, cost: ctx.cardIndex[c.cardId].cost }; });
        var discardIds = ctx.chooseApexDiscard ? (ctx.chooseApexDiscard(discardCandidates.slice(), action.minDiscardCost, state) || []) : [];
        var discardChosen = [];
        discardIds.forEach(function (id) {
          if (discardChosen.some(function (c) { return c.instanceId === id; })) return;
          var cand = discardCandidates.find(function (c) { return c.instanceId === id; });
          if (cand) discardChosen.push(cand);
        });
        var discardTotal = discardChosen.reduce(function (sum, c) { return sum + c.cost; }, 0);
        if (discardChosen.length === 0 || discardTotal < action.minDiscardCost) return state; // しなかった
        discardChosen.forEach(function (cand) {
          var hIdx = apexPlayer.hand.findIndex(function (c) { return c.instanceId === cand.instanceId; });
          var discarded = apexPlayer.hand.splice(hIdx, 1)[0];
          apexPlayer.trash.push({ card: discarded, faceUp: false });
          Events.logEvent(state, 'CARD_DISCARDED_BY_EFFECT', { playerId: ctx.ownerPlayerId, cardId: discarded.cardId });
        });

        var apexLooked = apexPlayer.deck.splice(0, Math.min(action.count, apexPlayer.deck.length));
        var attackCandidates = apexLooked.filter(function (c) {
          var cd = ctx.cardIndex[c.cardId];
          return cd && cd.cardType === 'ATTACK' && typeof cd.cost === 'number' && cd.cost <= action.maxCost && cd.name !== action.excludeName;
        }).map(function (c) { return { instanceId: c.instanceId, cardId: c.cardId }; });
        var chosenAttackId = null;
        if (attackCandidates.length > 0) {
          chosenAttackId = ctx.chooseDeckLookAttack ? ctx.chooseDeckLookAttack(attackCandidates.slice(), state) : attackCandidates[0].instanceId;
          if (!attackCandidates.some(function (c) { return c.instanceId === chosenAttackId; })) chosenAttackId = null;
        }
        var chosenAttack = null;
        apexLooked.forEach(function (c) {
          if (c.instanceId === chosenAttackId) chosenAttack = c;
          else apexPlayer.trash.push({ card: c, faceUp: false });
        });
        if (chosenAttack) {
          ResolutionStack.push(state.resolutionStack, buildDeferredFreeAttack(chosenAttack, ctx, cardIndex));
        }
        return state;
      }

      case 'DRAW_PER_PLAY_AREA_MEMORIA_COST': {
        // 頂きの景色「プレイエリアにあるメモリアカードのコストの合計と同じ数のカードを引く。」
        var costSum = state.players[ctx.ownerPlayerId].playArea.reduce(function (sum, e) {
          var cd = ctx.cardIndex[e.card.cardId];
          return (cd && cd.cardType === 'MEMORIA' && typeof cd.cost === 'number') ? sum + cd.cost : sum;
        }, 0);
        if (costSum > 0) Deck.drawCards(state, ctx.ownerPlayerId, costSum);
        return state;
      }

      case 'RECYCLE_FACE_DOWN_TRASH': {
        // アイテムショップ「自分のトラッシュの裏向きのカードすべてを自分のデッキに加え、自分のデッキをシャッフルする。」
        var recyclePlayer = state.players[ctx.ownerPlayerId];
        var faceDown = recyclePlayer.trash.filter(function (t) { return !t.faceUp; });
        recyclePlayer.trash = recyclePlayer.trash.filter(function (t) { return t.faceUp; });
        recyclePlayer.deck = Deck.shuffle(recyclePlayer.deck.concat(faceDown.map(function (t) { return t.card; })));
        Events.logEvent(state, 'DECK_RESHUFFLED_FROM_TRASH', { playerId: ctx.ownerPlayerId, count: faceDown.length });
        return state;
      }

      case 'DECLARE_TYPE_REVEAL_DRAW': {
        // 運命のルーレット「メモリアカードかアタックカードのどちらかを宣言し、自分のデッキの上から1枚を公開する。
        // そのカードが宣言したカードタイプならカードを{draw}枚引く。それ以外なら公開したカードをトラッシュに置く。」
        // 宣言はctx.chooseDeclareCardType(['MEMORIA','ATTACK'], state)。省略時はアタックカードを宣言（PROVISIONAL）。
        var declared = ctx.chooseDeclareCardType ? ctx.chooseDeclareCardType(['MEMORIA', 'ATTACK'], state) : 'ATTACK';
        var rPlayer = state.players[ctx.ownerPlayerId];
        if (rPlayer.deck.length === 0) return state;
        var revealedTop = rPlayer.deck[0];
        var revealedCard = ctx.cardIndex[revealedTop.cardId];
        Events.logEvent(state, 'CARD_REVEALED_BY_EFFECT', { playerId: ctx.ownerPlayerId, cardId: revealedTop.cardId, declared: declared });
        if (revealedCard && revealedCard.cardType === declared) {
          Deck.drawCards(state, ctx.ownerPlayerId, action.draw); // 公開したカードは上にあるので、そのまま引く1枚目になる
        } else {
          rPlayer.deck.shift();
          rPlayer.trash.push({ card: revealedTop, faceUp: false });
        }
        return state;
      }

      case 'ATTACK_DAMAGE_BONUS':
      case 'EQUIP_HP_MODIFIER':
      case 'EQUIP_ATK_MODIFIER':
      case 'EQUIP_GRANT_ABILITY':
      case 'MULTI_ATTACK':
        // これらはdeclareAttackWithEffects/getEffectiveMaxHp/getEquipmentAtkModifier/
        // computeGrantedAbilitiesForCard/getMultiAttackCountが個別に参照する値であり、
        // 「即時にGameStateを書き換えるAction」としては扱わない。ここに来た場合は呼び出し側の誤りとする。
        throw new Error(action.type + ' はapplyAction()ではなく専用の計算関数から参照してください');

      default:
        throw new Error('未知のActionTypeです（cardEffectData.jsの設定を確認してください）: ' + action.type);
    }
  }

  // 頂点捕食者：デッキから選んだアタックカードを「このアタックが終わってから」コストを支払わずにプレイする
  // PendingEffect。解決時点で、元のアタッカーが生存していればそのリーダーで、ダウンしていれば生存している
  // 先頭のリーダーでアタックする。アタックを受けるリーダーはctx.chooseFreeAttackTarget(candidates, state) => index
  // （省略時は元のアタックを受けたリーダー、ダウンしていれば生存している先頭のリーダー）。
  // アタッカー/対象がいない場合はプレイできないため、そのカードは裏向きでトラッシュに置く（PROVISIONAL）。
  function buildDeferredFreeAttack(cardInstance, ctx, cardIndex) {
    return {
      id: nextEffectId(),
      sourceInstanceId: ctx.sourceInstanceId,
      trigger: 'AFTER_ATTACK',
      ownerPlayerId: ctx.ownerPlayerId,
      condition: null,
      resolve: function (state) {
        return withResolvingEffect({ sourceInstanceId: cardInstance.instanceId, cardId: cardInstance.cardId, trigger: 'FREE_ATTACK', ownerPlayerId: ctx.ownerPlayerId }, function () {
          return resolveDeferredFreeAttack(state, cardInstance, ctx, cardIndex);
        });
      },
    };
  }

  function resolveDeferredFreeAttack(state, cardInstance, ctx, cardIndex) {
    var ownerId = ctx.ownerPlayerId;
    var player = state.players[ownerId];
    var targetPlayerId = GameState.getOpponentId(ownerId);
    var attackerIndex = ctx.attackerLeaderIndex;
    if (attackerIndex == null || !player.leaders[attackerIndex] || player.leaders[attackerIndex].isDown) {
      attackerIndex = player.leaders.findIndex(function (l) { return !l.isDown; });
    }
    var targetCandidates = [];
    state.players[targetPlayerId].leaders.forEach(function (l, i) { if (!l.isDown) targetCandidates.push({ playerId: targetPlayerId, leaderIndex: i }); });
    if (attackerIndex < 0 || targetCandidates.length === 0) {
      player.trash.push({ card: cardInstance, faceUp: false });
      return state;
    }
    var targetPick = ctx.chooseFreeAttackTarget
      ? ctx.chooseFreeAttackTarget(targetCandidates.slice(), state)
      : targetCandidates.findIndex(function (c) { return c.leaderIndex === ctx.targetLeaderIndex; });
    if (targetPick == null || targetPick < 0 || targetPick >= targetCandidates.length) targetPick = 0;
    var targetIndex = targetCandidates[targetPick].leaderIndex;

    player.hand.push(cardInstance); // playAttackCardWithEffectsは手札のカードを対象にするため一時的に手札を経由する
    Events.logEvent(state, 'FREE_ATTACK_PLAYED_BY_EFFECT', { playerId: ownerId, cardId: cardInstance.cardId });
    var freeOptions = {
      freePlay: true,
      attackerLeaderIndex: attackerIndex,
      targetPlayerId: targetPlayerId,
      targetLeaderIndex: targetIndex,
    };
    Object.assign(freeOptions, pickChoiceCallbacks(ctx));
    var count = getMultiAttackCount(cardInstance.cardId);
    if (count) {
      freeOptions.attacks = [];
      for (var i = 0; i < count; i++) freeOptions.attacks.push({ attackerLeaderIndex: attackerIndex, targetPlayerId: targetPlayerId, targetLeaderIndex: targetIndex });
    }
    playAttackCardWithEffects(state, ownerId, cardInstance.instanceId, freeOptions, cardIndex);
    return state;
  }

  // ダメージ処理＋ダウン判定＋（アタックに紐づく場合のみ）アタッカーの覚醒判定。
  // combat.js の declareAttack 内の相当処理と意図的に同じロジックだが、
  // 既存の combat.js を変更しないため、Card Effect Layer 側に独立して実装する
  // （spec 12-3章のとおり、AFTER_ATTACK効果によるダウンでもアタッカーは覚醒する）。
  function dealDamageAndCheckDown(state, targetRef, amount, cardIndex, ctx) {
    var target = state.players[targetRef.playerId].leaders[targetRef.leaderIndex];
    if (target.isDown) return false; // ダウン中はダメージを受けない（spec 3-2章）
    target.damage += amount;
    Events.logEvent(state, 'DAMAGE_DEALT', { playerId: targetRef.playerId, leaderIndex: targetRef.leaderIndex, amount: amount, source: 'CARD_EFFECT' });

    if (GameState.getLeaderCurrentHp(cardIndex, target) <= 0) {
      target.isDown = true;
      target.damage = 0;
      Events.logEvent(state, 'LEADER_DOWNED', { playerId: targetRef.playerId, leaderIndex: targetRef.leaderIndex });

      if (ctx && ctx.attackerPlayerId != null && ctx.attackerLeaderIndex != null) {
        var attacker = state.players[ctx.attackerPlayerId].leaders[ctx.attackerLeaderIndex];
        if (!attacker.awakened) {
          attacker.awakened = true;
          Events.logEvent(state, 'LEADER_AWAKENED', { playerId: ctx.attackerPlayerId, leaderIndex: ctx.attackerLeaderIndex });
        }
      }
      return true;
    }
    return false;
  }

  // ---- DERIVED_AMOUNT（Phase D-3）----
  // action.amountを実際の数値に解決する。プレーンな数値はそのまま返す（既存の全登録カードと完全互換）。
  // {type:'DERIVED_AMOUNT', source} の場合のみ、ctx.derivedValues（同一MULTI内の直前のActionが
  // 書き込んだ解決中の一時値）から値を取り出す。現時点で確認できている実カードの用法は
  // LAST_DISTRIBUTED_HEAL_TOTAL（ドレインロッド）のみ。
  function resolveActionAmount(amountSpec, ctx) {
    if (typeof amountSpec === 'number') return amountSpec;
    if (amountSpec && amountSpec.type === 'DERIVED_AMOUNT') {
      if (amountSpec.source === 'LAST_DISTRIBUTED_HEAL_TOTAL') {
        return (ctx.derivedValues && ctx.derivedValues.lastDistributedHealTotal) || 0;
      }
      throw new Error('未知のDERIVED_AMOUNT sourceです（cardEffectData.jsの設定を確認してください）: ' + amountSpec.source);
    }
    throw new Error('解決できないaction.amount指定です: ' + JSON.stringify(amountSpec));
  }

  // ---- DISTRIBUTED_HEAL（Phase D-3）----
  // PROVISIONAL: 「複数のリーダーを選んでもよい」の配分方法は公式資料に明記がない。
  // ctx.chooseDistributedHeal(candidates, total, state) => [{playerId, leaderIndex, amount}] が
  // 渡ればそれを使い、省略時は先頭候補1体に全量を割り当てる（均等配分ではない）。
  // 各配分は既存HEALと同じくFAQ Q9（ダメージカウンター以上は回復しない）に従い、
  // 実際に回復した量の合計だけをtotalの残り予算として消費する（過剰請求分は他へ繰り越さず失われる）。
  function applyDistributedHeal(state, ctx, total, candidates) {
    var allocations;
    if (ctx && typeof ctx.chooseDistributedHeal === 'function') {
      allocations = ctx.chooseDistributedHeal(candidates.slice(), total, state) || [];
    } else if (candidates.length > 0) {
      allocations = [{ playerId: candidates[0].playerId, leaderIndex: candidates[0].leaderIndex, amount: total }];
    } else {
      allocations = [];
    }

    var totalApplied = 0;
    allocations.forEach(function (alloc) {
      if (totalApplied >= total) return;
      var leader = state.players[alloc.playerId] && state.players[alloc.playerId].leaders[alloc.leaderIndex];
      if (!leader || leader.isDown) return; // 不正・無効な対象は安全に無視
      var requested = Math.min(alloc.amount, total - totalApplied);
      var actuallyHealed = Math.min(requested, leader.damage); // FAQ Q9類推：ダメージカウンター以上は回復しない
      if (actuallyHealed <= 0) return;
      leader.damage -= actuallyHealed;
      totalApplied += actuallyHealed;
    });
    return totalApplied;
  }

  // ---- MOVE_EQUIPMENT（Phase D-3）----
  // PROVISIONAL: 移動先の選択方法・未選択時の挙動（「してもよい」を辞退したものとして扱う）は
  // 公式資料に明記がない。同じEquipmentインスタンスをleader.equipment間でsplice/pushするだけで、
  // hpModifier/atkModifier/grantedAbilitiesは自動的に維持される（新しいinstanceIdは生成しない）。
  // ctx.chooseMoveEquipment(candidates, leaderIndexes, state) => {candidateIndex, toLeaderIndex} | null
  function moveEquipment(state, ctx) {
    var player = state.players[ctx.ownerPlayerId];
    var candidates = [];
    player.leaders.forEach(function (l, li) {
      (l.equipment || []).forEach(function (eq, ei) { candidates.push({ leaderIndex: li, equipIndex: ei, equip: eq }); });
    });
    if (candidates.length === 0) return; // 移動できる装備が無い→No-op
    if (typeof ctx.chooseMoveEquipment !== 'function') return; // PROVISIONAL: 未選択は「してもよい」の辞退として扱う

    var leaderIndexes = player.leaders.map(function (l, i) { return i; });
    var choice = ctx.chooseMoveEquipment(candidates.slice(), leaderIndexes, state);
    if (!choice) return; // 辞退

    var from = candidates[choice.candidateIndex];
    if (!from) return; // 不正な選択は安全に無視
    var toLeader = player.leaders[choice.toLeaderIndex];
    if (choice.toLeaderIndex == null || !toLeader || choice.toLeaderIndex === from.leaderIndex) return; // 不正な移動先（自分自身含む）

    var fromLeader = player.leaders[from.leaderIndex];
    var removed = fromLeader.equipment.splice(from.equipIndex, 1)[0];
    toLeader.equipment.push(removed);
  }

  // ---- TEMP_ATK_MODIFIER のクリア（Phase D-3）----
  // PROVISIONAL: 「このターン」が終わる契機をターン終了・ラウンド終了の両方とする
  // （ruleConfig.js参照）。phases.js/match.js自体は無改修で、それぞれを薄くラップして
  // クリア処理を追加する（Phase D-2監査でturnNumberがラウンドごとにリセットされることが
  // 判明したのと同じ理由で、ターン終了だけでなくラウンド終了時のクリアも必要）。
  // ---- エコー（第5弾 BP05-059 魔王再臨 / BP05-066 ハセシンの刑執行）----
  // 「自分のターン終了時、このカードが縦向きならトラッシュに置く代わりに、横向きにする。
  //  自分のメインフェイズ開始時、このカードが横向きならコストを支払わずに、横向きのままプレイし直す。」
  // 横向きはプレイエリアのエントリの echoHorizontal: true で表す。横向きのままプレイし直したカードは、
  // 次のターン終了時には横向きなので通常どおりトラッシュに置かれる（＝エコーは1回だけ繰り返す）。
  // ラウンド終了時のプレイエリア一掃（match.js resetForNextRound）はエコーの対象外とし、横向きのカードも
  // トラッシュに置く（PROVISIONAL、ruleConfig.js bp05AcePolicy.echoAtRoundEnd）。

  // Phases.runEndPhaseの代わりに呼ぶ。縦向きのエコーカードだけをプレイエリアに残して横向きにする。
  function runEndPhaseWithEffects(state, handDiscardChooserFn) {
    var player = state.players[state.turn.activePlayer];
    var kept = player.playArea.filter(function (entry) {
      return !entry.isTactics && !entry.echoHorizontal && CardEffectData.hasKeyword(entry.card.cardId, 'ECHO');
    });
    player.playArea = player.playArea.filter(function (entry) { return kept.indexOf(entry) < 0; });
    var result = Phases.runEndPhase(state, handDiscardChooserFn);
    kept.forEach(function (entry, i) {
      entry.echoHorizontal = true;
      entry.order = i;
      player.playArea.push(entry);
      Events.logEvent(state, 'ECHO_TURNED_HORIZONTAL', { playerId: state.turn.activePlayer, cardId: entry.card.cardId });
    });
    return result;
  }

  // Phases.runStartPhaseの代わりに呼ぶ。メインフェイズ開始時に、横向きのエコーカードをプレイし直し、
  // その効果（プレイ時・アタック強化・次のアタックに紐づくアタック後）を処理する。プレイ時効果は
  // 他の*WithEffects関数と同じくResolutionStackへ積むだけなので、呼び出し側が解決する。
  // extraCtx: 選択コールバック（chooseTarget等）。省略時は各Actionの既定の選択になる。
  function runStartPhaseWithEffects(state, cardIndex, extraCtx) {
    var result = Phases.runStartPhase(state);
    var playerId = state.turn.activePlayer;
    state.players[playerId].playArea.forEach(function (entry) {
      if (!entry.echoHorizontal) return;
      Events.logEvent(state, 'ECHO_REPLAYED', { playerId: playerId, cardId: entry.card.cardId });
      queueMemoriaPlayEffects(state, playerId, entry.card, cardIndex, extraCtx);
    });
    return result;
  }

  function clearTempAtkModifiers(state, playerId) {
    state.players[playerId].leaders.forEach(function (l) { l.tempAtkModifier = 0; });
  }

  function endTurnAndSwitchWithEffects(state) {
    var endingPlayerId = state.turn.activePlayer;
    var result = Phases.endTurnAndSwitch(state);
    clearTempAtkModifiers(state, endingPlayerId);
    return result;
  }

  function processRoundEndWithEffects(state, chooseIndexFn) {
    var result = Match.processRoundEnd(state, chooseIndexFn);
    if (result.roundEnded) {
      clearTempAtkModifiers(state, 'playerA');
      clearTempAtkModifiers(state, 'playerB');
    }
    return result;
  }

  // 指定プレイヤーの手札からamount枚を選んでトラッシュへ捨てる（DISCARD_HAND Actionの実体）。
  // 誰がどのカードを選ぶかはruleConfig.cardEffectDiscardChoice（PROVISIONAL）参照。
  // ctx.chooseDiscard(hand, count, playerId) => instanceId[] が渡されればそれを使い、
  // 省略時は既存のphases.js runEndPhase（手札上限処理）と同じデフォルト方針（末尾から自動選択）に揃える。
  // 手札が指定枚数未満でもクラッシュさせず、あるだけ捨てる（PROVISIONAL、FAQ Q9の考え方からの類推）。
  function discardFromHand(state, playerId, amount, ctx) {
    var player = state.players[playerId];
    var count = Math.min(amount, player.hand.length);
    if (count <= 0) return state;

    var toDiscardIds;
    if (ctx && typeof ctx.chooseDiscard === 'function') {
      toDiscardIds = ctx.chooseDiscard(player.hand.slice(), count, playerId) || [];
    } else {
      toDiscardIds = player.hand.slice(-count).map(function (c) { return c.instanceId; });
    }

    toDiscardIds.slice(0, count).forEach(function (instanceId) {
      var idx = player.hand.findIndex(function (c) { return c.instanceId === instanceId; });
      if (idx >= 0) {
        var card = player.hand.splice(idx, 1)[0];
        player.trash.push({ card: card, faceUp: false }); // p.11類推：手札からの破棄は裏向き
        Events.logEvent(state, 'CARD_DISCARDED_BY_EFFECT', { playerId: playerId, cardId: card.cardId });
      }
    });
    return state;
  }

  // 指定したカード（装備タクティクスカード）が持つEQUIP_HP_MODIFIERの合計値を計算する。
  // 装備した瞬間に1回だけ呼び、結果を装備インスタンス自身に書き込む（playTacticsCardWithEffects参照）。
  function computeEquipHpModifierForCard(cardId) {
    var total = 0;
    CardEffectData.getEffectsForCard(cardId).forEach(function (effect) {
      if (effect.action && effect.action.type === 'EQUIP_HP_MODIFIER') total += effect.action.amount;
    });
    return total;
  }

  // 現在装備しているカードによるHP修正の合計（gameState.getEquipmentHpModifierSumの薄いエイリアス。
  // Phase B時点のAPIをそのまま維持するために残している）。
  function getEquipmentHpModifier(leader) {
    return GameState.getEquipmentHpModifierSum(leader);
  }

  // 装備込みの最大HP。Phase Cで GameState.getLeaderMaxHp 自体が装備を加算するようになったため、
  // 本関数は単なるエイリアスになっている（Phase Bで追加したAPIをそのまま維持するために残す）。
  function getEffectiveMaxHp(cardIndex, leader) {
    return GameState.getLeaderMaxHp(cardIndex, leader);
  }

  // 指定したカード（装備タクティクスカード）が持つEQUIP_ATK_MODIFIERの合計値を計算する。
  // computeEquipHpModifierForCardと完全に対称（Phase D-1）。
  function computeEquipAtkModifierForCard(cardId) {
    var total = 0;
    CardEffectData.getEffectsForCard(cardId).forEach(function (effect) {
      if (effect.action && effect.action.type === 'EQUIP_ATK_MODIFIER') total += effect.action.amount;
    });
    return total;
  }

  // 現在装備しているカードによるATK修正の合計（gameState.getEquipmentAtkModifierSumの薄いエイリアス。
  // getEquipmentHpModifierと同じ位置づけで残している）。
  function getEquipmentAtkModifier(leader) {
    return GameState.getEquipmentAtkModifierSum(leader);
  }

  // 装備込みの現在ATK。GameState.getLeaderCurrentAtk自体が装備を加算するため、本関数は薄いエイリアス。
  function getEffectiveAtk(cardIndex, leader) {
    return GameState.getLeaderCurrentAtk(cardIndex, leader);
  }

  // ---- EQUIP_GRANT_ABILITY（Phase D-3A）----
  // 指定したカード（装備タクティクスカード）が持つEQUIP_GRANT_ABILITYのability仕様から、
  // 実際のCardEffectオブジェクトを組み立てて返す。computeEquipHpModifierForCard等と同じく
  // 装備した瞬間に1回だけ呼び、結果を装備インスタンス自身に書き込む（playTacticsCardWithEffects参照）。
  // 新しい効果システムは作らず、既存のCardEffectCore.createCardEffectをそのまま使う。
  function computeGrantedAbilitiesForCard(cardId) {
    var abilities = [];
    CardEffectData.getEffectsForCard(cardId).forEach(function (effect) {
      if (effect.action && effect.action.type === 'EQUIP_GRANT_ABILITY' && effect.action.ability) {
        abilities.push(CardEffectCore.createCardEffect(effect.action.ability));
      }
    });
    return abilities;
  }

  // 装備インスタンスが持つ付与能力のうち、指定Triggerに一致するものをResolutionStackへ積む。
  // sourceInstanceIdは装備インスタンス自身のID（アタックカードやメモリアのIDではない）にする。
  // これによりONCE_PER_TURN_USEDが「装備インスタンス単位」で正しく機能する（PROVISIONAL、ruleConfig.js参照）。
  // 現時点で確認できている実カードの付与能力はすべてAFTER_ATTACKのみ（他Triggerの実例が無いため対応しない）。
  function queueEquipmentGrantedAfterAttackEffects(state, leaderPlayerId, leaderIndex, ctx, cardIndex) {
    var leader = state.players[leaderPlayerId].leaders[leaderIndex];
    (leader.equipment || []).forEach(function (equip) {
      (equip.grantedAbilities || [])
        .filter(function (e) { return e.trigger === 'AFTER_ATTACK'; })
        .forEach(function (e) {
          var equipCtx = Object.assign({}, ctx, { sourceInstanceId: equip.instanceId });
          ResolutionStack.push(state.resolutionStack, buildPendingEffect(e, equipCtx, cardIndex));
        });
    });
  }

  // ---- CardEffect → PendingEffect 変換 ----
  // Phase D-2-A: condition(state, ctx) / target(state, ctx) から ctx.cardIndex を参照できるようにする。
  // 既存のCondition/Target APIのシグネチャ（state, ctx）自体は変更しない。ctxに cardIndex フィールドを
  // 追加するだけであり、既存の（cardIndexを参照しない）Condition/Targetの挙動は一切変わらない。
  function buildPendingEffect(cardEffect, ctx, cardIndex) {
    var effectiveCtx = Object.assign({}, ctx, { cardIndex: cardIndex });
    return {
      id: nextEffectId(),
      sourceInstanceId: ctx.sourceInstanceId,
      trigger: cardEffect.trigger,
      ownerPlayerId: ctx.ownerPlayerId,
      condition: cardEffect.condition
        ? function (state) { return CardEffectCore.isConditionMet(state, effectiveCtx, cardEffect); }
        : null,
      resolve: function (state) {
        return withResolvingEffect({
          sourceInstanceId: ctx.sourceInstanceId, trigger: cardEffect.trigger, ownerPlayerId: ctx.ownerPlayerId,
          attackerLeaderIndex: ctx.attackerLeaderIndex,
        }, function () {
          var targets = cardEffect.target ? CardEffectCore.resolveTargets(state, effectiveCtx, cardEffect) : [];
          if (cardEffect.target && targets.length === 0) return state; // 対象なしNo-op（FAQ Q8）
          return applyAction(state, cardEffect.action, targets, effectiveCtx, cardIndex);
        });
      },
    };
  }

  // これらのAction typeは「即時にGameStateを書き換えるAction」ではなく、装備時に専用の計算関数が
  // 参照するマーカーとしてのみ存在する（EQUIP_HP_MODIFIER/EQUIP_ATK_MODIFIER/EQUIP_GRANT_ABILITY）。
  // ON_PLAYの一般的なキュー処理からは常に除外する（そのままresolveすればapplyAction()が例外を投げるため）。
  var EQUIP_MARKER_ACTION_TYPES = ['EQUIP_HP_MODIFIER', 'EQUIP_ATK_MODIFIER', 'EQUIP_GRANT_ABILITY'];

  // ---- ON_PLAY：カードをプレイした瞬間の効果をResolutionStackへ積む ----
  // options（playMemoriaCardWithEffects/playTacticsCardWithEffectsの呼び出し元が渡すもの）のうち、
  // 選択コールバック系のフィールドだけをctxへ橋渡し用に抜き出す（Phase D-3で追加）。
  // 選択コールバック（ctx.chooseXxx）の一覧。カードプレイのoptionsから効果解決のctxへ、また効果から
  // 連鎖的にプレイされるカード（FREE_PLAY・頂点捕食者・エコー等）のctxへ、すべてまとめて引き継ぐ。
  var CHOICE_CALLBACK_KEYS = [
    'chooseTarget', 'chooseHealTarget', 'chooseDistributedHeal', 'chooseMoveEquipment', 'chooseMultiTargets',
    'chooseSelfDamage', 'chooseDeckLookAddToHand', 'chooseDiscard', 'chooseFreePlayFromHand', 'chooseDeckLookPlay',
    'chooseReplayFromPlayArea', 'chooseApexDiscard', 'chooseDeckLookAttack', 'chooseFreeAttackTarget',
    'chooseAttackDiscard', 'chooseConfirm', 'chooseDeclareCardType',
  ];
  function pickChoiceCallbacks(source) {
    var extra = {};
    if (!source) return extra;
    CHOICE_CALLBACK_KEYS.forEach(function (k) { if (typeof source[k] === 'function') extra[k] = source[k]; });
    return extra;
  }
  function extractChoiceOptions(options) {
    return options ? pickChoiceCallbacks(options) : undefined;
  }

  // extraCtx（省略可）: Phase D-3で追加した選択コールバック（chooseDistributedHeal/chooseMoveEquipment等）
  // や既存のchooseTargetを、呼び出し元（playMemoriaCardWithEffects/playTacticsCardWithEffects）から
  // ctxへ橋渡しするための追加フィールド。何も渡さなければ従来通りの挙動（デフォルト選択）になる。
  function queueOnPlayEffects(state, playerId, cardInstance, cardIndex, extraCtx) {
    var ctx = Object.assign({ ownerPlayerId: playerId, sourceInstanceId: cardInstance.instanceId }, extraCtx || {});
    CardEffectData.getEffectsForCard(cardInstance.cardId)
      .filter(function (e) { return e.trigger === 'ON_PLAY' && !(e.action && EQUIP_MARKER_ACTION_TYPES.indexOf(e.action.type) >= 0); })
      .forEach(function (e) { ResolutionStack.push(state.resolutionStack, buildPendingEffect(e, ctx, cardIndex)); });
    return state;
  }

  // ---- Phase G: メモリアカードをコストを支払わずにプレイする（FREE_PLAY系）----
  // cardInstanceは呼び出し側が既に本来の置き場（手札・デッキ等）から取り出し済みのものを渡す
  // （このヘルパー自身は取り出し処理を行わない）。playMemoriaCardWithEffectsの「プレイエリアへ積む・
  // ON_PLAYをResolutionStackへ積む・ATTACK_BOOST/紐づくAFTER_ATTACKを処理する」の3点を再現するが、
  // Phases.playMemoriaCard自体は呼ばない（PP支払い・手札からの取り出しは既に済んでいるか、
  // 元々手札に無いカード〔デッキルック由来〕のため）。ATTACK専用カードは対応しない
  // （攻撃には新たな攻撃者/対象の選択が必要になり、このヘルパーの対象外。呼び出し側が保証する）。
  function playMemoriaForFreeAndQueueEffects(state, playerId, cardInstance, cardIndex, extraCtx) {
    var player = state.players[playerId];
    player.playArea.push({ card: cardInstance, order: player.playArea.length, pendingTriggers: [] });
    Events.logEvent(state, 'MEMORIA_PLAYED', { playerId: playerId, cardId: cardInstance.cardId });
    return queueMemoriaPlayEffects(state, playerId, cardInstance, cardIndex, extraCtx);
  }

  // 〖アタック強化〗を次のアタックに積み、同じカードの〖アタック後〗を次のアタックに紐付ける
  // （メモリア・消費タクティクス・エコーのプレイし直しで共通。includeAfterAttack=falseはアタックカード自身の
  //  〖アタック強化〗〔マウントタックル〕用で、そのカードの〖アタック後〗は自分のアタックで処理済みのため紐付けない）。
  // modifier.type:
  //   DAMAGE_BONUS            : 条件（あれば）をプレイした時点で判定して、次のアタックのダメージに加える
  //   DAMAGE_BONUS_AT_ATTACK  : 条件を「次のアタックを宣言した時点」で判定する（例：バックステージパス
  //                             「アタッカーがカードを装備しているなら、さらに+20」。アタッカーはプレイ時点では未定のため）
  // 画面表示用に、どのカードがいくつ強化しているかを player.pendingBoostSources に記録する（アタックで消費されたら空にする）。
  function linkBoostAndAfterAttack(state, playerId, cardInstance, cardIndex, includeAfterAttack) {
    var player = state.players[playerId];
    player.pendingAfterAttackEffects = player.pendingAfterAttackEffects || [];
    player.pendingBoostSources = player.pendingBoostSources || [];
    player.pendingAttackTimeBoosts = player.pendingAttackTimeBoosts || [];
    var boostCtx = { ownerPlayerId: playerId, sourceInstanceId: cardInstance.instanceId, cardIndex: cardIndex };
    CardEffectData.getEffectsForCard(cardInstance.cardId).forEach(function (e) {
      if (e.trigger === 'ATTACK_BOOST' && e.modifier && e.modifier.type === 'DAMAGE_BONUS') {
        if (e.condition && !e.condition(state, boostCtx)) return;
        Combat.queueAttackBoost(state, playerId, e.modifier.amount, cardInstance.instanceId);
        player.pendingBoostSources.push({ instanceId: cardInstance.instanceId, cardId: cardInstance.cardId, amount: e.modifier.amount });
      } else if (e.trigger === 'ATTACK_BOOST' && e.modifier && e.modifier.type === 'DAMAGE_BONUS_AT_ATTACK') {
        player.pendingAttackTimeBoosts.push({ amount: e.modifier.amount, condition: e.modifier.condition, instanceId: cardInstance.instanceId, cardId: cardInstance.cardId });
        player.pendingBoostSources.push({ instanceId: cardInstance.instanceId, cardId: cardInstance.cardId, amount: e.modifier.amount, conditional: true });
      } else if (e.trigger === 'AFTER_ATTACK' && includeAfterAttack) {
        // このAFTER_ATTACK効果は「次のアタック」に付随する。ctxは次のplayAttackCardWithEffects呼び出し時に完成させる。
        // sourceInstanceIdはこのカード自身のインスタンスIDを保持しておく（アタックカードのIDと混同しない）。
        player.pendingAfterAttackEffects.push({ effect: e, sourceInstanceId: cardInstance.instanceId, cardId: cardInstance.cardId });
      }
    });
    return state;
  }

  // 次のアタックの宣言時に、DAMAGE_BONUS_AT_ATTACK の条件を判定して上乗せ量を返す（消費はconsumePendingBoostsで行う）
  function computeAttackTimeBoost(state, playerId, ctx) {
    return (state.players[playerId].pendingAttackTimeBoosts || []).reduce(function (sum, b) {
      return (typeof b.condition !== 'function' || b.condition(state, ctx)) ? sum + b.amount : sum;
    }, 0);
  }

  // アタック強化が消費された（アタックを宣言した）ので、表示用の記録と宣言時判定の強化を空にする
  function consumePendingBoosts(state, playerId) {
    var player = state.players[playerId];
    player.pendingBoostSources = [];
    player.pendingAttackTimeBoosts = [];
  }

  // メモリアを「プレイした」ときの効果処理（ON_PLAYをResolutionStackへ・ATTACK_BOOSTを次のアタックへ・
  // AFTER_ATTACKを次のアタックに紐付け）。カード自体の移動は呼び出し側が行う
  // （エコーの「プレイし直す」はプレイエリアに置いたまま、この処理だけを行う）。
  function queueMemoriaPlayEffects(state, playerId, cardInstance, cardIndex, extraCtx) {
    queueOnPlayEffects(state, playerId, cardInstance, cardIndex, extraCtx);
    return linkBoostAndAfterAttack(state, playerId, cardInstance, cardIndex, true);
  }

  // ---- メモリアカードのプレイ：既存のPhases.playMemoriaCardを土台に、
  //      登録済み効果（ON_PLAY即時効果／ATTACK_BOOST／次のアタックに紐づくAFTER_ATTACK）を統合する ----
  // ON_PLAYはqueueOnPlayEffects()と同じ経路でResolutionStackへ積む（プレイ時効果の入口を一本化する）。
  // ATTACK_BOOSTのmodifierはCombat.queueAttackBoostへ、同じカードが持つAFTER_ATTACK効果は
  // 「次のアタック」に紐付けて保留しておく（次の1回のみ有効、spec 9章。超新星が実例）。
  function playMemoriaCardWithEffects(state, playerId, cardInstanceId, options, cardIndex) {
    var player = state.players[playerId];
    var handEntry = player.hand.find(function (c) { return c.instanceId === cardInstanceId; });
    if (!handEntry) throw new Error('指定されたカードは手札にありません: ' + cardInstanceId);
    var cardId = handEntry.cardId;

    // 同名カードがプレイエリアに1枚あるならコストを支払わない（引っ張り合い等）
    var memoriaOptions = Object.assign({}, options || {});
    if (isFreeBySameNameRule(state, playerId, cardId, cardIndex)) memoriaOptions.freePlay = true;
    var result = Phases.playMemoriaCard(state, playerId, cardInstanceId, memoriaOptions, cardIndex);

    queueOnPlayEffects(state, playerId, { instanceId: cardInstanceId, cardId: cardId }, cardIndex, extractChoiceOptions(options));

    // Phase E: ATTACK_BOOSTにconditionが付いている場合、このメモリアをプレイした「今」の時点
    // （このカード自身は既にPhases.playMemoriaCardでプレイエリアへ積まれた後）で判定する。
    // We are...!の「メモリアカードの数は【アタック強化】を実行するときに数える」という printedルーリングに
    // 基づく（ctx.ownerPlayerId/cardIndexがあればPLAY_AREA_TYPE_COUNT等の既存Conditionがそのまま使える）。
    linkBoostAndAfterAttack(state, playerId, { instanceId: cardInstanceId, cardId: cardId }, cardIndex, true);
    return result;
  }

  // ---- タクティクスカードのプレイ：既存のPhases.playTacticsCardを土台に、
  //      装備（subType:'EQUIPMENT'）の場合は装備インスタンスへhpModifier/atkModifier/grantedAbilitiesを
  //      書き込み、GameState.getLeaderMaxHp/getLeaderCurrentAtk（ひいてはcombat.jsの判定）と
  //      playAttackCardWithEffects（付与能力の発動）へ実際に反映させる。
  //      ON_PLAYの「本当に即時実行するべき効果」は、装備型・消費型どちらでも共通のqueueOnPlayEffects経路で
  //      ResolutionStackへ積む（EQUIP_*マーカーはqueueOnPlayEffects内で自動的に除外される。
  //      Phase D-3A: ヒーリングオーブ〔プレイ時に自分のリーダー1体を60回復〕のように、
  //      装備カード自身がEQUIP_GRANT_ABILITYとは別に本物のON_PLAY効果を持つ場合に必要）。----
  // options: { subType: 'CONSUMABLE' | 'EQUIPMENT', equipLeaderIndex? }（Phases.playTacticsCardと同じ）
  function playTacticsCardWithEffects(state, playerId, cardInstanceId, options, cardIndex) {
    var player = state.players[playerId];
    var areaEntry = player.tacticsArea.find(function (t) { return t.card.instanceId === cardInstanceId; });
    var cardId = areaEntry ? areaEntry.card.cardId : null;

    var result = Phases.playTacticsCard(state, playerId, cardInstanceId, options, cardIndex);

    if (options && options.subType === 'EQUIPMENT') {
      var leader = state.players[playerId].leaders[options.equipLeaderIndex];
      var equipEntry = leader.equipment[leader.equipment.length - 1];
      // 直前にpushされたのが今回装備したカードであることを確認してから書き込む（安全側）
      if (equipEntry && equipEntry.instanceId === cardInstanceId) {
        equipEntry.hpModifier = computeEquipHpModifierForCard(equipEntry.cardId);
        equipEntry.atkModifier = computeEquipAtkModifierForCard(equipEntry.cardId);
        equipEntry.grantedAbilities = computeGrantedAbilitiesForCard(equipEntry.cardId);
      }
    }
    if (cardId) {
      queueOnPlayEffects(state, playerId, { instanceId: cardInstanceId, cardId: cardId }, cardIndex, extractChoiceOptions(options));
      // 消費タクティクスの〖アタック強化〗（例：アドレナリン・特殊弾）と、それに紐づく〖アタック後〗は
      // メモリアと同じく「次のアタック」に上乗せする。装備タクティクスの〖アタック後〗は装備の付与能力
      // （EQUIP_GRANT_ABILITY）として別経路で扱うため、ここでは消費型のみ対象にする。
      if (!options || options.subType !== 'EQUIPMENT') {
        linkBoostAndAfterAttack(state, playerId, { instanceId: cardInstanceId, cardId: cardId }, cardIndex, true);
      }
    }
    return result;
  }

  // ---- 「プレイエリアに別の『（同名）』が1枚あるなら、コストを支払わずにこのカードをプレイしてもよい。
  //      （2枚以上あるときはコストを支払う。）」（壁ジャンプ・引っ張り合い・ロケットシャワー）----
  // 払わずに済むなら常に得なので、条件を満たせば自動的にコストなしでプレイする。
  function isFreeBySameNameRule(state, playerId, cardId, cardIndex) {
    if (!CardEffectData.hasKeyword(cardId, 'FREE_IF_ONE_SAME_NAME_IN_PLAY')) return false;
    var card = cardIndex[cardId];
    if (!card) return false;
    var same = state.players[playerId].playArea.filter(function (e) {
      var c = cardIndex[e.card.cardId];
      return c && c.name === card.name;
    }).length;
    return same === 1;
  }

  // 画面の「プレイできるか」判定用：そのカードを今プレイするときに実際に支払うコスト（未確定ならnull）
  function getEffectivePlayCost(state, playerId, cardId, cardIndex) {
    var card = cardIndex[cardId];
    if (!card || typeof card.cost !== 'number') return null;
    return isFreeBySameNameRule(state, playerId, cardId, cardIndex) ? 0 : card.cost;
  }

  // ---- 〖アタックする〗のうち、ダメージを決める前に盤面を動かす処理（選択・公開・破棄を伴うもの）----
  // 戻り値はこのアタックのダメージへの上乗せ量。アタックカードはまだ手札にある（Phases.playAttackCardの前）ため、
  // 手札から選ぶ候補からはそのカード自身を除く。
  function handCandidates(state, playerId, excludeInstanceId, cardIndex, filter) {
    return state.players[playerId].hand.filter(function (c) {
      if (c.instanceId === excludeInstanceId) return false;
      var cd = cardIndex[c.cardId];
      return !!cd && (!filter || filter(cd));
    }).map(function (c) { return { instanceId: c.instanceId, cardId: c.cardId, cost: cardIndex[c.cardId].cost }; });
  }

  function discardByInstanceIds(state, playerId, ids) {
    var player = state.players[playerId];
    var discarded = [];
    ids.forEach(function (id) {
      var i = player.hand.findIndex(function (c) { return c.instanceId === id; });
      if (i < 0) return;
      var card = player.hand.splice(i, 1)[0];
      player.trash.push({ card: card, faceUp: false });
      Events.logEvent(state, 'CARD_DISCARDED_BY_EFFECT', { playerId: playerId, cardId: card.cardId });
      discarded.push(card);
    });
    return discarded;
  }

  function runPreDamageAttackActions(state, playerId, cardInstanceId, cardId, ctx, cardIndex) {
    var bonus = 0;
    CardEffectData.getEffectsForCard(cardId).forEach(function (e) {
      if (e.trigger !== 'ON_ATTACK' || !e.action) return;
      var a = e.action;
      withResolvingEffect({ sourceInstanceId: cardInstanceId, cardId: cardId, trigger: 'ON_ATTACK', ownerPlayerId: playerId }, function () {
        if (a.type === 'OPTIONAL_HAND_DISCARD_FOR_BONUS') {
          // 大黒柱/Lastman Standing「手札を1枚捨ててもよい。そうしたならダメージ+20。」
          // CLUTCH!!!/セルフ実況「自分の手札のコスト0のカード1枚を公開し、捨ててもよい。そうしたならカードを1枚引き、ダメージ+N。」
          // 仁義なき抗争「手札を1枚ランダムに捨ててもよい。そうしたならダメージ+30。」
          var cands = handCandidates(state, playerId, cardInstanceId, cardIndex, a.filterCost != null ? function (cd) { return cd.cost === a.filterCost; } : null);
          if (cands.length === 0) return;
          var ids = [];
          if (a.random) {
            if (!(ctx.chooseConfirm && ctx.chooseConfirm({ kind: 'RANDOM_DISCARD', title: '手札を1枚ランダムに捨てますか？（捨てるとダメージ+' + a.bonus + '）' }, state))) return;
            ids = [cands[Math.floor(Math.random() * cands.length)].instanceId];
          } else {
            ids = ctx.chooseAttackDiscard ? (ctx.chooseAttackDiscard(cands.slice(), { max: 1, bonus: a.bonus }, state) || []) : [];
            ids = ids.filter(function (id) { return cands.some(function (c) { return c.instanceId === id; }); }).slice(0, 1);
          }
          if (ids.length === 0) return;
          discardByInstanceIds(state, playerId, ids);
          if (a.draw) Deck.drawCards(state, playerId, a.draw);
          bonus += a.bonus;
        } else if (a.type === 'DISCARD_UP_TO_FOR_BONUS') {
          // オーバードライブ「自分の手札のカードを最大2枚公開する。それらのカードを捨てる。捨てたアタックカード1枚につき、
          // ダメージ+30。捨てたメモリアカード1枚につき、カードを2枚引く。」（0枚でもよい）
          var cands2 = handCandidates(state, playerId, cardInstanceId, cardIndex, null);
          if (cands2.length === 0 || !ctx.chooseAttackDiscard) return;
          var ids2 = (ctx.chooseAttackDiscard(cands2.slice(), { max: a.max }, state) || [])
            .filter(function (id) { return cands2.some(function (c) { return c.instanceId === id; }); }).slice(0, a.max);
          var discarded = discardByInstanceIds(state, playerId, ids2);
          var draws = 0;
          discarded.forEach(function (c) {
            var cd = cardIndex[c.cardId];
            if (cd.cardType === 'ATTACK') bonus += a.perAttackBonus;
            if (cd.cardType === 'MEMORIA') draws += a.perMemoriaDraw;
          });
          if (draws) Deck.drawCards(state, playerId, draws);
        } else if (a.type === 'MILL_OPPONENT_TOP_FOR_BONUS') {
          // 神速フリック/天衣無縫「対戦相手のデッキの上から1枚を公開し、トラッシュに置く。そのカードが〇〇カードなら、ダメージ+20。」
          // 対戦相手のデッキが0枚なら何もしない（トラッシュからの再構築はしない。PROVISIONAL）。
          var opp = state.players[GameState.getOpponentId(playerId)];
          if (opp.deck.length === 0) return;
          var top = opp.deck.shift();
          opp.trash.push({ card: top, faceUp: false });
          Events.logEvent(state, 'CARD_MILLED_BY_EFFECT', { playerId: GameState.getOpponentId(playerId), cardId: top.cardId });
          var topCard = cardIndex[top.cardId];
          if (topCard && topCard.cardType === a.cardType) bonus += a.bonus;
        } else if (a.type === 'REVEAL_OWN_TOP_COST_VARIETY_BONUS') {
          // テラーエンゲージ「自分のデッキの上から4枚を公開する。公開したカードのコスト1種類につきダメージ+30。
          // 公開したカードのコストがすべて異なるなら、PPを1回復する。公開したカードすべてをトラッシュに置く。」
          var self = state.players[playerId];
          var revealed = self.deck.splice(0, Math.min(a.count, self.deck.length));
          var kinds = {};
          revealed.forEach(function (c) {
            var cd = cardIndex[c.cardId];
            if (cd && typeof cd.cost === 'number') kinds[cd.cost] = true;
            self.trash.push({ card: c, faceUp: false });
            Events.logEvent(state, 'CARD_MILLED_BY_EFFECT', { playerId: playerId, cardId: c.cardId });
          });
          var kindCount = Object.keys(kinds).length;
          bonus += kindCount * a.perKindBonus;
          // PPの回復は、このカードのコストを支払った後に行う（支払い前に回復すると、使用済みのPPが無いため無駄になる）
          if (revealed.length > 0 && kindCount === revealed.length) ctx.ppRecoverAfterPay = (ctx.ppRecoverAfterPay || 0) + 1;
        }
      });
    });
    return bonus;
  }

  // ---- ON_ATTACK：アタックカード自身の固有ダメージをattackCardBaseDamageとして算出 ----
  // Phase E: state/ctxを受け取り、ATTACK_DAMAGE_BONUSにconditionが付いていれば評価する
  // （例：アナイアレーション「自分のリーダーの色がすべて異なるなら」、オールスターコンボ
  //  「プレイエリアに他のアタックカードがN枚以上あるなら」）。conditionが無いエントリは
  // 従来どおり常に加算する（既存の全登録カードと完全後方互換）。呼び出し側
  // （playAttackCardWithEffects）がこの関数を呼ぶ時点では、このカード自身はまだ
  // プレイエリアに積まれていない（Phases.playAttackCardの前）ため、PLAY_AREA_TYPE_COUNTで
  // 「他の」アタックカードを数える場合も自分自身を除外する特別扱いは不要（タイミング上自然に除外される）。
  function computeAttackCardBaseDamage(cardId, state, ctx) {
    var total = 0;
    CardEffectData.getEffectsForCard(cardId).forEach(function (e) {
      if (e.trigger === 'ON_ATTACK' && e.action && e.action.type === 'ATTACK_DAMAGE_BONUS') {
        if (e.condition && !e.condition(state, ctx)) return;
        total += e.action.amount;
      }
    });
    return total;
  }

  // ---- MULTI_ATTACK（Phase F）：1回のカードプレイで複数回アタック宣言する（例：ストームラッシュ
  //      「アタックする」×3、「アタックのたびに、アタッカーとアタックを受けるリーダーを選ぶ」）----
  // マーカーの持ち方はEQUIP_*系と同じ：ON_ATTACKのActionに{type:'MULTI_ATTACK', count:N}を持たせ、
  // applyAction()の一般ディスパッチには乗せない（専用の呼び出し元だけが参照する）。
  function getMultiAttackCount(cardId) {
    var found = null;
    CardEffectData.getEffectsForCard(cardId).forEach(function (e) {
      if (e.trigger === 'ON_ATTACK' && e.action && e.action.type === 'MULTI_ATTACK') found = e.action.count;
    });
    return found; // null = 通常の単発アタックカード
  }

  // 1回分のアタック宣言後処理（ON_ATTACKの条件付きボーナス計算・Combat.declareAttack呼び出し・
  // オーバーキル計算・AFTER_ATTACK/装備付与能力のキュー積み・ON_AWAKEN判定）。
  // playAttackCardWithEffectsの単発アタック経路（既存・テスト済み、無改修）と全く同じロジックを、
  // MULTI_ATTACK用に複製している（combat.jsを変更せずdealDamageAndCheckDownが計算を複製している
  // 前例と同じ考え方）。drainPendingAfterAttackがtrueの回だけ、メモリア側が積んでおいた
  // 「次の1回のアタックのみ」のAFTER_ATTACK効果を消費する（1回目の宣言でだけtrueにすることで、
  // pendingAttackBoostと同様に自然と「最初の1回のみ」に限定される）。
  function declareOneAttackForMultiAttack(state, playerId, cardInstanceId, cardId, attackCardEffects, attackerLeaderIndex, targetPlayerId, targetLeaderIndex, chooseTarget, chooseHealTarget, drainPendingAfterAttack, cardIndex, choiceOptions) {
    var player = state.players[playerId];
    var ctx = {
      ownerPlayerId: playerId,
      sourceInstanceId: cardInstanceId,
      attackerPlayerId: playerId,
      attackerLeaderIndex: attackerLeaderIndex,
      targetPlayerId: targetPlayerId,
      targetLeaderIndex: targetLeaderIndex,
      cardIndex: cardIndex,
    };
    var baseDamage = computeAttackCardBaseDamage(cardId, state, ctx) + (drainPendingAfterAttack ? computeAttackTimeBoost(state, playerId, ctx) : 0);

    var targetLeaderBeforeAttack = state.players[targetPlayerId].leaders[targetLeaderIndex];
    var targetHpBeforeAttack = GameState.getLeaderCurrentHp(cardIndex, targetLeaderBeforeAttack);
    var attackerLeaderForOverkill = state.players[playerId].leaders[attackerLeaderIndex];
    var boostBeforeConsumption = player.pendingAttackBoost || 0;
    var totalDamageForOverkill = boostBeforeConsumption + baseDamage + GameState.getLeaderCurrentAtk(cardIndex, attackerLeaderForOverkill);
    // バグ修正（Phase F、MULTI_ATTACKの実装過程で発見）：ON_AWAKENは「覚醒した瞬間」の
    // 一度きりのTriggerのはずだが、単発アタック経路の既存実装は「現在覚醒しているか」だけを見ていたため、
    // 既に覚醒済みのリーダーが（同じカードプレイ内であれ、別ターンであれ）ダウンを取るたびに
    // ON_AWAKEN効果を再発火させてしまうバグがあった。MULTI_ATTACKで同じリーダーが1回のプレイ内で
    // 複数回攻撃できるようになったことでこのバグが顕在化しやすくなったため、ここで併せて修正する。
    var attackerWasAwakenedBefore = attackerLeaderForOverkill.awakened;

    var result = Combat.declareAttack(state, {
      attackerPlayerId: playerId,
      attackerLeaderIndex: attackerLeaderIndex,
      targetPlayerId: targetPlayerId,
      targetLeaderIndex: targetLeaderIndex,
      attackCardBaseDamage: baseDamage,
    }, cardIndex);
    if (drainPendingAfterAttack) consumePendingBoosts(state, playerId);

    var overkillAmount = result.downed ? Math.max(0, totalDamageForOverkill - targetHpBeforeAttack) : null;
    Object.assign(ctx, pickChoiceCallbacks(choiceOptions));
    ctx.chooseTarget = chooseTarget;
    ctx.overkillAmount = overkillAmount;

    attackCardEffects.filter(function (e) { return e.trigger === 'AFTER_ATTACK'; })
      .forEach(function (e) { ResolutionStack.push(state.resolutionStack, buildPendingEffect(e, ctx, cardIndex)); });

    queueEquipmentGrantedAfterAttackEffects(state, playerId, attackerLeaderIndex, ctx, cardIndex);

    if (drainPendingAfterAttack) {
      var queued = player.pendingAfterAttackEffects || [];
      player.pendingAfterAttackEffects = [];
      queued.forEach(function (item) {
        var itemCtx = Object.assign({}, ctx, { sourceInstanceId: item.sourceInstanceId });
        ResolutionStack.push(state.resolutionStack, buildPendingEffect(item.effect, itemCtx, cardIndex));
      });
    }

    if (!attackerWasAwakenedBefore && result.state.players[playerId].leaders[attackerLeaderIndex].awakened) {
      var awakenCtx = Object.assign({}, ctx, { chooseTarget: chooseHealTarget || chooseTarget });
      CardEffectData.getEffectsForCard(result.state.players[playerId].leaders[attackerLeaderIndex].cardId)
        .filter(function (e) { return e.trigger === 'ON_AWAKEN'; })
        .forEach(function (e) { ResolutionStack.push(state.resolutionStack, buildPendingEffect(e, awakenCtx, cardIndex)); });
    }

    return result;
  }

  // options: { attacks: [{attackerLeaderIndex, targetPlayerId, targetLeaderIndex}, ...]（ちょうどcount件必要）,
  //            chooseTarget?, chooseHealTarget? }
  // PP支払い・手札からの除去・プレイエリアへの追加は（カード1枚のプレイなので）1回だけ行う
  // （Phases.playAttackCardをcount回呼ぶとカードがcount回消費される不整合になるため、
  // ここではPhases.payPPのみ使い、それ以外はこの関数が直接行う。Phases.playAttackCard自体は無改修）。
  function playMultiAttackCardWithEffects(state, playerId, cardInstanceId, cardId, attackCardEffects, count, options, cardIndex) {
    var player = state.players[playerId];
    var idx = player.hand.findIndex(function (c) { return c.instanceId === cardInstanceId; });
    var cardData = GameState.getCardData(cardIndex, cardId);
    // 件数の検証はPP支払い・カード移動より前に行う（後で投げると支払い済みの中途半端な状態が残るため）
    var attacks = (options && options.attacks) || [];
    if (attacks.length !== count) {
      throw new Error('MULTI_ATTACK（' + count + '回）に対してoptions.attacksの指定が' + attacks.length + '件です（' + count + '件必要）');
    }
    if (!options.freePlay) {
      var multiAttackCost = Phases.requireKnownCost(cardData);
      if (!Phases.payPP(player, multiAttackCost)) {
        throw new Error('PPが不足しています（必要:' + multiAttackCost + '）');
      }
    }
    var instance = player.hand.splice(idx, 1)[0];
    player.playArea.push({ card: instance, order: player.playArea.length, pendingTriggers: [] });
    Events.logEvent(state, 'CARD_PLAYED', { playerId: playerId, cardId: instance.cardId, kind: 'ATTACK' });

    function firstAliveIndex(pid) {
      return state.players[pid].leaders.findIndex(function (l) { return !l.isDown; });
    }

    var lastResult = null;
    var drained = false;
    for (var i = 0; i < attacks.length; i++) {
      var atk = attacks[i];
      // PROVISIONAL（ruleConfig.js multiAttackSemantics.downedPredeclaredTarget）: 対象はプレイ時にまとめて
      // 指定されるため、先の回で既にダウンした対象/アタッカーが指定されていることがある。その場合は
      // 生存している先頭のリーダーに差し替え、差し替え先が無ければ残りのアタックを打ち切る。
      var attackerIndex = atk.attackerLeaderIndex;
      if (!state.players[playerId].leaders[attackerIndex] || state.players[playerId].leaders[attackerIndex].isDown) attackerIndex = firstAliveIndex(playerId);
      var targetIndex = atk.targetLeaderIndex;
      var targetLeader = state.players[atk.targetPlayerId].leaders[targetIndex];
      if (!targetLeader || targetLeader.isDown) targetIndex = firstAliveIndex(atk.targetPlayerId);
      if (attackerIndex < 0 || targetIndex < 0) break;
      lastResult = declareOneAttackForMultiAttack(
        state, playerId, cardInstanceId, cardId, attackCardEffects,
        attackerIndex, atk.targetPlayerId, targetIndex,
        options.chooseTarget, options.chooseHealTarget, !drained, cardIndex, options
      );
      drained = true;
    }
    return lastResult;
  }

  // ---- アタック実行：既存のPhases.playAttackCard / Combat.declareAttackを土台に、
  //      登録済み効果（自身のON_ATTACKダメージ、AFTER_ATTACK、メモリアが積んでおいたAFTER_ATTACK、
  //      ダウン後のON_AWAKEN）を統合する ----
  // options: { attackerLeaderIndex, targetPlayerId, targetLeaderIndex, chooseTarget?, chooseHealTarget? }
  //          MULTI_ATTACKカードの場合は代わりに { attacks: [...], chooseTarget?, chooseHealTarget? }
  function playAttackCardWithEffects(state, playerId, cardInstanceId, options, cardIndex) {
    var player = state.players[playerId];
    var handEntry = player.hand.find(function (c) { return c.instanceId === cardInstanceId; });
    if (!handEntry) throw new Error('指定されたカードは手札にありません: ' + cardInstanceId);
    var cardId = handEntry.cardId;

    var attackCardEffects = CardEffectData.getEffectsForCard(cardId);

    var multiAttackCount = getMultiAttackCount(cardId);
    if (multiAttackCount) {
      return playMultiAttackCardWithEffects(state, playerId, cardInstanceId, cardId, attackCardEffects, multiAttackCount, options, cardIndex);
    }

    // Phase E: ON_ATTACKのATTACK_DAMAGE_BONUSがconditionを持つ場合に備え、
    // Phases.playAttackCard呼び出し前（＝このカードがまだプレイエリアに積まれる前）の
    // 時点で判定に必要なctxを組み立てておく。overkillAmount/chooseTargetはこの時点では
    // まだ確定しないため後で同じオブジェクトに追記する（ctxを二重に作らない）。
    var ctx = {
      ownerPlayerId: playerId,
      sourceInstanceId: cardInstanceId,
      attackerPlayerId: playerId,
      attackerLeaderIndex: options.attackerLeaderIndex,
      targetPlayerId: options.targetPlayerId,
      targetLeaderIndex: options.targetLeaderIndex,
      cardIndex: cardIndex,
    };
    // 選択コールバックは〖アタックする〗の選択（手札を捨てる等）でも使うので、先にctxへ引き継ぐ
    Object.assign(ctx, pickChoiceCallbacks(options));
    // 同名カードがプレイエリアに1枚あるならコストを支払わない（壁ジャンプ・ロケットシャワー）
    var freePlay = !!options.freePlay || isFreeBySameNameRule(state, playerId, cardId, cardIndex);
    if (!freePlay) {
      // 〖アタックする〗の選択・破棄より前に、PPが足りるかだけは確認しておく（足りないのに手札を捨てさせない）
      var costCheck = Phases.requireKnownCost(GameState.getCardData(cardIndex, cardId));
      if (player.ppCards.max - player.ppCards.tapped < costCheck) throw new Error('PPが不足しています（必要:' + costCheck + '）');
    }
    var baseDamage = runPreDamageAttackActions(state, playerId, cardInstanceId, cardId, ctx, cardIndex)
      + computeAttackCardBaseDamage(cardId, state, ctx)
      + computeAttackTimeBoost(state, playerId, ctx);

    // Phase D-2-D: OVERKILL_AMOUNT用に、combat.js内で計算される合計ダメージと同じ式を
    // ここで独立して事前計算しておく（combat.js自体は無改修。既存のdealDamageAndCheckDownが
    // combat.jsの計算を複製している前例と同じ考え方）。攻撃前の残りHPも合わせて記録する。
    var targetLeaderBeforeAttack = state.players[options.targetPlayerId].leaders[options.targetLeaderIndex];
    var targetHpBeforeAttack = GameState.getLeaderCurrentHp(cardIndex, targetLeaderBeforeAttack);
    var attackerLeaderForOverkill = state.players[playerId].leaders[options.attackerLeaderIndex];
    var boostBeforeConsumption = player.pendingAttackBoost || 0; // declareAttack内で消費・リセットされる直前の値
    var totalDamageForOverkill = boostBeforeConsumption + baseDamage + GameState.getLeaderCurrentAtk(cardIndex, attackerLeaderForOverkill);
    // バグ修正（Phase F）：ON_AWAKENは「覚醒した瞬間」の一度きりのTriggerのはずだが、
    // 「現在覚醒しているか」だけを見ていたため、既に覚醒済みのリーダーが別ターンで再びダウンを取ると
    // ON_AWAKEN効果を再発火させてしまうバグがあった。MULTI_ATTACK実装時に発見したため併せて修正する。
    var attackerWasAwakenedBefore = attackerLeaderForOverkill.awakened;

    var result = Phases.playAttackCard(state, playerId, cardInstanceId, {
      attackerLeaderIndex: options.attackerLeaderIndex,
      targetPlayerId: options.targetPlayerId,
      targetLeaderIndex: options.targetLeaderIndex,
      attackCardBaseDamage: baseDamage,
      freePlay: freePlay,
    }, cardIndex);
    consumePendingBoosts(state, playerId);
    if (ctx.ppRecoverAfterPay) player.ppCards.tapped = Math.max(0, player.ppCards.tapped - ctx.ppRecoverAfterPay);

    // ダウンした場合のみOverkillの概念が成立する（PROVISIONAL、ruleConfig.js参照）
    var overkillAmount = result.downed ? Math.max(0, totalDamageForOverkill - targetHpBeforeAttack) : null;

    // 上で組み立てたctxに、この時点で確定した値を追記する（cardIndexは既に入っている）
    ctx.chooseTarget = options.chooseTarget;
    ctx.overkillAmount = overkillAmount;
    // Phase G: FREE_PLAY_MEMORIA_FROM_HAND/DECK_LOOK_FREE_PLAY_MEMORIA/REPLAY_SELECTED_FROM_PLAY_AREA用の
    // 選択コールバック（一騎当千・リンク・アサルト・三銃士はいずれもこのカード自身のAFTER_ATTACKなので、
    // このctx経由で渡す）。省略時はapplyAction側の安全なデフォルト（辞退）に委ねる。

    // アタックカード自身の〖プレイ時〗（カウンターブロー「プレイエリアに他のカードがないなら、PPを1回復する」）。
    // ResolutionStackは積んだ順に解決するので、アタック後の効果より先に解決される。
    queueOnPlayEffects(state, playerId, { instanceId: cardInstanceId, cardId: cardId }, cardIndex, pickChoiceCallbacks(options));

    // アタックカード自身のAFTER_ATTACK効果をResolutionStackへ
    attackCardEffects.filter(function (e) { return e.trigger === 'AFTER_ATTACK'; })
      .forEach(function (e) { ResolutionStack.push(state.resolutionStack, buildPendingEffect(e, ctx, cardIndex)); });

    // アタッカーの装備が付与するAFTER_ATTACK能力をResolutionStackへ（Phase D-3A）
    queueEquipmentGrantedAfterAttackEffects(state, playerId, options.attackerLeaderIndex, ctx, cardIndex);

    // このターン（この1回のアタック）のためにメモリア等が積んでおいたAFTER_ATTACK効果をResolutionStackへ
    // （sourceInstanceIdは各メモリア自身のIDのまま保持し、アタックカードのIDで上書きしない）
    var queued = player.pendingAfterAttackEffects || [];
    player.pendingAfterAttackEffects = [];
    queued.forEach(function (item) {
      var itemCtx = Object.assign({}, ctx, { sourceInstanceId: item.sourceInstanceId });
      ResolutionStack.push(state.resolutionStack, buildPendingEffect(item.effect, itemCtx, cardIndex));
    });

    // アタックカード自身の〖アタック強化〗（マウントタックル）は、このアタックの後の「次のアタック」に積む
    linkBoostAndAfterAttack(state, playerId, { instanceId: cardInstanceId, cardId: cardId }, cardIndex, false);

    // ON_AWAKEN：このアタックで新たに覚醒した場合のみ、そのリーダーの覚醒時効果を解決する
    // （既に覚醒済みだった場合は再発火させない。Phase Fで修正）
    if (!attackerWasAwakenedBefore && result.state.players[playerId].leaders[options.attackerLeaderIndex].awakened) {
      var awakenCtx = Object.assign({}, ctx, { chooseTarget: options.chooseHealTarget || options.chooseTarget });
      CardEffectData.getEffectsForCard(result.state.players[playerId].leaders[options.attackerLeaderIndex].cardId)
        .filter(function (e) { return e.trigger === 'ON_AWAKEN'; })
        .forEach(function (e) { ResolutionStack.push(state.resolutionStack, buildPendingEffect(e, awakenCtx, cardIndex)); });
    }

    return result;
  }

  return {
    applyAction: applyAction,
    dealDamageAndCheckDown: dealDamageAndCheckDown,
    discardFromHand: discardFromHand,
    getEquipmentHpModifier: getEquipmentHpModifier,
    getEffectiveMaxHp: getEffectiveMaxHp,
    getEquipmentAtkModifier: getEquipmentAtkModifier,
    getEffectiveAtk: getEffectiveAtk,
    buildPendingEffect: buildPendingEffect,
    queueOnPlayEffects: queueOnPlayEffects,
    playMemoriaCardWithEffects: playMemoriaCardWithEffects,
    playTacticsCardWithEffects: playTacticsCardWithEffects,
    computeEquipHpModifierForCard: computeEquipHpModifierForCard,
    computeEquipAtkModifierForCard: computeEquipAtkModifierForCard,
    computeGrantedAbilitiesForCard: computeGrantedAbilitiesForCard,
    queueEquipmentGrantedAfterAttackEffects: queueEquipmentGrantedAfterAttackEffects,
    computeAttackCardBaseDamage: computeAttackCardBaseDamage,
    playAttackCardWithEffects: playAttackCardWithEffects,
    getMultiAttackCount: getMultiAttackCount,
    // Phase D-2: Condition / Target ファクトリ（実体はeffectFactories.js。循環依存を避けるため
    // cardEffectData.jsはeffectFactories.jsを直接requireし、ここでは既存API利用側のために再エクスポートする）
    countPlayAreaByType: EffectFactories.countPlayAreaByType,
    makePlayAreaTypeCountCondition: EffectFactories.makePlayAreaTypeCountCondition,
    makeSameColorAsAttackedLeaderTarget: EffectFactories.makeSameColorAsAttackedLeaderTarget,
    makeOverkillAmountCondition: EffectFactories.makeOverkillAmountCondition,
    isEffectUsedThisTurn: EffectFactories.isEffectUsedThisTurn,
    markEffectUsedThisTurn: EffectFactories.markEffectUsedThisTurn,
    makeOncePerTurnCondition: EffectFactories.makeOncePerTurnCondition,
    makeSingleOtherOpponentLeaderTarget: EffectFactories.makeSingleOtherOpponentLeaderTarget,
    makeAllOtherOpponentLeadersTarget: EffectFactories.makeAllOtherOpponentLeadersTarget,
    makeOwnAliveLeaderTarget: EffectFactories.makeOwnAliveLeaderTarget,
    makeAllOwnAliveLeadersTarget: EffectFactories.makeAllOwnAliveLeadersTarget,
    makeAnyOpponentLeaderTarget: EffectFactories.makeAnyOpponentLeaderTarget,
    makeAllLeadersDifferentColorsCondition: EffectFactories.makeAllLeadersDifferentColorsCondition,
    makeAllAliveOpponentLeadersTarget: EffectFactories.makeAllAliveOpponentLeadersTarget,
    // Phase D-3: MOVE_EQUIPMENT / TEMP_ATK_MODIFIER / DISTRIBUTED_HEAL / DERIVED_AMOUNT
    resolveActionAmount: resolveActionAmount,
    applyDistributedHeal: applyDistributedHeal,
    moveEquipment: moveEquipment,
    clearTempAtkModifiers: clearTempAtkModifiers,
    endTurnAndSwitchWithEffects: endTurnAndSwitchWithEffects,
    processRoundEndWithEffects: processRoundEndWithEffects,
    // 第5弾ACE: エコー
    runEndPhaseWithEffects: runEndPhaseWithEffects,
    runStartPhaseWithEffects: runStartPhaseWithEffects,
    // UI向け：選択コールバックの一覧と、解決中の効果の情報
    CHOICE_CALLBACK_KEYS: CHOICE_CALLBACK_KEYS,
    getEffectivePlayCost: getEffectivePlayCost,
    computeAttackTimeBoost: computeAttackTimeBoost,
    getResolvingEffect: getResolvingEffect,
    makeUpToNOpponentLeadersTarget: EffectFactories.makeUpToNOpponentLeadersTarget,
  };
}));
