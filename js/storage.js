/* Xross Stars — リーダーのカスタマイズ内容（名前・テキスト・数値・画像）の保存
 *
 * 保存先はこの端末のブラウザ内 IndexedDB（DB: xs-hp / store: leaderOverrides）。
 * キーはリーダーID（例 "BP01-001"）、値は上書きしたいフィールドだけを持つオブジェクト。
 * 画像は data URL で保存する（保存前に XS_COMPRESS_IMAGE で縮小しておく）。
 */
(function () {
  var DB_NAME = 'xs-hp', STORE = 'leaderOverrides';

  function open() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var out = fn(t.objectStore(STORE));
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : undefined); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  window.XS_STORE = {
    loadAll: function () {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(STORE, 'readonly'), s = t.objectStore(STORE);
          var out = {};
          var req = s.openCursor();
          req.onsuccess = function () {
            var c = req.result;
            if (c) { out[c.key] = c.value; c.continue(); } else resolve(out);
          };
          req.onerror = function () { reject(req.error); };
        });
      }).catch(function (e) { console.warn('[XS_STORE] load failed', e); return {}; });
    },
    save: function (id, data) { return tx('readwrite', function (s) { return s.put(data, id); }); },
    remove: function (id) { return tx('readwrite', function (s) { return s.delete(id); }); }
  };

  // 画像ファイルを長辺 max px 以内に縮小して JPEG の data URL にする
  window.XS_COMPRESS_IMAGE = function (file, max) {
    max = max || 900;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * s));
        c.height = Math.max(1, Math.round(img.height * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
      img.src = url;
    });
  };
})();
