/* Xross Stars デッキビルダー — UI本体（フレームワーク非依存の素のJS。既存HP管理アプリとは完全に別ページ・別状態） */
(function () {
  'use strict';

  var CARDS = window.XS_DECKBUILDER_CARDS || [];
  var CARD_INDEX = {};
  CARDS.forEach(function (c) { CARD_INDEX[c.cardNumber] = c; });

  var COLOR_HEX = { red: '#ff458e', blue: '#62c5ee', green: '#6fae7c', yellow: '#edbb00', colorless: '#9b9797' };
  var COLOR_JA = { red: '赤', blue: '青', green: '緑', yellow: '黄', colorless: '無色' };
  var TYPE_JA_SHORT = { LEADER: 'リーダー', ATTACK: 'アタック', MEMORIA: 'メモリア', TACTICS: 'タクティクス', PP: 'PP', PP_TICKET: 'PPチケット' };

  var SETS = uniq(CARDS.map(function (c) { return c.set; })).sort();
  var RARITIES = uniq(CARDS.map(function (c) { return c.rarity; }).filter(Boolean)).sort();

  function uniq(arr) { var o = {}; arr.forEach(function (v) { o[v] = 1; }); return Object.keys(o); }

  var PAGE_SIZE = 48;

  var state = {
    deckName: '',
    leaders: [null, null, null, null], // cardNumber x4
    deckCards: {},                      // cardNumber -> count
    tactics: [],                        // cardNumber[] (max5, no dup name)
    filters: {
      q: '', numberQ: '', set: 'ALL', cardType: 'ALL', color: 'ALL', rarity: 'ALL', cost: 'ALL',
      aceOnly: false, leaderOnly: false, eligibleOnly: false, inDeckOnly: false,
    },
    page: 0,
    activeTab: 'main', // 'main' | 'tactics'
    picker: null,      // { slot: 0..3 } リーダー選択モーダル
    modal: null,       // 'save' | 'load' | 'code' | 'loadcode' | 'detail'
    detailCard: null,
    codeOutput: '',
    codeInput: '',
    toast: '',
  };

  // ---------- 派生値 ----------
  function selectedLeaderCards() {
    return state.leaders.map(function (n) { return n ? CARD_INDEX[n] : null; }).filter(Boolean);
  }

  function deckEntries() {
    return Object.keys(state.deckCards)
      .filter(function (n) { return state.deckCards[n] > 0; })
      .map(function (n) { return { cardNumber: n, count: state.deckCards[n] }; });
  }

  function buildDeckObject() {
    return {
      name: state.deckName,
      leaders: state.leaders.filter(Boolean),
      cards: deckEntries(),
      tactics: state.tactics.slice(),
    };
  }

  function currentValidation() {
    var deck = {
      leaders: state.leaders.slice(),
      cards: deckEntries(),
      tactics: state.tactics.slice(),
    };
    return window.XS_DECK_RULES.validateDeck(deck, CARD_INDEX);
  }

  // グリッド表示専用の採用可否判定（リーダー未選択時は全カードを通す＝閲覧を妨げない）
  function gridEligibility(card) {
    var leaderCards = selectedLeaderCards();
    if (leaderCards.length === 0) return { eligible: true, reasons: [] };
    return window.XS_DECK_RULES.evaluateEligibility(card, leaderCards);
  }

  // ---------- フィルタ ----------
  function matchesFilters(card) {
    var f = state.filters;
    if (f.q && card.name && card.name.toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
    if (f.q && !card.name) return false;
    if (f.numberQ && card.cardNumber.toLowerCase().indexOf(f.numberQ.toLowerCase()) < 0) return false;
    if (f.set !== 'ALL' && card.set !== f.set) return false;
    if (f.cardType !== 'ALL' && card.cardType !== f.cardType) return false;
    if (f.color !== 'ALL' && card.color !== f.color) return false;
    if (f.rarity !== 'ALL' && card.rarity !== f.rarity) return false;
    if (f.cost !== 'ALL') {
      if (f.cost === '4+') { if (!(card.cost >= 4)) return false; }
      else if (Number(card.cost) !== Number(f.cost)) return false;
    }
    if (f.aceOnly && card.ace !== true) return false;
    if (f.leaderOnly && !(card.buildRuleParsed && card.buildRuleParsed.kind === 'LEADER_NAME')) return false;
    if (f.eligibleOnly) {
      var e = gridEligibility(card);
      if (e.eligible !== true) return false;
    }
    if (f.inDeckOnly) {
      var inMain = (state.deckCards[card.cardNumber] || 0) > 0;
      var inTactics = state.tactics.indexOf(card.cardNumber) >= 0;
      if (!inMain && !inTactics) return false;
    }
    return true;
  }

  function filteredCards() {
    var pool = state.activeTab === 'tactics'
      ? CARDS.filter(function (c) { return c.cardType === 'TACTICS'; })
      : CARDS.filter(function (c) { return c.cardType !== 'LEADER'; });
    return pool.filter(matchesFilters);
  }

  // ---------- ユーティリティ ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cardImg(card, awakened) {
    return (awakened && card.imageUrlAwakened) ? card.imageUrlAwakened : card.imageUrl;
  }
  function copyCount(card) {
    // 同名4枚制限のカウント対象。パラレルは元カードと同じ名前で数える。
    var total = 0;
    Object.keys(state.deckCards).forEach(function (num) {
      var c = CARD_INDEX[num];
      if (c && c.name === card.name) total += state.deckCards[num] || 0;
    });
    return total;
  }
  function aceTotal() {
    return deckEntries().reduce(function (s, e) {
      var c = CARD_INDEX[e.cardNumber];
      return s + (c && c.ace === true ? e.count : 0);
    }, 0);
  }

  // ---------- 状態操作 ----------
  function setLeader(slot, cardNumber) {
    state.leaders[slot] = cardNumber;
    state.picker = null;
    state.page = 0;
    render();
  }
  function removeLeader(slot, ev) {
    if (ev) ev.stopPropagation();
    state.leaders[slot] = null;
    render();
  }
  function addCard(cardNumber, delta) {
    var card = CARD_INDEX[cardNumber];
    if (!card) return;
    if (card.ban) { toast('「' + card.name + '」は現在BANされています'); return; }
    if (card.cardType === 'PP' || card.cardType === 'PP_TICKET') { toast('PPカードはデッキ枚数に含まれないため追加できません'); return; }
    if (state.activeTab === 'tactics') {
      if (delta > 0) {
        if (state.tactics.indexOf(cardNumber) >= 0) { toast('タクティクスは同名カードを複数入れられません'); return; }
        if (state.tactics.length >= window.XS_DECK_RULES.TACTICS_SIZE) { toast('タクティクスは' + window.XS_DECK_RULES.TACTICS_SIZE + '枚までです'); return; }
        state.tactics.push(cardNumber);
      } else {
        var idx = state.tactics.indexOf(cardNumber);
        if (idx >= 0) state.tactics.splice(idx, 1);
      }
      render();
      return;
    }
    var cur = state.deckCards[cardNumber] || 0;
    var next = cur + delta;
    if (next < 0) next = 0;
    if (next > window.XS_DECK_RULES.MAX_COPIES) { toast('同名カードは最大' + window.XS_DECK_RULES.MAX_COPIES + '枚までです'); return; }
    if (delta > 0) {
      var wouldBeCopies = copyCount(card) + delta;
      if (wouldBeCopies > window.XS_DECK_RULES.MAX_COPIES) { toast('「' + card.name + '」は最大' + window.XS_DECK_RULES.MAX_COPIES + '枚までです'); return; }
    }
    state.deckCards[cardNumber] = next;
    if (next === 0) delete state.deckCards[cardNumber];
    render();
  }
  function toast(msg) {
    state.toast = msg;
    render();
    setTimeout(function () { if (state.toast === msg) { state.toast = ''; render(); } }, 2600);
  }

  // ---------- 永続化 ----------
  var LS_KEY = 'xs-deckbuilder-decks';
  function loadSavedDecks() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveSavedDecks(list) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (e) { /* ignore quota errors */ }
  }
  function saveCurrentDeck() {
    if (!state.deckName.trim()) { toast('デッキ名を入力してください'); return; }
    var list = loadSavedDecks();
    var deck = buildDeckObject();
    deck.savedAt = Date.now();
    var idx = list.findIndex(function (d) { return d.name === deck.name; });
    if (idx >= 0) list[idx] = deck; else list.push(deck);
    saveSavedDecks(list);
    toast('「' + deck.name + '」を保存しました');
  }
  function loadDeckObject(deck) {
    state.deckName = deck.name || '';
    state.leaders = [0, 1, 2, 3].map(function (i) { return (deck.leaders || [])[i] || null; });
    state.deckCards = {};
    (deck.cards || []).forEach(function (e) { state.deckCards[e.cardNumber] = e.count; });
    state.tactics = (deck.tactics || []).slice();
    state.modal = null;
    state.page = 0;
    render();
  }

  // ---------- デッキコード ----------
  function generateCode() {
    var code = window.XS_DECK_CODE.encode(buildDeckObject());
    state.codeOutput = code;
    var url = location.origin + location.pathname + '#d=' + code;
    history.replaceState(null, '', '#d=' + code);
    state.codeOutput = url;
    state.modal = 'code';
    render();
  }
  function loadFromCodeString(input) {
    var code = input.trim();
    var m = code.match(/[#&]d=([^&]+)/);
    if (m) code = m[1];
    try {
      var deck = window.XS_DECK_CODE.decode(code);
      loadDeckObject(deck);
      toast('デッキコードを読み込みました');
    } catch (e) {
      toast('デッキコードを読み込めませんでした');
    }
  }
  function loadFromUrlHashIfPresent() {
    var h = location.hash || '';
    var m = h.match(/d=([^&]+)/);
    if (m) loadFromCodeString(m[1]);
  }

  // ---------- レンダリング ----------
  var root = document.getElementById('db-root');

  function render() {
    var leaderCards = selectedLeaderCards();
    var validation = currentValidation();

    root.innerHTML =
      renderHeader() +
      '<div class="db-body">' +
        '<div class="db-main">' +
          renderLeaderSlots(leaderCards) +
          renderTabs() +
          renderFilters() +
          renderGridMeta() +
          renderGrid(leaderCards) +
          renderPager() +
        '</div>' +
        renderSidebar(validation) +
      '</div>' +
      (state.picker ? renderLeaderPicker() : '') +
      (state.modal ? renderModal(validation) : '') +
      (state.toast ? '<div style="position:fixed;left:50%;bottom:16px;transform:translateX(-50%);background:#2d2b2b;border:1px solid #444141;padding:8px 16px;border-radius:20px;font-size:13px;z-index:60">' + esc(state.toast) + '</div>' : '');

    bindEvents();
  }

  function renderHeader() {
    return '' +
      '<div class="db-header">' +
        '<h1>XROSS STARS デッキビルダー</h1>' +
        '<a class="db-back" href="index.html">← HP管理へ</a>' +
        '<input class="db-name-input" id="db-deck-name" type="text" placeholder="デッキ名" value="' + esc(state.deckName) + '">' +
        '<button class="db-btn primary" data-act="save">保存</button>' +
        '<button class="db-btn" data-act="load">読み込み</button>' +
        '<button class="db-btn" data-act="gencode">デッキコード発行</button>' +
        '<button class="db-btn" data-act="loadcode">コード読み込み</button>' +
      '</div>';
  }

  function renderLeaderSlots(leaderCards) {
    var usedNames = {};
    leaderCards.forEach(function (l) { usedNames[l.name] = true; });
    var html = '<div><div class="db-status-title" style="margin-bottom:6px">リーダーを4枚選択してください</div><div class="db-leaders">';
    for (var i = 0; i < 4; i++) {
      var num = state.leaders[i];
      var card = num ? CARD_INDEX[num] : null;
      if (card) {
        html += '' +
          '<button class="db-leader-slot" data-act="open-picker" data-slot="' + i + '">' +
            '<span class="db-swatch" style="background:' + (COLOR_HEX[card.color] || '#9b9797') + '"></span>' +
            (cardImg(card) ? '<img src="' + esc(cardImg(card)) + '" alt="" loading="lazy">' : '<div class="db-leader-empty">' + esc(card.cardNumber) + '<br>' + esc(card.name) + '</div>') +
            '<span class="db-leader-name">' + esc(card.name) + '</span>' +
            '<button class="db-remove" data-act="remove-leader" data-slot="' + i + '" title="外す">✕</button>' +
          '</button>';
      } else {
        html += '' +
          '<button class="db-leader-slot" data-act="open-picker" data-slot="' + i + '">' +
            '<div class="db-leader-empty">＋<br>リーダー ' + (i + 1) + '</div>' +
          '</button>';
      }
    }
    html += '</div></div>';
    return html;
  }

  function renderTabs() {
    return '' +
      '<div class="db-tabs">' +
        '<button class="db-tab' + (state.activeTab === 'main' ? ' active' : '') + '" data-act="tab" data-tab="main">メインデッキ（50枚）</button>' +
        '<button class="db-tab' + (state.activeTab === 'tactics' ? ' active' : '') + '" data-act="tab" data-tab="tactics">タクティクス（5枚）</button>' +
      '</div>';
  }

  function renderFilters() {
    var f = state.filters;
    function opt(value, label, selected) {
      return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }
    var typeOptions = state.activeTab === 'tactics'
      ? ''
      : ['ALL', 'ATTACK', 'MEMORIA', 'TACTICS', 'PP', 'PP_TICKET'].map(function (t) {
          return opt(t, t === 'ALL' ? 'カード種類：すべて' : TYPE_JA_SHORT[t], f.cardType === t);
        }).join('');
    return '' +
      '<div class="db-filters">' +
        '<input type="search" id="f-name" placeholder="カード名検索" value="' + esc(f.q) + '">' +
        '<input type="search" id="f-number" placeholder="カード番号検索" value="' + esc(f.numberQ) + '">' +
        '<select id="f-set"><option value="ALL">収録弾：すべて</option>' + SETS.map(function (s) { return opt(s, s, f.set === s); }).join('') + '</select>' +
        (state.activeTab === 'tactics' ? '' : '<select id="f-type">' + typeOptions + '</select>') +
        '<select id="f-color"><option value="ALL">色：すべて</option>' + Object.keys(COLOR_JA).map(function (c) { return opt(c, COLOR_JA[c], f.color === c); }).join('') + '</select>' +
        '<select id="f-rarity"><option value="ALL">レア度：すべて</option>' + RARITIES.map(function (r) { return opt(r, r, f.rarity === r); }).join('') + '</select>' +
        '<select id="f-cost"><option value="ALL">コスト：すべて</option>' + [0, 1, 2, 3, '4+'].map(function (c) { return opt(c, 'コスト ' + c, f.cost == c); }).join('') + '</select>' +
        '<button class="db-chip' + (f.aceOnly ? ' active' : '') + '" data-act="toggle" data-f="aceOnly">ACEのみ</button>' +
        '<button class="db-chip' + (f.leaderOnly ? ' active' : '') + '" data-act="toggle" data-f="leaderOnly">リーダー専用</button>' +
        '<button class="db-chip' + (f.eligibleOnly ? ' active' : '') + '" data-act="toggle" data-f="eligibleOnly">採用可能カードのみ</button>' +
        '<button class="db-chip' + (f.inDeckOnly ? ' active' : '') + '" data-act="toggle" data-f="inDeckOnly">採用中カードのみ</button>' +
      '</div>';
  }

  function renderGridMeta() {
    var all = filteredCards();
    var totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    return '<div class="db-grid-meta"><span>' + all.length + '件</span><span>' + (state.page + 1) + ' / ' + totalPages + 'ページ</span></div>';
  }

  function renderGrid(leaderCards) {
    var all = filteredCards();
    var start = state.page * PAGE_SIZE;
    var pageCards = all.slice(start, start + PAGE_SIZE);
    if (pageCards.length === 0) return '<div class="db-empty">該当するカードがありません</div>';

    return '<div class="db-grid">' + pageCards.map(function (card) {
      var elig = gridEligibility(card);
      var cls = 'db-card' + (elig.eligible === false ? ' ineligible' : '') + (elig.eligible === null ? ' unknown-rule' : '');
      var inTactics = state.tactics.indexOf(card.cardNumber) >= 0;
      var qty = state.activeTab === 'tactics' ? (inTactics ? 1 : 0) : (state.deckCards[card.cardNumber] || 0);
      var img = cardImg(card);
      var addDisabled = card.ban || card.cardType === 'PP' || card.cardType === 'PP_TICKET';
      return '' +
        '<div class="' + cls + '" data-number="' + esc(card.cardNumber) + '">' +
          (card.ban ? '<span class="db-card-ban">BAN</span>' : '') +
          (card.ace === true ? '<span class="db-card-ace">ACE</span>' : '') +
          '<div class="db-card-img" data-act="detail" data-number="' + esc(card.cardNumber) + '">' +
            (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '<div class="db-card-placeholder">' + esc(card.cardNumber) + '<br>' + esc(card.name || '(名称未確認)') + '</div>') +
          '</div>' +
          '<div class="db-card-body">' +
            '<div class="db-card-name">' + esc(card.name || '(名称未確認)') + '</div>' +
            '<div class="db-card-meta"><span>' + esc(card.cardNumber) + '</span><span>' + (card.cost != null ? 'C' + card.cost : '') + '</span></div>' +
          '</div>' +
          (elig.reasons && elig.reasons.length ? '<div class="db-reason">' + esc(elig.reasons[0]) + '</div>' : '') +
          '<div class="db-card-controls">' +
            '<button class="db-qty-btn" data-act="qty" data-number="' + esc(card.cardNumber) + '" data-delta="-1"' + (qty <= 0 ? ' disabled' : '') + '>−</button>' +
            '<span class="db-qty">' + qty + (state.activeTab === 'tactics' ? '' : ' / 4') + '</span>' +
            '<button class="db-qty-btn" data-act="qty" data-number="' + esc(card.cardNumber) + '" data-delta="1"' + (addDisabled ? ' disabled' : '') + '>＋</button>' +
          '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function renderPager() {
    var all = filteredCards();
    var totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    if (totalPages <= 1) return '';
    return '' +
      '<div class="db-pager">' +
        '<button class="db-btn" data-act="page" data-dir="-1"' + (state.page <= 0 ? ' disabled' : '') + '>← 前へ</button>' +
        '<button class="db-btn" data-act="page" data-dir="1"' + (state.page >= totalPages - 1 ? ' disabled' : '') + '>次へ →</button>' +
      '</div>';
  }

  function renderSidebar(validation) {
    var s = validation.summary;
    function stat(label, value, max, ok) {
      return '<div class="db-stat ' + (ok ? 'ok' : 'ng') + '"><span>' + label + '</span><b>' + value + ' / ' + max + '</b></div>';
    }
    function statPlain(label, value) {
      return '<div class="db-stat ok"><span>' + label + '</span><b>' + value + '</b></div>';
    }
    return '' +
      '<div class="db-sidebar">' +
        '<div>' +
          '<div class="db-status-title">デッキ状況</div>' +
          '<div class="db-status-grid" style="margin-top:6px">' +
            stat('リーダー', s.leaderCount, 4, s.leaderCount === 4) +
            stat('デッキ', s.mainCount, 50, s.mainCount === 50) +
            stat('ACE', s.aceCount, 8, s.aceCount <= 8) +
            stat('タクティクス', s.tacticsCount, 5, s.tacticsCount === 5) +
            statPlain('アタック', s.attackCount) +
            statPlain('メモリア', s.memoriaCount) +
          '</div>' +
        '</div>' +
        '<div>' +
          '<div class="db-status-title">デッキ構築チェック</div>' +
          '<div class="db-violations" style="margin-top:6px">' +
            (validation.valid
              ? '<div class="v-good">✓ デッキ構築ルールを満たしています</div>'
              : validation.violations.map(function (v) { return '<div class="v-bad">❌ ' + esc(v) + '</div>'; }).join('')) +
            validation.warnings.map(function (w) { return '<div class="v-warn">⚠ ' + esc(w) + '</div>'; }).join('') +
          '</div>' +
        '</div>' +
        '<div>' +
          '<div class="db-status-title">' + (state.activeTab === 'tactics' ? 'タクティクス内容' : 'デッキ内容') + '</div>' +
          renderDeckList() +
        '</div>' +
      '</div>';
  }

  function renderDeckList() {
    var rows;
    if (state.activeTab === 'tactics') {
      rows = state.tactics.map(function (num) {
        var c = CARD_INDEX[num];
        return { num: num, label: (c ? c.name : num), count: 1 };
      });
    } else {
      rows = deckEntries().map(function (e) {
        var c = CARD_INDEX[e.cardNumber];
        return { num: e.cardNumber, label: (c ? c.name : e.cardNumber), count: e.count };
      });
    }
    if (rows.length === 0) return '<div class="db-empty" style="padding:10px">まだ何も入っていません</div>';
    return '<div class="db-deck-list" style="margin-top:6px">' + rows.map(function (r) {
      return '<div class="db-deck-row"><span>' + esc(r.label) + (r.count > 1 ? ' ×' + r.count : '') + '</span><button class="rm" data-act="qty" data-number="' + esc(r.num) + '" data-delta="' + (state.activeTab === 'tactics' ? -1 : -r.count) + '">外す</button></div>';
    }).join('') + '</div>';
  }

  function renderLeaderPicker() {
    var used = {};
    state.leaders.forEach(function (n, i) { if (n && i !== state.picker.slot) used[CARD_INDEX[n].name] = true; });
    var leaders = CARDS.filter(function (c) { return c.cardType === 'LEADER'; })
      .filter(function (c) { return !state.filters.pickerQ || c.name.toLowerCase().indexOf(state.filters.pickerQ.toLowerCase()) >= 0; })
      .sort(function (a, b) { return a.cardNumber < b.cardNumber ? -1 : 1; });
    return '' +
      '<div class="db-modal-overlay" data-act="close-picker">' +
        '<div class="db-modal" data-stop="1">' +
          '<div class="db-modal-header"><b>リーダー ' + (state.picker.slot + 1) + ' を選択</b>' +
            '<input type="search" id="picker-q" placeholder="リーダー名検索" style="margin-left:12px;min-height:32px" value="' + esc(state.filters.pickerQ || '') + '">' +
            '<button class="db-modal-close" data-act="close-picker">✕</button></div>' +
          '<div class="db-modal-body"><div class="db-grid">' +
            leaders.map(function (c) {
              var disabled = used[c.name];
              return '' +
                '<div class="db-card' + (disabled ? ' ineligible' : '') + '" data-act="' + (disabled ? '' : 'pick-leader') + '" data-number="' + esc(c.cardNumber) + '" style="cursor:' + (disabled ? 'default' : 'pointer') + '">' +
                  '<div class="db-card-img">' + (cardImg(c) ? '<img src="' + esc(cardImg(c)) + '" alt="" loading="lazy">' : '<div class="db-card-placeholder">' + esc(c.cardNumber) + '<br>' + esc(c.name) + '</div>') + '</div>' +
                  '<div class="db-card-body"><div class="db-card-name">' + esc(c.name) + '</div><div class="db-card-meta"><span>' + esc(c.set) + '</span><span>' + COLOR_JA[c.color] + '</span></div></div>' +
                '</div>';
            }).join('') +
          '</div></div>' +
        '</div>' +
      '</div>';
  }

  function renderModal(validation) {
    if (state.modal === 'save') {
      return modalWrap('デッキを保存', '<p>デッキ名「' + esc(state.deckName || '(未入力)') + '」で保存します。</p><button class="db-btn primary" data-act="do-save">保存する</button>');
    }
    if (state.modal === 'load') {
      var list = loadSavedDecks();
      var body = list.length === 0
        ? '<div class="db-empty">保存済みデッキはありません</div>'
        : '<div class="db-savedlist">' + list.map(function (d, i) {
            return '<div class="row"><span class="name">' + esc(d.name) + '</span><button class="db-btn" data-act="do-load" data-index="' + i + '">読み込む</button><button class="db-btn" data-act="do-delete" data-index="' + i + '">削除</button></div>';
          }).join('') + '</div>';
      return modalWrap('保存済みデッキ', body);
    }
    if (state.modal === 'code') {
      return modalWrap('デッキコード', '<p>下記URLを共有すると、このデッキを復元できます。</p><textarea class="db-code-box" readonly>' + esc(state.codeOutput) + '</textarea><button class="db-btn primary" data-act="copy-code" style="margin-top:8px">コピー</button>');
    }
    if (state.modal === 'loadcode') {
      return modalWrap('デッキコード読み込み', '<p>URLまたはコードを貼り付けてください。</p><textarea class="db-code-box" id="code-input" placeholder="https://.../deckbuilder.html#d=..."></textarea><button class="db-btn primary" data-act="do-loadcode" style="margin-top:8px">読み込む</button>');
    }
    if (state.modal === 'detail' && state.detailCard) {
      var c = state.detailCard;
      var img = cardImg(c);
      return modalWrap(c.name || c.cardNumber, '' +
        (img ? '<div style="max-width:220px;margin:0 auto 10px"><img src="' + esc(img) + '" style="width:100%" alt=""></div>' : '') +
        '<p style="font-size:12px;color:var(--xs-sub)">' + esc(c.cardNumber) + ' ・ ' + esc(c.set) + ' ・ ' + esc(TYPE_JA_SHORT[c.cardType] || c.cardTypeJa) + ' ・ ' + esc(COLOR_JA[c.color] || '') + (c.rarity ? ' ・ ' + esc(c.rarity) : '') + (c.cost != null ? ' ・ コスト' + c.cost : '') + '</p>' +
        (c.text ? '<p style="font-size:13px;line-height:1.6;white-space:pre-wrap">' + esc(c.text) + '</p>' : '<p style="font-size:12px;color:var(--xs-sub)">カードテキスト未確認</p>') +
        (c.buildRule ? '<p style="font-size:12px;color:var(--xs-yellow)">ビルドルール: ' + esc(c.buildRule) + '</p>' : '') +
        '<p style="font-size:11px;color:var(--xs-sub)">確認状況: ' + esc(c.confirmStatus || '不明') + '</p>'
      );
    }
    return '';
  }
  function modalWrap(title, body) {
    return '' +
      '<div class="db-modal-overlay" data-act="close-modal">' +
        '<div class="db-modal" style="max-width:520px" data-stop="1">' +
          '<div class="db-modal-header"><b>' + esc(title) + '</b><button class="db-modal-close" data-act="close-modal">✕</button></div>' +
          '<div class="db-modal-body">' + body + '</div>' +
        '</div>' +
      '</div>';
  }

  // ---------- イベント ----------
  function bindEvents() {
    root.querySelectorAll('[data-stop]').forEach(function (el) { el.addEventListener('click', function (e) { e.stopPropagation(); }); });

    var nameInput = document.getElementById('db-deck-name');
    if (nameInput) nameInput.addEventListener('input', function (e) { state.deckName = e.target.value; });

    bindFilterInput('f-name', 'q');
    bindFilterInput('f-number', 'numberQ');
    bindFilterSelect('f-set', 'set');
    bindFilterSelect('f-type', 'cardType');
    bindFilterSelect('f-color', 'color');
    bindFilterSelect('f-rarity', 'rarity');
    bindFilterSelect('f-cost', 'cost');

    var pickerQ = document.getElementById('picker-q');
    if (pickerQ) pickerQ.addEventListener('input', function (e) { state.filters.pickerQ = e.target.value; render(); restoreFocus('picker-q'); });

    root.querySelectorAll('[data-act]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        var act = el.getAttribute('data-act');
        if (!act) return;
        handleAction(act, el, e);
      });
    });
  }

  function restoreFocus(id) {
    var el = document.getElementById(id);
    if (el) { el.focus(); var v = el.value; el.value = ''; el.value = v; }
  }

  function bindFilterInput(id, key) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function (e) {
      state.filters[key] = e.target.value;
      state.page = 0;
      render();
      restoreFocus(id);
    });
  }
  function bindFilterSelect(id, key) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function (e) {
      state.filters[key] = e.target.value;
      state.page = 0;
      render();
    });
  }

  function handleAction(act, el) {
    if (act === 'open-picker') { state.picker = { slot: Number(el.getAttribute('data-slot')) }; state.filters.pickerQ = ''; render(); return; }
    if (act === 'close-picker') { state.picker = null; render(); return; }
    if (act === 'pick-leader') { setLeader(state.picker.slot, el.getAttribute('data-number')); return; }
    if (act === 'remove-leader') { removeLeader(Number(el.getAttribute('data-slot'))); return; }
    if (act === 'tab') { state.activeTab = el.getAttribute('data-tab'); state.page = 0; render(); return; }
    if (act === 'toggle') { var f = el.getAttribute('data-f'); state.filters[f] = !state.filters[f]; state.page = 0; render(); return; }
    if (act === 'page') { state.page += Number(el.getAttribute('data-dir')); render(); return; }
    if (act === 'qty') { addCard(el.getAttribute('data-number'), Number(el.getAttribute('data-delta'))); return; }
    if (act === 'detail') { state.detailCard = CARD_INDEX[el.getAttribute('data-number')]; state.modal = 'detail'; render(); return; }
    if (act === 'close-modal') { state.modal = null; state.detailCard = null; render(); return; }
    if (act === 'save') { state.modal = 'save'; render(); return; }
    if (act === 'do-save') { saveCurrentDeck(); state.modal = null; render(); return; }
    if (act === 'load') { state.modal = 'load'; render(); return; }
    if (act === 'do-load') { var list = loadSavedDecks(); loadDeckObject(list[Number(el.getAttribute('data-index'))]); return; }
    if (act === 'do-delete') { var list2 = loadSavedDecks(); list2.splice(Number(el.getAttribute('data-index')), 1); saveSavedDecks(list2); render(); return; }
    if (act === 'gencode') { generateCode(); return; }
    if (act === 'copy-code') {
      var box = root.querySelector('.db-code-box');
      if (box) { box.select(); try { document.execCommand('copy'); toast('コピーしました'); } catch (e) { /* noop */ } }
      return;
    }
    if (act === 'loadcode') { state.modal = 'loadcode'; render(); return; }
    if (act === 'do-loadcode') {
      var input = document.getElementById('code-input');
      if (input) loadFromCodeString(input.value);
      return;
    }
  }

  root.addEventListener('click', function (e) {
    if (e.target.classList && e.target.classList.contains('db-modal-overlay')) {
      state.modal = null; state.picker = null; state.detailCard = null; render();
    }
  });

  // ---------- 初期化 ----------
  loadFromUrlHashIfPresent();
  render();
})();
