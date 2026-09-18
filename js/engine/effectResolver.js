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
      require('./effectFactories.js')
    );
  } else {
    root.XS_ENGINE_EFFECT_RESOLVER = factory(
      root.XS_ENGINE_STATE, root.XS_ENGINE_EVENTS, root.XS_ENGINE_RESOLUTION_STACK,
      root.XS_ENGINE_DECK, root.XS_ENGINE_COMBAT, root.XS_ENGINE_PHASES,
      root.XS_ENGINE_CARD_EFFECT, root.XS_ENGINE_CARD_EFFECT_DATA, root.XS_ENGINE_EFFECT_FACTORIES
    );
  }
}(typeof self !== 'undefined' ? self : this, function (
  GameState, Events, ResolutionStack, Deck, Combat, Phases, CardEffectCore, CardEffectData, EffectFactories
) {
  'use strict';

  var effectIdCounter = 0;
  function nextEffectId() { effectIdCounter += 1; return 'effect#' + effectIdCounter; }

  // ---- Action適用（GameState変更の実体）----
  // targets: LeaderRef[]（{playerId, leaderIndex}）。actionによっては使わない（DRAW/RECOVER_PP等）。
  function applyAction(state, action, targets, ctx, cardIndex) {
    if (!action) return state;

    switch (action.type) {
      case 'DRAW':
        Deck.drawCards(state, ctx.ownerPlayerId, action.amount);
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

      case 'DAMAGE':
        (targets || []).forEach(function (ref) {
          dealDamageAndCheckDown(state, ref, action.amount, cardIndex, ctx);
        });
        return state;

      case 'MULTI':
        (action.actions || []).forEach(function (sub) { applyAction(state, sub, targets, ctx, cardIndex); });
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

      case 'ATTACK_DAMAGE_BONUS':
      case 'EQUIP_HP_MODIFIER':
      case 'EQUIP_ATK_MODIFIER':
      case 'EQUIP_GRANT_ABILITY':
        // これらはdeclareAttackWithEffects/getEffectiveMaxHp/getEquipmentAtkModifier/
        // computeGrantedAbilitiesForCardが個別に参照する値であり、
        // 「即時にGameStateを書き換えるAction」としては扱わない。ここに来た場合は呼び出し側の誤りとする。
        throw new Error(action.type + ' はapplyAction()ではなく専用の計算関数から参照してください');

      default:
        throw new Error('未知のActionTypeです（cardEffectData.jsの設定を確認してください）: ' + action.type);
    }
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
        var targets = cardEffect.target ? CardEffectCore.resolveTargets(state, effectiveCtx, cardEffect) : [];
        if (cardEffect.target && targets.length === 0) return state; // 対象なしNo-op（FAQ Q8）
        return applyAction(state, cardEffect.action, targets, effectiveCtx, cardIndex);
      },
    };
  }

  // これらのAction typeは「即時にGameStateを書き換えるAction」ではなく、装備時に専用の計算関数が
  // 参照するマーカーとしてのみ存在する（EQUIP_HP_MODIFIER/EQUIP_ATK_MODIFIER/EQUIP_GRANT_ABILITY）。
  // ON_PLAYの一般的なキュー処理からは常に除外する（そのままresolveすればapplyAction()が例外を投げるため）。
  var EQUIP_MARKER_ACTION_TYPES = ['EQUIP_HP_MODIFIER', 'EQUIP_ATK_MODIFIER', 'EQUIP_GRANT_ABILITY'];

  // ---- ON_PLAY：カードをプレイした瞬間の効果をResolutionStackへ積む ----
  function queueOnPlayEffects(state, playerId, cardInstance, cardIndex) {
    var ctx = { ownerPlayerId: playerId, sourceInstanceId: cardInstance.instanceId };
    CardEffectData.getEffectsForCard(cardInstance.cardId)
      .filter(function (e) { return e.trigger === 'ON_PLAY' && !(e.action && EQUIP_MARKER_ACTION_TYPES.indexOf(e.action.type) >= 0); })
      .forEach(function (e) { ResolutionStack.push(state.resolutionStack, buildPendingEffect(e, ctx, cardIndex)); });
    return state;
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

    var result = Phases.playMemoriaCard(state, playerId, cardInstanceId, options, cardIndex);

    queueOnPlayEffects(state, playerId, { instanceId: cardInstanceId, cardId: cardId }, cardIndex);

    player.pendingAfterAttackEffects = player.pendingAfterAttackEffects || [];
    CardEffectData.getEffectsForCard(cardId).forEach(function (e) {
      if (e.trigger === 'ATTACK_BOOST' && e.modifier && e.modifier.type === 'DAMAGE_BONUS') {
        Combat.queueAttackBoost(state, playerId, e.modifier.amount, cardInstanceId);
      } else if (e.trigger === 'AFTER_ATTACK') {
        // このAFTER_ATTACK効果は「次のアタック」に付随する。ctxは次のplayAttackCardWithEffects呼び出し時に完成させる。
        // sourceInstanceIdはこのメモリア自身のインスタンスIDを保持しておく（アタックカードのIDと混同しない）。
        player.pendingAfterAttackEffects.push({ effect: e, sourceInstanceId: cardInstanceId });
      }
    });
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
      queueOnPlayEffects(state, playerId, { instanceId: cardInstanceId, cardId: cardId }, cardIndex);
    }
    return result;
  }

  // ---- ON_ATTACK：アタックカード自身の固有ダメージをattackCardBaseDamageとして算出 ----
  function computeAttackCardBaseDamage(cardId) {
    var total = 0;
    CardEffectData.getEffectsForCard(cardId).forEach(function (e) {
      if (e.trigger === 'ON_ATTACK' && e.action && e.action.type === 'ATTACK_DAMAGE_BONUS') total += e.action.amount;
    });
    return total;
  }

  // ---- アタック実行：既存のPhases.playAttackCard / Combat.declareAttackを土台に、
  //      登録済み効果（自身のON_ATTACKダメージ、AFTER_ATTACK、メモリアが積んでおいたAFTER_ATTACK、
  //      ダウン後のON_AWAKEN）を統合する ----
  // options: { attackerLeaderIndex, targetPlayerId, targetLeaderIndex, chooseTarget?, chooseHealTarget? }
  function playAttackCardWithEffects(state, playerId, cardInstanceId, options, cardIndex) {
    var player = state.players[playerId];
    var handEntry = player.hand.find(function (c) { return c.instanceId === cardInstanceId; });
    if (!handEntry) throw new Error('指定されたカードは手札にありません: ' + cardInstanceId);
    var cardId = handEntry.cardId;

    var attackCardEffects = CardEffectData.getEffectsForCard(cardId);
    var baseDamage = computeAttackCardBaseDamage(cardId);

    // Phase D-2-D: OVERKILL_AMOUNT用に、combat.js内で計算される合計ダメージと同じ式を
    // ここで独立して事前計算しておく（combat.js自体は無改修。既存のdealDamageAndCheckDownが
    // combat.jsの計算を複製している前例と同じ考え方）。攻撃前の残りHPも合わせて記録する。
    var targetLeaderBeforeAttack = state.players[options.targetPlayerId].leaders[options.targetLeaderIndex];
    var targetHpBeforeAttack = GameState.getLeaderCurrentHp(cardIndex, targetLeaderBeforeAttack);
    var attackerLeaderForOverkill = state.players[playerId].leaders[options.attackerLeaderIndex];
    var boostBeforeConsumption = player.pendingAttackBoost || 0; // declareAttack内で消費・リセットされる直前の値
    var totalDamageForOverkill = boostBeforeConsumption + baseDamage + GameState.getLeaderCurrentAtk(cardIndex, attackerLeaderForOverkill);

    var result = Phases.playAttackCard(state, playerId, cardInstanceId, {
      attackerLeaderIndex: options.attackerLeaderIndex,
      targetPlayerId: options.targetPlayerId,
      targetLeaderIndex: options.targetLeaderIndex,
      attackCardBaseDamage: baseDamage,
    }, cardIndex);

    // ダウンした場合のみOverkillの概念が成立する（PROVISIONAL、ruleConfig.js参照）
    var overkillAmount = result.downed ? Math.max(0, totalDamageForOverkill - targetHpBeforeAttack) : null;

    var ctx = {
      ownerPlayerId: playerId,
      sourceInstanceId: cardInstanceId,
      attackerPlayerId: playerId,
      attackerLeaderIndex: options.attackerLeaderIndex,
      targetPlayerId: options.targetPlayerId,
      targetLeaderIndex: options.targetLeaderIndex,
      chooseTarget: options.chooseTarget,
      overkillAmount: overkillAmount,
    };

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

    // ON_AWAKEN：declareAttack内で覚醒していれば、そのリーダーの覚醒時効果を解決する
    if (result.state.players[playerId].leaders[options.attackerLeaderIndex].awakened) {
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
  };
}));
