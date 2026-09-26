/* Xross Stars ゲームエンジン — Condition / Target ファクトリ（Phase D-2）
 *
 * 根拠: docs/xross-stars-game-spec.md 26〜28章 / docs/game-engine-architecture.md 10〜11章
 *
 * なぜ独立ファイルなのか（重要な設計判断）:
 *   cardEffectData.js（カード効果レジストリ）がこれらのファクトリ関数を使うためには、
 *   cardEffectData.js → 本ファイル という依存が必要になる。一方でeffectResolver.jsは
 *   既に cardEffectData.js を require している。もし本ファイルの中身を effectResolver.js に
 *   直接書いていたら、cardEffectData.js が effectResolver.js を require する必要が生じ、
 *   effectResolver.js ⇄ cardEffectData.js の循環依存になってしまう。
 *   そのため、cardEffectData.js からも effectResolver.js からも安全に参照できるよう、
 *   gameState.js以外に依存しない独立モジールとして切り出した
 *   （effectResolver.js は本ファイルをrequireしてそのまま再エクスポートし、
 *   既存のAPI利用側からは引き続き EffectResolver.makeXxx(...) として使える）。
 *
 * cardEffect.js のCondition/Targetは常に生のクロージャ（(state, ctx) => boolean|Ref[]）であり、
 * Actionのようなtype駆動の汎用ディスパッチャは存在しない（既存設計）。そのため今回追加する
 * PLAY_AREA_TYPE_COUNT / SAME_COLOR_AS / OVERKILL_AMOUNT / ONCE_PER_TURN_USED は、
 * 「設定オブジェクトを受け取ってクロージャを返すファクトリ関数」として実装し、
 * CardEffect.condition / target にはそのクロージャをそのまま渡す（型自体は拡張しない）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./gameState.js'));
  } else {
    root.XS_ENGINE_EFFECT_FACTORIES = factory(root.XS_ENGINE_STATE);
  }
}(typeof self !== 'undefined' ? self : this, function (GameState) {
  'use strict';

  function compareByOperator(value, operator, threshold) {
    switch (operator) {
      case 'GTE': return value >= threshold;
      case 'GT': return value > threshold;
      case 'EQ': return value === threshold;
      case 'LTE': return value <= threshold;
      case 'LT': return value < threshold;
      default: throw new Error('未知のoperatorです（PLAY_AREA_TYPE_COUNT/OVERKILL_AMOUNTの設定を確認してください）: ' + operator);
    }
  }

  // ---- PLAY_AREA_TYPE_COUNT ----
  // 「自分/相手の場に特定タイプのカードがN枚以上ある」を判定するCondition。
  // ctx.cardIndexを使ってプレイエリアの各カードのcardTypeをカードマスタから引く
  // （data/cards.jsonの実フィールド名 cardType をそのまま使用。推測していない）。
  // 不正なcardIndex・見つからないカードでもクラッシュせず単に数えないだけにする（安全側）。
  function countPlayAreaByType(state, playerId, cardIndex, cardType) {
    if (!cardIndex) return 0;
    var player = state.players[playerId];
    return player.playArea.reduce(function (count, entry) {
      var card = cardIndex[entry.card.cardId];
      return (card && card.cardType === cardType) ? count + 1 : count;
    }, 0);
  }

  // spec: { player: 'SELF'|'OPPONENT', cardType: 'ATTACK'|'MEMORIA'|'TACTICS'|'LEADER', operator, count }
  function makePlayAreaTypeCountCondition(spec) {
    return function (state, ctx) {
      var playerId = spec.player === 'OPPONENT' ? GameState.getOpponentId(ctx.ownerPlayerId) : ctx.ownerPlayerId;
      var count = countPlayAreaByType(state, playerId, ctx.cardIndex, spec.cardType);
      return compareByOperator(count, spec.operator, spec.count);
    };
  }

  // ---- SAME_COLOR_AS ----
  // 実カード（BP02-039ポイズンボム）の文言「このアタックを受けたリーダーと同じ色を持つ
  // 対戦相手の他のリーダーすべて」に基づき、基準は ctx.targetPlayerId/ctx.targetLeaderIndex
  // （このアタックを受けたリーダー）に固定する。他の基準（自分のリーダー等）が必要な
  // カードは現行データに存在しないため、推測で一般化しない。
  // 色はdata/cards.jsonの実フィールド color をそのまま使用。
  // 基準が取得できない・cardIndexが無い場合は安全にNo-op（[]）にする。
  function makeSameColorAsAttackedLeaderTarget() {
    return function (state, ctx) {
      if (!ctx.cardIndex) return [];
      var opponent = state.players[ctx.targetPlayerId];
      if (!opponent) return [];
      var refLeader = opponent.leaders[ctx.targetLeaderIndex];
      if (!refLeader) return [];
      var refCard = ctx.cardIndex[refLeader.cardId];
      if (!refCard) return [];
      var refColor = refCard.color;
      var results = [];
      opponent.leaders.forEach(function (l, i) {
        if (i === ctx.targetLeaderIndex) return; // 「他の」リーダー
        if (l.isDown) return; // CANNOT_TARGET_DOWNED_LEADER（一般ルール）
        var card = ctx.cardIndex[l.cardId];
        if (card && card.color === refColor) results.push({ playerId: ctx.targetPlayerId, leaderIndex: i });
      });
      return results;
    };
  }

  // ---- OVERKILL_AMOUNT ----
  // PROVISIONAL: 余剰ダメージ＝「与えたダメージ－攻撃前の残りHP」という式は公式資料に一般ルールとして
  // 明記されておらず、各カードの括弧書き説明からの類推（ruleConfig.js参照）。
  // このカード自身のメイン攻撃のみを対象とし、他の効果による累積ダメージは含めない。
  // ctx.overkillAmount は effectResolver.js の playAttackCardWithEffects がダウン発生時のみ設定する
  // （未ダウン/非対応コンテキストではnull）。
  function makeOverkillAmountCondition(spec) {
    return function (state, ctx) {
      if (ctx.overkillAmount == null) return false; // ダウンしなかった、またはOverkillの概念が無いコンテキスト
      return compareByOperator(ctx.overkillAmount, spec.operator, spec.amount);
    };
  }

  // ---- ONCE_PER_TURN_USED ----
  // PROVISIONAL: 識別単位はsourceInstanceId（効果の発生源となったカード/装備インスタンス単位）。
  // 「使用済み」はCondition成立と同時に記録する（対象0件のNo-opでも使用済み扱いになる、という解釈もPROVISIONAL）。
  //
  // Phase D-3A監査で発見・修正: state.turn.turnNumber は match.js の setupNextRound/createMatch で
  // ラウンドが変わるたびに1にリセットされる（ターンはラウンドごとの相対値）。そのため、生のturnNumberだけを
  // 「最後に使用したターン」として保存すると、ラウンド1のターンNで使用した効果が、ラウンド2の（たまたま
  // 同じ）ターンNで誤って「使用済み」と判定されるバグがあった（実際にシミュレーションで再現・確認済み）。
  // 修正として、state.match.roundNumber と state.turn.turnNumber を組み合わせた複合キーで一意化する。
  // これによりmatch.js/phases.js等の既存ファイルには一切手を入れず、リセットは相変わらず「現在のキーとの
  // 比較」だけで自然に行われる（明示的なリセット処理は不要という設計方針は維持）。
  function currentTurnKey(state) {
    return state.match.roundNumber + ':' + state.turn.turnNumber;
  }

  function isEffectUsedThisTurn(state, sourceInstanceId) {
    return !!(state.turn.effectUsage && state.turn.effectUsage[sourceInstanceId] === currentTurnKey(state));
  }

  function markEffectUsedThisTurn(state, sourceInstanceId) {
    state.turn.effectUsage = state.turn.effectUsage || {};
    state.turn.effectUsage[sourceInstanceId] = currentTurnKey(state);
  }

  // innerCondition: 省略可能。「ダウンしているなら」等、ターン1回制限と組み合わせる追加条件。
  function makeOncePerTurnCondition(innerCondition) {
    return function (state, ctx) {
      if (isEffectUsedThisTurn(state, ctx.sourceInstanceId)) return false;
      if (typeof innerCondition === 'function' && !innerCondition(state, ctx)) return false;
      markEffectUsedThisTurn(state, ctx.sourceInstanceId);
      return true;
    };
  }

  // ---- 既存の「対戦相手の他のリーダー」対象選択パターンの共通化（新規登録カード用） ----
  // BP01-018（Phase B、既存のまま無改修）と同じロジックだが、今回の新規カード用に
  // 再利用できるファクトリとして切り出す（既存のBP01-018登録自体は変更しない）。
  function makeSingleOtherOpponentLeaderTarget() {
    return function (state, ctx) {
      var opponent = state.players[ctx.targetPlayerId];
      var candidates = [];
      opponent.leaders.forEach(function (l, i) {
        if (i !== ctx.targetLeaderIndex && !l.isDown) candidates.push({ playerId: ctx.targetPlayerId, leaderIndex: i });
      });
      if (candidates.length === 0) return [];
      var pick = (ctx.chooseTarget ? ctx.chooseTarget(candidates, state) : 0);
      if (pick < 0 || pick >= candidates.length) pick = 0;
      return [candidates[pick]];
    };
  }

  function makeAllOtherOpponentLeadersTarget() {
    return function (state, ctx) {
      var opponent = state.players[ctx.targetPlayerId];
      var results = [];
      opponent.leaders.forEach(function (l, i) {
        if (i !== ctx.targetLeaderIndex && !l.isDown) results.push({ playerId: ctx.targetPlayerId, leaderIndex: i });
      });
      return results;
    };
  }

  // Mondo（ST02-002, Phase B）と同じ「自分の生存リーダー1体を選ぶ」パターンの共通化。
  // 既定では攻撃したリーダー自身を選ぶ（Mondoの既存実装と同じデフォルト）。
  function makeOwnAliveLeaderTarget() {
    return function (state, ctx) {
      var self = state.players[ctx.ownerPlayerId];
      var candidates = [];
      self.leaders.forEach(function (l, i) { if (!l.isDown) candidates.push({ playerId: ctx.ownerPlayerId, leaderIndex: i }); });
      if (candidates.length === 0) return [];
      var pick = (ctx.chooseTarget ? ctx.chooseTarget(candidates, state) : candidates.findIndex(function (c) { return c.leaderIndex === ctx.attackerLeaderIndex; }));
      if (pick < 0) pick = 0;
      return [candidates[pick]];
    };
  }

  // ---- Phase D-3: TEMP_ATK_MODIFIER / DISTRIBUTED_HEAL 用の追加Target ----

  // 自分の生存リーダー「全員」を返す（makeOwnAliveLeaderTargetは1体だけを選ぶ点が異なる）。
  // 先導者の証（自分のリーダーすべての攻撃力+30）、救急キット/ドレインロッド（配分回復の候補）で使用。
  function makeAllOwnAliveLeadersTarget() {
    return function (state, ctx) {
      var self = state.players[ctx.ownerPlayerId];
      var results = [];
      self.leaders.forEach(function (l, i) { if (!l.isDown) results.push({ playerId: ctx.ownerPlayerId, leaderIndex: i }); });
      return results;
    };
  }

  // 対戦相手の生存リーダーから1体を選ぶ（アタック中の「対戦相手の他のリーダー」とは異なり、
  // アタックに紐づかないON_PLAY効果〔例：ドレインロッド〕用。除外対象となる「攻撃を受けたリーダー」が
  // 存在しないため、対戦相手の生存リーダー全員が候補になる）。
  function makeAnyOpponentLeaderTarget() {
    return function (state, ctx) {
      var opponentId = GameState.getOpponentId(ctx.ownerPlayerId);
      var opponent = state.players[opponentId];
      var candidates = [];
      opponent.leaders.forEach(function (l, i) { if (!l.isDown) candidates.push({ playerId: opponentId, leaderIndex: i }); });
      if (candidates.length === 0) return [];
      var pick = (ctx.chooseTarget ? ctx.chooseTarget(candidates, state) : 0);
      if (pick < 0 || pick >= candidates.length) pick = 0;
      return [candidates[pick]];
    };
  }

  // 対戦相手の生存リーダー「全員」を返す（makeAnyOpponentLeaderTargetは単体選択な点が異なる。
  // makeAllOwnAliveLeadersTargetの対戦相手版）。アタックに紐づかないON_PLAY効果（例：勝利へのジャンプ
  // 「対戦相手のリーダーすべてに50ダメージ」）用。
  function makeAllAliveOpponentLeadersTarget() {
    return function (state, ctx) {
      var opponentId = GameState.getOpponentId(ctx.ownerPlayerId);
      var opponent = state.players[opponentId];
      var results = [];
      opponent.leaders.forEach(function (l, i) { if (!l.isDown) results.push({ playerId: opponentId, leaderIndex: i }); });
      return results;
    };
  }

  // ---- Phase E: 条件付きON_ATTACK/ATTACK_BOOSTボーナス用の追加Condition ----

  // 「自分のリーダーの色がすべて異なるなら」（アナイアレーション実装のために新設）。
  // リーダーの色はデッキ構築時に固定される属性であり、ダウン状態などの盤面状況では変化しないため、
  // isDownに関わらず4体全員の色を見る（生存リーダーだけに絞る、という解釈は取らない）。
  // ctx.cardIndexが無い、またはいずれかのリーダーの色が引けない場合は安全にfalseを返す。
  function makeAllLeadersDifferentColorsCondition() {
    return function (state, ctx) {
      if (!ctx.cardIndex) return false;
      var leaders = state.players[ctx.ownerPlayerId].leaders;
      var colors = leaders.map(function (l) {
        var card = ctx.cardIndex[l.cardId];
        return card && card.color;
      });
      if (colors.some(function (c) { return !c; })) return false;
      var unique = {};
      colors.forEach(function (c) { unique[c] = true; });
      return Object.keys(unique).length === colors.length;
    };
  }

  // ---- 第5弾ACE：対象最大N体／アタッカーの状態を見るCondition ----

  // 「対戦相手のリーダー最大N体」（ヴァリアブルピック）。アタックに紐づかないON_PLAY用なので
  // 対戦相手の生存リーダー全員が候補。選択はctx.chooseMultiTargets(candidates, n, state) => index[]。
  // 省略時は先頭からN体を選ぶ（「最大」なので0体も選べるが、ダメージを与える効果のため既定では上限まで選ぶ。
  // PROVISIONAL、ruleConfig.js bp05AcePolicy参照）。範囲外・重複のindexは無視する。
  function makeUpToNOpponentLeadersTarget(n) {
    return function (state, ctx) {
      var opponentId = GameState.getOpponentId(ctx.ownerPlayerId);
      var candidates = [];
      state.players[opponentId].leaders.forEach(function (l, i) { if (!l.isDown) candidates.push({ playerId: opponentId, leaderIndex: i }); });
      if (candidates.length === 0) return [];
      var picks = ctx.chooseMultiTargets
        ? (ctx.chooseMultiTargets(candidates.slice(), n, state) || [])
        : candidates.map(function (c, i) { return i; });
      var seen = {};
      var results = [];
      picks.forEach(function (i) {
        if (results.length >= n || seen[i] || i < 0 || i >= candidates.length) return;
        seen[i] = true;
        results.push(candidates[i]);
      });
      return results;
    };
  }

  function getAttackerLeader(state, ctx) {
    if (ctx.attackerPlayerId == null || ctx.attackerLeaderIndex == null) return null;
    return state.players[ctx.attackerPlayerId].leaders[ctx.attackerLeaderIndex] || null;
  }

  // 「アタッカーがダメージを受けているなら」（デュアルハザード）：ダメージカウンターが1以上乗っている
  function makeAttackerDamagedCondition() {
    return function (state, ctx) {
      var attacker = getAttackerLeader(state, ctx);
      return !!attacker && (attacker.damage || 0) > 0;
    };
  }

  // 「アタッカーの残り体力が10なら」（デュアルハザード）。spec: { operator, value }
  // 残り体力は装備の体力修正込み（GameState.getLeaderCurrentHp）で判定する。
  function makeAttackerRemainingHpCondition(spec) {
    return function (state, ctx) {
      var attacker = getAttackerLeader(state, ctx);
      if (!attacker || !ctx.cardIndex) return false;
      return compareByOperator(GameState.getLeaderCurrentHp(ctx.cardIndex, attacker), spec.operator, spec.value);
    };
  }

  // ---- 未登録だった基本カードの一括登録で追加したCondition/Target ----

  // 「アタッカーが覚醒しているなら」（サイコフォートレス）
  function makeAttackerAwakenedCondition() {
    return function (state, ctx) {
      var attacker = getAttackerLeader(state, ctx);
      return !!attacker && !!attacker.awakened;
    };
  }

  // 「アタッカーがカードを装備しているなら」（勝利の抜刀・バックステージパス）
  function makeAttackerHasEquipmentCondition() {
    return function (state, ctx) {
      var attacker = getAttackerLeader(state, ctx);
      return !!attacker && (attacker.equipment || []).length > 0;
    };
  }

  // 「このラウンドが3ラウンド目なら」
  function makeRoundNumberCondition(n) {
    return function (state) { return state.match.roundNumber === n; };
  }

  // 「自分の手札が2枚以下なら」。spec: { operator, count }（効果を解決する時点の枚数）
  function makeOwnHandSizeCondition(spec) {
    return function (state, ctx) {
      return compareByOperator(state.players[ctx.ownerPlayerId].hand.length, spec.operator, spec.count);
    };
  }

  // 「このアタックを受けたリーダーがダウンしているなら」
  function makeTargetDownedCondition() {
    return function (state, ctx) {
      var t = state.players[ctx.targetPlayerId] && state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex];
      return !!t && t.isDown;
    };
  }

  // 「自分のリーダーが3体ダウンしているなら」。spec: { operator, count }
  function makeOwnDownedLeaderCountCondition(spec) {
    return function (state, ctx) {
      var n = state.players[ctx.ownerPlayerId].leaders.filter(function (l) { return l.isDown; }).length;
      return compareByOperator(n, spec.operator, spec.count);
    };
  }

  // 「このターン、あなたが手札を1枚以上捨てているなら」（短気な爆弾魔）。
  // カード効果による手札破棄（CARD_DISCARDED_BY_EFFECT）がこのターンに記録されているかで判定する
  // （終了フェイズの手札上限による破棄は、そのターンの終わりなので対象にならない）。
  function makeDiscardedThisTurnCondition() {
    return function (state, ctx) {
      return state.actionLog.some(function (e) {
        return e.type === 'CARD_DISCARDED_BY_EFFECT' && e.payload && e.payload.playerId === ctx.ownerPlayerId &&
          e.turnNumber === state.turn.turnNumber && e.roundNumber === state.match.roundNumber;
      });
    };
  }

  // 「プレイエリアに他のカードがないなら」（カウンターブロー）：このカード自身以外にカードがない
  function makeNoOtherCardsInPlayAreaCondition() {
    return function (state, ctx) {
      return state.players[ctx.ownerPlayerId].playArea.every(function (e) { return e.card.instanceId === ctx.sourceInstanceId; });
    };
  }

  // 「対戦相手のダメージを受けている他のリーダーすべて」（ソニックチェイサー）
  function makeAllOtherDamagedOpponentLeadersTarget() {
    return function (state, ctx) {
      var results = [];
      state.players[ctx.targetPlayerId].leaders.forEach(function (l, i) {
        if (i !== ctx.targetLeaderIndex && !l.isDown && l.damage > 0) results.push({ playerId: ctx.targetPlayerId, leaderIndex: i });
      });
      return results;
    };
  }

  // ---- リーダーの所属（「VSPO!」等。data/source/affiliations.json → カードデータの affiliations）----
  function leaderHasAffiliation(cardIndex, leader, affiliation) {
    var card = cardIndex && cardIndex[leader.cardId];
    return !!card && (card.affiliations || []).indexOf(affiliation) >= 0;
  }

  // 自分の「〇〇」を持つリーダーの数（所属は印刷情報なのでダウン中も数える）
  function countOwnLeadersWithAffiliation(state, ctx, affiliation) {
    return state.players[ctx.ownerPlayerId].leaders.filter(function (l) { return leaderHasAffiliation(ctx.cardIndex, l, affiliation); }).length;
  }

  // 「自分のリーダーすべてが『〇〇』を持つなら」（クロスファイア・魔王降臨）
  function makeAllOwnLeadersHaveAffiliationCondition(affiliation) {
    return function (state, ctx) {
      var leaders = state.players[ctx.ownerPlayerId].leaders;
      return leaders.length > 0 && leaders.every(function (l) { return leaderHasAffiliation(ctx.cardIndex, l, affiliation); });
    };
  }

  return {
    compareByOperator: compareByOperator,
    countPlayAreaByType: countPlayAreaByType,
    makePlayAreaTypeCountCondition: makePlayAreaTypeCountCondition,
    makeSameColorAsAttackedLeaderTarget: makeSameColorAsAttackedLeaderTarget,
    makeOverkillAmountCondition: makeOverkillAmountCondition,
    isEffectUsedThisTurn: isEffectUsedThisTurn,
    markEffectUsedThisTurn: markEffectUsedThisTurn,
    makeOncePerTurnCondition: makeOncePerTurnCondition,
    makeSingleOtherOpponentLeaderTarget: makeSingleOtherOpponentLeaderTarget,
    makeAllOtherOpponentLeadersTarget: makeAllOtherOpponentLeadersTarget,
    makeOwnAliveLeaderTarget: makeOwnAliveLeaderTarget,
    makeAllOwnAliveLeadersTarget: makeAllOwnAliveLeadersTarget,
    makeAnyOpponentLeaderTarget: makeAnyOpponentLeaderTarget,
    makeAllAliveOpponentLeadersTarget: makeAllAliveOpponentLeadersTarget,
    makeAllLeadersDifferentColorsCondition: makeAllLeadersDifferentColorsCondition,
    makeUpToNOpponentLeadersTarget: makeUpToNOpponentLeadersTarget,
    makeAttackerDamagedCondition: makeAttackerDamagedCondition,
    makeAttackerRemainingHpCondition: makeAttackerRemainingHpCondition,
    makeAttackerAwakenedCondition: makeAttackerAwakenedCondition,
    makeAttackerHasEquipmentCondition: makeAttackerHasEquipmentCondition,
    makeRoundNumberCondition: makeRoundNumberCondition,
    makeOwnHandSizeCondition: makeOwnHandSizeCondition,
    makeTargetDownedCondition: makeTargetDownedCondition,
    makeOwnDownedLeaderCountCondition: makeOwnDownedLeaderCountCondition,
    makeDiscardedThisTurnCondition: makeDiscardedThisTurnCondition,
    makeNoOtherCardsInPlayAreaCondition: makeNoOtherCardsInPlayAreaCondition,
    makeAllOtherDamagedOpponentLeadersTarget: makeAllOtherDamagedOpponentLeadersTarget,
    countOwnLeadersWithAffiliation: countOwnLeadersWithAffiliation,
    makeAllOwnLeadersHaveAffiliationCondition: makeAllOwnLeadersHaveAffiliationCondition,
  };
}));
