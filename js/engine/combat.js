/* Xross Stars ゲームエンジン — 攻撃・ダメージ・ダウン・覚醒処理
 *
 * 根拠: docs/xross-stars-game-spec.md 3章, 12章 / docs/game-engine-architecture.md 5章
 *
 * ATTACK → DAMAGE CALCULATION → DAMAGE → DOWN CHECK → AWAKEN CHECK
 *
 * 確認済み仕様の反映:
 *   - 同じリーダーが何度でも攻撃可能（p.07）→ 「このターン攻撃済み」というブロックを設けない
 *   - アタック強化は次の1回のアタックのみ（p.09, p.12）→ pendingAttackBoostは消費後リセット
 *   - メモリアはアタックカードより先にプレイ（p.09）→ 呼び出し順で自然に強制される
 *     （queueAttackBoostを先に呼んでからdeclareAttackを呼ぶ運用）
 *   - ダメージ計算式（p.12）：アタック強化合計 + アタックカードのダメージ + アタッカーの攻撃力
 *
 * カード効果自体（アタックカードごとの実際のダメージ数値・アタック後効果の中身）は今回実装しない。
 * そのため declareAttack() は attackCardBaseDamage・afterAttackEffect を呼び出し側から渡してもらう
 * 形にしている（将来のCard Effect Engineがこれらを供給する）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('./gameState.js'),
      require('./events.js'),
      require('./resolutionStack.js')
    );
  } else {
    root.XS_ENGINE_COMBAT = factory(root.XS_ENGINE_STATE, root.XS_ENGINE_EVENTS, root.XS_ENGINE_RESOLUTION_STACK);
  }
}(typeof self !== 'undefined' ? self : this, function (GameState, Events, ResolutionStack) {
  'use strict';

  // メモリア／タクティクスの「アタック強化」効果を、次の1回のアタックのために積む。
  // 「メモリアはアタックカードより先にプレイ」を守れば、次に declareAttack() したときに消費される。
  function queueAttackBoost(state, playerId, amount, sourceInstanceId) {
    var player = state.players[playerId];
    player.pendingAttackBoost = (player.pendingAttackBoost || 0) + amount;
    Events.logEvent(state, 'ATTACK_BOOSTED', { playerId: playerId, amount: amount, sourceInstanceId: sourceInstanceId });
    return state;
  }

  // params:
  //   attackerPlayerId, attackerLeaderIndex,
  //   targetPlayerId, targetLeaderIndex,
  //   attackCardBaseDamage (number, カード効果未実装のため呼び出し側が渡す),
  //   afterAttackEffect? (PendingEffectの形。省略可),
  //   cardIndex (hp/atk参照用のカードマスタ索引)
  function declareAttack(state, params, cardIndex) {
    var attackerPlayer = state.players[params.attackerPlayerId];
    var targetPlayer = state.players[params.targetPlayerId];
    var attacker = attackerPlayer.leaders[params.attackerLeaderIndex];
    var target = targetPlayer.leaders[params.targetLeaderIndex];

    if (attacker.isDown) {
      throw new Error('ダウンしているリーダーはアタッカーになれません（spec 3-2章）');
    }
    if (target.isDown) {
      throw new Error('ダウンしているリーダーをアタック対象にすることはできません（spec 3-2章）');
    }

    // ATTACK（アタックする）
    Events.logEvent(state, 'ATTACK_DECLARED', {
      attackerPlayerId: params.attackerPlayerId,
      attackerLeaderIndex: params.attackerLeaderIndex,
      targetPlayerId: params.targetPlayerId,
      targetLeaderIndex: params.targetLeaderIndex,
    });

    // DAMAGE CALCULATION（p.12 ②）：アタック強化合計 + アタックカードのダメージ + アタッカーの攻撃力
    var boost = attackerPlayer.pendingAttackBoost || 0;
    attackerPlayer.pendingAttackBoost = 0; // 次の1回のみ有効。消費後は必ずリセット
    var attackerAtk = GameState.getLeaderCurrentAtk(cardIndex, attacker);
    var totalDamage = boost + (params.attackCardBaseDamage || 0) + attackerAtk;
    Events.logEvent(state, 'DAMAGE_CALCULATED', {
      boost: boost, cardDamage: params.attackCardBaseDamage || 0, attackerAtk: attackerAtk, totalDamage: totalDamage,
    });

    // DAMAGE（ダメージカウンターを乗せる）
    target.damage += totalDamage;
    Events.logEvent(state, 'DAMAGE_DEALT', {
      targetPlayerId: params.targetPlayerId, targetLeaderIndex: params.targetLeaderIndex, amount: totalDamage,
    });

    // DOWN CHECK
    var downed = false;
    if (GameState.getLeaderCurrentHp(cardIndex, target) <= 0 && !target.isDown) {
      target.isDown = true;
      target.damage = 0; // ダウン時、ダメージカウンターをすべて取り除く（spec 3-2章）
      downed = true;
      Events.logEvent(state, 'LEADER_DOWNED', { playerId: params.targetPlayerId, leaderIndex: params.targetLeaderIndex });
    }

    // アタック後効果があればResolutionStackへ積む（中身は今回実装しない。呼び出し側が供給）
    if (params.afterAttackEffect) {
      ResolutionStack.push(state.resolutionStack, params.afterAttackEffect);
      Events.logEvent(state, 'AFTER_ATTACK_EFFECTS_QUEUED', { sourceInstanceId: params.afterAttackEffect.sourceInstanceId });
    }

    // AWAKEN CHECK：対戦相手のリーダーをダウンさせ、かつアタッカーがまだ覚醒していないなら覚醒
    if (downed && !attacker.awakened) {
      attacker.awakened = true;
      Events.logEvent(state, 'LEADER_AWAKENED', { playerId: params.attackerPlayerId, leaderIndex: params.attackerLeaderIndex });
    }

    return { state: state, downed: downed };
  }

  return {
    queueAttackBoost: queueAttackBoost,
    declareAttack: declareAttack,
  };
}));
