/* Xross Stars ゲームエンジン — デッキ / ドロー処理
 *
 * 根拠: docs/xross-stars-game-spec.md 19章（FAQ Q1）、docs/game-engine-architecture.md 7章
 *
 * FAQ Q1 のデッキ切れ処理を、責務ごとに分離する：
 *   ensureDeckCards(n) → デッキがn枚未満ならrebuildDeckFromTrash() → consumeTacticsDeck()
 *   → タクティクスも尽きていればdeckOutLoss()で試合敗北
 * drawCard() と、デッキを見る・公開するカード効果（effectResolver）は、デッキのカードを取る前に
 * ensureDeckCards() を呼ぶ。FAQ Q1の実例（リンクアサルト）のとおり、効果の処理途中でも同じ手順を行う。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./events.js'));
  } else {
    root.XS_ENGINE_DECK = factory(root.XS_ENGINE_EVENTS);
  }
}(typeof self !== 'undefined' ? self : this, function (Events) {
  'use strict';

  function shuffle(array) {
    for (var i = array.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }

  // FAQ Q1 手順1：トラッシュの裏向きカードをすべてシャッフルしてデッキに戻す
  function rebuildDeckFromTrash(state, playerId) {
    var player = state.players[playerId];
    var faceDown = player.trash.filter(function (t) { return !t.faceUp; });
    var faceUp = player.trash.filter(function (t) { return t.faceUp; });
    player.trash = faceUp;
    player.deck = player.deck.concat(shuffle(faceDown.map(function (t) { return t.card; })));
    Events.logEvent(state, 'DECK_RESHUFFLED_FROM_TRASH', { playerId: playerId, count: faceDown.length });
    return state;
  }

  // FAQ Q1 手順2の「1枚の選び方」。FAQは「自分でランダムに選ぶ、またはシャッフルして裏向きのまま相手に選んでもらう、
  // などの方法」としている。対戦画面は setTacticsConsumeChooser(fn) で「裏向きのまま相手に選んでもらう」を使う
  // （fn(state, playerId, candidates) => index。candidatesはシャッフル済みの並び）。未設定ならランダム。
  var tacticsConsumeChooser = null;
  function setTacticsConsumeChooser(fn) { tacticsConsumeChooser = fn || null; }

  // FAQ Q1 手順2：タクティクスデッキから1枚選び、表向きにトラッシュへ置く
  // 戻り値: 消費したCardInstance、またはタクティクスデッキが0枚ならnull
  function consumeTacticsDeck(state, playerId) {
    var player = state.players[playerId];
    var n = player.tacticsDeck.length;
    if (n === 0) return null;
    var index;
    var chosenBy = 'RANDOM';
    if (tacticsConsumeChooser && n > 1) {
      // 裏向きのままシャッフルしてから相手に1枚選んでもらう（並び順から中身が分からないように）
      var order = [];
      for (var i = 0; i < n; i++) order.push(i);
      shuffle(order);
      var pick = tacticsConsumeChooser(state, playerId, order.map(function (k) { return player.tacticsDeck[k]; }));
      index = order[(pick >= 0 && pick < n) ? pick : 0];
      chosenBy = 'OPPONENT';
    } else {
      index = Math.floor(Math.random() * n);
    }
    var card = player.tacticsDeck.splice(index, 1)[0];
    player.trash.push({ card: card, faceUp: true });
    Events.logEvent(state, 'TACTICS_CONSUMED', { playerId: playerId, cardId: card.cardId, chosenBy: chosenBy });
    return card;
  }

  // FAQ Q1 手順3：タクティクスデッキも尽きていたら試合に敗北する
  function deckOutLoss(state, playerId) {
    var opponentId = playerId === 'playerA' ? 'playerB' : 'playerA';
    state.match.status = 'FINISHED';
    state.match.winner = opponentId;
    Events.logEvent(state, 'DECK_OUT_LOSS', { loserId: playerId });
    Events.logEvent(state, 'MATCH_ENDED', { winner: opponentId, reason: 'DECK_OUT' });
    return true;
  }

  // デッキ・タクティクスデッキがどちらも0枚なら敗北させる（互換用。デッキ切れ処理の本体は ensureDeckCards）
  function checkDeckOutLoss(state, playerId) {
    var player = state.players[playerId];
    if (player.deck.length > 0 || player.tacticsDeck.length > 0) return false;
    return deckOutLoss(state, playerId);
  }

  // FAQ Q1：デッキのカードがn枚必要な場面（引く・見る・公開する）で、デッキがn枚未満のときの処理。
  //   1. 残っているデッキはそのまま上に置いたまま、トラッシュの裏向きのカードをシャッフルしてその下に戻す
  //   2. タクティクスデッキから1枚（相手が裏向きのまま選ぶ）を表向きでトラッシュに置く
  //      ※再構築でカードが足りた場合も置く（FAQ Q1の実例「リンクアサルト」の処理順、ruleConfig.deckOutPolicy）
  //   3. 置くタクティクスが無ければ、その試合に敗北する
  // それでもn枚に届かなければ、呼び出し側はあるだけで処理する。
  // 戻り値: 処理を続けてよいならtrue、デッキ切れで敗北した（またはすでに試合が終わっている）ならfalse
  function ensureDeckCards(state, playerId, n) {
    var player = state.players[playerId];
    if (player.deck.length >= n) return true;
    if (state.match.status === 'FINISHED') return false;
    Events.logEvent(state, 'DECK_EMPTY', { playerId: playerId, needed: n, remaining: player.deck.length });
    rebuildDeckFromTrash(state, playerId);
    if (consumeTacticsDeck(state, playerId) === null) {
      deckOutLoss(state, playerId);
      return false;
    }
    return true;
  }

  function drawTop(state, playerId) {
    var player = state.players[playerId];
    var card = player.deck.shift();
    player.hand.push(card);
    Events.logEvent(state, 'CARD_DRAWN', { playerId: playerId, cardId: card.cardId });
    return card;
  }

  // カードを1枚引く。FAQ Q1のデッキ切れ処理（ensureDeckCards）を内包する。
  // 戻り値: 引けたCardInstance。引けなかった場合はnull（デッキ切れで敗北した場合も含む）
  function drawCard(state, playerId) {
    if (!ensureDeckCards(state, playerId, 1)) return null;
    if (state.players[playerId].deck.length === 0) return null; // トラッシュにも裏向きのカードが無かった（タクティクスを1枚置いただけ）
    return drawTop(state, playerId);
  }

  // カードをcount枚引く。デッキ切れ処理は「count枚が必要になった」1回として行う
  // （FAQ Q1の実例で「3枚見る」を1回の処理にしているのに合わせる。ruleConfig.deckOutPolicy, PROVISIONAL）。
  // それでも足りなければ、引けるだけ引く。
  function drawCards(state, playerId, count) {
    var drawn = [];
    if (!(count > 0)) return drawn;
    if (!ensureDeckCards(state, playerId, count)) return drawn;
    var player = state.players[playerId];
    for (var i = 0; i < count && player.deck.length > 0; i++) drawn.push(drawTop(state, playerId));
    return drawn;
  }

  return {
    shuffle: shuffle,
    rebuildDeckFromTrash: rebuildDeckFromTrash,
    consumeTacticsDeck: consumeTacticsDeck,
    setTacticsConsumeChooser: setTacticsConsumeChooser,
    checkDeckOutLoss: checkDeckOutLoss,
    ensureDeckCards: ensureDeckCards,
    drawCard: drawCard,
    drawCards: drawCards,
  };
}));
