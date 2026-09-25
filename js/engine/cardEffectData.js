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
    module.exports = factory(require('./cardEffect.js'), require('./effectFactories.js'));
  } else {
    root.XS_ENGINE_CARD_EFFECT_DATA = factory(root.XS_ENGINE_CARD_EFFECT, root.XS_ENGINE_EFFECT_FACTORIES);
  }
}(typeof self !== 'undefined' ? self : this, function (CardEffectCore, EffectFactories) {
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
    // BP02-038/058）はPROVISIONALとして見送る（最終報告に一覧化）。
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

    // BP04-038 アナイアレーション（アタック, 緑, cost2）— 未実装（登録しない）
    // カードテキスト: "〖アタックする〗自分のリーダーの色がすべて異なるなら、ダメージ+30。
    //  〖アタック後〗自分のリーダーの色がすべて異なるなら、対戦相手の他のリーダー1体に30ダメージ、
    //  自分のリーダー1体を30回復し、カードを1枚引く。"
    // 阻害要因が2つある。(1)「自分のリーダーの色がすべて異なる」という条件を判定するConditionが
    // effectFactories.jsに存在しない（新設が必要）。(2) ON_ATTACKのATTACK_DAMAGE_BONUSは
    // computeAttackCardBaseDamage(cardId)がcardIdのみを受け取りcondition評価ができない設計になっており
    // （state/ctxを渡さない）、条件付きのアタック時ボーナスに対応するにはeffectResolver.js側の設計変更が
    // 必要になる。既存のCondition/Action基盤を壊さずに対応するには専用のPhase（設計・テスト込み）が
    // 必要なため、今回は推測で実装せず見送る。

    // AN01-008 ラストスタンド（アタック, 青, cost0, ACE）
    // カードテキスト: 画像で確認済み。「アタックする」以外の追加テキストなし（バニラのアタックカード）。
    // 追加効果が無いため、cardEffectData.jsへの登録は不要（未登録＝上乗せダメージ0のアタックカードとして扱われる）。
  };

  function getEffectsForCard(cardId) {
    return REGISTRY[cardId] || [];
  }

  function hasEffects(cardId) {
    return !!REGISTRY[cardId] && REGISTRY[cardId].length > 0;
  }

  return {
    REGISTRY: REGISTRY,
    getEffectsForCard: getEffectsForCard,
    hasEffects: hasEffects,
  };
}));
