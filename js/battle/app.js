/* Xross Stars 対戦UI — js/engine/* の上に乗るローカル対戦画面（1台の端末で2人が交互に操作する対戦台方式）
 *
 * 前提・簡略化していること（PROVISIONAL。js/engine側のルール実装自体は変更しない）:
 *   - 手札・タクティクスエリアの非公開情報は、同一画面を2人で見る対戦台方式のため簡略化する
 *     （タクティクスエリアの中身は両者に見える。手札は「自分の手番のときだけ」中身を表示する）。
 *   - 対象や「してもよい」を選ぶ必要がある効果（chooseTarget等）は、選択画面で選ぶ
 *     （仕組みは js/battle/choices.js 参照。行動を盤面のコピーで実行し、選択のたびにやり直す）。
 *   - ResolutionStackに複数の効果が同時に積まれた場合の解決順も、js/engine側のデフォルト（積んだ順）に委ねる。
 *   - data/cards.jsonの全カードのうち、実際にjs/engine/cardEffectData.jsへ効果が登録されているのは
 *     一部のみ。未登録カードは「アタックカードの上乗せダメージ0」「プレイ時効果なし」として扱われる
 *     （カード効果自体は今回のUI実装では追加しない）。
 */
(function () {
  'use strict';

  var CARDS = window.XS_DECKBUILDER_CARDS || [];
  var CARD_INDEX = {};
  CARDS.forEach(function (c) { CARD_INDEX[c.cardNumber] = c; });

  var Eng = {
    GameState: window.XS_ENGINE_STATE,
    Events: window.XS_ENGINE_EVENTS,
    ResolutionStack: window.XS_ENGINE_RESOLUTION_STACK,
    Deck: window.XS_ENGINE_DECK,
    Combat: window.XS_ENGINE_COMBAT,
    Phases: window.XS_ENGINE_PHASES,
    Match: window.XS_ENGINE_MATCH,
    RuleConfig: window.XS_ENGINE_RULE_CONFIG,
    CardEffectData: window.XS_ENGINE_CARD_EFFECT_DATA,
    Resolver: window.XS_ENGINE_EFFECT_RESOLVER,
    CardLookup: window.XS_ENGINE_CARD_LOOKUP,
  };
  var cardIndex = Eng.CardLookup.buildCardIndex(CARDS);
  var Choices = window.XS_BATTLE_CHOICES;
  var Cpu = window.XS_BATTLE_CPU;
  var Fx = window.XS_BATTLE_FX;
  var Online = window.XS_BATTLE_ONLINE;
  // オンライン対戦で2台のプログラムが同じかどうかの確認用（違うと同じ手順を再生しても結果がずれる）
  var APP_VERSION = '20260927b';

  var COLOR_JA = { red: '赤', blue: '青', green: '緑', yellow: '黄', colorless: '無色' };
  var TYPE_JA = { LEADER: 'リーダー', ATTACK: 'アタック', MEMORIA: 'メモリア', TACTICS: 'タクティクス', PP: 'PP', PP_TICKET: 'PPチケット' };
  var EQUIP_ACTION_TYPES = ['EQUIP_HP_MODIFIER', 'EQUIP_ATK_MODIFIER', 'EQUIP_GRANT_ABILITY', 'EQUIP_BASE_HP_OVERRIDE', 'EQUIP_TARGET_FLAG'];
  var PP_TICKET_CARD_ID = 'ST01-024';
  var LS_KEY = 'xs-deckbuilder-decks';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function opponentOf(playerId) { return Eng.GameState.getOpponentId(playerId); }
  function cardOf(cardId) { return cardIndex[cardId] || { name: cardId, cardNumber: cardId }; }
  function cardImg(card, awakened) { return (awakened && card.imageUrlAwakened) ? card.imageUrlAwakened : card.imageUrl; }

  function isEquipmentCard(cardId) {
    if ((window.XS_EQUIPMENT || []).some(function (e) { return e.id === cardId; })) return true;
    return Eng.CardEffectData.getEffectsForCard(cardId).some(function (e) {
      return e.action && EQUIP_ACTION_TYPES.indexOf(e.action.type) >= 0;
    });
  }

  // ---------- 保存済みデッキ（js/deckbuilder/app.js と同じlocalStorageキーを共有） ----------
  function loadSavedDecks() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }

  function expandDeckCardIds(deck) {
    var ids = [];
    (deck.cards || []).forEach(function (e) { for (var i = 0; i < e.count; i++) ids.push(e.cardNumber); });
    return ids;
  }

  // ---------- テスト用ランダムデッキ生成（保存済みデッキが無くてもすぐ対戦できるようにするための補助。
  //            デッキ構築ルールの色ゲート・同名4枚・ACE8枚はなるべく守るが、公式の厳密なデッキ構築物ではない） ----------
  function shuffled(arr) { return arr.slice().sort(function () { return Math.random() - 0.5; }); }

  function buildRandomDeck(name) {
    var allLeaders = CARDS.filter(function (c) { return c.cardType === 'LEADER'; });
    var chosenLeaders = [];
    var usedNames = {};
    var pool = shuffled(allLeaders);
    for (var i = 0; i < pool.length && chosenLeaders.length < 4; i++) {
      var cand = pool[i];
      if (!usedNames[cand.name]) { usedNames[cand.name] = true; chosenLeaders.push(cand); }
    }

    var eligiblePool = CARDS.filter(function (c) {
      if (c.cardType === 'LEADER' || c.cardType === 'PP' || c.cardType === 'PP_TICKET') return false;
      if (c.ban) return false;
      return window.XS_DECK_RULES.evaluateEligibility(c, chosenLeaders).eligible === true;
    });
    var mainPool = shuffled(eligiblePool.filter(function (c) { return c.cardType !== 'TACTICS'; }));
    var tacticsPool = shuffled(eligiblePool.filter(function (c) { return c.cardType === 'TACTICS'; }));

    var deckCards = {};
    var aceCount = 0, total = 0, guard = 0;
    while (total < 50 && mainPool.length > 0 && guard < 5000) {
      guard++;
      var c = mainPool[Math.floor(Math.random() * mainPool.length)];
      var curCopies = 0;
      Object.keys(deckCards).forEach(function (num) { if (CARD_INDEX[num].name === c.name) curCopies += deckCards[num]; });
      if (curCopies >= 4) continue;
      if (c.ace && aceCount >= 8) continue;
      deckCards[c.cardNumber] = (deckCards[c.cardNumber] || 0) + 1;
      if (c.ace) aceCount++;
      total++;
    }

    var tacticsNames = {};
    var tactics = [];
    tacticsPool.forEach(function (c) {
      if (tactics.length < 5 && !tacticsNames[c.name]) { tacticsNames[c.name] = true; tactics.push(c.cardNumber); }
    });

    return {
      name: name,
      leaders: chosenLeaders.map(function (c) { return c.cardNumber; }),
      cards: Object.keys(deckCards).map(function (num) { return { cardNumber: num, count: deckCards[num] }; }),
      tactics: tactics,
      generated: true,
    };
  }


  // ---------- 画面状態 ----------
  var root = document.getElementById('bt-body');
  var screen = 'setup'; // 'setup' | 'battle'
  var setup = {
    savedDecks: loadSavedDecks(),
    playerA: { source: 'NONE', savedIndex: null, generatedDeck: null },
    playerB: { source: 'NONE', savedIndex: null, generatedDeck: null },
    mode: 'STANDARD',
    firstPlayer: 'playerA',
    opponent: 'HUMAN', // 'HUMAN'（2人で交互に操作） | 'CPU'（プレイヤーBをCPUが操作）
    cpuLevel: loadCpuLevel(), // 'EASY'（弱） | 'NORMAL'（中） | 'HARD'（強）
  };
  var CPU_LEVEL_JA = { EASY: '弱', NORMAL: '中', HARD: '強' };
  function loadCpuLevel() {
    try { var v = localStorage.getItem('xs-battle-cpu-level'); if (v === 'EASY' || v === 'NORMAL' || v === 'HARD') return v; } catch (e) { /* 保存できない環境 */ }
    return 'NORMAL';
  }
  function saveCpuLevel(v) { try { localStorage.setItem('xs-battle-cpu-level', v); } catch (e) { /* 保存できない環境 */ } }
  function cpuLabel() { return 'CPU（' + CPU_LEVEL_JA[setup.cpuLevel] + '）'; }
  var game = null; // { state }
  var sel = null;  // 手番プレイヤーの操作中の選択状態
  var logOpen = false;
  var lastRoundBanner = null;
  var detailCardId = null;   // カード詳細モーダルで表示中のカード
  var seenActive = null;     // 手番交代画面を最後に確認したプレイヤー（対戦台で相手の手札を見せないため）
  var prevHp = {};           // 直前の描画時点の各リーダー残りHP（ダメージ/回復演出用）
  var prevPp = {};           // 直前の描画時点の各プレイヤーのPP { max, tapped }（PPカードを倒す/起こす演出用）
  var notice = null;         // 操作できなかった理由などの一言メッセージ（次の操作で消える）
  var pendingChoice = null;  // 選択待ちの行動 { base, seed, answers, fn, onDone, question, preview, selection, revealed }

  var PLAYER_LABEL = { playerA: 'プレイヤーA', playerB: 'プレイヤーB' };

  // ---------- CPU対戦 ----------
  // game.cpu: CPUが操作するプレイヤー（'playerB'）。人どうしの対戦ではnull。
  function isCpu(pid) { return !!(game && game.cpu && game.cpu === pid); }
  function cpuTurnActive() { return !!(game && game.cpu && game.state.turn.activePlayer === game.cpu && game.state.match.status !== 'FINISHED' && game.state.turn.phase !== 'ROUND_SETUP'); }
  // この端末で操作するプレイヤー（CPU対戦では人の側、オンライン対戦では自分の側。人どうしの対戦ではnull）
  function humanId() {
    if (game && game.cpu) return game.cpu === 'playerA' ? 'playerB' : 'playerA';
    if (game && game.online) return game.online.local;
    return null;
  }
  // この端末からは操作しない側（CPU、またはオンライン対戦の相手）
  function isRemoteSide(pid) { return !!(game && ((game.cpu && game.cpu === pid) || (game.online && game.online.local !== pid))); }
  function opponentTurnActive() { return !!(game && game.state.match.status !== 'FINISHED' && isRemoteSide(game.state.turn.activePlayer)); }
  function pShort(pid) { return pid === 'playerA' ? 'A' : 'B'; }
  function pBadge(pid) { return '<span class="bt-pbadge' + (pid === 'playerB' ? ' pB' : '') + '">' + pShort(pid) + '</span>'; }

  function deckFor(side) {
    var s = setup[side];
    if (s.source === 'SAVED' && s.savedIndex != null) return setup.savedDecks[s.savedIndex];
    if (s.source === 'RANDOM') return s.generatedDeck;
    return null;
  }

  function render() {
    root.innerHTML = screen === 'setup' ? renderSetup() : renderBattle();
    bindEvents();
    syncDockHeight();
    if (previewEl) refreshPreview(); // 要素が作り直されたので、マウスの位置にあるカードで表示し直す
    playNewEffects();
    scheduleCpu();
    scheduleRoundSetup();
  }

  // 手札ドック（固定表示）の実際の高さに合わせて盤面の下余白を取り、最下段が隠れないようにする
  function syncDockHeight() {
    var dock = root.querySelector('.bt-dock');
    document.documentElement.style.setProperty('--dock-h', (dock ? dock.offsetHeight : 0) + 'px');
  }
  window.addEventListener('resize', syncDockHeight);

  // カードテキストを読みやすく：〖プレイ時〗等の見出しを色付きのラベルにし、見出しごとに改行する
  var KW_CLASS = { 'プレイ時': 'play', 'アタックする': 'atk', 'アタック後': 'after', 'アタック強化': 'boost', '覚醒時': 'awake', 'ラウンド中': 'round' };
  function formatCardText(text) {
    if (!text) return '';
    var html = esc(text).replace(/\s*〖([^〗]+)〗\s*/g, function (m, kw) {
      return '\n<span class="bt-kw ' + (KW_CLASS[kw] || '') + '">' + kw + '</span>';
    });
    html = html.replace(/(エコー)（/g, '\n<span class="bt-kw echo">$1</span>（');
    return html.replace(/^\n/, '').replace(/\n+/g, '<br>');
  }

  function imgTag(card, awakened, cls) {
    var src = cardImg(card, awakened);
    return src ? '<img src="' + esc(src) + '" alt="' + esc(card.name) + '" loading="lazy">'
      : '<div class="' + cls + '">' + esc(card.name) + '</div>';
  }

  // ================= セットアップ画面 =================
  function renderSetup() {
    if (net) return renderOnlineSetup();
    return '' +
      '<div class="bt-setup">' +
        '<div class="bt-hero"><h2>BATTLE</h2><p>1台の端末で2人が交互に操作するローカル対戦、またはCPUとの対戦</p></div>' +
        '<div class="bt-setup-players">' +
          renderSetupPanel('playerA') +
          '<div class="bt-vs">VS</div>' +
          renderSetupPanel('playerB') +
        '</div>' +
        '<div class="bt-setup-options">' +
          '<div class="bt-opt">モード <span class="bt-seg">' +
            '<button data-act="set-mode" data-value="STANDARD" class="' + (setup.mode === 'STANDARD' ? 'on' : '') + '">スタンダード（2本先取）</button>' +
            '<button data-act="set-mode" data-value="QUICK" class="' + (setup.mode === 'QUICK' ? 'on' : '') + '">クイック（1本先取）</button>' +
          '</span></div>' +
          '<div class="bt-opt">プレイヤーB <span class="bt-seg">' +
            '<button data-act="set-opponent" data-value="HUMAN" class="' + (setup.opponent === 'HUMAN' ? 'on' : '') + '">人（交互に操作）</button>' +
            '<button data-act="set-opponent" data-value="CPU" class="' + (setup.opponent === 'CPU' ? 'on' : '') + '">CPU</button>' +
          '</span></div>' +
          (setup.opponent === 'CPU' ? '<div class="bt-opt">CPUの強さ <span class="bt-seg">' +
            ['EASY', 'NORMAL', 'HARD'].map(function (lv) {
              return '<button data-act="set-cpu-level" data-value="' + lv + '" class="' + (setup.cpuLevel === lv ? 'on' : '') + '">' + CPU_LEVEL_JA[lv] + '</button>';
            }).join('') +
          '</span></div>' : '') +
          '<div class="bt-opt">先攻 <span class="bt-seg">' +
            '<button data-act="set-first" data-value="playerA" class="' + (setup.firstPlayer === 'playerA' ? 'on' : '') + '">A</button>' +
            '<button data-act="set-first" data-value="playerB" class="' + (setup.firstPlayer === 'playerB' ? 'on' : '') + '">B</button>' +
          '</span></div>' +
          '<button class="bt-btn ghost" data-act="coinflip">ランダムで決める</button>' +
        '</div>' +
        '<div class="bt-start-row"><button class="bt-btn primary big" data-act="start">対戦開始</button>' +
          '<button class="bt-btn big" data-act="online-host">オンライン対戦（URLを送って対戦）</button></div>' +
        '<details class="bt-notes"><summary>この対戦画面について</summary>' +
          '対象や「してもよい」を選ぶ効果は、選択画面で選びます。' +
          'カード効果はエンジンに登録済みのカードのみ再現されており、未登録カードはアタックカードなら上乗せダメージ0、それ以外はプレイ時効果なしとして扱われます。' +
          '2人で遊ぶときは、手札は自分の手番のときだけ表示され、手番交代時は確認画面を挟みます。' +
          'プレイヤーBを「CPU」にすると、CPUが自動で手番を進めます。強さは3段階です。' +
          '弱：ときどきランダムな手を選んだり、途中でターンを終えたりします。' +
          '中：倒せる相手を優先して狙う、シンプルな思考です。' +
          '強：使える手をすべて試して、ターンの終わりまで先読みして一番よい手を選びます（相手の手札・山札は見ません）。' +
        '</details>' +
      '</div>';
  }

  function renderSetupPanel(side) {
    var s = setup[side];
    var deck = deckFor(side);
    var savedOptions = setup.savedDecks.map(function (d, i) {
      return '<option value="' + i + '"' + (s.source === 'SAVED' && s.savedIndex === i ? ' selected' : '') + '>' + esc(d.name) + '</option>';
    }).join('');

    var leaderCards = deck ? (deck.leaders || []).map(function (n) { return CARD_INDEX[n]; }).filter(Boolean) : [];
    var thumbs = '';
    for (var i = 0; i < 4; i++) {
      var c = leaderCards[i];
      thumbs += c ? '<div class="bt-thumb" title="' + esc(c.name) + '">' + imgTag(c, false, 'bt-lnoimg') + '</div>'
        : '<div class="bt-thumb empty">LEADER</div>';
    }

    var summary = '';
    if (deck) {
      var validation = window.XS_DECK_RULES.validateDeck(deck, CARD_INDEX);
      summary = '' +
        '<div class="bt-deck-summary">' +
          '<span class="bt-chip">リーダー ' + leaderCards.length + '/4</span>' +
          '<span class="bt-chip">デッキ ' + validation.summary.mainCount + '/50</span>' +
          '<span class="bt-chip">タクティクス ' + (deck.tactics || []).length + '/5</span>' +
          (deck.generated ? '<span class="bt-chip warn">自動生成</span>' : '') +
        '</div>' +
        (validation.valid ? '' : '<div class="bt-deck-violations">' + validation.violations.map(function (v) { return '× ' + esc(v); }).join('<br>') + '</div>') +
        (validation.warnings.length ? '<div class="bt-deck-warnings">' + validation.warnings.map(function (w) { return '! ' + esc(w); }).join('<br>') + '</div>' : '');
    } else {
      summary = '<div class="bt-deck-summary"><span class="bt-chip">デッキ未選択</span></div>';
    }

    return '' +
      '<div class="bt-setup-panel" data-side="' + side + '">' +
        '<h3>' + pBadge(side) + esc(PLAYER_LABEL[side]) + (deck ? '<span style="color:var(--sub);font-weight:500;font-size:12px">— ' + esc(deck.name) + '</span>' : '') + '</h3>' +
        '<div class="bt-deck-leaders">' + thumbs + '</div>' +
        '<div class="bt-setup-row">' +
          '<select class="bt-select" data-act="pick-saved" data-side="' + side + '">' +
            '<option value="">保存済みデッキから選択…</option>' +
            savedOptions +
          '</select>' +
          '<button class="bt-btn" data-act="pick-random" data-side="' + side + '">ランダムデッキ</button>' +
        '</div>' +
        summary +
      '</div>';
  }

  function buildMatchConfig(deckA, deckB) {
    return {
      matchId: 'local-' + Date.now(),
      mode: setup.mode,
      firstPlayer: setup.firstPlayer,
      playerA: {
        leaderCardIds: deckA.leaders.slice(0, 4),
        deckCardIds: expandDeckCardIds(deckA),
        tacticsDeckCardIds: (deckA.tactics || []).slice(),
      },
      playerB: {
        leaderCardIds: deckB.leaders.slice(0, 4),
        deckCardIds: expandDeckCardIds(deckB),
        tacticsDeckCardIds: (deckB.tactics || []).slice(),
      },
      ppTicketCardId: PP_TICKET_CARD_ID,
      deferRoundSetup: true, // 各ラウンド：タクティクスを選んで置いてから手札を配る（SETUP行動）
    };
  }

  function startMatch() {
    var deckA = deckFor('playerA');
    var deckB = deckFor('playerB');
    if (!deckA || !deckB) { alert('両プレイヤーのデッキを選択してください（保存済みデッキ、またはランダムデッキ）'); return; }
    if ((deckA.leaders || []).length !== 4 || (deckB.leaders || []).length !== 4) {
      alert('両プレイヤーとも、リーダーを4体選択したデッキが必要です'); return;
    }

    var config = buildMatchConfig(deckA, deckB);

    var state;
    try {
      state = Eng.Match.createMatch(config); // タクティクスの選択と手札の配布は、画面を出してから SETUP 行動で
    } catch (e) {
      alert('対戦を開始できませんでした: ' + e.message);
      return;
    }

    game = { state: state, cpu: setup.opponent === 'CPU' ? 'playerB' : null, fxSeen: state.actionLog.length };
    PLAYER_LABEL.playerA = 'プレイヤーA';
    game.cpuLevel = setup.cpuLevel;
    PLAYER_LABEL.playerB = game.cpu ? cpuLabel() : 'プレイヤーB';
    cpuTurn = { key: null, excluded: {}, steps: 0, last: null };
    sel = null;
    lastRoundBanner = null;
    detailCardId = null;
    seenActive = null;
    prevHp = {};
    prevPp = {};
    screen = 'battle';
    render();
  }

  // ================= 対戦画面 =================
  function renderBattle() {
    if (pendingChoice) {
      // 選択中は、効果の解決途中の盤面（そこまでのダメージ等が反映されたもの）を操作不可で表示する
      var choiceHtml = renderBattleBoard(pendingChoice.preview, true, true) +
        (pendingChoice.waitingRemote ? renderWaitingRemoteOverlay() : renderChoiceOverlay(pendingChoice)) + renderNetBanner();
      if (detailCardId) choiceHtml += renderDetailOverlay(detailCardId);
      return choiceHtml;
    }
    if (game.hold) {
      // ラウンドが決まった一撃の直後は、その瞬間の盤面（最後のリーダーがDOWN）を操作不可で残し、演出を見せきる
      var holdHtml = renderBattleBoard(game.hold.view, true, false);
      if (detailCardId) holdHtml += renderDetailOverlay(detailCardId);
      if (logOpen) holdHtml += renderLogDrawer(game.state);
      return holdHtml + renderNetBanner();
    }
    var state = game.state;
    var finished = state.match.status === 'FINISHED';
    // CPU対戦では手番交代の確認画面は不要（人のプレイヤーは常に自分の側を見ている）
    var settingUp = state.turn.phase === 'ROUND_SETUP';
    var handoffPending = !game.cpu && !game.online && !finished && !lastRoundBanner && !settingUp && state.turn.activePlayer !== seenActive;
    var html = renderBattleBoard(state, finished, handoffPending);

    if (finished) html += renderMatchEndOverlay(state);
    else if (lastRoundBanner) html += renderRoundEndOverlay(lastRoundBanner);
    else if (handoffPending) html += renderHandoffOverlay(state);
    else if (settingUp && game.online && net && net.role !== 'host') html += renderWaitingSetupOverlay();
    if (detailCardId) html += renderDetailOverlay(detailCardId);
    if (logOpen) html += renderLogDrawer(state);
    html += renderNetBanner();
    return html;
  }

  // ---------- オンライン対戦の表示 ----------
  function renderWaitingRemoteOverlay() {
    return '<div class="bt-overlay bt-net-wait"><div class="bt-overlay-box"><div class="bt-cpu-thinking" style="justify-content:center"><span class="bt-cpu-dot"></span><b>相手が選択しています…</b></div>' +
      '<p>相手のカードの効果で、相手が選ぶ場面です。</p></div></div>';
  }

  function renderWaitingSetupOverlay() {
    return '<div class="bt-overlay bt-net-wait"><div class="bt-overlay-box"><div class="bt-cpu-thinking" style="justify-content:center"><span class="bt-cpu-dot"></span><b>ラウンドの準備を待っています…</b></div>' +
      '<p>お互いにタクティクスを選んでから、手札が配られます。</p></div></div>';
  }

  // 接続が切れた・盤面がずれた等の知らせ（画面上部）
  function renderNetBanner() {
    if (!game || !game.online || !net) return '';
    if (net.status === 'disconnected' || net.status === 'error' || net.status === 'no-room') {
      return '<div class="bt-net-banner bad"><b>相手との接続が切れました。</b>' +
        (net.role === 'guest' ? '<button class="bt-btn primary" data-act="net-reconnect">再接続</button>' : '相手の再接続を待っています…') + '</div>';
    }
    if (net.role === 'host' && net.status === 'waiting') {
      return '<div class="bt-net-banner bad"><b>相手との接続が切れました。</b>相手が同じURLを開き直すと、続きから再開できます。</div>';
    }
    if (game.online.desync) {
      return '<div class="bt-net-banner bad"><b>相手と盤面がずれました。</b>' +
        (net.role === 'guest' ? '<button class="bt-btn primary" data-act="net-resync">ホストの盤面に合わせる</button>' : '相手に「ホストの盤面に合わせる」を押してもらってください。') + '</div>';
    }
    return '';
  }

  function renderBattleBoard(state, readOnly, hideHand) {
    var bottom = humanId() || state.turn.activePlayer; // 手番プレイヤーが常に下側（CPU・オンライン対戦では自分の側が常に下側）
    var top = opponentOf(bottom);
    var hpNow = snapshotHp(state);
    var deltas = {};
    Object.keys(hpNow).forEach(function (k) { if (prevHp[k] != null && prevHp[k] !== hpNow[k]) deltas[k] = hpNow[k] - prevHp[k]; });
    if (Object.keys(deltas).some(function (k) { return deltas[k] > 0 && hpNow[k] > 0; })) healSoundPending = true;
    prevHp = hpNow;
    ['playerA', 'playerB'].forEach(function (pid) {
      var cur = state.players[pid].ppCards;
      var was = prevPp[pid];
      if (was && (was.max !== cur.max || was.tapped !== cur.tapped)) deltas['pp:' + pid] = was;
      prevPp[pid] = { max: cur.max, tapped: cur.tapped };
    });

    return '' +
      '<div class="bt-battle">' +
        renderScore(state) +
        renderSide(state, top, readOnly, deltas, false, true) +
        renderCenter(state) +
        renderSide(state, bottom, readOnly, deltas, true, !!hideHand && !humanId()) +
      '</div>' +
      (readOnly ? '' : renderDock(state, bottom, hideHand));
  }

  function snapshotHp(state) {
    var out = {};
    ['playerA', 'playerB'].forEach(function (pid) {
      state.players[pid].leaders.forEach(function (l, i) {
        out[pid + ':' + i] = l.isDown ? 0 : Eng.GameState.getLeaderCurrentHp(cardIndex, l);
      });
    });
    return out;
  }

  function renderScore(state) {
    var w = state.match.roundWins;
    return '' +
      '<div class="bt-score">' +
        '<span class="bt-sc">' + pBadge('playerA') + '<b>' + w.playerA + '</b></span>' +
        '<span class="bt-round">ROUND ' + state.match.roundNumber + '<span class="bt-mode"> ・ ' + (state.match.mode === 'QUICK' ? 'クイック' : 'スタンダード') + '</span></span>' +
        '<span class="bt-sc"><b>' + w.playerB + '</b>' + pBadge('playerB') + '</span>' +
        '<button class="bt-btn ghost bt-soundbtn" data-act="toggle-sound" title="効果音">' + (Fx.isSoundOn() ? '音 ON' : '音 OFF') + '</button>' +
        '<button class="bt-btn ghost bt-logbtn" data-act="toggle-log">ログ</button>' +
      '</div>';
  }

  // hideSecret: 裏向きのタクティクスを裏面で表示する（相手側。人どうしの対戦で端末を渡す前は自分側も）
  function renderSide(state, playerId, readOnly, deltas, isBottom, hideSecret) {
    var player = state.players[playerId];
    var isActive = playerId === state.turn.activePlayer;
    var pp = player.ppCards.max - player.ppCards.tapped;
    var strip = '' +
      '<div class="bt-strip">' +
        '<span class="bt-pname">' + pBadge(playerId) + '<span class="bt-plabel">' + esc(PLAYER_LABEL[playerId]) + '</span></span>' +
        (isActive ? '<span class="bt-turntag">' + (isCpu(playerId) ? 'CPU TURN' : (game.online && isRemoteSide(playerId) ? 'OPPONENT TURN' : 'YOUR TURN')) + '</span>' : '') +
        '<span class="bt-pp" title="PP（プレイポイントカード）：縦向き＝使える ' + pp + '枚 / 横向き＝使用済み ' + player.ppCards.tapped + '枚">' + renderPpCards(player, deltas['pp:' + playerId]) + '<span class="bt-pp-num">' + pp + '/' + player.ppCards.max + '</span></span>' +
        renderBoostBadge(player) +
        '<span class="bt-counters">' +
          '<span class="bt-counter" title="山札">山札 <b>' + player.deck.length + '</b></span>' +
          '<span class="bt-counter" title="手札">手札 <b>' + player.hand.length + '</b></span>' +
          '<span class="bt-counter" title="トラッシュ">トラッシュ <b>' + player.trash.length + '</b></span>' +
        '</span>' +
      '</div>';
    var row = '' +
      '<div class="bt-row">' +
        '<div class="bt-leaders">' + player.leaders.map(function (l, i) { return renderLeader(playerId, l, i, readOnly, deltas[playerId + ':' + i]); }).join('') + '</div>' +
        renderField(state, playerId, isActive, readOnly, hideSecret) +
      '</div>';
    return '<section class="bt-side' + (playerId === 'playerB' ? ' pB' : '') + (isActive ? ' is-active' : ' is-opp') + '">' +
      strip + row + '</section>';
  }

  // PPはプレイポイントカードで表す。使える分は縦向き、使った分は横向き（右から倒れていく）。
  // was: 直前の描画時点の { max, tapped }（変化があったときだけ）。倒れた/起きた/増えたカードに演出を付ける
  function renderPpCards(player, was) {
    var max = player.ppCards.max;
    var tapped = player.ppCards.tapped;
    var untappedNow = max - tapped;
    var untappedWas = was ? Math.min(was.max, was.max - was.tapped) : untappedNow;
    var html = '<span class="bt-ppcards">';
    for (var i = 0; i < max; i++) {
      var used = i >= untappedNow;
      var cls = 'bt-ppc' + (used ? ' used' : '');
      if (was) {
        if (was.max <= i) cls += ' added';                                   // ラウンドで増えたPPカード
        else if (used && i < untappedWas) cls += ' tapping';                 // いま払った
        else if (!used && i >= untappedWas) cls += ' untapping';             // いま回復した
      }
      html += '<span class="' + cls + '"><img src="cards/pp-mini.webp" alt="" draggable="false"></span>';
    }
    html += '</span>';
    if (was) {
      var diff = untappedNow - untappedWas;
      if (was.max < max) html += '<span class="bt-pp-float up">PPカード+' + (max - was.max) + '</span>';
      else if (diff < 0) html += '<span class="bt-pp-float down">PP' + diff + '</span>';
      else if (diff > 0) html += '<span class="bt-pp-float up">PP+' + diff + '</span>';
    }
    return html;
  }

  function leaderPickState(playerId, leader, idx, readOnly) {
    var r = { pickable: false, attacker: false, target: false, enemy: false };
    if (readOnly || !sel || leader.isDown) {
      if (sel && sel.kind === 'ATTACK') {
        r.attacker = playerId === sel.ownerId && sel.attackerLeaderIndex === idx;
        r.target = playerId === opponentOf(sel.ownerId) && sel.targetLeaderIndex === idx;
      }
      return r;
    }
    if (sel.kind === 'ATTACK') {
      if (playerId === sel.ownerId) {
        r.pickable = sel.mode === 'PICK_ATTACKER' || sel.mode === 'PICK_TARGET' || sel.mode === 'READY';
        r.attacker = sel.attackerLeaderIndex === idx;
      } else {
        r.enemy = true;
        // ターゲットフラッグを装備したリーダーがいれば、そのリーダーにしかアタックできない
        r.pickable = (sel.mode === 'PICK_TARGET' || sel.mode === 'READY') &&
          Eng.Resolver.getAllowedAttackTargets(game.state, sel.ownerId).indexOf(idx) >= 0;
        r.target = sel.targetLeaderIndex === idx;
      }
    } else if (sel.mode === 'PICK_EQUIP_LEADER' && playerId === sel.ownerId) {
      r.pickable = true;
    }
    return r;
  }

  function renderLeader(playerId, leader, idx, readOnly, delta) {
    var card = cardOf(leader.cardId);
    var maxHp = Eng.GameState.getLeaderMaxHp(cardIndex, leader);
    var curHp = Eng.GameState.getLeaderCurrentHp(cardIndex, leader);
    var atk = Eng.GameState.getLeaderCurrentAtk(cardIndex, leader);
    var pct = maxHp > 0 ? Math.max(0, Math.min(100, Math.round(curHp / maxHp * 100))) : 0;
    var hpCls = pct <= 30 ? ' lo' : (pct <= 60 ? ' mid' : '');
    var p = leaderPickState(playerId, leader, idx, readOnly);

    var cls = 'bt-leader' +
      (leader.isDown ? ' down' : '') +
      (leader.awakened ? ' awakened' : '') +
      (p.pickable ? ' pickable' : '') +
      (p.enemy ? ' pick-enemy' : '') +
      (p.attacker ? ' is-attacker' : '') +
      (p.target ? ' is-target' : '') +
      (delta && delta < 0 ? ' hit' : '');

    var equipNames = leader.equipment.map(function (eq) { return cardOf(eq.cardId).name; });
    var tags = '';
    if (leader.awakened) tags += '<span class="bt-tag awake">覚醒</span>';
    if (equipNames.length) tags += '<span class="bt-tag equip" title="' + esc(equipNames.join('、')) + '">装備' + equipNames.length + '</span>';
    if (leader.equipment.some(function (eq) { return eq.targetFlag; })) tags += '<span class="bt-tag flag" title="対戦相手はこのリーダーにしかアタックできない">フラッグ</span>';
    if (p.attacker) tags += '<span class="bt-tag">アタッカー</span>';
    if (p.target) tags += '<span class="bt-tag" style="background:var(--red)">対象</span>';

    var floater = '';
    if (delta) floater = '<span class="bt-float' + (delta > 0 ? ' heal' : '') + '">' + (delta > 0 ? '+' : '') + delta + '</span>';

    return '' +
      '<div class="' + cls + '" data-leader="' + playerId + ':' + idx + '"' + (p.pickable ? ' data-act="pick-leader" data-player="' + playerId + '" data-index="' + idx + '" role="button" tabindex="0"' : '') + '>' +
        '<div class="bt-lcard" data-preview="' + esc(leader.cardId) + '"' + (leader.awakened ? ' data-preview-awakened="1"' : '') + '>' +
          imgTag(card, leader.awakened, 'bt-lnoimg') +
          '<div class="bt-badge-top">' + tags + '</div>' +
          '<button class="bt-info" data-act="show-detail" data-card="' + esc(leader.cardId) + '" title="カード詳細">i</button>' +
          (leader.isDown ? '<div class="bt-down-stamp"><span>DOWN</span></div>' : '') +
          '<div class="bt-lhud">' +
            '<div class="bt-lname">' + esc(card.name) + '</div>' +
            '<div class="bt-lstats"><span class="bt-hpnum">' + (leader.isDown ? 0 : curHp) + '<small>/' + maxHp + '</small></span><span class="bt-atk"><i>ATK </i>' + atk + '</span></div>' +
            '<div class="bt-hpbar"><div class="bt-hpfill' + hpCls + '" style="width:' + (leader.isDown ? 0 : pct) + '%"></div></div>' +
          '</div>' +
        '</div>' +
        floater +
      '</div>';
  }

  function renderField(state, playerId, isActive, readOnly, hideSecret) {
    var player = state.players[playerId];
    if (isRemoteSide(playerId)) readOnly = true; // CPU・オンラインの相手のカードは操作できない
    var canPlay = !readOnly && isActive && Eng.Phases.canPlayTactics(state);
    var pp = player.ppCards.max - player.ppCards.tapped;

    var tactics = player.tacticsArea.length ? player.tacticsArea.map(function (t) {
      // 相手が選んで裏向きに置いたタクティクスは見せない（表向きのPPチケットは見せる）
      if (hideSecret && !t.faceUp) {
        return '<div class="bt-mini tactics secret" title="裏向きのタクティクス"><div class="bt-mcard bt-mback"><span>TACTICS</span></div></div>';
      }
      var card = cardOf(t.card.cardId);
      var equip = isEquipmentCard(t.card.cardId);
      var affordable = card.cost != null && card.cost <= pp;
      var disabled = !canPlay || !affordable || !Eng.Resolver.canPlayCardNow(state, playerId, t.card.cardId, cardIndex);
      return '' +
        '<div class="bt-mini tactics" title="' + esc(card.name) + '（C' + (card.cost != null ? card.cost : '?') + '・' + (equip ? '装備' : '消費') + '）">' +
          '<div class="bt-mcard" data-act="show-detail" data-card="' + esc(t.card.cardId) + '" data-preview="' + esc(t.card.cardId) + '">' + imgTag(card, false, 'bt-mnoimg') + '</div>' +
          (isActive && !readOnly ? '<button class="bt-mplay' + (disabled ? '' : ' ready') + '" data-act="play-tactics" data-instance="' + esc(t.card.instanceId) + '" data-equip="' + (equip ? 1 : 0) + '"' + (disabled ? ' disabled' : '') + '>' + (equip ? '装備' : '使う') + '</button>' : '') +
        '</div>';
    }).join('') : '<span class="bt-zone-empty">なし</span>';

    var play = player.playArea.length ? player.playArea.map(function (e) {
      var card = cardOf(e.card.cardId);
      // エコーで横向きになっているカードは横向きに表示する（次の自分のメインフェイズ開始時にプレイし直される）
      if (e.echoHorizontal) {
        return '<div class="bt-mini echo" title="' + esc(card.name) + '（エコー：横向き）" data-act="show-detail" data-card="' + esc(e.card.cardId) + '" data-preview="' + esc(e.card.cardId) + '"><div class="bt-mcard">' + imgTag(card, false, 'bt-mnoimg') + '</div><span class="bt-echo-tag">ECHO</span>' + pendingTag(player, e.card.instanceId) + '</div>';
      }
      return '<div class="bt-mini" title="' + esc(card.name) + '" data-act="show-detail" data-card="' + esc(e.card.cardId) + '" data-preview="' + esc(e.card.cardId) + '"><div class="bt-mcard">' + imgTag(card, false, 'bt-mnoimg') + '</div>' + pendingTag(player, e.card.instanceId) + '</div>';
    }).join('') : '<span class="bt-zone-empty">なし</span>';

    return '' +
      '<div class="bt-field">' +
        '<div><div class="bt-zone-label">TACTICS</div><div class="bt-zone">' + tactics + '</div></div>' +
        '<div><div class="bt-zone-label">PLAY AREA</div><div class="bt-zone">' + play + '</div></div>' +
      '</div>';
  }

  // ---------- 直近の出来事（ログを読みやすい日本語に） ----------
  function leaderNameOf(pid, idx) {
    var p = game && game.state.players[pid];
    var l = p && p.leaders[idx];
    return l ? cardOf(l.cardId).name : '?';
  }

  // 使ったPPの表示（コストを支払わずにプレイしたときはその旨）
  function ppPaidText(p) {
    if (p.free) return '（コストなし）';
    return typeof p.ppPaid === 'number' ? '（PP−' + p.ppPaid + '）' : '';
  }

  function describeEvent(e) {
    var p = e.payload || {};
    switch (e.type) {
      case 'TURN_STARTED': return { cls: 'turn', text: PLAYER_LABEL[p.playerId] + 'のターン' };
      case 'ROUND_STARTED': return { cls: 'turn', text: 'ラウンド' + p.roundNumber + '開始' };
      case 'CARD_PLAYED': return { cls: 'play', text: pShort(p.playerId) + '：アタック「' + cardOf(p.cardId).name + '」' + ppPaidText(p) };
      case 'MEMORIA_PLAYED': return { cls: 'play', text: pShort(p.playerId) + '：メモリア「' + cardOf(p.cardId).name + '」' + ppPaidText(p) };
      case 'TACTICS_PLAYED': return { cls: 'play', text: pShort(p.playerId) + '：タクティクス「' + cardOf(p.cardId).name + '」' + ppPaidText(p) };
      case 'PP_RECOVERED': return { cls: '', text: pShort(p.playerId) + '：PPを' + p.amount + '回復' + (p.cardId ? '（「' + cardOf(p.cardId).name + '」）' : '') };
      case 'ATTACK_BOOSTED': return { cls: '', text: pShort(p.playerId) + '：アタック強化 +' + p.amount };
      case 'DAMAGE_DEALT': {
        var tp = p.targetPlayerId || p.playerId;
        var ti = p.targetLeaderIndex != null ? p.targetLeaderIndex : p.leaderIndex;
        return { cls: 'dmg', text: pShort(tp) + '「' + leaderNameOf(tp, ti) + '」に' + p.amount + 'ダメージ' };
      }
      case 'LEADER_DOWNED': return { cls: 'down', text: pShort(p.playerId) + '「' + leaderNameOf(p.playerId, p.leaderIndex) + '」ダウン' };
      case 'LEADER_AWAKENED': return { cls: 'awake', text: pShort(p.playerId) + '「' + leaderNameOf(p.playerId, p.leaderIndex) + '」覚醒！' };
      case 'EQUIPMENT_ATTACHED': return { cls: 'play', text: pShort(p.playerId) + '「' + leaderNameOf(p.playerId, p.leaderIndex) + '」に「' + cardOf(p.cardId).name + '」を装備' };
      case 'CARD_ADDED_TO_HAND_BY_EFFECT': return { cls: '', text: pShort(p.playerId) + '：デッキから1枚を手札に加えた' };
      case 'FREE_ATTACK_PLAYED_BY_EFFECT': return { cls: 'play', text: pShort(p.playerId) + '：「' + cardOf(p.cardId).name + '」をコストを支払わずにプレイ' };
      case 'ECHO_TURNED_HORIZONTAL': return { cls: '', text: pShort(p.playerId) + '：「' + cardOf(p.cardId).name + '」はエコーで横向きに' };
      case 'ECHO_REPLAYED': return { cls: 'play', text: pShort(p.playerId) + '：エコー「' + cardOf(p.cardId).name + '」をプレイし直した' };
      case 'LEADER_REVIVED': return { cls: 'awake', text: pShort(p.playerId) + '「' + leaderNameOf(p.playerId, p.leaderIndex) + '」が復活！' };
      case 'TACTICS_RETURNED_TO_AREA': return { cls: '', text: pShort(p.playerId) + '：「' + cardOf(p.cardId).name + '」をタクティクスエリアに戻した' };
      case 'CARD_DISCARDED_BY_EFFECT': return { cls: '', text: pShort(p.playerId) + '：「' + cardOf(p.cardId).name + '」を捨てた' };
      case 'END_PHASE_DRAW': return p.count > 0 ? { cls: '', text: pShort(p.playerId) + '：残りPPで' + p.count + '枚ドロー' } : null;
      case 'HAND_DISCARDED_OVER_LIMIT': return { cls: '', text: pShort(p.playerId) + '：手札上限で' + p.count + '枚捨てた' };
      case 'DECK_RESHUFFLED_FROM_TRASH': return { cls: '', text: pShort(p.playerId) + '：トラッシュを山札に戻した' };
      case 'ROUND_ENDED': return { cls: 'turn', text: p.simultaneous ? 'ラウンド終了（両者同時敗北）' : 'ラウンド終了：' + PLAYER_LABEL[p.winner] + 'の勝利' };
      case 'MATCH_ENDED': return { cls: 'turn', text: p.winner === 'DRAW' ? '試合終了（引き分け）' : '試合終了：' + PLAYER_LABEL[p.winner] + 'の勝利' };
      case 'DECK_OUT_LOSS': return { cls: 'down', text: pShort(p.loserId) + '：デッキ切れで敗北' };
      default: return null;
    }
  }

  function renderCenter(state) {
    // 現在のターン内の出来事だけを最大4件表示する
    var log = state.actionLog;
    var items = [];
    for (var i = log.length - 1; i >= 0 && items.length < 4; i--) {
      var e = log[i];
      if (e.type === 'TURN_STARTED') break;
      var d = describeEvent(e);
      if (d) items.unshift(d);
    }
    var html = items.length ? items.map(function (d) { return '<span class="bt-ev ' + d.cls + '">' + esc(d.text) + '</span>'; }).join('')
      : '<span class="bt-ev">' + esc(PLAYER_LABEL[state.turn.activePlayer]) + 'のターン ' + state.turn.turnNumber + '</span>';
    return '<div class="bt-center"><div class="bt-ticker">' + html + '</div></div>';
  }

  // ---------- 手札ドック ----------
  function renderDock(state, playerId, hideHand) {
    var player = state.players[playerId];
    var pp = player.ppCards.max - player.ppCards.tapped;
    var handHtml;
    if (hideHand) {
      handHtml = '<div class="bt-hand-hidden">' + player.hand.map(function () { return '<span class="bt-cardback"></span>'; }).join('') + '<span>手札 ' + player.hand.length + '枚</span></div>';
    } else if (player.hand.length === 0) {
      handHtml = '<div class="bt-hand-hidden">手札がありません</div>';
    } else {
      handHtml = '<div class="bt-hand">' + player.hand.map(function (c) {
        var card = cardOf(c.cardId);
        var effCost = Eng.Resolver.getEffectivePlayCost(state, playerId, c.cardId, cardIndex);
        var affordable = effCost != null && effCost <= pp;
        var reason = effCost == null ? 'コスト未確定のためプレイできません' : (affordable ? '' : 'PPが足りません');
        var isSel = sel && sel.cardInstanceId === c.instanceId;
        return '' +
          '<div class="bt-handcard' + (isSel ? ' selected' : '') + (affordable && !opponentTurnActive() ? '' : ' unplayable') + '"' + (opponentTurnActive() ? '' : ' data-act="select-hand"') + ' data-instance="' + esc(c.instanceId) + '" data-preview="' + esc(c.cardId) + '" title="' + esc(card.name + (reason ? '（' + reason + '）' : '')) + '">' +
            '<span class="bt-cost' + (effCost != null && effCost < card.cost ? ' free' : '') + '">' + (effCost != null ? effCost : '?') + '</span>' +
            '<div class="bt-hcard">' + imgTag(card, false, 'bt-hnoimg') + '</div>' +
            '<div class="bt-hname">' + esc(card.name) + '</div>' +
          '</div>';
      }).join('') + '</div>';
    }

    return '' +
      '<div class="bt-dock"><div class="bt-dock-inner">' +
        '<div class="bt-prompt">' + renderPrompt(state) + '</div>' +
        handHtml +
      '</div></div>';
  }

  function stepChip(label, idx, cur) {
    return '<span class="bt-step' + (idx === cur ? ' on' : (idx < cur ? ' done' : '')) + '">' + label + '</span>';
  }

  function renderPrompt(state) {
    if (game.online && opponentTurnActive()) {
      return '<div class="bt-prompt-text bt-cpu-thinking"><span class="bt-cpu-dot"></span><b>相手のターン</b><span class="bt-ctext">相手の操作を待っています…</span></div>';
    }
    if (cpuTurnActive()) {
      return '<div class="bt-prompt-text bt-cpu-thinking"><span class="bt-cpu-dot"></span><b>CPUのターン</b>' +
        (cpuTurn.last ? '<span class="bt-ctext">' + esc(cpuTurn.last) + '</span>' : '<span class="bt-ctext">考え中…</span>') + '</div>';
    }
    var endBtn = '<button class="bt-btn danger" data-act="end-turn">ターン終了</button>';
    if (sel && sel.kind === 'ATTACK') {
      var card = cardOf(sel.cardId);
      var step = sel.mode === 'PICK_ATTACKER' ? 0 : (sel.mode === 'PICK_TARGET' ? 1 : 2);
      var msg = step === 0 ? 'アタックする自分のリーダーを選んでください'
        : step === 1 ? 'アタックする相手のリーダーを選んでください'
          : esc(leaderNameOf(sel.ownerId, sel.attackerLeaderIndex)) + ' → ' + esc(leaderNameOf(opponentOf(sel.ownerId), sel.targetLeaderIndex));
      var multiInfo = '';
      if (sel.multi > 1) {
        multiInfo = '<span class="bt-step on" style="background:var(--yellow);border-color:var(--yellow)">アタック ' + (sel.attacks.length + 1) + '/' + sel.multi + '</span> ';
        if (sel.attacks.length) {
          multiInfo += '<span class="bt-ctext">予約済み: ' + sel.attacks.map(function (a, i) {
            return (i + 1) + '回目 ' + esc(leaderNameOf(sel.ownerId, a.attackerLeaderIndex)) + '→' + esc(leaderNameOf(a.targetPlayerId, a.targetLeaderIndex));
          }).join(' / ') + '</span>';
        }
      }
      var lastOfMulti = sel.multi <= 1 || sel.attacks.length === sel.multi - 1;
      return '' +
        '<div class="bt-prompt-text">' + multiInfo + '<b>' + esc(card.name) + '</b>　' + msg + '<span class="bt-ctext">' + formatCardText(card.text || '') + '</span></div>' +
        renderDamagePreview(state) +
        '<div class="bt-steps">' + stepChip('① アタッカー', 0, step) + stepChip('② 対象', 1, step) + stepChip('③ 確定', 2, step) + '</div>' +
        '<div class="bt-prompt-actions">' +
          '<button class="bt-btn ghost" data-act="show-detail" data-card="' + esc(sel.cardId) + '">詳細</button>' +
          '<button class="bt-btn ghost" data-act="cancel-select">キャンセル</button>' +
          (step === 2 ? '<button class="bt-btn attack" data-act="confirm-attack">' + (lastOfMulti ? 'アタック！' : '次のアタックへ') + '</button>' : '') +
        '</div>';
    }
    if (sel && sel.kind === 'MEMORIA') {
      var mcard = cardOf(sel.cardId);
      return '' +
        renderNextAttackPanel(state.players[state.turn.activePlayer]) +
        '<div class="bt-prompt-text"><b>' + esc(mcard.name) + '</b>（メモリア）をプレイしますか？<span class="bt-ctext">' + formatCardText(mcard.text || '') + '</span></div>' +
        '<div class="bt-prompt-actions">' +
          '<button class="bt-btn ghost" data-act="show-detail" data-card="' + esc(sel.cardId) + '">詳細</button>' +
          '<button class="bt-btn ghost" data-act="cancel-select">キャンセル</button>' +
          '<button class="bt-btn primary" data-act="confirm-memoria">プレイする</button>' +
        '</div>';
    }
    if (sel && sel.mode === 'PICK_EQUIP_LEADER') {
      return '<div class="bt-prompt-text">装備させる自分のリーダーを選んでください</div>' +
        '<div class="bt-prompt-actions"><button class="bt-btn ghost" data-act="cancel-select">キャンセル</button></div>';
    }
    return renderNextAttackPanel(state.players[state.turn.activePlayer]) +
      '<div class="bt-prompt-text">' + (notice ? '<b style="color:#ffb3c7">' + esc(notice) + '</b>' : '手札のカードを選ぶか、タクティクスを使ってください') + '</div>' +
      '<div class="bt-prompt-actions">' + endBtn + '</div>';
  }

  // ---------- 次のアタックへの強化（メモリア等）の表示 ----------
  function pendingTotal(player) {
    return (player.pendingAttackBoost || 0) + (player.pendingAttackTimeBoosts || []).reduce(function (s, b) { return s + b.amount; }, 0);
  }

  function renderBoostBadge(player) {
    var total = player.pendingAttackBoost || 0;
    var cond = (player.pendingAttackTimeBoosts || []).length > 0;
    var after = (player.pendingAfterAttackEffects || []).length > 0;
    if (!total && !cond && !after) return '';
    var tip = (player.pendingBoostSources || []).map(function (b) { return cardOf(b.cardId).name + ' +' + b.amount + (b.conditional ? '（条件付き）' : ''); }).join(' / ');
    return '<span class="bt-boost" title="' + esc('次のアタックに上乗せ：' + (tip || '+' + total)) + '"><span class="bt-boost-lbl">次のアタック </span><b>+' + total + '</b>' + (cond ? '<i>+α</i>' : '') + (after ? '<i>＋アタック後</i>' : '') + '</span>';
  }

  // 手番プレイヤーの「次のアタック」に乗る強化と、アタック後に発動する効果を、出どころのカードごとに一覧する
  function renderNextAttackPanel(player) {
    var sources = player.pendingBoostSources || [];
    var afters = player.pendingAfterAttackEffects || [];
    if (!(player.pendingAttackBoost || 0) && !sources.length && !afters.length) return '';
    var chips = sources.map(function (b) {
      return '<span class="bt-nx-chip" data-preview="' + esc(b.cardId) + '">' + esc(cardOf(b.cardId).name) + ' <b>+' + b.amount + '</b>' + (b.conditional ? '<small>条件付き</small>' : '') + '</span>';
    });
    var seenAfter = {};
    afters.forEach(function (a) {
      var id = a.cardId || findCardIdByInstance(game.state, a.sourceInstanceId);
      if (!id || seenAfter[a.sourceInstanceId]) return;
      seenAfter[a.sourceInstanceId] = true;
      chips.push('<span class="bt-nx-chip after" data-preview="' + esc(id) + '">' + esc(cardOf(id).name) + ' <b>アタック後</b></span>');
    });
    return '<div class="bt-nextattack"><span class="bt-nx-label">次のアタック</span><span class="bt-nx-total">+' + (player.pendingAttackBoost || 0) + '</span>' + chips.join('') + '</div>';
  }

  // プレイエリアのカードが、次のアタックへの強化／アタック後効果を保留中なら印を付ける
  function pendingTag(player, instanceId) {
    var amount = (player.pendingBoostSources || []).filter(function (b) { return b.instanceId === instanceId; })
      .reduce(function (s, b) { return s + b.amount; }, 0);
    var after = (player.pendingAfterAttackEffects || []).some(function (a) { return a.sourceInstanceId === instanceId; });
    if (!amount && !after) return '';
    return '<span class="bt-pend-tag">' + (amount ? '+' + amount : '') + (after ? (amount ? '・' : '') + '後' : '') + '</span>';
  }

  // アタックの予想ダメージ（攻撃力＋カードの上乗せ＋次のアタックへの強化）
  function renderDamagePreview(state) {
    if (sel.attackerLeaderIndex == null) return '';
    var pid = sel.ownerId;
    var player = state.players[pid];
    var attacker = player.leaders[sel.attackerLeaderIndex];
    var targetPid = opponentOf(pid);
    var ctx = {
      ownerPlayerId: pid, attackerPlayerId: pid, attackerLeaderIndex: sel.attackerLeaderIndex,
      targetPlayerId: targetPid, targetLeaderIndex: sel.targetLeaderIndex, cardIndex: cardIndex,
    };
    var atk = Eng.GameState.getLeaderCurrentAtk(cardIndex, attacker);
    var cardBonus = Eng.Resolver.computeAttackCardBaseDamage(sel.cardId, state, ctx);
    var firstOfMulti = !sel.attacks || sel.attacks.length === 0;
    var boost = firstOfMulti ? (player.pendingAttackBoost || 0) + Eng.Resolver.computeAttackTimeBoost(state, pid, ctx) : 0;
    var total = Math.max(0, atk + cardBonus + boost);
    var hasChoiceBonus = Eng.CardEffectData.getEffectsForCard(sel.cardId).some(function (e) {
      return e.trigger === 'ON_ATTACK' && e.action && ['ATTACK_DAMAGE_BONUS', 'MULTI_ATTACK'].indexOf(e.action.type) < 0;
    });
    var parts = ['<span>攻撃力 <b>' + atk + '</b></span>'];
    if (cardBonus) parts.push('<span>カード <b>' + (cardBonus > 0 ? '+' : '') + cardBonus + '</b></span>');
    if (boost) parts.push('<span class="boost">強化 <b>+' + boost + '</b></span>');
    var verdict = '';
    if (sel.targetLeaderIndex != null) {
      var target = state.players[targetPid].leaders[sel.targetLeaderIndex];
      var hp = Eng.GameState.getLeaderCurrentHp(cardIndex, target);
      verdict = total >= hp ? '<span class="bt-dp-down">ダウン！（残り' + hp + '）</span>' : '<span class="bt-dp-left">残り ' + (hp - total) + '</span>';
    }
    return '<div class="bt-dmgpreview">' + parts.join('<i>＋</i>') + '<i>＝</i><span class="bt-dp-total">' + total + '<small>ダメージ</small></span>' +
      (hasChoiceBonus ? '<span class="bt-dp-note">＋効果で増える場合あり</span>' : '') + verdict + '</div>';
  }

  // ---------- ログ・オーバーレイ ----------
  function renderLogDrawer(state) {
    var entries = state.actionLog.slice(-200).reverse().map(function (e) {
      var d = describeEvent(e);
      if (!d) return '';
      return '<div class="bt-logitem ' + d.cls + '"><span class="t">R' + e.roundNumber + ' T' + e.turnNumber + '</span><span>' + esc(d.text) + '</span></div>';
    }).join('');
    return '' +
      '<aside class="bt-drawer">' +
        '<header>バトルログ <button class="bt-btn ghost" data-act="toggle-log">閉じる</button></header>' +
        '<div class="bt-loglist">' + (entries || '<div class="bt-logitem">まだ記録がありません</div>') + '</div>' +
      '</aside>';
  }

  function renderHandoffOverlay(state) {
    var pid = state.turn.activePlayer;
    var first = seenActive === null;
    return '' +
      '<div class="bt-overlay bt-handoff' + (pid === 'playerB' ? ' pB' : '') + '">' +
        '<div class="bt-overlay-box">' +
          '<p>' + (first ? '先攻' : 'ターン交代') + '</p>' +
          '<div class="bt-big-title">PLAYER ' + pShort(pid) + '</div>' +
          '<p>' + esc(PLAYER_LABEL[pid]) + 'に端末を渡してください。<br>準備ができたらタップして手札を表示します。</p>' +
          '<button class="bt-btn primary big" data-act="dismiss-handoff">ターンを始める</button>' +
        '</div>' +
      '</div>';
  }

  function renderRoundEndOverlay(banner) {
    var w = game.state.match.roundWins;
    return '' +
      '<div class="bt-overlay">' +
        '<div class="bt-overlay-box">' +
          '<div class="bt-big-title">ROUND END</div>' +
          '<div class="bt-result-score">' + pBadge('playerA') + '<span>' + w.playerA + ' - ' + w.playerB + '</span>' + pBadge('playerB') + '</div>' +
          '<p>' + esc(banner) + '</p>' +
          '<button class="bt-btn primary big" data-act="dismiss-round-banner">次のラウンドへ</button>' +
        '</div>' +
      '</div>';
  }

  function renderMatchEndOverlay(state) {
    var w = state.match.roundWins;
    var winner = state.match.winner;
    var title = winner === 'DRAW' ? 'DRAW' : 'PLAYER ' + pShort(winner) + ' WIN';
    var text = winner === 'DRAW' ? '両者同時敗北による引き分けです。' : PLAYER_LABEL[winner] + 'の勝利です！';
    return '' +
      '<div class="bt-overlay bt-handoff' + (winner === 'playerB' ? ' pB' : '') + '">' +
        '<div class="bt-overlay-box">' +
          '<p>試合終了</p>' +
          '<div class="bt-big-title">' + esc(title) + '</div>' +
          '<div class="bt-result-score">' + pBadge('playerA') + '<span>' + w.playerA + ' - ' + w.playerB + '</span>' + pBadge('playerB') + '</div>' +
          '<p>' + esc(text) + '</p>' +
          '<button class="bt-btn primary big" data-act="back-to-setup">セットアップに戻る</button>' +
        '</div>' +
      '</div>';
  }

  function renderDetailOverlay(cardId) {
    var c = cardOf(cardId);
    var chips = [];
    if (c.cardType) chips.push(TYPE_JA[c.cardType] || c.cardType);
    if (c.color) chips.push(COLOR_JA[c.color] || c.color);
    if (c.cost != null) chips.push('コスト ' + c.cost);
    if (c.rarity) chips.push(c.rarity);
    if (c.ace) chips.push('ACE');
    (c.affiliations || []).forEach(function (a) { chips.push(a); });
    if (c.cardType === 'LEADER') {
      chips.push('HP ' + c.hp + ' / ATK ' + c.atk);
      if (c.awakenHp != null) chips.push('覚醒後 HP ' + c.awakenHp + ' / ATK ' + c.awakenAtk);
    }
    var text = c.text || (c.cardType === 'LEADER' ? '' : '（テキスト未登録）');
    return '' +
      '<div class="bt-overlay bt-detail' + (c.cardType === 'TACTICS' || c.cardType === 'PP_TICKET' ? ' landscape' : '') + '" data-act="close-detail">' +
        '<div class="bt-overlay-box" data-act="noop">' +
          '<div class="bt-dimg">' + imgTag(c, false, 'bt-lnoimg') + '</div>' +
          '<div class="bt-dbody">' +
            '<div style="color:var(--sub);font-size:12px">' + esc(c.cardNumber) + '</div>' +
            '<h2>' + esc(c.name) + '</h2>' +
            '<div class="bt-deck-summary">' + chips.map(function (x) { return '<span class="bt-chip">' + esc(x) + '</span>'; }).join('') + '</div>' +
            (c.buildRule ? '<div class="bt-chip warn" style="align-self:flex-start">ビルドルール：' + esc(c.buildRule) + '</div>' : '') +
            (text ? '<div class="bt-dtext">' + (c.cardType === 'LEADER' ? '<span class="bt-kw awake">覚醒時</span>' : '') + formatCardText(text) + '</div>' : '') +
            '<button class="bt-btn" data-act="close-detail" style="align-self:flex-start">閉じる</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ================= アクション =================
  // スタートフェイズ（PP回復・ドロー）→メインフェイズ開始時の処理（エコーのプレイし直し）。
  // エコーで積まれたプレイ時効果はここで解決しておく（次の操作まで待たせない）。
  function startTurn(state, callbacks) {
    Eng.Resolver.runStartPhaseWithEffects(state, cardIndex, callbacks);
    Eng.ResolutionStack.resolveAll(state.resolutionStack, state);
  }

  // ---------- 選択が必要になりうる行動の実行（js/battle/choices.js のリプレイ方式） ----------
  // 行動は「記述」（desc）で表す。オンライン対戦ではこの記述と乱数のシード、選択の答えだけを相手に送り、
  // 相手の端末でも同じ手順を再生して同じ盤面にする。
  //   { t: 'ATTACK', pid, id, opt } / { t: 'MEMORIA', pid, id } / { t: 'TACTICS', pid, id, sub, eq } / { t: 'END' } / { t: 'SETUP' }
  function actionFn(desc) {
    switch (desc.t) {
      case 'ATTACK':
        return function (state, cb) {
          Eng.Resolver.playAttackCardWithEffects(state, desc.pid, desc.id, Object.assign({}, desc.opt, cb), cardIndex);
          return finishAction(state, cb);
        };
      case 'MEMORIA':
        return function (state, cb) {
          Eng.Resolver.playMemoriaCardWithEffects(state, desc.pid, desc.id, Object.assign({}, cb), cardIndex);
          return finishAction(state, cb);
        };
      case 'TACTICS':
        return function (state, cb) {
          Eng.Resolver.playTacticsCardWithEffects(state, desc.pid, desc.id, Object.assign({ subType: desc.sub, equipLeaderIndex: desc.eq }, cb), cardIndex);
          return finishAction(state, cb);
        };
      case 'SETUP':
        // ラウンド開始：両プレイヤーがタクティクスを選んで置く → 手札を4枚ずつ配る → 先攻の1ターン目を始める
        return function (state, cb, ask) {
          Eng.Match.runRoundSetup(state, Choices.makeTacticsChooser(ask));
          startTurn(state, cb);
          return { setup: true };
        };
      case 'END':
        return function (state, cb, ask) {
          Eng.Resolver.runEndPhaseWithEffects(state, Choices.makeHandLimitChooser(ask, state.turn.activePlayer));
          if (state.match.status === 'FINISHED') return { ended: true };
          Eng.Resolver.endTurnAndSwitchWithEffects(state);
          startTurn(state, cb);
          return { ended: true };
        };
      default:
        throw new Error('未知の行動です: ' + desc.t);
    }
  }

  // fn(state, callbacks, ask) を盤面のコピーで実行し、選択が必要になったら選択画面を出す。
  // 最後まで進んだらそのコピーを新しい盤面として採用し、onDone(fnの戻り値) を呼ぶ。
  // 途中でエラーになった場合は盤面を一切変更しない。
  // opts: { seed?（相手から受け取った行動の再生時）, remote?（相手の行動）, onError? }
  function performAction(desc, opts) {
    opts = opts || {};
    if (desc.t === 'SETUP' && (lastRoundBanner || game.hold)) {
      // オンラインのゲスト：ホストが次のラウンドを始めたら、決着の表示・お知らせは閉じる
      lastRoundBanner = null;
      game.hold = null;
      prevHp = {};
      prevPp = {};
    }
    pendingChoice = {
      base: game.state,
      seed: opts.seed != null ? opts.seed : Math.floor(Math.random() * 4294967296),
      answers: [],
      desc: desc,
      fn: actionFn(desc),
      onDone: desc.t === 'END' ? function () { sel = null; render(); } : afterActionDone,
      onError: opts.onError || (opts.remote ? function () { render(); } : null),
    };
    if (game.online && !opts.remote) netSend({ type: 'ACT', seq: game.online.seq, desc: desc, seed: pendingChoice.seed });
    stepChoice();
  }

  function stepChoice() {
    var pc = pendingChoice;
    var r;
    try {
      r = Choices.runWithAnswers(pc.base, pc.seed, pc.answers, function (state, ask) {
        var callbacks = Choices.makeCallbacks(ask, {
          getActivePlayerId: function () { return state.turn.activePlayer; },
          getResolvingEffect: Eng.Resolver.getResolvingEffect,
        });
        return pc.fn(state, callbacks, ask);
      });
    } catch (e) {
      pendingChoice = null;
      if (pc.onError) { pc.onError(e); return; }
      alert(e.message);
      render();
      return;
    }
    if (r.done) {
      pendingChoice = null;
      game.state = r.state;
      if (game.online) onlineCommitted(pc);
      pc.onDone(r.value);
      return;
    }
    // CPUが選ぶ質問は、画面を出さずにCPUが答えてやり直す
    var chooser = r.question.chooser || r.state.turn.activePlayer;
    if (isCpu(chooser) && pc.answers.length < 200) {
      pc.answers.push(Cpu.answerQuestion(r.question, r.state, chooser, cardIndex));
      stepChoice();
      return;
    }
    pc.question = r.question;
    pc.preview = r.state;
    // オンライン対戦で相手が選ぶ質問は、相手の答えが届くまで待つ
    pc.waitingRemote = !!(game.online && chooser !== game.online.local);
    pc.selection = r.question.type === 'ALLOCATE' ? r.question.candidates.map(function () { return 0; }) : (r.question.preselect || []).slice();
    pc.revealed = !r.question.secret || !!game.cpu || !!game.online; // CPU・オンライン対戦では端末を渡す必要が無い
    if (!pc.waitingRemote) Fx.sound('choice');
    render();
  }

  function answerChoice(answer) {
    var pc = pendingChoice;
    pc.answers.push(answer);
    if (game.online) netSend({ type: 'ANSWER', seq: game.online.seq, n: pc.answers.length - 1, answer: answer });
    stepChoice();
  }

  // 行動の後処理（効果の解決・ラウンド終了判定・次ラウンドの開始）。行動のfn内で呼ぶ。
  // ラウンドが終わった場合は、次のラウンドの準備で盤面が片付けられる前の盤面を result.snapshot に残す（演出を見せる間の表示用）。
  function finishAction(state, callbacks) {
    if (state.match.status === 'FINISHED') return { finished: true };
    Eng.ResolutionStack.resolveAll(state.resolutionStack, state);
    var snapshot = Choices.deepClone(state);
    var result = Eng.Resolver.processRoundEndWithEffects(state);
    // 次のラウンドのタクティクス選択・手札の配布は、決着の演出を見せた後の SETUP 行動で行う
    if (result.roundEnded && !result.matchEnded && state.turn.phase !== 'ROUND_SETUP') startTurn(state, callbacks);
    if (result.roundEnded) result.snapshot = snapshot;
    return result;
  }

  var HOLD_AFTER_FX_MS = 900; // 演出が終わってから、ラウンド終了・試合終了の画面を出すまでの間

  function afterActionDone(result) {
    if (result && result.roundEnded) {
      // すぐに次のラウンドの盤面へ切り替えず、決着の瞬間の盤面で演出を見せきってから知らせる（playNewEffects → releaseHold）
      game.hold = {
        view: result.snapshot || game.state,
        banner: result.matchEnded ? null : (result.simultaneous
          ? '両者同時敗北。このラウンドの勝者はいません。'
          : (game.state.match.roundWins.playerA + game.state.match.roundWins.playerB > 0
            ? 'ラウンドが終了しました。次のラウンドを開始します。' : 'ラウンドが終了しました。')),
        timer: null,
      };
    }
    sel = null;
    render();
  }

  function releaseHold() {
    var h = game && game.hold;
    if (!h) return;
    game.hold = null;
    prevHp = {}; // 次のラウンドでHPが戻るのを回復の演出として出さない
    prevPp = {};
    if (h.banner) lastRoundBanner = h.banner;
    render();
  }

  function doConfirmAttack() {
    var playerId = sel.ownerId;
    var current = { attackerLeaderIndex: sel.attackerLeaderIndex, targetPlayerId: opponentOf(playerId), targetLeaderIndex: sel.targetLeaderIndex };
    // 複数回アタック（例: ストームラッシュ）は、回数分のアタッカー/対象を順に選んでからまとめて実行する
    if (sel.multi > 1 && sel.attacks.length < sel.multi - 1) {
      sel.attacks.push(current);
      sel.targetLeaderIndex = null;
      sel.mode = 'PICK_TARGET';
      render();
      return;
    }
    var options = sel.multi > 1 ? { attacks: sel.attacks.concat([current]) } : current;
    performAction({ t: 'ATTACK', pid: playerId, id: sel.cardInstanceId, opt: options });
  }

  function doConfirmMemoria() {
    performAction({ t: 'MEMORIA', pid: sel.ownerId, id: sel.cardInstanceId });
  }

  function doPlayTacticsConsumable(cardInstanceId) {
    performAction({ t: 'TACTICS', pid: game.state.turn.activePlayer, id: cardInstanceId, sub: 'CONSUMABLE', eq: null });
  }

  function doPlayTacticsEquip(cardInstanceId, equipLeaderIndex) {
    performAction({ t: 'TACTICS', pid: game.state.turn.activePlayer, id: cardInstanceId, sub: 'EQUIPMENT', eq: equipLeaderIndex });
  }

  function doEndTurn() {
    performAction({ t: 'END' });
  }

  // ================= オンライン対戦 =================
  // 部屋を作った側（ホスト）がプレイヤーA、URLで参加した側（ゲスト）がプレイヤーB。
  // ホストが試合の設定（両方のデッキ・モード・先攻）と乱数のシードを決めて送り、2台で同じ手順を再生する。
  // ホストは試合開始からの全行動（history）を持ち、ゲストが再接続したら全部送り直して同じ盤面に戻す。
  var net = null; // { role, code, mode, conn, status, peerDeck, peerDeckName, joined, error }

  function withSeed(seed, fn) {
    var orig = Math.random;
    Math.random = Choices.seededRandom(seed);
    try { return fn(); } finally { Math.random = orig; }
  }

  function roomUrl() {
    var u = location.origin + location.pathname + '?room=' + encodeURIComponent(net.code);
    if (net.mode === 'local') u += '&net=local';
    return u;
  }

  function openOnlineRoom(role, code) {
    closeOnline();
    var params = new URLSearchParams(location.search);
    net = { role: role, code: code || Online.randomCode(), mode: params.get('net') === 'local' ? 'local' : 'peer', status: 'connecting', peerDeck: null, joined: false };
    connectNet();
    render();
  }

  function connectNet() {
    var conn = Online.createConnection({ role: net.role, code: net.code, mode: net.mode });
    net.conn = conn;
    conn.onStatus(function (st) {
      if (!net || net.conn !== conn) return;
      if (st === 'code-taken') { conn.close(); net.code = Online.randomCode(); connectNet(); return; }
      net.status = st;
      if (st === 'connected' && net.role === 'host' && game && game.online) sendSync();
      if (st === 'connected' && net.role === 'guest' && net.joined && !(game && game.online)) sendHello();
      render();
    });
    conn.onMessage(function (msg) { if (net && net.conn === conn) onNetMessage(msg); });
  }

  function closeOnline() {
    if (net && net.conn) net.conn.close();
    net = null;
    PLAYER_LABEL.playerA = 'プレイヤーA';
    PLAYER_LABEL.playerB = setup.opponent === 'CPU' ? cpuLabel() : 'プレイヤーB';
  }

  // 試合中に相手がつながり直したら、試合の設定と全行動を送り直して同じ盤面に戻す（ホスト）
  function sendSync() {
    netSend({
      type: 'SYNC', v: APP_VERSION, config: game.online.config, seed: game.online.seed, history: game.online.history,
      pending: pendingChoice && pendingChoice.desc ? { desc: pendingChoice.desc, seed: pendingChoice.seed, answers: pendingChoice.answers } : null,
    });
    game.online.desync = false;
  }

  function netSend(msg) { if (net && net.conn) net.conn.send(msg); }

  function copyRoomUrl() {
    var url = roomUrl();
    var done = function () { notice = 'URLをコピーしました'; render(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { prompt('このURLを相手に送ってください', url); });
    else prompt('このURLを相手に送ってください', url);
  }
  function shareRoomUrl() {
    if (navigator.share) navigator.share({ title: 'Xross Stars 対戦', text: 'Xross Starsで対戦しよう！', url: roomUrl() }).catch(function () {});
    else copyRoomUrl();
  }

  // ゲスト：自分のデッキを送って参加を伝える（デッキを変えたら送り直す）
  function sendHello(resync) {
    var deck = deckFor('playerB');
    if (resync && (!deck || (deck.leaders || []).length !== 4)) deck = { name: '', leaders: [], cards: [], tactics: [] }; // 再同期ならデッキは不要
    if (!deck || (deck.leaders || []).length !== 4 && !resync) { alert('参加する前に、リーダーを4体選んだデッキを選んでください'); return; }
    net.joined = true;
    netSend({ type: 'HELLO', v: APP_VERSION, deck: { name: deck.name, leaders: deck.leaders, cards: deck.cards, tactics: deck.tactics }, resync: !!resync });
    render();
  }

  function reconnectGuest() {
    if (!net) return;
    if (net.conn) net.conn.close();
    net.status = 'connecting';
    connectNet();
    render();
  }

  function requestResync() { if (net) sendHello(true); }

  // ホスト：対戦開始（設定とシードを送り、自分も同じ設定で開始する）
  function startOnlineMatch() {
    var deckA = deckFor('playerA');
    if (!deckA || (deckA.leaders || []).length !== 4) { alert('リーダーを4体選んだデッキを選んでください'); return; }
    if (!net || net.status !== 'connected' || !net.peerDeck) { alert('相手の参加を待っています'); return; }
    var config = buildMatchConfig(deckA, net.peerDeck);
    config.matchId = 'online-' + net.code + '-' + Date.now();
    var seed = Math.floor(Math.random() * 4294967296);
    netSend({ type: 'START', v: APP_VERSION, config: config, seed: seed });
    beginOnlineMatch(config, seed, []);
  }

  // 2台で同じ盤面を作る：インスタンスIDの採番と乱数を揃えてから試合を作り、履歴があれば再生する
  function beginOnlineMatch(config, seed, history) {
    if (cpuTimer) { clearTimeout(cpuTimer); cpuTimer = null; }
    var state;
    try {
      Eng.GameState.resetInstanceIds();
      state = withSeed(seed, function () {
        var s0 = Eng.Match.createMatch(config);
        if (s0.turn.phase !== 'ROUND_SETUP') startTurn(s0, {});
        return s0;
      });
    } catch (e) {
      alert('対戦を開始できませんでした: ' + e.message);
      return;
    }
    var local = net.role === 'host' ? 'playerA' : 'playerB';
    game = { state: state, cpu: null, online: { local: local, seq: 0, history: [], hashes: {}, config: config, seed: seed, desync: false }, fxSeen: 0 };
    PLAYER_LABEL[local] = 'あなた';
    PLAYER_LABEL[local === 'playerA' ? 'playerB' : 'playerA'] = '相手';
    // 再接続時：これまでの行動をすべて再生して同じ盤面に戻す（演出は出さない）
    (history || []).forEach(function (h) {
      var r = Choices.runWithAnswers(game.state, h.seed, h.answers, function (st, ask) {
        var cb = Choices.makeCallbacks(ask, { getActivePlayerId: function () { return st.turn.activePlayer; }, getResolvingEffect: Eng.Resolver.getResolvingEffect });
        return actionFn(h.desc)(st, cb, ask);
      });
      if (r.done) game.state = r.state;
      game.online.history.push(h);
      game.online.seq += 1;
    });
    game.fxSeen = game.state.actionLog.length;
    pendingChoice = null;
    sel = null;
    lastRoundBanner = null;
    detailCardId = null;
    seenActive = null;
    prevHp = {};
    prevPp = {};
    screen = 'battle';
    render();
  }

  // 行動が確定したとき：履歴に残し、盤面のハッシュを相手と照合する
  function onlineCommitted(pc) {
    var o = game.online;
    o.history.push({ desc: pc.desc, seed: pc.seed, answers: pc.answers.slice() });
    o.seq += 1;
    var h = Online.stateHash(game.state);
    o.hashes[o.seq] = h;
    netSend({ type: 'HASH', seq: o.seq, h: h });
    if (o.remoteHashes && o.remoteHashes[o.seq] && o.remoteHashes[o.seq] !== h) o.desync = true;
  }

  // 相手からの行動が、相手の手番の、相手のカードの行動かを確かめる（不正な行動は受け付けない）
  function isValidRemoteAct(desc) {
    if (!desc || !game || !game.online) return false;
    var remote = game.online.local === 'playerA' ? 'playerB' : 'playerA';
    if (desc.t === 'SETUP') return remote === 'playerA' && game.state.turn.phase === 'ROUND_SETUP'; // ラウンドの準備はホストが始める
    if (game.state.turn.phase === 'ROUND_SETUP') return false;
    if (game.state.turn.activePlayer !== remote) return false;
    if (desc.t === 'END') return true;
    return ['ATTACK', 'MEMORIA', 'TACTICS'].indexOf(desc.t) >= 0 && desc.pid === remote && typeof desc.id === 'string';
  }

  function onNetMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'HELLO':
        if (net.role !== 'host') return;
        if (msg.v !== APP_VERSION) { netSend({ type: 'VERSION_MISMATCH', v: APP_VERSION }); net.error = '相手のページが古い（または新しい）ため対戦できません。両方ともページを再読み込みしてください。'; render(); return; }
        if (!msg.resync) net.peerDeck = msg.deck;
        if (game && game.online) sendSync(); // 試合中の再同期：試合の設定と全行動を送り直す（途中の行動があればそれも）
        render();
        return;
      case 'VERSION_MISMATCH':
        net.error = '相手のページが古い（または新しい）ため対戦できません。両方ともページを再読み込みしてください。';
        render();
        return;
      case 'START':
        if (net.role !== 'guest') return;
        if (msg.v !== APP_VERSION) { net.error = 'ホストのページとバージョンが違います。両方ともページを再読み込みしてください。'; render(); return; }
        beginOnlineMatch(msg.config, msg.seed, []);
        return;
      case 'SYNC':
        if (net.role !== 'guest') return;
        if (msg.v !== APP_VERSION) { net.error = 'ホストのページとバージョンが違います。両方ともページを再読み込みしてください。'; render(); return; }
        beginOnlineMatch(msg.config, msg.seed, msg.history || []);
        if (msg.pending) {
          performAction(msg.pending.desc, { seed: msg.pending.seed, remote: true });
          if (pendingChoice) { pendingChoice.answers = (msg.pending.answers || []).slice(); stepChoice(); }
        }
        return;
      case 'ACT':
        if (!game || !game.online || pendingChoice || msg.seq !== game.online.seq || !isValidRemoteAct(msg.desc)) {
          if (game && game.online && msg.seq !== game.online.seq) { game.online.desync = true; render(); }
          return;
        }
        performAction(msg.desc, { seed: msg.seed, remote: true });
        return;
      case 'ANSWER':
        if (!game || !game.online || !pendingChoice || msg.seq !== game.online.seq || msg.n !== pendingChoice.answers.length) return;
        pendingChoice.answers.push(msg.answer);
        stepChoice();
        return;
      case 'HASH':
        if (!game || !game.online) return;
        game.online.remoteHashes = game.online.remoteHashes || {};
        game.online.remoteHashes[msg.seq] = msg.h;
        if (game.online.hashes[msg.seq] && game.online.hashes[msg.seq] !== msg.h) { game.online.desync = true; render(); }
        return;
      case 'LEFT_MATCH':
        if (game && game.online) { notice = '相手がセットアップ画面に戻りました'; render(); }
        return;
      default:
        return;
    }
  }

  function renderOnlineSetup() {
    var isHost = net.role === 'host';
    var side = isHost ? 'playerA' : 'playerB';
    var statusText = {
      connecting: isHost ? '部屋を準備しています…' : '部屋に接続しています…',
      waiting: '相手の参加を待っています…',
      connected: isHost ? (net.peerDeck ? '相手が参加しました（デッキ：' + (net.peerDeck.name || '名称なし') + '）' : '相手が接続しました。相手がデッキを選ぶのを待っています…')
        : (net.joined ? '参加しました。ホストが対戦を始めるのを待っています…' : '接続しました。デッキを選んで「このデッキで参加」を押してください'),
      disconnected: '接続が切れました',
      'no-room': '部屋が見つかりません（URLが正しいか、ホストが部屋を開いているか確認してください）',
      error: '接続できませんでした（ネットワークの状態を確認してください）',
    }[net.status] || net.status;
    var peerLeaders = isHost && net.peerDeck ? net.peerDeck.leaders.map(function (n) {
      var c = CARD_INDEX[n];
      return c ? '<div class="bt-thumb" title="' + esc(c.name) + '">' + imgTag(c, false, 'bt-lnoimg') + '</div>' : '';
    }).join('') : '';
    var share = isHost ? '' +
      '<div class="bt-net-share">' +
        '<div class="bt-net-share-label">このURLを相手に送ってください</div>' +
        '<div class="bt-net-url"><input readonly value="' + esc(roomUrl()) + '" onclick="this.select()">' +
          '<button class="bt-btn" data-act="online-copy">コピー</button>' +
          '<button class="bt-btn" data-act="online-share">共有</button></div>' +
      '</div>' : '';
    var canStart = isHost && net.status === 'connected' && net.peerDeck && deckFor('playerA');
    return '' +
      '<div class="bt-setup">' +
        '<div class="bt-hero"><h2>ONLINE</h2><p>' + (isHost ? 'あなたはプレイヤーA（部屋を作った側）です' : 'あなたはプレイヤーB（招待された側）です') + '</p></div>' +
        (net.error ? '<div class="bt-net-banner bad" style="position:static">' + esc(net.error) + '</div>' : '') +
        '<div class="bt-net-status ' + (net.status === 'connected' ? 'ok' : (/error|no-room|disconnected/.test(net.status) ? 'bad' : '')) + '">' +
          '<span class="bt-cpu-dot"></span>' + esc(statusText) + (notice ? '<b style="margin-left:8px">' + esc(notice) + '</b>' : '') + '</div>' +
        share +
        '<div class="bt-setup-players">' +
          renderSetupPanel(side) +
          '<div class="bt-vs">VS</div>' +
          '<div class="bt-setup-panel" data-side="' + (isHost ? 'playerB' : 'playerA') + '"><h3>' + pBadge(isHost ? 'playerB' : 'playerA') + '相手</h3>' +
            (peerLeaders ? '<div class="bt-deck-leaders">' + peerLeaders + '</div>' : '<p style="color:var(--sub);font-size:13px">' + (isHost ? '相手のデッキは参加後に表示されます' : 'ホストのデッキは対戦開始時に分かります') + '</p>') +
          '</div>' +
        '</div>' +
        (isHost ? '<div class="bt-setup-options">' +
          '<div class="bt-opt">モード <span class="bt-seg">' +
            '<button data-act="set-mode" data-value="STANDARD" class="' + (setup.mode === 'STANDARD' ? 'on' : '') + '">スタンダード（2本先取）</button>' +
            '<button data-act="set-mode" data-value="QUICK" class="' + (setup.mode === 'QUICK' ? 'on' : '') + '">クイック（1本先取）</button>' +
          '</span></div>' +
          '<div class="bt-opt">先攻 <span class="bt-seg">' +
            '<button data-act="set-first" data-value="playerA" class="' + (setup.firstPlayer === 'playerA' ? 'on' : '') + '">あなた</button>' +
            '<button data-act="set-first" data-value="playerB" class="' + (setup.firstPlayer === 'playerB' ? 'on' : '') + '">相手</button>' +
          '</span></div>' +
          '<button class="bt-btn ghost" data-act="coinflip">ランダムで決める</button>' +
        '</div>' : '') +
        '<div class="bt-start-row">' +
          (isHost ? '<button class="bt-btn primary big" data-act="online-start"' + (canStart ? '' : ' disabled') + '>対戦開始</button>'
            : '<button class="bt-btn primary big" data-act="online-join"' + (net.status === 'connected' ? '' : ' disabled') + '>' + (net.joined ? 'デッキを送り直す' : 'このデッキで参加') + '</button>') +
          '<button class="bt-btn big" data-act="online-leave">オンライン対戦をやめる</button>' +
        '</div>' +
        '<details class="bt-notes"><summary>オンライン対戦について</summary>' +
          '2台のブラウザを直接つないで対戦します（つなぐまでの仲介に、無料の公開サーバー PeerJS を使います）。' +
          '会社や学校のネットワーク、一部の携帯回線では、つながらないことがあります。' +
          '接続が切れたときは、招待された側が同じURLを開き直すか「再接続」を押すと、続きから再開できます（部屋を作った側がページを閉じると試合は終わります）。' +
          '手札などの非公開情報は画面には表示しませんが、通信の仕組み上ブラウザの中には相手の情報もあります（友だちどうしで楽しむための機能です）。' +
        '</details>' +
      '</div>';
  }

  // ---------- 効果音・演出 ----------
  // 確定した盤面のactionLogのうち、まだ演出していないイベントを再生する（選択画面の途中＝未確定の盤面では再生しない）。
  var healSoundPending = false;
  function playNewEffects() {
    if (screen !== 'battle' || !game || pendingChoice) return;
    if (game.hold && game.hold.timer) return; // 決着の盤面を見せている間に届いた分は、次のラウンドの盤面で再生する
    var log = game.state.actionLog;
    var timing = null;
    if (game.fxSeen == null || game.fxSeen > log.length) game.fxSeen = log.length;
    if (log.length > game.fxSeen) {
      var events = log.slice(game.fxSeen);
      game.fxSeen = log.length;
      timing = Fx.play(events, {
        leaderEl: function (pid, idx) { return root.querySelector('[data-leader="' + pid + ':' + idx + '"] .bt-lcard'); },
        cardImg: function (cardId) { return cardImg(cardOf(cardId), false); },
        cardName: function (cardId) { return cardOf(cardId).name; },
      });
      // 盤面のダメージ数字・揺れを、演出でそのリーダーにダメージが入る時刻まで遅らせる
      Object.keys(timing.hitAt).forEach(function (key) {
        var el = root.querySelector('[data-leader="' + key + '"]');
        if (!el) return;
        el.classList.add('fx-delayed'); // 盤面側の赤いフラッシュは演出レイヤーの閃光に任せる
        [el.querySelector('.bt-float'), el.classList.contains('hit') ? el.querySelector('.bt-lcard') : null].forEach(function (a) {
          if (!a) return;
          a.style.animationDelay = timing.hitAt[key] + 'ms';
          a.style.animationFillMode = 'both';
        });
      });
    }
    if (healSoundPending) { healSoundPending = false; Fx.sound('heal'); }
    if (game.hold && !game.hold.timer) {
      var h = game.hold;
      h.timer = setTimeout(function () { if (game && game.hold === h) releaseHold(); }, (timing ? timing.total : 0) + HOLD_AFTER_FX_MS);
    }
  }

  // ---------- ラウンド開始の準備（タクティクスを選んで置く → 手札を配る） ----------
  // 盤面がROUND_SETUPになったら、決着の演出・ラウンド終了のお知らせが済んでから SETUP 行動を始める。
  // オンライン対戦ではホストだけが始め、ゲストは届いた行動を再生する（自分のタクティクスは自分の端末で選ぶ）。
  var setupTimer = null;
  function roundSetupReady() {
    return screen === 'battle' && game && game.state.turn.phase === 'ROUND_SETUP' && game.state.match.status !== 'FINISHED' &&
      !pendingChoice && !game.hold && !lastRoundBanner && !(game.online && (!net || net.role !== 'host'));
  }
  function scheduleRoundSetup() {
    if (setupTimer || !roundSetupReady()) return;
    setupTimer = setTimeout(function () {
      setupTimer = null;
      if (roundSetupReady()) performAction({ t: 'SETUP' });
    }, 400); // 盤面が表示されてから選択画面を出す
  }

  // ---------- CPUの手番 ----------
  // 描画のたびに、CPUの手番で待ち状態（ラウンド終了の表示・選択画面・カード詳細）でなければ、少し間をおいて1手進める。
  var cpuTimer = null;
  var cpuTurn = { key: null, excluded: {}, steps: 0, last: null };
  var CPU_DELAY_MS = 900;

  function scheduleCpu() {
    if (cpuTimer || screen !== 'battle' || !cpuTurnActive() || pendingChoice || lastRoundBanner || detailCardId || game.hold) return;
    cpuTimer = setTimeout(function () { cpuTimer = null; cpuStep(); }, Math.max(CPU_DELAY_MS, Fx.remainingMs() + 300)); // 演出が終わってから次の1手
  }

  function cpuStep() {
    if (screen !== 'battle' || !cpuTurnActive() || pendingChoice || lastRoundBanner || game.hold) return;
    var state = game.state;
    var pid = game.cpu;
    var key = state.match.roundNumber + ':' + state.turn.turnNumber;
    if (cpuTurn.key !== key) cpuTurn = { key: key, excluded: {}, steps: 0, last: null };
    cpuTurn.steps += 1;
    var act = cpuTurn.steps > 30 ? { type: 'END' } : Cpu.decideAction(state, pid, cardIndex, { isEquipment: isEquipmentCard, level: game.cpuLevel || 'NORMAL' }, cpuTurn.excluded);
    var failed = function () { cpuTurn.excluded[act.instanceId] = true; render(); };
    if (act.type === 'END') {
      cpuTurn.last = 'ターン終了';
      doEndTurn();
      return;
    }
    var name = cardOf(act.cardId).name;
    if (act.type === 'ATTACK') {
      var o = act.options.attacks ? act.options.attacks[0] : act.options;
      cpuTurn.last = '「' + name + '」で ' + leaderNameOf(pid, o.attackerLeaderIndex) + ' → ' + leaderNameOf(o.targetPlayerId, o.targetLeaderIndex) + ' にアタック';
      performAction({ t: 'ATTACK', pid: pid, id: act.instanceId, opt: act.options }, { onError: failed });
    } else if (act.type === 'MEMORIA') {
      cpuTurn.last = 'メモリア「' + name + '」をプレイ';
      performAction({ t: 'MEMORIA', pid: pid, id: act.instanceId }, { onError: failed });
    } else {
      cpuTurn.last = 'タクティクス「' + name + '」を' + (act.subType === 'EQUIPMENT' ? leaderNameOf(pid, act.equipLeaderIndex) + 'に装備' : '使用');
      performAction({ t: 'TACTICS', pid: pid, id: act.instanceId, sub: act.subType, eq: act.equipLeaderIndex }, { onError: failed });
    }
  }

  // ---------- 選択画面 ----------
  var TRIGGER_JA = { ON_PLAY: 'プレイ時', AFTER_ATTACK: 'アタック後', ON_AWAKEN: '覚醒時', FREE_ATTACK: 'コストを支払わずにプレイ', ON_ATTACK: 'アタックする', ATTACK_BOOST: 'アタック強化' };

  function findCardIdByInstance(state, instanceId) {
    var found = null;
    ['playerA', 'playerB'].forEach(function (pid) {
      if (found) return;
      var p = state.players[pid];
      var zones = [p.hand, p.deck,
        p.playArea.map(function (e) { return e.card; }),
        p.trash.map(function (t) { return t.card; }),
        p.tacticsArea.map(function (t) { return t.card; })];
      p.leaders.forEach(function (l) { zones.push(l.equipment || []); });
      zones.forEach(function (z) {
        (z || []).forEach(function (c) { if (!found && c && c.instanceId === instanceId) found = c.cardId; });
      });
    });
    return found;
  }

  // 質問の「どのカードの効果か」を { cardId, label } で返す
  function describeChoiceSource(state, src) {
    if (!src) return null;
    if (src.trigger === 'ON_AWAKEN' && src.attackerLeaderIndex != null) {
      var leader = state.players[src.ownerPlayerId].leaders[src.attackerLeaderIndex];
      return { cardId: leader.cardId, label: '覚醒時' };
    }
    var cardId = src.cardId || findCardIdByInstance(state, src.sourceInstanceId);
    return cardId ? { cardId: cardId, label: TRIGGER_JA[src.trigger] || '' } : null;
  }

  function renderChoiceLeader(state, ref, i, selected, extra) {
    var leader = state.players[ref.playerId].leaders[ref.leaderIndex];
    var card = cardOf(leader.cardId);
    var hp = Eng.GameState.getLeaderCurrentHp(cardIndex, leader);
    var max = Eng.GameState.getLeaderMaxHp(cardIndex, leader);
    return '' +
      '<div class="bt-choice-item leader' + (selected ? ' selected' : '') + '" data-act="choice-toggle" data-index="' + i + '" data-preview="' + esc(leader.cardId) + '"' + (leader.awakened ? ' data-preview-awakened="1"' : '') + ' role="button" tabindex="0">' +
        '<button class="bt-choice-zoom" data-act="show-detail" data-card="' + esc(leader.cardId) + '" title="拡大">＋</button>' +
        '<div class="bt-choice-img">' + imgTag(card, leader.awakened, 'bt-lnoimg') + '</div>' +
        '<div class="bt-choice-cap">' + pBadge(ref.playerId) + '<span>' + esc(card.name) + '</span></div>' +
        '<div class="bt-choice-sub">HP ' + hp + '/' + max + '</div>' +
        (extra || '') +
      '</div>';
  }

  function renderChoiceOverlay(pc) {
    var qn = pc.question;
    var state = pc.preview;
    var src = describeChoiceSource(state, qn.source);
    var srcCard = src ? cardOf(src.cardId) : null;
    var chooser = qn.chooser || state.turn.activePlayer;
    var head = '' +
      '<div class="bt-choice-head">' +
        (srcCard ? '<div class="bt-choice-src" data-act="show-detail" data-card="' + esc(src.cardId) + '" data-preview="' + esc(src.cardId) + '" title="カードの詳細">' + imgTag(srcCard, false, 'bt-mnoimg') + '</div>' : '') +
        '<div class="bt-choice-headtext">' +
          '<div class="bt-choice-who">' + pBadge(chooser) + esc(PLAYER_LABEL[chooser]) + 'が選択' + (srcCard ? ' ・「' + esc(srcCard.name) + '」' + (src.label ? '〖' + esc(src.label) + '〗' : '') : '') + '</div>' +
          '<div class="bt-choice-title">' + esc(qn.title) + '</div>' +
          (srcCard && srcCard.text ? '<div class="bt-choice-text">' + formatCardText(srcCard.text) + '</div>' : '') +
        '</div>' +
      '</div>';

    var body = '';
    if (qn.type === 'OPTIONS') {
      body = '<div class="bt-choice-options">' + qn.options.map(function (o, i) {
        return '<button class="bt-btn' + (i === 0 ? ' primary' : '') + ' big" data-act="choice-option" data-index="' + i + '">' + esc(o.label) + '</button>';
      }).join('') + '</div>';
    } else if (qn.type === 'LEADERS') {
      body = '<div class="bt-choice-grid">' + qn.candidates.map(function (ref, i) {
        return renderChoiceLeader(state, ref, i, pc.selection.indexOf(i) >= 0);
      }).join('') + '</div>';
    } else if (qn.type === 'ALLOCATE') {
      var used = pc.selection.reduce(function (s, x) { return s + x; }, 0);
      body = '<div class="bt-choice-grid">' + qn.candidates.map(function (ref, i) {
        var ctrl = '<div class="bt-alloc">' +
          '<button class="bt-btn" data-act="alloc-dec" data-index="' + i + '"' + (pc.selection[i] <= 0 ? ' disabled' : '') + '>−</button>' +
          '<b>' + pc.selection[i] + '</b>' +
          '<button class="bt-btn" data-act="alloc-inc" data-index="' + i + '"' + (used + qn.step > qn.total ? ' disabled' : '') + '>＋</button>' +
        '</div>';
        return renderChoiceLeader(state, ref, i, pc.selection[i] > 0, ctrl);
      }).join('') + '</div>';
    } else if (!pc.revealed) {
      body = '<div class="bt-choice-secret"><p>' + (qn.secretNote ? esc(PLAYER_LABEL[chooser]) + 'が' + esc(qn.secretNote) : esc(PLAYER_LABEL[chooser]) + 'の手札から選びます。') + esc(PLAYER_LABEL[chooser]) + 'に端末を渡してください。</p>' +
        '<button class="bt-btn primary" data-act="choice-reveal">' + esc(qn.revealLabel || '手札を表示する') + '</button></div>';
    } else {
      body = '<div class="bt-choice-grid cards">' + qn.cards.map(function (c, i) {
        var card = cardOf(c.cardId);
        var order = pc.selection.indexOf(i);
        var note = c.equippedTo ? '装備先：' + cardOf(state.players[c.equippedTo.playerId].leaders[c.equippedTo.leaderIndex].cardId).name : '';
        var landscape = card.cardType === 'TACTICS' || card.cardType === 'PP_TICKET';
        return '' +
          '<div class="bt-choice-item card' + (order >= 0 ? ' selected' : '') + (landscape ? ' landscape' : '') + '" data-act="choice-toggle" data-index="' + i + '" data-preview="' + esc(c.cardId) + '" role="button" tabindex="0">' +
            '<button class="bt-choice-zoom" data-act="show-detail" data-card="' + esc(c.cardId) + '" title="拡大">＋</button>' +
            (card.cost != null ? '<span class="bt-cost">' + card.cost + '</span>' : '') +
            (qn.ordered && order >= 0 ? '<span class="bt-choice-order">' + (order + 1) + '</span>' : '') +
            '<div class="bt-choice-img">' + imgTag(card, false, 'bt-hnoimg') + '</div>' +
            '<div class="bt-choice-cap"><span>' + esc(card.name) + '</span></div>' +
            (note ? '<div class="bt-choice-sub">' + esc(note) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';
    }

    var v = Choices.validateSelection(qn, pc.selection, cardIndex);
    var status = '';
    if (qn.type === 'ALLOCATE') status = '割り振り ' + v.sum + ' / ' + qn.total;
    else if (pc.revealed) {
      status = '選択 ' + pc.selection.length + (qn.min === qn.max ? ' / ' + qn.max + '枚' : '（' + (qn.min > 0 ? qn.min + '〜' : '最大') + qn.max + '）');
      if (v.cost != null) status += ' ・ コスト合計 ' + v.cost;
    }
    var canDecline = qn.min === 0 && qn.type !== 'ALLOCATE' && pc.revealed;
    var foot = (!pc.revealed || qn.type === 'OPTIONS') ? '' :
      '<div class="bt-choice-foot">' +
        '<span class="bt-choice-status">' + esc(status) + '</span>' +
        (canDecline ? '<button class="bt-btn" data-act="choice-decline">' + esc(qn.declineLabel || '選ばない') + '</button>' : '') +
        '<button class="bt-btn primary" data-act="choice-confirm"' + ((v.ok && !(canDecline && pc.selection.length === 0)) ? '' : ' disabled') + '>決定</button>' +
      '</div>';

    // 選択を切り替えるたびに再描画されるので、登場アニメーションは質問が出た最初の1回だけにする
    var animCls = pc.shown === pc.answers.length ? ' no-anim' : '';
    pc.shown = pc.answers.length;
    return '<div class="bt-overlay bt-choice' + (chooser === 'playerB' ? ' pB' : '') + animCls + '"><div class="bt-overlay-box">' + head + body + foot + '</div></div>';
  }

  function handleChoiceAction(act, el) {
    var pc = pendingChoice;
    var qn = pc.question;
    var i = Number(el.getAttribute('data-index'));
    if (act === 'choice-reveal') { pc.revealed = true; render(); return; }
    if (act === 'choice-option') { answerChoice([i]); return; }
    if (act === 'choice-toggle' && qn.type !== 'ALLOCATE') {
      var at = pc.selection.indexOf(i);
      if (at >= 0) pc.selection.splice(at, 1);
      else if (qn.max === 1) pc.selection = [i];
      else if (pc.selection.length < qn.max) pc.selection.push(i);
      render();
      return;
    }
    if (act === 'alloc-inc' || act === 'alloc-dec') {
      var used = pc.selection.reduce(function (s, x) { return s + x; }, 0);
      if (act === 'alloc-inc' && used + qn.step <= qn.total) pc.selection[i] += qn.step;
      if (act === 'alloc-dec' && pc.selection[i] >= qn.step) pc.selection[i] -= qn.step;
      render();
      return;
    }
    if (act === 'choice-decline') { answerChoice([]); return; }
    if (act === 'choice-confirm') {
      if (!Choices.validateSelection(qn, pc.selection, cardIndex).ok) return;
      answerChoice(pc.selection.slice());
    }
  }

  // ================= イベント束縛 =================
  function bindEvents() {
    root.querySelectorAll('[data-act]').forEach(function (el) {
      if (el.tagName === 'SELECT') return;
      el.addEventListener('click', function (ev) {
        ev.stopPropagation(); // 入れ子（リーダー内の詳細ボタン等）で外側の操作が二重に走らないようにする
        handleAction(el.getAttribute('data-act'), el);
      });
    });
    root.querySelectorAll('[data-act="pick-leader"]').forEach(function (el) {
      el.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handleAction('pick-leader', el); }
      });
    });
    root.querySelectorAll('[data-act="pick-saved"]').forEach(function (el) {
      el.addEventListener('change', function (e) {
        var side = el.getAttribute('data-side');
        var v = e.target.value;
        if (v === '') { setup[side].source = 'NONE'; setup[side].savedIndex = null; }
        else { setup[side].source = 'SAVED'; setup[side].savedIndex = Number(v); }
        render();
      });
    });
  }

  function handleAction(act, el) {
    if (act === 'noop') return;
    notice = null;
    if (pendingChoice) {
      if (act === 'show-detail') { detailCardId = el.getAttribute('data-card'); render(); return; }
      if (act === 'close-detail') { detailCardId = null; render(); return; }
      handleChoiceAction(act, el);
      return;
    }
    if (act === 'pick-random') {
      var side = el.getAttribute('data-side');
      setup[side].source = 'RANDOM';
      setup[side].generatedDeck = buildRandomDeck((side === 'playerA' ? 'プレイヤーA' : 'プレイヤーB') + '・ランダム');
      render();
      return;
    }
    if (act === 'set-mode') { setup.mode = el.getAttribute('data-value'); render(); return; }
    if (act === 'set-first') { setup.firstPlayer = el.getAttribute('data-value'); render(); return; }
    if (act === 'set-opponent') { setup.opponent = el.getAttribute('data-value'); PLAYER_LABEL.playerB = setup.opponent === 'CPU' ? cpuLabel() : 'プレイヤーB'; render(); return; }
    if (act === 'set-cpu-level') { setup.cpuLevel = el.getAttribute('data-value'); saveCpuLevel(setup.cpuLevel); PLAYER_LABEL.playerB = setup.opponent === 'CPU' ? cpuLabel() : 'プレイヤーB'; render(); return; }
    if (act === 'coinflip') {
      setup.firstPlayer = Math.random() < 0.5 ? 'playerA' : 'playerB';
      render();
      return;
    }
    if (act === 'start') { startMatch(); return; }
    if (act === 'online-host') { openOnlineRoom('host'); return; }
    if (act === 'online-leave') { closeOnline(); render(); return; }
    if (act === 'online-copy') { copyRoomUrl(); return; }
    if (act === 'online-share') { shareRoomUrl(); return; }
    if (act === 'online-join') { sendHello(); return; }
    if (act === 'online-start') { startOnlineMatch(); return; }
    if (act === 'net-reconnect') { reconnectGuest(); return; }
    if (act === 'net-resync') { requestResync(); return; }

    if (act === 'toggle-log') { logOpen = !logOpen; render(); return; }
    if (act === 'toggle-sound') { Fx.setSoundOn(!Fx.isSoundOn()); render(); return; }
    if (act === 'show-detail') { detailCardId = el.getAttribute('data-card'); render(); return; }
    if (act === 'close-detail') { detailCardId = null; render(); return; }
    if (act === 'dismiss-handoff') { seenActive = game.state.turn.activePlayer; render(); return; }
    if (act === 'back-to-setup') {
      if (cpuTimer) { clearTimeout(cpuTimer); cpuTimer = null; }
      if (game && game.online && net) netSend({ type: 'LEFT_MATCH' });
      game = null; sel = null; lastRoundBanner = null; detailCardId = null; logOpen = false;
      setup.savedDecks = loadSavedDecks();
      screen = 'setup';
      render();
      return;
    }
    if (act === 'dismiss-round-banner') { lastRoundBanner = null; render(); return; }
    if (game && game.hold) return; // 決着の演出中は操作できない
    if (game && game.state.turn.phase === 'ROUND_SETUP') return; // タクティクスの選択・手札の配布の前
    if (opponentTurnActive()) return; // CPU・オンラインの相手の手番中は操作できない（詳細表示・ログ等は上で処理済み）
    if (act === 'end-turn') { doEndTurn(); return; }
    if (act === 'cancel-select') { sel = null; render(); return; }

    if (act === 'select-hand') {
      var state = game.state;
      var playerId = state.turn.activePlayer;
      var instanceId = el.getAttribute('data-instance');
      if (sel && sel.cardInstanceId === instanceId) { sel = null; render(); return; } // もう一度押すと選択解除
      var handCard = state.players[playerId].hand.find(function (c) { return c.instanceId === instanceId; });
      if (!handCard) return;
      var card = cardOf(handCard.cardId);
      var ppLeft = state.players[playerId].ppCards.max - state.players[playerId].ppCards.tapped;
      var effectiveCost = Eng.Resolver.getEffectivePlayCost(state, playerId, handCard.cardId, cardIndex);
      if (effectiveCost == null) { sel = null; notice = '「' + card.name + '」はコストが未確定のためプレイできません'; render(); return; }
      if (effectiveCost > ppLeft) { sel = null; notice = '「' + card.name + '」はPPが足りません（必要 ' + effectiveCost + ' / 残り ' + ppLeft + '）'; render(); return; }
      if (card.cardType === 'ATTACK') {
        sel = { kind: 'ATTACK', ownerId: playerId, cardInstanceId: instanceId, cardId: handCard.cardId, mode: 'PICK_ATTACKER', attackerLeaderIndex: null, targetLeaderIndex: null,
          multi: Eng.Resolver.getMultiAttackCount(handCard.cardId) || 1, attacks: [] };
        // 生存リーダーが1体だけならアタッカー選択を省略する
        var alive = state.players[playerId].leaders.map(function (l, i) { return l.isDown ? -1 : i; }).filter(function (i) { return i >= 0; });
        if (alive.length === 1) { sel.attackerLeaderIndex = alive[0]; sel.mode = 'PICK_TARGET'; }
      } else if (card.cardType === 'MEMORIA') {
        sel = { kind: 'MEMORIA', ownerId: playerId, cardInstanceId: instanceId, cardId: handCard.cardId };
      } else {
        alert('このカード種類（' + (TYPE_JA[card.cardType] || card.cardType) + '）は手札からは直接プレイできません');
        return;
      }
      render();
      return;
    }

    if (act === 'pick-leader') {
      if (!sel) return;
      var pIdx = Number(el.getAttribute('data-index'));
      var pPlayer = el.getAttribute('data-player');
      if (sel.kind === 'ATTACK' && pPlayer === sel.ownerId) {
        // アタッカーはいつでも選び直せる
        sel.attackerLeaderIndex = pIdx;
        sel.mode = sel.targetLeaderIndex == null ? 'PICK_TARGET' : 'READY';
      } else if (sel.kind === 'ATTACK' && pPlayer === opponentOf(sel.ownerId) && sel.attackerLeaderIndex != null) {
        sel.targetLeaderIndex = pIdx;
        sel.mode = 'READY';
      } else if (sel.mode === 'PICK_EQUIP_LEADER' && pPlayer === sel.ownerId) {
        var toEquip = sel;
        sel = null;
        doPlayTacticsEquip(toEquip.cardInstanceId, pIdx);
        return;
      }
      render();
      return;
    }

    if (act === 'confirm-attack') { doConfirmAttack(); return; }
    if (act === 'confirm-memoria') { doConfirmMemoria(); return; }

    if (act === 'play-tactics') {
      var instId = el.getAttribute('data-instance');
      var isEquip = el.getAttribute('data-equip') === '1';
      if (isEquip) {
        sel = { kind: 'TACTICS_EQUIP', mode: 'PICK_EQUIP_LEADER', ownerId: game.state.turn.activePlayer, cardInstanceId: instId };
        render();
      } else {
        doPlayTacticsConsumable(instId);
      }
      return;
    }
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' || screen !== 'battle') return;
    if (detailCardId) { detailCardId = null; render(); }
    else if (pendingChoice) { return; } // 選択は取り消せない（公開済みの情報を見た後にやり直せないように）
    else if (logOpen) { logOpen = false; render(); }
    else if (sel) { sel = null; render(); }
  });

  // ================= カードのプレビュー（マウスを合わせたカードを大きく表示） =================
  // data-preview="カード番号" を持つ要素にマウスを合わせると、画面の反対側に大きな画像とテキストを表示する。
  // 描画のたびにroot.innerHTMLを作り直すため、パネルはroot外（body直下）に1つだけ置いて使い回す。
  // タッチ端末（hoverできない）では表示しない（各カードの詳細ボタン／＋ボタンで拡大表示する）。
  var previewEl = document.createElement('div');
  previewEl.className = 'bt-preview';
  previewEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(previewEl);
  var previewKey = null;
  var canHover = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)').matches : true;

  function renderPreview(cardId, awakened) {
    var c = cardOf(cardId);
    var chips = [];
    if (c.cardType) chips.push(TYPE_JA[c.cardType] || c.cardType);
    if (c.color) chips.push(COLOR_JA[c.color] || c.color);
    if (c.cost != null) chips.push('コスト ' + c.cost);
    if (c.rarity) chips.push(c.rarity);
    if (c.ace) chips.push('ACE');
    (c.affiliations || []).forEach(function (a) { chips.push(a); });
    var stats = '';
    if (c.cardType === 'LEADER') {
      stats = '<div class="bt-pv-stats"><span' + (awakened ? '' : ' class="on"') + '>HP ' + c.hp + ' / ATK ' + c.atk + '</span>' +
        (c.awakenHp != null ? '<span' + (awakened ? ' class="on"' : '') + '>覚醒 HP ' + c.awakenHp + ' / ATK ' + c.awakenAtk + '</span>' : '') + '</div>';
    }
    var landscape = c.cardType === 'TACTICS' || c.cardType === 'PP_TICKET' || c.cardType === 'PP';
    var text = c.cardType === 'LEADER'
      ? (c.text ? '<span class="bt-kw awake">覚醒時</span>' + formatCardText(c.text) : '')
      : formatCardText(c.text || '');
    return '' +
      '<div class="bt-pv-img' + (landscape ? ' landscape' : '') + '">' + imgTag(c, awakened, 'bt-lnoimg') + '</div>' +
      '<div class="bt-pv-body">' +
        '<div class="bt-pv-num">' + esc(c.cardNumber || '') + '</div>' +
        '<div class="bt-pv-name">' + esc(c.name) + '</div>' +
        '<div class="bt-pv-chips">' + chips.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' +
        stats +
        (c.buildRule ? '<div class="bt-pv-rule">ビルドルール：' + esc(c.buildRule) + '</div>' : '') +
        (text ? '<div class="bt-pv-text">' + text + '</div>' : '') +
      '</div>';
  }

  function hidePreview() {
    previewKey = null;
    previewEl.classList.remove('show');
  }

  var lastPointer = null;
  document.addEventListener('mousemove', function (ev) { lastPointer = { x: ev.clientX, y: ev.clientY }; }, { passive: true });
  function refreshPreview() {
    if (!canHover || !lastPointer) { hidePreview(); return; }
    showPreviewFor(document.elementFromPoint(lastPointer.x, lastPointer.y));
  }

  document.addEventListener('mouseover', function (ev) {
    if (!canHover) return;
    showPreviewFor(ev.target);
  });

  function showPreviewFor(target) {
    var el = target && target.closest && target.closest('[data-preview]');
    if (!el) { hidePreview(); return; }
    var cardId = el.getAttribute('data-preview');
    var awakened = el.getAttribute('data-preview-awakened') === '1';
    var key = cardId + (awakened ? ':aw' : '');
    // 画面の右半分にあるカードなら左側に、左半分なら右側に出す（カード自体を隠さないように）
    var rect = el.getBoundingClientRect();
    var atLeft = (rect.left + rect.width / 2) > window.innerWidth / 2;
    if (key !== previewKey) {
      previewKey = key;
      previewEl.innerHTML = renderPreview(cardId, awakened);
    }
    previewEl.classList.toggle('at-left', atLeft);
    previewEl.classList.add('show');
  }
  document.addEventListener('mouseleave', hidePreview);
  window.addEventListener('scroll', hidePreview, { passive: true });

  // URLに部屋コードが付いていれば、招待された側として部屋に参加する
  (function () {
    var room = new URLSearchParams(location.search).get('room');
    if (room && /^[a-z0-9]{4,16}$/.test(room)) openOnlineRoom('guest', room);
  })();

  render();
})();
