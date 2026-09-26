/* Xross Stars ゲームエンジン — カード効果レジストリ（Phase B：代表カードのみ）
 *
 * data/cards.json / js/data/leaders.js は一切変更しない。
 * ここは「カードID → CardEffect[]」の対応表を手動で追加していく場所
 * （js/data/effects.js の設計思想を踏襲。カードテキストの自動解析はしない）。
 *
 * 実装済みは代表カードのみ（Phase B）。600枚以上を一気に実装しない方針。
 * 各エントリには、根拠となる実際のカードテキスト（data/cards.json / js/data/leaders.js より）を
 * コメントで残す。存在しない効果を推測して追加しない。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./cardEffect.js'), require('./effectFactories.js'), require('./parallelAliases.js'));
  } else {
    root.XS_ENGINE_CARD_EFFECT_DATA = factory(root.XS_ENGINE_CARD_EFFECT, root.XS_ENGINE_EFFECT_FACTORIES, root.XS_ENGINE_PARALLEL_ALIASES);
  }
}(typeof self !== 'undefined' ? self : this, function (CardEffectCore, EffectFactories, ParallelAliases) {
  'use strict';

  var E = CardEffectCore.createCardEffect;
  // Phase D-2: Condition/Targetファクトリ（effectFactories.js。effectResolver.jsとの循環依存を避けるため
  // cardEffectData.jsはeffectFactories.jsを直接requireする。詳細はeffectFactories.jsのコメント参照）
  var F = EffectFactories;

  var REGISTRY = {

    // BP01-058 危機一髪（メモリア, 赤, cost1, buildRule: リーダー：Selly）
    // カードテキスト: "〖プレイ時〗カードを2枚引く。"
    'BP01-058': [
      E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 2 } }),
    ],

    // BP01-019 インパクトショット（アタック, 赤, cost2）
    // カードテキスト: "〖アタックする〗ダメージ+40。"
    // このカード自身のアタックダメージへの上乗せなので ATTACK_DAMAGE_BONUS として表現する
    // （combat.jsの declareAttack が要求する attackCardBaseDamage を、この値から導出する）
    'BP01-019': [
      E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 40 } }),
    ],

    // BP01-095 ライトシールド（タクティクス, 無色, cost0, 装備）
    // カードテキスト: "体力+30"（Playing Manual p.10 の装備例そのもの）
    'BP01-095': [
      E({ trigger: 'ON_PLAY', duration: 'PERMANENT', action: { type: 'EQUIP_HP_MODIFIER', amount: 30 } }),
    ],

    // BP01-021 ギャングの襲撃（アタック, 赤, cost1, buildRule: リーダー：小森めと）
    // カードテキスト: "〖アタックする〗 〖アタック後〗このアタックを受けたリーダーがダウンしているなら、カードを1枚引く。"
    'BP01-021': [
      E({
        trigger: 'AFTER_ATTACK',
        condition: function (state, ctx) {
          return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown;
        },
        action: { type: 'DRAW', amount: 1 },
      }),
    ],

    // BP01-053 超新星（メモリア, 赤, cost2, ACE）※公式FAQ Q6 の実例カード
    // カードテキスト: "〖アタック強化〗次のアタックのダメージ+30。
    //                  〖アタック後〗このアタックを受けたリーダーがダウンしているなら、PPを2回復し、カードを1枚引く。"
    'BP01-053': [
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } }),
      E({
        trigger: 'AFTER_ATTACK',
        condition: function (state, ctx) {
          return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown;
        },
        action: { type: 'MULTI', actions: [{ type: 'RECOVER_PP', amount: 2 }, { type: 'DRAW', amount: 1 }] },
      }),
    ],

    // BP01-018 エレガントドミネート（アタック, 赤, cost1, buildRule: 赤のリーダー3体以上）
    // カードテキスト: "〖アタックする〗 〖アタック後〗対戦相手の他のリーダー1体に20ダメージ。"
    'BP01-018': [
      E({
        trigger: 'AFTER_ATTACK',
        target: function (state, ctx) {
          var opponent = state.players[ctx.targetPlayerId];
          var candidates = [];
          opponent.leaders.forEach(function (l, i) {
            if (i !== ctx.targetLeaderIndex && !l.isDown) candidates.push({ playerId: ctx.targetPlayerId, leaderIndex: i });
          });
          if (candidates.length === 0) return []; // No-op（FAQ Q8）
          var pick = (ctx.chooseTarget ? ctx.chooseTarget(candidates, state) : 0);
          if (pick < 0 || pick >= candidates.length) pick = 0;
          return [candidates[pick]];
        },
        action: { type: 'DAMAGE', amount: 20 },
      }),
    ],

    // --- リーダー覚醒時効果（js/data/leaders.js のawakeningEffectに対応する代表例）---
    // Mondo（id: bp01-mondo, cardNumber: ST02-002）
    // awakeningEffect: "自分のリーダー1体を20回復する。"（Playing Manual p.08 の実例そのもの）
    'ST02-002': [
      E({
        trigger: 'ON_AWAKEN',
        target: function (state, ctx) {
          var self = state.players[ctx.ownerPlayerId];
          var candidates = [];
          self.leaders.forEach(function (l, i) { if (!l.isDown) candidates.push({ playerId: ctx.ownerPlayerId, leaderIndex: i }); });
          if (candidates.length === 0) return [];
          var pick = (ctx.chooseTarget ? ctx.chooseTarget(candidates, state) : candidates.findIndex(function (c) { return c.leaderIndex === ctx.attackerLeaderIndex; }));
          if (pick < 0) pick = 0;
          return [candidates[pick]];
        },
        action: { type: 'HEAL', amount: 20 },
      }),
    ],

    // ============================================================
    // Phase D-1: DISCARD_HAND / EQUIP_ATK_MODIFIER
    // 「手札を…捨てる」を含む全24枚を実テキストで確認した上で登録する（機械的な一括登録はしない）。
    // 誰がどのカードを選ぶか・手札不足時の扱いはruleConfig.cardEffectDiscardChoice（PROVISIONAL）参照。
    // ============================================================

    // --- リーダー覚醒時「カードを2枚引き、手札を2枚捨てる。」（13枚, 全文言一致） ---
    // 橘ひなの/白雪レイド/ごっちゃん@マイキー/空澄セナ/立川/Shuto/天鬼ぷるる/
    // 緋月ゆい/平岩康佑/絲依とい/夢野あかり/龍巻ちせ/銀城サイネ
    'BP01-003': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],
    'BP01-007': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],
    'BP01-010': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],
    'BP01-013': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],
    'BP02-003': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],
    'BP02-007': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],
    'BP02-013': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],
    'BP03-003': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],
    'BP03-008': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],
    'BP03-013': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],
    'BP04-003': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],
    'BP04-011': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],
    'BP04-014': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })],

    // BP01-063 苦難の昇格（メモリア, 青, cost1）
    // カードテキスト: "〖プレイ時〗カードを2枚引き、手札を2枚捨てる。 〖アタック強化〗次のアタックのダメージ+30。"
    'BP01-063': [
      E({ trigger: 'ON_PLAY', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } }),
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } }),
    ],

    // --- アタック後「カードを1枚引き、手札を1枚捨てる。」（無条件, 5枚） ---
    // リスキーエントリー(BP01-028/ST01-006 同名別印刷) / ダイナミック薪割り / マシンガントーク / 過激ないたずら
    'BP01-028': [E({ trigger: 'AFTER_ATTACK', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 1 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 1 }] } })],
    'ST01-006': [E({ trigger: 'AFTER_ATTACK', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 1 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 1 }] } })],
    'BP02-033': [E({ trigger: 'AFTER_ATTACK', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 1 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 1 }] } })],
    'BP02-040': [E({ trigger: 'AFTER_ATTACK', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 1 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 1 }] } })],
    'ST02-006': [E({ trigger: 'AFTER_ATTACK', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 1 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 1 }] } })],

    // BP01-093 ジャミングパルス（タクティクス, 無色, cost1）
    // カードテキスト: "〖プレイ時〗対戦相手は手札を2枚捨てる。"（無条件、DISCARD_HANDの代表カード）
    'BP01-093': [E({ trigger: 'ON_PLAY', action: { type: 'DISCARD_HAND', who: 'OPPONENT', amount: 2 } })],

    // BP01-033 ブリッツブラスト（アタック, 青, cost1, buildRule: リーダー：白雪レイド）
    // カードテキスト: "〖アタックする〗 〖アタック後〗このアタックを受けたリーダーがダウンしているなら、対戦相手は手札を1枚捨てる。"
    'BP01-033': [
      E({
        trigger: 'AFTER_ATTACK',
        condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; },
        action: { type: 'DISCARD_HAND', who: 'OPPONENT', amount: 1 },
      }),
    ],

    // BP02-042 大将の威厳（アタック, 緑, cost1, buildRule: リーダー：どぐら）
    // カードテキスト: "〖アタックする〗 〖アタック後〗このアタックを受けたリーダーがダウンしているなら、対戦相手は手札を1枚捨てる。"
    'BP02-042': [
      E({
        trigger: 'AFTER_ATTACK',
        condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; },
        action: { type: 'DISCARD_HAND', who: 'OPPONENT', amount: 1 },
      }),
    ],

    // BP03-038 強奪の宴（アタック, 緑, cost1）
    // カードテキスト: "〖アタックする〗 〖アタック後〗このアタックを受けたリーダーがダウンしているなら、
    //                  カードを1枚引き、対戦相手は手札を1枚捨てる。"（自分ドロー＋相手ディスカードの複合）
    'BP03-038': [
      E({
        trigger: 'AFTER_ATTACK',
        condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; },
        action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 1 }, { type: 'DISCARD_HAND', who: 'OPPONENT', amount: 1 }] },
      }),
    ],

    // BP01-032 ドリル開錠（アタック, 青, cost1, buildRule: リーダー：渋谷ハル）
    // カードテキスト: "〖アタックする〗 〖アタック後〗すべてのプレイヤーは手札を1枚捨てる。"（無条件、全員対象）
    'BP01-032': [E({ trigger: 'AFTER_ATTACK', action: { type: 'DISCARD_HAND', who: 'ALL', amount: 1 } })],

    // BP02-080 メリケンサック（タクティクス, 無色, cost1, 装備）
    // カードテキスト: "攻撃力+10"（ライトシールドの"体力+30"と同じ文体＝装備の受動効果。EQUIP_ATK_MODIFIERの代表カード）
    'BP02-080': [
      E({ trigger: 'ON_PLAY', duration: 'PERMANENT', action: { type: 'EQUIP_ATK_MODIFIER', amount: 10 } }),
    ],

    // ============================================================
    // Phase D-2: PLAY_AREA_TYPE_COUNT / SAME_COLOR_AS / OVERKILL_AMOUNT
    // 該当カードのテキストを個別に確認し、単一条件・単一Actionで正確に表現できるものだけ登録する。
    // 「アタック強化」の段階的加算・カウントタイミング注記付きのカード（BP01-056/075/077/069,
    // BP02-058）はPROVISIONALとして見送る（最終報告に一覧化）。
    // （BP02-038オールスターコンボは、Phase Eで条件付きON_ATTACKボーナス機構を追加した際に
    //  実カードテキストを確認のうえ別途登録済み。本コメント作成時点では未確認のため誤って含めていた）
    // ============================================================

    // --- PLAY_AREA_TYPE_COUNT: 自分の場にメモリアが2枚以上→対戦相手の他のリーダー1体に20ダメージ ---
    // ウォールブレイカー/いたずらドローン/うっかりアッパー/ベテランの意地/スペシャルコントラクト
    'BP01-042': [E({
      trigger: 'AFTER_ATTACK',
      condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }),
      target: F.makeSingleOtherOpponentLeaderTarget(),
      action: { type: 'DAMAGE', amount: 20 },
    })],
    'BP01-047': [E({
      trigger: 'AFTER_ATTACK',
      condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }),
      target: F.makeSingleOtherOpponentLeaderTarget(),
      action: { type: 'DAMAGE', amount: 20 },
    })],
    'BP02-021': [E({
      trigger: 'AFTER_ATTACK',
      condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }),
      target: F.makeSingleOtherOpponentLeaderTarget(),
      action: { type: 'DAMAGE', amount: 20 },
    })],
    'BP02-037': [E({
      trigger: 'AFTER_ATTACK',
      condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }),
      target: F.makeSingleOtherOpponentLeaderTarget(),
      action: { type: 'DAMAGE', amount: 20 },
    })],
    'BP03-043': [E({
      trigger: 'AFTER_ATTACK',
      condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }),
      target: F.makeSingleOtherOpponentLeaderTarget(),
      action: { type: 'DAMAGE', amount: 20 },
    })],

    // --- PLAY_AREA_TYPE_COUNT: 自分の場にメモリアが2枚以上→対戦相手の他のリーダーすべてに10ダメージ ---
    // ハイグラバースト/逆境の1ドット/ヘヴィーインパクト/ブラインドショット/ツーマンセル/オーバーグラビティ
    'BP01-024': [E({
      trigger: 'AFTER_ATTACK',
      condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }),
      target: F.makeAllOtherOpponentLeadersTarget(),
      action: { type: 'DAMAGE', amount: 10 },
    })],
    'BP02-028': [E({
      trigger: 'AFTER_ATTACK',
      condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }),
      target: F.makeAllOtherOpponentLeadersTarget(),
      action: { type: 'DAMAGE', amount: 10 },
    })],
    'BP02-034': [E({
      trigger: 'AFTER_ATTACK',
      condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }),
      target: F.makeAllOtherOpponentLeadersTarget(),
      action: { type: 'DAMAGE', amount: 10 },
    })],
    'ST01-012': [E({
      trigger: 'AFTER_ATTACK',
      condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }),
      target: F.makeAllOtherOpponentLeadersTarget(),
      action: { type: 'DAMAGE', amount: 10 },
    })],
    'BP03-034': [E({
      trigger: 'AFTER_ATTACK',
      condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }),
      target: F.makeAllOtherOpponentLeadersTarget(),
      action: { type: 'DAMAGE', amount: 10 },
    })],
    'BP04-043': [E({
      trigger: 'AFTER_ATTACK',
      condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }),
      target: F.makeAllOtherOpponentLeadersTarget(),
      action: { type: 'DAMAGE', amount: 10 },
    })],

    // --- SAME_COLOR_AS ---
    // BP02-039 ポイズンボム（アタック, 緑, cost2）
    // カードテキスト: "〖アタックする〗 〖アタック後〗このアタックを受けたリーダーと同じ色を持つ
    //                  対戦相手の他のリーダーすべてに40ダメージ。"
    'BP02-039': [E({
      trigger: 'AFTER_ATTACK',
      target: F.makeSameColorAsAttackedLeaderTarget(),
      action: { type: 'DAMAGE', amount: 40 },
    })],

    // --- OVERKILL_AMOUNT ---
    // カードテキストの「オーバーキルN：〜」の定義自体はPROVISIONAL（ruleConfig.js参照）。
    'BP01-029': [E({ // うるパーンチッ！：オーバーキル30→対戦相手の他のリーダー1体に50ダメージ
      trigger: 'AFTER_ATTACK',
      condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 30 }),
      target: F.makeSingleOtherOpponentLeaderTarget(),
      action: { type: 'DAMAGE', amount: 50 },
    })],
    'BP02-017': [E({ // ビクトリーランページ：オーバーキル40→対戦相手の他のリーダー1体に90ダメージ
      trigger: 'AFTER_ATTACK',
      condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 40 }),
      target: F.makeSingleOtherOpponentLeaderTarget(),
      action: { type: 'DAMAGE', amount: 90 },
    })],
    'BP01-039': [E({ // アジト急襲：オーバーキル30→PPを1回復する
      trigger: 'AFTER_ATTACK',
      condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 30 }),
      action: { type: 'RECOVER_PP', amount: 1 },
    })],
    'BP01-052': [E({ // スタンプキル：オーバーキル30→PPを1回復する
      trigger: 'AFTER_ATTACK',
      condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 30 }),
      action: { type: 'RECOVER_PP', amount: 1 },
    })],
    'BP02-035': [E({ // デッドリーキャンプ：オーバーキル20→PPを1回復する
      trigger: 'AFTER_ATTACK',
      condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 20 }),
      action: { type: 'RECOVER_PP', amount: 1 },
    })],
    'BP03-042': [E({ // ブリーチングフォース：オーバーキル20→PPを1回復する
      trigger: 'AFTER_ATTACK',
      condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 20 }),
      action: { type: 'RECOVER_PP', amount: 1 },
    })],
    'BP02-020': [E({ // 猪突猛進：オーバーキル30→カードを2枚引く
      trigger: 'AFTER_ATTACK',
      condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 30 }),
      action: { type: 'DRAW', amount: 2 },
    })],
    'BP04-041': [E({ // アースサーファー：オーバーキル30→カードを2枚引く
      trigger: 'AFTER_ATTACK',
      condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 30 }),
      action: { type: 'DRAW', amount: 2 },
    })],
    'BP02-025': [E({ // ヘンディーブロー：オーバーキル20→自分のリーダー1体を30回復する
      trigger: 'AFTER_ATTACK',
      condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 20 }),
      target: F.makeOwnAliveLeaderTarget(),
      action: { type: 'HEAL', amount: 30 },
    })],
    'BP03-039': [E({ // 逆転の一矢：オーバーキル20→自分のリーダー1体を30回復する
      trigger: 'AFTER_ATTACK',
      condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 20 }),
      target: F.makeOwnAliveLeaderTarget(),
      action: { type: 'HEAL', amount: 30 },
    })],

    // ============================================================
    // Phase D-3A: EQUIP_GRANT_ABILITY
    // 該当4枚中3枚を登録。BP02-077オートタレットは「このアタックの〖アタック後〗効果でダメージを
    // 与えているなら」という、他の効果の解決結果を参照するメタ条件を持ち、既存エンジンにはこれを
    // 正確に表現する仕組みが無いため、推測を避けてUNVERIFIEDとして見送る（最終報告に記載）。
    // ============================================================

    // BP02-078 盗賊キット（タクティクス, 無色, cost0, 装備）
    // カードテキスト: "これを装備しているリーダーは以下の能力を持つ。
    //                  「〖アタック後〗このアタックを受けたリーダーがダウンしているなら、
    //                    カードを1枚引く。この効果はターンに1回しか発動しない。」"
    'BP02-078': [E({
      trigger: 'ON_PLAY',
      duration: 'PERMANENT',
      action: {
        type: 'EQUIP_GRANT_ABILITY',
        ability: {
          trigger: 'AFTER_ATTACK',
          condition: F.makeOncePerTurnCondition(function (state, ctx) {
            return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown;
          }),
          action: { type: 'DRAW', amount: 1 },
        },
      },
    })],

    // BP04-075 盗賊キット（BP02-078と同一効果の再録。カードテキストは全角/半角ブラケットの
    // 表記揺れのみで意味は同一のため、同じ付与能力として登録する）
    'BP04-075': [E({
      trigger: 'ON_PLAY',
      duration: 'PERMANENT',
      action: {
        type: 'EQUIP_GRANT_ABILITY',
        ability: {
          trigger: 'AFTER_ATTACK',
          condition: F.makeOncePerTurnCondition(function (state, ctx) {
            return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown;
          }),
          action: { type: 'DRAW', amount: 1 },
        },
      },
    })],

    // BP02-079 ヒーリングオーブ（タクティクス, 無色, cost0, 装備）
    // カードテキスト: "〖プレイ時〗自分のリーダー1体を60回復する。
    //                  これを装備しているリーダーは以下の能力を持つ。
    //                  「〖アタック後〗自分のリーダー1体を20回復する。この効果はターンに1回しか発動しない。」"
    // プレイ時の60回復は付与能力ではない通常のON_PLAY効果として別entryに登録する。
    'BP02-079': [
      E({ trigger: 'ON_PLAY', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 60 } }),
      E({
        trigger: 'ON_PLAY',
        duration: 'PERMANENT',
        action: {
          type: 'EQUIP_GRANT_ABILITY',
          ability: {
            trigger: 'AFTER_ATTACK',
            condition: F.makeOncePerTurnCondition(),
            target: F.makeOwnAliveLeaderTarget(),
            action: { type: 'HEAL', amount: 20 },
          },
        },
      }),
    ],

    // ============================================================
    // Phase D-3: MOVE_EQUIPMENT / TEMP_ATK_MODIFIER / DISTRIBUTED_HEAL / DERIVED_AMOUNT
    // ============================================================

    // BP03-045 メカニカルエキスパート（メモリア, 赤, cost0, ACE）
    // カードテキスト: "〖プレイ時〗自分のリーダーが装備しているカード1枚を、別の自分のリーダーに
    //                  装備し直してもよい。〖アタック強化〗次のアタックのダメージ+30。"
    'BP03-045': [
      E({ trigger: 'ON_PLAY', action: { type: 'MOVE_EQUIPMENT' } }),
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } }),
    ],

    // BP01-071 先導者の証（メモリア, 黄, cost1, ACE）
    // カードテキスト: "〖プレイ時〗このターン、自分のリーダーすべての攻撃力を+30する。"
    'BP01-071': [
      E({ trigger: 'ON_PLAY', target: F.makeAllOwnAliveLeadersTarget(), action: { type: 'TEMP_ATK_MODIFIER', amount: 30 } }),
    ],

    // ST01-021 / ST02-021 救急キット（タクティクス, 無色, cost0, 同一効果の別印刷）
    // カードテキスト: "〖プレイ時〗自分のリーダーを合計80回復する。（複数のリーダーを選んでもよい。）"
    'ST01-021': [E({ trigger: 'ON_PLAY', action: { type: 'DISTRIBUTED_HEAL', total: 80 } })],
    'ST02-021': [E({ trigger: 'ON_PLAY', action: { type: 'DISTRIBUTED_HEAL', total: 80 } })],

    // BP02-076 ドレインロッド（タクティクス, 無色, cost0）
    // カードテキスト: "[プレイ時]自分のリーダーを合計40回復する。（複数のリーダーを選んでもよい。）
    //                  対戦相手のリーダー1体に、このカードの効果で回復した数値と同じダメージ。"
    // 注意：このカードはdata/cards.json内でconfirmStatus:"要確認"・confirmed:falseであり、
    //       他の確定カードと異なりテキスト自体の公式確認が完了していない
    //       （ruleConfig.js の unconfirmedCardData 参照。テキストは変更せずそのまま実装する）。
    'BP02-076': [
      E({
        trigger: 'ON_PLAY',
        target: F.makeAnyOpponentLeaderTarget(), // MULTI内のDAMAGEステップが使う対象（回復対象は内部で別途解決）
        action: {
          type: 'MULTI',
          actions: [
            { type: 'DISTRIBUTED_HEAL', total: 40 },
            { type: 'DAMAGE', amount: { type: 'DERIVED_AMOUNT', source: 'LAST_DISTRIBUTED_HEAL_TOTAL' } },
          ],
        },
      }),
    ],

    // AN01-012 超新星（1st Anniv.版, メモリア, 赤, cost2, ACE）
    // カードテキスト: BP01-053「超新星」と同名・同効果のリプリント（画像で確認、公式ページ未確認）。
    // "〖アタック強化〗次のアタックのダメージ+30。〖アタック後〗このアタックを受けたリーダーが
    //  ダウンしているなら、PPを2回復し、カードを1枚引く。"
    // エンジンはcardId（=cardNumber）単位で効果を登録するため、印刷が別でも同じ効果である以上
    // BP01-053の登録内容をそのまま複製する（新しい効果を作らない）。
    'AN01-012': [
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } }),
      E({
        trigger: 'AFTER_ATTACK',
        condition: function (state, ctx) {
          return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown;
        },
        action: { type: 'MULTI', actions: [{ type: 'RECOVER_PP', amount: 2 }, { type: 'DRAW', amount: 1 }] },
      }),
    ],

    // BP04-017 慈悲の刃（アタック, 赤, cost3, ACE）
    // カードテキスト（画像で確認、公式ページのカード詳細は未確認）:
    // "〖プレイ時〗自分のデッキの上から5枚を見る。それらのカードをトラッシュに置く。〖アタックする〗ダメージ+120"
    // 注意：プレイ時の「デッキの上から5枚を見てトラッシュに置く」（マルツ/デッキルック系）効果に対応する
    // Action typeが現行のeffectResolver.jsに存在しない（過去のPhaseで明示的に対象外とされたMILL/DECK_LOOK系）ため、
    // 今回はアタック時のダメージ+120のみを登録する。プレイ時効果は未実装（推測で実装しない）。
    'BP04-017': [
      E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 120 } }),
    ],

    // BP04-024 オーバードライブ（アタック, 青, cost1, ACE）— 未実装（登録しない）
    // カードテキスト: "〖アタックする〗自分の手札のカードを最大2枚公開する。それらのカードを捨てる。
    //  捨てたアタックカード1枚につき、ダメージ+30。捨てたメモリアカード1枚につき、カードを2枚引く。"
    // 「手札から最大2枚を選んで公開・破棄し、破棄したカードの種類ごとに異なる効果量を計算する」という
    // 仕組みは、既存のDISCARD_HAND（枚数指定のみ・種類別カウント無し）やATTACK_DAMAGE_BONUS（固定値のみ）
    // では表現できない。新しいAction type設計が必要なため、推測で実装せず今回は見送る。

    // BP04-038 アナイアレーション（アタック, 緑, cost2）
    // カードテキスト: "〖アタックする〗自分のリーダーの色がすべて異なるなら、ダメージ+30。
    //  〖アタック後〗自分のリーダーの色がすべて異なるなら、対戦相手の他のリーダー1体に30ダメージ、
    //  自分のリーダー1体を30回復し、カードを1枚引く。"
    // Phase E: 条件付きON_ATTACKボーナス機構＋makeAllLeadersDifferentColorsConditionを新設して対応。
    // AFTER_ATTACKは対象が「対戦相手の他のリーダー」（DAMAGE）と「自分のリーダー」（HEAL+DRAW）で
    // 異なるため、ドレインロッド（BP02-076）と同じ理由でMULTIにまとめず2つの登録に分ける。
    'BP04-038': [
      E({ trigger: 'ON_ATTACK', condition: F.makeAllLeadersDifferentColorsCondition(), action: { type: 'ATTACK_DAMAGE_BONUS', amount: 30 } }),
      E({
        trigger: 'AFTER_ATTACK',
        condition: F.makeAllLeadersDifferentColorsCondition(),
        target: F.makeSingleOtherOpponentLeaderTarget(),
        action: { type: 'DAMAGE', amount: 30 },
      }),
      E({
        trigger: 'AFTER_ATTACK',
        condition: F.makeAllLeadersDifferentColorsCondition(),
        target: F.makeOwnAliveLeaderTarget(),
        action: { type: 'MULTI', actions: [{ type: 'HEAL', amount: 30 }, { type: 'DRAW', amount: 1 }] },
      }),
    ],

    // AN01-008 ラストスタンド（アタック, 青, cost0, ACE）
    // カードテキスト: 画像で確認済み。「アタックする」以外の追加テキストなし（バニラのアタックカード）。
    // 追加効果が無いため、cardEffectData.jsへの登録は不要（未登録＝上乗せダメージ0のアタックカードとして扱われる）。

    // ============================================================
    // ACEカード バッチ2（画像37枚で送付分）。既存のAction/Target/Conditionファクトリだけで
    // 表現できるものだけを登録する。新しいFactory関数は今回は追加しない（設計判断が要るため）。
    // ============================================================

    // BP01-035 ロケットランチャー（アタック, 黄, cost2, ACE）
    // カードテキスト: "〖アタックする〗ダメージ+40。〖アタック後〗対戦相手の他のリーダー1体に30ダメージ。"
    // BP01-018エレガントドミネートと全く同じ「対戦相手の他のリーダー1体」パターン（既存ファクトリを再利用）。
    'BP01-035': [
      E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 40 } }),
      E({ trigger: 'AFTER_ATTACK', target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 30 } }),
    ],

    // BP01-062 Never Fall（メモリア, 青, cost1, ACE）
    // カードテキスト: "〖プレイ時〗カードを3枚引く。"
    'BP01-062': [
      E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 3 } }),
    ],

    // BP02-017 ビクトリーランページ（アタック, 赤, cost1, ACE）
    // カードテキスト: "〖アタックする〗〖アタック後〗オーバーキル40：対戦相手の他のリーダー1体に90ダメージ。"
    // Phase D-2で作ったOVERKILL_AMOUNT Conditionの実カード適用例（このカードのために用意した機構）。
    'BP02-017': [
      E({
        trigger: 'AFTER_ATTACK',
        condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 40 }),
        target: F.makeSingleOtherOpponentLeaderTarget(),
        action: { type: 'DAMAGE', amount: 90 },
      }),
    ],

    // BP02-031 勝利の雄たけび（アタック, 黄, cost2, ACE）
    // カードテキスト: "〖アタックする〗ダメージ+30。〖アタック後〗カードを2枚引く。"（条件なし・無条件で発動）
    'BP02-031': [
      E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 30 } }),
      E({ trigger: 'AFTER_ATTACK', action: { type: 'DRAW', amount: 2 } }),
    ],

    // BP02-052 恐怖の迷宮（メモリア, 青, cost0, ACE）
    // カードテキスト: "〖アタック強化〗次のアタックのダメージ+20。〖アタック後〗対戦相手の他のリーダーすべてに10ダメージ。"
    'BP02-052': [
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 20 } }),
      E({ trigger: 'AFTER_ATTACK', target: F.makeAllOtherOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } }),
    ],

    // BP02-059 逆転のハイドギャル（メモリア, 黄, cost1, ACE）
    // カードテキスト: "〖アタック強化〗次のアタックのダメージ+80。"（これのみ）
    'BP02-059': [
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 80 } }),
    ],

    // BP02-066 流行語大賞（メモリア, 緑, cost0, ACE）
    // カードテキスト: "〖プレイ時〗自分のリーダー1体を40回復する。カードを1枚引く。"
    'BP02-066': [
      E({ trigger: 'ON_PLAY', target: F.makeOwnAliveLeaderTarget(), action: { type: 'MULTI', actions: [{ type: 'HEAL', amount: 40 }, { type: 'DRAW', amount: 1 }] } }),
    ],

    // BP03-038 強奪の宴（アタック, 緑, cost1, ACE）
    // カードテキスト: "〖アタックする〗〖アタック後〗このアタックを受けたリーダーがダウンしているなら、
    //  カードを1枚引き、対戦相手は手札を1枚捨てる。"
    // BP01-021ギャングの襲撃と同じダウン判定Condition＋既存のDISCARD_HAND(who:'OPPONENT')の組み合わせ。
    'BP03-038': [
      E({
        trigger: 'AFTER_ATTACK',
        condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; },
        action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 1 }, { type: 'DISCARD_HAND', who: 'OPPONENT', amount: 1 }] },
      }),
    ],

    // BP03-052 参拝・乾杯・超喝采（メモリア, 青, cost2, ACE）
    // カードテキスト: "〖アタック強化〗次のアタックのダメージ+80。〖アタック後〗アタッカーが青なら、
    //  対戦相手の他のリーダー1体に50ダメージ。アタッカーが黄なら、カードを2枚引く。"
    // 「アタッカーの色」で分岐する条件は新しいFactoryを作らず、Phase D-2で追加したctx.cardIndexを使った
    // 生のクロージャで判定する（BP01-053等、既存の生クロージャConditionと同じ書き方）。
    'BP03-052': [
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 80 } }),
      E({
        trigger: 'AFTER_ATTACK',
        condition: function (state, ctx) {
          var attacker = state.players[ctx.attackerPlayerId].leaders[ctx.attackerLeaderIndex];
          return ctx.cardIndex[attacker.cardId].color === 'blue';
        },
        target: F.makeSingleOtherOpponentLeaderTarget(),
        action: { type: 'DAMAGE', amount: 50 },
      }),
      E({
        trigger: 'AFTER_ATTACK',
        condition: function (state, ctx) {
          var attacker = state.players[ctx.attackerPlayerId].leaders[ctx.attackerLeaderIndex];
          return ctx.cardIndex[attacker.cardId].color === 'yellow';
        },
        action: { type: 'DRAW', amount: 2 },
      }),
    ],

    // BP04-066 収穫の刻（メモリア, 緑, cost1, ACE）
    // カードテキスト: "〖プレイ時〗対戦相手のリーダー1体に20ダメージ。カードを1枚引く。〖アタック後〗
    //  アタッカーが緑なら、自分の手札のコスト1のメモリアカード1枚を、コストを支払わずにプレイしてもよい。
    //  アタッカーが赤なら、自分の手札のコスト1のアタックカード1枚を、コストを支払わずにプレイしてもよい。"
    // アタック後の「手札から選んでコスト無しでプレイしてもよい」（FREE_PLAY系）は、過去のPhaseで対象外と
    // されたAction系統で現行エンジンに存在しないため未実装。プレイ時の20ダメージ+ドロー1のみ登録する。
    'BP04-066': [
      E({ trigger: 'ON_PLAY', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'MULTI', actions: [{ type: 'DAMAGE', amount: 20 }, { type: 'DRAW', amount: 1 }] } }),
    ],

    // ---- 以下、バッチ2で画像確認したが今回は未登録のカード（新しい仕組みが必要なため）----
    //
    // BP04-045 エリートコマンダー／BP04-052 ダイナミックデュオ：
    //   「エコー」（ターン終了時にトラッシュへ行く代わりに横向きになり、次のメインフェイズ開始時に
    //   コスト無しで横向きのままプレイし直す）という、プレイエリアのカードに「向き」という新しい状態を
    //   持たせる必要のある新機構。playArea.entryに新フィールドを追加し、END_PHASE/START_PHASEの処理へ
    //   フックする設計が必要なため、推測で実装しない。
    //
    // BP04-059 グレイトフルファーマー：アタックカードを実行後に同じカードをもう一度実行し直す
    //   （REPLAY_FROM_PLAY_AREA、過去のPhaseで明示的に対象外とした機構）。
    //
    // BP03-024 頂きの景色：アタック後、プレイエリアのメモリアカードのコスト合計と同じ枚数を引く。
    //   DERIVED_AMOUNTは現状LAST_DISTRIBUTED_HEAL_TOTALのみ対応で、「プレイエリアのコスト合計」を
    //   ソースにするには新しいDERIVED_AMOUNT sourceの追加が必要なため見送る。
    //
    // BP03-031 ソニックチェイサー：アタック後、対戦相手のダメージを受けている他のリーダーすべてに20ダメージ。
    //   「ダメージを受けている（damage>0）」で絞り込む新しいTarget Factoryが必要（既存のmakeAllOtherOpponentLeadersTarget
    //   はisDownでしか絞り込まない）。既存Factoryの単純な模倣で作れるが、新設計になるため今回は見送る。
    //
    // BP03-066 ジェイルブレイク：「このターン中にメモリア/アタックカードの効果で引いたカード枚数」という
    //   ターンをまたいだ累積カウンターの新設と、それを元にした割り振りダメージが必要なため見送る。
    //
    // BP02-045 巡り合う二人：デッキルック5枚から、コスト1以下のメモリア最大1枚"と"コスト1以下の
    //   アタックカード最大1枚を選んでコスト無しでプレイする。Phase GのFREE_PLAY_MEMORIA系はメモリア専用の
    //   ヘルパー（playMemoriaForFreeAndQueueEffects）しか無く、アタックカードを無償プレイするには
    //   新たな攻撃者/対象の選択（新しい選択コールバック）が追加で必要になるため、今回は見送る。
    //
    // BP01-026 CLUTCH!!!：手札のコスト0カードを公開・破棄してもよい、という任意コストのボーナス
    //   （OPTIONAL_DISCARD_THEN_BONUS、過去のPhaseで対象外）。
    //
    // ST01-005 クロスファイア／ST01-016 初の栄冠／ST02-009 魔王降臨／ST02-012 変わらない関係：
    //   「自分のリーダーすべてが特定のタグ（VSPO!/CR等）を持つなら」という判定は、過去のPhaseで
    //   明示的に対象外とされたタグデータ・TAG_CONDITION機構が必要なため見送る。

    // ============================================================
    // Phase E: 条件付きON_ATTACK/ATTACK_BOOSTボーナス機構を追加したことで登録可能になったカード
    // ============================================================

    // BP03-059 We are...!（メモリア, 黄, cost1, ACE）
    // カードテキスト: "〖プレイ時〗プレイエリアにアタックカードが2枚以上あるなら、自分のリーダー1体を
    //  30回復し、カードを2枚引く。〖アタック強化〗プレイエリアにメモリアカードが3枚以上あるなら、
    //  次のアタックのダメージ+70。（メモリアカードの数は【アタック強化】を実行するときに数える。）"
    // ON_PLAY側はPLAY_AREA_TYPE_COUNTが元々対応済み（ResolutionStack解決時にconditionを評価するため）。
    // ATTACK_BOOST側がPhase Eで新たに条件評価に対応した部分（カード自身の括弧書きどおり、
    // このカードをプレイした時点＝プレイエリアに積まれた後のメモリア枚数で判定する）。
    'BP03-059': [
      E({
        trigger: 'ON_PLAY',
        condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'ATTACK', operator: 'GTE', count: 2 }),
        target: F.makeOwnAliveLeaderTarget(),
        action: { type: 'MULTI', actions: [{ type: 'HEAL', amount: 30 }, { type: 'DRAW', amount: 2 }] },
      }),
      E({
        trigger: 'ATTACK_BOOST',
        condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 3 }),
        modifier: { type: 'DAMAGE_BONUS', amount: 70 },
      }),
    ],

    // BP02-038 オールスターコンボ（アタック, 緑, cost1, ACE）
    // カードテキスト: "〖アタックする〗プレイエリアに他のアタックカードが2枚以上あるなら、ダメージ+40。
    //  プレイエリアに他のアタックカードが4枚以上あるなら、さらにダメージ+20。"
    // このカード自身はcomputeAttackCardBaseDamage呼び出し時点ではまだプレイエリアに積まれていないため、
    // PLAY_AREA_TYPE_COUNTでカウントすれば自然に「他の」アタックカードだけが数えられる。
    'BP02-038': [
      E({ trigger: 'ON_ATTACK', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'ATTACK', operator: 'GTE', count: 2 }), action: { type: 'ATTACK_DAMAGE_BONUS', amount: 40 } }),
      E({ trigger: 'ON_ATTACK', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'ATTACK', operator: 'GTE', count: 4 }), action: { type: 'ATTACK_DAMAGE_BONUS', amount: 20 } }),
    ],

    // ============================================================
    // Phase F: MULTI_ATTACK機構を追加したことで登録可能になったカード（+ついでに単発の
    // Target Factory不足のみが理由で見送っていたBP01-080）
    // ============================================================

    // BP03-017 ストームラッシュ（アタック, 赤, cost2, ACE）
    // カードテキスト: "〖アタックする〗〖アタックする〗〖アタックする〗（アタックのたびに、
    //  アタッカーとアタックを受けるリーダーを選ぶ。）"
    // このカード自身に固定のダメージ加算等は無く、3回の独立したアタック宣言だけを行う。
    'BP03-017': [
      E({ trigger: 'ON_ATTACK', action: { type: 'MULTI_ATTACK', count: 3 } }),
    ],

    // BP01-080 勝利へのジャンプ（メモリア, 緑, cost3, ACE）
    // カードテキスト: "〖プレイ時〗対戦相手のリーダーすべてに50ダメージ。"
    // makeAllAliveOpponentLeadersTarget（Phase Fで新設）を使うだけで表現できる、単純なON_PLAY。
    'BP01-080': [
      E({ trigger: 'ON_PLAY', target: F.makeAllAliveOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 50 } }),
    ],

    // ============================================================
    // Phase G: FREE_PLAY_MEMORIA_FROM_HAND / DECK_LOOK_FREE_PLAY_MEMORIA /
    // REPLAY_SELECTED_FROM_PLAY_AREA機構を追加したことで登録可能になったカード
    // ============================================================

    // BP01-017 一騎当千（アタック, 赤, cost2, ACE）
    // カードテキスト: "〖アタックする〗〖アタック後〗自分の手札のエース以外のメモリアカードを、
    //  コストの合計が3以下になるように好きな枚数公開する。公開したカードを、コストを支払わず
    //  好きな順番でプレイする。（プレイしたカードは、このカードの右側に置く。それらの効果は、
    //  このアタックが終わってから左から順番に実行する。）"
    'BP01-017': [
      E({ trigger: 'AFTER_ATTACK', action: { type: 'FREE_PLAY_MEMORIA_FROM_HAND', costLimit: 3 } }),
    ],

    // BP01-044 リンク・アサルト（アタック, 緑, cost1, ACE）
    // カードテキスト: "〖アタックする〗〖アタック後〗自分のデッキの上から3枚を見る。その中から
    //  コスト1以下のメモリアカード1枚を、コストを支払わずにプレイしてもよい。残りのカードを
    //  トラッシュに置く。"
    'BP01-044': [
      E({ trigger: 'AFTER_ATTACK', action: { type: 'DECK_LOOK_FREE_PLAY_MEMORIA', count: 3, maxCost: 1 } }),
    ],

    // BP02-024 三銃士（アタック, 無色, cost1, ACE）
    // カードテキスト: "〖アタックする〗〖アタック後〗プレイエリアのエース以外のコスト0のメモリア
    //  カードを最大2枚選び、プレイし直す。（選んだカードを、このカードの右側に置く。プレイした
    //  カードの効果は、このアタックが終わってから左から順番に実行する。）"
    'BP02-024': [
      E({ trigger: 'AFTER_ATTACK', action: { type: 'REPLAY_SELECTED_FROM_PLAY_AREA', maxCount: 2, maxCost: 0 } }),
    ],

    // ============================================================
    // Phase H: 「専用カード」（buildRule: リーダー：<推し名>）画像バッチで確認したカードのうち、
    // 既存のAction/Target/Condition機構だけで表現できるものを登録する。
    // カードテキストはdata/source/all-cards.json（このバッチで確認・補完済み）を参照。
    // ============================================================

    // --- ON_ATTACK+10のみ（単純なダメージ加算） ---
    'BP03-022': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })], // ピアッシングバレット
    'BP04-022': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })], // タレットマスタリー
    'BP04-030': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })], // シールドスラム
    'BP04-034': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })], // トリッキームーブ
    'BP03-041': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })], // ルーキーチェイス
    'BP01-034': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })], // 巧みな裏取り
    'BP01-049': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })], // 冷静沈着
    'BP02-041': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })], // エアリアルアックス
    'BP04-044': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })], // ハイパーボルテージ
    'BP01-038': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })], // クラッチクイーン

    // BP04-020 ワールドクラス：〖アタックする〗ダメージ-10。（画像で確認した通りの負の値。
    // ATTACK_DAMAGE_BONUSはamountの符号を問わずそのまま加算するだけなので、そのまま表現できる。）
    'BP04-020': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: -20 } })],

    // --- ATTACK_BOOSTのみ（無条件） ---
    'BP04-058': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // 「またね」
    'BP01-076': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // 優勝請負人
    'BP02-051': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // 初めての歓声
    'BP04-063': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // 気合十分
    'AN01-014': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // プリティサベージ
    'BP03-070': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // 大人気キッチンカー
    'BP03-055': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // 22HZ♪
    'BP04-051': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // 士官学校
    'BP01-065': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // 汚部屋の住人
    'BP04-069': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // 深淵の強者たち
    'BP01-083': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // バトンを繋いで
    'AN01-017': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // 差し迫る閃光
    'BP01-059': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // 笑ってはいけない

    // --- ATTACK_BOOST：プレイエリアにメモリアカードが3枚以上ならダメージ+30（Phase E機構の再利用） ---
    'BP04-050': [E({ trigger: 'ATTACK_BOOST', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 3 }), modifier: { type: 'DAMAGE_BONUS', amount: 30 } })], // ヤー!
    'BP04-065': [E({ trigger: 'ATTACK_BOOST', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 3 }), modifier: { type: 'DAMAGE_BONUS', amount: 30 } })], // 雪降る夜に
    'BP01-077': [E({ trigger: 'ATTACK_BOOST', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 3 }), modifier: { type: 'DAMAGE_BONUS', amount: 30 } })], // 777

    // BP02-069 換気：〖アタック強化〗次のアタックのダメージ+20。プレイエリアにメモリアカードが3枚以上あるなら、
    // さらにダメージ+30。無条件+20と条件付き+30は独立したATTACK_BOOSTエントリとして両方登録する
    // （どちらも同じカードのプレイ時にqueueAttackBoostされ、合算される）。
    'BP02-069': [
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 20 } }),
      E({ trigger: 'ATTACK_BOOST', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 3 }), modifier: { type: 'DAMAGE_BONUS', amount: 50 } }),
    ],

    // --- ON_PLAY draw1 + ATTACK_BOOST+30（無条件） ---
    'BP02-072': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } })], // トリプルティアラ
    'BP03-050': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } })], // 祭典の開幕
    'BP04-064': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } })], // デンジャーゾーン
    'BP02-063': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } })], // ギャルスタイル
    'BP04-057': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } })], // シェフの一存
    'AN01-015': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } })], // ゴールデンルート

    // --- ON_PLAY draw2のみ ---
    'BP03-069': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 2 } })], // アクアリウムツアー
    'BP04-048': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 2 } })], // 入念な準備
    'BP01-086': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 2 } })], // なずNEWS
    'BP01-074': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 2 } })], // 来てくれてありがとう
    'BP01-067': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 2 } })], // いつも安全運転

    // --- ON_PLAY：対戦相手のリーダー1体に20ダメージ ---
    // ON_PLAYはアタックに紐づかないため、ctx.targetPlayerId/targetLeaderIndexに依存する
    // makeSingleOtherOpponentLeaderTargetではなく、ctx.ownerPlayerId基準のmakeAnyOpponentLeaderTarget
    // （既存カードのON_PLAY単体ダメージで使われているのと同じファクトリ）を使う。
    'BP01-070': [E({ trigger: 'ON_PLAY', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // BEAUTY SALON -HANABUSA-
    'BP02-062': [E({ trigger: 'ON_PLAY', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // クッキングパニック
    'BP04-070': [E({ trigger: 'ON_PLAY', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 淑女の回答
    'BP03-049': [E({ trigger: 'ON_PLAY', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // カーコレクター
    'BP04-056': [E({ trigger: 'ON_PLAY', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // でからむち♪

    // --- AFTER_ATTACK：このアタックを受けたリーダーがダウンしているならカードを1枚引く ---
    'BP02-044': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, action: { type: 'DRAW', amount: 1 } })], // セクシーアローべにショット
    'BP03-028': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, action: { type: 'DRAW', amount: 1 } })], // パワーセットアップ
    'BP02-023': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, action: { type: 'DRAW', amount: 1 } })], // 圧倒的わたし!!
    'BP01-043': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, action: { type: 'DRAW', amount: 1 } })], // ブービートラップ
    'BP04-037': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, action: { type: 'DRAW', amount: 1 } })], // シンリャク開始
    'BP01-031': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, action: { type: 'DRAW', amount: 1 } })], // 勝利の一撃
    'AN01-011': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, action: { type: 'DRAW', amount: 1 } })], // リーサルフューズ

    // BP02-049 究極自摸：〖アタック後〗カードを1枚引く。（メモリアカードだがATTACK_BOOSTなしでAFTER_ATTACKのみを
    // 持つ。playMemoriaCardWithEffects/playMemoriaForFreeAndQueueEffectsはATTACK_BOOSTの有無に関わらず
    // AFTER_ATTACK効果をpendingAfterAttackEffectsに積むため、無条件でそのまま表現できる。）
    'BP02-049': [E({ trigger: 'AFTER_ATTACK', action: { type: 'DRAW', amount: 1 } })],

    // --- AFTER_ATTACK：このアタックを受けたリーダーがダウンしているなら対戦相手の他のリーダー1体に20ダメージ ---
    'BP03-029': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 漢の強行突破
    'BP04-035': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 進歩の光
    'BP01-025': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // キリングスプリー
    'BP04-042': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // マシュマロピッチャー
    'BP01-041': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 固定砲台みみたや

    // --- AFTER_ATTACK：プレイエリアにメモリアカードが2枚以上あるなら対戦相手の他のリーダー1体に20ダメージ ---
    'AN01-010': [E({ trigger: 'AFTER_ATTACK', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }), target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 容疑者連行中
    'BP04-021': [E({ trigger: 'AFTER_ATTACK', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }), target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 攻防一体
    'BP03-021': [E({ trigger: 'AFTER_ATTACK', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }), target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 抜群のウデマエ

    // --- AFTER_ATTACK：プレイエリアにメモリアカードが2枚以上あるなら対戦相手の他のリーダーすべてに10ダメージ ---
    'AN01-006': [E({ trigger: 'AFTER_ATTACK', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }), target: F.makeAllOtherOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 肩乗りコーチング
    'BP04-036': [E({ trigger: 'AFTER_ATTACK', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }), target: F.makeAllOtherOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // ドラゴンブレス
    'BP01-050': [E({ trigger: 'AFTER_ATTACK', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }), target: F.makeAllOtherOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // ブラインドショット
    'BP04-027': [E({ trigger: 'AFTER_ATTACK', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 2 }), target: F.makeAllOtherOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 古の呪い

    // --- ATTACK_BOOST+50 + AFTER_ATTACK：対戦相手の他のリーダー1体に10ダメージ（無条件） ---
    'BP01-079': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } }), E({ trigger: 'AFTER_ATTACK', target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 小さなビデオレター
    'BP01-085': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } }), E({ trigger: 'AFTER_ATTACK', target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 風紀チェック
    'AN01-016': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } }), E({ trigger: 'AFTER_ATTACK', target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 会議招集!
    'BP04-055': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } }), E({ trigger: 'AFTER_ATTACK', target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 懺悔のフリーフォール
    'BP02-048': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } }), E({ trigger: 'AFTER_ATTACK', target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // ちる!

    // BP03-057 救いの手：〖アタック強化〗+50、〖アタック後〗対戦相手の他のリーダー1体に10ダメージ（無条件）
    'BP03-057': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } }), E({ trigger: 'AFTER_ATTACK', target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })],

    // BP01-057 新たなる場所へ：〖アタック強化〗+30、〖アタック後〗対戦相手の他のリーダーすべてに10ダメージ（無条件）
    'BP01-057': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } }), E({ trigger: 'AFTER_ATTACK', target: F.makeAllOtherOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })],

    // BP04-062 OISタクシー：〖アタック強化〗+30、〖アタック後〗対戦相手の他のリーダー1体に30ダメージ（無条件）
    'BP04-062': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } }), E({ trigger: 'AFTER_ATTACK', target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 30 } })],

    // --- ATTACK_BOOST+50 + AFTER_ATTACK：プレイエリアにメモリアカードが3枚以上あるなら対戦相手の他のリーダー1体に20ダメージ ---
    'BP04-071': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } }), E({ trigger: 'AFTER_ATTACK', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 3 }), target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 快適な空の旅
    'BP03-065': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } }), E({ trigger: 'AFTER_ATTACK', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 3 }), target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // ノブレス・オブリージュ

    // --- ON_PLAY：条件付き（自分の場にアタックカードが1枚以上）draw1 + ATTACK_BOOST+30/+40（無条件） ---
    'BP03-056': [E({ trigger: 'ON_PLAY', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'ATTACK', operator: 'GTE', count: 1 }), action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 40 } })], // シャンパンコール！
    'BP04-072': [E({ trigger: 'ON_PLAY', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'ATTACK', operator: 'GTE', count: 1 }), action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 40 } })], // ペーパードライバー

    // --- AFTER_ATTACK OVERKILL（Phase D-2機構の再利用） ---
    'AN01-007': [E({ trigger: 'AFTER_ATTACK', condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 20 }), action: { type: 'RECOVER_PP', amount: 1 } })], // 悲願の開花
    'BP04-029': [E({ trigger: 'AFTER_ATTACK', condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 10 }), target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 30 } })], // 一斧両断

    // --- ON_PLAY：すべてのプレイヤーは手札を1枚捨てる + ATTACK_BOOST+50（無条件） ---
    // DISCARD_HAND（Phase B/D-2で既にwho:'ALL'対応済み）をそのまま流用する。
    'BP04-049': [E({ trigger: 'ON_PLAY', action: { type: 'DISCARD_HAND', who: 'ALL', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } })], // なんだコイツ…

    // BP03-037 Tango Down（アタック, 黄, cost1, buildRule: リーダー：猫麦とろろ）
    // カードテキスト（画像で確認）: "〖プレイ時〗プレイエリアに他のカードがないなら、PPを1回復する。
    //  〖アタックする〗ダメージ-10。"
    // 「プレイエリアに他のカードがない（総数0枚）」を判定するConditionが現行のPLAY_AREA_TYPE_COUNTには
    // 存在しない（既存はcardType別カウントのみで、全タイプ合計・自分自身を除く枚数という条件は
    // 別物として新設が必要）。そのためプレイ時効果は未実装。アタック時のダメージ-10のみ登録する
    // （ATTACK_DAMAGE_BONUSは符号を問わず加算するだけなので、負の値をそのまま表現できる）。
    'BP03-037': [
      E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: -10 } }),
    ],

    // BP01-069 運もミスもない（メモリア, 青, cost0, buildRule: リーダー：白雪レイド）
    // カードテキスト（画像で確認）: "〖プレイ時〗自分のデッキの上から1枚を見る。そのカードをトラッシュに
    //  置いてもよい。〖アタック強化〗次のアタックのダメージ+10。"
    // プレイ時の「デッキの上から1枚を見て、任意でトラッシュに置く」は既存のMILL/DECK_LOOK系Actionが
    // 対象外としてきた「山札を覗いて選択する」機構であり、現行のFREE_PLAY/DECK_LOOK_FREE_PLAY系とも
    // 形が異なる（引く/プレイするのではなく「捨てるか残すか」の二択）ため未実装。ATTACK_BOOSTのみ登録する。
    'BP01-069': [
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 10 } }),
    ],

    // ---- 以下、Phase Hで画像確認したが今回は未登録のカード（新しい仕組みが必要なため） ----

    // BP01-040 Lastman Standing（アタック, 黄, cost1, buildRule: リーダー：Cpt）
    // カードテキスト: "〖アタックする〗手札を1枚捨ててもよい。そうしたならダメージ+20。"
    // 「手札を1枚捨てるかどうかを選び、捨てた場合のみ固定ボーナスが付く」という条件付き任意コストは
    // 既存のATTACK_DAMAGE_BONUS（固定値のみ）やDISCARD_HAND（無条件・枚数指定のみ）では表現できない。
    // 選択コールバック＋捨てたかどうかで分岐するAction設計が必要なため、推測で実装せず見送る。

    // BP01-022 壁ジャンプ（アタック, 赤, cost1, buildRule: リーダー：Selly）
    // カードテキスト: "プレイエリアに別の「壁ジャンプ」が1枚あるなら、コストを支払わずにこのカードを
    //  プレイしてもよい（2枚以上あるときはコストを支払う）。〖アタックする〗"
    // 「同名カードが場にあるかどうかでコスト免除が変わる」プレイ条件は、既存のFREE_PLAY系
    // （手札/デッキ/プレイエリアから選んでプレイする）とは全く別の「通常のプレイそのものの
    // コスト計算に介入する」機構であり、現行のカード効果レイヤーには対応する仕組みがない。
    // 推測で実装せず見送る。

    // BP01-061 逃走成功（メモリア, 赤, cost1, buildRule: リーダー：Mondo）
    // BP01-088 モラルからのハミダシ（メモリア, 緑, cost1, buildRule: リーダー：nqrse）
    // カードテキスト（共通の型）: "〖プレイ時〗すべてのプレイヤーはカードを1枚引く。〖アタック強化〗次の
    //  アタックのダメージ+50。"
    // 既存のDRAW Actionはctx.ownerPlayerId固定で1人分しか引けない（DISCARD_HANDのwho:'SELF'|'OPPONENT'|'ALL'
    // に相当する仕組みが無い）。DISCARD_HANDと全く同じ形でDRAWにwhoパラメータを追加すれば表現できる、
    // 小さく明確なスコープの拡張だが、既存Actionの挙動を変える変更なので今回は実装せず、
    // 次回「システム追加」で対応候補として提示する。

    // BP03-027 仁義なき抗争（アタック, 青, cost1, buildRule: リーダー：ズズ）
    // カードテキスト: "〖アタックする〗手札を1枚ランダムに捨ててもよい。そうしたならダメージ+30。"
    // BP01-040と同型の「捨てるかどうかを選び、捨てた場合のみボーナス」に加え「ランダムに1枚」という
    // 追加の乱数選択も必要。同じ理由で見送る。

    // BP04-023 天衣無縫（アタック, 赤, cost1, buildRule: リーダー：らいじん）
    // カードテキスト: "〖アタックする〗対戦相手のデッキの上から1枚を公開し、トラッシュに置く。そのカードが
    //  メモリアカードなら、ダメージ+20。"
    // 「相手のデッキの上から公開して、公開したカードの種類によって自分のダメージが変わる」は、
    // 既存のMILL/DECK_LOOK系（自分のデッキ対象のみ）ともOVERKILL_AMOUNT型の事後条件とも異なる、
    // 新規の「公開結果に応じた分岐」を持つActionが必要なため見送る。

    // BP01-068 運命のルーレット（メモリア, 青, cost1, buildRule: リーダー：渋谷ハル）
    // カードテキスト: "〖プレイ時〗メモリアカードかアタックカードのどちらかを宣言し、自分のデッキの上から
    //  1枚を公開する。そのカードが宣言したカードタイプならカードを4枚引く。それ以外なら公開したカードを
    //  トラッシュに置く。"
    // 「事前に種類を宣言し、公開結果と一致するかどうかで結果が分岐する」機構は現行のDECK_LOOK系にも
    // OVERKILL_AMOUNT型の条件にも存在しない、新規のAction設計が必要なため見送る。

    // BP04-028 シンクロトリニティ（アタック, 青, cost1, buildRule: リーダー：白波らむね）
    // カードテキスト: "〖アタックする〗〖アタック後〗自分のデッキの上から3枚を見る。その中からエース以外の
    //  コスト0のカード1枚を公開し、手札に加えてもよい。残りのカードをトラッシュに置く。"
    // 「デッキの上から複数枚を見て、条件に合う1枚だけ手札に加え、残りをトラッシュに置く」は、
    // Phase Gで実装したDECK_LOOK_FREE_PLAY_MEMORIA（見た中から即プレイ）とは異なり「手札に加える」
    // という結果になる新しいAction type（DECK_LOOK_ADD_TO_HAND相当）が必要なため見送る。

    // ============================================================
    // Phase I: アタック/メモリア全種の画像バッチで本文を確認・補完したカードのうち、
    // 既存の機構だけで表現できるものを登録する（テキストはdata/source/all-cards.json参照）。
    // パラレル/プロモ（PR-xxx・SRP・CP）はparallelAliases.js経由で通常版の登録を共有する。
    // ============================================================

    // --- ATTACK_BOOSTのみ（無条件） ---
    'BP04-046': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } })], // もう一人のボク
    'BP03-053': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } })], // 闘技場の主
    'BP04-054': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } })], // 放課後補習組
    'BP03-060': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } })], // 戦場のお茶会
    'BP04-061': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } })], // 通過儀礼
    'BP03-068': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } })], // かるび人狼
    'BP04-067': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } })], // リトルエンプレス
    'AN01-013': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } })], // 必要な犠牲？
    'PR-053': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 50 } })], // CR LIVE 2026
    'BP03-062': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 60 } })], // 掴んだ運命

    // --- ATTACK_BOOST条件付き（Phase E機構） ---
    'BP03-071': [E({ trigger: 'ATTACK_BOOST', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 3 }), modifier: { type: 'DAMAGE_BONUS', amount: 30 } })], // 街角の芸術家
    'BP03-072': [ // ストレイ・プリンセス：無条件+20、メモリア3枚以上でさらに+50（換気と同型）
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 20 } }),
      E({ trigger: 'ATTACK_BOOST', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'MEMORIA', operator: 'GTE', count: 3 }), modifier: { type: 'DAMAGE_BONUS', amount: 50 } }),
    ],
    'BP04-047': [ // ベッドでチキン：+40、プレイエリアにタクティクスカードがあるならさらに+20
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 40 } }),
      E({ trigger: 'ATTACK_BOOST', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'TACTICS', operator: 'GTE', count: 1 }), modifier: { type: 'DAMAGE_BONUS', amount: 20 } }),
    ],

    // --- ON_PLAY回復 + ATTACK_BOOST ---
    'BP03-054': [E({ trigger: 'ON_PLAY', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 30 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } })], // 闇の加護
    'BP04-060': [E({ trigger: 'ON_PLAY', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 30 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } })], // 一蓮托生
    'BP04-053': [E({ trigger: 'ON_PLAY', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 10 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 10 } })], // 穏やかな一時

    // --- ON_PLAYのみ ---
    'BP03-058': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 2 } })], // 彼こそがロック
    'BP03-061': [E({ trigger: 'ON_PLAY', action: { type: 'DISCARD_HAND', who: 'OPPONENT', amount: 1 } })], // セレブリティーエレガンス
    'BP03-063': [E({ trigger: 'ON_PLAY', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 極上のアゲ↑↑

    // --- ON_PLAY条件付きdraw + ATTACK_BOOST（シャンパンコール！と同型） ---
    'BP03-064': [E({ trigger: 'ON_PLAY', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'ATTACK', operator: 'GTE', count: 1 }), action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 40 } })], // 引率のお兄さん

    // --- ATTACK_BOOST + AFTER_ATTACK無条件 ---
    'BP03-051': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 30 } }), E({ trigger: 'AFTER_ATTACK', target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 30 } })], // 露骨な挑発

    // --- ON_ATTACK固定/条件付きボーナス ---
    'BP04-026': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 40 } })], // コンセントレイト
    'BP04-033': [E({ trigger: 'ON_ATTACK', action: { type: 'ATTACK_DAMAGE_BONUS', amount: 70 } })], // パン売りの少女
    'BP04-025': [E({ trigger: 'ON_ATTACK', condition: F.makePlayAreaTypeCountCondition({ player: 'SELF', cardType: 'TACTICS', operator: 'GTE', count: 1 }), action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })], // 伝説のアルバム
    // 大旋風 / ステークアウト：「アタッカーが覚醒しているなら、ダメージ+10」。ctx.attackerLeaderIndexは
    // computeAttackCardBaseDamage呼び出し時点で設定済み（アタック宣言前＝このアタックで覚醒する前の状態を見る）。
    'BP04-039': [E({ trigger: 'ON_ATTACK', condition: function (state, ctx) { var l = state.players[ctx.ownerPlayerId].leaders[ctx.attackerLeaderIndex]; return !!(l && l.awakened); }, action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })],
    'AN01-005': [E({ trigger: 'ON_ATTACK', condition: function (state, ctx) { var l = state.players[ctx.ownerPlayerId].leaders[ctx.attackerLeaderIndex]; return !!(l && l.awakened); }, action: { type: 'ATTACK_DAMAGE_BONUS', amount: 10 } })],

    // --- AFTER_ATTACK ---
    'BP04-032': [E({ trigger: 'AFTER_ATTACK', target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 40 } })], // ビリオンシャワー
    'AN01-009': [E({ trigger: 'AFTER_ATTACK', target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // オールオアナッシング
    'BP03-020': [E({ trigger: 'AFTER_ATTACK', condition: function (state, ctx) { return state.players[ctx.targetPlayerId].leaders[ctx.targetLeaderIndex].isDown; }, target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 縦横無尽
    'BP03-023': [E({ trigger: 'AFTER_ATTACK', condition: F.makeOverkillAmountCondition({ operator: 'GTE', amount: 10 }), target: F.makeSingleOtherOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 30 } })], // 影と道連れ
    'BP04-019': [E({ trigger: 'AFTER_ATTACK', target: F.makeSameColorAsAttackedLeaderTarget(), action: { type: 'DAMAGE', amount: 40 } })], // バッドカンパニー（ポイズンボムと同型）
    'BP04-018': [E({ trigger: 'AFTER_ATTACK', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 1 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 1 }] } })], // 1TAP

    // ---- 以下、Phase Iで本文を確認したが今回は未登録のカード（新しい仕組みが必要なため） ----
    // BP03-025 短気な爆弾魔: "〖アタックする〗このターン、あなたが手札を1枚以上捨てているなら、ダメージ+10。"
    //   → 「このターンに手札を捨てたか」を記録するターン単位のカウンタが現行のstateに無い。
    // BP03-067 気まずい空間: "〖プレイ時〗自分のデッキの上から3枚を見る。それらのカードをトラッシュに置く。"
    //   → デッキ上から直接トラッシュに置く（MILL）Actionが未実装。
    // BP03-027 仁義なき抗争: Phase Hで記載済み（任意のランダム手札破棄＋条件付きボーナス）。

    // ============================================================
    // Phase J: タクティクス/PP画像バッチで本文を確認したタクティクスのうち、既存機構で表現できるもの。
    // 同名の別印刷は本文が一致することを確認済み（例：アドレナリンはBP01-089/ST01-019/ST02-019/BP03-074すべて同文）。
    // 消費タクティクスの〖アタック強化〗はPhase JでplayTacticsCardWithEffectsが扱えるようにした。
    // ============================================================

    // アドレナリン："〖プレイ時〗カードを1枚引く。〖アタック強化〗次のアタックのダメージ+40。"
    'BP01-089': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 40 } })],
    'ST01-019': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 40 } })],
    'ST02-019': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 40 } })],
    'BP03-074': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 40 } })],

    // 特殊弾："〖アタック強化〗次のアタックのダメージ+80。"
    'ST01-022': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 80 } })],
    'ST02-022': [E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 80 } })],

    // エナジーチャージャー："〖プレイ時〗PPを1回復し、カードを1枚引く。"（BP01-090/BP02-073はBAN）
    'BP01-090': [E({ trigger: 'ON_PLAY', action: { type: 'MULTI', actions: [{ type: 'RECOVER_PP', amount: 1 }, { type: 'DRAW', amount: 1 }] } })],
    'BP02-073': [E({ trigger: 'ON_PLAY', action: { type: 'MULTI', actions: [{ type: 'RECOVER_PP', amount: 1 }, { type: 'DRAW', amount: 1 }] } })],
    'ST01-020': [E({ trigger: 'ON_PLAY', action: { type: 'MULTI', actions: [{ type: 'RECOVER_PP', amount: 1 }, { type: 'DRAW', amount: 1 }] } })],
    'ST02-020': [E({ trigger: 'ON_PLAY', action: { type: 'MULTI', actions: [{ type: 'RECOVER_PP', amount: 1 }, { type: 'DRAW', amount: 1 }] } })],

    // PPチケット："〖プレイ時〗PPを1回復する。"（使用済みPPが無ければ回復量0。FAQ Q9）
    'ST01-024': [E({ trigger: 'ON_PLAY', action: { type: 'RECOVER_PP', amount: 1 } })],
    'ST02-024': [E({ trigger: 'ON_PLAY', action: { type: 'RECOVER_PP', amount: 1 } })],
    'BP01-097': [E({ trigger: 'ON_PLAY', action: { type: 'RECOVER_PP', amount: 1 } })],
    'BP02-081': [E({ trigger: 'ON_PLAY', action: { type: 'RECOVER_PP', amount: 1 } })],

    // 救急キット（ST01-021/ST02-021と同文）
    'BP01-091': [E({ trigger: 'ON_PLAY', action: { type: 'DISTRIBUTED_HEAL', total: 80 } })],
    'BP03-073': [E({ trigger: 'ON_PLAY', action: { type: 'DISTRIBUTED_HEAL', total: 80 } })],

    // ストラテジックレーダー："〖プレイ時〗カードを2枚引く。"
    'BP01-092': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 2 } })],
    'BP02-074': [E({ trigger: 'ON_PLAY', action: { type: 'DRAW', amount: 2 } })],

    // ジャミングパルス（BP01-093と同文）
    'BP03-075': [E({ trigger: 'ON_PLAY', action: { type: 'DISCARD_HAND', who: 'OPPONENT', amount: 2 } })],

    // ライトシールド（BP01-095と同文）/ ボディアーマー："体力+40"
    'ST01-023': [E({ trigger: 'ON_PLAY', duration: 'PERMANENT', action: { type: 'EQUIP_HP_MODIFIER', amount: 30 } })],
    'ST02-023': [E({ trigger: 'ON_PLAY', duration: 'PERMANENT', action: { type: 'EQUIP_HP_MODIFIER', amount: 30 } })],
    'BP01-096': [E({ trigger: 'ON_PLAY', duration: 'PERMANENT', action: { type: 'EQUIP_HP_MODIFIER', amount: 40 } })],

    // ドレインロッド（BP02-076と同文）
    'BP04-074': [E({
      trigger: 'ON_PLAY',
      target: F.makeAnyOpponentLeaderTarget(),
      action: { type: 'MULTI', actions: [
        { type: 'DISTRIBUTED_HEAL', total: 40 },
        { type: 'DAMAGE', amount: { type: 'DERIVED_AMOUNT', source: 'LAST_DISTRIBUTED_HEAL_TOTAL' } },
      ] },
    })],

    // 攻撃要請："〖プレイ時〗対戦相手のリーダー1体に40ダメージ。"
    'BP04-078': [E({ trigger: 'ON_PLAY', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 40 } })],

    // 一斉攻撃："〖アタック強化〗+40。〖アタック後〗自分のトラッシュに「攻撃要請」があるなら、対戦相手のリーダー1体に40ダメージ。"
    'BP04-077': [
      E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 40 } }),
      E({
        trigger: 'AFTER_ATTACK',
        condition: function (state, ctx) {
          return state.players[ctx.ownerPlayerId].trash.some(function (t) {
            var c = ctx.cardIndex && ctx.cardIndex[t.card.cardId];
            return !!c && c.name === '攻撃要請';
          });
        },
        target: F.makeAnyOpponentLeaderTarget(),
        action: { type: 'DAMAGE', amount: 40 },
      }),
    ],

    // 呪いの人形："〖プレイ時〗対戦相手は手札を1枚捨てる。〖アタック強化〗次のアタックのダメージ+40。"
    'BP04-080': [E({ trigger: 'ON_PLAY', action: { type: 'DISCARD_HAND', who: 'OPPONENT', amount: 1 } }), E({ trigger: 'ATTACK_BOOST', modifier: { type: 'DAMAGE_BONUS', amount: 40 } })],

    // ファイヤークラッカー："〖プレイ時〗対戦相手のリーダーすべてに10ダメージ。カードを1枚引く。"
    'BP03-078': [E({ trigger: 'ON_PLAY', target: F.makeAllAliveOpponentLeadersTarget(), action: { type: 'MULTI', actions: [{ type: 'DAMAGE', amount: 10 }, { type: 'DRAW', amount: 1 }] } })],

    // ---- 以下、Phase Jで本文を確認したが今回は未登録のタクティクス（新しい仕組みが必要なため） ----
    // BP03-080/BP04-073 サイバネアーマー: 覚醒状態で「基本の体力」を置き換える装備（現行は加算のEQUIP_HP_MODIFIERのみ）。
    // BP03-076 追加マガジン: トラッシュに置かれる代わりにタクティクスエリアへ戻る置換効果が未実装
    //   （片方だけ登録すると使い切りになり本来の挙動と変わるため、全体を見送る）。
    // BP03-077 パワーフィールド: 「このラウンド」持続する攻撃力修正と、ターン終了時にトラッシュへ置かない処理が未実装。
    // BP03-079 ターゲットフラッグ: アタック対象を制限する装備（対象選択への制約）が未実装。
    // BP04-079 討伐クエスト: デッキ上7枚から1枚を手札に加える（DECK_LOOK_ADD_TO_HAND相当）が未実装。
    // BP04-076 アイテムショップ: トラッシュの裏向きカードをデッキに戻してシャッフルする処理が未実装。
    // BP01-094/BP02-075 復活ポータル、BP02-077 オートタレット: 以前から未登録（プレイ条件/付与能力の条件が未対応）。
    // ============================================================
    // リーダー覚醒時効果：6種の定型文すべて（未登録だった既存62名＋第5弾16名）
    // 覚醒時効果の文言は全リーダーでこの6種のいずれかに完全一致することを確認済み。
    // 「対戦相手のリーダー1体」は他の、の限定が無いので生存リーダー全員が候補（既定は先頭）。
    // 「自分のリーダー1体を20回復」は既存のMondo（ST02-002）と同じく、既定では覚醒したリーダー自身を選ぶ。
    // ============================================================

    // 「自分のリーダー1体を20回復する。」（18名）
    'BP01-008': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 英リサ
    'BP01-009': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 胡桃のあ
    'ST01-004': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 花芽なずな
    'BP02-001': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 赤見かるび
    'BP02-012': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // わいわい
    'BP02-016': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 八雲べに
    'BP03-002': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 紫宮るな
    'BP03-007': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 柊ツルギ
    'BP03-016': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 夜絆ニウ
    'BP04-002': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 昏昏アリア
    'BP04-008': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 夜乃くろむ
    'BP04-010': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 千燈ゆうひ
    'BP04-016': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 天帝フォルテ
    'AN01-003': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 一ノ瀬うるは (AN1)
    'BP05-L01': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 秋雪こはく
    'BP05-L07': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 渋谷ハル (IGV)
    'BP05-L09': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 神成きゅぴ (IGV)
    'BP05-L14': [E({ trigger: 'ON_AWAKEN', target: F.makeOwnAliveLeaderTarget(), action: { type: 'HEAL', amount: 20 } })], // 花芽すみれ (IGV)

    // 「カードを1枚引く。」（20名）
    'BP01-004': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // ふらんしすこ
    'BP01-005': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // Kamito
    'BP01-012': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // VanilLa
    'BP01-014': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // ありさか
    'ST01-001': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // 一ノ瀬うるは
    'ST02-003': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // Cpt
    'BP02-004': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // 蝶屋はなび
    'BP02-006': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // かずのこ
    'BP02-015': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // ボンちゃん
    'BP03-005': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // ズズ
    'BP03-014': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // けんき
    'BP03-015': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // 猫汰つな
    'BP04-001': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // うぉっか
    'BP04-007': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // まざー3
    'BP04-009': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // おぼ
    'BP04-015': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // じゃすぱー
    'AN01-004': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // 白雪レイド (AN1)
    'BP05-L08': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // tttcheekyttt
    'BP05-L10': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // 胡桃のあ (IGV)
    'BP05-L15': [E({ trigger: 'ON_AWAKEN', action: { type: 'DRAW', amount: 1 } })], // Zeder

    // 「カードを2枚引き、手札を2枚捨てる。」（5名）
    'AN01-001': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })], // うるか (AN1)
    'BP05-L03': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })], // dtto.
    'BP05-L06': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })], // Kamito (IGV)
    'BP05-L11': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })], // Cpt (IGV)
    'BP05-L13': [E({ trigger: 'ON_AWAKEN', action: { type: 'MULTI', actions: [{ type: 'DRAW', amount: 2 }, { type: 'DISCARD_HAND', who: 'SELF', amount: 2 }] } })], // Arya Kuroha

    // 「対戦相手のリーダー1体に10ダメージ。」（16名）
    'BP01-011': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 兎咲ミミ
    'BP01-016': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // nqrse
    'ST02-001': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // Selly
    'ST01-002': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 小雀とと
    'BP02-002': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 如月れん
    'BP02-005': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // あれる
    'BP02-009': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 甘結もか
    'BP02-011': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // kinako
    'BP03-001': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 天月
    'BP03-009': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 藍沢エマ
    'BP03-011': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // ととみっくす
    'BP04-004': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // らいじん
    'BP04-005': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 神楽めあ
    'BP04-013': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 乾伸一郎
    'BP05-L12': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // Ras (IGV)
    'BP05-L16': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 10 } })], // ハセシン

    // 「対戦相手のリーダー1体に20ダメージ。」（10名）
    'BP01-002': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 小森めと
    'BP01-015': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // だるまいずごっど
    'BP02-008': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // トナカイト
    'BP03-006': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 紡木こかげ
    'BP03-010': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 鬼ヶ谷テン
    'BP04-006': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 白波らむね
    'BP04-012': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // とおこ
    'AN01-002': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 橘ひなの (AN1)
    'BP05-L04': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // LEO
    'BP05-L05': [E({ trigger: 'ON_AWAKEN', target: F.makeAnyOpponentLeaderTarget(), action: { type: 'DAMAGE', amount: 20 } })], // 碧依さくら

    // 「対戦相手のリーダーすべてに10ダメージ。」（9名）
    'BP01-001': [E({ trigger: 'ON_AWAKEN', target: F.makeAllAliveOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // うるか
    'BP01-006': [E({ trigger: 'ON_AWAKEN', target: F.makeAllAliveOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 渋谷ハル
    'ST02-004': [E({ trigger: 'ON_AWAKEN', target: F.makeAllAliveOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // Ras
    'ST01-003': [E({ trigger: 'ON_AWAKEN', target: F.makeAllAliveOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 花芽すみれ
    'BP02-010': [E({ trigger: 'ON_AWAKEN', target: F.makeAllAliveOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 神成きゅぴ
    'BP02-014': [E({ trigger: 'ON_AWAKEN', target: F.makeAllAliveOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // どぐら
    'BP03-004': [E({ trigger: 'ON_AWAKEN', target: F.makeAllAliveOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // rion
    'BP03-012': [E({ trigger: 'ON_AWAKEN', target: F.makeAllAliveOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // 猫麦とろろ
    'BP05-L02': [E({ trigger: 'ON_AWAKEN', target: F.makeAllAliveOpponentLeadersTarget(), action: { type: 'DAMAGE', amount: 10 } })], // Selly (IGV)
  };

  // パラレル/プロモ（例: BP01-137 超新星 SRP）は通常版と同一効果なので、通常版の登録を引く。
  function resolveCardId(cardId) {
    return (ParallelAliases && !REGISTRY[cardId] && ParallelAliases[cardId]) || cardId;
  }

  function getEffectsForCard(cardId) {
    return REGISTRY[resolveCardId(cardId)] || [];
  }

  function hasEffects(cardId) {
    var effects = REGISTRY[resolveCardId(cardId)];
    return !!effects && effects.length > 0;
  }

  return {
    REGISTRY: REGISTRY,
    getEffectsForCard: getEffectsForCard,
    hasEffects: hasEffects,
  };
}));
