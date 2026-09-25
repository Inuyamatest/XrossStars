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

  function deckFor(side) {
    var s = setup[side];
    if (s.source === 'SAVED' && s.savedIndex != null) return setup.savedDecks[s.savedIndex];
    if (s.source === 'RANDOM') return s.generatedDeck;
    return null;
  }

  function render() {
    root.innerHTML = screen === 'setup' ? renderSetup() : renderBattle();
    bindEvents();
  }

  // ================= セットアップ画面 =================
  function renderSetup() {
    return '' +
      '<div class="bt-notice">対戦台（1台の端末で2人が交互に操作）方式のローカル対戦です。複数対象の選択などが必要な効果は、エンジン側の安全なデフォルト挙動（先頭候補を自動選択、または「してもよい」を辞退）で処理されます。カード効果はdata/cards.jsonの全カードのうち登録済みの一部のみ再現されており、未登録カードはアタックカードなら上乗せダメージ0、それ以外はプレイ時効果なしとして扱われます。</div>' +
      '<div class="bt-setup">' +
        '<div class="bt-setup-players">' +
          renderSetupPanel('playerA', 'プレイヤーA') +
          renderSetupPanel('playerB', 'プレイヤーB') +
        '</div>' +
        '<div class="bt-setup-options">' +
          '<label>モード ' +
            '<select id="opt-mode">' +
              '<option value="STANDARD"' + (setup.mode === 'STANDARD' ? ' selected' : '') + '>スタンダード（2ラウンド先取）</option>' +
              '<option value="QUICK"' + (setup.mode === 'QUICK' ? ' selected' : '') + '>クイック（1ラウンド先取）</option>' +
            '</select>' +
          '</label>' +
          '<label>先攻 ' +
            '<select id="opt-first">' +
              '<option value="playerA"' + (setup.firstPlayer === 'playerA' ? ' selected' : '') + '>プレイヤーA</option>' +
              '<option value="playerB"' + (setup.firstPlayer === 'playerB' ? ' selected' : '') + '>プレイヤーB</option>' +
            '</select>' +
          '</label>' +
          '<button class="bt-btn" data-act="coinflip">じゃんけん代わりにランダムで決める</button>' +
        '</div>' +
        '<div class="bt-start-row"><button class="bt-btn primary" data-act="start" style="min-height:44px;padding:0 28px;font-size:14px">対戦開始</button></div>' +
      '</div>';
  }

  function renderSetupPanel(side, label) {
    var s = setup[side];
    var deck = deckFor(side);
    var savedOptions = setup.savedDecks.map(function (d, i) {
      return '<option value="' + i + '"' + (s.source === 'SAVED' && s.savedIndex === i ? ' selected' : '') + '>' + esc(d.name) + '</option>';
    }).join('');

    var summary = '';
    if (deck) {
      var validation = window.XS_DECK_RULES.validateDeck(deck, CARD_INDEX);
      var leaderCards = (deck.leaders || []).map(function (n) { return CARD_INDEX[n]; }).filter(Boolean);
      summary = '' +
        '<div class="bt-deck-summary">' +
          'リーダー' + leaderCards.length + '/4 ・ デッキ' + (validation.summary.mainCount) + '/50 ・ タクティクス' + (deck.tactics || []).length + '/5' +
          (deck.generated ? ' ・ <span style="color:var(--xs-yellow)">自動生成デッキ</span>' : '') +
        '</div>' +
        '<div class="bt-deck-leaders">' + leaderCards.map(function (c) {
          var img = cardImg(c);
          return img ? '<img src="' + esc(img) + '" alt="' + esc(c.name) + '" title="' + esc(c.name) + '">'
            : '<div style="width:48px;height:67px;background:var(--xs-panel2);border-radius:2px;font-size:8px;color:var(--xs-sub);display:flex;align-items:center;justify-content:center;text-align:center">' + esc(c.name) + '</div>';
        }).join('') + '</div>' +
        (validation.valid ? '' : '<div class="bt-deck-violations">' + validation.violations.map(function (v) { return '❌ ' + esc(v); }).join('<br>') + '</div>') +
        (validation.warnings.length ? '<div class="bt-deck-warnings">' + validation.warnings.map(function (w) { return '⚠ ' + esc(w); }).join('<br>') + '</div>' : '');
    } else {
      summary = '<div class="bt-deck-summary">デッキ未選択</div>';
    }

    return '' +
      '<div class="bt-setup-panel" data-side="' + side + '">' +
        '<h2>' + esc(label) + '</h2>' +
        '<div class="bt-setup-row">' +
          '<select data-act="pick-saved" data-side="' + side + '">' +
            '<option value="">保存済みデッキから選択…</option>' +
            savedOptions +
          '</select>' +
          '<button class="bt-btn" data-act="pick-random" data-side="' + side + '">ランダムデッキで試す</button>' +
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
    screen = 'battle';
    render();
  }

  // ================= 対戦画面 =================
  function renderBattle() {
    var state = game.state;

    if (state.match.status === 'FINISHED') {
      return renderBattleBoard(state, true) + renderMatchEndOverlay(state);
    }
    return renderBattleBoard(state, false) + (lastRoundBanner ? renderRoundEndOverlay(lastRoundBanner) : '');
  }

  function renderBattleBoard(state, readOnly) {
    var activePlayerId = state.turn.activePlayer;
    return '' +
      '<div class="bt-battle">' +
        renderMatchInfo(state) +
        renderSide(state, 'playerA', activePlayerId, readOnly) +
        renderSide(state, 'playerB', activePlayerId, readOnly) +
        '<div>' +
          '<button class="bt-btn" data-act="toggle-log">ログ' + (logOpen ? '▲' : '▼') + '</button>' +
          '<div class="bt-log' + (logOpen ? ' open' : '') + '">' + renderLog(state) + '</div>' +
        '</div>' +
      '</div>' +
      (readOnly ? '' : renderHandBar(state, activePlayerId));
  }

  function renderMatchInfo(state) {
    return '' +
      '<div class="bt-matchinfo">' +
        '<span>ラウンド <b>' + state.match.roundNumber + '</b></span>' +
        '<span>ラウンド勝利数 A:<b>' + state.match.roundWins.playerA + '</b> / B:<b>' + state.match.roundWins.playerB + '</b></span>' +
        '<span>モード <b>' + (state.match.mode === 'QUICK' ? 'クイック' : 'スタンダード') + '</b></span>' +
        '<span class="bt-turn-badge">手番: ' + (state.turn.activePlayer === 'playerA' ? 'プレイヤーA' : 'プレイヤーB') + '（ターン' + state.turn.turnNumber + '）</span>' +
      '</div>';
  }

  function renderSide(state, playerId, activePlayerId, readOnly) {
    var player = state.players[playerId];
    var isActive = playerId === activePlayerId;
    var label = playerId === 'playerA' ? 'プレイヤーA' : 'プレイヤーB';

    return '' +
      '<div class="bt-side' + (isActive ? ' is-active' : '') + '">' +
        '<div class="bt-side-title">' +
          '<b>' + label + (isActive ? '（手番）' : '') + '</b>' +
          '<span>' + renderPpPips(player) + ' PP ' + (player.ppCards.max - player.ppCards.tapped) + '/' + player.ppCards.max +
            ' ・ 山札' + player.deck.length + ' ・ トラッシュ' + player.trash.length + ' ・ 手札' + player.hand.length + '</span>' +
        '</div>' +
        '<div class="bt-leaders">' + player.leaders.map(function (l, i) { return renderLeader(playerId, l, i, isActive, readOnly); }).join('') + '</div>' +
        '<div class="bt-tacticsrow">' + renderTacticsArea(state, playerId, isActive, readOnly) + '</div>' +
        (player.playArea.length ? '<div class="bt-playarea">' + player.playArea.map(function (e) {
          return '<span class="bt-playarea-card">' + esc(cardOf(e.card.cardId).name) + '</span>';
        }).join('') + '</div>' : '') +
      '</div>';
  }

  function renderPpPips(player) {
    var html = '<span class="bt-pp-pips">';
    for (var i = 0; i < player.ppCards.max; i++) {
      html += '<span class="bt-pp-pip' + (i < (player.ppCards.max - player.ppCards.tapped) ? ' filled' : '') + '"></span>';
    }
    return html + '</span>';
  }

  function renderLeader(playerId, leader, idx, isActive, readOnly) {
    var card = cardOf(leader.cardId);
    var maxHp = Eng.GameState.getLeaderMaxHp(cardIndex, leader);
    var curHp = Eng.GameState.getLeaderCurrentHp(cardIndex, leader);
    var atk = Eng.GameState.getLeaderCurrentAtk(cardIndex, leader);
    var img = cardImg(card, leader.awakened);
    var pct = maxHp > 0 ? Math.max(0, Math.min(100, Math.round(curHp / maxHp * 100))) : 0;

    var pickable = false, picked = false;
    if (!readOnly && sel) {
      if (sel.mode === 'PICK_ATTACKER' && playerId === sel.ownerId) {
        pickable = !leader.isDown;
        picked = sel.attackerLeaderIndex === idx;
      } else if (sel.mode === 'PICK_TARGET' && playerId === opponentOf(sel.ownerId)) {
        pickable = !leader.isDown;
        picked = sel.targetLeaderIndex === idx;
      } else if (sel.mode === 'PICK_EQUIP_LEADER' && playerId === sel.ownerId) {
        pickable = true;
      }
    }

    return '' +
      '<div class="bt-leader' + (leader.isDown ? ' down' : '') + (pickable ? ' pickable' : '') + (picked ? ' picked' : '') + '"' +
        (pickable ? ' data-act="pick-leader" data-player="' + playerId + '" data-index="' + idx + '"' : '') + '>' +
        (img ? '<img src="' + esc(img) + '" alt="">' : '<div class="bt-leader-noimg">' + esc(card.name) + '</div>') +
        '<div class="bt-leader-name">' + esc(card.name) + (leader.awakened ? ' ★覚醒' : '') + '</div>' +
        '<div class="bt-hpbar"><div class="bt-hpfill" style="width:' + pct + '%"></div></div>' +
        '<div class="bt-leader-stats">HP ' + curHp + '/' + maxHp + ' ・ ATK ' + atk + '</div>' +
        (leader.equipment.length ? '<div class="bt-equip">装備: ' + leader.equipment.map(function (eq) { return esc(cardOf(eq.cardId).name); }).join('、') + '</div>' : '') +
        (leader.isDown ? '<div class="bt-down-badge">DOWN</div>' : '') +
      '</div>';
  }

  function renderTacticsArea(state, playerId, isActive, readOnly) {
    var player = state.players[playerId];
    if (player.tacticsArea.length === 0) return '<span>タクティクスエリア: なし</span>';
    var canPlay = !readOnly && isActive && Eng.Phases.canPlayTactics(state);
    return player.tacticsArea.map(function (t) {
      var card = cardOf(t.card.cardId);
      var equip = isEquipmentCard(t.card.cardId);
      var disabled = readOnly || !isActive || !canPlay;
      return '' +
        '<div class="bt-tacticscard">' +
          '<span>' + esc(card.name) + (card.cost != null ? '（C' + card.cost + '）' : '') + (equip ? ' [装備]' : ' [消費]') + '</span>' +
          '<button data-act="play-tactics" data-instance="' + esc(t.card.instanceId) + '" data-equip="' + (equip ? 1 : 0) + '"' + (disabled ? ' disabled' : '') + '>プレイ</button>' +
        '</div>';
    }).join('');
  }

  function renderHandBar(state, activePlayerId) {
    var player = state.players[activePlayerId];
    var pp = player.ppCards.max - player.ppCards.tapped;

    var handHtml = player.hand.map(function (c) {
      var card = cardOf(c.cardId);
      var img = cardImg(card);
      // コスト未確定（null）のカードは「(card.cost || 0)」だとコスト0として常にプレイ可能表示に
      // なってしまう（エンジン側のPP不具合と同じ原因）。コスト不明の間はプレイ不可として表示する。
      var affordable = card.cost != null && card.cost <= pp;
      var isSel = sel && sel.cardInstanceId === c.instanceId;
      return '' +
        '<div class="bt-handcard' + (isSel ? ' selected' : '') + (affordable ? '' : ' unplayable') + '" data-act="select-hand" data-instance="' + esc(c.instanceId) + '">' +
          (img ? '<img src="' + esc(img) + '" alt="">' : '<div class="bt-card-noimg">' + esc(card.name) + '</div>') +
          '<div class="bt-handcard-meta">' + esc(card.name) + '　C' + (card.cost != null ? card.cost : '?') + ' ・ ' + (TYPE_JA[card.cardType] || card.cardType) + '</div>' +
        '</div>';
    }).join('');

    return '' +
      '<div class="bt-handbar">' +
        '<div class="bt-actionbar">' + renderActionBar(state, activePlayerId) + '</div>' +
        '<div class="bt-hand">' + (handHtml || '<span style="color:var(--xs-sub);font-size:12px">手札がありません</span>') + '</div>' +
      '</div>';
  }

  function renderActionBar(state, activePlayerId) {
    var html = '';
    if (sel && sel.kind === 'ATTACK') {
      var card = cardOf(sel.cardId);
      html += '<b>' + esc(card.name) + '</b>（アタック）を使用中: ';
      if (sel.mode === 'PICK_ATTACKER') html += 'アタッカーにするリーダーを選んでください';
      else if (sel.mode === 'PICK_TARGET') html += 'アタック対象（相手リーダー）を選んでください';
      else if (sel.mode === 'READY') {
        html += 'アタッカー: ' + esc(cardOf(state.players[sel.ownerId].leaders[sel.attackerLeaderIndex].cardId).name) +
          ' → 対象: ' + esc(cardOf(state.players[opponentOf(sel.ownerId)].leaders[sel.targetLeaderIndex].cardId).name) +
          ' <button class="bt-btn primary" data-act="confirm-attack">このカードでアタック</button>';
      }
      html += ' <button class="bt-btn" data-act="cancel-select">キャンセル</button>';
    } else if (sel && sel.kind === 'MEMORIA') {
      var mcard = cardOf(sel.cardId);
      html += '<b>' + esc(mcard.name) + '</b>（メモリア）をプレイします ' +
        '<button class="bt-btn primary" data-act="confirm-memoria">プレイする</button>' +
        '<button class="bt-btn" data-act="cancel-select">キャンセル</button>';
    } else if (sel && sel.mode === 'PICK_EQUIP_LEADER') {
      html += '装備先のリーダーを選んでください <button class="bt-btn" data-act="cancel-select">キャンセル</button>';
    } else {
      html += '手札のカードを選択してください';
    }
    html += ' <button class="bt-btn danger" data-act="end-turn" style="margin-left:auto">ターン終了</button>';
    return html;
  }

  var EVENT_JA = {
    GAME_STARTED: '対戦開始', MATCH_SETUP_COMPLETED: 'マッチ準備完了', ROUND_STARTED: 'ラウンド開始',
    TURN_STARTED: 'ターン開始', CARD_DRAWN: 'カードを引いた', CARD_PLAYED: 'アタックカードをプレイ',
    MEMORIA_PLAYED: 'メモリアカードをプレイ', TACTICS_PLAYED: 'タクティクスカードをプレイ',
    EQUIPMENT_ATTACHED: '装備した', DAMAGE_DEALT: 'ダメージ', LEADER_DOWNED: 'ダウン',
    LEADER_AWAKENED: '覚醒', ROUND_ENDED: 'ラウンド終了', MATCH_ENDED: 'マッチ終了',
    TURN_ENDED: 'ターン終了', DECK_OUT_LOSS: 'デッキ切れ敗北',
  };
  function renderLog(state) {
    var entries = state.actionLog.slice(-60).reverse();
    return entries.map(function (e) {
      var label = EVENT_JA[e.type] || e.type;
      var extra = JSON.stringify(e.payload || {});
      return '<div>R' + e.roundNumber + 'T' + e.turnNumber + ' ・ ' + esc(label) + ' ' + esc(extra) + '</div>';
    }).join('');
  }

  function renderRoundEndOverlay(banner) {
    return '' +
      '<div class="bt-overlay">' +
        '<div class="bt-overlay-box">' +
          '<h2>ラウンド終了</h2>' +
          '<p>' + esc(banner) + '</p>' +
          '<button class="bt-btn primary" data-act="dismiss-round-banner">次のラウンドへ</button>' +
        '</div>' +
      '</div>';
  }

  function renderMatchEndOverlay(state) {
    var text = state.match.winner === 'DRAW' ? '両者同時敗北による引き分けです。' :
      (state.match.winner === 'playerA' ? 'プレイヤーAの勝利です！' : 'プレイヤーBの勝利です！');
    return '' +
      '<div class="bt-overlay">' +
        '<div class="bt-overlay-box">' +
          '<h2>試合終了</h2>' +
          '<p>' + esc(text) + '</p>' +
          '<button class="bt-btn primary" data-act="back-to-setup">セットアップ画面に戻る</button>' +
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
    try {
      Eng.Resolver.playAttackCardWithEffects(state, playerId, sel.cardInstanceId, {
        attackerLeaderIndex: sel.attackerLeaderIndex,
        targetPlayerId: opponentOf(playerId),
        targetLeaderIndex: sel.targetLeaderIndex,
      }, cardIndex);
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
      el.addEventListener('click', function () { handleAction(el.getAttribute('data-act'), el); });
    });
    var modeSel = document.getElementById('opt-mode');
    if (modeSel) modeSel.addEventListener('change', function (e) { setup.mode = e.target.value; });
    var firstSel = document.getElementById('opt-first');
    if (firstSel) firstSel.addEventListener('change', function (e) { setup.firstPlayer = e.target.value; });
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
    if (act === 'pick-random') {
      var side = el.getAttribute('data-side');
      setup[side].source = 'RANDOM';
      setup[side].generatedDeck = buildRandomDeck((side === 'playerA' ? 'プレイヤーA' : 'プレイヤーB') + '・ランダム');
      render();
      return;
    }
    if (act === 'coinflip') {
      setup.firstPlayer = Math.random() < 0.5 ? 'playerA' : 'playerB';
      render();
      return;
    }
    if (act === 'start') { startMatch(); return; }

    if (act === 'toggle-log') { logOpen = !logOpen; render(); return; }
    if (act === 'back-to-setup') {
      game = null; sel = null; lastRoundBanner = null;
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
      var handCard = state.players[playerId].hand.find(function (c) { return c.instanceId === instanceId; });
      if (!handCard) return;
      var card = cardOf(handCard.cardId);
      if (card.cardType === 'ATTACK') {
        sel = { kind: 'ATTACK', ownerId: playerId, cardInstanceId: instanceId, cardId: handCard.cardId, mode: 'PICK_ATTACKER', attackerLeaderIndex: null, targetLeaderIndex: null };
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
      if (sel.mode === 'PICK_ATTACKER' && pPlayer === sel.ownerId) {
        sel.attackerLeaderIndex = pIdx;
        sel.mode = 'PICK_TARGET';
      } else if (sel.mode === 'PICK_TARGET' && pPlayer === opponentOf(sel.ownerId)) {
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

  render();
})();
