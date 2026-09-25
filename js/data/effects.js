/* Xross Stars — カード効果のデータモデル（装備・タクティクス）
 *
 * Effect =
 *   | { type:'DAMAGE',          amount:number, target:'SELF'|'OPPONENT'|'ALL_OPPONENTS' }
 *   | { type:'HEAL',            amount:number, target:'SELF'|'ALLY' }
 *   | { type:'MAX_HP_MODIFIER', amount:number, target:'SELF'|'ALLY' }   // 最大HPを増減
 *   | { type:'SET_BASE_HP',     normal:number, awakened:number }        // 基本の体力を上書き
 *   | { type:'EQUIP',           cardId:string }
 *
 * 装備を足すときはこの配列に1件追記すれば、アプリの装備リストに自動で並びます。
 */
(function () {
  window.XS_EQUIPMENT = [
    {
      id: 'BP03-080',
      name: 'サイバネアーマー',
      cardNumber: 'BP03-080/081 TUC',
      cost: 0,
      image: 'cards/BP03-080_cybernearmor.webp',
      text: 'これを装備しているリーダーが覚醒していないなら、基本の体力は140になる。これを装備しているリーダーが覚醒しているなら、基本の体力は170になる。',
      effects: [{ type: 'SET_BASE_HP', normal: 140, awakened: 170 }]
    },
    {
      id: 'ST01-023',
      name: 'ライトシールド',
      cardNumber: 'ST01-023/025 TUC',
      cost: 0,
      image: 'cards/ST01-023_light-shield.webp',
      text: '体力+30',
      effects: [{ type: 'MAX_HP_MODIFIER', amount: 30, target: 'SELF' }]
    }
  ];

  window.XS_TACTICS = [
    { id: 'TC-001', name: '応急処置', effects: [{ type: 'HEAL', amount: 20, target: 'ALLY' }] }
  ];

  window.XS_PARSE_AWAKENING = function (text) {
    if (!text) return null;
    var heal = text.match(/自分のリーダー1体を(\d+)回復/);
    if (heal) return { type: 'HEAL', amount: Number(heal[1]), target: 'ALLY' };
    var dmg = text.match(/対戦相手のリーダー1体に(\d+)ダメージ/);
    if (dmg) return { type: 'DAMAGE', amount: Number(dmg[1]), target: 'OPPONENT' };
    return null;
  };
})();
