/* Xross Stars 対戦UI — js/engine/* の上に乗るローカル対戦画面（1台の端末で2人が交互に操作する対戦台方式）
 *
 * 前提・簡略化していること（PROVISIONAL。js/engine側のルール実装自体は変更しない）:
 *   - 手札・タクティクスエリアの非公開情報は、同一画面を2人で見る対戦台方式のため簡略化する
 *     （タクティクスエリアの中身は両者に見える。手札は「自分の手番のときだけ」中身を表示する）。
 *   - 複数候補から対象を選ぶ必要がある効果（chooseTarget等）は、js/engine側が用意している
 *     安全なデフォルト挙動（先頭候補・辞退）にすべて委ねる。UI側での選択モーダルは実装しない。
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

  var COLOR_JA = { red: '赤', blue: '青', green: '緑', yellow: '黄', colorless: '無色' };
  var TYPE_JA = { LEADER: 'リーダー', ATTACK: 'アタック', MEMORIA: 'メモリア', TACTICS: 'タクティクス', PP: 'PP', PP_TICKET: 'PPチケット' };
  var EQUIP_ACTION_TYPES = ['EQUIP_HP_MODIFIER', 'EQUIP_ATK_MODIFIER', 'EQUIP_GRANT_ABILITY'];
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
  };
  var game = null; // { state }
  var sel = null;  // 手番プレイヤーの操作中の選択状態
  var logOpen = false;
  var lastRoundBanner = null;
  var detailCardId = null;   // カード詳細モーダルで表示中のカード
  var seenActive = null;     // 手番交代画面を最後に確認したプレイヤー（対戦台で相手の手札を見せないため）
  var prevHp = {};           // 直前の描画時点の各リーダー残りHP（ダメージ/回復演出用）
  var notice = null;         // 操作できなかった理由などの一言メッセージ（次の操作で消える）

  var PLAYER_LABEL = { playerA: 'プレイヤーA', playerB: 'プレイヤーB' };
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
  }

  // 手札ドック（固定表示）の実際の高さに合わせて盤面の下余白を取り、最下段が隠れないようにする
  function syncDockHeight() {
    var dock = root.querySelector('.bt-dock');
    document.documentElement.style.setProperty('--dock-h', (dock ? dock.offsetHeight : 0) + 'px');
  }
  window.addEventListener('resize', syncDockHeight);

  function imgTag(card, awakened, cls) {
    var src = cardImg(card, awakened);
    return src ? '<img src="' + esc(src) + '" alt="' + esc(card.name) + '" loading="lazy">'
      : '<div class="' + cls + '">' + esc(card.name) + '</div>';
  }

  // ================= セットアップ画面 =================
  function renderSetup() {
    return '' +
      '<div class="bt-setup">' +
        '<div class="bt-hero"><h2>BATTLE</h2><p>1台の端末で2人が交互に操作するローカル対戦</p></div>' +
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
          '<div class="bt-opt">先攻 <span class="bt-seg">' +
            '<button data-act="set-first" data-value="playerA" class="' + (setup.firstPlayer === 'playerA' ? 'on' : '') + '">A</button>' +
            '<button data-act="set-first" data-value="playerB" class="' + (setup.firstPlayer === 'playerB' ? 'on' : '') + '">B</button>' +
          '</span></div>' +
          '<button class="bt-btn ghost" data-act="coinflip">ランダムで決める</button>' +
        '</div>' +
        '<div class="bt-start-row"><button class="bt-btn primary big" data-act="start">対戦開始</button></div>' +
        '<details class="bt-notes"><summary>この対戦画面について</summary>' +
          '対象を複数から選ぶ効果などは、エンジン側の安全なデフォルト挙動（先頭候補を自動選択、または「してもよい」を辞退）で処理されます。' +
          'カード効果はエンジンに登録済みのカードのみ再現されており、未登録カードはアタックカードなら上乗せダメージ0、それ以外はプレイ時効果なしとして扱われます。' +
          '手札は自分の手番のときだけ表示され、手番交代時は確認画面を挟みます。' +
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

  function startMatch() {
    var deckA = deckFor('playerA');
    var deckB = deckFor('playerB');
    if (!deckA || !deckB) { alert('両プレイヤーのデッキを選択してください（保存済みデッキ、またはランダムデッキ）'); return; }
    if ((deckA.leaders || []).length !== 4 || (deckB.leaders || []).length !== 4) {
      alert('両プレイヤーとも、リーダーを4体選択したデッキが必要です'); return;
    }

    var config = {
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
    };

    var state;
    try {
      state = Eng.Match.createMatch(config);
      Eng.Phases.runStartPhase(state);
    } catch (e) {
      alert('対戦を開始できませんでした: ' + e.message);
      return;
    }

    game = { state: state };
    sel = null;
    lastRoundBanner = null;
    detailCardId = null;
    seenActive = null;
    prevHp = {};
    screen = 'battle';
    render();
  }

  // ================= 対戦画面 =================
  function renderBattle() {
    var state = game.state;
    var finished = state.match.status === 'FINISHED';
    var handoffPending = !finished && !lastRoundBanner && state.turn.activePlayer !== seenActive;
    var html = renderBattleBoard(state, finished, handoffPending);

    if (finished) html += renderMatchEndOverlay(state);
    else if (lastRoundBanner) html += renderRoundEndOverlay(lastRoundBanner);
    else if (handoffPending) html += renderHandoffOverlay(state);
    if (detailCardId) html += renderDetailOverlay(detailCardId);
    if (logOpen) html += renderLogDrawer(state);
    return html;
  }

  function renderBattleBoard(state, readOnly, hideHand) {
    var bottom = state.turn.activePlayer; // 手番プレイヤーが常に下側
    var top = opponentOf(bottom);
    var hpNow = snapshotHp(state);
    var deltas = {};
    Object.keys(hpNow).forEach(function (k) { if (prevHp[k] != null && prevHp[k] !== hpNow[k]) deltas[k] = hpNow[k] - prevHp[k]; });
    prevHp = hpNow;

    return '' +
      '<div class="bt-battle">' +
        renderScore(state) +
        renderSide(state, top, readOnly, deltas, false) +
        renderCenter(state) +
        renderSide(state, bottom, readOnly, deltas, true) +
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
        '<button class="bt-btn ghost bt-logbtn" data-act="toggle-log">ログ</button>' +
      '</div>';
  }

  function renderSide(state, playerId, readOnly, deltas, isBottom) {
    var player = state.players[playerId];
    var isActive = playerId === state.turn.activePlayer;
    var pp = player.ppCards.max - player.ppCards.tapped;
    var strip = '' +
      '<div class="bt-strip">' +
        '<span class="bt-pname">' + pBadge(playerId) + '<span class="bt-plabel">' + esc(PLAYER_LABEL[playerId]) + '</span></span>' +
        (isActive ? '<span class="bt-turntag">YOUR TURN</span>' : '') +
        '<span class="bt-pp">' + renderPpPips(player) + '<span class="bt-pp-num">' + pp + '/' + player.ppCards.max + '</span></span>' +
        (player.pendingAttackBoost ? '<span class="bt-boost" title="次のアタックに上乗せされるダメージ">強化 +' + player.pendingAttackBoost + '</span>' : '') +
        '<span class="bt-counters">' +
          '<span class="bt-counter" title="山札">山札 <b>' + player.deck.length + '</b></span>' +
          '<span class="bt-counter" title="手札">手札 <b>' + player.hand.length + '</b></span>' +
          '<span class="bt-counter" title="トラッシュ">トラッシュ <b>' + player.trash.length + '</b></span>' +
        '</span>' +
      '</div>';
    var row = '' +
      '<div class="bt-row">' +
        '<div class="bt-leaders">' + player.leaders.map(function (l, i) { return renderLeader(playerId, l, i, readOnly, deltas[playerId + ':' + i]); }).join('') + '</div>' +
        renderField(state, playerId, isActive, readOnly) +
      '</div>';
    return '<section class="bt-side' + (playerId === 'playerB' ? ' pB' : '') + (isActive ? ' is-active' : ' is-opp') + '">' +
      strip + row + '</section>';
  }

  function renderPpPips(player) {
    var html = '<span class="bt-pp-pips">';
    for (var i = 0; i < player.ppCards.max; i++) {
      html += '<span class="bt-pp-pip' + (i < (player.ppCards.max - player.ppCards.tapped) ? ' filled' : '') + '"></span>';
    }
    return html + '</span>';
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
        r.pickable = sel.mode === 'PICK_TARGET' || sel.mode === 'READY';
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
    if (p.attacker) tags += '<span class="bt-tag">アタッカー</span>';
    if (p.target) tags += '<span class="bt-tag" style="background:var(--red)">対象</span>';

    var floater = '';
    if (delta) floater = '<span class="bt-float' + (delta > 0 ? ' heal' : '') + '">' + (delta > 0 ? '+' : '') + delta + '</span>';

    return '' +
      '<div class="' + cls + '"' + (p.pickable ? ' data-act="pick-leader" data-player="' + playerId + '" data-index="' + idx + '" role="button" tabindex="0"' : '') + '>' +
        '<div class="bt-lcard">' +
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

  function renderField(state, playerId, isActive, readOnly) {
    var player = state.players[playerId];
    var canPlay = !readOnly && isActive && Eng.Phases.canPlayTactics(state);
    var pp = player.ppCards.max - player.ppCards.tapped;

    var tactics = player.tacticsArea.length ? player.tacticsArea.map(function (t) {
      var card = cardOf(t.card.cardId);
      var equip = isEquipmentCard(t.card.cardId);
      var affordable = card.cost != null && card.cost <= pp;
      var disabled = !canPlay || !affordable;
      return '' +
        '<div class="bt-mini tactics" title="' + esc(card.name) + '（C' + (card.cost != null ? card.cost : '?') + '・' + (equip ? '装備' : '消費') + '）">' +
          '<div class="bt-mcard" data-act="show-detail" data-card="' + esc(t.card.cardId) + '">' + imgTag(card, false, 'bt-mnoimg') + '</div>' +
          (isActive && !readOnly ? '<button class="bt-mplay' + (disabled ? '' : ' ready') + '" data-act="play-tactics" data-instance="' + esc(t.card.instanceId) + '" data-equip="' + (equip ? 1 : 0) + '"' + (disabled ? ' disabled' : '') + '>' + (equip ? '装備' : '使う') + '</button>' : '') +
        '</div>';
    }).join('') : '<span class="bt-zone-empty">なし</span>';

    var play = player.playArea.length ? player.playArea.map(function (e) {
      var card = cardOf(e.card.cardId);
      return '<div class="bt-mini" title="' + esc(card.name) + '" data-act="show-detail" data-card="' + esc(e.card.cardId) + '"><div class="bt-mcard">' + imgTag(card, false, 'bt-mnoimg') + '</div></div>';
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

  function describeEvent(e) {
    var p = e.payload || {};
    switch (e.type) {
      case 'TURN_STARTED': return { cls: 'turn', text: PLAYER_LABEL[p.playerId] + 'のターン' };
      case 'ROUND_STARTED': return { cls: 'turn', text: 'ラウンド' + p.roundNumber + '開始' };
      case 'CARD_PLAYED': return { cls: 'play', text: pShort(p.playerId) + '：アタック「' + cardOf(p.cardId).name + '」' };
      case 'MEMORIA_PLAYED': return { cls: 'play', text: pShort(p.playerId) + '：メモリア「' + cardOf(p.cardId).name + '」' };
      case 'TACTICS_PLAYED': return { cls: 'play', text: pShort(p.playerId) + '：タクティクス「' + cardOf(p.cardId).name + '」' };
      case 'ATTACK_BOOSTED': return { cls: '', text: pShort(p.playerId) + '：アタック強化 +' + p.amount };
      case 'DAMAGE_DEALT': {
        var tp = p.targetPlayerId || p.playerId;
        var ti = p.targetLeaderIndex != null ? p.targetLeaderIndex : p.leaderIndex;
        return { cls: 'dmg', text: pShort(tp) + '「' + leaderNameOf(tp, ti) + '」に' + p.amount + 'ダメージ' };
      }
      case 'LEADER_DOWNED': return { cls: 'down', text: pShort(p.playerId) + '「' + leaderNameOf(p.playerId, p.leaderIndex) + '」ダウン' };
      case 'LEADER_AWAKENED': return { cls: 'awake', text: pShort(p.playerId) + '「' + leaderNameOf(p.playerId, p.leaderIndex) + '」覚醒！' };
      case 'EQUIPMENT_ATTACHED': return { cls: 'play', text: pShort(p.playerId) + '「' + leaderNameOf(p.playerId, p.leaderIndex) + '」に「' + cardOf(p.cardId).name + '」を装備' };
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
        var affordable = card.cost != null && card.cost <= pp;
        var reason = card.cost == null ? 'コスト未確定のためプレイできません' : (affordable ? '' : 'PPが足りません');
        var isSel = sel && sel.cardInstanceId === c.instanceId;
        return '' +
          '<div class="bt-handcard' + (isSel ? ' selected' : '') + (affordable ? '' : ' unplayable') + '" data-act="select-hand" data-instance="' + esc(c.instanceId) + '" title="' + esc(card.name + (reason ? '（' + reason + '）' : '')) + '">' +
            '<span class="bt-cost">' + (card.cost != null ? card.cost : '?') + '</span>' +
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
        '<div class="bt-prompt-text">' + multiInfo + '<b>' + esc(card.name) + '</b>　' + msg + '<span class="bt-ctext">' + esc(card.text || '') + '</span></div>' +
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
        '<div class="bt-prompt-text"><b>' + esc(mcard.name) + '</b>（メモリア）をプレイしますか？<span class="bt-ctext">' + esc(mcard.text || '') + '</span></div>' +
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
    return '<div class="bt-prompt-text">' + (notice ? '<b style="color:#ffb3c7">' + esc(notice) + '</b>' : '手札のカードを選ぶか、タクティクスを使ってください') + '</div>' +
      '<div class="bt-prompt-actions">' + endBtn + '</div>';
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
            (text ? '<div class="bt-dtext">' + (c.cardType === 'LEADER' ? '覚醒時：' : '') + esc(text) + '</div>' : '') +
            '<button class="bt-btn" data-act="close-detail" style="align-self:flex-start">閉じる</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ================= アクション =================
  function afterAction() {
    if (game.state.match.status === 'FINISHED') { sel = null; render(); return; }
    var result = Eng.Resolver.processRoundEndWithEffects(game.state);
    if (result.matchEnded) { sel = null; render(); return; }
    if (result.roundEnded) {
      lastRoundBanner = result.simultaneous
        ? '両者同時敗北。このラウンドの勝者はいません。'
        : (game.state.match.roundWins.playerA + game.state.match.roundWins.playerB > 0
          ? 'ラウンドが終了しました。次のラウンドを開始します。' : 'ラウンドが終了しました。');
      Eng.Phases.runStartPhase(game.state);
    }
    sel = null;
    render();
  }

  function doConfirmAttack() {
    var state = game.state;
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
    try {
      Eng.Resolver.playAttackCardWithEffects(state, playerId, sel.cardInstanceId, options, cardIndex);
    } catch (e) { alert(e.message); return; }
    afterAction();
  }

  function doConfirmMemoria() {
    var state = game.state;
    var playerId = sel.ownerId;
    try {
      Eng.Resolver.playMemoriaCardWithEffects(state, playerId, sel.cardInstanceId, {}, cardIndex);
    } catch (e) { alert(e.message); return; }
    afterAction();
  }

  function doPlayTacticsConsumable(cardInstanceId) {
    var state = game.state;
    var playerId = state.turn.activePlayer;
    try {
      Eng.Resolver.playTacticsCardWithEffects(state, playerId, cardInstanceId, { subType: 'CONSUMABLE' }, cardIndex);
    } catch (e) { alert(e.message); return; }
    afterAction();
  }

  function doPlayTacticsEquip(cardInstanceId, equipLeaderIndex) {
    var state = game.state;
    var playerId = state.turn.activePlayer;
    try {
      Eng.Resolver.playTacticsCardWithEffects(state, playerId, cardInstanceId, { subType: 'EQUIPMENT', equipLeaderIndex: equipLeaderIndex }, cardIndex);
    } catch (e) { alert(e.message); return; }
    afterAction();
  }

  function doEndTurn() {
    var state = game.state;
    try {
      Eng.Phases.runEndPhase(state);
      if (state.match.status === 'FINISHED') { sel = null; render(); return; }
      Eng.Resolver.endTurnAndSwitchWithEffects(state);
      Eng.Phases.runStartPhase(state);
      if (state.match.status === 'FINISHED') { sel = null; render(); return; }
    } catch (e) { alert(e.message); return; }
    sel = null;
    render();
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
    if (act === 'pick-random') {
      var side = el.getAttribute('data-side');
      setup[side].source = 'RANDOM';
      setup[side].generatedDeck = buildRandomDeck((side === 'playerA' ? 'プレイヤーA' : 'プレイヤーB') + '・ランダム');
      render();
      return;
    }
    if (act === 'set-mode') { setup.mode = el.getAttribute('data-value'); render(); return; }
    if (act === 'set-first') { setup.firstPlayer = el.getAttribute('data-value'); render(); return; }
    if (act === 'coinflip') {
      setup.firstPlayer = Math.random() < 0.5 ? 'playerA' : 'playerB';
      render();
      return;
    }
    if (act === 'start') { startMatch(); return; }

    if (act === 'toggle-log') { logOpen = !logOpen; render(); return; }
    if (act === 'show-detail') { detailCardId = el.getAttribute('data-card'); render(); return; }
    if (act === 'close-detail') { detailCardId = null; render(); return; }
    if (act === 'dismiss-handoff') { seenActive = game.state.turn.activePlayer; render(); return; }
    if (act === 'back-to-setup') {
      game = null; sel = null; lastRoundBanner = null; detailCardId = null; logOpen = false;
      setup.savedDecks = loadSavedDecks();
      screen = 'setup';
      render();
      return;
    }
    if (act === 'dismiss-round-banner') { lastRoundBanner = null; render(); return; }
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
      if (card.cost == null) { sel = null; notice = '「' + card.name + '」はコストが未確定のためプレイできません'; render(); return; }
      if (card.cost > ppLeft) { sel = null; notice = '「' + card.name + '」はPPが足りません（必要 ' + card.cost + ' / 残り ' + ppLeft + '）'; render(); return; }
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
    else if (logOpen) { logOpen = false; render(); }
    else if (sel) { sel = null; render(); }
  });

  render();
})();
