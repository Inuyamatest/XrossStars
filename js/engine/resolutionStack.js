/* Xross Stars ゲームエンジン — ResolutionStack
 *
 * 根拠: docs/game-engine-architecture.md 3章
 *
 * 最重要ルール（FAQ Q6 対応）:
 *   PendingEffect.condition は push した時点では評価しない。
 *   resolveOne() が実際にその効果を解決する瞬間にのみ評価する。
 *   これにより「実行順によって後続効果の条件成立が変わる」（超新星／カウンタースナイプの例）を
 *   正しく再現できる。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.XS_ENGINE_RESOLUTION_STACK = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createResolutionStack() {
    return { pending: [] };
  }

  // effect: {
  //   id, sourceInstanceId, trigger, ownerPlayerId,
  //   condition?: (state) => boolean,   // 省略時は常に成立
  //   resolve: (state) => state,
  //   requiresPlayerChoice?: boolean
  // }
  function push(stack, effect) {
    if (!effect || typeof effect.resolve !== 'function') {
      throw new Error('PendingEffect must have a resolve(state) function');
    }
    stack.pending.push(effect);
    return stack;
  }

  function isEmpty(stack) {
    return stack.pending.length === 0;
  }

  function pendingCount(stack) {
    return stack.pending.length;
  }

  // 現在スタックにある効果のうち、指定オーナーのものを一覧する
  // （「ターンを行っているプレイヤーが実行順を選ぶ」spec 12-4章に対応）
  function pendingForOwner(stack, ownerPlayerId) {
    return stack.pending.filter(function (e) { return e.ownerPlayerId === ownerPlayerId; });
  }

  // 1件解決する。
  // chooseIndexFn(candidates, state) が渡され、候補が複数あるときはその戻り値（インデックス）を使う。
  // 渡されない、または候補が1件のみのときは先頭（＝積まれた順、FIFO）を解決する。
  function resolveOne(stack, state, chooseIndexFn) {
    if (isEmpty(stack)) return state;

    var candidates = stack.pending;
    var index = 0;
    if (candidates.length > 1 && typeof chooseIndexFn === 'function') {
      index = chooseIndexFn(candidates.slice(), state);
      if (index < 0 || index >= candidates.length) index = 0;
    }

    var effect = candidates.splice(index, 1)[0];

    // ここでConditionを評価する（宣言時ではなく解決時。FAQ Q6対応）
    if (typeof effect.condition === 'function' && !effect.condition(state)) {
      return state; // 条件不成立＝何も起こらない（No-op）。効果はスタックから取り除かれたまま
    }

    return effect.resolve(state);
  }

  // pendingが空になるまで解決し続ける（chooseIndexFnは毎回呼ばれる）
  function resolveAll(stack, state, chooseIndexFn) {
    while (!isEmpty(stack)) {
      state = resolveOne(stack, state, chooseIndexFn);
    }
    return state;
  }

  return {
    createResolutionStack: createResolutionStack,
    push: push,
    isEmpty: isEmpty,
    pendingCount: pendingCount,
    pendingForOwner: pendingForOwner,
    resolveOne: resolveOne,
    resolveAll: resolveAll,
  };
}));
