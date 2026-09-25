/* Xross Stars — デッキ構築ルール判定（純粋関数のみ。DOM非依存でNode/ブラウザ両対応）
 *
 * 対象外（このモジュールでは判定しない）:
 *   ・データが「要確認」でカードの色/ACE/BANが確定していない場合 → 安全側に倒し、
 *     ACE=不明は「ACEではない」扱い、BAN=不明は存在しないため常にfalse、
 *     buildRuleが未知パターンの場合はUNKNOWNとして返し、呼び出し側が採用可否を勝手に決めない。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.XS_DECK_RULES = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLOR_JA = { red: '赤', blue: '青', yellow: '黄', green: '緑', colorless: '無色' };
  var MAIN_DECK_SIZE = 50;
  var LEADER_COUNT = 4;
  var TACTICS_SIZE = 5;
  var MAX_COPIES = 4;
  var MAX_ACE = 8;

  function leaderColorSet(leaderCards) {
    var set = {};
    leaderCards.forEach(function (l) { if (l && l.color) set[l.color] = (set[l.color] || 0) + 1; });
    return set;
  }

  // buildRuleがある場合の判定。 { status: 'OK'|'FAIL'|'UNKNOWN'|'NONE', reason }
  function evaluateBuildRule(card, leaderCards) {
    var rule = card.buildRuleParsed;
    if (!rule) return { status: 'NONE' };
    if (rule.kind === 'LEADER_NAME') {
      var has = leaderCards.some(function (l) { return l && l.name === rule.leaderName; });
      return has
        ? { status: 'OK' }
        : { status: 'FAIL', reason: '「' + card.name + '」はリーダー「' + rule.leaderName + '」が必要です' };
    }
    if (rule.kind === 'COLOR_COUNT') {
      var colors = leaderColorSet(leaderCards);
      var count = colors[rule.color] || 0;
      var colorJa = COLOR_JA[rule.color] || rule.color;
      return count >= rule.min
        ? { status: 'OK' }
        : { status: 'FAIL', reason: '「' + card.name + '」は' + colorJa + 'リーダー' + rule.min + '体以上が必要です' };
    }
    return { status: 'UNKNOWN', reason: '「' + card.name + '」は特殊ビルドルール（' + rule.raw + '）のため自動判定できません。手動で確認してください。' };
  }

  // 色ゲート: リーダーの色（または無色）に一致するカードのみ候補になる
  function isColorEligible(card, leaderCards) {
    if (!card.color || card.color === 'colorless') return true;
    var colors = leaderColorSet(leaderCards);
    return !!colors[card.color];
  }

  // カード1枚がこの4リーダー編成で採用可能かどうかを総合判定
  // 戻り値: { eligible: true|false|null, reasons: string[] }
  //   eligible=null は「特殊ビルドルールのため自動判定不可」＝勝手に可否を決めない状態
  function evaluateEligibility(card, leaderCards) {
    var reasons = [];
    if (card.ban) {
      return { eligible: false, reasons: ['「' + card.name + '」は現在BANされています'] };
    }
    var colorOk = isColorEligible(card, leaderCards);
    if (!colorOk) {
      var colorJa = COLOR_JA[card.color] || card.color;
      return { eligible: false, reasons: ['「' + card.name + '」は' + colorJa + 'のカードのため、選択中のリーダーの色と一致しません'] };
    }
    var ruleResult = evaluateBuildRule(card, leaderCards);
    if (ruleResult.status === 'FAIL') return { eligible: false, reasons: [ruleResult.reason] };
    if (ruleResult.status === 'UNKNOWN') return { eligible: null, reasons: [ruleResult.reason] };
    return { eligible: true, reasons: [] };
  }

  // 山札（deck.cards）のうちPP系を除いた実カード枚数を数える
  function countableEntries(entries, cardIndex) {
    return entries.filter(function (e) {
      var c = cardIndex[e.cardNumber];
      return c && c.cardType !== 'PP' && c.cardType !== 'PP_TICKET';
    });
  }

  function groupKeyFor(card) {
    // 同名4枚制限はカード名基準。パラレルはparallelGroupIdで同一カード名グループに寄せる。
    return card.name;
  }

  // deck = { leaders: [cardNumber x4], cards: [{cardNumber, count}], tactics: [cardNumber x5] }
  // cardIndex = { [cardNumber]: cardObject }
  function validateDeck(deck, cardIndex) {
    var violations = [];
    var warnings = [];

    var leaderCards = (deck.leaders || []).map(function (num) { return cardIndex[num]; }).filter(Boolean);

    // --- リーダー ---
    if (leaderCards.length !== LEADER_COUNT) {
      violations.push('リーダーが' + LEADER_COUNT + '枚必要です（現在' + leaderCards.length + '枚）');
    }
    var leaderNames = {};
    leaderCards.forEach(function (l) { leaderNames[l.name] = (leaderNames[l.name] || 0) + 1; });
    Object.keys(leaderNames).forEach(function (n) {
      if (leaderNames[n] > 1) violations.push('リーダー「' + n + '」が重複しています（同名リーダーは1枚まで）');
    });

    // --- メインデッキ50枚（PP系除外）---
    var mainEntries = countableEntries(deck.cards || [], cardIndex);
    var totalMain = mainEntries.reduce(function (s, e) { return s + e.count; }, 0);
    if (totalMain !== MAIN_DECK_SIZE) {
      violations.push('デッキは' + MAIN_DECK_SIZE + '枚必要です（現在' + totalMain + '枚）');
    }

    // --- 同名4枚制限 ---
    var nameCounts = {};
    mainEntries.forEach(function (e) {
      var card = cardIndex[e.cardNumber];
      var key = groupKeyFor(card);
      nameCounts[key] = (nameCounts[key] || 0) + e.count;
    });
    Object.keys(nameCounts).forEach(function (name) {
      if (nameCounts[name] > MAX_COPIES) {
        violations.push('「' + name + '」は' + nameCounts[name] + '枚入っています。最大' + MAX_COPIES + '枚です');
      }
    });

    // --- ACE合計8枚 ---
    var aceTotal = mainEntries.reduce(function (s, e) {
      var card = cardIndex[e.cardNumber];
      return s + (card.ace === true ? e.count : 0);
    }, 0);
    if (aceTotal > MAX_ACE) {
      violations.push('ACEカードが' + aceTotal + '枚あります。最大' + MAX_ACE + '枚です');
    }

    // --- 色・ビルドルール・BAN（デッキに入っているカードごと）---
    mainEntries.forEach(function (e) {
      var card = cardIndex[e.cardNumber];
      if (card.ban) {
        violations.push('「' + card.name + '」は現在BANされています');
        return;
      }
      if (!isColorEligible(card, leaderCards)) {
        var colorJa = COLOR_JA[card.color] || card.color;
        violations.push('「' + card.name + '」は' + colorJa + 'のカードのため、選択中のリーダーの色と一致しません');
        return;
      }
      var ruleResult = evaluateBuildRule(card, leaderCards);
      if (ruleResult.status === 'FAIL') violations.push(ruleResult.reason);
      else if (ruleResult.status === 'UNKNOWN') warnings.push(ruleResult.reason);
    });

    // --- タクティクスデッキ5枚・同名禁止・BAN ---
    var tactics = deck.tactics || [];
    if (tactics.length !== TACTICS_SIZE) {
      violations.push('タクティクスデッキは' + TACTICS_SIZE + '枚必要です（現在' + tactics.length + '枚）');
    }
    var tacticsNameSeen = {};
    tactics.forEach(function (num) {
      var card = cardIndex[num];
      if (!card) return;
      if (card.ban) violations.push('「' + card.name + '」は現在BANされています（タクティクス）');
      if (tacticsNameSeen[card.name]) {
        violations.push('タクティクスに「' + card.name + '」が重複しています（同名不可）');
      }
      tacticsNameSeen[card.name] = true;
    });

    return {
      valid: violations.length === 0,
      violations: violations,
      warnings: warnings,
      summary: {
        leaderCount: leaderCards.length,
        mainCount: totalMain,
        aceCount: aceTotal,
        tacticsCount: tactics.length,
        attackCount: mainEntries.reduce(function (s, e) { return s + (cardIndex[e.cardNumber].cardType === 'ATTACK' ? e.count : 0); }, 0),
        memoriaCount: mainEntries.reduce(function (s, e) { return s + (cardIndex[e.cardNumber].cardType === 'MEMORIA' ? e.count : 0); }, 0),
      },
    };
  }

  return {
    MAIN_DECK_SIZE: MAIN_DECK_SIZE,
    LEADER_COUNT: LEADER_COUNT,
    TACTICS_SIZE: TACTICS_SIZE,
    MAX_COPIES: MAX_COPIES,
    MAX_ACE: MAX_ACE,
    leaderColorSet: leaderColorSet,
    evaluateBuildRule: evaluateBuildRule,
    isColorEligible: isColorEligible,
    evaluateEligibility: evaluateEligibility,
    validateDeck: validateDeck,
  };
}));
