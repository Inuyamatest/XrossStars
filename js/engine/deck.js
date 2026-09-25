/* Xross Stars ゲームエンジン — デッキ / ドロー処理
 *
 * 根拠: docs/xross-stars-game-spec.md 19章（FAQ Q1）、docs/game-engine-architecture.md 7章
 *
 * FAQ Q1 のフォールバック連鎖を、1つの巨大関数にせず責務ごとに分離する：
 *   drawCard() → 必要ならrebuildDeckFromTrash() → それでも足りなければconsumeTacticsDeck()
 *   → それも尽きていればcheckDeckOutLoss()で試合敗北
 *
 * 注意（設計判断・PROVISIONALではなく実装上の割り切り）:
 *   FAQ Q1の実例（アタックカード「リンクアサルト」）は、デッキ切れのフォールバックが
 *   個別カード効果の処理途中で発生する複雑なケースを示している。今回はカード効果自体を
 *   実装しないため、drawCard() は「山札が尽きた状態でタクティクスデッキを消費した場合、
 *   手札には何も加えられない（消費という事実だけが発生する）」という最小限の解釈で実装する。
 *   個別カード効果と組み合わせた挙動は Card Effect Engine 側の責務とする。
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

  // FAQ Q1 手順2：タクティクスデッキからランダムに1枚選び、表向きにトラッシュへ置く
  // 戻り値: 消費したCardInstance、またはタクティクスデッキが0枚ならnull
  function consumeTacticsDeck(state, playerId) {
    var player = state.players[playerId];
    if (player.tacticsDeck.length === 0) return null;
    var index = Math.floor(Math.random() * player.tacticsDeck.length);
    var card = player.tacticsDeck.splice(index, 1)[0];
    player.trash.push({ card: card, faceUp: true });
    Events.logEvent(state, 'TACTICS_CONSUMED', { playerId: playerId, cardId: card.cardId });
    return card;
  }

  // FAQ Q1 手順3：タクティクスデッキも尽きていたら試合に敗北する
  function checkDeckOutLoss(state, playerId) {
    var player = state.players[playerId];
    if (player.deck.length > 0 || player.tacticsDeck.length > 0) return false;
    var opponentId = playerId === 'playerA' ? 'playerB' : 'playerA';
    state.match.status = 'FINISHED';
    state.match.winner = opponentId;
    Events.logEvent(state, 'DECK_OUT_LOSS', { loserId: playerId });
    Events.logEvent(state, 'MATCH_ENDED', { winner: opponentId, reason: 'DECK_OUT' });
    return true;
  }

  // カードを1枚引く。FAQ Q1のフォールバック連鎖を内包する。
  // 戻り値: 引けたCardInstance、または（デッキ・トラッシュ・タクティクスデッキすべて尽きて）
  //         引けなかった場合はnull（この場合checkDeckOutLossにより敗北処理が実行済み）
  function drawCard(state, playerId) {
    var player = state.players[playerId];

    if (player.deck.length === 0) {
      Events.logEvent(state, 'DECK_EMPTY', { playerId: playerId });
      rebuildDeckFromTrash(state, playerId);
    }

    if (player.deck.length === 0) {
      var consumed = consumeTacticsDeck(state, playerId);
      if (consumed === null) {
        checkDeckOutLoss(state, playerId);
        return null;
      }
      // タクティクスデッキを消費しても手札には何も加わらない（上記コメント参照）
      return null;
    }

    var card = player.deck.shift();
    player.hand.push(card);
    Events.logEvent(state, 'CARD_DRAWN', { playerId: playerId, cardId: card.cardId });
    return card;
  }

  function drawCards(state, playerId, count) {
    var drawn = [];
    for (var i = 0; i < count; i++) {
      if (state.match.status === 'FINISHED') break; // デッキ切れ敗北が発生したら止める
      var card = drawCard(state, playerId);
      if (card) drawn.push(card);
    }
    return drawn;
  }

  return {
    shuffle: shuffle,
    rebuildDeckFromTrash: rebuildDeckFromTrash,
    consumeTacticsDeck: consumeTacticsDeck,
    checkDeckOutLoss: checkDeckOutLoss,
    drawCard: drawCard,
    drawCards: drawCards,
  };
}));
