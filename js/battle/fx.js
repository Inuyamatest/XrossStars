/* Xross Stars 対戦UI — 効果音とアタック演出
 *
 * 効果音: 音声ファイルは使わず、Web Audio API でその場で合成する（オフライン・file:// でも鳴る。
 *   ブラウザの自動再生制限のため、最初のクリック／タップで音声を有効化する）。
 * 演出: 盤面の再描画で消えないよう、盤面とは別の固定レイヤー（body直下）に演出用の要素を作る。
 *   ・カードのプレイ … 画面中央にカードを大きく表示する「カットイン」
 *   ・アタック      … アタッカーのカードが相手に飛んでいき、相手に斬撃と閃光、ダメージが大きければ画面が揺れる
 *   ・ダウン        … 衝撃波と大きな揺れ
 *   ・覚醒 / 復活   … 光のバースト
 * 画面側（app.js）は、確定した盤面のactionLogのうち未処理のイベントを play(events, helpers) に渡すだけでよい。
 * 「動きを減らす」設定（prefers-reduced-motion）の端末では、動きの大きい演出を省略する。
 */
(function (root) {
  'use strict';

  var LS_KEY = 'xs-battle-sound';
  var soundOn = true;
  try { soundOn = localStorage.getItem(LS_KEY) !== 'off'; } catch (e) { /* 保存できない環境では既定（ON） */ }
  var reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- 効果音（Web Audio 合成） ----------
  var ctx = null;
  var master = null;
  function audio() {
    if (!soundOn) return null;
    if (!ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // 最初の操作で音声を有効化する（自動再生制限への対応）
  function unlock() { if (soundOn) audio(); }
  root.addEventListener('pointerdown', unlock, { once: true, capture: true });
  root.addEventListener('keydown', unlock, { once: true, capture: true });

  function tone(type, freq, start, dur, vol, freqEnd) {
    var a = audio();
    if (!a) return;
    var t = a.currentTime + (start || 0);
    var o = a.createOscillator();
    var g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.5, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(start, dur, vol, filterFreq, filterEnd) {
    var a = audio();
    if (!a) return;
    var t = a.currentTime + (start || 0);
    var len = Math.max(1, Math.floor(a.sampleRate * dur));
    var buf = a.createBuffer(1, len, a.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = a.createBufferSource();
    src.buffer = buf;
    var f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFreq || 2000, t);
    if (filterEnd) f.frequency.exponentialRampToValueAtTime(filterEnd, t + dur);
    var g = a.createGain();
    g.gain.setValueAtTime(vol || 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  var SOUNDS = {
    play: function () { noise(0, 0.12, 0.25, 5000, 800); tone('triangle', 520, 0.02, 0.1, 0.18, 780); },
    boost: function () { tone('square', 660, 0, 0.08, 0.12); tone('square', 990, 0.07, 0.12, 0.12); },
    attack: function () { noise(0, 0.18, 0.35, 6000, 600); tone('sawtooth', 300, 0, 0.16, 0.15, 120); },
    hit: function (big) {
      noise(0, big ? 0.35 : 0.22, big ? 0.8 : 0.55, big ? 1800 : 2600, 200);
      tone('sine', big ? 150 : 190, 0, big ? 0.35 : 0.22, big ? 0.9 : 0.6, 45);
    },
    small: function () { noise(0, 0.12, 0.35, 3000, 400); tone('sine', 260, 0, 0.12, 0.3, 90); },
    ko: function () {
      noise(0, 0.7, 0.9, 1200, 80);
      tone('sine', 110, 0, 0.7, 1, 30);
      tone('sawtooth', 220, 0.05, 0.45, 0.18, 55);
    },
    awaken: function () {
      [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone('triangle', f, i * 0.07, 0.35, 0.22); });
      noise(0.3, 0.5, 0.12, 9000, 3000);
    },
    heal: function () { [784, 988, 1175].forEach(function (f, i) { tone('sine', f, i * 0.08, 0.3, 0.2); }); },
    turn: function () { tone('triangle', 880, 0, 0.25, 0.22); tone('triangle', 1320, 0.1, 0.35, 0.16); },
    choice: function () { tone('sine', 700, 0, 0.08, 0.18, 1000); },
    round: function () { [392, 523, 659].forEach(function (f, i) { tone('square', f, i * 0.12, 0.25, 0.14); }); },
    win: function () {
      [523, 659, 784, 1047].forEach(function (f, i) { tone('square', f, i * 0.13, 0.28, 0.16); });
      tone('square', 1047, 0.55, 0.7, 0.18); tone('triangle', 784, 0.55, 0.7, 0.14);
    },
  };
  function sound(name, arg) {
    if (!soundOn || !SOUNDS[name]) return;
    try { SOUNDS[name](arg); } catch (e) { /* 音が鳴らせなくてもゲームは続ける */ }
  }

  function setSoundOn(on) {
    soundOn = !!on;
    try { localStorage.setItem(LS_KEY, soundOn ? 'on' : 'off'); } catch (e) { /* 保存できなくても今回は反映 */ }
    if (soundOn) { audio(); sound('choice'); }
  }

  // ---------- 演出レイヤー ----------
  var layer = null;
  function fxLayer() {
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'fx-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }
    return layer;
  }
  function spawn(cls, rect, html, life) {
    var el = document.createElement('div');
    el.className = cls;
    if (rect) {
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.style.width = rect.width + 'px';
      el.style.height = rect.height + 'px';
    }
    if (html) el.innerHTML = html;
    fxLayer().appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, life || 1000);
    return el;
  }
  function rectOf(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  function shake(strength) {
    if (reduceMotion) return;
    var board = document.querySelector('.bt-battle');
    if (!board || !board.animate) return;
    var s = strength || 6;
    board.animate([
      { transform: 'translate(0,0)' }, { transform: 'translate(' + (-s) + 'px,' + (s / 2) + 'px)' },
      { transform: 'translate(' + s + 'px,' + (-s / 2) + 'px)' }, { transform: 'translate(' + (-s / 2) + 'px,' + (s / 3) + 'px)' },
      { transform: 'translate(0,0)' },
    ], { duration: 380, easing: 'ease-out' });
  }

  // カードのカットイン（画面中央に大きく）
  function cutIn(imgSrc, name, label, side) {
    var html = '<div class="fx-cutin-card">' + (imgSrc ? '<img src="' + imgSrc + '" alt="">' : '<span>' + name + '</span>') + '</div>' +
      '<div class="fx-cutin-label"><b>' + label + '</b>' + name + '</div>';
    spawn('fx-cutin' + (side === 'playerB' ? ' pB' : '') + (reduceMotion ? ' still' : ''), null, html, 1150);
  }

  // アタッカーのカードが相手のリーダーへ飛んでいく
  function lunge(fromEl, toEl) {
    var a = rectOf(fromEl);
    var b = rectOf(toEl);
    if (!a || !b || reduceMotion) return;
    var img = fromEl.querySelector('img');
    var ghost = spawn('fx-ghost', a, img ? '<img src="' + img.getAttribute('src') + '" alt="">' : '', 700);
    if (!ghost.animate) return;
    var dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    var dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    ghost.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 0.95 },
      { transform: 'translate(' + dx * 0.15 + 'px,' + dy * 0.15 + 'px) scale(1.08)', opacity: 1, offset: 0.25 },
      { transform: 'translate(' + dx * 0.85 + 'px,' + dy * 0.85 + 'px) scale(0.9)', opacity: 0.9, offset: 0.7 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.6)', opacity: 0 },
    ], { duration: 420, easing: 'cubic-bezier(.5,0,.8,.6)', fill: 'forwards' });
  }

  function hit(el, amount, big) {
    var r = rectOf(el);
    if (!r) return;
    spawn('fx-flash' + (big ? ' big' : ''), r, '', 500);
    if (!reduceMotion) spawn('fx-slash' + (big ? ' big' : ''), r, '<i></i><i></i>', 600);
    if (big) shake(8);
  }
  function smallHit(el) {
    var r = rectOf(el);
    if (!r) return;
    spawn('fx-flash small', r, '', 400);
    if (!reduceMotion) spawn('fx-spark', r, '<i></i><i></i><i></i><i></i>', 600);
  }
  function ko(el) {
    var r = rectOf(el);
    if (r) {
      spawn('fx-shock', r, '', 900);
      spawn('fx-ko-text', r, '<span>DOWN</span>', 1100);
    }
    shake(12);
  }
  function burst(el, kind) {
    var r = rectOf(el);
    if (!r) return;
    spawn('fx-burst ' + kind, r, '<i></i>', 1100);
    if (kind === 'awaken') spawn('fx-ko-text awaken', r, '<span>覚醒！</span>', 1200);
  }

  // ---------- イベント列の再生 ----------
  var busyUntil = 0;
  function remainingMs() { return Math.max(0, busyUntil - Date.now()); }

  // helpers: { leaderEl(pid, idx), cardImg(cardId), cardName(cardId), isLocal(pid) }
  // 戻り値: { total: 演出全体の長さ(ms), hitAt: { 'playerA:0': そのリーダーにダメージ/回復が入る時刻(ms) } }
  // （画面側は、盤面のダメージ数字や揺れをこの時刻まで遅らせて、演出と合わせる）
  function play(events, helpers) {
    var t = 0;
    var hitAt = {};
    var mark = function (pid, idx, ms) { var k = pid + ':' + idx; if (hitAt[k] == null) hitAt[k] = ms; };
    var at = function (delay, fn) { setTimeout(fn, delay); };
    var lastAttack = null;
    events.forEach(function (e) {
      var p = e.payload || {};
      switch (e.type) {
        case 'CARD_PLAYED':
        case 'MEMORIA_PLAYED':
        case 'TACTICS_PLAYED': {
          var label = e.type === 'CARD_PLAYED' ? 'ATTACK' : (e.type === 'MEMORIA_PLAYED' ? 'MEMORIA' : 'TACTICS');
          (function (d) { at(d, function () { cutIn(helpers.cardImg(p.cardId), helpers.cardName(p.cardId), label, p.playerId); sound('play'); }); })(t);
          t += reduceMotion ? 250 : 650;
          break;
        }
        case 'ATTACK_BOOSTED':
          (function (d) { at(d, function () { sound('boost'); }); })(t);
          break;
        case 'ATTACK_DECLARED':
          lastAttack = p;
          (function (d, a) {
            at(d, function () {
              lunge(helpers.leaderEl(a.attackerPlayerId, a.attackerLeaderIndex), helpers.leaderEl(a.targetPlayerId, a.targetLeaderIndex));
              sound('attack');
            });
          })(t, p);
          t += reduceMotion ? 120 : 380;
          break;
        case 'DAMAGE_DEALT':
          if (p.targetPlayerId != null) {
            (function (d, q) {
              at(d, function () { hit(helpers.leaderEl(q.targetPlayerId, q.targetLeaderIndex), q.amount, q.amount >= 80); sound('hit', q.amount >= 80); });
            })(t, p);
            mark(p.targetPlayerId, p.targetLeaderIndex, t);
            t += 260;
          } else if (p.source === 'CARD_EFFECT') {
            (function (d, q) { at(d, function () { smallHit(helpers.leaderEl(q.playerId, q.leaderIndex)); sound('small'); }); })(t, p);
            mark(p.playerId, p.leaderIndex, t);
            t += 200;
          }
          break;
        case 'LEADER_DOWNED':
          (function (d, q) { at(d, function () { ko(helpers.leaderEl(q.playerId, q.leaderIndex)); sound('ko'); }); })(t + 80, p);
          t += 480;
          break;
        case 'LEADER_AWAKENED':
          (function (d, q) { at(d, function () { burst(helpers.leaderEl(q.playerId, q.leaderIndex), 'awaken'); sound('awaken'); }); })(t, p);
          t += 520;
          break;
        case 'LEADER_REVIVED':
          (function (d, q) { at(d, function () { burst(helpers.leaderEl(q.playerId, q.leaderIndex), 'heal'); sound('heal'); }); })(t, p);
          mark(p.playerId, p.leaderIndex, t);
          t += 400;
          break;
        case 'TURN_STARTED':
          (function (d) { at(d, function () { sound('turn'); }); })(t);
          break;
        case 'ROUND_ENDED':
          (function (d) { at(d, function () { sound('round'); }); })(t + 200);
          t += 300;
          break;
        case 'MATCH_ENDED':
          (function (d) { at(d, function () { sound('win'); }); })(t + 300);
          break;
        default:
          break;
      }
    });
    busyUntil = Math.max(busyUntil, Date.now() + t);
    return { total: t, hitAt: hitAt };
  }

  root.XS_BATTLE_FX = {
    play: play,
    sound: sound,
    isSoundOn: function () { return soundOn; },
    setSoundOn: setSoundOn,
    remainingMs: remainingMs,
  };
}(typeof self !== 'undefined' ? self : this));
