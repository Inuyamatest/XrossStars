/* Xross Stars ゲームエンジン — カードマスタ参照ヘルパー
 *
 * エンジン本体はカードデータの出所を知らない（依存注入）。
 * ブラウザでは window.XS_DECKBUILDER_CARDS（js/deckbuilder/cards-data.js）を、
 * Node（テスト）では data/cards.json を、それぞれ呼び出し側が buildCardIndex() に渡す。
 * 既存の data/cards.json・js/deckbuilder/cards-data.js は一切変更しない（参照のみ）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.XS_ENGINE_CARD_LOOKUP = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function buildCardIndex(cardList) {
    var index = {};
    (cardList || []).forEach(function (c) { index[c.cardNumber] = c; });
    return index;
  }

  // Node専用の便利関数（テストで使用）。ブラウザでは使わない。
  function loadDefaultCardIndexNode() {
    // eslint-disable-next-line global-require
    var cards = require('../../data/cards.json');
    return buildCardIndex(cards);
  }

  return {
    buildCardIndex: buildCardIndex,
    loadDefaultCardIndexNode: loadDefaultCardIndexNode,
  };
}));
