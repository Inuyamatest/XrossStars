/* Xross Stars — デッキコードのエンコード/デコード（サーバー不要。URLハッシュに埋め込む）
 *
 * 保存する内容はカード番号のみ（カード名やテキストは持たない）。
 * 復元時は data/cards.json（カードマスタ）と突き合わせて表示する。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.XS_DECK_CODE = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function utf8ToBase64Url(str) {
    var bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
    var b64 = (typeof btoa !== 'undefined' ? btoa(bytes) : Buffer.from(bytes, 'binary').toString('base64'));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToUtf8(b64url) {
    var b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = (typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'));
    var percentEncoded = '';
    for (var i = 0; i < bin.length; i++) {
      var hex = bin.charCodeAt(i).toString(16);
      percentEncoded += '%' + (hex.length === 1 ? '0' + hex : hex);
    }
    return decodeURIComponent(percentEncoded);
  }

  // deck = { name, leaders:[cardNumber x4], cards:[{cardNumber,count}], tactics:[cardNumber x5] }
  function encode(deck) {
    var compact = {
      n: deck.name || '',
      l: deck.leaders || [],
      c: (deck.cards || []).map(function (e) { return [e.cardNumber, e.count]; }),
      t: deck.tactics || [],
      v: 1,
    };
    return utf8ToBase64Url(JSON.stringify(compact));
  }

  function decode(code) {
    var obj = JSON.parse(base64UrlToUtf8(code));
    return {
      name: obj.n || '',
      leaders: obj.l || [],
      cards: (obj.c || []).map(function (pair) { return { cardNumber: pair[0], count: pair[1] }; }),
      tactics: obj.t || [],
    };
  }

  return { encode: encode, decode: decode };
}));
