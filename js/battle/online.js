/* Xross Stars 対戦UI — オンライン対戦の通信（部屋を作る側＝ホスト＝プレイヤーA、URLで参加する側＝ゲスト＝プレイヤーB）
 *
 * GitHub Pages のような静的サイトのまま遊べるよう、サーバーは置かずに2台のブラウザを直接つなぐ（WebRTC）。
 * つなぐまでの仲介だけ、PeerJS の無料の公開サーバーを使う（js/vendor/peerjs.min.js）。
 * 試合の進め方（app.js側）は「両方の端末で同じ手順を再生する」方式なので、やり取りするのは
 * 行動（どのカードをどう使ったか）・乱数のシード・選択画面の答えだけで、盤面そのものは送らない。
 *
 * 通信手段は2種類:
 *   peer  … 本番用（PeerJS / WebRTC）
 *   local … 同じブラウザの別タブどうし（BroadcastChannel）。自動テストと動作確認用（URLに ?net=local）
 *
 * createConnection({ role, code, mode }) の戻り値:
 *   { send(msg), close(), onMessage(fn), onStatus(fn), code }
 *   status: 'waiting'（ホストが相手を待っている）| 'connected' | 'disconnected' | 'error'
 */
(function (root) {
  'use strict';

  var PREFIX = 'xsbattle-';

  function randomCode() {
    var chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    var s = '';
    for (var i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function createEmitter() {
    var handlers = { message: [], status: [] };
    return {
      on: function (type, fn) { handlers[type].push(fn); },
      emit: function (type, arg) { handlers[type].forEach(function (fn) { try { fn(arg); } catch (e) { console.error(e); } }); },
    };
  }

  // ---------- 同じブラウザの別タブどうし（テスト用） ----------
  function createLocal(opts) {
    var ev = createEmitter();
    var me = Math.random().toString(36).slice(2);
    var ch = new BroadcastChannel(PREFIX + opts.code);
    var connected = false;
    ch.onmessage = function (e) {
      var d = e.data;
      if (!d || d.from === me) return;
      if (d.kind === 'hello-link') {
        if (!connected) { connected = true; ev.emit('status', 'connected'); }
        if (opts.role === 'host') ch.postMessage({ from: me, kind: 'hello-link' });
        return;
      }
      if (d.kind === 'bye') { connected = false; ev.emit('status', 'disconnected'); return; }
      if (d.kind === 'msg') ev.emit('message', d.msg);
    };
    setTimeout(function () {
      if (opts.role === 'host') ev.emit('status', 'waiting');
      else ch.postMessage({ from: me, kind: 'hello-link' });
    }, 0);
    root.addEventListener('beforeunload', function () { ch.postMessage({ from: me, kind: 'bye' }); });
    return {
      code: opts.code,
      send: function (msg) { ch.postMessage({ from: me, kind: 'msg', msg: msg }); },
      close: function () { ch.postMessage({ from: me, kind: 'bye' }); ch.close(); },
      onMessage: function (fn) { ev.on('message', fn); },
      onStatus: function (fn) { ev.on('status', fn); },
    };
  }

  // ---------- 本番用（PeerJS / WebRTC） ----------
  function createPeer(opts) {
    var ev = createEmitter();
    var PeerCtor = root.Peer;
    if (!PeerCtor) {
      setTimeout(function () { ev.emit('status', 'error'); }, 0);
      return { code: opts.code, send: function () {}, close: function () {}, onMessage: function (fn) { ev.on('message', fn); }, onStatus: function (fn) { ev.on('status', fn); } };
    }
    var conn = null;
    var peer = null;
    var closed = false;

    function attach(c) {
      if (conn && conn !== c) { try { conn.close(); } catch (e) { /* 古い接続は捨てる */ } }
      conn = c;
      c.on('open', function () { ev.emit('status', 'connected'); });
      c.on('data', function (d) { ev.emit('message', d); });
      c.on('close', function () { if (conn === c) { conn = null; if (!closed) ev.emit('status', opts.role === 'host' ? 'waiting' : 'disconnected'); } });
      c.on('error', function () { if (conn === c && !closed) ev.emit('status', 'disconnected'); });
    }

    if (opts.role === 'host') {
      peer = new PeerCtor(PREFIX + opts.code);
      peer.on('open', function () { ev.emit('status', 'waiting'); });
      peer.on('connection', function (c) { attach(c); });
    } else {
      peer = new PeerCtor();
      peer.on('open', function () { attach(peer.connect(PREFIX + opts.code, { reliable: true, serialization: 'json' })); });
    }
    peer.on('error', function (err) {
      if (closed) return;
      ev.emit('status', err && err.type === 'unavailable-id' ? 'code-taken' : (err && err.type === 'peer-unavailable' ? 'no-room' : 'error'));
    });
    peer.on('disconnected', function () { if (!closed) { try { peer.reconnect(); } catch (e) { /* 仲介サーバーへの再接続を試みる */ } } });

    return {
      code: opts.code,
      send: function (msg) { if (conn && conn.open) conn.send(msg); },
      close: function () { closed = true; try { if (conn) conn.close(); peer.destroy(); } catch (e) { /* 閉じるだけ */ } },
      onMessage: function (fn) { ev.on('message', fn); },
      onStatus: function (fn) { ev.on('status', fn); },
    };
  }

  function createConnection(opts) {
    return (opts.mode === 'local' ? createLocal : createPeer)(opts);
  }

  // 盤面の要約から作るハッシュ（2台の盤面がずれていないかの確認用）
  function stateHash(state) {
    var parts = [state.match.roundNumber, state.turn.turnNumber, state.turn.activePlayer, state.match.status];
    ['playerA', 'playerB'].forEach(function (pid) {
      var p = state.players[pid];
      parts.push(p.hand.map(function (c) { return c.instanceId; }).join(','));
      parts.push(p.deck.length, p.deck.slice(0, 3).map(function (c) { return c.instanceId; }).join(','));
      parts.push(p.trash.length, p.playArea.map(function (e) { return e.card.instanceId; }).join(','));
      parts.push(p.ppCards.max, p.ppCards.tapped, p.pendingAttackBoost || 0);
      p.leaders.forEach(function (l) { parts.push(l.damage, l.isDown ? 1 : 0, l.awakened ? 1 : 0, (l.equipment || []).length); });
    });
    var str = parts.join('|');
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  root.XS_BATTLE_ONLINE = {
    createConnection: createConnection,
    randomCode: randomCode,
    stateHash: stateHash,
  };
}(typeof self !== 'undefined' ? self : this));
