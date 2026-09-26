/* テスト用の「効果の無い」カードを選ぶヘルパー。
 * ほぼ全カードに効果を登録したため、条件（種類・色・コスト等）に合う効果なしのカードが無いことがある。
 * その場合は、そのテストファイルの中で名前が出てこないカードを選び、このテストの中だけ効果の登録を外して使う
 * （テスト対象のカードを誤って選ばないように、テストのソースに出てくるカード番号は除外する）。
 */
const fs = require('fs');

module.exports = function makePlainCard(allCards, CardEffectData, testFile) {
  const source = testFile ? fs.readFileSync(testFile, 'utf8') : '';
  return function plainCard(pred) {
    const pool = allCards.filter((c) => pred(c) && !c.ban && !c.isParallel && typeof c.cost === 'number' &&
      !CardEffectData.KEYWORDS[c.cardNumber] && !source.includes("'" + c.cardNumber + "'"));
    const c = pool.find((x) => !CardEffectData.hasEffects(x.cardNumber)) || pool[0];
    if (!c) throw new Error('条件に合うテスト用カードがありません');
    delete CardEffectData.REGISTRY[c.cardNumber];
    return c.cardNumber;
  };
};
