/* Xross Stars — オフライン用のサービスワーカー
 * ネットにつながるときは常に最新を取りに行き（ネットワーク優先）、取れたものを端末に控えておく。
 * つながらないときだけ控えを返すので、更新が反映されないことはない。
 */
var CACHE = 'xs-offline-v1';
var CORE = ['./', './battle.html', './index.html', './deckbuilder.html', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).catch(function () { /* 一部取れなくても動かす */ }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok && res.type === 'basic') {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    // オフライン：同じURLの控え → ?v= 違いの控え（バージョン更新後にオフラインになった場合）
    return caches.match(req).then(function (hit) {
      return hit || caches.match(req, { ignoreSearch: true }).then(function (h2) {
        return h2 || (req.mode === 'navigate' ? caches.match('./battle.html', { ignoreSearch: true }) : undefined);
      });
    }).then(function (r) { return r || Response.error(); });
  }));
});
